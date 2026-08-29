"""
Unified Article schema tests (round-2 M3).

Contract under test
-------------------
``sources/SourceConnector.js`` documents a single Article shape that
**every** source must emit::

    { title, url, board, author, pushes, timestamp, source }

Both round-2 connectors (``sources/ptt.js``, ``sources/dcard.js``)
additionally carry three round-1 legacy extras (``date`` / ``href`` /
``heat``), so a normalized Article has 10 keys total.

These tests drive the Python mirror
(``tests/_pure_mirrors.normalize_article``) rather than the Node
production code — same pattern round-1 established for
``load_config_with_env`` / ``match_keywords`` / ``filter_by_heat``.
The mirror's job is to pin the contract; drift between mirror and
production is reported to the backend owner, never patched here.

Coverage:

* per-source: required keys present, source tag correct, defensive
  defaults on sparse input, no exception on ``None``
* cross-source: PTT and Dcard Articles have an identical key set
* regression guard: ``pushes`` is always an ``int``, never a string
"""

from __future__ import annotations

import pytest

from tests._dcard_fixtures import (
    ALL_DCARD_RAW,
    ALL_PTT_RAW,
    RAW_DCARD_POST,
    RAW_DCARD_POST_HIGH_REACTION,
    RAW_DCARD_POST_SPARSE,
    RAW_PTT_POST,
    RAW_PTT_POST_EXPLODED,
    RAW_PTT_POST_SPARSE,
    raw,
)
from tests._pure_mirrors import (
    ARTICLE_KEYS,
    UNIFIED_ARTICLE_KEYS,
    filter_by_heat,
    normalize_article,
)


# ---------------------------------------------------------------------------
# PTT source — schema conformance
# ---------------------------------------------------------------------------


def test_ptt_article_has_all_unified_keys():
    """A normalized PTT Article carries every required unified key."""
    article = normalize_article("ptt", raw(RAW_PTT_POST))

    missing = [k for k in UNIFIED_ARTICLE_KEYS if k not in article]
    assert missing == []


def test_ptt_article_field_values_come_from_raw():
    """PTT normalize is a pass-through for the round-1 field names."""
    source_raw = raw(RAW_PTT_POST)

    article = normalize_article("ptt", source_raw)

    assert article["title"] == source_raw["title"]
    assert article["url"] == source_raw["url"]
    assert article["board"] == source_raw["board"]
    assert article["author"] == source_raw["author"]
    assert article["pushes"] == source_raw["pushes"]


def test_ptt_article_is_tagged_with_ptt_source():
    """``source`` identifies the connector that produced the Article."""
    article = normalize_article("ptt", raw(RAW_PTT_POST_EXPLODED))

    assert article["source"] == "ptt"


def test_ptt_sparse_raw_gets_defensive_defaults():
    """A raw post with only a title still yields a complete Article."""
    article = normalize_article("ptt", raw(RAW_PTT_POST_SPARSE))

    assert set(article) == set(ARTICLE_KEYS)
    assert article["title"] == RAW_PTT_POST_SPARSE["title"]
    assert article["url"] == ""
    assert article["board"] == ""
    assert article["author"] == ""
    assert article["pushes"] == 0


def test_ptt_preserves_round_1_legacy_extras():
    """``heat`` / ``href`` / ``date`` survive so round-1 consumers keep working."""
    article = normalize_article("ptt", raw(RAW_PTT_POST))

    assert article["heat"] == article["pushes"]
    assert article["href"] == RAW_PTT_POST["href"]
    assert article["date"] == RAW_PTT_POST["date"]


@pytest.mark.parametrize("label,payload", ALL_PTT_RAW, ids=[p[0] for p in ALL_PTT_RAW])
def test_ptt_every_scenario_yields_full_schema(label, payload):
    """Every PTT fixture scenario produces the exact 10-key Article."""
    article = normalize_article("ptt", raw(payload))

    assert set(article) == set(ARTICLE_KEYS), label


# ---------------------------------------------------------------------------
# Dcard source — schema conformance
# ---------------------------------------------------------------------------


def test_dcard_article_has_all_unified_keys():
    """A normalized Dcard Article carries every required unified key."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST))

    missing = [k for k in UNIFIED_ARTICLE_KEYS if k not in article]
    assert missing == []


def test_dcard_article_field_values_come_from_raw():
    """Dcard normalize maps its native field names onto the unified schema."""
    source_raw = raw(RAW_DCARD_POST)

    article = normalize_article("dcard", source_raw)

    assert article["title"] == source_raw["title"]
    assert article["board"] == source_raw["forum"]["name"]
    assert article["author"] == source_raw["user"]["nickname"]
    assert article["pushes"] == source_raw["reactionCount"]
    assert article["timestamp"] == source_raw["createdAt"]


def test_dcard_article_is_tagged_with_dcard_source():
    """``source`` identifies the connector that produced the Article."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_HIGH_REACTION))

    assert article["source"] == "dcard"


def test_dcard_sparse_raw_gets_defensive_defaults():
    """A minimal Dcard row still yields a complete Article."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_SPARSE))

    assert set(article) == set(ARTICLE_KEYS)
    assert article["title"] == RAW_DCARD_POST_SPARSE["title"]
    assert article["board"] == "3c"  # forumAlias fallback (no forum object)
    assert article["author"] == ""  # no user object at all
    assert article["pushes"] == 0  # no reactionCount


def test_dcard_preserves_round_1_legacy_extras():
    """``heat`` / ``href`` / ``date`` mirror the PTT extras for symmetry."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST))

    assert article["heat"] == article["pushes"]
    assert article["href"] == article["url"]
    assert article["date"] == RAW_DCARD_POST["createdAt"][:10]


@pytest.mark.parametrize(
    "label,payload", ALL_DCARD_RAW, ids=[p[0] for p in ALL_DCARD_RAW]
)
def test_dcard_every_scenario_yields_full_schema(label, payload):
    """Every Dcard fixture scenario produces the exact 10-key Article."""
    article = normalize_article("dcard", raw(payload))

    assert set(article) == set(ARTICLE_KEYS), label


# ---------------------------------------------------------------------------
# Cross-source consistency — the whole point of the abstraction
# ---------------------------------------------------------------------------


def test_ptt_and_dcard_articles_have_identical_key_sets():
    """The two sources are indistinguishable by shape (only by values)."""
    ptt_article = normalize_article("ptt", raw(RAW_PTT_POST))
    dcard_article = normalize_article("dcard", raw(RAW_DCARD_POST))

    assert set(ptt_article) == set(dcard_article)
    assert set(ptt_article) == set(ARTICLE_KEYS)


def test_all_fixtures_across_both_sources_share_one_key_set():
    """Key-set equality holds across every scenario, not just happy path."""
    key_sets = set()

    for _label, payload in ALL_PTT_RAW:
        key_sets.add(frozenset(normalize_article("ptt", raw(payload))))
    for _label, payload in ALL_DCARD_RAW:
        key_sets.add(frozenset(normalize_article("dcard", raw(payload))))

    assert len(key_sets) == 1
    assert key_sets.pop() == frozenset(ARTICLE_KEYS)


def test_source_field_distinguishes_the_two_sources():
    """Same shape, different ``source`` tag — dedup/routing relies on this."""
    ptt_article = normalize_article("ptt", raw(RAW_PTT_POST))
    dcard_article = normalize_article("dcard", raw(RAW_DCARD_POST))

    assert ptt_article["source"] != dcard_article["source"]
    assert {ptt_article["source"], dcard_article["source"]} == {"ptt", "dcard"}


def test_unknown_source_name_is_rejected():
    """A typo'd source name fails loudly instead of yielding a half Article."""
    with pytest.raises(ValueError):
        normalize_article("threads", raw(RAW_DCARD_POST))


# ---------------------------------------------------------------------------
# ``pushes`` numeric-type regression guard
# ---------------------------------------------------------------------------


def test_pushes_is_int_for_both_sources():
    """``pushes`` must be a real int — the heat filter compares numerically."""
    ptt_article = normalize_article("ptt", raw(RAW_PTT_POST))
    dcard_article = normalize_article("dcard", raw(RAW_DCARD_POST))

    assert isinstance(ptt_article["pushes"], int)
    assert not isinstance(ptt_article["pushes"], bool)
    assert isinstance(dcard_article["pushes"], int)
    assert not isinstance(dcard_article["pushes"], bool)


@pytest.mark.parametrize(
    "label,payload", ALL_DCARD_RAW, ids=[p[0] for p in ALL_DCARD_RAW]
)
def test_dcard_pushes_is_never_a_string(label, payload):
    """No Dcard scenario — including garbage input — leaks a string ``pushes``."""
    article = normalize_article("dcard", raw(payload))

    assert isinstance(article["pushes"], int), label
    assert not isinstance(article["pushes"], bool), label
    assert article["pushes"] >= 0, label


def test_heat_alias_matches_pushes_for_both_sources():
    """``heat`` is an alias of ``pushes``; round-1's filter reads ``heat``."""
    for source, payload in (("ptt", RAW_PTT_POST), ("dcard", RAW_DCARD_POST)):
        article = normalize_article(source, raw(payload))
        assert article["heat"] == article["pushes"]


def test_normalized_articles_flow_through_round_1_heat_filter():
    """Round-2 Articles remain compatible with the round-1 ``min_heat`` gate."""
    articles = [
        normalize_article("ptt", raw(RAW_PTT_POST)),  # pushes 87
        normalize_article("dcard", raw(RAW_DCARD_POST)),  # pushes 731
        normalize_article("dcard", raw(RAW_DCARD_POST_SPARSE)),  # pushes 0
    ]

    kept = filter_by_heat(articles, 50)

    assert len(kept) == 2
    assert {a["source"] for a in kept} == {"ptt", "dcard"}
