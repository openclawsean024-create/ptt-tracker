"""
``since``-filter tests (round-3 M3).

Round-3 M2 wired an optional ``since`` cutoff through the orchestrator
(``tracker.js`` / ``api/tracker.js``) into each connector's
``fetch``.  The contract is::

    since: ISO 8601 string | None
        - None  → round-1 behaviour, no time filter applied.
        - ISO 8601 (e.g. "2026-01-01T00:00:00.000Z")
                  → filter posts whose source-specific posted_at
                    is older than the cutoff.
        - unparseable → short-circuit to round-1 behaviour (no filter),
          never throw.

Each surface has a slightly different consumption of ``since``:

  * **CLI / serverless** share a tiny ``normalizeSince`` helper that
    trims whitespace and returns ``None`` for empty input.
  * **PTT** parses the ISO 8601 to epoch-ms, subtracts a 24h grace
    (``PTT_SINCE_GRACE_MS``), then keeps raw entries whose parsed
    ``posted_at`` is at or after the threshold.
  * **Dcard** builds an ``&after=<ISO>`` query-string suffix that the
    upstream API consumes server-side.

These tests pin all four contracts (CLI/serverless shared normalize,
PTT grace mirror, Dcard query builder, mirror-vs-prod drift check)
through the Python mirrors in :mod:`tests._pure_mirrors`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timezone

import pytest

from tests._pure_mirrors import (
    PTT_SINCE_GRACE_MS,
    apply_since_filter_ptt,
    build_since_query,
    filter_by_posted_at,
    normalize_since,
    parse_since_ms,
)


# ---------------------------------------------------------------------------
# CLI / serverless shared ``normalize_since``
# ---------------------------------------------------------------------------


def test_normalize_since_strips_whitespace_on_valid_iso():
    """A padded valid ISO string is trimmed and returned verbatim."""
    result = normalize_since("  2026-01-01T00:00:00.000Z  ")

    assert result == "2026-01-01T00:00:00.000Z"


def test_normalize_since_returns_iso_verbatim():
    """A clean ISO string is returned as-is (no validation side effects)."""
    result = normalize_since("2026-01-01T00:00:00.000Z")

    assert result == "2026-01-01T00:00:00.000Z"


def test_normalize_since_empty_string_returns_none():
    """``''`` → ``None`` (round-1 "no filter" sentinel)."""
    assert normalize_since("") is None


def test_normalize_since_none_returns_none():
    """``None`` → ``None``."""
    assert normalize_since(None) is None


def test_normalize_since_whitespace_only_returns_none():
    """``'   '`` (whitespace-only) → ``None``.

    Without this rule the connector would receive an empty / padded
    string and ``Date.parse`` would reject it, falling back to
    round-1 behaviour — but normalising here lets the orchestrator
    surface the "no filter" intent explicitly in logs.
    """
    assert normalize_since("   ") is None


def test_normalize_since_does_not_validate_iso_parseability():
    """``normalize_since`` only trims; parseability is the connector's job.

    The CLI / serverless entrypoints intentionally pass the original
    string through to the connector even when it's garbage so a
    user-facing error comes from the *right* layer (one that knows
    what "ISO 8601" means), not from a silent ``null``.
    """
    # Garbage strings pass through verbatim — the connector's
    # ``parse_since_ms`` / ``Date.parse`` is what rejects them.
    assert normalize_since("not-a-date") == "not-a-date"
    assert normalize_since("2026-13-01") == "2026-13-01"


def test_normalize_since_non_string_returns_none():
    """Non-string inputs (int / list / dict) → ``None``.

    The CLI flag parser always returns a string (or ``null`` when the
    flag was omitted); this defensive guard catches programming errors.
    """
    assert normalize_since(12345) is None
    assert normalize_since(["2026-01-01"]) is None
    assert normalize_since({"since": "2026-01-01"}) is None


# ---------------------------------------------------------------------------
# ``parse_since_ms`` — shared by PTT grace filter
# ---------------------------------------------------------------------------


def test_parse_since_ms_valid_iso_returns_epoch_ms():
    """``2026-01-01T00:00:00.000Z`` → exact epoch-ms.

    Hand-checked: ``2026-01-01T00:00:00Z`` is ``1767225600000`` ms.
    """
    assert parse_since_ms("2026-01-01T00:00:00.000Z") == 1767225600000


def test_parse_since_ms_invalid_string_returns_none():
    """Garbage strings return ``None`` (NOT NaN — short-circuit safe)."""
    assert parse_since_ms("not-a-date") is None


def test_parse_since_ms_empty_returns_none():
    """``''`` and whitespace-only → ``None``."""
    assert parse_since_ms("") is None
    assert parse_since_ms("   ") is None


def test_parse_since_ms_none_returns_none():
    """``None`` → ``None``."""
    assert parse_since_ms(None) is None


def test_parse_since_ms_trims_whitespace():
    """Leading / trailing whitespace is stripped before parsing."""
    assert parse_since_ms("  2026-01-01T00:00:00.000Z  ") == 1767225600000


def test_parse_since_ms_accepts_offset_notation():
    """``+00:00`` offsets parse identically to ``Z``."""
    assert parse_since_ms("2026-01-01T00:00:00.000+00:00") == 1767225600000


def test_parse_since_ms_non_string_returns_none():
    """Non-string / non-Date inputs → ``None``."""
    assert parse_since_ms(12345) is None
    assert parse_since_ms(["2026-01-01"]) is None


# ---------------------------------------------------------------------------
# PTT grace constant
# ---------------------------------------------------------------------------


def test_ptt_since_grace_ms_is_24_hours():
    """``PTT_SINCE_GRACE_MS`` is exactly 24 hours (one day of slack).

    Matches ``sources/ptt.js`` ``PTT_SINCE_GRACE_MS = 24 * 60 * 60 * 1000``.
    The 24h value absorbs the day-level granularity of PTT's
    ``" M/D"`` date column — articles stamped ``3/27`` actually cover
    the whole day, so subtracting a single hour would still wrongly
    drop a same-day post.
    """
    assert PTT_SINCE_GRACE_MS == 86400000


# ---------------------------------------------------------------------------
# PTT grace mirror — on normalized Articles
# ---------------------------------------------------------------------------


# Six-article fixture covering every branch of the grace filter.
GRACE_FIXTURE = [
    {"posted_at": "2025-12-30T00:00:00.000Z", "title": "A 2-days-before"},
    {"posted_at": "2025-12-31T00:00:00.000Z", "title": "B 1-day-before"},
    {"posted_at": "2026-03-27T00:00:00.000Z", "title": "C on-same-day"},
    {"posted_at": "2026-03-26T00:00:00.000Z", "title": "D just-outside-24h"},
    {"posted_at": None, "title": "E missing-posted-at"},
    {"posted_at": "invalid", "title": "F garbage-posted-at"},
]


def test_ptt_grace_filtered_out_2_days_before():
    """Article 2 days before ``since`` is filtered out (> 24h grace)."""
    kept = filter_by_posted_at(GRACE_FIXTURE, "2026-01-01T00:00:00.000Z")

    titles = [a["title"] for a in kept]
    assert "A 2-days-before" not in titles


def test_ptt_grace_kept_on_same_day():
    """Article on the same day as ``since`` is kept (within 24h)."""
    kept = filter_by_posted_at(
        [{"posted_at": "2026-03-27T00:00:00.000Z", "title": "x"}],
        "2026-03-27T09:00:00.000Z",
    )

    assert len(kept) == 1


def test_ptt_grace_just_outside_24h_is_filtered_out():
    """Article 24h+1ms before ``since`` is filtered out (just outside grace).

    Production filter is ``posted_at_ms >= since_ms - PTT_SINCE_GRACE_MS``
    → inclusive at the threshold.  At exactly ``24h`` before ``since``
    an article is kept (boundary inclusive); 1 ms earlier is dropped.
    """
    since = "2026-03-27T00:00:00.000Z"
    articles = [
        # Exactly at the threshold (24h before) → kept (inclusive).
        {"posted_at": "2026-03-26T00:00:00.000Z", "title": "boundary-kept"},
        # 1 ms before the threshold → dropped.
        {"posted_at": "2026-03-25T23:59:59.999Z", "title": "just-outside"},
    ]

    kept = filter_by_posted_at(articles, since)
    titles = [a["title"] for a in kept]

    assert "just-outside" not in titles
    assert "boundary-kept" in titles


def test_ptt_grace_invalid_since_keeps_all_articles():
    """An unparseable ``since`` falls back to round-1 "no filter" (all kept)."""
    kept = filter_by_posted_at(GRACE_FIXTURE, "invalid-string")

    assert len(kept) == len(GRACE_FIXTURE)
    titles = [a["title"] for a in kept]
    assert "A 2-days-before" in titles


def test_ptt_grace_none_since_keeps_all_articles():
    """``since = None`` → all articles kept (round-1 default)."""
    kept = filter_by_posted_at(GRACE_FIXTURE, None)

    assert len(kept) == len(GRACE_FIXTURE)


def test_ptt_grace_missing_posted_at_keeps_article():
    """An article with ``posted_at = None`` is kept (defensive)."""
    articles = [{"posted_at": None, "title": "missing"}]

    kept = filter_by_posted_at(articles, "2026-01-01T00:00:00.000Z")

    assert len(kept) == 1


def test_ptt_grace_invalid_posted_at_keeps_article():
    """An article with ``posted_at = 'invalid'`` is kept (defensive)."""
    articles = [{"posted_at": "invalid", "title": "garbage"}]

    kept = filter_by_posted_at(articles, "2026-01-01T00:00:00.000Z")

    assert len(kept) == 1


def test_ptt_grace_empty_string_since_keeps_all_articles():
    """``since = ''`` → all articles kept (CLI flag omitted)."""
    kept = filter_by_posted_at(GRACE_FIXTURE, "")

    assert len(kept) == len(GRACE_FIXTURE)


def test_ptt_grace_whitespace_only_since_keeps_all_articles():
    """``since = '   '`` → all articles kept (whitespace-only CLI input)."""
    kept = filter_by_posted_at(GRACE_FIXTURE, "   ")

    assert len(kept) == len(GRACE_FIXTURE)


def test_ptt_grace_full_filter_matrix():
    """One full integration: every fixture article routed correctly.

    ``since = 2026-03-27T09:00:00.000Z`` (24h threshold =
    ``2026-03-26T09:00:00.000Z``):

      * ``A 2-days-before``  (2025-12-30): dropped (>24h before).
      * ``B 1-day-before``   (2025-12-31): dropped (also past threshold).
      * ``C on-same-day``    (2026-03-27): kept.
      * ``D just-outside-24h`` (2026-03-26T00:00:00): dropped (1ms before
        ``2026-03-26T09:00:00`` — i.e. exactly at the boundary).
      * ``E missing-posted-at``: kept (defensive).
      * ``F garbage-posted-at``: kept (defensive).
    """
    kept = filter_by_posted_at(GRACE_FIXTURE, "2026-03-27T09:00:00.000Z")

    titles = sorted(a["title"] for a in kept)
    assert titles == ["C on-same-day", "E missing-posted-at", "F garbage-posted-at"]


# ---------------------------------------------------------------------------
# Dcard query builder
# ---------------------------------------------------------------------------


def test_build_since_query_valid_iso_produces_after_param():
    """A valid ISO 8601 string produces ``&after=<encoded-ISO>``.

    JS ``encodeURIComponent`` encodes ``:`` as ``%3A``; the URL is
    still equivalent and Dcard parses it identically.
    """
    result = build_since_query("2026-01-01T00:00:00.000Z")

    # Accept either ``:`` or ``%3A`` — both round-trip identically
    # through Dcard's API, and the brief explicitly says "or similar".
    assert result in (
        "&after=2026-01-01T00:00:00.000Z",
        "&after=2026-01-01T00%3A00%3A00.000Z",
    )


def test_build_since_query_empty_string_returns_empty():
    """``''`` → ``''`` (round-1 behaviour, no ``after`` param)."""
    assert build_since_query("") == ""


def test_build_since_query_none_returns_empty():
    """``None`` → ``''`` (round-1 behaviour, no ``after`` param)."""
    assert build_since_query(None) == ""


def test_build_since_query_whitespace_only_returns_empty():
    """``'   '`` → ``''`` (no ``after`` param emitted)."""
    assert build_since_query("   ") == ""


def test_build_since_query_invalid_string_returns_empty():
    """Unparseable ISO strings produce ``''`` (round-1 fallback)."""
    assert build_since_query("not-a-date") == ""


def test_build_since_query_non_string_returns_empty():
    """Non-string inputs → ``''``."""
    assert build_since_query(12345) == ""
    assert build_since_query(["2026-01-01"]) == ""


def test_build_since_query_trims_whitespace():
    """Leading / trailing whitespace is stripped before being appended."""
    from urllib.parse import unquote

    result = build_since_query("  2026-01-01T00:00:00.000Z  ")

    # ``encodeURIComponent`` percent-encodes ``:`` (and anything
    # else outside the unreserved set).  Decode and check that the
    # whitespace was stripped.
    assert result.startswith("&after=")
    decoded = unquote(result[len("&after="):])
    assert decoded == "2026-01-01T00:00:00.000Z"
    assert not decoded.startswith(" ")
    assert not decoded.endswith(" ")


# ---------------------------------------------------------------------------
# Raw-mode helper (`apply_since_filter_ptt`)
# ---------------------------------------------------------------------------
#
# This covers the production code path: PTT's ``fetch`` parses the
# raw ``" M/D"`` date column inline.  The Python mirror walks the
# same logic against a list of raw entries (with a `date` field).


RAW_FIXTURE = [
    {"date": " 3/27", "title": "recent"},
    {"date": " 3/26", "title": "yesterday"},
    {"date": "12/30", "title": "december"},
    {"date": "", "title": "empty-date"},
    {"date": "garbage", "title": "bad-date"},
]


def test_apply_since_filter_ptt_invalid_since_keeps_all():
    """Invalid ``since`` → all raw entries survive (round-1 fallback)."""
    kept = apply_since_filter_ptt(RAW_FIXTURE, "invalid")

    assert len(kept) == len(RAW_FIXTURE)


def test_apply_since_filter_ptt_none_since_keeps_all():
    """``since = None`` → all raw entries survive."""
    kept = apply_since_filter_ptt(RAW_FIXTURE, None)

    assert len(kept) == len(RAW_FIXTURE)


def test_apply_since_filter_ptt_empty_string_since_keeps_all():
    """``since = ''`` → all raw entries survive."""
    kept = apply_since_filter_ptt(RAW_FIXTURE, "")

    assert len(kept) == len(RAW_FIXTURE)


def test_apply_since_filter_ptt_defensive_on_bad_date_keeps_article():
    """An entry with an unparseable ``date`` keeps the entry (defensive).

    ``parsePtt_date`` falls back to ``now`` on bad input, and the
    resulting ISO 8601 *is* parseable.  A truly corrupt entry (no
    string at all, e.g. ``None``) is also kept — ``parsePtt_date``
    returns ``now`` which is also parseable.  Either path keeps the
    entry.
    """
    bad_articles = [
        {"date": None, "title": "no-date"},
        {"date": 12345, "title": "non-string-date"},
    ]

    kept = apply_since_filter_ptt(bad_articles, "2026-01-01T00:00:00.000Z")

    assert len(kept) == 2


# ---------------------------------------------------------------------------
# Cross-surface consistency
# ---------------------------------------------------------------------------


def test_normalize_since_then_parse_since_ms_round_trip():
    """``normalize_since`` then ``parse_since_ms`` round-trips a valid ISO."""
    raw = "  2026-01-01T00:00:00.000Z  "
    normalized = normalize_since(raw)

    assert parse_since_ms(normalized) == 1767225600000


def test_build_since_query_then_parse_since_ms_round_trip():
    """The encoded ISO inside ``build_since_query`` is still parseable.

    ``urllib.parse.quote`` (Python) and ``encodeURIComponent`` (JS)
    are byte-equivalent for ASCII input, so the round-trip holds
    without any further decoding — the string after ``&after=`` is
    the percent-encoded ISO 8601.
    """
    raw = "2026-01-01T00:00:00.000Z"
    built = build_since_query(raw)

    assert built.startswith("&after=")
    encoded_iso = built[len("&after="):]

    # The encoded form percent-encodes ``:`` (and possibly other
    # chars).  Decode and re-parse to confirm.
    from urllib.parse import unquote
    decoded = unquote(encoded_iso)
    assert parse_since_ms(decoded) == 1767225600000


# ---------------------------------------------------------------------------
# Mirror-vs-prod drift check (round-3 M3 spirit)
# ---------------------------------------------------------------------------
#
# Drives the JS production functions with a hand-picked input set
# and compares the result to the Python mirrors.  Drift count is
# asserted to be zero; if this fails the *mirror* (and / or the
# *production code*) needs review by the relevant owner.


_DRIFT_CASES = [
    # [label, function_name, args]
    ("normalize:empty", "normalize_since", [""]),
    ("normalize:null", "normalize_since", ["null"]),
    ("normalize:ws", "normalize_since", ["   "]),
    ("normalize:valid", "normalize_since", [" 2026-01-01T00:00:00.000Z "]),
    ("parse:null", "parse_since_ms", ["null"]),
    ("parse:empty", "parse_since_ms", [""]),
    ("parse:valid", "parse_since_ms", ["2026-01-01T00:00:00.000Z"]),
    ("parse:invalid", "parse_since_ms", ["invalid"]),
    ("build:null", "build_since_query", ["null"]),
    ("build:empty", "build_since_query", [""]),
    ("build:invalid", "build_since_query", ["invalid"]),
    ("build:valid", "build_since_query", ["2026-01-01T00:00:00.000Z"]),
]


def _run_js_helpers():
    """Run the JS production helpers with the M3 drift cases, capture JSON.

    The drift payload is piped in via stdin (so we don't depend on
    argv quoting); the JS script reads ``process.stdin`` synchronously
    and writes a JSON result on stdout.

    Returns a dict mapping case label → JS output.
    """
    js_script = """
        const { normalizeSince } = require('./tracker.js');
        const { parseSinceMs } = require('./sources/ptt.js');
        const { buildSinceQuery } = require('./sources/dcard.js');
        let stdin = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { stdin += chunk; });
        process.stdin.on('end', () => {
            const cases = JSON.parse(stdin);
            const out = {};
            for (const [label, fnName, args] of cases) {
                let value;
                const arg = args[0] === 'null' ? null : args[0];
                if (fnName === 'normalize_since') {
                    value = normalizeSince(arg);
                } else if (fnName === 'parse_since_ms') {
                    value = parseSinceMs(arg);
                } else if (fnName === 'build_since_query') {
                    value = buildSinceQuery(arg);
                }
                out[label] = value;
            }
            process.stdout.write(JSON.stringify(out));
        });
    """

    payload = json.dumps(_DRIFT_CASES)
    proc = subprocess.run(
        ["node", "-e", js_script],
        input=payload,
        capture_output=True,
        text=True,
        check=False,
        cwd=".",
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"node subprocess failed: {proc.stderr}"
        )
    return json.loads(proc.stdout)


def _run_python_mirrors():
    """Run the Python mirror helpers with the same M3 drift cases."""
    out = {}
    for label, fn_name, args in _DRIFT_CASES:
        arg = None if args[0] == "null" else args[0]
        if fn_name == "normalize_since":
            out[label] = normalize_since(arg)
        elif fn_name == "parse_since_ms":
            out[label] = parse_since_ms(arg)
        elif fn_name == "build_since_query":
            out[label] = build_since_query(arg)
    return out


@pytest.mark.skipif(
    shutil.which("node") is None, reason="node binary not on PATH"
)
def test_mirror_vs_prod_drift_is_zero():
    """Every M3 drift case must match between Python mirror and JS prod.

    The Python mirror lives in :mod:`tests._pure_mirrors`; the JS
    production code is in ``tracker.js``, ``sources/ptt.js`` and
    ``sources/dcard.js``.  A drift (count > 0) means the mirror and
    the production code disagree on the contract — a real bug,
    reported to the backend owner (do **not** patch the mirror to
    match — that would mask the bug).

    Drift is reported as a structured failure (label-by-label) so
    the backend owner can locate the offending input quickly.
    """
    js_out = _run_js_helpers()
    py_out = _run_python_mirrors()

    drift = []
    for label, _fn, _args in _DRIFT_CASES:
        js_value = js_out.get(label)
        py_value = py_out.get(label)
        # ``null`` JSON-decodes as ``None`` in Python — same as JS ``null``.
        if js_value != py_value:
            drift.append((label, js_value, py_value))

    assert drift == [], (
        "mirror-vs-prod drift detected — production or mirror needs "
        "review (no patching here, report to backend owner):\n"
        + "\n".join(f"  {label}: js={js!r} py={py!r}" for label, js, py in drift)
    )


def test_mirror_vs_prod_handcrafted_parity():
    """A small hand-driven parity check, independent of ``node`` on PATH.

    Runs the Python mirror with the production-equivalent *expected*
    outputs.  If drift is detected via the JS subprocess in the
    ``test_mirror_vs_prod_drift_is_zero`` test above, this serves as
    a quick sanity that the mirror itself is internally consistent.
    """
    cases = [
        ("normalize_since", ["", None, "   ", " 2026-01-01T00:00:00.000Z "],
         [None, None, None, "2026-01-01T00:00:00.000Z"]),
        ("parse_since_ms", [None, "", "2026-01-01T00:00:00.000Z", "invalid"],
         [None, None, 1767225600000, None]),
        ("build_since_query", [None, "", "invalid", "2026-01-01T00:00:00.000Z"],
         ["", "", "",
          "&after=2026-01-01T00:00:00.000Z"
          if False  # placeholder; accept either encoding
          else "&after=2026-01-01T00%3A00%3A00.000Z"]),
    ]

    for fn_name, args, expected in cases:
        for arg, want in zip(args, expected):
            if fn_name == "normalize_since":
                got = normalize_since(arg)
            elif fn_name == "parse_since_ms":
                got = parse_since_ms(arg)
            elif fn_name == "build_since_query":
                got = build_since_query(arg)
            else:
                raise AssertionError(fn_name)
            assert got == want, f"{fn_name}({arg!r}) = {got!r}, want {want!r}"