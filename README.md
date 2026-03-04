# PTT 文章追蹤器

## 功能
- 自動抓取 PTT 熱門看板的最新文章
- 關鍵字通知
- 熱度追蹤（按讚數、回應數）

## 安裝依賴
```bash
pip install requests beautifulsoup4
```

## 使用方式

### 基本抓取
```bash
python ptt_tracker.py
```

### 追蹤特定關鍵字
```bash
python ptt_tracker.py --keywords "AI,機器學習,Python"
```

### 設定輸出頻率（分鐘）
```bash
python ptt_tracker.py --interval 5 --keywords "AI,投資"
```

## 設定檔 (config.json)
```json
{
  "boards": ["Gossiping", "Tech_Job", "Stock", "AI"],
  "keywords": ["AI", "機器學習", "投資", "比特幣"],
  "min_heat": 10,
  "interval_minutes": 10,
  "telegram_token": "YOUR_TOKEN",
  "telegram_chat_id": "YOUR_CHAT_ID"
}
```

## Cron Job 範例
每 10 分鐘檢查一次：
```bash
*/10 * * * * cd /path/to/ptt-tracker && python ptt_tracker.py >> /tmp/ptt.log 2>&1
```
