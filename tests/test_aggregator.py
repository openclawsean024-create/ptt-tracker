"""
Round-5 M2 qa fixture — ``sources/aggregator.js`` mirrors.

These tests pin the contract of ``dedup_articles`` and ``rank_by_heat``
in ``tests/_pure_mirrors.py`` (the Python mirrors of the round-4 JS
aggregator).  The mirror and aggregator must agree byte-for-byte; the
pytest suite asserts the mirror behaviour here and the JS behaviour is
exercised end-to-end via the ``rpb-backend-m1-verify.log`` JS smoke run.

The fixture mirrors the round-2 / round-3 test layout — one
Python test file per round-4 milestone (M2 = aggregator).  Style,
parametrize patterns, and total-function guarantees follow the
existing source / dcard / keyword / heat / since-filter tests.
"""

from __future__ import annotations

import copy

import pytest

from tests._pure_mirrors import dedup_articles, rank_by_heat


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _art(url=None, title="sample", board="MacShop", author="u", pushes=0,
        source="ptt", posted_at="2026-03-27T00:00:00.000Z", timestamp=None,
        heat=None, date=None, href=None):
    """Tiny helper to build canonical Article-shaped dicts.

    Defaults are strings / numeric primitives (not ``None``) so callers
    can distinguish "not specified" from "explicitly empty / missing".
    Tests wanting ``title=""`` or ``source=None`` should pass the value
    explicitly.

    Round-3's 12-key Article schema is preserved (posted_at /
    timestamp-alias are passed through verbatim; legacy date / href /
    heat are populated when not None).
    """
    out = {
        "title": title,
        "url": url if url is not None else "",
        "board": board,
        "author": author,
        "pushes": pushes,
        "posted_at": posted_at,
        "source": source,
    }
    if timestamp is not None:
        out["timestamp"] = timestamp
    else:
        out["timestamp"] = posted_at
    if heat is not None:
        out["heat"] = heat
    if date is not None:
        out["date"] = date
    if href is not None:
        out["href"] = href
    else:
        if url:
            out["href"] = url
    return out


# ---------------------------------------------------------------------------
# dedup_articles — defensive defaults
# ---------------------------------------------------------------------------


def test_dedup_returns_empty_for_None():
    assert dedup_articles(None) == []


def test_dedup_returns_empty_for_empty_list():
    assert dedup_articles([]) == []


def test_dedup_returns_empty_for_non_list_input():
    assert dedup_articles("not a list") == []
    assert dedup_articles(42) == []
    assert dedup_articles({}) == []


def test_dedup_skips_non_dict_entries():
    """Production's ``safe = art || {}`` shields against non-dict noise."""
    art = _art(url="https://x/1", pushes=5)
    out = dedup_articles([art, "bad", None, 42, art])
    # `art, art` is one merge, so a single dict should come back;
    # the extra non-dict items get skipped silently.
    assert len(out) == 1
    assert out[0]["pushes"] == 5


# ---------------------------------------------------------------------------
# dedup_articles — URL primary key (cross-source case)
# ---------------------------------------------------------------------------


def test_dedup_collapses_same_url_across_sources_into_one_article():
    """URL primary key: two articles with the EXACT same canonical URL
    (e.g. a content-aggregator mirror of a story) must merge via URL
    primary key regardless of timestamp."""
    same_url = "https://www.example-aggregator.com/article/12345"
    ptt = _art(url=same_url, title="iphone 15", board="MacShop",
               pushes=87, source="ptt",
               posted_at="2026-03-27T00:00:00.000Z")
    dcard = _art(url=same_url, title="iphone 15", board="3C",
                 pushes=50, source="dcard",
                 posted_at="2026-03-27T03:00:00.000Z")
    out = dedup_articles([ptt, dcard])

    assert len(out) == 1
    merged = out[0]
    assert merged["_sourceCount"] == 2
    assert merged["_mergedSources"] == ["dcard", "ptt"]
    assert merged["_totalPushes"] == 87            # max, not sum (137)
    assert merged["pushes"] == 87                 # mirror updates `pushes` too
    assert merged["heat"] == 87                   # mirror mirrors round-3 `heat` alias


def test_dedup_different_url_different_timestamp_keeps_separate():
    """Complement to the URL-match test: when both URL and timestamp
    differ, production does NOT bucket-by-day — articles stay
    separate (calendar-bucketing would be a future round-5+ decision)."""
    ptt = _art(url="https://www.ptt.cc/bbs/MacShop/M.1.html",
               title="iphone 15", pushes=80,
               source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    dcard = _art(url="https://www.dcard.tw/f/3c/p/1",
                 title="iphone 15", pushes=40,
                 source="dcard", posted_at="2026-03-27T03:00:00.000Z")
    out = dedup_articles([ptt, dcard])
    assert len(out) == 2
    for art in out:
        assert art["_sourceCount"] == 1


def test_dedup_normalises_url_case_and_trailing_slash():
    """Trailing slash and case-folded URLs collapse to the same key."""
    art_a = _art(url="https://Www.Ptt.cc/bbs/MacShop/M.1.html/",
                 title="x", pushes=10, source="ptt")
    art_b = _art(url="https://www.ptt.cc/bbs/MacShop/M.1.html",
                 title="x", pushes=20, source="dcard")
    out = dedup_articles([art_a, art_b])
    assert len(out) == 1
    assert out[0]["_sourceCount"] == 2
    assert out[0]["_totalPushes"] == 20


# ---------------------------------------------------------------------------
# dedup_articles — same-source duplication (round-2 M3 finding #2)
# ---------------------------------------------------------------------------


def test_dedup_same_url_same_source_keeps_max_heat_but_count_stays_one():
    """``Number.isFinite(raw.pushes) ? raw.pushes : 0`` style — we
    explicitly compute max, not sum.  ``_sourceCount`` does NOT inflate
    on a same-source duplicate fetch (the JS code clears the
    ``_mergedSources`` check before incrementing the count).
    """
    fetch_a = _art(url="https://x/1", title="dup", pushes=10,
                   source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    fetch_b = _art(url="https://x/1", title="dup", pushes=33,
                   source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    out = dedup_articles([fetch_a, fetch_b])
    assert len(out) == 1
    assert out[0]["_sourceCount"] == 1                    # not 2!
    assert out[0]["_mergedSources"] == ["ptt"]
    assert out[0]["_totalPushes"] == 33                   # max
    assert out[0]["pushes"] == 33


# ---------------------------------------------------------------------------
# dedup_articles — tuple fallback (cross-source, different URLs)
# ---------------------------------------------------------------------------


def test_dedup_uses_tuple_fallback_when_url_differs_but_story_matches():
    """Cross-source same-story via different canonical URLs (PTT vs
    Dcard) merges via the (title, posted_at) tuple."""
    ptt = _art(url="https://www.ptt.cc/bbs/MacShop/M.111.html",
               title="iphone 15 開箱", pushes=80, source="ptt",
               posted_at="2026-03-27T00:00:00.000Z")
    dcard = _art(url="https://www.dcard.tw/f/3c/p/999",
                 title="iphone 15 開箱", pushes=40, source="dcard",
                 posted_at="2026-03-27T00:00:00.000Z")
    out = dedup_articles([ptt, dcard])
    assert len(out) == 1
    assert out[0]["_sourceCount"] == 2
    assert sorted(out[0]["_mergedSources"]) == ["dcard", "ptt"]
    assert out[0]["_totalPushes"] == 80


def test_dedup_tuple_fallback_is_case_insensitive_on_title():
    a = _art(url="https://a/1", title="iPhone 15", pushes=10,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://b/2", title="IPHONE 15", pushes=20,
             source="dcard", posted_at="2026-03-27T00:00:00.000Z")
    assert len(dedup_articles([a, b])) == 1


def test_dedup_tuple_fallback_trims_whitespace():
    a = _art(url="https://a/1", title="  iphone 15 ", pushes=10,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://b/2", title="iphone 15", pushes=20,
             source="dcard", posted_at="2026-03-27T00:00:00.000Z")
    assert len(dedup_articles([a, b])) == 1


def test_dedup_no_key_articles_stay_separate():
    """An article with empty url AND empty (title, posted_at) has no
    stable key; it stays as its own entry.  (Defensive — production
    connector normalizers always populate at least one of these.)"""
    a = _art(url="", title="", board="?", pushes=5,
             source="ptt", posted_at="")
    b = _art(url="", title="", board="?", pushes=7,
             source="dcard", posted_at="")
    out = dedup_articles([a, b])
    # Both have empty tuple key; no URL key → no merge.
    assert len(out) == 2


# ---------------------------------------------------------------------------
# dedup_articles — input ordering preserved
# ---------------------------------------------------------------------------


def test_dedup_preserves_first_seen_order_for_disjoint_articles():
    a = _art(url="https://a", title="a", pushes=10,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://b", title="b", pushes=20,
             source="dcard", posted_at="2026-03-26T00:00:00.000Z")
    c = _art(url="https://c", title="c", pushes=5,
             source="ptt", posted_at="2026-03-27T01:00:00.000Z")
    titles = [x["title"] for x in dedup_articles([a, b, c])]
    assert titles == ["a", "b", "c"]


# ---------------------------------------------------------------------------
# dedup_articles — aggregator-private fields are always present
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "art_kwargs, expected_merged_sources",
    [
        ({"source": None}, []),
        ({"url": "https://x", "title": "x", "source": None}, []),
        ({"url": "https://y", "title": "y", "source": "ptt"}, ["ptt"]),
        ({"source": "dcard"}, ["dcard"]),
    ],
)
def test_dedup_output_always_carries_aggregator_private_fields(art_kwargs, expected_merged_sources):
    art = _art(**art_kwargs)
    out = dedup_articles([art])
    assert len(out) == 1
    merged = out[0]
    for field in ("_sourceCount", "_totalPushes", "_mergedSources"):
        assert field in merged, f"missing {field} on {merged!r}"
    assert merged["_sourceCount"] == 1
    assert merged["_mergedSources"] == expected_merged_sources


def test_dedup_coerces_non_numeric_pushes_to_zero():
    art = _art(url="https://x/1", pushes="not-a-number",
               source="ptt")
    # Fresh article initialises pushes to 0; mirrors production.
    out = dedup_articles([art])
    assert out[0]["pushes"] == 0
    assert out[0]["_totalPushes"] == 0


# ---------------------------------------------------------------------------
# dedup_articles — three-way merges (3 platforms, same story)
# ---------------------------------------------------------------------------


def test_dedup_three_source_merge_keeps_distinct_sources_and_max():
    a = _art(url="https://x/1", title="story", pushes=10,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://y/2", title="story", pushes=30,
             source="dcard", posted_at="2026-03-27T00:00:00.000Z")
    c = _art(url="https://z/3", title="story", pushes=20,
             source="threads", posted_at="2026-03-27T00:00:00.000Z")
    out = dedup_articles([a, b, c])
    assert len(out) == 1
    assert out[0]["_sourceCount"] == 3
    assert sorted(out[0]["_mergedSources"]) == ["dcard", "ptt", "threads"]
    assert out[0]["_totalPushes"] == 30   # max


# ---------------------------------------------------------------------------
# rank_by_heat — defensive defaults
# ---------------------------------------------------------------------------


def test_rank_returns_empty_for_None():
    assert rank_by_heat(None) == []


def test_rank_returns_empty_for_empty_list():
    assert rank_by_heat([]) == []


def test_rank_passes_through_single_article():
    art = _art(title="only", pushes=10)
    out = rank_by_heat([art])
    assert out == [art]


# ---------------------------------------------------------------------------
# rank_by_heat — comparator semantics
# ---------------------------------------------------------------------------


def test_rank_cross_source_first_within_tie_breaks_by_heat():
    ptt = _art(title="ptt-only", url="https://a", pushes=999,
               source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    cross = _art(title="multi", url="https://b", pushes=10,
                 source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    cross2 = _art(title="multi", url="https://c", pushes=10,
                  source="dcard", posted_at="2026-03-27T00:00:00.000Z")

    # Pretend the cross entries got merged via dedup elsewhere.  Here
    # we just inject the merged-into list directly.
    multi_merged = dict(cross)
    multi_merged.update({
        "_sourceCount": 2,
        "_totalPushes": 10,
        "_mergedSources": ["dcard", "ptt"],
    })

    ptt = dict(ptt)
    ptt.update({"_sourceCount": 1, "_totalPushes": 999,
                "_mergedSources": ["ptt"]})

    ranked = rank_by_heat([ptt, multi_merged])
    # cross-source first regardless of heat value
    assert ranked[0] is multi_merged
    assert ranked[1] is ptt


def test_rank_within_tier_orders_by_total_pushes_desc():
    big = _art(title="big", url="https://a", pushes=200,
               source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    small = _art(title="small", url="https://b", pushes=10,
                source="ptt", posted_at="2026-03-27T00:00:00.000Z")

    for art in (big, small):
        art.update({"_sourceCount": 1, "_totalPushes": art["pushes"],
                    "_mergedSources": ["ptt"]})

    assert rank_by_heat([small, big])[0] is big
    assert rank_by_heat([big, small])[0] is big


def test_rank_within_heat_tie_orders_by_posted_at_desc():
    later = _art(title="t", url="https://a", pushes=10,
                 source="ptt", posted_at="2026-03-27T03:00:00.000Z")
    earlier = _art(title="t", url="https://b", pushes=10,
                   source="ptt", posted_at="2026-03-27T01:00:00.000Z")
    for art in (later, earlier):
        art.update({"_sourceCount": 1, "_totalPushes": 10,
                    "_mergedSources": ["ptt"]})

    ranked = rank_by_heat([earlier, later])
    assert ranked[0] is later
    assert ranked[1] is earlier


def test_rank_falls_back_to_pushes_when_no_total_pushes():
    """``_totalPushes`` falls back to ``pushes`` for compatibility with
    round-3 callers that hand un-augmented articles to rank_by_heat."""
    a = _art(title="a", url="https://a", pushes=10, source="ptt")
    b = _art(title="b", url="https://b", pushes=5, source="ptt")
    a["_sourceCount"] = 1
    a["_mergedSources"] = ["ptt"]
    b["_sourceCount"] = 1
    b["_mergedSources"] = ["ptt"]
    assert rank_by_heat([b, a])[0] is a


def test_rank_stable_for_complete_ties():
    a = _art(title="a", url="https://a", pushes=10,
             source="ptt", posted_at="2026-03-27T01:00:00.000Z")
    b = _art(title="b", url="https://b", pushes=10,
             source="ptt", posted_at="2026-03-27T01:00:00.000Z")
    for art in (a, b):
        art.update({"_sourceCount": 1, "_totalPushes": 10,
                    "_mergedSources": ["ptt"]})

    out = rank_by_heat([a, b])
    assert out[0] is a and out[1] is b


# ---------------------------------------------------------------------------
# Integration — dedup + rank together (round-4 orchestrator behavior)
# ---------------------------------------------------------------------------


def test_full_pipeline_dedup_then_rank_orders_cross_source_first():
    a = _art(url="https://a/1", title="solo", pushes=500,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://b/1", title="shared", pushes=20,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    c = _art(url="https://c/1", title="shared", pushes=15,
             source="dcard", posted_at="2026-03-27T00:00:00.000Z")

    out = dedup_articles([a, b, c])
    ranked = rank_by_heat(out)

    # The merged "shared" should outrank the solo ptt article because
    # _sourceCount=2 > 1, even though solo has 25x the heat.
    titles = [r["title"] for r in ranked]
    assert titles == ["shared", "solo"]


def test_full_pipeline_empty_input_returns_empty():
    assert rank_by_heat(dedup_articles([])) == []
    assert dedup_articles(None) == []
    assert rank_by_heat(None) == []


def test_dedup_then_rank_idempotent():
    """Running dedup + rank twice yields the same order (rank is
    idempotent for already-merged articles; dedup of an already-deduped
    list is a no-op)."""
    a = _art(url="https://a", title="a", pushes=10,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://b", title="b", pushes=5,
             source="dcard", posted_at="2026-03-27T00:00:00.000Z")
    c = _art(url="https://c", title="c", pushes=2,
             source="ptt", posted_at="2026-03-27T01:00:00.000Z")

    once = rank_by_heat(dedup_articles([a, b, c]))
    twice = rank_by_heat(dedup_articles(once))
    # Second pass should not re-merge (the once entries already have
    # accurate _mergedSources) and not change order.
    assert [x["title"] for x in once] == [x["title"] for x in twice]


def test_aggregator_does_not_mutate_caller_input():
    """``dedup`` and ``rank`` are pure — they must never mutate the
    caller's Article dicts in place."""
    a = _art(url="https://a", title="a", pushes=10,
             source="ptt", posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://a", title="a", pushes=20,
             source="dcard", posted_at="2026-03-27T00:00:00.000Z")
    original_a = copy.deepcopy(a)
    original_b = copy.deepcopy(b)

    dedup_articles([a, b])
    rank_by_heat([a, b])

    assert a == original_a
    assert b == original_b


def test_rank_output_is_a_new_list_not_in_place_sort():
    a = _art(url="https://a", title="a", pushes=5, source="ptt",
             posted_at="2026-03-27T00:00:00.000Z")
    b = _art(url="https://b", title="b", pushes=50, source="dcard",
             posted_at="2026-03-27T00:00:00.000Z")
    for art in (a, b):
        art.update({"_sourceCount": 1, "_totalPushes": art["pushes"],
                    "_mergedSources": [art["source"]]})
    # Ensure rank doesn't mutate input order
    input_list = [a, b]  # a is first despite b having more heat
    out = rank_by_heat(input_list)
    assert input_list[0] is a  # input list untouched
    assert out[0] is b  # but the output is sorted
    assert out[1] is a
