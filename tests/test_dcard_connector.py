"""
Dcard connector behaviour tests (round-2 M3).

Scope
-----
Pins the Dcard → Article translation documented in
``sources/dcard.js`` ``normalizeArticle`` (and tabulated in the M2
closing report), driven through the Python mirror
``tests/_pure_mirrors.normalize_article('dcard', raw)``.

**No network.**  Every input is a static fixture from
``tests/_dcard_fixtures``; the suite never reaches ``www.dcard.tw``
(production itself is env-gated behind ``DCARD_FETCH_ENABLED``, but
these tests do not even instantiate the connector).

Behaviours covered:

* URL construction — ``https://www.dcard.tw/f/{forumAlias}/p/{id}``
* ``source`` tag is always ``'dcard'`` (guards against a PTT fixture
  being routed through the Dcard normalizer, or vice versa)
* ``timestamp`` is ISO 8601 and parseable
* ``pushes`` reads ``reactionCount`` — NOT ``likeCount`` / ``commentCount``
* author fallback ``user.nickname`` → ``user.id`` → ``""``
* board fallback ``forum.name`` → ``forumAlias`` → ``""``
* defensive defaults for sparse / empty / ``None`` raw payloads
"""

from __future__ import annotations

from datetime import datetime

import pytest

from tests._dcard_fixtures import (
    ALL_DCARD_RAW,
    RAW_DCARD_POST,
    RAW_DCARD_POST_GARBAGE_REACTION,
    RAW_DCARD_POST_HIGH_REACTION,
    RAW_DCARD_POST_NEGATIVE_REACTION,
    RAW_DCARD_POST_NO_REACTION,
    RAW_DCARD_POST_NO_USER,
    RAW_DCARD_POST_SPARSE,
    RAW_DCARD_POST_ZERO_REACTION,
    RAW_PTT_POST,
    raw,
)
from tests._pure_mirrors import ARTICLE_KEYS, normalize_article


def _parse_iso8601(value):
    """Parse an ISO 8601 timestamp, tolerating the JS ``Z`` suffix.

    ``datetime.fromisoformat`` only learned to read ``Z`` in Python
    3.11; the repo's local interpreter is 3.9, so normalize the suffix
    first.  Raises ``ValueError`` when unparseable — which is exactly
    what the assertion wants to surface.
    """
    text = value
    if isinstance(text, str) and text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text)


# ---------------------------------------------------------------------------
# Happy path — full mapping table
# ---------------------------------------------------------------------------


def test_happy_path_matches_expected_article():
    """The documented Dcard → Article mapping, asserted field by field.

    ``posted_at`` mirrors ``raw.createdAt`` (post time).  ``fetched_at``
    is normalize-time (scrape time) — so this test only pins ``posted_at``
    to the fixture's known value (deterministic) and asserts the
    ``timestamp`` legacy alias equals ``posted_at``; the ``fetched_at``
    is verified by ``test_fetched_at_is_iso8601_now_like`` separately.
    """
    article = normalize_article("dcard", raw(RAW_DCARD_POST))

    assert article["title"] == "[心得] Mac mini M4 開箱與效能實測"
    assert article["url"] == "https://www.dcard.tw/f/3c/p/123456789"
    assert article["board"] == "3C"
    assert article["author"] == "applefans"
    assert article["pushes"] == 731
    assert article["posted_at"] == "2026-08-29T15:30:00.000Z"
    assert article["timestamp"] == article["posted_at"]  # legacy alias
    assert article["source"] == "dcard"
    assert article["date"] == "2026-08-29"
    assert article["href"] == "https://www.dcard.tw/f/3c/p/123456789"
    assert article["heat"] == 731
    assert "fetched_at" in article  # round-3 M1: now() stamp
    assert _parse_iso8601(article["fetched_at"]) is not None


def test_article_never_leaks_raw_dcard_only_fields():
    """Native Dcard-only keys (excerpt / school / media) stay out of the Article."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST))

    for leaked in ("excerpt", "school", "media", "gender", "commentCount", "likeCount"):
        assert leaked not in article


# ---------------------------------------------------------------------------
# source tag — cross-source contamination guard
# ---------------------------------------------------------------------------


def test_source_is_always_dcard():
    """Every Dcard fixture is tagged ``'dcard'``."""
    for _label, payload in ALL_DCARD_RAW:
        assert normalize_article("dcard", raw(payload))["source"] == "dcard"


def test_ptt_shaped_raw_routed_through_dcard_is_still_tagged_dcard():
    """The tag comes from the connector, not from the payload's own fields.

    Feeding a PTT-shaped dict to the Dcard normalizer must not silently
    produce a PTT-looking Article: the tag stays ``'dcard'`` and the
    PTT-native ``pushes`` value is ignored (Dcard reads
    ``reactionCount``).  This is the guard against fixture pollution.
    """
    article = normalize_article("dcard", raw(RAW_PTT_POST))

    assert article["source"] == "dcard"
    assert article["pushes"] == 0  # RAW_PTT_POST has no reactionCount
    assert article["url"] == ""  # no id / forumAlias to build a Dcard URL


# ---------------------------------------------------------------------------
# timestamp — ISO 8601
# ---------------------------------------------------------------------------


def test_timestamp_is_iso8601_parseable():
    """``createdAt`` passes through untouched and remains ISO 8601."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST))

    parsed = _parse_iso8601(article["timestamp"])

    assert parsed.year == 2026
    assert parsed.month == 8
    assert parsed.day == 29


@pytest.mark.parametrize(
    "label,payload", ALL_DCARD_RAW, ids=[p[0] for p in ALL_DCARD_RAW]
)
def test_every_scenario_has_a_parseable_timestamp(label, payload):
    """Even fixtures without ``createdAt`` get a parseable "now" stamp."""
    article = normalize_article("dcard", raw(payload))

    assert _parse_iso8601(article["timestamp"]) is not None, label


def test_missing_created_at_falls_back_to_now():
    """The sparse fixture has no ``createdAt``; normalize stamps one anyway."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_SPARSE))

    assert article["timestamp"]
    assert _parse_iso8601(article["timestamp"]) is not None


def test_date_is_the_first_ten_chars_of_timestamp():
    """``date`` is the ``YYYY-MM-DD`` short form used by the dedup hash."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_HIGH_REACTION))

    assert article["date"] == "2026-08-30"
    assert article["timestamp"].startswith(article["date"])


# ---------------------------------------------------------------------------
# url construction
# ---------------------------------------------------------------------------


def test_url_is_built_from_forum_alias_and_id():
    """Canonical post URL: ``https://www.dcard.tw/f/{forumAlias}/p/{id}``."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST))

    assert article["url"] == "https://www.dcard.tw/f/3c/p/123456789"


def test_url_uses_the_posts_own_forum_alias():
    """A ``trending`` post links into ``/f/trending/``, not a hardcoded board."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_HIGH_REACTION))

    assert article["url"] == "https://www.dcard.tw/f/trending/p/555000111"


def test_url_and_href_are_the_same_string():
    """``href`` is the legacy alias of ``url`` (round-1 consumers read ``href``)."""
    for _label, payload in ALL_DCARD_RAW:
        article = normalize_article("dcard", raw(payload))
        assert article["url"] == article["href"]


def test_url_is_empty_when_forum_alias_or_id_is_missing():
    """No half-built URLs: a missing part yields ``""``, not ``/f//p/123``."""
    no_alias = normalize_article("dcard", {"id": 42, "title": "x"})
    no_id = normalize_article("dcard", {"forumAlias": "3c", "title": "x"})

    assert no_alias["url"] == ""
    assert no_id["url"] == ""


# ---------------------------------------------------------------------------
# pushes — reactionCount, and nothing else
# ---------------------------------------------------------------------------


def test_pushes_reads_reaction_count_not_like_or_comment_count():
    """The three counters differ, so a mis-wired field would be obvious."""
    source_raw = raw(RAW_DCARD_POST_HIGH_REACTION)

    article = normalize_article("dcard", source_raw)

    assert article["pushes"] == source_raw["reactionCount"] == 4210
    assert article["pushes"] != source_raw["likeCount"]
    assert article["pushes"] != source_raw["commentCount"]


def test_missing_reaction_count_falls_back_to_zero():
    """``reactionCount`` absent → ``pushes == 0`` (not ``None``, not missing)."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_NO_REACTION))

    assert article["pushes"] == 0
    assert article["heat"] == 0
    assert isinstance(article["pushes"], int)


def test_zero_reaction_count_stays_zero():
    """A legitimately-zero counter is preserved as numeric 0."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_ZERO_REACTION))

    assert article["pushes"] == 0


def test_garbage_reaction_count_is_clamped_to_zero():
    """Non-numeric ``reactionCount`` degrades to 0 instead of crashing."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_GARBAGE_REACTION))

    assert article["pushes"] == 0


def test_negative_reaction_count_is_clamped_to_zero():
    """Negative counters are clamped (``toNonNegativeInt`` policy)."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_NEGATIVE_REACTION))

    assert article["pushes"] == 0


# ---------------------------------------------------------------------------
# author / board fallbacks
# ---------------------------------------------------------------------------


def test_author_prefers_nickname():
    """When both exist, ``user.nickname`` wins over ``user.id``."""
    source_raw = raw(RAW_DCARD_POST)

    article = normalize_article("dcard", source_raw)

    assert article["author"] == source_raw["user"]["nickname"]
    assert article["author"] != source_raw["user"]["id"]


def test_author_falls_back_to_user_id_when_nickname_absent():
    """Anonymous / deleted accounts have only an id — use it."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_NO_USER))

    assert article["author"] == "u-anon-000"


def test_author_is_empty_string_when_user_object_missing():
    """No user object at all → ``""``, never ``None``."""
    article = normalize_article("dcard", raw(RAW_DCARD_POST_SPARSE))

    assert article["author"] == ""


def test_board_prefers_forum_name_then_alias():
    """``forum.name`` is the human-readable board; alias is the fallback."""
    with_forum = normalize_article("dcard", raw(RAW_DCARD_POST))
    alias_only = normalize_article("dcard", raw(RAW_DCARD_POST_SPARSE))

    assert with_forum["board"] == "3C"
    assert alias_only["board"] == "3c"


# ---------------------------------------------------------------------------
# Defensive defaults — the normalizer is total
# ---------------------------------------------------------------------------


def test_empty_raw_does_not_crash_and_yields_full_article():
    """``normalize_article('dcard', {})`` returns all 12 keys (round-3 M1: +posted_at, +fetched_at, +timestamp alias)."""
    article = normalize_article("dcard", {})

    assert set(article) == set(ARTICLE_KEYS)
    assert len(article) == 12


def test_empty_raw_default_values():
    """Every string field defaults to ``""`` and ``pushes`` to ``0``."""
    article = normalize_article("dcard", {})

    assert article["title"] == ""
    assert article["url"] == ""
    assert article["href"] == ""
    assert article["board"] == ""
    assert article["author"] == ""
    assert article["pushes"] == 0
    assert article["heat"] == 0
    assert article["source"] == "dcard"
    assert _parse_iso8601(article["timestamp"]) is not None


def test_none_raw_does_not_crash():
    """``None`` is treated like an empty payload (production uses ``raw || {}``)."""
    article = normalize_article("dcard", None)

    assert set(article) == set(ARTICLE_KEYS)
    assert article["source"] == "dcard"


def test_normalize_does_not_mutate_the_raw_payload():
    """Normalization is pure — the caller's dict comes back untouched."""
    source_raw = raw(RAW_DCARD_POST)
    before = raw(source_raw)

    normalize_article("dcard", source_raw)

    assert source_raw == before
