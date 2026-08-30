# Plan: ptt-tracker — round 4 (v3.0 cross-source aggregation: dedup + heat ranking)

## 為什麼這樣排

Round-3 把 `Article` schema 拆 `posted_at` / `fetched_at` + 把 `since`-filtering 從 orchestrator wire 到 connector。**178 pytest** 全綠,但目前的 `MultiSourceTracker.checkSources()` 只是「每 source 各自 fetch + 合併到一個 list」,**沒去重、沒跨來源熱度排序**。

當 PTT 與 Dcard 都有「同品牌 / 同主題」(e.g. PTT `MacShop` 與 Dcard `3C` 的 iPhone 討論),結果 list 會出現好幾個該合併的項目。本輪 round-4 做 SPEC §3 P0-3 跨平台彙整的**最小可驗收切片**:

1. **跨來源去重**(用 `url` 當 primary key,`title+board+posted_at` 當 secondary)
2. **跨來源熱度排名**:對每個被兩個以上 source 都提到的 article,把 `pushes` 加總(sort key)
3. **Aggregator 模組**:`sources/aggregator.js` 純函式,可被 CLI / serverless 共用
4. **Orchestrator 整合**:`run()` 預設走 aggregator;若 aggregator 是 no-op(僅 1 個 source 或 distinct urls),保留 round-3 行為

## Scope 嚴格

| ✅ 必做 | ❌ 明確不做 |
|---|---|
| `sources/aggregator.js` 純函式:`dedup(articles)` + `rankByHeat(articles)` + 計算 `sourceCount` + `totalPushes` | 真實 dashboard UI(SPEC §3 P0-3 後段;round 5+) |
| `tracker.js` + `api/tracker.js` 主程式用 aggregator;CLI 新 flag `--no-aggregate` 退回 round-3 行為 | Scoring 演算法(SIMPLE — total pushes;不做 sentiment / time-decay) |
| `tests/_pure_mirrors.py` 加 `dedup_articles` + `rank_by_heat` | Threads / 巴哈姆特(無 source) |
| `tests/test_aggregator.py` 新檔(≥ 20 tests) | AI 情緒(無 API) |
| 文件:v3.0 狀態段加一句「cross-source 聚合」、CHANGELOG round-4 entry、PRD 附錄 D | 多通道警示 / PDF(round 6+) |
| 既有 178 pytest + round-4 ≥ 20 = ≥ 198 pytest | Multi-tenant / billing |
| SPEC §1-§15 byte-for-byte 不動 | config.json history purge(政策決定,不技術) |

## Milestone 1 — `sources/aggregator.js` 純函式 + 主程式整合
- **owner**: backend
- **scope**:
  - 新檔 `sources/aggregator.js`:
    - `dedup(articles)` → list of deduped Articles
      - Primary key:`article.url`
      - Secondary key(若 url 缺 / 重複):`(title, board, posted_at)` tuple
      - 合併邏輯:把多筆合成一個 Article,加 `_sourceCount` 與 `_totalPushes` 兩個新私有欄位(以下劃線前綴避免跟既有名稱衝突)
    - `rankByHeat(articles)` → sorted by `_totalPushes` desc(若 `_sourceCount > 1` 提到多 source 的 article 浮在上面)
    - 不引入新依賴
  - `tracker.js` orchestrator:把 `checkSources` 結果透過 `dedup` + `rankByHeat` 處理;CLI flag `--no-aggregate` 跳過
  - `api/tracker.js` 同樣
  - `config.example.json`:加 `"aggregate": true`(預設 open,user 可關)
- **verify**:
  - `node --check tracker.js api/tracker.js sources/*.js` exit 0
  - `python3 -m compileall .` exit 0
  - `python3 -m pytest -q` 178 + round-4 ≥ 20 → **exit 0**
- **est. LOC**: 80-120(sources/aggregator.js 60 + tracker.js / api/tracker.js +config 各 20)

## Milestone 2 — Mirror tests + 整合 test
- **owner**: qa
- **scope**:
  - `tests/_pure_mirrors.py` 加 Python 鏡像:
    - `dedup_articles(articles)` 純函式,mirror `sources/aggregator.js#dedup`
    - `rank_by_heat(articles)` 純函式,mirror `rankByHeat`
  - `tests/test_aggregator.py` 新檔:
    - dedup case 1:**不同來源同 URL** → 兩筆合併成單一 Article,`_sourceCount = 2`,`_totalPushes = pushes_a + pushes_b`(驗每個欄位取第一筆)
    - dedup case 2:**同來源同 URL 兩筆(可能因 fetch 兩輪)** → 合併;`pushes` 取較大(`max` 而非 sum,避免 double-count)
    - dedup case 3:**不同來源不同 URL** → 全部保留,_sourceCount = 1 each
    - dedup case 4:**url 缺失時 fallback to (title, board, posted_at)** → 仍去重
    - ranking:cross-source article 排前;single-source article 排後;相同 `_totalPushes` → `posted_at` 較新者優先
    - ranking edge:`_totalPushes = 0`(都是 0 pushes) → 仍 stable sort
    - ranking edge:空 list → 回空
    - **Mirror drift = 0**(M3 spirit,跑 fixture 過 JS + Python mirror)
- **verify**:
  - pytest collected 178 + 新 ≥ 20 = ≥ 198 → 全綠
  - 178 round-3 pytest **不退步**
- **est. LOC**: 150-200(test_aggregator.py + mirror extension)

## Milestone 3 — Docs sync(round-4)
- **owner**: docs
- **scope**:
  - `README.md` v3.0 狀態段加一句:「cross-source 聚合:同 URL 或同(title, board, posted_at)的文章合併,熱度加總排序」
  - `CHANGELOG.md` round-4 entry:
    - Added:`sources/aggregator.js` (`dedup` + `rankByHeat`)
    - Changed:`tracker.js` + `api/tracker.js` 現在走 aggregator(CLI `--no-aggregate` 關掉)
    - Added tests:`tests/test_aggregator.py` ≥ 20 tests
  - `PRD/SPEC.md` 附錄 D(round-4 實作紀錄):概述、commit hashes、known issues deferred
  - **絕對不動** §1-§15
- **verify**:
  - README 字數不爆 round-3 末(350 ceiling)
  - CHANGELOG round-4 entry ≤ 30 行
  - PRD §1-§15 SHA256 byte-for-byte = `5b11411354df2344…`
- **est. LOC**: 40-70 markdown

## Dependencies

- M1 commit → dispatch M2
- M2 commit → dispatch M3
- M3 commit → final verify + commit orchestrator + mark complete

## Constraints(本輪繼續守住)

- ❌ 不要 `git push`(branch 本地)
- ❌ 不要改 PRD §1-§15(SHA256 byte-for-byte = `5b11411354df2344…`)
- ❌ 不要實作 Threads / 巴哈姆特 / AI 情緒 / 多通道 / PDF / multi-tenant / 付費(m5+ 才做)
- ❌ 不要為過測改既有 round-1+2+3 contract(`_sourceCount` / `_totalPushes` 私有前綴,不會污染 schema)
- ❌ 不要引入 heavyweight dependency(沿用 Node 內建 Array + Python stdlib)
- ❌ 不要寫進 secrets
- ❌ 不要擴成無限 roadmap(spec 為「跨來源去重 + heat rank 最小切片」)

## Out of scope(本輪明確不做)

- 全文 scoring(時間衰減、sentiment 加權、keyword 命中加分)— SPEC §3 P0-3 後段
- 真實 dashboard UI
- 跨來源 dedup 在 source 端做(round-4 是 aggregator 端)
- Threads / 巴哈姆特(沒 source 資料)
- AI 情緒(GPT-4o-mini)
- 多通道警示 / PDF(round 6+)
- Multi-tenant / 付費(SPEC §1.5 non-goals)
- config.json history purge(政策決定)
- aggregator state(persistent cache / DB)— round 4 是純函式 in-memory

## Coordination notes

- **檔案歸屬**:
  - `sources/aggregator.js`(新) + `tracker.js` + `api/tracker.js` + `config.example.json` → backend
  - `tests/_pure_mirrors.py`(擴) + `tests/test_aggregator.py`(新) → qa
  - `README.md` + `CHANGELOG.md` + `PRD/SPEC.md` 附錄 D(append-only)→ docs
  - 不動 vercel.json / index.html / app.js / app.css / ptt_tracker.py / sources/ptt.js / sources/dcard.js / round-3 已 commit 任何東西
- **分支**:`rpb/round-4-v3-aggregate`(從 round-3 HEAD `804bef4` 切出,**已建**)
- **Commit prefix**:
  - `rpb(backend): ...`(M1)
  - `rpb(qa): ...`(M2)
  - `rpb(docs): ...`(M3)
  - `rpb(orchestrator): ...`(final verify + summary)
- **每個 milestone 結束**:`rpb-<role>-verify.log` 落在 `.clone/`,然後 commit
- **任何 verify 失敗 → 修復迴圈**,不擴 scope

## Phase 排程(預期 3-5 輪)

- **Phase A**:M1(backend)+ M3(docs)background 平行
- **Phase B**:M1 commit 後 dispatch M2(qa)
- **Phase C**:M2 commit 後 final verify + ROUND_4_SUMMARY + commit
- **Total**:3 個 milestone commits + final summary = 4 commits,期望 3 輪 round budget
