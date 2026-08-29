"""
Static Dcard raw-payload fixtures (round-2 M3).

Why a separate module (not ``conftest.py``)
-------------------------------------------
``conftest.py`` is round-1 territory and out of scope for this
milestone.  These fixtures are plain module-level constants rather
than pytest fixtures so they can be imported directly by more than
one test module (``test_source_schema.py`` and
``test_dcard_connector.py``) and compared against each other without
pytest fixture plumbing.

**No test in this suite ever calls the real Dcard API.**  Every
payload below is hand-built from the shape documented in
``sources/dcard.js`` and the M2 closing report's Dcard → Article
mapping table.

Naming convention: ``RAW_DCARD_*`` = raw API-shaped input,
``RAW_PTT_*`` = raw PTT-shaped input (kept here so the cross-source
schema test has a symmetric fixture pair).

Every dict is deep-copied on access via :func:`raw` so a test that
mutates a payload cannot leak state into another test.
"""

from __future__ import annotations

import copy

# ---------------------------------------------------------------------------
# Scenario 1 — happy path.  Full Dcard post with every field populated.
# Mirrors the example row of the M2 closing report mapping table.
# ---------------------------------------------------------------------------

RAW_DCARD_POST = {
    "id": 123456789,
    "title": "[心得] Mac mini M4 開箱與效能實測",
    "excerpt": "剛入手 M4 版本，跑分結果整理如下……",
    "createdAt": "2026-08-29T15:30:00.000Z",
    "updatedAt": "2026-08-29T16:02:11.000Z",
    "commentCount": 48,
    "likeCount": 512,
    "reactionCount": 731,
    "forumAlias": "3c",
    "forumName": "3C",
    "forum": {"alias": "3c", "name": "3C"},
    "user": {
        "id": "u-abc123",
        "nickname": "applefans",
        "gender": "M",
        "school": "某大學",
    },
    "media": [],
    "gender": "M",
    "school": "某大學",
}

# ---------------------------------------------------------------------------
# Scenario 2 — sparse raw.  Only the bare minimum a Dcard index row is
# guaranteed to carry.  Exercises defensive defaults on every optional
# field (no user, no reactionCount, no forum object, no createdAt).
# ---------------------------------------------------------------------------

RAW_DCARD_POST_SPARSE = {
    "id": 987654321,
    "title": "[問題] 這是一篇很陽春的貼文",
    "forumAlias": "3c",
}

# ---------------------------------------------------------------------------
# Scenario 3 — high-reaction post.  Guards against ``pushes`` being read
# from ``likeCount`` or ``commentCount``: here all three numbers differ
# by an order of magnitude, so a mis-wired field is loudly wrong.
# ---------------------------------------------------------------------------

RAW_DCARD_POST_HIGH_REACTION = {
    "id": 555000111,
    "title": "[爆卦] 全站熱門討論串",
    "createdAt": "2026-08-30T08:05:42.123Z",
    "commentCount": 9,
    "likeCount": 88,
    "reactionCount": 4210,
    "forumAlias": "trending",
    "forum": {"alias": "trending", "name": "有趣"},
    "user": {"id": "u-hot999", "nickname": "trendsetter"},
}

# ---------------------------------------------------------------------------
# Scenario 4 — zero-reaction post.  A brand-new post legitimately has
# ``reactionCount: 0``; this must survive as numeric 0, not be treated
# as "missing" and re-defaulted (the two paths look identical in the
# output, so this fixture mainly pins the numeric type).
# ---------------------------------------------------------------------------

RAW_DCARD_POST_ZERO_REACTION = {
    "id": 777000222,
    "title": "[閒聊] 剛發的文還沒有人看",
    "createdAt": "2026-08-30T09:00:00.000Z",
    "commentCount": 0,
    "likeCount": 0,
    "reactionCount": 0,
    "forumAlias": "3c",
    "forum": {"alias": "3c", "name": "3C"},
    "user": {"id": "u-newbie", "nickname": "newcomer"},
}

# ---------------------------------------------------------------------------
# Edge case A — user object carries only ``id`` (no ``nickname``).
# Dcard returns this for anonymous / deleted accounts.  Exercises the
# ``user.nickname || user.id`` author fallback.
# ---------------------------------------------------------------------------

RAW_DCARD_POST_NO_USER = {
    "id": 246810121,
    "title": "[匿名] 沒有暱稱的作者",
    "createdAt": "2026-08-29T12:00:00.000Z",
    "reactionCount": 37,
    "forumAlias": "3c",
    "forum": {"alias": "3c", "name": "3C"},
    "user": {"id": "u-anon-000"},
}

# ---------------------------------------------------------------------------
# Edge case B — ``reactionCount`` entirely absent.  Exercises the
# ``pushes = 0`` fallback (and, downstream, that the heat filter still
# sees a numeric field).
# ---------------------------------------------------------------------------

RAW_DCARD_POST_NO_REACTION = {
    "id": 135791113,
    "title": "[情報] 這篇沒有 reactionCount 欄位",
    "createdAt": "2026-08-29T13:45:00.000Z",
    "commentCount": 4,
    "likeCount": 11,
    "forumAlias": "3c",
    "forum": {"alias": "3c", "name": "3C"},
    "user": {"id": "u-xyz789", "nickname": "informer"},
}

# ---------------------------------------------------------------------------
# Edge case C — garbage ``reactionCount`` (string / negative).  Pins the
# ``toNonNegativeInt`` clamp documented in ``sources/dcard.js``.
# ---------------------------------------------------------------------------

RAW_DCARD_POST_GARBAGE_REACTION = {
    "id": 314159265,
    "title": "[測試] reactionCount 是垃圾值",
    "createdAt": "2026-08-29T14:20:00.000Z",
    "reactionCount": "not-a-number",
    "forumAlias": "3c",
    "forum": {"alias": "3c", "name": "3C"},
    "user": {"id": "u-junk", "nickname": "junkposter"},
}

RAW_DCARD_POST_NEGATIVE_REACTION = {
    "id": 271828182,
    "title": "[測試] reactionCount 是負數",
    "createdAt": "2026-08-29T14:25:00.000Z",
    "reactionCount": -25,
    "forumAlias": "3c",
    "forum": {"alias": "3c", "name": "3C"},
    "user": {"id": "u-neg", "nickname": "negposter"},
}

# ---------------------------------------------------------------------------
# PTT counterpart — raw shape emitted by ``sources/ptt.js`` ``parseArticles``.
# Lives here (rather than in ``conftest.py``, which is round-1 and frozen)
# so the cross-source schema test can pair it against a Dcard payload.
# ---------------------------------------------------------------------------

RAW_PTT_POST = {
    "title": "[心得] Mac mini M4 開箱分享",
    "href": "/bbs/MacShop/M.111.111.A.html",
    "author": "applefans",
    "date": " 3/27",
    "pushes": 87,
    "heat": 87,
    "board": "MacShop",
    "url": "https://www.ptt.cc/bbs/MacShop/M.111.111.A.html",
}

RAW_PTT_POST_EXPLODED = {
    "title": "[爆] 特價 Mac mini M2 限時搶購",
    "href": "/bbs/MacShop/M.555.555.A.html",
    "author": "saleman",
    "date": " 3/26",
    "pushes": 100,
    "heat": 100,
    "board": "MacShop",
    "url": "https://www.ptt.cc/bbs/MacShop/M.555.555.A.html",
}

RAW_PTT_POST_SPARSE = {
    "title": "[公告] 只有標題的文章",
}

#: Every Dcard scenario, for parametrized "all payloads normalize cleanly"
#: assertions.  ``(id, payload)`` pairs so pytest reports readable ids.
ALL_DCARD_RAW = (
    ("happy_path", RAW_DCARD_POST),
    ("sparse", RAW_DCARD_POST_SPARSE),
    ("high_reaction", RAW_DCARD_POST_HIGH_REACTION),
    ("zero_reaction", RAW_DCARD_POST_ZERO_REACTION),
    ("no_nickname", RAW_DCARD_POST_NO_USER),
    ("no_reaction", RAW_DCARD_POST_NO_REACTION),
    ("garbage_reaction", RAW_DCARD_POST_GARBAGE_REACTION),
    ("negative_reaction", RAW_DCARD_POST_NEGATIVE_REACTION),
)

#: Every PTT scenario, same convention.
ALL_PTT_RAW = (
    ("happy_path", RAW_PTT_POST),
    ("exploded", RAW_PTT_POST_EXPLODED),
    ("sparse", RAW_PTT_POST_SPARSE),
)


def raw(payload):
    """Return a deep copy of a fixture payload.

    Tests that mutate a raw dict (or that hand it to code which might)
    should go through this helper so module-level constants stay
    pristine for every other test — the suite must not depend on test
    execution order.
    """
    return copy.deepcopy(payload)
