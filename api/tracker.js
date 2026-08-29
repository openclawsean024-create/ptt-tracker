const https = require('https');
const fs = require('fs');
const path = require('path');

const PTT_BASE_URL = 'www.ptt.cc';
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const READ_FILE = path.join(__dirname, '..', 'read_articles.json');
const DEFAULT_BOARDS = ['MacShop'];
const DEFAULT_TIMEOUT_MS = 15000;

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
      console.error(`Error checking ${board}: ${error.message}`);
    }
  }
  return { newArticles, keywordMatches };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
