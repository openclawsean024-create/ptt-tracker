/**
 * SourceConnector — multi-platform article-source contract (round-2 M1).
 *
 * Every concrete source (PTT today; Dcard next round; Threads / 巴哈姆特
 * future rounds) implements this tiny interface.  The orchestrator
 * (``tracker.js`` / ``api/tracker.js``) does not know the implementation
 * details — it only knows about ``fetch`` + ``normalize`` + ``healthcheck``.
 *
 * Why an interface rather than a class?
 * ------------------------------------
 * Node.js (CommonJS, no TS) makes inheritance-based polymorphism awkward;
 * a tiny structural contract is more honest about what we actually need
 * and is easier to mock in tests.
 *
 * Hooks
 * -----
 *   name : string
 *     Stable identifier for this source (e.g. ``'ptt'``).
 *
 *   enabled : boolean
 *     Read from ``config.sources_config[name].enabled`` at construction
 *     time.  Defaults to ``true``.  Sources whose ``enabled === false``
 *     are skipped by the orchestrator entirely (no ``fetch`` call, no
 *     logging chatter from this source).
 *
 *   async fetch({ since, limit, ctx }) -> Array<RawPost>
 *     Pull raw posts from the platform.  ``since`` is an optional epoch-ms
 *     cutoff (or ``null`` for "everything up to ``limit``"); ``limit`` is
 *     a per-source cap; ``ctx`` carries the per-run config slice the
 *     source may need (e.g. PTT reads ``ctx.config.boards``, future
 *     Dcard will read ``ctx.config.dcard_forums``).  Return value is a
 *     plain Array of source-specific raw dicts — shape is intentionally
 *     NOT enforced here; ``normalize`` knows how to translate.
 *
 *   normalize(raw, ctx) -> Article
 *     Translate a single raw post into the unified Article shape::
 *
 *         {
 *           title, url, board, author, pushes, source,            // identity
 *           posted_at, fetched_at, timestamp,                    // time semantics (round-3 M1)
 *           // Legacy extras preserved for round-1 compatibility:
 *           date, href, heat,
 *         }
 *
 *     Time semantics (round-3 M1):
 *       * ``posted_at``  — ISO 8601, the moment the **author** published
 *         the post.  For Dcard this is ``raw.createdAt`` (the platform
 *         gives us the real post time).  For PTT the board index only
 *         ships a ``" 3/27"`` style ``M/D`` string, so ``normalize``
 *         combines it with the current year via the
 *         ``parsePttDate(dateStr)`` heuristic (with a 90-day cross-year
 *         fallback).  This is the field round-3 ``since``-filtering
 *         compares against.
 *       * ``fetched_at`` — ISO 8601, the moment **this process**
 *         normalized the record (``new Date().toISOString()`` at
 *         ``normalize`` time).  Independent of the source so every
 *         adapter records the same notion.
 *       * ``timestamp``  — **legacy alias**.  Kept for round-1+round-2
 *         back-compat with the existing 105 pytest mirror tests and any
 *         downstream consumer that still reads ``article.timestamp``.
 *         From round-3 onwards ``timestamp === posted_at`` for every
 *         source (so the same field name means the same thing
 *         cross-source — round-2 M3 finding #3 is closed).
 *
 *     ``ctx`` is the same object passed to ``fetch`` so the source can
 *     reach config (e.g. to default the ``board`` field when the raw
 *     payload does not carry one).
 *
 *   healthcheck() -> { ok: boolean, detail?: string }
 *     Best-effort liveness probe.  Default impl returns ``{ok: true}``
 *     (no-op) so concrete sources can skip implementing it until they
 *     actually need one (e.g. round-3 may add HEAD requests).
 *
 * Backwards compatibility
 * -----------------------
 * Round-1 contract (PTT-specific fields like ``href``, ``heat``, ``date``,
 * ``pushes``) is preserved by ``normalize``.  Round-2 added ``source``
 * and ``timestamp`` (originally carrying scrape time on PTT).  Round-3
 * splits the time semantics: ``posted_at`` is the canonical post time,
 * ``fetched_at`` records when the connector normalized the record, and
 * ``timestamp`` is kept as a legacy alias equal to ``posted_at`` so
 * existing 105 pytest mirror tests continue to pass without source-side
 * changes.  ``pushes`` (the field the rest of the pipeline filters on)
 * is still present.
 */
'use strict';

class SourceConnector {
  constructor(opts = {}) {
    this.name = opts.name || 'unknown';
    this._enabled = opts.enabled !== false;
  }

  get enabled() {
    return this._enabled;
  }

  // eslint-disable-next-line class-methods-use-this
  async fetch(_args) {
    throw new Error('SourceConnector.fetch must be implemented by subclass');
  }

  // eslint-disable-next-line class-methods-use-this
  normalize(_raw, _ctx) {
    throw new Error('SourceConnector.normalize must be implemented by subclass');
  }

  // eslint-disable-next-line class-methods-use-this
  healthcheck() {
    return { ok: true };
  }
}

/**
 * Resolve a single enabled/disabled source by name from the config map.
 * Helpers live here so both ``tracker.js`` and ``api/tracker.js`` agree on
 * the contract (and so future M3 fixture tests can import this without
 * pulling in either entrypoint).
 */
function isSourceEnabled(name, config) {
  const map = (config && config.sources_config) || {};
  return map[name] ? map[name].enabled !== false : true;
}

/**
 * Default source list when ``config.sources`` is absent.  Backwards
 * compatibility: every existing deploy without a ``sources`` field runs
 * exactly what it ran in round-1 (PTT only).  An explicit ``"sources": []``
 * short-circuits to the empty collection — the orchestrator will simply
 * report no new articles.
 */
function resolveSources(config) {
  if (!config || !Array.isArray(config.sources)) {
    return ['ptt'];
  }
  return config.sources;
}

module.exports = {
  SourceConnector,
  isSourceEnabled,
  resolveSources,
};
