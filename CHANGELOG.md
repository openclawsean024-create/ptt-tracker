# Changelog

## [Unreleased] — round-1 (v2.x productionization)

### Changed
- Telegram credentials are now read **only** from environment variables (`PTT_TELEGRAM_TOKEN`, `PTT_TELEGRAM_CHAT_ID`). `config.json` no longer carries secrets (it still exists locally for non-secret prefs).
- `loadConfig()` (both `tracker.js` and `api/tracker.js`) and `ptt_tracker.load_secrets()` centralize this contract.
- Frontend: inline `<script>` extracted to `app.js` to permit strict CSP `script-src 'self'`. All `renderArticle` writes go through `createElement + textContent`; no `innerHTML` anywhere in the repo. Added `role`/`aria-*` on status, tabs, tablist and `:focus-visible` outline for keyboard navigation.
- `vercel.json`: added `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. `rewrites` preserved.
- `.gitignore`: `config.json`, `.env`, `.env.*`, `*.pem` excluded; `.env.example` kept tracked as the template.

### Added
- `.github/workflows/ci.yml`: 3 jobs on push/PR to `main` — `syntax-check` (cheapest gate: `compileall` + `node --check`), `tests` (`pytest -q`), `security-audit` (`pip-audit` + `npm audit`, advisory only).
- `tests/` (pytest scaffold): 37 smoke tests covering config loading, keyword matching, heat filter, all mirrored from `tracker.js` pure functions via `tests/_pure_mirrors.py`.
- `pytest.ini` with `testpaths = tests`.
- `app.js` (extracted from inline `<script>` in `index.html`).
- `.env.example` documenting `PTT_TELEGRAM_TOKEN` and `PTT_TELEGRAM_CHAT_ID`.
- `SECURITY.md`: threat model, secrets policy, CSP rationale.
- `PLAN.md`: round-1 milestone plan.
- `requirements.txt`: pinned `requests` and `beautifulsoup4` (see commit history).

### Known issues carried forward (deferred)
- `config.json` was committed in `bd0ea76` with placeholder telegram fields; git filter-repo history rewrite is **deferred to a follow-up round** (changes all SHAs).
- `style-src 'unsafe-inline'` was tightened to `'self'` once the inline `<style>` block is extracted to `app.css` (handled in security pass).
- 4 pre-existing bare `except:` in `ptt_tracker.py` were replaced with explicit exception classes.
- `Access-Control-Allow-Origin` on `api/tracker.js` defaults to the same-origin Vercel URL; an optional `PTT_API_KEY` shared-secret gate is now available.
- `pip-audit` and `npm audit` advisory jobs added to CI but kept `continue-on-error: true` until `requirements.txt` and any future `package-lock.json` mature.

## [Unreleased] — round-2 (v3.0 多來源資料流 MVP)

> 本輪把既有 PTT-only pipeline 抽象為 `SourceConnector` 介面,並新增 Dcard connector 作為 v3.0「多平台擴展」的第一個實際切片。**§1-§15 不變**,僅附加附錄 B 紀錄實作範圍。

### Added
- `sources/SourceConnector.js` 介面:`name`、`fetch({boards, keywords, since})`、`parseArticle(raw)`、`normalize(article)` hook,供各平台實作共用契約。
- `sources/ptt.js` PTT adapter:把 `tracker.js` / `api/tracker.js` 內既有 PTT-specific 抓取 / 解析邏輯抽出,實作 `SourceConnector` 介面;behavior 維持不變(round-1 37 pytest 全綠仍為 regression gate)。
- `sources/dcard.js` Dcard adapter:基於 Dcard 官方 `/api/posts` API(無需 auth、公開看板),把 `reactionCount` 對應 PTT `pushes`、`createdAt` 對應統一 `timestamp`,統一吐 `{title, url, board, author, pushes, timestamp, source}` Article schema。
- `tests/test_source_schema.py`:`PTT` 與 `Dcard` normalize 後的 Article schema 一致性測試(`{title, url, board, author, pushes, timestamp, source}` keys 對齊)。
- `tests/test_dcard_connector.py`:用 fixture mock 一段 Dcard `/api/posts` response,丟給 `sources/dcard.js`(child-process node)驗證 parse + normalize 出來 Article shape 對齊 PTT;不實際打 Dcard API(避免 fragile 外部依賴)。
- `tests/_pure_mirrors.py` 延伸 `normalize_article()`:把 PTT / Dcard 各自的 normalize 邏輯 mirror 到 Python(沿用 round-1 mirror-based pattern)。

### Changed
- `tracker.js` 與 `api/tracker.js` 重構成 `MultiSourceTracker` orchestrator:跑多個 `SourceConnector`、彙整去重後交給既有 Telegram 通知層。`MultiSourceTracker` 對 round-1 harden 過的 env-only secrets 路徑、Telegram 寫入、CORS gate 全部不動。
- `config.json` schema 新增 `sources` 欄位(陣列,例如 `["ptt", "dcard"]`);既有 `boards` / `keywords` / `min_heat` / `interval_minutes` 保持向下相容 —— **未填 `sources` 時預設 `["ptt"]`**,v2.x 使用者零行為差異。
- `config.example.json` 範例加 `sources` / `dcard_forums` 區塊;`.env.example` 若需新 secrets(如 `DCARD_USER_AGENT`)再補;本輪預設無新 secrets 需求。

### Deferred
- **Threads connector**:需 Meta Business 帳號申請,非個人可解;留 round 3+ 或明確 deferred。
- **巴哈姆特 connector**:目前無官方公開 API;scrape 法規 grey zone;留 round 3+ 或明確 deferred。
- **AI 情緒分類(GPT-4o-mini)**:需 OpenAI 帳號 + cost;留 round 4。
- **多通道 LINE / Slack / Email 警示**(SPEC §3 P0-4):需外部 webhook 憑證;留 round 5+。
- **PDF 週報**(SPEC §3 P0-5):留 round 5+。
- **BullMQ / Redis worker infra**(SPEC §3 P0-1「每平台獨立 worker」):現規模不需要;留 round 5+。

## [Unreleased] — round-3 (v3.0 timestamp alignment + since-filtering)

> 本輪把 round-2 M3 finding #3 的 timestamp 語意不一致修掉,並把 `since`-filtering 從介面一路 wire 到 fetcher。**§1-§15 不變**,僅附加附錄 C 紀錄實作範圍。Backend / QA 的詳細 commit 列表待 round-3 final verify 後補。

### Added
- **Article schema 時間語意對齊**:新增 `posted_at`(post time) + `fetched_at`(scrape time) 兩個明確語意欄位;`timestamp` 退到 alias 角色(向後相容 round-1 / round-2)。
- **`since`-filtering 入口**:CLI 新增 `--since <ISO>` flag;serverless `/api/tracker` 接受 `?since=<ISO>` query param;orchestrator 把 `since` 往下傳給各 `SourceConnector.fetch()`。
- **PTT `posted_at` heuristic**:`currentYear + raw.date` 拼出 post time;若距離現在 > 90 天,fallback 到 `currentYear - 1`(處理年底 / 年初跨年文章)。
- **Dcard 原生 since filter**:透傳 `?after=<ISO>` query param 給 Dcard `/api/posts`(Dcard 原生支援)。
- **Tests**:`tests/test_ppt_timestamp.py`(happy path / 跨年 / grace / defensive default) + `tests/test_since_filter.py`(PTT-side + Dcard-side + cross-source intersection);`tests/_pure_mirrors.py` 延伸 `parsePtt_date` + `apply_since_filter`(待 M3 commit 後補 round-3 detailed test 列表)。

## [Unreleased] — round-4 (v3.0 cross-source aggregator)

> 本輪把 round-3 deferred 的「跨來源去重 / 聚合」最小切片實作:SPEC §3 P0-3 跨平台彙整的「去重 + 熱度排名」。**§1-§15 不變**,僅附加附錄 D 紀錄實作範圍。Backend / QA 的詳細 commit 列表待 round-4 final verify 後補。

### Added
- **`sources/aggregator.js`**(純函式):`dedup(articles)` 以 `url` 為 primary key、`(title, board, posted_at)` 為 secondary;`rankByHeat(articles)` 依 `_totalPushes` 降冪排序,`_sourceCount > 1` 的 cross-source 文章自動排在 single-source 之上。合併後附加私有欄位 `_sourceCount` 與 `_totalPushes`(下劃線前綴避免污染既有 schema)。
- **`tracker.js` + `api/tracker.js`** 預設走 aggregator;CLI 新增 `--no-aggregate` flag、serverless 接受 `?aggregate=false` query param,退回 round-3 行為。
- **`config.json.aggregate`** boolean 欄位(預設 `true`),user 可在 config 關閉。
- **Tests**:`tests/_pure_mirrors.py` 擴 `dedup_articles` + `rank_by_heat`(JS ↔ Python mirror,drift = 0);`tests/test_aggregator.py` 新檔涵蓋 dedup case 1-4(同 URL 跨來源 / 同來源重複 / 不同 URL / url 缺 fallback) + ranking(cross-source 優先 / stable sort / 空 list)。
