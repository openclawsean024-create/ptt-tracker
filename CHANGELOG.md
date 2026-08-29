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
