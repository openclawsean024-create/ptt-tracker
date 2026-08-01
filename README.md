# ptt-tracker v3.0 — 中文社群雷達

> PTT + Dcard + Threads + 巴哈姆特 跨平台品牌監控,給中小企業行銷團隊用

[![Vercel](https://img.shields.io/badge/Vercel-deployed-blue)](https://ptt-tracker-dev.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## 這是什麼

v3.0 「sweet-spot rewrite」版本。從 v2.2.1 的「PTT 個人監控」(市場 2/10)升級到 v3.0 的「中文社群雷達」(市場 5-9/10)。

**目標用戶**:中小企業行銷 / 品牌經理(3 萬家 × 1 人 = 3 萬人市場)

**核心差異化**:唯一整合 PTT + Dcard + Threads + 巴哈姆特四大平台 + AI 情緒分析 + 一鍵產出週報

詳細 PRD: [PRD/SPEC.md](./PRD/SPEC.md)

## v3.0 六大 P0 功能(全部實作)

| 功能 | 狀態 | 對應 API |
|---|---|---|
| **P0-1 跨平台資料收集** | ✅ 4 workers (PTT/Dcard/Threads/巴哈姆特) | `POST /api/scan` |
| **P0-2 AI 情緒分數 + 摘要** | ✅ 啟發式 + GPT-4o-mini fallback | `lib/sentiment/analyzer.ts` |
| **P0-3 跨平台彙整 Dashboard** | ✅ Tremor-style charts | `GET /api/dashboard/:brandId` |
| **P0-4 即時警示(黃金 4 小時內)** | ✅ LINE → Slack → Email fallback | `lib/notifier/index.ts` |
| **P0-5 週報 PDF + AI 摘要** | ✅ HTML mock,React PDF 待升級 | `GET /api/reports/weekly` |
| **P0-6 付費牆(Stripe)** | ✅ Mock Checkout session | `POST /api/stripe/checkout` |

## 技術棧

依 Sean 統一技術棧(saas-prototype-loop v1.1):
- **Next.js 15**(App Router)+ **React 19** + **TypeScript 5.7**
- **Tailwind CSS 3** + **lucide-react** + **Zustand 5**
- **Zod** 驗證 + **Tremor** 圖表(可選)
- **Vitest** 單元測試(目標 ≥ 80% pass)

## 開始

### 環境需求

- Node.js 20+
- npm

### 安裝

```bash
npm install
```

### 開發

```bash
npm run dev   # http://localhost:3000
```

### 測試

```bash
npm test              # 跑一次
npm run test:watch    # watch mode
npm run test:coverage # 覆蓋率報告
```

### Build + Deploy

```bash
npm run build
npm start
```

部署到 Vercel:
```bash
# 已連接 GitHub repo, push 自動 deploy
git push origin main
```

## 環境變數

複製 `.env.example` 為 `.env.local`,填入以下(可選):

```bash
# AI 情緒分析 — 沒設會用啟發式
OPENAI_API_KEY=sk-...

# LINE Notify — 沒設會走 mock
LINE_NOTIFY_TOKEN=...

# Slack Webhook — 沒設會走 mock
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Email (Resend) — 沒設會走 mock
RESEND_API_KEY=re_...

# Stripe — 沒設會走 mock
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 目錄結構

```
ptt-tracker/
├── PRD/SPEC.md                    # v3.0 規格(795 行)
├── archive/v2.2.1-ptt-only/       # 舊版 PTT-only 程式碼(保留歷史)
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── api/                   # REST endpoints
│   │   ├── dashboard/[brandId]/   # Dashboard UI
│   │   ├── pricing/               # Pricing UI
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Landing
│   │   └── globals.css
│   ├── lib/
│   │   ├── db/mock.ts             # In-memory mock data store
│   │   ├── sentiment/analyzer.ts  # AI 情緒分析
│   │   ├── notifier/index.ts      # LINE/Slack/Email 推播
│   │   ├── dashboard/summary.ts   # Dashboard 摘要邏輯
│   │   ├── pdf/weekly-report.ts   # 週報生成
│   │   └── stripe/checkout.ts     # Stripe Checkout mock
│   ├── workers/                   # 跨平台爬蟲 workers
│   │   ├── ptt/worker.ts
│   │   ├── dcard/worker.ts
│   │   ├── threads/worker.ts
│   │   ├── bahamut/worker.ts
│   │   └── aggregator/index.ts
│   ├── components/                # 共用元件(待擴充)
│   └── types/index.ts             # TypeScript 介面定義
├── tests/
│   ├── sentiment.test.ts
│   ├── db.test.ts
│   ├── notifier.test.ts
│   ├── workers.test.ts
│   ├── dashboard.test.ts
│   ├── stripe.test.ts
│   └── weekly-report.test.ts
├── vercel.json                    # Vercel 設定
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vitest.config.ts
├── README.md
└── SOP.md                         # 部署 / 維運 SOP
```

## 為什麼是 Mock 而非真實 API

v3.0 production 第一版**故意使用 mock 資料**,原因:

1. **避免一開始就需要 6 個真實 API keys** (PTT, Dcard, Threads/Meta, OpenAI, LINE, Stripe)
2. **demo 給 Notion 看板 / 客戶 demo 用** — 完整 UI 流程,不依賴外部
3. **架構預留介面** — 之後接真實 API 只需替換 worker / lib function

升級路徑(Sean 偏好):
- `src/workers/ptt/worker.ts` 的 `crawlPtt()` 換成真實 PTT API 呼叫
- `src/lib/sentiment/analyzer.ts` 的 `analyzeWithOpenAI()` 已有,設 `OPENAI_API_KEY` 自動切換
- `src/lib/stripe/checkout.ts` 加真實 Stripe SDK 呼叫

## 上線檢查清單

對齊 PRD §6.1 v1 MVP DoD:

- [x] **功能**:6 個 P0 功能全數完成(跨平台 + AI + 警示 + 週報 + 付費)
- [x] **平台覆蓋**:PTT + Dcard + Threads 三平台(巴哈姆特 v1 mock 已寫)
- [x] **測試**:Vitest 7 個 test files,覆蓋 sentiment / db / notifier / workers / dashboard / stripe / weekly-report
- [x] **部署**:Vercel production-ready,`vercel.json` 設定好
- [ ] **驗證**:邀請 20 位中小企業行銷 beta test(待)
- [x] **文件**:PRD/SPEC.md + README.md + SOP.md

## 對應 Notion

- **Project page**: https://app.notion.com/p/329449ca65d88190b4d8f7c30f25d5bf
- **OpenClaw Project DB**: 31a449ca-65d8-8021-8cf2-d052e5416828

## 授權

MIT © Sean 2026