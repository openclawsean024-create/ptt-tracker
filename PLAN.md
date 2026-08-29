# Plan: ptt-tracker — round 2 (v3.0 minimal slice: Source abstraction + Dcard connector)

## 為什麼這樣排

V3.0 SPEC 寫的是完整 SaaS(BullMQ/Redis、GPT-4o-mini、多通道、PDF 週報、multi-tenant)。
**SPEC §1-§3 中真正能在一輪內有可驗收產出的,只有「跨平台資料來源」** —— 其餘(P0-2 AI 情緒 / P0-3 dashboard / P0-4 多通道警示 / P0-5 PDF 週報)需要外部帳號(GPT-4o-mini / Meta Business / LINE Notify / Multi-tenant DB)或長期 UX 工作,**留到 round 3+**。

本輪只做 **多來源資料流的最小切片**:
- **抽象化**既有 PTT 實作成 SourceConnector 介面 → 之後 Dcard / Threads / 巴哈姆特 都是同樣 pattern
- **新增 Dcard connector**(Dcard 有乾淨官方 `/api/v2/posts` 不需 auth)
- **整合測試 + 統一 Article schema** 驗證四個來源都吐出同樣形狀
- **文件同步** v3.0 進度

⚠️ **明確不在 round 2**:
- Threads connector(Meta Business API 申請非個人可解決,留到 round 3 或 deferred)
- 巴哈姆特 connector(無官方 API,scrape 風險 + 法規 grey zone,留到 round 3 或 deferred)
- AI 情緒分類(GPT-4o-mini 需 OpenAI 帳號 + cost,留到 round 4)
- Multi-channel LINE/Email 推播(round 4+)
- PDF 週報(round 5+)
- BullMQ/Redis worker infra(round 4+ 才需要)
- Multi-tenant、註冊、付費(direct SPEC §1.5 non-goals 區)

這個切片若成功,round-3 起可以平接其他來源或上層 feature;若失敗,失敗面非常小。

## Milestone 1 — SourceConnector 抽象化 + 既有 PTT 對齊新介面
- **owner**: backend
- **scope**:
  - `sources/`(新目錄):定義 `SourceConnector` 介面(JS side:`SourceConnector.js` 含 `name`、`async fetch({boards, keywords, since})`、`parseArticle(raw)`、`normalize(article)` 這些 hook)
  - 把既有 `tracker.js` 內 PTT-specific 邏輯剝到 `sources/ptt.js` 實作該介面;主程式只剩 `MultiSourceTracker` orchestrator 跑多個 connector
  - 對 `api/tracker.js` 也同樣抽象(PTT serverless 部分)
  - 共用 `config.json` 新增 `sources` 區塊(ex:`"sources": ["ptt"]`),保留 `boards` / `keywords` / `min_heat` 作為共用 top-level
  - **不要**動既有 Telegram / config loader / env-var secrets 路徑(round-1 已硬化)
- **verify**:
  - `python3 -m compileall .` exit 0
  - `node --check tracker.js api/tracker.js` exit 0
  - `node --check sources/*.js`(新增檔)exit 0
  - `python3 -c "import json; d=json.load(open('config.json')); assert 'sources' in d; assert 'boards' in d"` — config schema 仍向下相容
  - **既有 37 個 pytest 全綠(behavior 不退步)**
- **est. LOC**: 80-150(介面 30、ptt 實作 80、orchestrator 30)

## Milestone 2 — Dcard connector(新來源)
- **owner**: backend
- **scope**:
  - `sources/dcard.js`(新)—— 實作 `SourceConnector` 介面
  - 用 Dcard 官方 API:`https://www.dcard.tw/_api/posts?popular=true&limit=30`(無需 auth,公開看板)
  - 注意 Dcard `reactionCount` 對應 PTT `pushes`(熱度)
  - 注意時間欄位 `createdAt`(ISO 8601)
  - 注意 Dcard API 有時候會對非台灣 IP 拒絕(403);要有 user-agent + graceful fallback
  - `config.example.json` 範例加 `"sources": ["ptt", "dcard"]` 與 `"dcard_forums": ["3c", "trending"]`(Dcard 用 forum alias)
  - `.env.example` 若需要新 secrets 補上(例如 `DCARD_USER_AGENT` 用來送自訂 UA);如果不用 secrets 就跳過
- **verify**:
  - `node --check sources/dcard.js` exit 0
  - `python3 -c "from urllib.request import urlopen; ..."` 不做 — 太 fragile(**unit test 用 fixture,不實際打 Dcard API**)
  - **既有 37 pytest 仍綠**
- **est. LOC**: 100-160(connector + normalization + small config sample)

## Milestone 3 — Source abstraction fixture + 統一 Article schema 測試
- **owner**: qa
- **scope**:
  - `tests/_pure_mirrors.py` 擴:加 `normalize_article(source_name, raw)` 純函式,把 PTT / Dcard 各自的 normalize 邏輯 mirror 到 Python(同 round-1 `_pure_mirrors` pattern)
  - `tests/test_source_schema.py`(新):驗證 PTT 與 Dcard normalize 後的 Article 都有同樣 keys:`{title, url, board, author, pushes, timestamp, source}`
  - `tests/test_dcard_connector.py`(新,用 fixture):mock 一段 Dcard `/api/posts` response,丟給 `sources/dcard.js`(用 `--eval` 或 child-process 跑 node)驗證它 parse + normalize 出來 Article shape 對齊 PTT
  - 不動既有 `tests/test_config_loader.py` / `test_keyword_match.py` / `test_heat_filter.py`
  - **不可以動 production code**(若 normalize 邏輯有 bug,**回報給 backend owner**處理)
- **verify**:
  - `python3 -m pytest --collect-only` 收集成功
  - `python3 -m pytest -q` 全綠(包括既有 37 個)
  - `python3 -m compileall .` exit 0
  - `node --check sources/*.js` exit 0
- **est. LOC**: 120-180(4-6 個新 test + extended mirror)

## Milestone 4 — Docs:v3.0 狀態同步
- **owner**: docs
- **scope**:
  - `README.md` 加一段 **「v3.0 狀態」**:目前支援來源 = `[PTT, Dcard]`(`cfg.sources`),Threads / 巴哈姆特 在 roadmap。這段放在「功能」區塊下方,標 **experimental**。
  - `CHANGELOG.md` 新增 `## [Unreleased] — round-2 (v3.0 多來源資料流 MVP)`:
    - Added:`SourceConnector` 介面(`sources/SourceConnector.js`)
    - Added:Dcard connector(`sources/dcard.js`,基於 Dcard 官方 `/api/posts`,不需 auth)
    - Changed:`tracker.js` 與 `api/tracker.js` 內 PTT 特定邏輯移入 `sources/ptt.js`,主程式改成 `MultiSourceTracker`
    - Changed:`config.json` 新增 `sources` 欄位;既有 `boards` / `keywords` / `min_heat` 保持向下相容
  - `PRD/SPEC.md` 附錄 B(round-2 實作紀錄):概述做了什麼、不在 scope 的功能列下、cite commit hashes。**絕對不動 §1-§9**(round-1 round-1 SHA256 pattern 一樣驗證)
  - 不動 `SECURITY.md`(這是 docs scope-only)
- **verify**:
  - README.md 不超過 round-1 末版的 1.5 倍
  - `bash -n` README 內 bash blocks
  - `PRD/SPEC.md` `git diff` 顯示 §1-§15 內容 byte-for-byte 一致(SHA256)
  - 字數 sanity:round-2 CHANGELOG entry ≤ 30 行
- **est. LOC**: 50-80 markdown

## Dependencies

- M3 之後 pytest 全綠,需要 M1+M2 production code 對齊(若 M2 normalize 有 bug,M3 會紅 → 修復迴圈丟給 M1/M2)
- M4 完全獨立最後做,需前 3 件基礎
- M2 partially depends on M1(介面先有,dcard 才有地方實作)

## Out of scope(本輪明確不做)

- ❌ Threads connector(需 Meta Business,無法一人解)
- ❌ 巴哈姆特 connector(無官方 API,scrape 法規 grey zone)
- ❌ AI 情緒分類(需 GPT-4o-mini account + cost)
- ❌ LINE/Email 多通道(Spec §3 P0-4 範圍,需外部 webhook)
- ❌ PDF 週報(SPEC §3 P0-5)
- ❌ BullMQ/Redis worker infra(SPEC §3 提到 P0-1 「每平台獨立 worker」,現規模不需要)
- ❌ Multi-tenant / 註冊 / 付費(SPEC §1.5 non-goals)
- ❌ 修改 SPEC §1-§9(只能 append 附錄)
- ❌ git filter-repo 洗歷史(round-1 已 deferred)
- ❌ git push 到 origin

## Coordination notes

- **檔案歸屬**:
  - `sources/SourceConnector.js` / `sources/ptt.js` / `sources/dcard.js` / `tracker.js` / `api/tracker.js` / `config.json` / `config.example.json` → backend
  - `tests/_pure_mirrors.py` / `tests/test_source_schema.py` / `tests/test_dcard_connector.py` 等新增 → qa
  - `README.md` / `CHANGELOG.md` / `PRD/SPEC.md`(append)→ docs
  - 不動 `.github/workflows/ci.yml` / `package.json` / `requirements.txt` / `SECURITY.md` / frontend / `tracker.js` 的 Telegram path(round-1 已硬化)
- **分支**:`rpb/round-2-v3-mvp`(從 round-1 HEAD `3dfbcbb` 切出,已建)
- **Commit prefix**:
  - `rpb(backend): ...`(本輪 M1, M2 都用)
  - `rpb(qa): ...`(M3)
  - `rpb(docs): ...`(M4)
  - `rpb(orchestrator): ...`(PLAN.md commit + 最終 verify log)
- **每個 milestone 結束**:`rpb-<role>-verify.log` 落在 `.clone/`,然後 commit
- **任何 verify 失敗 → 修復迴圈**,不要擴大 scope

## Why not split across 2 rounds?

理論上 M1、M2 可分開兩輪做,但:
1. M2(Dcard)必須等 M1(介面)落地才能寫
2. M3(測試)會一併 cover 兩者,拆開反而浪費 round budget
3. Round 3 已有更實質的工作:Threads / 巴哈姆特 / 抽象化整合測試等

## 預期 round 結構(全 v3.0)

- **round 2(本輪)**:多來源資料流 MVP(PTT 抽象化 + Dcard)
- **round 3**:Threads connector(if Meta Business access) + 聚合器 + 跨平台熱度榜
- **round 4**:AI 情緒(rule-based 本地先 + LLM 接 entry-point)+ 同溫層轉傳 helper
- **round 5+**:LINE/Slack/Email 多通道 / PDF 週報 / 多 tenant(SPEC §3 後半)

這些只是預期,user 在每輪結束都可以 scope-cut。
