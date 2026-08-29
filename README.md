# PTT Tracker

用 Node.js 監控 PTT 看板，依關鍵字與推文熱度篩選文章，並透過 Telegram 發送通知。

Live: https://ptt-alertor-olive.vercel.app

## 功能
- 追蹤指定 PTT 看板最新文章
- 依關鍵字比對通知
- 依推文數 (`min_heat`) 篩選熱門文章
- 支援單次執行與 watch mode
- Telegram 憑證從環境變數讀取(`config.json` 不再放 secrets)

## 安裝與設定

1. **複製 env 範本,填入 Telegram 憑證**(這是預設路徑,不是 fallback):
```bash
cp .env.example .env
# 編輯 .env 填入 PTT_TELEGRAM_TOKEN=...
```

2. **複製 non-secret 設定檔**(只放 boards / keywords / min_heat / interval_minutes):
```bash
cp config.example.json config.json
```

3. **本機開發(env pattern)**:`tracker.js` 會讀 `process.env`,用 `set -a; source .env` 一次載入:
```bash
set -a; source .env; set +a
node tracker.js
```

## 使用方式

### 單次檢查
```bash
node tracker.js
```

### 持續監控
```bash
node tracker.js --watch 5
```

## 設定欄位(`config.json`,non-secret only)
```json
{
  "boards": ["MacShop"],
  "keywords": ["Mac mini", "iPhone 15"],
  "min_heat": 1,
  "interval_minutes": 5
}
```

- `boards`: 要追蹤的看板陣列
- `keywords`: 關鍵字陣列,文章標題包含任一關鍵字就通知
- `min_heat`: 最低推文門檻
- `interval_minutes`: watch mode 預設輪詢間隔
- Telegram 憑證(`PTT_TELEGRAM_TOKEN` / `PTT_TELEGRAM_CHAT_ID`)請放在 `.env`,**不要**放進 `config.json`

## 輸出說明
- `🎯 KEYWORD MATCHES`: 關鍵字命中的新文章
- `🔥 Hot Articles`: 超過 `min_heat` 的熱門新文章
- `read_articles.json`: 已看過文章的本地去重紀錄(被 `.gitignore` 排除)

## Tests
```bash
python3 -m pytest -q
```
37 個 smoke test,涵蓋 config loading、keyword matching、heat filter。

## 注意事項
- PTT 連線偶爾會有 `ECONNRESET`,目前已加上自動 retry
- `.gitignore` 已排除 `config.json`、`.env`、`*.pem` — 請用 `.env.example` 當模板
- 完整變動紀錄見 [`CHANGELOG.md`](CHANGELOG.md);威脅模型與 secrets 政策見 [`SECURITY.md`](SECURITY.md);本輪 milestone 規劃見 [`PLAN.md`](PLAN.md)
