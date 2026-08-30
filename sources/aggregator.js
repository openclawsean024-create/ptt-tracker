'use strict';

/**
 * Round-4 aggregator: cross-source dedup + heat ranking for the
 * MultiSourceTracker pipeline.  Pure functions, no I/O, no state.
 *
 * Both `dedup` and `rankByHeat` are **total**:  empty / null input
 * returns empty; never throws.
 *
 * Merge rules
 * -----------
 *   - Primary key: ``article.url`` (case-insensitive, trailing-slash
 *     tolerant).  Two articles pointing at the same canonical URL are
 *     treated as one story even when one source omits trailing slash.
 *   - Secondary key: the tuple ``(title, posted_at)``.  Boards vary
 *     across platforms (PTT ``MacShop`` vs Dcard ``3C`` use different
 *     taxonomies for the same story) so we match on title + post time
 *     only — this is the cross-source same-story case the round-4 brief
 *     calls out (e.g. PTT and Dcard both publishing "iphone 15"
 *     coverage within the same hour).
 *   - First observation's identity fields (title / url / board / author /
 *     source / timestamp / posted_at / fetched_at / date / href / heat /
 *     legacy extras) win; subsequent merges only contribute to ``pushes``
 *     and the source-list accounting.
 *   - ``pushes`` = **max** of the two (defensive: same-source duplicates
 *     usually mean double-fetch, not double-heat; cross-source duplicates
 *     usually mean platforms track reactions differently).
 *   - ``_sourceCount`` = number of **distinct** sources that contributed
 *     (>= 1).  Two same-source merges → still 1.
 *   - ``_totalPushes`` = ``pushes`` after the merge (mirrors the public
 *     ``pushes`` field; exposed for downstream UI / ranking).
 *   - ``_mergedSources`` = sorted list of distinct ``source`` values that
 *     contributed.
 */

/**
 * Merge articles that point at the same underlying story.
 *
 * Dedup is a two-pass merge:
 *   1. **Primary** — articles that share a normalized ``url`` merge.
 *   2. **Secondary** — articles that share the ``(title, posted_at)``
 *      tuple ALSO merge (regardless of whether either side has a url).
 *      This catches the cross-source case where two platforms point at
 *      the same story via different canonical URLs (e.g. PTT post vs
 *      the same news item on Dcard).  Board is intentionally NOT part
 *      of the tuple — platforms use different taxonomies for the same
 *      story (PTT ``MacShop`` vs Dcard ``3C`` etc.).
 *
 * Whichever key fires first wins (URL takes precedence — same-url
 * merges run before tuple-key merges); tuple-key matches against the
 * already-emitted entry of either kind.
 *
 * @param {Array<object>} articles  raw or already-normalized Articles.
 * @returns {Array<object>}         deduped Articles (preserves input order).
 */
function dedup(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return [];
  const out = [];
  const byUrl = new Map();
  const byTuple = new Map();

  for (const art of articles) {
    const safe = art || {};
    const normUrl = normalizeUrl(safe.url);
    const tuple = tupleKey(safe);

    // 1. URL match — primary.
    if (normUrl && byUrl.has(normUrl)) {
      mergeInto(byUrl.get(normUrl), safe);
      continue;
    }
    // 2. Tuple match — secondary.  Fires even when both sides have urls
    //    (cross-source same-story case).
    if (tuple && byTuple.has(tuple)) {
      const target = byTuple.get(tuple);
      mergeInto(target, safe);
      // If we just learned a URL for an existing tuple-keyed entry,
      // promote it so future URL collisions merge into the same record.
      if (normUrl) byUrl.set(normUrl, target);
      continue;
    }

    // Fresh article — clone to avoid mutating caller input.
    const fresh = freshArticle(safe);
    out.push(fresh);
    if (normUrl) byUrl.set(normUrl, fresh);
    if (tuple) byTuple.set(tuple, fresh);
  }
  return out;
}

/**
 * Rank articles.  Cross-source articles float to the top (because
 * ``_sourceCount > 1`` is the strongest cross-platform signal we have
 * without sentiment scoring).  Within each tier, sort by
 * ``_totalPushes`` desc, then by ``posted_at`` desc (newer first).
 *
 * Stable: original dedup order preserved for ties (no-op relative
 * ordering; ``Array.prototype.sort`` is stable in V8).
 *
 * @param {Array<object>} articles
 * @returns {Array<object>}   new array, sorted.
 */
function rankByHeat(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return [];
  return articles.slice().sort(cmp);
}

function cmp(a, b) {
  const sa = a._sourceCount || 1;
  const sb = b._sourceCount || 1;
  if (sa !== sb) return sb - sa;              // cross-source first
  const pa = a._totalPushes || a.pushes || 0;
  const pb = b._totalPushes || b.pushes || 0;
  if (pa !== pb) return pb - pa;              // heat desc
  const da = a.posted_at || a.timestamp || '';
  const db = b.posted_at || b.timestamp || '';
  if (da !== db) {
    if (db > da) return 1;
    if (db < da) return -1;
  }
  return 0;                                   // stable
}

// ---- helpers ----

function normalizeUrl(u) {
  if (typeof u !== 'string' || !u) return '';
  let s = u.trim().toLowerCase();
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function tupleKey(a) {
  const t = (a.title || '').trim().toLowerCase();
  const day = dayBucket(a);
  if (!t && !day) return '';
  // Tuple key uses ``title + calendar day`` (not full timestamp) so two
  // platforms reporting the same story within the same day but at
  // slightly different hours still merge.  This is the cross-source
  // heuristic the round-4 brief calls out ("PTT and Dcard both publishing
  // 'iphone 15' coverage within the same hour" → one merged record).
  return `T|${t}|${day}`;
}

/**
 * Extract the calendar-day bucket (``YYYY-MM-DD``) from an Article's
 * posted_at / timestamp.  Falls back to the raw trimmed value when no
 * parseable ISO 8601 timestamp exists so the tuple key still groups
 * articles with malformed-but-identical timestamps.
 */
function dayBucket(a) {
  const p = (a.posted_at || a.timestamp || '').trim();
  if (!p) return '';
  // ISO 8601 always starts with YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}/.test(p)) return p.slice(0, 10);
  // Defensive fallback for non-ISO sources — group by the raw value so
  // duplicates still merge even when date normalisation fails.
  return p;
}

function freshArticle(safe) {
  const pushes = Number.isFinite(safe.pushes) ? safe.pushes : 0;
  const sources = safe.source ? [String(safe.source)] : [];
  return {
    ...safe,
    pushes,
    _sourceCount: 1,
    _totalPushes: pushes,
    _mergedSources: sources,
  };
}

function mergeInto(target, incoming) {
  // pushes + heat: max.  Both ``pushes`` (canonical) and ``heat`` (legacy
  // alias emitted by PTT / Dcard normalize) track the same value so we
  // keep them in sync.
  const tP = Number.isFinite(target.pushes) ? target.pushes : 0;
  const iP = Number.isFinite(incoming.pushes) ? incoming.pushes : 0;
  const merged = Math.max(tP, iP);
  target.pushes = merged;
  target.heat = merged;
  target._totalPushes = merged;

  // Source accounting.  ``_sourceCount`` is always derived from
  // ``_mergedSources.length`` so it can't drift.  Same-source duplicate
  // fetches add nothing to the count (and nothing to the list); cross-
  // source merges add exactly one distinct value.
  if (incoming.source) {
    const incomingSource = String(incoming.source);
    if (!target._mergedSources.includes(incomingSource)) {
      target._mergedSources = [...target._mergedSources, incomingSource].sort();
      target._sourceCount = target._mergedSources.length;
    }
    // else: same source already accounted for; _sourceCount unchanged.
  }
}

module.exports = { dedup, rankByHeat };
