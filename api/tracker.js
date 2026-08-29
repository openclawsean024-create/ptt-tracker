/**
 * api/tracker.js — round-2 M1 (MultiSourceTracker).
 *
 * Serverless handler that powers ``GET /api/tracker``.  Round-1 was
 * PTT-only; round-2 M1 dispatches through the same ``MultiSourceTracker``
 * registry used by ``tracker.js`` (CLI entrypoint) so the two share one
 * implementation.  Output shape is preserved byte-for-byte:
 *
 *   {
 *     success: true,
 *     timestamp: <ISO>,
 *     keywordMatches: [Article, ...],
 *     hotArticles:    [Article, ...]   // top-20 by pushes
 *   }
 *
 * Hardening (round-1 M5) is preserved verbatim:
 *
 *   * ALLOWED_ORIGIN env-driven, never wildcard
 *   * PTT_API_KEY shared-secret gate (when set)
 *   * diagnostic logs gated behind DEBUG_PTT
 */

const fs = require('fs');
const path = require('path');

const { PttConnector } = require('../sources/ptt');
const { resolveSources } = require('../sources/SourceConnector');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const DEFAULT_BOARDS = ['MacShop'];

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ptt-alertor-olive.vercel.app';
const PTT_API_KEY = process.env.PTT_API_KEY || '';
const DEBUG_PTT = Boolean(process.env.DEBUG_PTT);
function debugLog(...args) { if (DEBUG_PTT) console.log(...args); }
function debugError(...args) { if (DEBUG_PTT) console.error(...args); }

function unauthorized(res) {
  return res.status(401).json({ success: false, error: 'unauthorized' });
}

function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    fileConfig = {};
  }
  return {
    ...fileConfig,
    telegram_token: process.env.PTT_TELEGRAM_TOKEN,
    telegram_chat_id: process.env.PTT_TELEGRAM_CHAT_ID,
  };
}

function matchKeywords(title, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const titleLower = (title || '').toLowerCase();
  return keywords.some(k => titleLower.includes(String(k).toLowerCase()));
}

// ---------------------------------------------------------------------------
// Connector registry — single source of truth shared with ``tracker.js``.
// For M1 only PTT is registered; M2 will add Dcard.  Keeping the registry
// in the serverless handler is intentional: Vercel's per-function bundle
// would otherwise drag in Dcard code that's not yet used here.
// ---------------------------------------------------------------------------

function buildConnectorRegistry() {
  return {
    ptt: () => new PttConnector({ debugLog }),
    // dcard: () => new DcardConnector({ debugLog }),  // round-2 M2
  };
}

async function checkSources(config) {
  const sources = resolveSources(config);
  const minHeat = config.min_heat ?? 1;
  const keywords = config.keywords || [];
  const newArticles = [];
  const keywordMatches = [];
  const registry = buildConnectorRegistry();

  if (sources.length === 0) {
    return { newArticles, keywordMatches };
  }

  for (const name of sources) {
    const factory = registry[name];
    if (!factory) {
      debugLog(`[api/tracker] Unknown source '${name}' — skipping`);
      continue;
    }
    const connector = factory();
    if (!connector.enabled) {
      debugLog(`[api/tracker] Source '${name}' disabled — skipping`);
      continue;
    }

    let rawPosts = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      rawPosts = await connector.fetch({ since: null, limit: 30, ctx: { config } });
    } catch (error) {
      debugError(`[api/tracker] fetch error on '${name}': ${error && error.message ? error.message : error}`);
      rawPosts = [];
    }

    for (const raw of rawPosts) {
      let article;
      try {
        article = connector.normalize(raw, { config });
      } catch (error) {
        debugError(`[api/tracker] normalize error on '${name}': ${error && error.message ? error.message : error}`);
        continue;
      }

      if (article.pushes >= minHeat) newArticles.push(article);
      if (matchKeywords(article.title, keywords)) keywordMatches.push(article);
    }
  }
  return { newArticles, keywordMatches };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PTT-API-Key');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (PTT_API_KEY) {
    const presented = (req.headers && (req.headers['x-ptt-api-key'] || req.headers['X-PTT-API-Key'])) || '';
    if (!presented || presented !== PTT_API_KEY) {
      return unauthorized(res);
    }
  }

  try {
    const config = loadConfig();
    const result = await checkSources(config);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      keywordMatches: result.keywordMatches || [],
      hotArticles: (result.newArticles || []).sort((a, b) => b.pushes - a.pushes).slice(0, 20),
    });
  } catch (error) {
    debugError(`[api/tracker] top-level error: ${error && error.message ? error.message : error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
