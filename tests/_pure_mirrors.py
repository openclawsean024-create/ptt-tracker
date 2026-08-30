"""
Pure-function mirrors of small pieces of business logic that live
inside ``tracker.js``.

Why these exist
---------------
``tracker.js`` is a Node.js script that loads its config from
``__dirname`` and reads PTT over the network — it is **not**
importable as a Python module.  Mirroring the small pure pieces
here lets us assert their input→output contract from a Python
test suite **without modifying production code**.

These mirrors are intentionally tiny, side-effect-free, and
maintained only for testing.  If ``tracker.js`` changes the
semantics of any of them, **the mirror must change too and the
tests must be updated** — that's the whole point of having
mirror tests in the first place: they catch drift.

Tracking
--------
* ``load_config_with_env(file_config, env, config_path_exists)`` —
  mirrors ``tracker.js`` ``loadConfig()`` (post-M1 version): secrets
  are read from environment, non-secrets are read from
  ``config.json`` only when the file exists; a missing file
  yields an empty file-config rather than raising.
* ``match_keywords(title, keywords)`` — mirrors ``tracker.js``
  ``matchKeywords(title, keywords)``: case-insensitive substring
  match, OR across the keyword list, empty list → ``False``.
* ``filter_by_heat(articles, min_heat)`` — mirrors the
  ``article.heat >= minHeat`` rule used by ``tracker.js``
  ``checkBoards()`` to populate ``newArticles``.
* ``normalize_article(source_name, raw)`` — mirrors the
  ``normalize(raw, ctx)`` hook of the round-2 source connectors:
  ``sources/ptt.js`` ``PttConnector.normalize`` and
  ``sources/dcard.js`` ``normalizeArticle``.  Both emit the same
  unified Article schema (7 required keys + 3 legacy extras).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping


def load_config_with_env(file_config=None, env=None, config_path_exists=True):
    """Mirror of ``tracker.js`` ``loadConfig`` (post-M1 version).

    Parameters
    ----------
    file_config : mapping | None
        Parsed contents of ``config.json``.  ``None`` means "the
        config file did not exist / could not be read".
    env : mapping | None
        Environment to read Telegram secrets from (defaults to
        ``os.environ``).
    config_path_exists : bool
        Signals whether ``config.json`` exists on disk.  When
        ``False`` ``file_config`` is ignored.

    Returns
    -------
    dict
        A new dict: ``{<non-secret fields from file_config>,
        telegram_token: <env value or None>,
        telegram_chat_id: <env value or None>}``.
        Never raises; missing/corrupt file is silently treated
        as an empty file-config (matches ``tracker.js`` ``catch {}``).
    """
    if env is None:
        env = os.environ

    base = dict(file_config) if (config_path_exists and file_config) else {}

    return {
        **base,
        "telegram_token": env.get("PTT_TELEGRAM_TOKEN"),
        "telegram_chat_id": env.get("PTT_TELEGRAM_CHAT_ID"),
    }


def match_keywords(title, keywords):
    """Mirror of ``tracker.js`` ``matchKeywords(title, keywords)``.

    Case-insensitive substring match; returns ``True`` if **any**
    keyword appears in the title, ``False`` for an empty/null
    keyword list.
    """
    if not keywords:
        return False
    title_lower = (title or "").lower()
    return any(str(k).lower() in title_lower for k in keywords)


def filter_by_heat(articles, min_heat):
    """Mirror of the heat gate inside ``tracker.js`` ``checkBoards``.

    Returns only articles whose ``heat`` field is ``>= min_heat``.
    Articles lacking a numeric ``heat`` field are skipped (treated
    as 0), which matches how ``parseArticles`` always emits a
    numeric ``heat``.
    """
    threshold = 0 if min_heat is None else min_heat
    out = []
    for art in articles:
        heat = art.get("heat", 0)
        try:
            heat_value = int(heat)
        except (TypeError, ValueError):
            heat_value = 0
        if heat_value >= threshold:
            out.append(art)
    return out


# ---------------------------------------------------------------------------
# Round-2 M3 — unified Article schema mirrors
# ---------------------------------------------------------------------------
#
# The unified Article schema (documented in ``sources/SourceConnector.js``)
# from round-3 M1 is::
#
#     {
#       title, url, board, author, pushes, source,            # identity
#       posted_at, fetched_at,                               # time semantics
#     }
#
# ``timestamp`` is a **legacy alias** equal to ``posted_at`` (kept so
# round-1+round-2 mirror tests and any downstream consumer reading
# ``article.timestamp`` keep working without source-side changes).
#
# Both concrete connectors additionally emit the three round-1 legacy
# extras (``date`` / ``href`` / ``heat``).  Full Article = 9 unified
# keys (8 unified + the ``timestamp`` alias) + 3 extras = 12 keys.

#: The 8 canonical keys every source MUST emit (the cross-source contract).
UNIFIED_ARTICLE_KEYS = (
    "title",
    "url",
    "board",
    "author",
    "pushes",
    "posted_at",
    "fetched_at",
    "source",
)

#: Round-1 compatibility extras every round-2 connector also emits.
LEGACY_ARTICLE_KEYS = ("date", "href", "heat")

#: ``timestamp`` is a legacy alias of ``posted_at`` (round-3 M1).  Kept
#: out of :data:`UNIFIED_ARTICLE_KEYS` to keep the canonical schema
#: honest about its real semantic split; appended to the full key set
#: so round-1+round-2 tests asserting ``set(article) == set(ARTICLE_KEYS)``
#: still match.
TIMESTAMP_ALIAS_KEY = "timestamp"

#: Full key set of a normalized Article (unified + legacy extras + alias).
ARTICLE_KEYS = UNIFIED_ARTICLE_KEYS + LEGACY_ARTICLE_KEYS + (TIMESTAMP_ALIAS_KEY,)

# Round-3 M1: how aggressively ``parsePtt_date`` suspects a PTT
# ``" M/D"`` date refers to the previous calendar year.  Must stay in
# sync with ``sources/ptt.js`` ``PTT_CROSS_YEAR_THRESHOLD_DAYS``.
PTT_CROSS_YEAR_THRESHOLD_DAYS = 90

# Round-3 M2: how generous PTT's since-filter is when an article's
# ``posted_at`` falls *just* before the caller's cutoff.  Mirrors the
# ``PTT_SINCE_GRACE_MS`` constant exported by ``sources/ptt.js`` —
# 24 hours of slack so PTT's day-level date granularity (``" M/D"``)
# doesn't drop a 3/27 post when the cutoff is the same day at 09:00.
PTT_SINCE_GRACE_MS = 24 * 60 * 60 * 1000


# ---------------------------------------------------------------------------
# Round-3 M2 — since-filter mirrors (CLI + serverless + per-connector).
# ---------------------------------------------------------------------------
#
# These mirror the three production helpers that the round-3 orchestrator
# uses to thread a caller-supplied ``since`` ISO 8601 string through the
# pipeline:
#
#   * ``normalizeSince`` (``tracker.js``) — trim + null-check the CLI /
#     serverless input; the two surfaces share this single helper so a
#     typo'd ``?since=`` query param is treated identically to a typo'd
#     ``--since`` flag.
#   * ``parseSinceMs`` (``sources/ptt.js``) — convert an ISO 8601 string
#     to epoch-ms; ``null`` (NOT NaN) on unparseable input so the
#     connector's filter can short-circuit safely.
#   * ``buildSinceQuery`` (``sources/dcard.js``) — build the
#     ``&after=<ISO>`` query-string suffix Dcard's API consumes
#     server-side; ``''`` for null / empty / unparseable input so the
#     URL never carries garbage.
#
# All three return ``None`` / ``''`` on the same set of "bad" inputs as
# the JS implementations (round-1 fallback: no time filter).


def normalize_since(raw_since):
    """Mirror of ``tracker.js`` ``normalizeSince`` (CLI + serverless shared).

    Shared between ``tracker.js`` (CLI ``--since`` flag) and
    ``api/tracker.js`` (serverless ``?since=`` query param).  Returns
    ``None`` for ``None`` / non-string / empty / whitespace-only input
    (round-1 fallback: no time filter).  Otherwise returns the trimmed
    string verbatim — the connector decides whether the ISO 8601 is
    actually parseable.
    """
    if raw_since is None:
        return None
    if not isinstance(raw_since, str):
        return None
    trimmed = raw_since.strip()
    if not trimmed:
        return None
    return trimmed


def parse_since_ms(raw_since):
    """Mirror of ``sources/ptt.js`` ``parseSinceMs``.

    ISO 8601 string → epoch-ms (int / float).  ``None`` (NOT NaN) on
    unparseable input so the connector's filter logic can short-circuit
    safely.  Tolerant ``Z`` suffix (``2026-01-01T00:00:00.000Z``) and
    explicit ``+00:00`` both parse correctly.
    """
    if raw_since is None:
        return None
    if isinstance(raw_since, datetime):
        if raw_since.tzinfo is None:
            raw_since = raw_since.replace(tzinfo=timezone.utc)
        ms = raw_since.timestamp() * 1000.0
        return ms if ms == ms else None  # NaN guard
    if not isinstance(raw_since, str):
        return None
    trimmed = raw_since.strip()
    if not trimmed:
        return None
    # Mirror JS ``Date.parse`` — accept ``Z`` suffix via ``fromisoformat``.
    text = trimmed
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ms = dt.timestamp() * 1000.0
    return ms if ms == ms else None


def build_since_query(raw_since):
    """Mirror of ``sources/dcard.js`` ``buildSinceQuery``.

    Builds the ``&after=<ISO>`` suffix that Dcard's API consumes
    server-side.  Empty string (``''``) for ``None`` / non-string /
    empty / whitespace-only / unparseable input — the URL never carries
    garbage, and the round-1 behaviour ("no ``after`` query param")
    falls out naturally.
    """
    if raw_since is None:
        return ""
    if not isinstance(raw_since, str):
        return ""
    trimmed = raw_since.strip()
    if not trimmed:
        return ""
    if parse_since_ms(trimmed) is None:
        return ""
    # Match ``encodeURIComponent`` shape — escape a minimal set of
    # characters; the input is expected to be an ISO 8601 string so the
    # only character that realistically needs escaping is ``:`` (and
    # only when callers pass a date with ``+`` offset), but we mirror
    # JS's behaviour exactly: keep alphanumerics + ``-._~`` verbatim,
    # percent-encode everything else.
    from urllib.parse import quote
    return "&after=" + quote(trimmed, safe="")


def _resolve_now(now):
    """Mirror of ``sources/ptt.js`` ``resolveNow``.

    ``now`` accepts ``None`` (default → current wall time), a
    ``datetime``, an epoch-ms int/float, or an ISO 8601 string.
    """
    if now is None:
        return datetime.now(timezone.utc)
    if isinstance(now, datetime):
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now
    if isinstance(now, (int, float)):
        return datetime.fromtimestamp(float(now), tz=timezone.utc)
    if isinstance(now, str):
        # Tolerant ISO 8601 parse — accept ``Z`` suffix and ``+HH:MM``.
        text = now.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    raise TypeError("now must be None, datetime, epoch number, or ISO 8601 string")


def parsePtt_date(date_str, now=None):
    """Mirror of ``sources/ptt.js`` ``parsePttDate``.

    Parses a PTT ``" M/D"`` (no year) date string into an ISO 8601
    timestamp.  Cross-year fallback: if the candidate (current year)
    lands more than :data:`PTT_CROSS_YEAR_THRESHOLD_DAYS` away from
    ``now``, assume the previous calendar year.  Empty / null /
    unparseable input returns ``now`` as a defensive default.

    The mirror is byte-for-byte equivalent to the production helper
    modulo timezone (Python ``datetime`` vs JS ``Date``); both
    represent the same UTC moment for matching wall-time inputs.
    """
    if not date_str or not isinstance(date_str, str):
        return _iso_dt(_resolve_now(now))
    s = date_str.strip()
    match = _PTT_DATE_RE.match(s)
    if not match:
        return _iso_dt(_resolve_now(now))
    month = int(match.group(1))
    day = int(match.group(2))
    if month < 1 or month > 12 or day < 1 or day > 31:
        return _iso_dt(_resolve_now(now))
    ref = _resolve_now(now)
    year = ref.year
    try:
        candidate = datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        # Feb 30 etc. — fall back to defensive default.
        return _iso_dt(_resolve_now(now))
    diff_days = abs((ref - candidate).total_seconds()) / 86400.0
    if diff_days > PTT_CROSS_YEAR_THRESHOLD_DAYS:
        try:
            candidate = datetime(year - 1, month, day, tzinfo=timezone.utc)
        except ValueError:
            return _iso_dt(_resolve_now(now))
    return _iso_dt(candidate)


def _iso_dt(value):
    """Format a ``datetime`` to JS-style ISO 8601 (``...Z``, ms precision)."""
    if not isinstance(value, datetime):
        return _iso_now()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    # Match JS ``Date.toISOString`` shape: ``YYYY-MM-DDTHH:MM:SS.sssZ``.
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


import re as _re
_PTT_DATE_RE = _re.compile(r"^(\d{1,2})/(\d{1,2})$")


def _to_non_negative_int(value):
    """Mirror of ``sources/dcard.js`` ``toNonNegativeInt``.

    JS ``Number.parseInt(value, 10)`` returns ``NaN`` for anything
    non-numeric; the connector then clamps ``NaN`` and negatives to
    ``0``.  Booleans are ``NaN`` in JS's ``parseInt`` too, so they
    also fall through to ``0`` here (Python would otherwise coerce
    ``True`` → ``1``).
    """
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        try:
            parsed = int(value)
        except (OverflowError, ValueError):
            return 0
        return parsed if parsed >= 0 else 0
    if isinstance(value, str):
        # JS parseInt reads a leading integer prefix ("12abc" → 12).
        text = value.strip()
        idx = 0
        if idx < len(text) and text[idx] in "+-":
            idx += 1
        start = idx
        while idx < len(text) and text[idx].isdigit():
            idx += 1
        if idx == start:
            return 0
        parsed = int(text[:idx])
        return parsed if parsed >= 0 else 0
    return 0


def _iso_now():
    """Mirror of JS ``new Date().toISOString()`` (millisecond precision, ``Z``)."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _normalize_ptt(raw):
    """Mirror of ``sources/ptt.js`` ``PttConnector.normalize`` (round-3 M1).

    Round-3: time semantics split into ``posted_at`` (author's post time,
    derived from the PTT ``" M/D"`` ``date`` column via
    :func:`parsePtt_date`) and ``fetched_at`` (normalize-time stamp).
    ``timestamp`` is preserved as a legacy alias of ``posted_at`` so
    round-1+round-2 downstream consumers reading ``article.timestamp``
    keep working without source-side changes.

    ``Number.isFinite(raw.pushes) ? raw.pushes : 0`` — only a real
    number survives (numeric string → 0; boolean → 0).  ``source`` is
    the connector's name.
    """
    safe = raw or {}
    pushes = safe.get("pushes")
    if isinstance(pushes, bool) or not isinstance(pushes, (int, float)):
        pushes = 0

    posted_at = parsePtt_date(safe.get("date"))
    fetched_at = _iso_now()

    return {
        "title": safe.get("title") or "",
        "url": safe.get("url") or "",
        "board": safe.get("board") or "",
        "author": safe.get("author") or "",
        "pushes": pushes,
        "posted_at": posted_at,
        "fetched_at": fetched_at,
        "timestamp": posted_at,                    # legacy alias (round-3 M1)
        "source": "ptt",
        # Legacy extras preserved by the connector.
        "href": safe.get("href") or "",
        "heat": pushes,
        "date": safe.get("date") or "",
    }


def _normalize_dcard(raw):
    """Mirror of ``sources/dcard.js`` ``normalizeArticle``.

    Field mapping (see the M2 closing report table):

    ==================  ==========================================
    Article key         Dcard raw source
    ==================  ==========================================
    ``title``           ``title`` (``""`` fallback)
    ``url`` / ``href``  ``https://www.dcard.tw/f/{forumAlias}/p/{id}``
                        (``""`` when either part is missing)
    ``board``           ``forum.name`` → ``forumAlias`` fallback
    ``author``          ``user.nickname`` → ``user.id`` fallback
    ``pushes``/``heat`` ``reactionCount`` (NOT likeCount /
                        commentCount), clamped to a non-negative int
    ``posted_at``       ``createdAt`` (ISO 8601) → ``now()`` fallback
    ``fetched_at``      ``new Date().toISOString()`` at normalize time
    ``timestamp``       legacy alias equal to ``posted_at`` (round-3 M1)
    ``date``            first 10 chars of posted_at (``YYYY-MM-DD``)
    ``source``          literal ``'dcard'``
    ==================  ==========================================
    """
    safe = raw or {}
    user = safe.get("user") or {}
    forum = safe.get("forum") or {}

    forum_alias = safe.get("forumAlias") or forum.get("alias") or ""
    forum_name = forum.get("name") or forum_alias or ""
    post_id = "" if safe.get("id") is None else str(safe.get("id"))
    title = safe.get("title") or ""
    author = user.get("nickname") or user.get("id") or ""
    pushes = _to_non_negative_int(safe.get("reactionCount"))
    posted_at = safe.get("createdAt") or _iso_now()
    fetched_at = _iso_now()

    date = ""
    if isinstance(posted_at, str) and len(posted_at) >= 10:
        date = posted_at[:10]

    href = (
        "https://www.dcard.tw/f/{}/p/{}".format(forum_alias, post_id)
        if (forum_alias and post_id)
        else ""
    )

    return {
        "title": title,
        "url": href,
        "board": forum_name or forum_alias,
        "author": author,
        "pushes": pushes,
        "posted_at": posted_at,
        "fetched_at": fetched_at,
        "timestamp": posted_at,                    # legacy alias (round-3 M1)
        "source": "dcard",
        # Legacy extras preserved by the connector.
        "date": date,
        "href": href,
        "heat": pushes,
    }


_NORMALIZERS = {
    "ptt": _normalize_ptt,
    "dcard": _normalize_dcard,
}


def apply_since_filter_ptt(articles, since_raw):
    """Mirror of ``sources/ptt.js`` ``PttConnector.fetch`` since-filter logic.

    Filters a list of PTT raw articles (``{date: " M/D", ...}`` shape)
    to keep only those whose parsed ``posted_at`` (via
    :func:`parsePtt_date`) is within ``PTT_SINCE_GRACE_MS`` of the
    caller's ``since`` cutoff.

    Behaviour matches the production helper:

      * ``since_raw`` ``None`` / empty / whitespace / unparseable →
        **all** articles survive (round-1 fallback, no filter applied;
        ``thresholdMs == None`` in the JS code path).
      * An article whose parsed ``posted_at`` is unparseable keeps
        the article (defensive default in :func:`parsePtt_date` means
        this only fires on truly corrupt input).
      * Otherwise: keeps articles whose ``posted_at_ms >= since_ms -
        PTT_SINCE_GRACE_MS`` (i.e. inside the 24h grace window).

    Note
    ----
    The JS production code calls ``Date.parse(parsePttDate(article.date))``
    inline — there is no separately named ``applySinceFilter`` helper.
    The ``now`` reference is the actual wall-clock at ``fetch`` time, so
    callers wanting deterministic tests should pin ``now`` via the
    ``ctx.now`` parameter to ``PttConnector.fetch``.  This Python mirror
    uses ``now=None`` (wall clock) for raw-mode parity.
    """
    since_ms = parse_since_ms(since_raw)
    if since_ms is None:
        return list(articles)

    threshold_ms = since_ms - PTT_SINCE_GRACE_MS
    out = []
    for art in articles:
        posted_iso = parsePtt_date((art or {}).get("date"))
        candidate_ms = parse_since_ms(posted_iso)
        # Defensive: if posted_at is unparseable, keep the article.
        if candidate_ms is None or candidate_ms >= threshold_ms:
            out.append(art)
    return out


def filter_by_posted_at(articles, since_raw):
    """PTT-style grace-filter on already-normalized Articles.

    Mirrors the *post-condition* of ``sources/ptt.js`` ``PttConnector.fetch``
    on normalized Articles: keeps any article whose ``posted_at`` (ISO 8601)
    is within ``PTT_SINCE_GRACE_MS`` (24h) of the caller's ``since`` cutoff.

    Used by the round-3 M3 fixture tests because they assert on the
    Article ``posted_at`` field (which is already an ISO 8601 string in
    the normalized schema), rather than on the raw PTT ``" M/D"`` ``date``
    column.  Behaviour:

      * ``since_raw`` ``None`` / empty / whitespace / unparseable →
        **all** articles survive (round-1 fallback, no filter applied).
      * Article with ``posted_at`` ``None`` / unparseable / missing →
        kept (defensive default — we don't silently drop data).
      * Article with ``posted_at`` ``>= since - 24h`` → kept.
      * Article with ``posted_at`` ``< since - 24h`` → dropped (outside
        the 24h grace window).
    """
    since_ms = parse_since_ms(since_raw)
    if since_ms is None:
        return list(articles)

    threshold_ms = since_ms - PTT_SINCE_GRACE_MS
    out = []
    for art in articles:
        posted = (art or {}).get("posted_at")
        candidate_ms = parse_since_ms(posted)
        # Defensive: if posted_at is None / unparseable, keep the article.
        if candidate_ms is None or candidate_ms >= threshold_ms:
            out.append(art)
    return out


def normalize_article(source_name, raw):
    """Mirror of the round-2 ``SourceConnector.normalize`` hooks.

    Dispatches on ``source_name`` (``'ptt'`` / ``'dcard'``) exactly the
    way ``tracker.js`` picks a connector out of its source registry, and
    returns the unified Article dict for that source.

    The function is **total** for known sources: a ``None`` / empty /
    sparse ``raw`` never raises, it just yields defensive defaults with
    every key of :data:`ARTICLE_KEYS` present.

    Parameters
    ----------
    source_name : str
        Source identifier; case-insensitive.  Unknown names raise
        ``ValueError`` (the orchestrator's registry lookup would return
        ``undefined`` and skip the source — a mirror can be stricter
        because a typo'd fixture is always a test bug).
    raw : mapping | None
        Source-native raw post payload.

    Returns
    -------
    dict
        Unified Article with the keys of :data:`ARTICLE_KEYS`.
    """
    key = (source_name or "").strip().lower()
    normalizer = _NORMALIZERS.get(key)
    if normalizer is None:
        raise ValueError(
            "unknown source {!r}; known sources: {}".format(
                source_name, sorted(_NORMALIZERS)
            )
        )
    return normalizer(raw)
