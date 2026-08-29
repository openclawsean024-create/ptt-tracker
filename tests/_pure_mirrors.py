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
from datetime import datetime, timezone
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
# is::
#
#     { title, url, board, author, pushes, timestamp, source }
#
# Both concrete connectors additionally emit three *legacy* extras
# (``date`` / ``href`` / ``heat``) so round-1 consumers and the existing
# heat-filter mirror keep working.  Full Article = 10 keys.

#: The 7 keys every source MUST emit (the cross-source contract).
UNIFIED_ARTICLE_KEYS = (
    "title",
    "url",
    "board",
    "author",
    "pushes",
    "timestamp",
    "source",
)

#: Round-1 compatibility extras every round-2 connector also emits.
LEGACY_ARTICLE_KEYS = ("date", "href", "heat")

#: Full key set of a normalized Article (unified + legacy).
ARTICLE_KEYS = UNIFIED_ARTICLE_KEYS + LEGACY_ARTICLE_KEYS


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
    """Mirror of ``sources/ptt.js`` ``PttConnector.normalize``.

    Production reads ``Number.isFinite(raw.pushes) ? raw.pushes : 0``,
    i.e. **only** a real JS number survives — a numeric *string* is not
    finite in that check and becomes ``0``.  Booleans are not numbers in
    JS either, so they also become ``0``.  ``timestamp`` is stamped at
    normalize time (``new Date().toISOString()``); ``source`` is the
    connector's ``name``.
    """
    safe = raw or {}
    pushes = safe.get("pushes")
    if isinstance(pushes, bool) or not isinstance(pushes, (int, float)):
        pushes = 0

    return {
        "title": safe.get("title") or "",
        "url": safe.get("url") or "",
        "board": safe.get("board") or "",
        "author": safe.get("author") or "",
        "pushes": pushes,
        "timestamp": _iso_now(),
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
    ``timestamp``       ``createdAt`` (ISO 8601) → ``now()`` fallback
    ``date``            first 10 chars of timestamp (``YYYY-MM-DD``)
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
    timestamp = safe.get("createdAt") or _iso_now()

    date = ""
    if isinstance(timestamp, str) and len(timestamp) >= 10:
        date = timestamp[:10]

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
        "timestamp": timestamp,
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
