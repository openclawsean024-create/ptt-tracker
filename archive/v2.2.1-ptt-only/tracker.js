#!/usr/bin/env node
/**
 * PTT Tracker - Node.js Version
 * Real-time PTT keyword monitoring with Telegram notifications.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const READ_FILE = path.join(__dirname, 'read_articles.json');
const PTT_BASE_URL = 'https://www.ptt.cc';
const DEFAULT_BOARDS = ['Gossiping', 'Tech_Job', 'Stock', 'AI', 'MobileComm', 'Food'];
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 3;

function loadConfig() {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      ...fileConfig,
      telegram_token: process.env.PTT_TELEGRAM_TOKEN || fileConfig.telegram_token,
      telegram_chat_id: process.env.PTT_TELEGRAM_CHAT_ID || fileConfig.telegram_chat_id,
    };
  } catch {
    return {
      telegram_token: process.env.PTT_TELEGRAM_TOKEN,
      telegram_chat_id: process.env.PTT_TELEGRAM_CHAT_ID,
    };
  }
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
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function requestText({ hostname, path: requestPath, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
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

async function getBoardArticles(board, limit = 30, retries = DEFAULT_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const html = await requestText({
        hostname: 'www.ptt.cc',
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
    const pushRaw = stripTags((entry.match(/<div class="nrec">([\s\S]*?)<\/div>/) || [])[1] || '');
    const pushes = parsePushCount(pushRaw);

    articles.push({
      title,
      href,
      author,
      date,
      pushes,
      heat: pushes,
      board,
      url: `${PTT_BASE_URL}${href}`,
    });
  }

  return articles;
}

function matchKeywords(title, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const titleLower = title.toLowerCase();
  return keywords.some(keyword => titleLower.includes(String(keyword).toLowerCase()));
}

async function sendTelegram(message, config) {
  const { telegram_token, telegram_chat_id } = config;
  if (!telegram_token || !telegram_chat_id) {
    console.log('[WARN] Telegram not configured');
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

async function checkBoards(config) {
  const boards = config.boards || DEFAULT_BOARDS;
  const keywords = config.keywords || [];
  const minHeat = config.min_heat ?? 1;
  const readArticles = loadReadArticles();
  const newArticles = [];
  const keywordMatches = [];

  console.log(`\n📋 Checking boards: ${boards.join(', ')}`);

  for (const board of boards) {
    try {
      console.log(`  Checking ${board}...`);
      const articles = await getBoardArticles(board, 30);

      for (const article of articles) {
        const hash = getHash(`${article.board}|${article.title}|${article.date}`);
        if (readArticles[hash]) continue;

        readArticles[hash] = {
          readAt: new Date().toISOString(),
          title: article.title,
          board: article.board,
          url: article.url,
        };

        if (article.heat >= minHeat) {
          newArticles.push(article);
        }

        if (matchKeywords(article.title, keywords)) {
          keywordMatches.push(article);
        }
      }
    } catch (error) {
      console.log(`  ❌ Error checking ${board}: ${error.message}`);
    }
  }

  saveReadArticles(readArticles);
  return { newArticles, keywordMatches };
}

async function run(config) {
  console.log('==================================================');
  console.log('🤖 PTT Tracker Started');
  console.log('==================================================');
  console.log(`📌 Boards: ${(config.boards || DEFAULT_BOARDS).join(', ')}`);
  console.log(`🔑 Keywords: ${(config.keywords || []).join(', ') || 'None'}`);
  console.log(`🔥 Min Heat: ${config.min_heat ?? 1}`);
  console.log('--------------------------------------------------');

  const { newArticles, keywordMatches } = await checkBoards(config);

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

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args[0] === '--watch' || args[0] === '-w') {
    const interval = Number.parseInt(args[1], 10) || config.interval_minutes || 5;
    console.log(`\n👀 Watch mode: checking every ${interval} minutes`);
    console.log('Press Ctrl+C to stop\n');

    async function loop() {
      try {
        await run(config);
      } catch (error) {
        console.error(error);
      }
      console.log(`\n⏳ Sleeping for ${interval} minutes...`);
      setTimeout(loop, interval * 60 * 1000);
    }

    await loop();
    return;
  }

  await run(config);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run, checkBoards, parseArticles, formatArticle };
