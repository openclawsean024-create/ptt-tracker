/**
 * Dcard SourceConnector — round-2 M2.
 *
 * Implements the ``SourceConnector`` contract for Dcard's public, no-auth
 * forum index API.  Mirrors the structure of ``sources/ptt.js`` so the
 * rest of the orchestrator (``tracker.js`` / ``api/tracker.js``) doesn't
 * have to special-case the source.
 *
 * API surface
 * -----------
 * Dcard publishes a JSON index at::
 *
 *     https://www.dcard.tw/_api/posts?popular=true&limit=30
 *
 * and a per-forum variant::
 *
 *     https://www.dcard.tw/_api/forums/{forumAlias}/posts?popular=true&limit=30
 *
 * No auth required for the public global / per-forum feed.  From a
 * non-TW IP the service may answer ``403``; the connector catches that
 * inside ``fetch`` (logs via ``debugLog``) and returns ``[]`` so the
 * orchestrator's run never crashes on a single source.
 *
 * Why mock-first
 * --------------
 * The sandbox we develop in does not allow outbound HTTPS to ``dcard.tw``
 * (and CI should not depend on an external service being reachable).
 * To keep ``node --check`` green and let round-3 fixture tests drive
 * ``normalize`` deterministically, the fetch layer is gated behind an
 * explicit env flag (``DCARD_FETCH_ENABLED=1``).  By default it returns
 * an empty array and the connector's behaviour is fully exercised via
 * ``normalize``.  Setting the flag enables real network calls.
 *
 * Output Article shape (unified, identical to PTT adapter):
 *
 *     {
 *       title: string,
 *       url: string,                    // https://www.dcard.tw/f/{forumAlias}/p/{id}
 *       board: string,                  // forumName || forumAlias
 *       author: string,                 // user.nickname || user.id
 *       pushes: number,                 // reactionCount || 0
 *       posted_at: string,              // ISO 8601, raw.createdAt (post time)
 *       fetched_at: string,             // ISO 8601, normalize time (scrape time)
 *       timestamp: string,              // legacy alias = posted_at
 *       source: 'dcard',
 *       // legacy extras (kept for symmetry with PTT; legacy field names
 *       // used by downstream consumers / mirror tests)
 *       date: string,                   // ISO 8601 short date (YYYY-MM-DD)
 *       href: string,                   // canonical Dcard post URL
 *       heat: number,                   // alias of pushes (same as PTT)
 *     }
 *
 * Backwards compatibility
 * -----------------------
 * The shape matches what ``tracker.js`` ``checkSources`` already
 * filters / dedups on (``board`` / ``title`` / ``date || timestamp``
 * for the read_articles hash; ``pushes`` for the min_heat gate).
 * No orchestrator changes are required beyond the registry entry.
 */
'use strict';

const https = require('https');

const { SourceConnector, isSourceEnabled } = require('./SourceConnector');

const DCARD_HOST = 'www.dcard.tw';
const DEFAULT_FORUMS = ['3c', 'trending'];
const DEFAULT_LIMIT = 30;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 3;
const DEFAULT_USER_AGENT = 'ptt-tracker/dcard-connector (round-2 M2)';

// Round-3 M2: Dcard's per-forum endpoint natively supports an
// ``after`` query param (``https://www.dcard.tw/_api/forums/{alias}/posts
// ?popular=true&limit=30&after=2026-01-01T00:00:00.000Z``) which
// transparently drops posts with ``createdAt < after`` server-side.
// We append it whenever the orchestrator passes a non-null ``since``;
// ``null`` / missing → no ``after`` param (round-1 behaviour).
function buildSinceQuery(since) {
  if (since == null) return '';
  if (typeof since !== 'string') return '';
  const trimmed = since.trim();
  if (!trimmed) return '';
  // ``Date.parse`` is a quick sanity check; Dcard will reject truly
  // malformed values on its own, but we don't want to silently emit a
  // garbage query string.
  if (!Number.isFinite(Date.parse(trimmed))) return '';
  return `&after=${encodeURIComponent(trimmed)}`;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported so round-3 fixture / unit tests can drive them
// without ever touching the network.  ``normalizeArticle`` is the Python
// mirror's reference implementation; tests should pin its behaviour here.
// ---------------------------------------------------------------------------

/**
 * Build the canonical Dcard post URL.
 * @param {string|number} id  post id
 * @param {string} forumAlias  forum alias (slug)
 * @returns {string}
 */
function buildPostUrl(id, forumAlias) {
  return `https://www.dcard.tw/f/${forumAlias}/p/${id}`;
}

/**
 * Defensive numeric coercion (matches PTT parsePushCount's "0 on garbage"
 * policy so legacy heat filter mirrors keep working unchanged).
 */
function toNonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Normalize a raw Dcard post payload into the unified Article schema.
 *
 * Defensive defaults emit every required key even if the source record
 * is sparse (hand-crafted fixtures, partial API responses, etc.).  The
 * function is **total** — never throws on missing fields.
 *
 * Round-3 M1: time semantics split.  ``posted_at`` is the author's
 * post time (``raw.createdAt`` — Dcard ships the real ISO 8601).
 * ``fetched_at`` is the moment *this* process normalized the record
 * (``new Date().toISOString()`` at ``normalize`` time).  ``timestamp``
 * is the legacy alias kept equal to ``posted_at`` so the same field
 * name means the same thing across all sources (round-2 M3 finding #3
 * is closed — ``timestamp`` is no longer "scrape time" on PTT and
 * "post time" on Dcard, it's post time everywhere).
 *
 * @param {object} raw   raw Dcard API post (or fixture)
 * @param {object} ctx   ctx.now (optional) lets tests pin the
 *                       ``fetched_at`` stamp deterministically
 * @returns {object}     unified Article
 */
function normalizeArticle(raw, ctx = {}) {
  const safe = raw || {};
  const user = safe.user || {};
  const forumAlias = safe.forumAlias || (safe.forum && safe.forum.alias) || '';
  const forumName = (safe.forum && safe.forum.name) || forumAlias || '';
  const id = safe.id != null ? String(safe.id) : '';
  const title = safe.title || '';
  const author = user.nickname || user.id || '';
  const pushes = toNonNegativeInt(safe.reactionCount);
  // Dcard's ``createdAt`` is already ISO 8601 (e.g.
  // ``2026-08-29T15:30:00.000Z``).  When missing we stamp "now" so the
  // Article always has a parseable posted_at (M3 ISO parser tests need
  // this guarantee).
  const postedAt = safe.createdAt || new Date().toISOString();
  // fetched_at is the moment this process normalized the record; under
  // test ``ctx.now`` lets us pin a deterministic value.
  const nowRef = ctx && ctx.now ? new Date(ctx.now) : new Date();
  const fetchedAt = nowRef.toISOString();
  // Short date (``YYYY-MM-DD``) — mirrors PTT's ``date`` field shape
  // (which is ``M/DD`` in PTT but normalized by the existing pipeline as
  // a free-form string).  Empty when posted_at is unparseable.
  let date = '';
  if (typeof postedAt === 'string' && postedAt.length >= 10) {
    date = postedAt.slice(0, 10);
  }
  const href = forumAlias && id ? buildPostUrl(id, forumAlias) : '';

  return {
    title,
    url: href,
    board: forumName || forumAlias,
    author,
    pushes,
    // Round-3 M1 time semantics (canonical).
    posted_at: postedAt,
    fetched_at: fetchedAt,
    // Round-1+round-2 legacy alias — equal to ``posted_at`` so cross-
    // source callers see the same semantic for the same field name.
    timestamp: postedAt,
    source: 'dcard',
    // Legacy / extras — see PTT normalize for why these are kept.
    date,
    href,
    heat: pushes,
  };
}

// ---------------------------------------------------------------------------
// HTTP — minimal HTTPS GET with timeout + retry.  Pattern mirrors
// ``sources/ptt.js`` ``requestText`` so a future refactor can promote
// both to a shared util.  Kept local for now (only Dcard uses it today).
// ---------------------------------------------------------------------------

function requestJson({ hostname, path: requestPath, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, method: 'GET', headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error && error.message ? error.message : error}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Connector — the user-facing class.  ``fetch`` is env-gated to keep the
// sandbox / CI deterministic (see file header).  ``normalize`` is unconditional.
// ---------------------------------------------------------------------------

class DcardConnector extends SourceConnector {
  constructor(opts = {}) {
    super({ name: 'dcard', enabled: isSourceEnabled('dcard', opts.config || {}) });
    this._debugLog = opts.debugLog || (() => {});
    this._fetchEnabled = process.env.DCARD_FETCH_ENABLED === '1';
    this._userAgent = process.env.DCARD_USER_AGENT || DEFAULT_USER_AGENT;
  }

  /**
   * Fetch a list of raw Dcard posts across the configured forums.
   *
   * Returns ``[]`` when:
   *   * the env gate is off (default — sandbox / CI safety)
   *   * the configured forums list is empty
   *   * every per-forum request errored out (already logged via debugLog)
   *
   * Never throws — orchestrator relies on this to keep a single flaky
   * source from killing an entire run.
   */
  async fetch({ since = null, limit = DEFAULT_LIMIT, ctx = {} } = {}) {
    const dcardConfig = (ctx.config && ctx.config.sources_config && ctx.config.sources_config.dcard) || {};
    const forums = Array.isArray(dcardConfig.forums) && dcardConfig.forums.length > 0
      ? dcardConfig.forums
      : DEFAULT_FORUMS;
    // Round-3 M2: ``since`` is forwarded as a native ``?after=<ISO>``
    // query param.  Dcard's API drops posts with ``createdAt < after``
    // server-side, so we don't need any client-side post-filter.
    const sinceQuery = buildSinceQuery(since);

    if (!this._fetchEnabled) {
      this._debugLog('[dcard] fetch disabled (DCARD_FETCH_ENABLED != 1) — returning []');
      return [];
    }

    const out = [];
    for (const forumAlias of forums) {
      const posts = await this._fetchForum(forumAlias, limit, sinceQuery);
      for (const post of posts) {
        out.push(this._attachForumAlias(post, forumAlias));
      }
    }
    return out;
  }

  /**
   * Per-forum fetch with retry.  Errors are swallowed (logged) so a
   * single broken forum does not lose the rest of the run.
   *
   * Round-3 M2: ``sinceQuery`` (built by ``buildSinceQuery``) is
   * appended to the request path — empty string when ``since`` is
   * absent (round-1 behaviour) or unparseable.
   */
  async _fetchForum(forumAlias, limit, sinceQuery = '') {
    const path = `/_api/forums/${encodeURIComponent(forumAlias)}/posts?popular=true&limit=${encodeURIComponent(limit)}${sinceQuery}`;
    let lastError;
    for (let attempt = 1; attempt <= DEFAULT_RETRIES; attempt += 1) {
      try {
        this._debugLog(`[dcard] GET /${forumAlias} (attempt ${attempt}/${DEFAULT_RETRIES})`);
        // eslint-disable-next-line no-await-in-loop
        const json = await requestJson({
          hostname: DCARD_HOST,
          path,
          headers: {
            'User-Agent': this._userAgent,
            Accept: 'application/json',
          },
        });
        if (!Array.isArray(json)) return [];
        return json;
      } catch (error) {
        lastError = error;
        this._debugLog(`[dcard] error on ${forumAlias}: ${error && error.message ? error.message : error}`);
        if (attempt < DEFAULT_RETRIES) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(800 * attempt);
        }
      }
    }
    this._debugLog(`[dcard] giving up on ${forumAlias}: ${lastError && lastError.message ? lastError.message : lastError}`);
    return [];
  }

  /**
   * The Dcard per-forum endpoint already includes ``forumAlias`` on each
   * post, but the global ``/_api/posts`` endpoint does not.  This helper
   * back-fills it so downstream code can rely on a single shape.  Kept
   * as an instance method (vs free function) so future M3 fixtures can
   * override it.
   */
  // eslint-disable-next-line class-methods-use-this
  _attachForumAlias(post, forumAlias) {
    if (!post || typeof post !== 'object') return post;
    if (!post.forumAlias) {
      return Object.assign({}, post, { forumAlias });
    }
    return post;
  }

  /**
   * Pure translation raw → unified Article.  Does not throw.
   * Delegates to the module-level ``normalizeArticle`` so it is also
   * importable directly for tests.
   */
  normalize(raw, ctx = {}) {
    return normalizeArticle(raw, ctx);
  }
}

module.exports = {
  DcardConnector,
  normalizeArticle,
  buildPostUrl,
  // Round-3 M2: exposed so the (future) mirror test suite can pin the
  // query-string shape (round-3 M3 fixture will assert ``after=``
  // appears verbatim when a valid since is passed and is omitted for
  // ``null``).
  buildSinceQuery,
  DEFAULT_FORUMS,
  DCARD_HOST,
};
