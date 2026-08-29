/**
 * PTT SourceConnector — round-2 M1.
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
 * The output Article shape is **extended** to add ``source`` (``'ptt'``)
 * and ``timestamp`` (Date.now() at fetch time, used by future round-3
 * ``since`` filtering), while keeping the legacy fields (``board``,
 * ``pushes``, ``author``, ``title``, ``url``, plus the round-1 extras
 * ``date``, ``href``, ``heat``) that the existing 37 pytest mirrors pin.
 */
'use strict';

const https = require('https');

const { SourceConnector, isSourceEnabled } = require('./SourceConnector');

const PTT_BASE_URL = 'www.ptt.cc';
const PTT_BASE_URL_FULL = 'https://www.ptt.cc';
const DEFAULT_BOARDS = ['Gossiping', 'Tech_Job', 'Stock', 'AI', 'MobileComm', 'Food'];
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 3;

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
    // ``since`` is accepted for API symmetry with future sources; PTT's
    // board index page is always "most-recent-first" so we just ``slice``
    // to the per-board ``limit`` and let callers filter downstream.
    void since;
    const out = [];
    for (const board of boards) {
      try {
        this._debugLog(`[ptt] checking ${board}…`);
        // eslint-disable-next-line no-await-in-loop
        const articles = await getBoardArticles(board, limit);
        out.push(...articles);
      } catch (error) {
        this._debugLog(`[ptt] error on ${board}: ${error && error.message ? error.message : error}`);
      }
    }
    return out;
  }

  normalize(raw, ctx = {}) {
    // The round-1 shape already matches the unified Article contract for
    // PTT — ``pushes`` is the heat, ``board`` is the source-native name.
    // We just stamp ``source: 'ptt'`` and an ISO ``timestamp`` (used by
    // round-3 ``since`` filtering) so M3 schema tests can assert it.
    //
    // Defensive defaults (``|| ''`` / ``|| 0``) keep the function total
    // when driven from a hand-built fixture rather than the real
    // ``parseArticles`` output (round-3 unit tests will do this).
    const pushes = Number.isFinite(raw && raw.pushes) ? raw.pushes : 0;
    return {
      title: (raw && raw.title) || '',
      url: (raw && raw.url) || '',
      board: (raw && raw.board) || '',
      author: (raw && raw.author) || '',
      pushes,
      timestamp: new Date().toISOString(),
      source: this.name,
      // Preserve the round-1 extras so legacy consumers / mirrors keep
      // working.  These are NOT part of the unified schema but are
      // tolerated by M3 tests because they don't assert "no other keys".
      href: (raw && raw.href) || '',
      heat: pushes,
      date: (raw && raw.date) || '',
    };
  }
}

module.exports = {
  PttConnector,
  // Exported for direct unit-test / fixture use (round-1 callers that
  // imported ``parseArticles`` from ``tracker.js`` continue to work).
  parseArticles,
  getBoardArticles,
  DEFAULT_BOARDS,
  PTT_BASE_URL,
};
