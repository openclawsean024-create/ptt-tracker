# PTT Tracker

用 Node.js 監控 PTT 看板，依關鍵字與推文熱度篩選文章，並透過 Telegram 發送通知。

## 功能
- 追蹤指定 PTT 看板最新文章
- 依關鍵字比對通知
- 依推文數 (`min_heat`) 篩選熱門文章
- 支援單次執行與 watch mode
- 可用環境變數覆蓋 Telegram 憑證

## 安裝與設定

1. 複製設定檔：
```bash
cp config.example.json config.json
```

2. 填入你要追蹤的看板、關鍵字與 Telegram 設定。

也可以不用把 Telegram token 寫進 `config.json`，改用環境變數：

```bash
PTT_TELEGRAM_TOKEN=xxx
PTT_TELEGRAM_CHAT_ID=xxx
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

## 設定欄位

```json
{
  "boards": ["MacShop"],
  "keywords": ["Mac mini", "iPhone 15"],
  "min_heat": 1,
  "interval_minutes": 5,
  "telegram_token": "YOUR_BOT_TOKEN",
  "telegram_chat_id": "YOUR_CHAT_ID"
}
```

- `boards`: 要追蹤的看板陣列
- `keywords`: 關鍵字陣列，文章標題包含任一關鍵字就通知
- `min_heat`: 最低推文門檻
- `interval_minutes`: watch mode 預設輪詢間隔
- `telegram_token` / `telegram_chat_id`: Telegram Bot 發送設定

## 輸出說明
- `🎯 KEYWORD MATCHES`: 關鍵字命中的新文章
- `🔥 Hot Articles`: 超過 `min_heat` 的熱門新文章
- `read_articles.json`: 已看過文章的本地去重紀錄

## 注意事項
- PTT 連線偶爾會有 `ECONNRESET`，目前已加上自動 retry
- `.gitignore` 會忽略 `read_articles.json`，避免把本地狀態一起 commit
- 建議不要把實際 Telegram token 直接推上公開 repo
