"""
Keyword matching tests.

The matcher is a tiny pure function ``matchKeywords(title, keywords)``
defined in ``tracker.js``.  We cannot import a Node script from
Python, so we mirror the function in ``tests/_pure_mirrors`` and
assert that contract here.

Coverage:
* Case-insensitive match on title and keyword (both directions)
* OR semantics across the keyword list (``any``)
* Empty / ``None`` keyword list short-circuits to ``False``
* Empty title is handled (no crash)
* Unicode (CJK) titles work
* Substring match, not whole-word (must NOT be a regex / word boundary)
"""

from __future__ import annotations

import pytest

from tests._pure_mirrors import match_keywords


# ---------------------------------------------------------------------------
# Case-insensitivity
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "title,keyword",
    [
        ("[心得] Mac mini M4 開箱分享", "mac mini"),       # keyword lower
        ("[心得] MAC MINI 開箱分享", "mac mini"),           # title upper
        ("[心得] MaC mInI M4", "MAC MINI"),                 # mixed
        ("[爆] 特價 mac mini M2", "Mac Mini"),             # title lower, keyword title
    ],
)
def test_match_is_case_insensitive(title, keyword):
    """Match must succeed regardless of case in title or keyword."""
    assert match_keywords(title, [keyword]) is True


# ---------------------------------------------------------------------------
# OR semantics
# ---------------------------------------------------------------------------


def test_match_returns_true_if_any_keyword_hits():
    """OR across keywords: only one needs to match."""
    title = "[心得] iPhone 15 Pro Max 降價"
    keywords = ["nonexistent-board", "another-miss", "iPhone", "yet-another"]

    assert match_keywords(title, keywords) is True


def test_match_returns_false_when_no_keyword_hits():
    """OR with zero hits → False."""
    title = "[心得] Android 手機評測"
    keywords = ["iPhone", "Pixel", "特價"]

    assert match_keywords(title, keywords) is False


def test_match_returns_true_for_first_hit_not_just_last():
    """Make sure the OR short-circuits on the first hit, not just last."""
    title = "[心得] Mac mini M4"
    keywords = ["Mac mini", "iPhone", "Pixel"]  # first is the hit

    assert match_keywords(title, keywords) is True


# ---------------------------------------------------------------------------
# No-match returns False (not None / not raise)
# ---------------------------------------------------------------------------


def test_match_returns_false_for_empty_keyword_list():
    """Empty list must not match anything."""
    assert match_keywords("anything goes here", []) is False


def test_match_returns_false_for_none_keywords():
    """``None`` keywords (defensive guard) returns False, not crash."""
    assert match_keywords("anything goes here", None) is False


def test_match_returns_false_on_non_string_keywords():
    """If somehow a non-string slips in (e.g. None in the list), skip it,
    not crash.  This is the realistic defensive posture (the production
    JS casts each keyword with ``String(k).toLowerCase()``).
    """
    assert match_keywords("iPhone 15 降價", [None, "iPhone"]) is True
    assert match_keywords("iPhone 15 降價", [None, "Pixel"]) is False


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_match_handles_empty_title():
    """Empty title with non-empty keywords → no match, no crash."""
    assert match_keywords("", ["iPhone", "Mac mini"]) is False


def test_match_with_empty_strings_only_in_keywords_returns_true():
    """All-empty keywords list → **matches everything** because
    ``"".includes("")`` is true in JavaScript substring semantics.

    This pins the **current** production (``tracker.js``) behavior so
    that any future tightening (e.g. ``keywords.filter(Boolean)``) shows
    up as a deliberate change.  See rpb-qa-verify.log for the
    follow-up flag handed to M5 / next round.
    """
    assert match_keywords("real title", ["", "", ""]) is True


def test_match_is_substring_not_word_boundary():
    """Keywords embed inside larger words still match.  This pins the
    current production behavior (``String.includes`` semantics), so
    we don't silently regress to a stricter matcher.
    """
    # 'mini' inside 'feminist' would also match (substring behavior)
    assert match_keywords("feminist discussion", ["mini"]) is True
    # 'note' inside 'iphone' (loose match)
    assert match_keywords("iphone 15", ["note"]) is False  # 'note' not a substring of 'iphone 15'


def test_match_supports_unicode_titles():
    """CJK / Chinese titles must compare correctly."""
    assert match_keywords("[心得] 特價 Mac mini M4", ["特價"]) is True
    assert match_keywords("[心得] 特價 Mac mini M4", ["iphone"]) is False


def test_match_supports_unicode_keywords():
    """Keyword side can also be Unicode."""
    assert match_keywords("[心得] Mac mini 開箱", ["開箱"]) is True
    assert match_keywords("[心得] Mac mini 開箱", ["心得"]) is True


def test_match_realistic_pull_from_sample_config(sample_config):
    """Smoke check using the real keyword list from sample_config:
    ``['Mac mini', 'iPhone 15', '特價']``.
    """
    keywords = sample_config["keywords"]

    assert match_keywords("[心得] Mac mini M4 開箱", keywords) is True
    assert match_keywords("[情報] iPhone 15 Pro Max 降價", keywords) is True
    assert match_keywords("[爆] 特價 Mac mini M2", keywords) is True
    # unrelated
    assert match_keywords("[心得] Android 手機評測", keywords) is False
