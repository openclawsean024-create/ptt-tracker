# Plan: ptt-tracker — round 1 (v2.x productionization)

## 為什麼這樣排

Repo 現況是 1 個 commit、10 檔、1012 LOC、**0 測試 / 0 CI / config.json 已 commit / 純 Node + Python + Vercel 靜態**。一輪衝太大容易 scope 失控,所以這一輪切成 **4 個可平行的 builder milestone + 1 個 review 收尾**,每個都 < 5 分鐘可驗收,且檔案歸屬不重疊。M1(後端)+M4(QA)有一個輕度先後順序:QA 寫 smoke tests 對齊 M1 改完後的 env-var 行為,所以 M4 在 M1 之後開始會比較順;M2/M3 可與 M1 真正平行。M5 在四件完成後做最後的安全 review + 文件同步。

## Milestone 1 — Backend hardening + secrets hygiene
- **owner**: backend
- **scope**:
  - `tracker.js`、`ptt_tracker.py`、`api/tracker.js` —— 把 `telegram_token` / `telegram_chat_id` 改成純環境變數讀取;config.json 改為只保留 non-secret 欄位(boards / keywords / min_heat / interval_minutes)
  - `.gitignore` —— 加入 `config.json`(任何本地 secrets)、`.env`、`*.pem`
  - 新增 `.env.example` —— 列出需要哪些 env vars,不帶真值
- **verify**:
  - `python3 -m pytest -q`(若 M4 已先送出則可能沒測試,跑過即可)
  - `python3 -m compileall .`
  - `node --check tracker.js api/tracker.js`
  - `git grep -i "telegram_(token|chat_id).*=.*['\"][A-Za-z0-9_\\-]{20,}['\"]"` 應無實質 match(REPLACE_ME 文字可豁免)
- **est. LOC**: 60-90(新增 env loader + 修讀取路徑 + 寫 `.env.example`)

## Milestone 2 — Frontend polish + CSP via vercel.json
- **owner**: frontend
- **scope**:
  - `index.html` —— a11y(icon-only button 加 `aria-label`、focus-visible、`<label>` for inputs)、任何 `innerHTML =` 改為 `textContent` + 結構化 DOM
  - `vercel.json` —— 加 CSP / X-Content-Type-Options / Referrer-Policy / X-Frame-Options(這條 owner = frontend 是因為 CSP 跟前端 inline script 相關;devops 不會動 vercel.json)
  - `api/tracker.js` —— 不動(serverless function 不算前端 UI,但若前端 fetch 那邊 header 要對應,此處偶爾會讀 response 對齊 — 不需要)
- **verify**:
  - `node --check tracker.js api/tracker.js`(仍綠)
  - 手動 grep:`git grep -nE "\.innerHTML\s*=\s*['\"\`]" index.html` 應無 match(user input 寫入)
  - `python3 -c "import json; d=json.load(open('vercel.json')); assert 'headers' in d"`(基本結構檢查)
- **est. LOC**: 40-70(index.html a11y + vercel.json headers)

## Milestone 3 — DevOps CI scaffold
- **owner**: devops
- **scope**:
  - 新增 `.github/workflows/ci.yml` —— 觸發:push/PR to `main`;jobs:`lint-and-syntax`(node --check + python3 compileall、ubuntu-latest、最便宜先跑)、`tests`(pytest -q,ubuntu-latest)、`security-audit`(可選,先 --continue-on-error)、pin actions(@v4)
  - `package.json` —— 若不存在,新增 minimal `engines`(node 版本至少 18);不動既有指令
  - 不動 `vercel.json`(那是 frontend 的)
- **verify**:
  - `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` exit 0
  - `python3 -c "import json; json.load(open('package.json'))" || echo "(no package.json, OK)"`(未必存在)
- **est. LOC**: 30-50 yaml

## Milestone 4 — QA test scaffold + smoke tests
- **owner**: qa
- **scope**:
  - `tests/test_config_loader.py` —— config.json 載入 + 環境變數 fallback(走 M1 後的新行為)
  - `tests/test_keyword_match.py` —— 關鍵字比對的 case-insensitive match(從 tracker.js 中抽出純函式來測,或鏡像一份純函式在 tests 內)
  - `tests/test_heat_filter.py` —— `min_heat` 過濾
  - `conftest.py` —— fixtures:sample_articles、sample_config
  - `pytest.ini` —— testpaths = tests
  - **不可以動 production code**(若需要 refactor,丟給 backend 做)
- **verify**:
  - `python3 -m pytest --collect-only`(收集成功)
  - `python3 -m pytest -q`(全綠)
- **est. LOC**: 100-160

## Milestone 5 — Security review + Docs sync(review pass,收尾)
- **owner**: security + docs(由 orchestrator 在前 4 件 merge 後連續派)
- **scope**:
  - `SECURITY.md`(新) —— 報告請參考 PTT 爬蟲節流 + secrets hygiene + CSP 設定 + 不追蹤使用者個資
  - `CHANGELOG.md`(新) —— round-1 一行,user-facing
  - `README.md` —— 把「用環境變數覆蓋 Telegram 憑證」這段補滿(已是部分內容,改為預設行為而不是 fallback)
  - 不動 PRD/SPEC.md §1-§9(scope 章節)
- **verify**:
  - `git grep -E "(TODO|FIXME|HACK)" | grep -v vendor/` 應為空(或只有 docs 的 `TODO(planned)` 之類)
  - `git grep -E "(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|telegram_(token|chat_id).*[:=].{20,})"` 應無 leak
  - `python3 -c "import yaml,json; [yaml.safe_load(open(p)) for p in ['.github/workflows/ci.yml']]; json.load(open('vercel.json')); print('infra files parse OK')"`
- **est. LOC**: 40-60 markdown

## Dependencies

- M4 之後才能完全驗收 M1(refactor 後測試才能反映正確行為;但 M4 可以先寫,只是若 M1 改了行為就要再跑一次)
- M5 完全依賴前 4 件完成
- M2 與 M3 完全獨立

## Out of scope(本輪不做)

- ❌ 不實作 PRD/SPEC.md v3.0(在 `follow-up-v3.0.md`,等下一輪 goal)
- ❌ 不引入新 heavyweight dependency(如 axios、lodash、requests-via-async、playwright 等)
- ❌ 不重構整個目錄結構
- ❌ 不改既有 config schema 的 user-facing 部分(只把 secrets 從 config.json 移到 env)
- ❌ 不 push 到 origin
- ❌ 不 deploy 到 Vercel

## Coordination notes

- **檔案歸屬**:`vercel.json` = frontend(m2);`.gitignore` = backend(m1);`.github/workflows/` = devops(m3);`tests/` = qa(m4);`SECURITY.md` / `CHANGELOG.md` / `README.md` = docs(m5)
- **分支**:`rpb/round-1-productionize`(已建立)
- **Commit prefix**:`rpb(backend):`, `rpb(frontend):`, `rpb(devops):`, `rpb(qa):`, `rpb(security):`, `rpb(docs):`, `rpb(orchestrator):`
- **每個 milestone 結束**:`<role>-verify.log` 落在 `.clone/`,然後 commit
- **任何 verify 失敗 → 修復迴圈**,不要擴大 scope
