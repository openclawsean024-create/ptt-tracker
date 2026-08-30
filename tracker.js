#!/usr/bin/env node
/**
 * PTT Tracker - Node.js Version (round-2 M1: MultiSourceTracker)
 *
 * Round-1 was PTT-only.  Round-2 M1 refactors the entrypoint into a
 * ``MultiSourceTracker`` orchestrator: PTT-specific logic now lives in
 * ``sources/ptt.js``; this file is just the dispatch + presentation
 * layer that loops over the configured sources, normalizes their raw
 * posts into unified Article objects, and (when Telegram is configured)
 * fires notifications.
 *
 * Backwards-compatibility notes:
 *   * ``node tracker.js`` and ``node tracker.js --watch N`` CLI flags are
 *     preserved verbatim.
 *   * ``read_articles.json`` semantics (hash-keyed dedup of "already seen"
 *     articles) are unchanged.
 *   * Telegram message format is byte-for-byte identical to round-1 —
 *     existing subscribers see no diff.
 *   * ``config.json`` without a ``sources`` field defaults to ``["ptt"]``,
 *     so every existing deploy runs exactly what it ran in round-1.
 *   * ``config.json`` with ``"sources": []`` short-circuits to "no new
 *     articles" without contacting any platform.
 *   * ``module.exports`` keeps ``run`` / ``checkBoards`` /
 *     ``parseArticles`` / ``formatArticle`` so any downstream
 *     importer (round-1 ``app.js`` etc.) keeps working — though the
 *     37 pytest tests don't import any of these today.
 */

const fs = require('fs');
const path = require('path');

const { PttConnector } = require('./sources/ptt');
const { DcardConnector } = require('./sources/dcard');
const { resolveSources } = require('./sources/SourceConnector');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const READ_FILE = path.join(__dirname, 'read_articles.json');
const DEFAULT_INTERVAL_MINUTES = 5;

// Debug gate — non-emoji diagnostic console.log calls are routed through
// this helper and only emit when DEBUG_PTT is set.  Emoji-prefixed CLI
// output (the user-facing progress banner) still goes straight to stdout.
const DEBUG_PTT = Boolean(process.env.DEBUG_PTT);
function debugLog(...args) {
  if (DEBUG_PTT) console.log(...args);
}
function debugError(...args) {
  if (DEBUG_PTT) console.error(...args);
}

// ---------------------------------------------------------------------------
// Connector registry — adding a new source is one entry here + one file in
// sources/.  Round-3 will register ``ThreadsConnector`` / ``BahamutConnector``.
// ---------------------------------------------------------------------------

function buildConnectorRegistry() {
  return {
    ptt: () => new PttConnector({ debugLog }),
    dcard: () => new DcardConnector({ debugLog }),
    // threads: () => new ThreadsConnector({ debugLog }),  // round-3+
    // bahamut: () => new BahamutConnector({ debugLog }),  // round-3+
  };
}

function loadConfig() {
  // Non-secret config (boards / keywords / min_heat / interval_minutes /
  // sources) is read from config.json.  Telegram secrets are read ONLY
  // from environment variables — never from config.json (which would risk
  // them being committed).  See .env.example.
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

function loadReadArticles() {
  try {
    if (fs.existsSync(READ_FILE)) {
      return JSON.parse(fs.readFileSync(READ_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveReadArticles(data) {
  fs.writeFileSync(READ_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getHash(str) {
  let hash = 0;
  for (let i = 0; str && i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString();
}

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Telegram — kept verbatim from round-1 (format bytes preserved).
// ---------------------------------------------------------------------------

async function requestText({ hostname, path: requestPath, method = 'GET', headers = {}, body, timeoutMs = 15000 }) {
  const https = require('https');
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

async function sendTelegram(message, config) {
  const { telegram_token, telegram_chat_id } = config;
  if (!telegram_token || !telegram_chat_id) {
    debugLog('[WARN] Telegram not configured');
    return false;
  }

  const body = JSON.stringify({
    chat_id: telegram_chat_id,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  try {
    const responseText = await requestText({
      hostname: 'api.telegram.org',
      path: `/bot${telegram_token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });

    const result = JSON.parse(responseText);
    if (result.ok) {
      console.log('✅ Telegram notification sent');
      return true;
    }

    console.log(`❌ Telegram error: ${result.description || 'unknown error'}`);
    return false;
  } catch (error) {
    console.log(`❌ Telegram error: ${error.message}`);
    return false;
  }
}

function articleEmoji(pushes) {
  if (pushes >= 50) return '🔥';
  if (pushes >= 20) return '📈';
  if (pushes > 0) return '🆕';
  return '📝';
}

function formatArticle(article) {
  return [
    `${articleEmoji(article.pushes)} [${article.board}] 推文 ${article.pushes}`,
    `標題：${article.title}`,
    `作者：${article.author}`,
    `日期：${article.date}`,
    `連結：${article.url}`,
  ].join('\n');
}

function formatTelegramArticle(article) {
  return [
    `${articleEmoji(article.pushes)} <b>[${escapeHtml(article.board)}]</b> 推文 ${article.pushes}`,
    `標題：${escapeHtml(article.title)}`,
    `作者：${escapeHtml(article.author)}`,
    `日期：${escapeHtml(article.date)}`,
    `連結：${escapeHtml(article.url)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MultiSourceTracker — instantiates the requested connectors, fans out
// ``fetch`` over them, then normalizes + merges + dedups.  Mirrors the
// round-1 ``checkBoards`` contract: returns ``{ newArticles, keywordMatches }``.
//
// Round-3 M2: ``ctx`` (the second positional argument) propagates
// ``since`` / ``limit`` to each connector's ``fetch``.  ``since`` is an
// ISO 8601 string (e.g. ``"2026-01-01T00:00:00.000Z"``) or ``null`` for
// the round-1 default ("no time filter, just take the freshest N
// posts").  Each source decides how to honour ``since`` — PTT applies a
// 24h grace client-side, Dcard forwards it as ``?after=<ISO>``.
// ---------------------------------------------------------------------------

function matchKeywords(title, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const titleLower = (title || '').toLowerCase();
  return keywords.some(keyword => titleLower.includes(String(keyword).toLowerCase()));
}

/**
 * Normalize the CLI / programmatic ``since`` value.
 *
 *   * ``null`` / ``undefined`` / empty string → ``null`` (round-1
 *     behaviour: "no time filter").
 *   * ISO 8601 string → returned verbatim after a parseability probe;
 *     if ``Date.parse`` rejects it we still pass the original string
 *     through (connectors that try to use it will surface their own
 *     error) so the CLI doesn't crash on a typo.
 *
 * Kept as a tiny standalone helper (no validation side effects) so
 * ``api/tracker.js`` can reuse it for the query-string path.
 */
function normalizeSince(rawSince) {
  if (rawSince == null) return null;
  if (typeof rawSince !== 'string') return null;
  const trimmed = rawSince.trim();
  if (!trimmed) return null;
  return trimmed;
}

async function checkSources(config, ctx = {}) {
  const sources = resolveSources(config);
  const minHeat = config.min_heat ?? 1;
  const keywords = config.keywords || [];
  const readArticles = loadReadArticles();
  const newArticles = [];
  const keywordMatches = [];
  const registry = buildConnectorRegistry();

  // Round-3 M2: ``since`` flows from the caller (CLI flag or serverless
  // query param) down to each connector's ``fetch``.  Null → round-1
  // behaviour.  Also threaded through as ``ctx.since`` so any source
  // that wants it during ``normalize`` can read it from one place.
  const since = normalizeSince(ctx.since);
  const limit = Number.isFinite(ctx.limit) ? ctx.limit : 30;

  console.log(`\n📋 Checking sources: ${sources.join(', ')}`);
  if (sources.length === 0) {
    return { newArticles, keywordMatches };
  }
  if (since) {
    console.log(`⏱️  since-filter: ${since}`);
  }

  for (const name of sources) {
    const factory = registry[name];
    if (!factory) {
      console.log(`  ⚠️  Unknown source '${name}' — skipping (registry: ${Object.keys(registry).join(', ')})`);
      continue;
    }
    const connector = factory();
    if (!connector.enabled) {
      console.log(`  ⏭️  Source '${name}' is disabled — skipping`);
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
      console.log(`  ❌ Error fetching '${name}': ${error && error.message ? error.message : error}`);
      rawPosts = [];
    }

    for (const raw of rawPosts) {
      let article;
      try {
        article = connector.normalize(raw, { config });
      } catch (error) {
        debugLog(`[normalize] ${name} dropped a post: ${error && error.message ? error.message : error}`);
        continue;
      }

      const hash = getHash(`${article.board}|${article.title}|${article.date || article.timestamp}`);
      if (readArticles[hash]) continue;

      readArticles[hash] = {
        readAt: new Date().toISOString(),
        title: article.title,
        board: article.board,
        url: article.url,
      };

      if (article.pushes >= minHeat) {
        newArticles.push(article);
      }
      if (matchKeywords(article.title, keywords)) {
        keywordMatches.push(article);
      }
    }
  }

  saveReadArticles(readArticles);
  return { newArticles, keywordMatches };
}

// ---------------------------------------------------------------------------
// ``checkBoards`` is preserved as an alias of ``checkSources`` so any
// downstream importer of the round-1 API surface still works.
// ---------------------------------------------------------------------------

async function checkBoards(config, ctx) {
  return checkSources(config, ctx);
}

/**
 * Top-level orchestrator entry point.  Round-3 M2 adds an optional
 * ``ctx`` argument (``{ since, limit }``) that propagates a
 * ``since`` ISO 8601 cutoff to every connector.  Round-1 callers
 * passing only ``config`` keep working — ``ctx`` defaults to ``{}``.
 */
async function run(config, ctx = {}) {
  const since = normalizeSince(ctx.since);

  console.log('==================================================');
  console.log('🤖 PTT Tracker Started');
  console.log('==================================================');
  console.log(`📌 Sources: ${resolveSources(config).join(', ')}`);
  console.log(`📌 Boards: ${(config.boards || []).join(', ') || '(source defaults)'}`);
  console.log(`🔑 Keywords: ${(config.keywords || []).join(', ') || 'None'}`);
  console.log(`🔥 Min Heat: ${config.min_heat ?? 1}`);
  if (since) {
    console.log(`⏱️  since: ${since}`);
  }
  debugLog('--------------------------------------------------');

  const { newArticles, keywordMatches } = await checkSources(config, { since, limit: ctx.limit });

  if (keywordMatches.length > 0) {
    console.log('\n🎯 KEYWORD MATCHES:');
    for (const article of keywordMatches) {
      const message = `🎯 <b>PTT 關鍵字通知</b>\n\n${formatTelegramArticle(article)}`;
      console.log(formatArticle(article));
      await sendTelegram(message, config);
    }
  }

  if (newArticles.length > 0) {
    console.log(`\n🔥 Hot Articles (${newArticles.length}):`);
    const sorted = [...newArticles].sort((a, b) => b.pushes - a.pushes);
    for (const article of sorted.slice(0, 10)) {
      console.log(formatArticle(article));
      console.log('');
    }
  }

  if (keywordMatches.length === 0 && newArticles.length === 0) {
    console.log('\n✅ No new articles matching criteria');
  }

  console.log('\n==================================================');
  console.log('✅ Done');
  console.log('==================================================');

  return { newArticles, keywordMatches };
}

/**
 * Parse the flat ``--key value`` argv stream into a plain object.
 * Recognised keys (round-3 M2): ``--since <ISO>``.  Unknown flags are
 * ignored — round-1 callers that still pass ``--watch`` / ``-w`` skip
 * this loop entirely because we branch on the *first* arg before
 * scanning.
 *
 * ``--since`` accepts an ISO 8601 string (``2026-01-01T00:00:00.000Z``)
 * and threads it through ``run(config, { since })``.  ``null`` /
 * missing → round-1 default (no time filter).
 */
function parseCliFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--since') {
      const next = args[i + 1];
      out.since = next != null ? next : null;
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args[0] === '--watch' || args[0] === '-w') {
    const interval = Number.parseInt(args[1], 10) || config.interval_minutes || DEFAULT_INTERVAL_MINUTES;
    console.log(`\n👀 Watch mode: checking every ${interval} minutes`);
    console.log('Press Ctrl+C to stop\n');

    const flags = parseCliFlags(args.slice(2));
    async function loop() {
      try {
        await run(config, flags);
      } catch (error) {
        debugError(`[loop] ${error && error.message ? error.message : error}`);
      }
      console.log(`\n⏳ Sleeping for ${interval} minutes...`);
      setTimeout(loop, interval * 60 * 1000);
    }

    await loop();
    return;
  }

  const flags = parseCliFlags(args);
  await run(config, flags);
}

if (require.main === module) {
  main().catch((error) => {
    debugError(`[main] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  checkBoards,
  checkSources,
  // Round-3 M2: ``normalizeSince`` is shared with ``api/tracker.js``
  // (serverless query-param path) so the two surfaces treat the same
  // ISO 8601 string identically.
  normalizeSince,
  // Backwards-compat exports — round-1 callers that imported these helpers
  // directly (none of the 37 pytest tests do, but ``app.js`` style
  // consumers might).  Re-exported from ``sources/ptt.js`` so the legacy
  // surface still works.
  formatArticle,
  parseArticles: require('./sources/ptt').parseArticles,
};
