"""
PTT date parsing tests (round-3 M3).

``sources/ptt.js`` ``parsePttDate(dateStr, now)`` derives an article's
``posted_at`` from PTT's day-level ``" M/D"`` date column.  Without
this heuristic the connector's ``posted_at`` would be ``now()`` —
which would silently break ``since``-filtering on PTT (round-2 M3
finding #3).

These tests pin the *contract* of the helper via the Python mirror in
:mod:`tests._pure_mirrors` (``parsePtt_date``).  Production changes to
``sources/ptt.js`` ``parsePttDate`` require updating the mirror here —
drift would be caught by the round-3 M3 ``test_since_filter.py``
mirror-vs-prod drift check, never silently patched.

Coverage
--------

* happy path: ``' 3/27'`` resolves to the same calendar year at 00:00 UTC
* cross-year: when ``now`` is January and the date is ``12/31`` the
  helper falls back to the *previous* December
* defensive defaults: ``None`` / ``''`` / non-string / whitespace-only /
  out-of-range / Date.UTC overflow all resolve to ``now``
* shape: returned value is ISO 8601 with ``Z`` suffix and millisecond
  precision (matches JS ``Date.toISOString`` so the two surfaces
  compare equal under ``==`` on ISO 8601 strings)
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from tests._pure_mirrors import parsePtt_date


# ---------------------------------------------------------------------------
# Reference "now" timestamps used throughout — pinned so the suite is
# deterministic regardless of the runner's wall clock.
# ---------------------------------------------------------------------------

# March 30, 2026 — comfortably inside any year; far from the 90-day
# cross-year threshold for typical M/D combos.
NOW_MID_YEAR = "2026-03-30T00:00:00.000Z"

# January 15, 2026 — early enough that ``12/31`` triggers the
# cross-year fallback (Dec 31, 2026 vs Jan 15, 2026 = 351 days
# apart, well past the 90-day threshold).
NOW_JANUARY = "2026-01-15T00:00:00.000Z"

# August 30, 2026 — late enough that ``3/27`` triggers the
# cross-year fallback (Mar 27, 2026 vs Aug 30, 2026 = 156 days,
# past the 90-day threshold).
NOW_LATE_YEAR = "2026-08-30T00:00:00.000Z"


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_parsePtt_date_happy_path_same_year():
    """``' 3/27'`` resolves to the same calendar year at midnight UTC."""
    iso = parsePtt_date(" 3/27", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert parsed.year == 2026
    assert parsed.month == 3
    assert parsed.day == 27
    assert parsed.hour == 0
    assert parsed.minute == 0
    assert parsed.second == 0


def test_parsePtt_date_happy_path_single_digit_month():
    """``'4/5'`` (no leading zeros) parses the same as ``'4/05'``."""
    iso = parsePtt_date("4/5", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert (parsed.month, parsed.day) == (4, 5)


def test_parsePtt_date_strips_surrounding_whitespace():
    """Leading / trailing whitespace is trimmed before regex match."""
    iso_trimmed = parsePtt_date(" 3/27", NOW_MID_YEAR)
    iso_no_ws = parsePtt_date("3/27", NOW_MID_YEAR)

    assert iso_trimmed == iso_no_ws


def test_parsePtt_date_returns_iso8601_with_millisecond_z_suffix():
    """Output is JS ``Date.toISOString``-shaped: ``YYYY-MM-DDTHH:MM:SS.sssZ``."""
    iso = parsePtt_date(" 3/27", NOW_MID_YEAR)

    # Sanity: parseable by ``datetime.fromisoformat`` after ``Z`` swap.
    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert isinstance(parsed, datetime)
    # And the wire-format shape matches.
    assert iso.endswith("Z")
    assert iso[4] == "-" and iso[7] == "-" and iso[10] == "T"
    assert "." in iso  # has milliseconds


# ---------------------------------------------------------------------------
# Cross-year fallback
# ---------------------------------------------------------------------------


def test_parsePtt_date_cross_year_when_now_is_january_and_date_is_dec():
    """``12/31`` in January resolves to the *previous* December.

    On Jan 15 the naive interpretation (Dec 31 of the current year)
    is 351 days in the future, well past the 90-day threshold, so the
    heuristic rolls back to Dec 31 of the previous year.
    """
    iso = parsePtt_date("12/31", NOW_JANUARY)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert (parsed.year, parsed.month, parsed.day) == (2025, 12, 31)


def test_parsePtt_date_cross_year_when_now_is_late_and_date_is_spring():
    """``3/27`` in late August rolls back to *previous* March.

    On Aug 30 the naive interpretation (Mar 27 of the current year)
    is 156 days in the past, past the 90-day threshold, so the
    heuristic rolls back to Mar 27 of the previous year.
    """
    iso = parsePtt_date("3/27", NOW_LATE_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert (parsed.year, parsed.month, parsed.day) == (2025, 3, 27)


def test_parsePtt_date_does_not_cross_year_within_90_days():
    """Inside the 90-day window the helper keeps the current year.

    Mar 30 → Apr 5 is 6 days forward; stays in 2026.
    """
    iso = parsePtt_date("4/5", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert parsed.year == 2026


# ---------------------------------------------------------------------------
# Defensive defaults — empty / null / unparseable
# ---------------------------------------------------------------------------


def test_parsePtt_date_empty_string_returns_now():
    """``''`` defensively returns ``now`` (no NaN, no exception)."""
    iso = parsePtt_date("", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_none_returns_now():
    """``None`` defensively returns ``now``."""
    iso = parsePtt_date(None, NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_whitespace_only_returns_now():
    """``' '`` (whitespace-only) parses to empty → defensive ``now``."""
    iso = parsePtt_date(" ", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_unparseable_garbage_returns_now():
    """``'not-a-date'`` defensively returns ``now``."""
    iso = parsePtt_date("not-a-date", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_non_string_input_returns_now():
    """Non-string types (e.g. ``int``, ``list``) defensively return ``now``."""
    for bad in (12345, ["3/27"], {"date": "3/27"}):
        iso = parsePtt_date(bad, NOW_MID_YEAR)
        parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
        assert parsed == expected, f"non-string {bad!r} should return now"


# ---------------------------------------------------------------------------
# Defensive defaults — out-of-range / Date.UTC overflow
# ---------------------------------------------------------------------------


def test_parsePtt_date_month_zero_returns_now():
    """``0`` is out of range (months are 1-12) → defensive ``now``."""
    iso = parsePtt_date("0/15", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_month_thirteen_returns_now():
    """``13`` is out of range (months are 1-12) → defensive ``now``."""
    iso = parsePtt_date("13/01", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_day_zero_returns_now():
    """``0`` is out of range (days start at 1) → defensive ``now``."""
    iso = parsePtt_date("3/0", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_day_thirty_two_returns_now():
    """``32`` is out of range (days max 31) → defensive ``now``."""
    iso = parsePtt_date("3/32", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_feb_30_returns_now():
    """``2/30`` overflows Date.UTC (Feb has at most 29 days) → defensive ``now``.

    JS ``new Date(Date.UTC(2026, 1, 30))`` silently rolls over to
    March 2; the production helper guards against this by checking
    the resulting ``getUTCMonth()`` / ``getUTCDate()``.  The mirror's
    equivalent guard raises ``ValueError`` from ``datetime(...)`` and
    falls back to ``now`` — both paths converge on ``now``.
    """
    iso = parsePtt_date("2/30", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


def test_parsePtt_date_april_31_returns_now():
    """``4/31`` overflows Date.UTC (April has 30 days) → defensive ``now``."""
    iso = parsePtt_date("4/31", NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected


# ---------------------------------------------------------------------------
# Parametrized shape / type matrix
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw_date,now,expected_year",
    [
        (" 1/01", NOW_MID_YEAR, 2026),    # Jan 1, ~88d backward → keeps
        ("12/31", NOW_JANUARY, 2025),     # cross-year forward
        (" 3/27", NOW_LATE_YEAR, 2025),   # cross-year backward
        (" 6/15", NOW_MID_YEAR, 2026),    # inside 90d both ways
        (" 9/01", NOW_MID_YEAR, 2025),    # forward, 155d → cross-year backward
    ],
)
def test_parsePtt_date_year_resolution_matrix(raw_date, now, expected_year):
    """Year resolution across the 90-day threshold edge cases."""
    iso = parsePtt_date(raw_date, now)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    assert parsed.year == expected_year


@pytest.mark.parametrize(
    "bad_date",
    ["", " ", None, "not-a-date", "0/15", "13/01", "3/0", "3/32", "2/30", "4/31"],
)
def test_parsePtt_date_defensive_inputs_all_return_now(bad_date):
    """Every defensive input returns ``now`` (no exception, no garbage)."""
    iso = parsePtt_date(bad_date, NOW_MID_YEAR)

    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    expected = datetime.fromisoformat(NOW_MID_YEAR.replace("Z", "+00:00"))
    assert parsed == expected, f"bad input {bad_date!r} should return now"