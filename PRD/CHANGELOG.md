# ptt-tracker · 變更日誌

> 自動維護：Sean 10-repo-fleet Batch 4D
> 對齊 PRD v3.0.2 等級

---

## v3.0.2 — 2026-09-06（Sean 10-repo-fleet Batch 4D）

v3.0.2 完成於 2026-09-06 by Sean 10-repo-fleet

**升級內容**：
- 📄 撰寫本 `PRD/CHANGELOG.md`（補齊原本只有 root `CHANGELOG.md` 的缺口）
- 🔖 `PRD/SPEC.md` 標頭升級 v3.0 → v3.0.2，更新日期 2026-09-06
- ⚙️ 客製化 `.github/workflows/ci.yml` 為 4 個 Python 風格 job（lint / test / build / security）
- ⚙️ 新增 `ruff.toml`（lint 設定：E/F/W/B 基本規則，per-file-ignore 避開 legacy / tests 雜訊）
- 🐛 修 ruff 唯一真實 bug：`ptt_tracker.py:215` `print(f"…")` 沒有 placeholder（`F541`），改為 `print("…")`

**驗證結果**：
- `python3 -m pytest -q` — **210/210 passed**（round-1+2+3+4+5 全不退步）
- `ruff check .` — **All checks passed**
- `python3 -m compileall .` — exit 0（Python bytecode 全部 compile）
- `node --check tracker.js api/tracker.js app.js sources/*.js` — 7/7 OK（vanilla JS 語法）
- `npm run verify` — `compileall` + `pytest -q` 全綠

**Deploy 目標**：Vercel（既有 `vercel.json` 維持；`vercel.json` 包含 CSP / X-Frame-Options / Referrer-Policy 完整 security headers）

**GHA 客製化細節**（不能用預設 Node template）：
1. **Lint job** — `ruff check .`（不是 `npm run lint`）
2. **Test job** — `actions/setup-python@v5` with python-version: '3.11' + `pip install -r requirements.txt` + `pip install pytest`
3. **Build job** — `python3 -m compileall .` + `node --check *.js` + `sources/*.js`（沒 npm build，但驗證 bytecode + JS 語法作為 build gate）
4. **Security job** — `pip-audit` + `npm audit` advisory（continue-on-error: true）— 沒擋 merge queue
5. 額外加 **secrets-grep** gate（防真實 Telegram bot token / GitHub PAT / AWS access key 進 git）

**已知限制（carry-over）**：
- Vercel auto-deploy 沒接 GitHub integration（DEPLOY_REPORT.md 紀錄 stale Next.js cache 議題；目前 Vercel 手動 deploy 仍 work）
- 6 個 `BLE001` blind exception 在 `ptt_tracker.py` 內（legacy code，符合 v3.0 spec「不擴大 refactor production」）
- 4 個 production `import json / time / os` 保留（即使部分目前未使用 — 給 v3.0 未來 `since`-filter 演算法用）
- `Threads` / `巴哈姆特` source 留 round 4+（無公開 API）

---

## v3.0 — 2026-07-19（sweet-spot rewrite, Sophia 規劃）

**重新定位**：從「PTT 文章追蹤器」升級為「中文社群即時雷達」，涵蓋 PTT + Dcard + Threads + 巴哈姆特 4 平台。
對齊 SPEC v3.0 契約 §1–§15（含 4 個附錄 round-1~round-4 實作紀錄）。

**TAM 重評估**：8.5 萬付費單位 × NT$500/月 × 12 = NT$5.1 億 ARR（vs 原始 PTT-only 紅海 NT$0）
Sweet Spot 體檢 2/10 → 預期 7/10（跨平台 + AI 情緒 + 一鍵轉傳同溫層 三大差異化）

---

## v2.2.1 — 2026-06 之前（原始 PTT-only 監控）

單看板 PTT 爬蟲 + Telegram 推播，1 個 CLI（`ptt_tracker.py`）+ 0 測試。
sweet spot 體檢 2/10，紅海中紅海，已棄守。
