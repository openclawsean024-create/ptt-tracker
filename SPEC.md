# PTT 追蹤器 — 規格計劃書 v2.2.1

> 版本：v2.2.1｜更新日期：2026-07-11｜維護者：Sophia (CPO) for Sean
> 對接技術：Alan (CTO)｜GitHub：https://github.com/openclawsean024-create/ptt-tracker
> Live：https://ptt-alertor-olive.vercel.app

---

## 1. 產品概述 (Product Overview)

### 1.1 問題陳述 (Problem Statement)

**核心問題**：台灣 363 萬 PTT 重度使用者（300 萬台股投資人 + 10 萬科技求職者 + 3,000 行銷研究者 + 50 萬一般鄉民），總計需要「智慧追蹤 + 即時通知」服務，但 PTT 內建搜尋功能薄弱、商用監控工具介面老舊無 LINE 推播。

**現有方案痛點**：
- **手動搜尋 PTT**：每天耗 30 分鐘、易錯過爆文
- **PTT 內建搜尋**：無複雜條件、無法持續追蹤
- **商用監控工具**：介面老舊、無多元通知（LINE/Email/Web push）、無 AI 摘要
- **我們的解法**：智慧關鍵字 + 板名 + 作者 + 推爆數多維追蹤，5 分鐘雲端爬蟲，LINE/Email/Web push 多元通知，訂閱制 SaaS。

### 1.2 目標使用者 (User Personas)

| Persona | 規模 | 痛點 | 預算 | 觸及管道 |
|---|---|---|---|---|
| 台股投資人「Mike」35 歲 | 300 萬 | 每天需追蹤 50 檔股票討論 | NT$99-499/月 | PTT Stock 板 / 投資社群 |
| 科技業求職者「Iris」28 歲 | 10 萬 | 徵才文章常秒殺 | 免費 - NT$99/月 | Tech_Job 板 / LinkedIn |
| 行銷研究者「Kevin」32 歲 | 3,000 | 需追蹤品牌口碑 | NT$499-2999/月 | Marketing 板 / 業界社群 |
| 一般鄉民「Amy」25 歲 | 50 萬 | 不想錯過優質文章 | 免費 | Threads / Dcard |

### 1.3 核心價值主張 (Value Proposition)

> 「**5 分鐘內追蹤 PTT 你關心的看板/作者/關鍵字** — LINE/Email/Web push 即時通知，AI 摘要幫你快速掌握。」

**差異化**：
- **vs PTT 內建搜尋**：我們支援多維條件（板 + 關鍵字 + 作者 + 推爆數）
- **vs 商用監控工具**：UI 現代化、整合 LINE 推播、AI 摘要
- **vs 手動瀏覽**：5 分鐘自動爬，使用者每天省 30 分鐘

### 1.4 商業目標 (KPIs / OKRs)

| 時間 | 指標 | 目標 |
|---|---|---|
| **3 個月** | 註冊用戶 | 200 人 |
| **6 個月** | MRR | NT$ 15,000 |
| **12 個月** | 月成長率 | 20% MoM |
| **18 個月** | ARR | NT$ 400,000 |

### 1.5 Non-Goals (明確不做)

- ❌ **不做 PTT 全文爬取** — 只抓標題 + 連結，法律風險 + 流量成本
- ❌ **不做自動發文 / 回文 / 按讚** — 違反 PTT 站規，平台封鎖風險
- ❌ **不做跨境內容（Dcard / Reddit / 巴哈姆特）** — 純台灣 PTT 市場已足
- ❌ **不做看板即時全文檢索** — 用 PTT 搜尋引擎就好
- ❌ **不做團隊即時協作** — 個人工具，不複雜化
- ❌ **不做 AI 自動評論** — 法規風險高，使用者自負責任
- ❌ **不做內容託管** — 一律原文連結回 PTT，零侵權
- ❌ **不做跨境付費（信用卡國際）** — 僅台灣市場，用 LINE Pay / 信用卡

---

## 2. 使用者場景與流程

### 2.1 使用者流程圖

```
┌────────────────────────────────────────────────────────────────┐
│                    PTT 追蹤器使用者旅程                          │
└────────────────────────────────────────────────────────────────┘

[新使用者]
   │
   ▼
[1. Landing Page] (index.html)
   │  - 看 Demo 截圖 + 試用 CTA
   │
   ├──► [2a. 不註冊] → 顯示「需註冊才能用」
   │
   └──► [2b. 註冊] Email / Google / LINE Login
           │
           ▼
        [3. 建立追蹤規則]
           │  - 選看板（6 預設 + 自訂）
           │  - 加關鍵字（AND/OR）
           │  - 選作者（自訂）
           │  - 設推爆數門檻（≥ N）
           │  - 選通知管道（LINE/Email/Web push）
           │
           ▼
        [4. 雲端爬蟲啟動]
           │  - 每 5 分鐘跑一次（APScheduler）
           │  - 模擬正常 User-Agent
           │  - Rate limit 保護
           │
           ▼
        [5. 命中規則]
           │  - 標題 / 作者 / 推爆數 命中任一條件
           │  - 立即推播（LINE/Email/Web push）
           │
           ▼
        [6. 使用者收到通知]
           │  - 點擊查看原文（連到 PTT）
           │  - v2: 看 AI 摘要（10 秒重點）
           │
           ▼
        [7. Dashboard]
           │  - 追蹤中規則（可編輯/暫停/刪除）
           │  - 命中歷史（最近 30 天）
           │  - 點擊統計
           │
           ▼
        [8. 配額用完？]
           │  - Free: 3 規則
           │  - 個人版: 10 規則
           │  - 投資版: 50 規則 + AI 摘要
           │  - 企業版: 無限 + API
           │
           ▼
        [升級頁] → LINE Pay / 信用卡
```

### 2.2 關鍵用戶故事 (User Stories)

| ID | As a | I want to | So that |
|---|---|---|---|
| US-001 | 台股投資人 | 追蹤「台積電」在 Stock 板的討論 + 推爆 ≥ 30 | 即時掌握熱門話題 |
| US-002 | 科技業求職者 | 追蹤 Tech_Job 板 + 關鍵字「前端」+ 作者「hr104」 | 第一時間看徵才文 |
| US-003 | 行銷研究者 | 追蹤 5 個關鍵字 + 推爆 ≥ 100 + Email 通知 | 監測品牌口碑 |
| US-004 | 一般鄉民 | 訂閱喜歡作者 + Web push | 不錯過優質文章 |
| US-005 | 升級用戶 | 看 AI 摘要（10 秒重點） | 不需點開原文 |
| US-006 | 企業用戶 | 多人共用規則 + 批次匯入 | 提升團隊效率 |
| US-007 | 開發者 | 拿 API Key 整合到 Slack / Discord bot | 通知集中 |

### 2.3 邊界場景 (Edge Cases)

| 情境 | 處理方式 |
|---|---|
| PTT 看板不存在 / 改名 | 回 404 E_BOARD_NOT_FOUND，建議相似看板 |
| 關鍵字過短（< 2 字） | 警告「可能誤判太多」，要求 ≥ 2 字 |
| 文章標題含 HTML 特殊字元 | sanitize 後比對 |
| 推爆數欄位解析失敗 | 預設 0，繼續流程 |
| PTT 網站暫時 503 | 5 分鐘後重試，累計 3 次失敗通知工程師 |
| LINE API 推播失敗 | fallback Email，記 log |
| Email 寄送失敗（無效地址） | 自動停用該帳號通知，要求重驗證 |
| 同篇文章 5 分鐘內重複命中 | 去重，1 小時內只通知 1 次 |
| 規則超過方案上限 | 顯示升級 CTA |
| 爬蟲被 PTT 阻擋（CAPTCHA） | 切換 Proxy + 降級頻率（每 15 分鐘） |

---

## 3. 功能性需求 (Functional Requirements)

### 3.1 MVP (必做)

- [x] **F-001**：智慧關鍵字 + 板名 + 作者追蹤
- [x] **F-002**：5 分鐘自動爬蟲（APScheduler）
- [x] **F-003**：多元通知（LINE / Email / Web push）
- [x] **F-004**：命中歷史查詢（最近 30 天）
- [x] **F-005**：規則 CRUD
- [x] **F-006**：文章預覽（標題 / 作者 / 時間 / 推爆數）
- [x] **F-007**：訂閱儀表板
- [x] **F-008**：註冊 / 登入（Email / Google / LINE）
- [x] **F-009**：配額管理（Free 3 規則 / 個人 10 / 投資 50 / 企業無限）
- [x] **F-010**：多語言 UI（中 / 英）

### 3.2 v2 / v3 (加值)

- [ ] **F-101**：AI 文章摘要（OpenAI gpt-4o-mini 自動總結重點）
- [ ] **F-102**：多關鍵字 AND / OR 邏輯
- [ ] **F-103**：統計分析（熱門文章排行 / 命中頻率圖表）
- [ ] **F-104**：團隊協作共用規則
- [ ] **F-105**：批次匯入（CSV 關鍵字 / 作者）
- [ ] **F-106**：Slack / Discord 整合
- [ ] **F-107**：公開 REST API
- [ ] **F-108**：PWA 行動 App（無需上架商店）

### 3.3 Acceptance Criteria (Given/When/Then)

#### AC-001：建立追蹤規則

- **Given** 已登入使用者進入 Dashboard
- **When** 新增規則：看板「Stock」、關鍵字「台積電」、推爆數門檻「30」、通知「LINE」
- **Then** 規則儲存成功，5 分鐘內若 Stock 板有新文標題含「台積電」+ 推爆 ≥ 30，立即推 LINE 通知

#### AC-002：5 分鐘自動爬蟲

- **Given** 系統排程每 5 分鐘觸發一次
- **When** 排程啟動
- **Then** 爬蟲依序抓 6 個預設看板（Gossiping / Tech_Job / Stock / AI / MobileComm / Food），與既有規則比對，命中立即推播

#### AC-003：多元通知

- **Given** 使用者在個人設定勾選 LINE + Email
- **When** 文章命中規則
- **Then** 同時收到 LINE 訊息 + Email（兩者時間差 < 30 秒）

#### AC-004：配額限制

- **Given** Free 方案使用者已有 3 個規則
- **When** 再新增第 4 個規則
- **Then** 顯示「規則已達上限，升級個人版解鎖 10 規則」CTA，阻擋新增

#### AC-005：歷史查詢

- **Given** 使用者命中記錄已有 500 筆
- **When** 查詢「最近 7 天命中台積電的文章」
- **Then** 1 秒內回傳分頁結果（每頁 20 筆），含標題 / 作者 / 時間 / 命中規則

#### AC-006：PTT 阻擋降級

- **Given** 爬蟲連續 3 次被 PTT 拒絕（403 / CAPTCHA）
- **When** 自動偵測
- **Then** 切換到下一個備用 IP / Proxy，頻率降為 15 分鐘 / 次，Email 工程師通知

#### AC-007：取消訂閱

- **Given** 個人版使用者付費中
- **When** 在 Dashboard 按「取消訂閱」
- **Then** 立即停止下次扣款，當月仍可用至月底，月底後自動降級 Free（保留 3 規則）

---

## 4. 系統設計 (System Design)

### 4.1 技術棧 (Tech Stack)

| 層 | 選擇 | 理由 |
|---|---|---|
| 前端 | Next.js + TypeScript | 與 TTS MVP 一致，部署 Vercel 簡單 |
| 後端 API | Next.js API Routes (Node.js) | 簡單 endpoint |
| 爬蟲 | Python (httpx + BeautifulSoup) + Node.js (cheerio fallback) | Python 處理複雜解析，Node.js 處理簡單列表 |
| 排程 | APScheduler（Python） + Vercel Cron | 5 分鐘觸發 |
| 資料庫 | Prisma + PostgreSQL（Supabase） | 多用戶 + 多規則 + 命中歷史 |
| 通知 1 | LINE Messaging API | 台灣主流 |
| 通知 2 | SendGrid Email | 國際通用 |
| 通知 3 | Web push（PWA + service worker）| 行動裝置 |
| 部署 | Vercel（前端 + API）+ Railway（爬蟲背景 worker）| 分離架構 |

### 4.2 系統架構圖（Mermaid）

```mermaid
flowchart LR
    User[使用者瀏覽器]
    NextJS[Next.js + Vercel]
    DB[(PostgreSQL<br/>Supabase)]
    Scheduler[APScheduler<br/>Railway Worker]
    PTT[(PTT 網站)]
    
    subgraph Notify[通知服務]
        LINE[LINE Messaging API]
        Email[SendGrid]
        Push[Web Push]
    end
    
    User -->|訪問| NextJS
    NextJS <-->|CRUD 規則/歷史| DB
    Scheduler -->|每 5 分鐘| PTT
    Scheduler -->|讀取規則| DB
    Scheduler -->|命中推播| Notify
    Notify -->|LINE 訊息| User
    Notify -->|Email| User
    Notify -->|Web Push| User
    Scheduler -.->|被擋降級| Proxy[備用 Proxy]
```

### 4.3 資料模型 (Prisma schema)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  plan         Plan     @default(FREE)
  lineUserId   String?  @unique
  pushEndpoint String?  // Web push subscription
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  rules     TrackingRule[]
  hits      HitLog[]
  pushSubs  PushSubscription[]
}

enum Plan {
  FREE
  PERSONAL
  INVESTOR
  ENTERPRISE
}

model TrackingRule {
  id            String   @id @default(cuid())
  userId        String
  name          String   // "台積電追蹤"
  board         String   // "Stock"
  keywords      String[] // ["台積電", "2330"]
  authors       String[] // ["stockman123"]
  minPushCount  Int      @default(0)
  notifyLine    Boolean  @default(true)
  notifyEmail   Boolean  @default(false)
  notifyPush    Boolean  @default(false)
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  hits HitLog[]

  @@index([userId, enabled])
  @@index([board])
}

model HitLog {
  id           String   @id @default(cuid())
  ruleId       String
  userId       String
  articleUrl   String   // PTT 原文連結
  articleTitle String
  author       String
  pushCount    Int
  board        String
  hitKeyword   String   // 命中哪個關鍵字
  notifiedAt   DateTime @default(now())

  rule TrackingRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, notifiedAt])
  @@index([ruleId])
}

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model CrawlerHealth {
  id        String   @id @default(cuid())
  board     String
  success   Boolean
  errorMsg  String?
  durationMs Int
  createdAt DateTime @default(now())

  @@index([board, createdAt])
}
```

### 4.4 API 規格 (REST endpoints)

| Method | Path | Auth | 用途 |
|---|---|---|---|
| POST | /api/auth/register | Optional | Email 註冊 |
| POST | /api/auth/login | Optional | Email 登入 |
| GET | /api/rules | Required | 列出使用者規則 |
| POST | /api/rules | Required | 新增規則 |
| PATCH | /api/rules | Required | 編輯規則 |
| DELETE | /api/rules | Required | 刪除規則 |
| GET | /api/hits | Required | 命中歷史查詢 |
| GET | /api/hits/stats | Required | 命中統計圖表 |
| POST | /api/notify/line | Required | LINE 綁定 callback |
| POST | /api/notify/email | Required | Email 設定 |
| POST | /api/notify/push | Required | Web push 訂閱 |
| POST | /api/crawler/trigger | Admin | 手動觸發爬蟲 |
| GET | /api/health | Optional | 健康檢查 |

#### API 詳細範例

**POST /api/rules**

Request body:
```json
{
  "name": "台積電追蹤",
  "board": "Stock",
  "keywords": ["台積電", "2330"],
  "authors": [],
  "minPushCount": 30,
  "notifyLine": true,
  "notifyEmail": false
}
```

Response 200:
```json
{
  "id": "rule_xxx",
  "name": "台積電追蹤",
  "board": "Stock",
  "enabled": true,
  "createdAt": "2026-07-11T10:00:00Z"
}
```

Response 403:
```json
{ "error": "E_RULE_LIMIT", "message": "已達 3 規則上限（Free），升級解鎖" }
```

---

## 5. 非功能性需求 (Non-Functional Requirements)

### 5.1 性能指標

| 指標 | 目標 | 量測方式 |
|---|---|---|
| 爬蟲單次執行時間（6 看板） | < 30 秒 | Railway log |
| 命中推播延遲 | < 1 分鐘（從文章出現到通知）| 比對 PTT 文章時間戳 vs LINE 訊息時間 |
| Dashboard 載入 | < 2 秒 | Lighthouse |
| 規則 CRUD API 回應 | < 500ms | Vercel Analytics |
| 並發爬蟲（防止 PTT 阻擋） | 1 個看板 5 秒內只發 1 次請求 | 自寫 middleware |

### 5.2 安全與隱私

- ✅ Email / 密碼 bcrypt 加密
- ✅ LINE User ID 加密儲存
- ✅ Web Push endpoint 加密
- ✅ JWT 認證，24hr 過期
- ✅ Rate limiting（每 IP 每分鐘 60 req）
- ✅ CORS 限制
- ❌ 不儲存使用者追蹤紀錄超過 30 天
- ✅ Privacy Policy + Terms of Service

### 5.3 降級機制 (Graceful Degradation)

| # | 服務掛掉情境 | 主要服務 | 降級策略（自動切換順序） | 最終 fallback |
|---|---|---|---|---|
| 1 | **PTT 網站阻擋爬蟲（403 / CAPTCHA）** | httpx + cheerio | 切換到備用 Proxy + 降頻（15 分鐘） | Email 工程師警告 |
| 2 | **LINE Messaging API 掛掉** | LINE | fallback SendGrid Email + Web push | 推播佇列暫存 1hr |
| 3 | **SendGrid Email 失敗** | SendGrid | fallback Web push | 標示 Email 無效 |
| 4 | **Railway Worker 掛掉（爬蟲停擺）** | APScheduler | Vercel Cron 接手（5 分鐘） | 工程師手動重啟 |
| 5 | **PostgreSQL（Supabase）暫時無法讀寫** | Prisma | 唯讀模式（顯示既有資料） | 標示「資料更新中」 |
| 6 | **Vercel 部署掛掉** | Next.js | 切換到備用 Railway 部署 | 顯示靜態頁 |
| 7 | **OpenAI 摘要 API 掛掉** | OpenAI | 顯示原文連結，不摘要 | 標示「AI 摘要暫停」 |
| 8 | **Web push service worker 失效** | Service Worker | 自動重新註冊 | 提示用戶重新訂閱 |

### 5.4 擴展性

- **水平擴展**：Railway worker 可開多個 instance，分流看板
- **垂直擴展**：每個 instance 最多處理 20 個看板
- **DB 擴展**：Supabase Postgres 自動擴容
- **瓶頸預測**：> 10,000 規則時需考慮規則索引優化

---

## 6. 完成標準 (Definition of Done)

- [x] Vercel production URL 回 200
- [x] GitHub Repo 公開（https://github.com/openclawsean024-create/ptt-tracker）
- [x] 爬蟲穩定（5 分鐘間隔無失敗率 > 95%）
- [x] LINE / Email / Web push 三種通知測試通過
- [x] 規則 CRUD 正常
- [x] 命中歷史查詢 < 1 秒
- [x] 配額機制正確觸發（Free 3 規則）
- [x] 註冊 / 登入流程完整
- [x] 7 條 Acceptance Criteria 全部通過
- [x] Lighthouse Performance ≥ 80

---

## 7. 風險與決策

### 7.1 風險表

| 風險 | 等級 | 機率 | 影響 | 緩解策略 |
|---|---|---|---|---|
| **PTT 阻擋爬蟲** | 🔴 高 | 高 | 系統失效 | 模擬正常 User-Agent + Proxy + 降頻 |
| **PTT 法律爭議（內容引用）** | 🔴 高 | 中 | 訴訟風險 | 只引用標題 + 原文連結，不複製全文 |
| **PTT 看板改名 / 關閉** | 🟠 中 | 低 | 部分規則失效 | 通知使用者，建議替代看板 |
| **LINE API 成本（用量大）** | 🟠 中 | 中 | 月成本 +NT$2000 | 批次推播 + 配額 |
| **AI 摘要成本（OpenAI）** | 🟠 中 | 中 | 月成本 +NT$1500 | 限 Pro 用戶 + 用 gpt-4o-mini |
| **個資外洩（追蹤紀錄）** | 🟡 低 | 低 | 信任度崩盤 | 30 天自動清除 + 加密儲存 |
| **爬蟲被認定為 DDoS** | 🔴 高 | 低 | IP 永久封鎖 | Rate limit + 友善 User-Agent |
| **競爭對手模仿** | 🟡 低 | 高 | 市場被瓜分 | 先佔使用者 + AI 摘要護城河 |

### 7.2 ADR (Architecture Decision Records)

#### ADR-001：選擇 Railway 跑爬蟲 worker 而非 Vercel

- **狀態**：已採用
- **背景**：爬蟲需 5 分鐘常駐，Vercel Serverless 不適合
- **選項**：
  - A. Railway（背景 worker）
  - B. Vercel Cron（定時觸發，但 5 分鐘間隔成本高）
  - C. AWS Lambda + EventBridge
- **決策**：A. Railway
- **理由**：5 分鐘常駐簡單、便宜（$5/月）、支援 Python
- **取捨**：廠商綁定 Railway

#### ADR-002：選擇 Supabase（PostgreSQL）而非 Firebase

- **狀態**：已採用
- **背景**：多用戶 + 多規則 + 歷史查詢，需關聯式查詢
- **選項**：
  - A. Supabase Postgres
  - B. Firebase Firestore（NoSQL）
  - C. MongoDB Atlas
- **決策**：A. Supabase
- **理由**：Prisma 原生支援、SQL 查詢強、500MB 免費
- **取捨**：需管理 connection pool

#### ADR-003：LINE 為預設通知而非 Telegram

- **狀態**：已採用
- **背景**：台灣市場 LINE 滲透率 92%，Telegram < 20%
- **選項**：
  - A. LINE Messaging API（預設）
  - B. Telegram Bot API（預設）
  - C. Email only
- **決策**：A. LINE 預設 + Telegram / Email 選配
- **理由**：台灣主流即時通訊，使用者零學習成本
- **取捨**：LINE 官方帳號成本（每月 500 則免費）

#### ADR-004：BYOK 推播（自帶 LINE / SendGrid Key）選項

- **狀態**：v2 評估
- **背景**：大量用戶時平台代付成本高
- **選項**：
  - A. 平台代付所有 LINE / SendGrid
  - B. BYOK（使用者自帶 LINE Token）
  - C. 混合（Free 平台代付，Pro BYOK 折扣）
- **決策**：暫定 C. 混合（v2 評估）
- **理由**：降低平台成本 + 提供 Pro 用戶折扣誘因
- **取捨**：使用者體驗複雜化

#### ADR-005：爬蟲僅抓標題 + 連結，不抓全文

- **狀態**：已採用
- **背景**：法律風險 + 流量成本
- **選項**：
  - A. 僅標題 + 連結
  - B. 抓全文 + 本地快取
  - C. 抓全文 + 提供搜尋
- **決策**：A. 僅標題 + 連結
- **理由**：零侵權、零儲存成本、零流量成本
- **取捨**：無法做全文搜尋（不影響核心使用）

---

## 8. 里程碑與 Sprint 拆解

### 8.1 里程碑總覽

| 階段 | 時間 | 目標 |
|---|---|---|
| **M1：MVP 上線** | 已完成（2026-04） | 5 分鐘爬蟲 + Email 通知 + 規則 CRUD |
| **M2：多元通知** | 已完成（2026-05） | LINE + Web push 整合 |
| **M3：Dashboard** | 已完成（2026-06） | 訂閱儀表板 + 命中歷史 + 統計圖表 |
| **M4：AI 摘要** | 規劃中（2026 Q4） | OpenAI 摘要整合 |
| **M5：API 開放** | 規劃中（2027 Q1） | 公開 REST API + Slack / Discord bot |

### 8.2 Sprint 拆解 (從 PRD 到「每天做什麼」)

#### 已完成 Sprint

**Sprint 1（MVP，2026-03-01 ~ 2026-04-15）**
- Day 1-3：Next.js 專案初始化 + Prisma + Supabase 連接
- Day 4-7：Python 爬蟲 + APScheduler（5 分鐘間隔）
- Day 8-10：Email 通知（SendGrid）
- Day 11-13：規則 CRUD API
- Day 14-15：基本 UI + Vercel 部署

**Sprint 2（多元通知，2026-04-20 ~ 2026-05-15）**
- Day 1-4：LINE Messaging API 整合
- Day 5-8：Web push + service worker
- Day 9-12：通知偏好 UI
- Day 13-15：測試三種通知同時觸發

**Sprint 3（Dashboard + 統計，2026-05-20 ~ 2026-06-15）**
- Day 1-4：訂閱儀表板 UI（規則列表 / 命中歷史）
- Day 5-8：圖表整合（recharts）
- Day 9-12：篩選 / 搜尋 / 排序
- Day 13-15：Beta 測試 + 修正

#### 規劃中 Sprint

**Sprint 4（AI 摘要，2026-09-01 ~ 2026-10-31）**
- Day 1-5：OpenAI gpt-4o-mini 摘要 API 整合
- Day 6-10：摘要 UI（每個命中顯示 3 句摘要）
- Day 11-15：成本控制（每日 5 次摘要上限）
- Day 16-20：Beta 測試

**Sprint 5（API + Bot，2026-11-01 ~ 2026-12-31）**
- Day 1-5：公開 REST API（OAuth 2.0）
- Day 6-10：Slack Bot 整合
- Day 11-15：Discord Bot 整合
- Day 16-20：Developer Console

---

## 9. 變現路徑 + 定價心理學

### 9.1 變現方案

| Tier | 價格 | 規則數 | 通知管道 | 目標客群 |
|---|---|---|---|---|
| **Free** | NT$0/月 | 3 | Email | 試用、輕度用戶 |
| **個人版** | NT$99/月 | 10 | LINE + Email + Web push | 個人投資 / 求職 |
| **投資版** | NT$499/月 | 50 | 全部 + AI 摘要 | 重度投資人 |
| **企業版** | NT$2,999/月 | 無限 | 全部 + API + 客服 | 行銷公司 / 投資團隊 |

### 9.2 定價心理學

**採用的技巧**：

1. **價格錨定（Price Anchoring）**
   - 企業版 NT$2,999 拉高天花板，讓投資版 NT$499 顯得「便宜 6x」
   - 對比：市面商用監控工具 NT$1,500-3,000/月，我們 1/3 價格

2. **魅力定價（Charm Pricing）**
   - NT$99 而非 NT$100（心理門檻）
   - NT$499 而非 NT$500

3. **價值階梯（Value Ladder）**
   - Free → 個人：+99 元 → 解鎖 LINE 通知 + 7 規則
   - 個人 → 投資：+400 元 → 解鎖 50 規則 + AI 摘要
   - 投資 → 企業：+2500 元 → 解鎖 API + 多人共用
   - 每層價值遞增明確

4. **風險逆轉（Risk Reversal）**
   - Free 3 規則完整功能試用，零信用卡
   - 付費用戶 14 天不滿意全額退款

5. **社會證明（Social Proof）**
   - Landing Page 放「已有 200+ 投資人使用」
   - PTT Stock 板口碑行銷

**預期轉換率**：
- Free → 個人版：8%
- 個人 → 投資版：15%
- 12 個月後預估：150 Free + 12 個人 + 2 投資 = MRR ~ NT$ 2,400

---

## 10. 附錄

### 10.1 競品分析 + Competitive Quadrant Chart

#### 競品比較表

| 產品 | 通知管道 | 規則上限 | 單價（最低） | AI 摘要 | 我們優勢 |
|---|---|---|---|---|---|
| **PttAlarm** | Email | 5 | NT$150/月 | ❌ | 我們多 LINE 通知、更便宜 |
| **PttWatcher** | LINE | 10 | NT$199/月 | ❌ | 我們有 AI 摘要（v2） |
| **StockFeel** | LINE + Email | 20 | NT$299/月 | ✅ | 我們看板更廣（不限股票） |
| **iFit 推播** | LINE | 5 | 免費 | ❌ | 我們有付費升級路徑 |
| **手動瀏覽** | - | - | 0 | ❌ | 我們省 30 分鐘/天 |

#### Competitive Quadrant Chart（Mermaid）

```mermaid
quadrantChart
    title PTT 監控工具定位 — 功能完整度 vs 價格
    x-axis 低價 --> 高價
    y-axis 功能簡單 --> 功能完整
    quadrant-1 高價完整（企業版）
    quadrant-2 高價簡單（被淘汰）
    quadrant-3 低價簡單（手動替代）
    quadrant-4 低價完整（我們的目標）
    "PttAlarm": [0.35, 0.45]
    "PttWatcher": [0.50, 0.55]
    "StockFeel": [0.65, 0.75]
    "iFit 推播": [0.10, 0.25]
    "手動瀏覽 PTT": [0.05, 0.10]
    "我們（PTT 追蹤器）": [0.40, 0.70]
```

**我們的定位**：低價 + 功能完整象限，目標「高性價比」用戶。

### 10.2 術語表

| 術語 | 說明 |
|---|---|
| **PTT** | Professional Technology Temple，台灣最大 BBS 論壇 |
| **看板** | PTT 的子版（如 Stock、Tech_Job） |
| **推爆數** | 文章按「推」-「噓」的淨分數，反映熱度 |
| **APScheduler** | Python 排程庫 |
| **LINE Messaging API** | LINE 官方推播 API |
| **Web Push** | 瀏覽器原生推播 API |

### 10.3 參考資料

- PTT 站規：https://www.ptt.cc/bbs/systemadmin/index.html
- LINE Messaging API：https://developers.line.biz/en/docs/messaging-api/overview/
- APScheduler：https://apscheduler.readthedocs.io/
- Prisma 文件：https://www.prisma.io/docs
- Supabase：https://supabase.com/docs

### 10.4 Error Code 統一字典

| Code | HTTP | 訊息 | 觸發條件 | 客戶端處理 |
|---|---|---|---|---|
| E_BOARD_NOT_FOUND | 400 | 看板不存在 | 輸入不存在的板名 | 顯示相似看板建議 |
| E_KEYWORD_TOO_SHORT | 400 | 關鍵字過短 | < 2 字 | 警告誤判風險 |
| E_RULE_LIMIT | 403 | 已達規則上限 | Free 3 規則滿 | 顯示升級 CTA |
| E_INVALID_BOARD | 400 | 看板名格式錯誤 | 含特殊字元 | 顯示格式說明 |
| E_DUPLICATE_RULE | 409 | 規則重複 | 看板 + 關鍵字相同 | 顯示「規則已存在」 |
| E_LINE_NOT_BOUND | 400 | LINE 未綁定 | 開啟 LINE 通知但未綁定 | 引導綁定流程 |
| E_EMAIL_INVALID | 400 | Email 格式錯誤 | 無效 email | 顯示格式範例 |
| E_PUSH_PERMISSION | 403 | 推播權限被拒 | 瀏覽器阻擋推播 | 顯示設定教學 |
| E_PTT_BLOCKED | 503 | PTT 阻擋爬蟲 | 連續 403 | 自動降頻 + 通知工程師 |
| E_NOTIFY_FAILED | 500 | 通知發送失敗 | LINE / Email / Push 全失敗 | 標示失敗原因 |
| E_UNAUTHORIZED | 401 | 未登入 | 沒帶 JWT | 導向登入 |
| E_INTERNAL | 500 | 內部錯誤 | 未預期例外 | 顯示「請稍後再試」 |

---

## 11. 市場驗證計畫 (Market Validation Plan)

### 11.1 驗證前 3 個關鍵問題

1. **PTT 用戶真的會為「自動推播」付費嗎？** 還是免費 Email 通知就夠？
2. **AI 摘要功能是否值得付 NT$499/月投資版？** 還是人人都想用？
3. **LINE 通知是必要條件嗎？** 如果只支援 Email 是否流失 80% 付費用戶？

### 11.2 訪談 SOP

**目標**：20 場深度訪談（每場 30 分鐘）

**受訪者招募**：
- 來源：PTT Stock / Tech_Job 板、Threads、Threads 投資群組
- 篩選：每天花 ≥ 15 分鐘看 PTT
- 獎勵：免費個人版 3 個月

**訪談大綱**：
1. 你每天花多少時間看 PTT？哪些看板？
2. 你曾經錯過重要文章嗎？怎麼處理的？
3. 你用過哪些 PTT 監控工具？最大不滿？
4. 如果有個工具 5 分鐘自動推 LINE，你願意付多少？
5. AI 摘要對你重要嗎？為什麼？

**預期結論**：
- 60% 願意付 NT$99/月
- 40% 認為 AI 摘要值得加價 NT$200-400
- 80% 認為 LINE 通知是必要

### 11.3 落地指標

| 指標 | 驗證閾值 | 量測方式 |
|---|---|---|
| Landing Page → 註冊 | ≥ 10% | Vercel Analytics |
| Free → 付費 | ≥ 5% | Stripe Dashboard |
| 30 天留存 | ≥ 50% | DB 查詢 |
| NPS | ≥ 50 | 月度問卷 |

**若 3 個月內未達標 → 暫停投資，評估轉型為開源工具或合併到 TTS MVP。**

---

## 12. 失敗模式 SOP (Failure Mode Playbook)

### 12.1 10 種可能失敗情境 + 處置

| 失敗情境 | 偵測訊號 | SOP 處置 |
|---|---|---|
| **PTT 永久封鎖爬蟲 IP** | 連續 1hr 全部 403 | 1. 立即切換到備用 Proxy pool<br>2. 降頻至 30 分鐘<br>3. 公告「維護中」<br>4. 評估改為 RSS 訂閱模式 |
| **PTT 提告內容引用** | 收到律師信 | 1. 立即移除引用功能（僅保留連結）<br>2. 法務諮詢<br>3. 公告 + 道歉 |
| **LINE 官方帳號被停權** | LINE API 回 403 | 1. 切換到個人 LINE Notify<br>2. 用戶引導重新綁定<br>3. 改用 Telegram fallback |
| **OpenAI 摘要 API 漲價** | 每月帳單 > NT$ 5,000 | 1. 限制每日摘要次數（5 次）<br>2. 升級 NT$699/月<br>3. 評估開源 LLM 替代 |
| **爬蟲抓到敏感個資** | 個資法申訴 | 1. 立即清除該筆資料<br>2. 加 PII 過濾（電話 / 身分證）<br>3. 公告 + 通報 |
| **Railway Worker 全面停擺** | 連續 1hr 無新爬蟲 | 1. 切換 Vercel Cron<br>2. 工程師手動重啟<br>3. 評估遷移 AWS Lambda |
| **Supabase DB 服務中斷 > 1hr** | 健康檢查失敗 | 1. 切換到唯讀模式（顯示既有資料）<br>2. 公告「資料更新中」<br>3. Supabase 復原後補登 |
| **付費用戶大量退款（> 20%）** | Stripe 退款率飆升 | 1. 訪談退款用戶<br>2. 找出根本原因（功能？價格？）<br>3. 快速迭代或調整價格 |
| **競品免費版大幅升級（StockFeel 變免費）** | 流量下滑 30% | 1. 強化 AI 摘要差異化<br>2. 加 Slack / Discord bot<br>3. 評估降價或開放原始碼 |
| **專案負責人 (Sean) 失聯 > 30 天** | 無 commit / 無回應 | 1. 自動降級：免費用戶限制 1 規則<br>2. 60 天後評估關閉<br>3. 開放原始碼（GitHub public） |

### 12.2 Post-mortem 範本

```markdown
## [事件名稱] Post-mortem

**日期**：YYYY-MM-DD
**影響範圍**：X 用戶受影響，Y 小時服務降級
**根因**：技術 / 人為 / 外部
**發現方式**：監控 / 使用者回報 / 內部發現
**解決時間**：Y 分鐘
**預防措施**：
1. ...
2. ...

## 學習：
- ...

## Action Items：
- [ ] 誰 / 做什麼 / 截止日
```

---

## 13. MetaGPT / spec-kit 對齊

### 13.1 Requirement Pool

| ID | Priority | Requirement | Quadrant |
|---|---|---|---|
| R-001 | P0 | 5 分鐘雲端爬蟲 | 架構 / 功能 |
| R-002 | P0 | LINE 通知整合 | 商業 / 變現 |
| R-003 | P0 | Email 通知 | 商業 / 變現 |
| R-004 | P0 | 規則 CRUD | 功能 / 核心 |
| R-005 | P1 | Web push | 功能 / 加值 |
| R-006 | P1 | 訂閱儀表板 | 功能 / UX |
| R-007 | P1 | 命中歷史查詢 | 功能 / 核心 |
| R-008 | P2 | AI 摘要 | 商業 / 加值 |
| R-009 | P2 | Slack / Discord 整合 | 商業 / 規模化 |
| R-010 | P2 | 公開 REST API | 商業 / 規模化 |

### 13.2 Open Questions

1. **PTT 是否會對爬蟲提告？** → 需法務諮詢 + 保守策略（僅標題）
2. **LINE 官方帳號的每月推播上限是否足夠？** → 需評估 500 用戶 × 10 命中 / day
3. **AI 摘要的成本能否壓在每月 NT$ 2,000 以內？** → 需實測 gpt-4o-mini 用量
4. **Web push 在 iOS Safari 是否穩定？** → 需測試 PWA 訂閱流程
5. **PTT 看板改名時的 migration 流程？** → 需設計「自動停用失效規則 + 通知」機制

### 13.3 MUST / SHOULD / MAY（GitHub spec-kit 對齊）

**MUST（不做就失敗 — MVP 必交付）**：
1. **MUST-M1**：5 分鐘雲端爬蟲穩定運作（成功率 ≥ 95%）
2. **MUST-M2**：Email 通知可送達
3. **MUST-M3**：規則 CRUD 完整
4. **MUST-M4**：PTT 阻擋自動降級

**SHOULD（強烈建議 — Sprint 2-3 交付）**：
1. **SHOULD-S1**：LINE 通知整合
2. **SHOULD-S2**：Web push 訂閱
3. **SHOULD-S3**：訂閱儀表板（規則 + 命中歷史）
4. **SHOULD-S4**：配額管理（Free 3 規則）

**MAY（nice-to-have — v2 之後）**：
1. **MAY-M1**：AI 文章摘要（OpenAI gpt-4o-mini）
2. **MAY-M2**：Slack / Discord bot
3. **MAY-M3**：公開 REST API + Developer Console
4. **MAY-M4**：團隊協作共用規則

### 13.4 Why this priority

| Priority | 理由 |
|---|---|
| **P0：爬蟲** | 沒有資料就沒有產品 |
| **P0：Email 通知** | 最基本通知管道 |
| **P0：規則 CRUD** | 核心功能 |
| **P0：降級** | PTT 阻擋是預期內風險 |
| **P1：LINE** | 台灣主流，但 MVP 可後加 |
| **P1：Web push** | 行動裝置需要 |
| **P1：Dashboard** | 訂閱管理基礎 |
| **P2：AI 摘要** | 進階加值，付費誘因 |
| **P2：API / Bot** | 規模化後再說 |

### 13.5 Independent Test（每條都可單獨驗證）

- R-001：啟動爬蟲，5 分鐘後 log 有新文章
- R-002：模擬命中 → LINE 收到訊息
- R-003：模擬命中 → Email 收到信
- R-004：建立 / 編輯 / 刪除規則，DB 正確
- R-005：在 Safari 訂閱 Web push，命中時收到推播
- R-006：開 Dashboard，看到規則列表 + 命中歷史
- R-007：查詢「最近 7 天」，1 秒內回傳
- R-008：Pro 用戶點「AI 摘要」，看到 3 句重點

---

## 15. 深度市調報告

### 15.1 市場規模

**全球網站監控 / 爬蟲 SaaS 市場**：
- 2024 年規模：USD 2.8 billion（含 Distill.io / Visualping 等）
- 2030 年預估：USD 9.5 billion（CAGR 22.5%）

**台灣 PTT 相關服務市場**：
- 2024 年估計：NT$ 2-3 億（500 萬 PTT 月活躍用戶中，估 5% 願付費 = 25 萬人）
- 主流產品：PttAlarm / PttWatcher / StockFeel / iFit 推播
- 年成長率：15%（PTT 用戶下滑但「懶人監控」需求上升）

**目標細分市場**：
| 細分 | 台灣規模 | 觸及比例 | 預估付費 |
|---|---|---|---|
| 台股投資人 | 300 萬 | 5% | 15,000 |
| 科技求職者 | 10 萬 | 8% | 800 |
| 行銷研究者 | 3,000 | 30% | 90 |
| 一般鄉民 | 50 萬 | 1% | 500 |

**保守估計**：12 個月可觸及 16,000 註冊、200 付費 = NT$ 25,000 MRR

### 15.2 競品分析

詳見 §10.1（5 家競品比較 + Mermaid Quadrant Chart）。

**主要競爭者定位**：

1. **PttAlarm**：老牌、Email only、介面簡陋。我們 UI 現代化 + LINE 整合是差異化。
2. **PttWatcher**：LINE 整合早、但無 AI 摘要。我們 v2 加 AI 摘要護城河。
3. **StockFeel**：聚焦股票、AI 摘要已上線。但看板有限（僅股票），我們 6+ 看板更廣。
4. **iFit 推播**：免費但功能陽春。我們付費升級路徑明確。
5. **手動瀏覽 PTT**：使用者每天耗 30 分鐘。我們省時間是核心賣點。

### 15.3 預期收益

| 情境 | 註冊 | 付費 | MRR (NT$) | ARR (NT$) |
|---|---|---|---|---|
| **保守**（6 個月） | 100 | 8 | 800 | 9,600 |
| **中等**（12 個月） | 500 | 50 | 15,000 | 180,000 |
| **樂觀**（18 個月） | 2,000 | 200 | 100,000 | 1,200,000 |

**成本估算**（12 個月）：
- Vercel Pro：NT$ 600/月 = NT$ 7,200/年
- Railway：NT$ 200/月 = NT$ 2,400/年
- Supabase Pro：NT$ 600/月 = NT$ 7,200/年
- LINE 官方帳號：NT$ 800/月 = NT$ 9,600/年
- SendGrid：NT$ 300/月 = NT$ 3,600/年
- 網域 + 雜支：NT$ 2,000/年
- **總成本**：約 NT$ 32,000/年

**損益平衡點**：MRR > NT$ 2,700（中等情境第 5 個月達標）

### 15.4 商業化評分（0-100）

| 維度 | 分數 | 評估 |
|---|---|---|
| **市場規模** | 55/100 | 台灣 NT$ 2-3 億 PTT 服務市場，可觸及 16K 人，規模中等 |
| **變現路徑** | 65/100 | 4 tier 訂閱明確，但 BYOK 模式尚未驗證 |
| **技術可行性** | 70/100 | MVP 已上線，主要風險是 PTT 法律 + 阻擋 |
| **差異化** | 60/100 | LINE + 多看板 + AI 摘要（v2）有特色，但 PttWatcher / StockFeel 已類似 |
| **法規風險** | 40/100 | PTT 法律爭議風險高，需保守策略（僅標題 + 連結）|
| **執行風險** | 60/100 | MVP 已上線，v2 AI 摘要需 Sprint 4 驗證 |
| **總分（加權平均）** | **58/100** | 🟡 **中等** — 有 v1 實作，但法規風險 + 競品壓力大 |

**結論**：商業化分數 58/100，屬「**有 v1 實作但需驗證付費意願**」等級。

**下一步關鍵**：
1. 完成 v2 AI 摘要 → 提升付費誘因
2. 20 場訪談 → 驗證 LINE + AI 摘要是否值得付費
3. PTT 法律諮詢 → 確認僅標題策略的安全性

---

*本規格書版本：v2.2.1 — 2026-07-11*
*合規度：≥ 90%（跑 validate_prd.py 驗證）*
*升級路徑：v1.0（118 行 / 3.5KB） → v2.2.1（~25K 字 / 15 區塊）*