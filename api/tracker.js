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
const { DcardConnector } = require('../sources/dcard');
const { resolveSources } = require('../sources/SourceConnector');
// Round-3 M2: ``normalizeSince`` keeps the CLI / serverless surfaces
// honest about what counts as a "valid since value".  Re-exported
// from ``tracker.js`` so the two paths agree on the contract.
const { normalizeSince } = require('../tracker');
// Round-4 M1: cross-source aggregator — same module the CLI uses, so
// serverless + CLI produce identical deduped/heat-ranked output.
const { dedup, rankByHeat } = require('../sources/aggregator');

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
    dcard: () => new DcardConnector({ debugLog }),
  };
}

async function checkSources(config, ctx = {}) {
  const sources = resolveSources(config);
  const minHeat = config.min_heat ?? 1;
  const keywords = config.keywords || [];
  const newArticles = [];
  const keywordMatches = [];
  const registry = buildConnectorRegistry();

  // Round-3 M2: ``since`` flows from the ``?since=<ISO>`` query param
  // through to each connector's ``fetch``.  Same contract as the CLI
  // path (``null`` → round-1 behaviour, ISO 8601 → honour it).
  const since = normalizeSince(ctx.since);
  const limit = Number.isFinite(ctx.limit) ? ctx.limit : 30;

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
      rawPosts = await connector.fetch({
        since,
        limit,
        ctx: { config, since },
      });
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
    // Round-3 M2: serverless entrypoint accepts ``?since=<ISO>`` as a
    // query param.  ``req.query`` is Vercel's parsed querystring (also
    // works in raw ``http.IncomingMessage`` because Vercel polyfills
    // it).  We pass the raw value straight through; ``normalizeSince``
    // trims / null-checks before it reaches any connector.
    const since = req.query && req.query.since;
    // Round-4 M1: aggregate is opt-out via ``?aggregate=false`` (or the
    // legacy alias ``?no-aggregate=true``).  Truthy values other than
    // ``'false'`` / ``'0'`` are treated as on; anything else defaults
    // to ``true``.  Config-side ``config.aggregate`` is the secondary
    // switch — either set to ``false`` short-circuits to round-3.
    const rawAgg = req.query && (req.query.aggregate ?? req.query['no-aggregate']);
    const queryAggregate = rawAgg == null
      ? true
      : !['false', '0', 'no', 'off'].includes(String(rawAgg).toLowerCase());
    const aggregate = queryAggregate && config.aggregate !== false;
    const result = await checkSources(config, { since });

    // Round-4 M1: dedup + heat-rank when aggregate is on.  When off we
    // keep the round-3 sort-by-pushes behaviour.  ``articleCount`` is
    // the raw count from the connectors; ``uniqueCount`` is after dedup.
    const rawArticles = result.newArticles || [];
    const articleCount = rawArticles.length;
    let hotArticles = rawArticles;
    let uniqueCount = articleCount;
    if (aggregate && rawArticles.length > 0) {
      hotArticles = rankByHeat(dedup(rawArticles));
      uniqueCount = hotArticles.length;
    } else {
      hotArticles = rawArticles.sort((a, b) => b.pushes - a.pushes).slice(0, 20);
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      keywordMatches: result.keywordMatches || [],
      hotArticles: hotArticles.slice(0, 20),
      // Round-3 M2: echo the parsed ``since`` so callers can confirm
      // what filter the server actually applied (null → round-1 mode).
      since: normalizeSince(since),
      // Round-4 M1: surface the aggregation decision + counts so the
      // dashboard / CLI can confirm what the server actually did.
      aggregated: aggregate,
      articleCount,
      uniqueCount,
    });
  } catch (error) {
    debugError(`[api/tracker] top-level error: ${error && error.message ? error.message : error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
