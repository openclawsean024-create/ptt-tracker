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
"""

from __future__ import annotations

import json
import os
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
