# Security Policy — `ptt-tracker`

> Round-1 baseline. Threat model + secrets policy + CSP rationale + PTT data
> handling + contact. Last updated by the `rpb(security)` milestone.

## Threat model (one paragraph)

`ptt-tracker` is a **public, read-only scraper** of the public bulletin board
`www.ptt.cc`, with an **optional, user-configured Telegram** side channel for
keyword alerts. The deployed surface is (a) a static `index.html` + `app.js`
served by Vercel, (b) a serverless function `/api/tracker` that fans out to
`www.ptt.cc` and (when configured) `api.telegram.org`. The realistic threats
are: **abuse of `/api/tracker`** (any stranger on the internet could otherwise
trigger PTT scraping and Telegram notifications, rate-limit / IP-shadow-ban the
Vercel deployment, or harvest article trends for free), **leaked Telegram bot
tokens / GitHub PATs / AWS keys** in source or git history, and **DOM XSS /
injection** through the user-rendered PTT article fields. Authentication and
PII collection are out of scope: there are no user accounts, no stored PII, no
server-side state beyond a per-deployment read-articles cache.

## Secrets policy

* **Env-only.** All credentials (Telegram bot token, Telegram chat id, the
  optional `PTT_API_KEY` shared secret for `/api/tracker`, the optional
  `ALLOWED_ORIGIN` for CORS) are read **only** from `process.env` /
  `os.environ`. The template lives in `.env.example` (no values).
* **`config.json` never carries secrets.** The tracked `config.example.json`
  schema intentionally omits `telegram_token` / `telegram_chat_id`. Any
  per-deploy `config.json` is git-ignored (see `.gitignore`).
* **No secrets in source.** All known-leaked-format strings are scanned by a
  blocking CI job (`secrets-grep`) on every push and PR. Patterns scanned:
  Telegram bot tokens (`<bot_id>:<secret>`), GitHub classic + fine-grained
  PATs (`ghp_…`, `github_pat_…`), AWS access key IDs (`AKIA…`).
* **History rewrite deferred.** Commit `bd0ea76` did carry a placeholder
  `telegram_*` field in the tracked `config.json` (no real values — but the
  variable names are now permanently in git history). A `git filter-repo`
  purge would change every SHA. This is **intentionally deferred** to a
  future round and requires explicit user sign-off + force-push coordination
  before it lands — see "Known follow-ups" below.

## Content Security Policy

`vercel.json` ships the following CSP via response headers (every path under
`/(.*)`):

```
default-src 'self';
script-src 'self';
style-src  'self';
img-src    'self' data:;
font-src   'self';
connect-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'self';
```

…and the following security headers:

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | (above) | Limits script/style to same-origin. |
| `X-Content-Type-Options` | `nosniff` | Block MIME-sniffing of `app.js`/`app.css`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak query strings on outgoing links. |
| `X-Frame-Options` | `DENY` | The page has no embed use-case. |

**Why this CSP is safe (post-round-1):**

* **No inline `<script>`.** Client logic lives in `app.js`, loaded via
  `<script src="app.js">`. This lets `script-src` stay at `'self'`.
* **No inline `<style>`.** The previous inline `<style>` block was extracted
  to `app.css`, so `style-src 'unsafe-inline'` was dropped. The current CSP is
  fully nonce-/hash-free.
* **`'unsafe-eval'` is absent.** No code path uses `eval`, `Function(...)`, or
  `setTimeout` with a string body. (Dynamic timeouts use numeric ms values.)
* **No third-party origins** (no Google Fonts, no CDN scripts, no analytics).
  Every request the page can make is same-origin. `connect-src 'self'` means
  even fetch-side requests (e.g. `fetch('/api/tracker')`) are bound to the
  same scheme + host.
* **`object-src 'none'`** disables `<object>`/`<embed>`/`<applet>` (no Flash
  / PDF plugin vectors).
* **`frame-ancestors 'none'`** is the modern equivalent of `X-Frame-Options:
  DENY`, also enforced by the legacy `X-Frame-Options` header for older UA
  coverage.

**What is gated by CORS / a shared secret:**

The serverless `api/tracker.js` route triggers a side-effectful PTT scrape,
and (when configured) a Telegram send. It is reachable from the public
internet by default. Two new (opt-in) controls mitigate that:

* `ALLOWED_ORIGIN` (default `https://ptt-alertor-olive.vercel.app`) — the
  **single** origin echoed back in `Access-Control-Allow-Origin`. The header
  is no longer `*`.
* `PTT_API_KEY` — when set, every request must include a matching
  `X-PTT-API-Key` header; otherwise the API returns `401`. When unset the
  gate is open (a deliberate demo-deploy posture); operators should set
  **both** env vars together for production.

The CLI (`tracker.js`) and the Telegram bot (`ptt_tracker.py`) are unaffected
by these controls — they are local processes and do not expose a network
listener.

## PTT data & user privacy

**What we collect from PTT.** The scraper fetches the public index pages of
user-configured boards (`GET https://www.ptt.cc/bbs/<board>/index.html`) and
parses out the article *titles*, *authors* (handle of the post author as
published on the index page), *post dates*, and *push counts*. Article body
text is **not** fetched, parsed, or stored.

**What we do not collect.** No end-user IP, no end-user identifier, no
authenticated PTT sessions. The PTT `over18=1` cookie set in `tracker.js` /
`ptt_tracker.py` is a public, anonymous consent toggle required by PTT to
view their public pages; it is not a PTT account login.

**What we store locally.** `read_articles.json` — a per-deployment dedup
cache (article title + board + read timestamp). It is **git-ignored** and
intended only for the running host to avoid re-alerting on the same article
between runs. Nothing else is written to disk.

**What we send to Telegram.** When Telegram notifications are enabled
(`PTT_TELEGRAM_TOKEN` + `PTT_TELEGRAM_CHAT_ID` are set), the same
title/board/author/date/pushes published on the PTT index page is forwarded
verbatim to the operator-configured chat. The chat recipient is also the
operator — there is no third-party recipient.

**Operator responsibilities.** By using `ptt-tracker` you are responsible for
complying with PTT's terms of service and robots.txt, and for any
notifications you forward (e.g. handling takedown requests for authors who
appear in the alert feed).

## Reporting a vulnerability

This repo is a single-maintainer side project. There is no formal
`security@` inbox yet — for now, please **open a GitHub issue tagged
`security`** or **DM the maintainer on Telegram** (the bot name is in
`README.md`). For sensitive disclosures (e.g. a confirmed credential leak
that needs immediate rotation), please mention `SECURITY` in the issue title
so it is triaged before regular bug reports.

When reporting, please include:

1. Affected file + commit SHA (if known)
2. Steps to reproduce (or a PoC script)
3. Impact (what an attacker gets / breaks)
4. Whether the issue is already public anywhere

We do not run a paid bug-bounty program.

## Known follow-ups (deferred to a future round)

These were identified during the round-1 security review but intentionally
left **out of scope** for this commit. Documenting them so they are not lost.

* **History purge of `bd0ea76`'s `telegram_*` placeholder fields in
  `config.json`.** A real `git filter-repo` run would rewrite every SHA and
  require a coordinated force-push. Requires explicit user sign-off; not
  done in round 1.
* **Audit-server pinning.** The `secrets-grep` job uses literal regex; a more
  robust scanner (e.g. `gitleaks`) would reduce false-positive risk and add
  entropy-based detection of high-entropy strings. Trade-off: more
  dependencies + maintenance.
* **Rate limiting on `/api/tracker`.** Currently the only abuse-mitigation
  is the optional `PTT_API_KEY` gate + same-origin CORS. A Vercel Edge
  Middleware rate-limiter (per-IP token bucket) would harden against
  authenticated-but-spammy callers.

---

_See also: `.env.example` (canonical env-var template), `vercel.json`
(headers), `README.md` (operator setup)._
