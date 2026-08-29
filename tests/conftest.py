"""
Shared pytest fixtures for the ptt-tracker test suite.

These fixtures mirror the production data shapes used by
``tracker.js`` and ``ptt_tracker.py`` so tests can arrange
deterministic inputs without hitting PTT or any external
service.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def sample_articles():
    """Five mock PTT-shaped article dicts covering diverse heat values.

    Article shape keys mirror the dicts produced by
    ``tracker.js`` ``parseArticles()`` and
    ``ptt_tracker.py`` ``get_board_articles()``:
        title, href, author, date, pushes, heat, board, url (js only)
    """
    return [
        {
            "title": "[心得] Mac mini M4 開箱分享",
            "href": "/bbs/MacShop/M.111.111.A.html",
            "author": "applefans",
            "date": " 3/27",
            "pushes": 87,
            "heat": 87,
            "board": "MacShop",
            "url": "https://www.ptt.cc/bbs/MacShop/M.111.111.A.html",
        },
        {
            "title": "[情報] iPhone 15 Pro Max 降價資訊整理",
            "href": "/bbs/MacShop/M.222.222.A.html",
            "author": "deallin",
            "date": " 3/27",
            "pushes": 42,
            "heat": 42,
            "board": "MacShop",
            "url": "https://www.ptt.cc/bbs/MacShop/M.222.222.A.html",
        },
        {
            "title": "Re: [請益] MacBook Air 散熱問題",
            "href": "/bbs/MacShop/M.333.333.A.html",
            "author": "fanboy",
            "date": " 3/27",
            "pushes": 5,
            "heat": 5,
            "board": "MacShop",
            "url": "https://www.ptt.cc/bbs/MacShop/M.333.333.A.html",
        },
        {
            "title": "[公告] 版規更新 v3",
            "href": "/bbs/MacShop/M.444.444.A.html",
            "author": "moderator",
            "date": " 3/26",
            "pushes": 0,
            "heat": 0,
            "board": "MacShop",
            "url": "https://www.ptt.cc/bbs/MacShop/M.444.444.A.html",
        },
        {
            "title": "[爆] 特價 Mac mini M2 限時搶購",
            "href": "/bbs/MacShop/M.555.555.A.html",
            "author": "saleman",
            "date": " 3/26",
            "pushes": 100,
            "heat": 100,
            "board": "MacShop",
            "url": "https://www.ptt.cc/bbs/MacShop/M.555.555.A.html",
        },
    ]


@pytest.fixture
def sample_config():
    """Mock non-secret config dict (boards / keywords / min_heat).

    Intentionally excludes any Telegram secrets — production code
    (post-M1) reads those only from environment variables.
    """
    return {
        "boards": ["MacShop", "Tech_Job"],
        "keywords": ["Mac mini", "iPhone 15", "特價"],
        "min_heat": 10,
        "interval_minutes": 5,
    }
