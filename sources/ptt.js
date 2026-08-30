/**
 * PTT SourceConnector — round-2 M1, round-3 M1 (time semantics split).
 *
 * Implements the ``SourceConnector`` contract for the PTT board index
 * pages.  Behaviour is **byte-for-byte** preserved from the round-1
 * inline implementation in ``tracker.js`` / ``api/tracker.js``:
 *
 *   * same user-agent, same ``over18=1`` cookie (PTT gates scraping behind
 *     an age-verification cookie)
 *   * same HTML splitting on ``<div class="r-ent">``
 *   * same regex extraction of title / author / date / nrec
 *   * same push-count semantics (``爆``→100, ``X*``→-10, otherwise int)
 *   * same retry policy (3 attempts, exponential-ish backoff: 800/1600ms)
 *   * same default board list when ``config.boards`` is absent
 *
 * The output Article shape is **extended** (round-3 M1) to emit three
 * time-semantics fields:
 *
 *   * ``posted_at``  — ISO 8601 of the author's post time, derived from
 *     the PTT ``" M/D"`` date column via :func:`parsePttDate` (with a
 *     90-day cross-year fallback so e.g. ``"12/31"`` parsed in January
 *     resolves to the *previous* December).
 *   * ``fetched_at`` — ISO 8601 stamped at ``normalize`` time
 *     (``new Date().toISOString()``); the moment *this process*
 *     observed the record, independent of the source.
 *   * ``timestamp``  — legacy alias equal to ``posted_at`` so the
 *     existing round-1+round-2 pytest mirror tests (and any
 *     downstream consumer reading ``article.timestamp``) keep working
 *     without source-side changes.
 *
 * Legacy fields (``board``, ``pushes``, ``author``, ``title``, ``url``,
 * plus the round-1 extras ``date``, ``href``, ``heat``) are preserved.
 */
'use strict';

const https = require('https');

const { SourceConnector, isSourceEnabled } = require('./SourceConnector');

const PTT_BASE_URL = 'www.ptt.cc';
const PTT_BASE_URL_FULL = 'https://www.ptt.cc';
const DEFAULT_BOARDS = ['Gossiping', 'Tech_Job', 'Stock', 'AI', 'MobileComm', 'Food'];
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 3;

// Round-3 M1: how aggressively we suspect a PTT ``" M/D"`` date string
// refers to the previous calendar year.  PTT only ships ``" M/D"`` (no
// year), so when we see e.g. ``"12/31"`` while today is January the
// date is almost certainly from the *previous* December (the article
// stayed on the front page over the new-year boundary).  A generous
// 90-day window means we only apply the rollback when the naive
// interpretation is otherwise mathematically inconsistent — anything
// tighter risks mis-dating posts that are simply not very recent.
const PTT_CROSS_YEAR_THRESHOLD_DAYS = 90;

// Round-3 M1: deterministic helper for tests / M2 since-filtering that
// want to pin a fake ``Date.now()`` value.  ``now`` is an optional
// epoch-ms (or ISO 8601 string) used as the "now" reference when
// guessing the missing year on PTT ``" M/D"`` dates.
function resolveNow(now) {
  if (now == null) return new Date();
  if (now instanceof Date) return new Date(now.getTime());
  return new Date(now);
}

// Round-3 M2: how generous to be when a PTT post's ``posted_at``
// falls *just* before the caller-supplied ``since`` cutoff.  PTT's
// board index only carries an ``M/D`` date (no hours/minutes) so an
// article stamped "3/27" actually covers the *whole* day.  Subtracting
// 24h ensures we never drop an article whose day-level granularity
// hides the real post time inside the filter window.
const PTT_SINCE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Round-3 M2: parse a caller-supplied ``since`` (ISO 8601 string from
 * CLI / query param) into epoch-ms, or return ``null`` for the
 * round-1 "no filter" sentinel.  Returns ``null`` (NOT NaN) on
 * unparseable input so the connector's filter logic can short-circuit
 * safely.
 */
function parseSinceMs(rawSince) {
  if (rawSince == null) return null;
  if (rawSince instanceof Date) {
    const ms = rawSince.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof rawSince !== 'string') return null;
  const trimmed = rawSince.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Pure helpers (identical to round-1 — mirrors in tests/_pure_mirrors.py pin
// their semantics; changing any of these is a contract change).
// ---------------------------------------------------------------------------

function decodeHtml(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripTags(text = '') {
  return decodeHtml(text.replace(/<[^>]+>/g, '')).trim();
}

function parsePushCount(raw = '') {
  const value = raw.trim();
  if (!value) return 0;
  if (value === '爆') return 100;
  if (value.startsWith('X')) return -10;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Round-3 M1: parse a PTT ``" M/D"`` (no year) date string into an ISO
// 8601 timestamp.
//
// Behaviour
// ---------
//   * Empty / null / unparseable input → defensive fallback to ``now``,
//     so a malformed raw date never produces an invalid Article.
//   * Otherwise: assume the *current* calendar year, then apply a
//     90-day cross-year fallback — if the candidate lands more than
//     ``PTT_CROSS_YEAR_THRESHOLD_DAYS`` away from ``now`` (in either
//     direction), assume the previous calendar year instead.  This
//     fixes the common new-year-front-page case (PTT still showing
//     ``"12/31"`` entries on January 2nd).
//
// Pure function: ``now`` is an optional injection point (epoch-ms,
// ISO 8601 string, or ``Date`` instance) for deterministic tests.
// Exported so M2's since-filtering can re-derive posted_at from raw
// board-index entries and so M3's mirror tests can drive it from
// Python.
function parsePttDate(dateStr, now = null) {
  if (!dateStr || typeof dateStr !== 'string') {
    return resolveNow(now).toISOString();
  }
  const s = dateStr.trim();
  const match = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return resolveNow(now).toISOString();
  }
  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return resolveNow(now).toISOString();
  }
  const ref = resolveNow(now);
  let year = ref.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  // Guard against weird ``Date.UTC`` overflow (Feb 30 → Mar 2) by
  // recomputing the month/year from the resulting Date.
  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return resolveNow(now).toISOString();
  }
  const diffDays = Math.abs(ref.getTime() - candidate.getTime()) / 86400000;
  if (diffDays > PTT_CROSS_YEAR_THRESHOLD_DAYS) {
    candidate = new Date(Date.UTC(year - 1, month - 1, day));
  }
  return candidate.toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTTP — minimal HTTPS GET/POST with timeout.  Kept in this file (not
// extracted to a shared util) because only PTT uses it today; if a future
// source needs the same we can promote it then.  Behaviour identical to
// round-1 ``tracker.js`` ``requestText``.
// ---------------------------------------------------------------------------

function requestText({ hostname, path: requestPath, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// PTT-specific HTML parsing.  Pure function — exported for unit tests and
// for any future M3 fixture that wants to drive the parser directly.
// ---------------------------------------------------------------------------

function parseArticles(html, board) {
  const articles = [];
  const entries = html.split('<div class="r-ent">').slice(1);

  for (const entry of entries) {
    const titleMatch = entry.match(/<div class="title">([\s\S]*?)<\/div>/);
    if (!titleMatch) continue;

    const anchorMatch = titleMatch[1].match(/<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!anchorMatch) continue;

    const href = anchorMatch[1].trim();
    const title = stripTags(anchorMatch[2]);
    if (!href || !title) continue;

    const author = stripTags((entry.match(/<div class="author">([\s\S]*?)<\/div>/) || [])[1] || '未知');
    const date = stripTags((entry.match(/<div class="date">([\s\S]*?)<\/div>/) || [])[1] || '');
    const pushes = parsePushCount(stripTags((entry.match(/<div class="nrec">([\s\S]*?)<\/div>/) || [])[1] || ''));

    articles.push({
      title,
      href,
      author,
      date,
      pushes,
      heat: pushes,
      board,
      url: `${PTT_BASE_URL_FULL}${href}`,
    });
  }

  return articles;
}

async function getBoardArticles(board, limit = 30, retries = DEFAULT_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const html = await requestText({
        hostname: PTT_BASE_URL,
        path: `/bbs/${board}/index.html`,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Cookie: 'over18=1',
        },
      });

      return parseArticles(html, board).slice(0, limit);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(800 * attempt);
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Connector — wraps the helpers above and exposes the SourceConnector
// interface (``fetch`` + ``normalize``).  Each call to ``new PttConnector``
// is cheap (no I/O); one instance is reused across the run.
// ---------------------------------------------------------------------------

class PttConnector extends SourceConnector {
  constructor(opts = {}) {
    super({ name: 'ptt', enabled: isSourceEnabled('ptt', opts.config || {}) });
    this._debugLog = opts.debugLog || (() => {});
  }

  async fetch({ since = null, limit = 30, ctx = {} } = {}) {
    const boards = (ctx.config && ctx.config.boards) || DEFAULT_BOARDS;
    // Round-3 M2: ``since`` filtering is applied **after** the board
    // index fetch — PTT's board page is always "most-recent-first" with
    // no native ``?after=`` query param, so we pull the freshest
    // ``limit`` entries and drop anything whose parsed ``posted_at``
    // is older than ``since - 24h``.  The 24h grace absorbs PTT's
    // day-level date granularity (``" M/D"``) so an article stamped
    // 3/27 at the start of the day isn't wrongly excluded when the
    // caller's cutoff is the same day at 09:00.
    //
    // When ``posted_at`` is unparseable (empty ``raw.date``) we err on
    // the side of **keeping** the article — defensive, matches the
    // round-2 normalize contract that always returns a parseable
    // ``posted_at`` even when the raw date is missing (falls back to
    // ``now``).
    const sinceMs = parseSinceMs(since);
    const thresholdMs = sinceMs == null ? null : sinceMs - PTT_SINCE_GRACE_MS;

    const out = [];
    for (const board of boards) {
      try {
        this._debugLog(`[ptt] checking ${board}…`);
        // eslint-disable-next-line no-await-in-loop
        const articles = await getBoardArticles(board, limit);
        if (thresholdMs == null) {
          out.push(...articles);
          continue;
        }
        for (const article of articles) {
          const candidateMs = Date.parse(parsePttDate(article.date));
          // Defensive: if ``posted_at`` is unparseable keep the
          // article — round-2 normalize contract guarantees
          // ``parsePttDate`` returns a valid ISO string even for empty
          // input, so this branch only fires on truly corrupt data.
          if (!Number.isFinite(candidateMs) || candidateMs >= thresholdMs) {
            out.push(article);
          }
        }
      } catch (error) {
        this._debugLog(`[ptt] error on ${board}: ${error && error.message ? error.message : error}`);
      }
    }
    return out;
  }

  normalize(raw, ctx = {}) {
    // Round-3 M1: split Article time semantics into posted_at / fetched_at /
    // timestamp.  ``posted_at`` is the author's post time (derived from the
    // PTT ``" M/D"`` date via parsePttDate); ``fetched_at`` is the moment
    // *this* process normalized the record; ``timestamp`` is the legacy
    // alias equal to ``posted_at`` so the existing round-1+round-2 pytest
    // mirrors continue to pass without modification of their timestamp
    // assertions (they check ISO 8601 parseability / shape, not scrape
    // time specifically).
    //
    // ``ctx.now`` lets callers (and M2 since-filtering) pin a fake
    // reference time so both parsePttDate and the fetched_at stamp line
    // up under test.
    const safe = raw || {};
    const pushes = Number.isFinite(safe.pushes) ? safe.pushes : 0;
    const referenceNow = ctx && ctx.now ? ctx.now : null;
    const postedAt = parsePttDate(safe.date, referenceNow);
    const fetchedAt = resolveNow(referenceNow).toISOString();
    return {
      title: safe.title || '',
      url: safe.url || '',
      board: safe.board || '',
      author: safe.author || '',
      pushes,
      // Round-3 M1 time semantics (canonical).
      posted_at: postedAt,
      fetched_at: fetchedAt,
      // Round-1+round-2 legacy alias — kept equal to ``posted_at`` so the
      // same field name means the same thing across all sources.
      timestamp: postedAt,
      source: this.name,
      // Preserve the round-1 extras so legacy consumers / mirrors keep
      // working.  These are NOT part of the unified schema but are
      // tolerated by M3 tests because they don't assert "no other keys".
      href: safe.href || safe.url || '',
      heat: pushes,
      date: safe.date || '',
    };
  }
}

module.exports = {
  PttConnector,
  // Exported for direct unit-test / fixture use (round-1 callers that
  // imported ``parseArticles`` from ``tracker.js`` continue to work).
  parseArticles,
  parsePttDate,
  getBoardArticles,
  // Round-3 M2: ``parseSinceMs`` + ``PTT_SINCE_GRACE_MS`` exposed for
  // the (future) mirror tests that need to pin the grace window.
  parseSinceMs,
  PTT_SINCE_GRACE_MS,
  DEFAULT_BOARDS,
  PTT_BASE_URL,
  PTT_CROSS_YEAR_THRESHOLD_DAYS,
};
