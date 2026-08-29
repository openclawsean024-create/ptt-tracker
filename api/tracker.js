const https = require('https');
const fs = require('fs');
const path = require('path');

const PTT_BASE_URL = 'www.ptt.cc';
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const READ_FILE = path.join(__dirname, '..', 'read_articles.json');
const DEFAULT_BOARDS = ['MacShop'];
const DEFAULT_TIMEOUT_MS = 15000;

// Hardened defaults — production-grade CORS (no wildcard) and a shared-secret
// gate that protects the side-effectful "scrape PTT and (when configured) send
// Telegram" endpoint from being triggered by anyone on the public internet.
// Both controls are env-driven and degrade to safe defaults:
//
//   - ALLOWED_ORIGIN : exact origin echoed back in Access-Control-Allow-Origin.
//                      Defaults to the production frontend deploy URL when unset.
//   - PTT_API_KEY     : when set, requests MUST send matching `X-PTT-API-Key`
//                      header. When unset, the gate is disabled (open access
//                      is acceptable for a demo deploy, but operators are
//                      strongly encouraged to set both env vars together —
//                      see SECURITY.md).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ptt-alertor-olive.vercel.app';
const PTT_API_KEY = process.env.PTT_API_KEY || '';
// Diagnostic noise (server-side) is suppressed unless DEBUG_PTT is set, to
// keep serverless logs uncluttered.
const DEBUG_PTT = Boolean(process.env.DEBUG_PTT);
function debugError(...args) {
  if (DEBUG_PTT) console.error(...args);
}

function unauthorized(res) {
  return res.status(401).json({ success: false, error: 'unauthorized' });
}

function loadConfig() {
  // Non-secret config (boards / keywords / min_heat / interval_minutes) is read from config.json.
  // Telegram secrets are read ONLY from environment variables — never from config.json
  // (which would risk them being committed). See .env.example.
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

function getHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString();
}

function decodeHtml(text = '') {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x2F;/g, '/');
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

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

function parseArticles(html, board) {
  const entries = html.split('<div class="r-ent">').slice(1);
  return entries.map(entry => {
    const titleMatch = entry.match(/<div class="title">([\s\S]*?)<\/div>/);
    if (!titleMatch) return null;
    const anchorMatch = titleMatch[1].match(/<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!anchorMatch) return null;
    const href = anchorMatch[1].trim();
    const title = stripTags(anchorMatch[2]);
    if (!href || !title) return null;
    const author = stripTags((entry.match(/<div class="author">([\s\S]*?)<\/div>/) || [])[1] || '未知');
    const date = stripTags((entry.match(/<div class="date">([\s\S]*?)<\/div>/) || [])[1] || '');
    const pushes = parsePushCount(stripTags((entry.match(/<div class="nrec">([\s\S]*?)<\/div>/) || [])[1] || ''));
    return { title, href, author, date, pushes, heat: pushes, board, url: `https://www.ptt.cc${href}` };
  }).filter(Boolean);
}

async function getBoardArticles(board, limit = 30) {
  const html = await requestText({
    hostname: PTT_BASE_URL,
    path: `/bbs/${board}/index.html`,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': 'over18=1' },
  });
  return parseArticles(html, board).slice(0, limit);
}

function matchKeywords(title, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const titleLower = title.toLowerCase();
  return keywords.some(k => titleLower.includes(String(k).toLowerCase()));
}

async function checkBoards(config) {
  const boards = config.boards || DEFAULT_BOARDS;
  const keywords = config.keywords || [];
  const minHeat = config.min_heat ?? 1;
  const newArticles = [];
  const keywordMatches = [];

  for (const board of boards) {
    try {
      const articles = await getBoardArticles(board, 30);
      for (const article of articles) {
        if (article.heat >= minHeat) newArticles.push(article);
        if (matchKeywords(article.title, keywords)) keywordMatches.push(article);
      }
    } catch (error) {
      debugError(`[api/tracker] Error checking ${board}: ${error && error.message ? error.message : error}`);
    }
  }
  return { newArticles, keywordMatches };
}

module.exports = async (req, res) => {
  // Strict same-origin (or operator-pinned) CORS — never wildcard on a
  // public endpoint that triggers side-effectful scraping + optional
  // Telegram notifications.
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PTT-API-Key');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Shared-secret gate — when PTT_API_KEY is configured, refuse callers that
  // do not present the matching header. When unset, the gate is open (a
  // demo-deploy posture) — see SECURITY.md for the recommended paired setup.
  if (PTT_API_KEY) {
    const presented = (req.headers && (req.headers['x-ptt-api-key'] || req.headers['X-PTT-API-Key'])) || '';
    if (!presented || presented !== PTT_API_KEY) {
      return unauthorized(res);
    }
  }

  try {
    const config = loadConfig();
    const result = await checkBoards(config);

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
