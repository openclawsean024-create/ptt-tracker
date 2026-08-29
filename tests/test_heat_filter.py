"""
``min_heat`` filter tests.

The production rule (from ``tracker.js`` ``checkBoards`` and
``api/tracker.js`` ``checkBoards``) is::

    if (article.heat >= minHeat) newArticles.push(article);

Edge cases we cover:

* Threshold applied correctly (>=, not >)
* Articles with ``heat == min_heat`` are kept
* Articles with ``heat < min_heat`` are dropped
* Empty article list → empty result
* Default ``min_heat`` semantics when ``min_heat`` is missing
  (production code uses ``config.min_heat ?? 1``, so 1 is the
  effective floor when the config field is omitted)
* Non-numeric ``heat`` values are coerced to 0 (defensive)
* Order is preserved
"""

from __future__ import annotations

import pytest

from tests._pure_mirrors import filter_by_heat


# ---------------------------------------------------------------------------
# Threshold behavior — the >= rule
# ---------------------------------------------------------------------------


def test_filter_keeps_articles_meeting_threshold(sample_articles):
    """All articles with heat >= min_heat are kept."""
    min_heat = 10
    result = filter_by_heat(sample_articles, min_heat)

    heats = [a["heat"] for a in result]
    assert all(h >= min_heat for h in heats)
    # 87, 42, 100 → all >= 10 ; 5 and 0 → dropped
    assert sorted(heats) == [42, 87, 100]


def test_filter_keeps_articles_at_exact_threshold():
    """Boundary: heat == min_heat is kept (>=, not >)."""
    articles = [
        {"title": "edge-equal", "heat": 10},
        {"title": "edge-just-below", "heat": 9},
    ]

    result = filter_by_heat(articles, min_heat=10)

    titles = [a["title"] for a in result]
    assert titles == ["edge-equal"]


def test_filter_drops_all_below_threshold():
    """When *every* article is below threshold, result is empty."""
    articles = [
        {"title": "low-1", "heat": 1},
        {"title": "low-2", "heat": 0},
        {"title": "low-3", "heat": -5},
    ]

    result = filter_by_heat(articles, min_heat=5)

    assert result == []


def test_filter_keeps_all_above_threshold():
    """When *every* article clears the threshold, result == input."""
    articles = [
        {"title": "high-1", "heat": 100},
        {"title": "high-2", "heat": 99},
    ]

    result = filter_by_heat(articles, min_heat=10)

    assert [a["title"] for a in result] == ["high-1", "high-2"]


# ---------------------------------------------------------------------------
# Empty inputs
# ---------------------------------------------------------------------------


def test_filter_empty_article_list_returns_empty():
    assert filter_by_heat([], min_heat=10) == []


def test_filter_with_zero_threshold_returns_all(sample_articles):
    """min_heat=0 keeps everything (boundary)."""
    result = filter_by_heat(sample_articles, min_heat=0)

    assert len(result) == len(sample_articles)


# ---------------------------------------------------------------------------
# Missing / weird heat values
# ---------------------------------------------------------------------------


def test_filter_missing_heat_field_treated_as_zero():
    """Articles without a ``heat`` key are treated as 0 (matches
    ``parseArticles`` which always emits a numeric field, but
    defensive coding on the mirror side keeps a missing key from
    crashing).
    """
    articles = [
        {"title": "no-heat-key"},          # missing heat
        {"title": "zero-heat", "heat": 0},
        {"title": "high-heat", "heat": 50},
    ]

    result = filter_by_heat(articles, min_heat=1)

    titles = [a["title"] for a in result]
    assert titles == ["high-heat"]


def test_filter_non_numeric_heat_treated_as_zero():
    """Defensive: garbage ``heat`` values are coerced to 0."""

    articles = [
        {"title": "garbage", "heat": "not-a-number"},
        {"title": "none", "heat": None},
        {"title": "ok", "heat": 50},
    ]

    result = filter_by_heat(articles, min_heat=1)

    titles = [a["title"] for a in result]
    assert titles == ["ok"]


# ---------------------------------------------------------------------------
# Ordering & idempotency
# ---------------------------------------------------------------------------


def test_filter_preserves_input_order():
    """Stability: order is preserved (matches JS ``filter`` semantics)."""
    articles = [
        {"title": "a", "heat": 100},
        {"title": "b", "heat": 5},     # drops out
        {"title": "c", "heat": 50},
        {"title": "d", "heat": 9},     # drops out
        {"title": "e", "heat": 20},
    ]

    result = filter_by_heat(articles, min_heat=10)

    assert [a["title"] for a in result] == ["a", "c", "e"]


def test_filter_does_not_mutate_input(sample_articles):
    """The mirror must not mutate the caller's list."""
    before = [dict(a) for a in sample_articles]
    filter_by_heat(sample_articles, min_heat=10)
    assert sample_articles == before


# ---------------------------------------------------------------------------
# Realistic default — production uses min_heat ?? 1 when config omits it
# ---------------------------------------------------------------------------


def test_filter_default_threshold_one_keeps_anything_positive(sample_articles):
    """With ``min_heat=1`` (the JS ``?? 1`` default), only
    pushes==0 articles are dropped — matches the JS guard.
    """
    result = filter_by_heat(sample_articles, min_heat=1)

    titles = [a["title"] for a in result]
    # 'v3' article with pushes=0 is the only one dropped
    assert len(result) == 4
    assert "v3" not in " ".join(titles).lower().replace("[公告]", "v3")


def test_filter_strict_threshold_one_hundred_keeps_only_top(sample_articles):
    """Very strict: only heat >= 100 survives (catches > vs >= bugs)."""
    result = filter_by_heat(sample_articles, min_heat=100)

    titles = [a["title"] for a in result]
    assert titles == ["[爆] 特價 Mac mini M2 限時搶購"]
