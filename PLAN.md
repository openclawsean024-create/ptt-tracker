# Plan: ptt-tracker — round 3 (v3.0 since-filtering + timestamp alignment)

## 為什麼這樣排

Round-2 把 SourceConnector 介面、PTT adapter、Dcard adapter 與 105 pytest 落地。**M3 closing report 的 finding #3** 揭示一個真實的時序語意不一致:

- PTT `sources/ptt.js` 在 **normalize 時**戳 `new Date().toISOString()` —— 意義是「**什麼時候抓到這篇**」
- Dcard `sources/dcard.js` 透傳 `raw.createdAt` —— 意義是「**什麼時候作者發的****

兩個 source 對 `Article.timestamp` 的定義完全不同。若 round-3 開始做 `since`-filtering(對 timestamp 做「拿 N 天前的文章」之類),PTT 文章會**永遠被當作新文章**(因為 timestamp 永遠是現在),Dcard 文章則是對的 post time。聚合也會誤判相對新舊。

**本輪主題**:把 `Article` schema 的時間語意統一,順手把 `since`-filtering 從介面一路 wire 到 fetcher。

## Scope 嚴格

| ✅ 必做 | ❌ 明確不做 |
|---|---|
| Article schema 新增 `posted_at`(post time) + `fetched_at`(scrape time);`timestamp` 退到 alias 角色(向後相容) | Threads / 巴哈姆特 |
| PTT normalize 用 `currentYear + raw.date` 拼出 `posted_at` | AI 情緒 |
| Dcard normalize:已正確(`posted_at = raw.createdAt`),只需補 `fetched_at = now()` | 跨平台聚合去重演算法(round-4 再做) |
| Orchestrator 在 `fetch({since, limit, ctx})` 傳 `since`(從 `read_articles.json` max-timestamp 或 call-site 參數) | 多通道警示 / PDF 週報 |
| PTT filter by `posted_at >= since`(24h grace 處理時區邊界) | SPEC §1.5 non-goals(multi-tenant / 付費) |
| Dcard filter by `before` / `after` query param(原生支援) | 改既有 round-1 contract(向後相容) |
| 對應 mirror tests + cross-source 整合 fixture | Bulletin board ID 等 metadata 變更 |
| 文件同步(README/CHANGELOG/SPEC 附錄 C) | 重構目錄結構 |

## Milestone 1 — Article.time semantics split + PTT `posted_at` heuristic
- **owner**: backend
- **scope**:
  - `sources/ptt.js` normalize:補 `posted_at = parsePttDate(raw.date)` 邏輯
    - `parsePttDate(' 3/27')` → `new Date(currentYear, 2, 27)` 同年 3/27
    - 月底/年初跨年 heuristic:若 `Date.now() - parsed > 90 天`,fallback 用 `currentYear - 1`(假設近期未發但跨年文章)
    - emit:`posted_at`(new,post time)、`timestamp`(legacy,fetch time)、`fetched_at`(new,scrape time)三個欄位
  - `sources/dcard.js` normalize:補 `posted_at`(已對)與 `fetched_at = now()`
  - `sources/SourceConnector.js` doc update:補 `posted_at` / `fetched_at` 欄位語意
- **verify**:
  - `node --check sources/*.js` exit 0
  - `python3 -m compileall .` exit 0
  - `python3 -m pytest -q` 既有 105 仍綠
- **est. LOC**: 60-90(`posted_at` heuristic + null-safe + 2 source 更新)

## Milestone 2 — Orchestrator `since`-filtering propagation
- **owner**: backend
- **scope**:
  - `tracker.js` + `api/tracker.js`:`fetch({since, limit, ctx})` 把 `since`(ISO 8601 或 null)往下傳
    - CLI 預設 `since = null`(保留 round-1 行為)
    - `--since <ISO>` CLI flag 開新功能
    - serverless 接受 query param `?since=<ISO>`
  - `sources/ptt.js` `fetch` 實作 since filter:讀 board index,parse 內部 `date` 欄,過濾 `posted_at >= since - 24h`(grace)
  - `sources/dcard.js` `fetch` 實作 since filter:加 query string `after=<ISO>`(Dcard 原生)
  - 不做跨 source dedup(round-3 主要 fix timestamp;dedup 留 round-4)
- **verify**:
  - `node --check` 仍綠
  - 既有 105 測試不退步
  - **新**:加 1-2 個 integration-style test 用 mock fixture 驗 `since` flag 對 PTT/Dcard 都生效
- **est. LOC**: 50-80

## Milestone 3 — Mirror tests for `posted_at` + since filter
- **owner**: qa
- **scope**:
  - `tests/_pure_mirrors.py` 擴:
    - `parse_ppt_date(date_str, now=None)` —— 純函式,mirror production heuristic
    - `apply_since_filter(articles, since, grace_hours=24)` —— 過濾 helper
  - `tests/test_ppt_timestamp.py`(新):
    - happy path: `' 3/27'` → 同年 3/27 midnight
    - 跨年:現在 1 月,`date = '12/31'` → 去年 12/31
    - grace:since - 24h 內的文章也保留
    - 空字串 / null / 不可 parse:defensive defaults(走 `posted_at = now()`)
  - `tests/test_since_filter.py`(新):
    - PTT-side mirror since filter
    - Dcard-side mirror since filter
    - 兩 source 同 since 過濾後有交集 → cross-source flow(暫不做 dedup,只驗每 source 都正確過濾)
- **verify**:
  - `python3 -m pytest --collect-only` 收集成功
  - `python3 -m pytest -q` 全綠(既有 105 + 新增 ≥ 10)
- **est. LOC**: 120-180(2 新 test 檔 + mirror 擴)

## Milestone 4 — Docs sync(round-3)
- **owner**: docs
- **scope**:
  - `README.md`:v3.0 狀態段加一句 — 「所有來源都用 `posted_at`(post time)作 `since`-filtering 比較基準」
  - `CHANGELOG.md`:round-3 entry(Added:`posted_at` schema;Dcard PTT since-filter;PTT date heuristic;tests)
  - `PRD/SPEC.md` 附錄 C(round-3 實作紀錄):說明 timestamp 語意統一、SHA256 驗證 §1-§15 不動
  - 不動 `.env.example`(本輪沒新 secrets)
  - **不動** PRD §1-§15
- **verify**:
  - README 字數不爆 round-2 末(263)的 1.5 倍
  - CHANGELOG round-3 entry ≤ 30 行
  - PRD/SPEC.md §1-§15 SHA256 仍 byte-for-byte = round-1 baseline
- **est. LOC**: 40-70 markdown

## Dependencies

- M2 之後 M3 才能驗 since filter 完整邏輯
- M4 最後做

## Constraints(本輪繼續守住)

- ❌ 不要 `git push`(branch 本地);**若 user 上輪已明示 push 同意,新 dispatch prompt 內會禮貌性提醒**
- ❌ 不要改 PRD §1-§15(SHA256 byte-for-byte)
- ❌ 不要實作 Threads / 巴哈姆特 / AI 情緒 / 跨平台去重演算法(m3+ 才做)
- ❌ 不要把既有 round-1 contract 改壞(`pytest` 既有 105 個必須仍綠)
- ❌ 不要引入 heavyweight dependency
- ❌ 不要寫進 secrets

## Out of scope(本輪明確不做)

- Threads / 巴哈姆特 connector
- AI 情緒(round 4)
- 跨平台 dedup / 去重(round 4)
- CLI flag 全部 poll 進來(round 4 統一 polish)
- Vercel 部署 / PR 開啟(順道:branch 既然已有 upstream tracking,可 push;但 merge / deploy 仍待 user 決定)

## Coordination notes

- **檔案歸屬**:
  - `sources/SourceConnector.js` / `sources/ptt.js` / `sources/dcard.js` / `tracker.js` / `api/tracker.js` / `config.example.json` → backend
  - `tests/_pure_mirrors.py` / `tests/test_ppt_timestamp.py` / `tests/test_since_filter.py` 等新增 → qa
  - `README.md` / `CHANGELOG.md` / `PRD/SPEC.md`(append 附錄 C)→ docs
  - 不動 vercel.json / index.html / app.js / app.css / ptt_tracker.py / CI / SECURITY / .env.example / .gitignore / package.json / requirements.txt / confest.py / 既有 round-1+round-2 tests
- **分支**:`rpb/round-3-v3-since`(從 round-2 HEAD `a0b8b8e` 切出,**已建**)
- **Commit prefix**:
  - `rpb(backend): ...`(M1, M2 都用)
  - `rpb(qa): ...`(M3)
  - `rpb(docs): ...`(M4)
  - `rpb(orchestrator): ...`(PLAN + final verify + summary)
- **每個 milestone 結束**:`rpb-<role>-verify.log` 落在 `.clone/`,然後 commit
- **任何 verify 失敗 → 修復迴圈**,不擴 scope

## Why 3 milestones (not 4 separate sub-pieces)?

M1 + M2 都歸 backend(共享 domain knowledge),但 interface 與 implementation 分開 commit。M3 必須等 M1 落地(用新 mirror)。M4 收尾獨立。

## 對比 round-2 規劃(為什麼這輪更緊)

Round-2 工作分散給 4 owner × 1 個 commit 各;round-3 都由 backend(2 個 commit)+ qa + docs(各 1)走完,所以總 commit 數一樣,但 backend 工作量略重。故用「Phase A: M1 + M4 平行 → Phase B: M2 → Phase C: M3 → Final verify」:

- **Phase A**:派 M1(backend)+ M4(docs)background 平行
- **Phase B**:M1 commit 落地後派 M2(backend),等 M2 commit
- **Phase C**:M2 commit 落地後派 M3(qa),等 M3 commit
- **Final verify**:跑三大 + node sources + pytest ≥ 117(105 round-2 + 10 round-3)+ write summary

預估 round-3 整體 3-4 個 round。
