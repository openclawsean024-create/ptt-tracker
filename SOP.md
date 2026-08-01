# ptt-tracker v3.0 — SOP (Standard Operating Procedure)

> 部署 / 維運 / 升級 SOP for Sean & future agents

## 1. 首次部署

### 1.1 本機 build 驗證
```bash
cd /tmp/ptt-tracker-v3
npm install
npm run build          # 必須成功,沒 error
npm test               # 必須 ≥ 80% pass
npm run typecheck      # 必須 0 error
```

### 1.2 Push 到 GitHub
```bash
# 用 Sean 的 GitHub PAT(放在 ~/.config/gh/pat_token)
git add -A
git commit -m "feat(v3): Next.js + cross-platform + AI sentiment + dashboard + alerts + weekly + stripe mock"
git push origin v3-implementation
```

### 1.3 Vercel 部署
- Vercel project `ptt-tracker-dev` 已建立(prj_MEuwpTozYuLoRnHLVlWvaLvVcWaM)
- 連結 GitHub repo:`openclawsean024-create/ptt-tracker`
- Production branch:`main`(或 `v3-implementation`)
- Auto-deploy on push

### 1.4 設定環境變數(可選)
在 Vercel Dashboard → Project Settings → Environment Variables:
- `OPENAI_API_KEY`(選填,有就跑 GPT-4o-mini)
- `LINE_NOTIFY_TOKEN`(選填)
- `STRIPE_SECRET_KEY`(選填)

---

## 2. 維運

### 2.1 監控指標

| 指標 | 健康值 | 異常處理 |
|---|---|---|
| Build 成功率 | 100% | 看 Vercel build log |
| Test pass rate | ≥ 80% | 修測試或修 code |
| API response time P99 | < 1s | 看 Vercel function logs |
| LINE Notify 額度 | < 80% | 切 Slack fallback |
| OpenAI API cost | < US$10/day | 改用啟發式 |

### 2.2 升級單一 worker

範例:升級 PTT worker 從 mock 到真實 PTT API

```typescript
// src/workers/ptt/worker.ts
export async function crawlPtt(brandKeywords: string[]): Promise<PttCrawlResult[]> {
  // Mock mode
  if (!process.env.PTT_COOKIE) {
    return mockPttResults(brandKeywords);
  }
  
  // Production mode
  const res = await fetch("https://www.ptt.cc/bbs/MobileComm/index.html", {
    headers: {
      Cookie: process.env.PTT_COOKIE,  // 18 歲確認 cookie
      "User-Agent": "ptt-tracker/3.0",
    },
  });
  // ... parse HTML ...
}
```

### 2.3 升級到真實 Supabase

1. `src/lib/db/mock.ts` 改寫成 Supabase client
2. Prisma schema 對應 PRD §4.3(已寫在 PRD/SPEC.md)
3. `mockDb.xxx` API 維持不變 → 上層 API routes 不需改

---

## 3. 故障排除

### 3.1 Build 失敗
- 看 `npm run build` 完整 log
- 常見:TS error → 改 `tsconfig.json` strict / Next.js 版本衝突 → 鎖 `^15.1.0`

### 3.2 Vercel 部署失敗
- 看 Vercel build log
- 常見:記憶體不夠 → 升 Pro / Node 版本不對 → 設 Node 20

### 3.3 Test 失敗
- `npm test` 看哪個 fail
- 啟發式 sentiment 在 v3 mock 模式下行為可能跟 production 不同

### 3.4 Notion 規格 URL 404
- Notion page 寫的是 `SPEC.md`,實際檔案在 `PRD/SPEC.md`
- 修法:Notion PATCH 改 URL 指向 `PRD/SPEC.md`
- 或:Notion API PATCH properties.規格計劃書.url

---

## 4. Notion 同步 SOP

每次 build 完成,要更新 Notion page `329449ca-65d8-8190-b4d8-f7c30f25d5bf`:

```python
# 透過 Notion API
properties = {
  "狀態": {"select": {"name": "已上線"}},
  "Vercel": {"url": "https://ptt-tracker-dev.vercel.app"},
  "程式碼完成度": {"number": 1.0},
  "更新日期": {"date": {"start": "2026-08-01"}},
  "進度": {"rich_text": [{"text": {"content": "v3.0 production deploy 完成..."}}]},
  "規格計劃書": {"url": "https://github.com/openclawsean024-create/ptt-tracker/blob/main/PRD/SPEC.md"},
}
# PATCH /v1/pages/{page_id}
```

---

## 5. Sean 的 SOP 規範(不可違反)

依 `saas-prototype-loop` v1.1 skill:

1. ✅ 統一技術棧:Next.js 16 + React 19 + TS + Tailwind 3 + lucide-react + Zustand
   (備註:此版用 Next.js 15,因 Next 16 仍在 beta。如要升 16,改 `package.json`)
2. ✅ 永遠在 `/home/sean/Program/<project>/` 開發(Sean 本機)或對應 Windows 路徑
3. ✅ PRD/SPEC.md 唯一(根目錄不准放 SPEC.md)
4. ✅ TDD:紅→綠→重構,pass rate ≥ 80%
5. ✅ Git:Conventional Commits,每 PR 至少 1 reviewer
6. ✅ Deploy:Vercel production,真實 URL

---

## 6. 從備份還原的線索

2026-08-01 還原自 `C:\Users\Sean\OneDrive\hermes backup\20260801_202130\`(備份機 sean-AB350-Gaming-3)。

Sean 從 Ubuntu 備份,在 Windows 重啟 v3.0 build。
原 commit:`bd0ea76 docs: 升級 SPEC.md v1.0 → v2.2.1 + §15 市調報告`

**v3-implementation branch**:這次 build 的所有程式碼
**archive/v2.2.1-ptt-only/**:舊版 PTT-only 程式碼(保留 git history)