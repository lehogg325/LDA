"""Amendment resolution: crafted chains against a scratch schema, plus pinned
real-data assertions (step-4 checkpoint requirement: a known amended filing must
resolve to the right current row)."""

from __future__ import annotations

import pytest

from lda_pipeline.normalize.amendments import resolve_partition

FILING_SQL = """
INSERT INTO filings (filing_uuid, filing_type, document_kind, is_termination, is_amendment,
    is_no_activity, filing_year, filing_period, period_ord, registrant_id, client_id,
    dt_posted, attribution_level, retrieved_at, source_request_url)
VALUES (%s, %s, %s, %s, %s, false, 2019, 'first_quarter', 20191, %s, %s,
        %s, 'filing', now(), 'test://')
"""

U = {name: f"00000000-0000-0000-0000-00000000000{i}"
     for i, name in enumerate(["q1", "a_feb", "a_mar", "term", "other", "late_q1"], start=1)}


def _insert(pg, uuid, ftype, kind, term, amend, reg, cli, posted):
    pg.execute(FILING_SQL, (uuid, ftype, kind, term, amend, reg, cli, posted))


def _flags(pg, uuid):
    return pg.execute(
        "SELECT is_current, is_original, superseded_by::text FROM filings WHERE filing_uuid=%s",
        (uuid,)).fetchone()


def test_chain_q1_then_two_amendments(pg):
    _insert(pg, U["q1"], "Q1", "quarterly", False, False, 1, 10, "2019-04-20")
    _insert(pg, U["a_feb"], "1A", "quarterly", False, True, 1, 10, "2019-06-01")
    _insert(pg, U["a_mar"], "1A", "quarterly", False, True, 1, 10, "2020-02-15")
    _insert(pg, U["term"], "1T", "quarterly", True, False, 1, 10, "2020-03-01")
    _insert(pg, U["other"], "Q1", "quarterly", False, False, 2, 11, "2019-04-25")
    resolve_partition(pg, 2019, "first_quarter")
    pg.commit()

    assert _flags(pg, U["q1"]) == (False, True, U["a_feb"])       # original, superseded
    assert _flags(pg, U["a_feb"]) == (False, False, U["a_mar"])   # middle of chain
    assert _flags(pg, U["a_mar"]) == (True, False, None)          # current
    # Termination resolves in its own lane and never supersedes the quarterly report.
    assert _flags(pg, U["term"]) == (True, True, None)
    # Unrelated group untouched.
    assert _flags(pg, U["other"]) == (True, True, None)


def test_late_plain_report_supersedes_amendment(pg):
    """Latest-filed wins regardless of type: a plain Q1 posted after a 1A is current."""
    _insert(pg, U["q1"], "Q1", "quarterly", False, False, 1, 10, "2019-04-20")
    _insert(pg, U["a_feb"], "1A", "quarterly", False, True, 1, 10, "2019-06-01")
    _insert(pg, U["late_q1"], "Q1", "quarterly", False, False, 1, 10, "2019-08-01")
    resolve_partition(pg, 2019, "first_quarter")
    pg.commit()

    assert _flags(pg, U["late_q1"]) == (True, False, None)
    assert _flags(pg, U["a_feb"]) == (False, False, U["late_q1"])
    assert _flags(pg, U["q1"]) == (False, True, U["a_feb"])


def test_resolution_is_idempotent(pg):
    _insert(pg, U["q1"], "Q1", "quarterly", False, False, 1, 10, "2019-04-20")
    _insert(pg, U["a_feb"], "1A", "quarterly", False, True, 1, 10, "2019-06-01")
    resolve_partition(pg, 2019, "first_quarter")
    first = _flags(pg, U["q1"]), _flags(pg, U["a_feb"])
    resolve_partition(pg, 2019, "first_quarter")
    assert (_flags(pg, U["q1"]), _flags(pg, U["a_feb"])) == first


# ---- real-data pins (skip until the production DB has normalized filings) ----

@pytest.mark.realdb
def test_known_amended_filing_resolves_correctly(realdb):
    """THE ADVOCACY GROUP / CIGAR ASSOCIATION OF AMERICA 2013 Q2: Q2 -> 2A -> 2A(2015).
    Hand-verifiable via lda.gov public filing search; uuids pinned from the archive."""
    rows = realdb.execute("""
        SELECT filing_uuid::text, filing_type, is_current, is_original, superseded_by::text
        FROM filings
        WHERE registrant_id = 261 AND client_id = 100366
          AND filing_year = 2013 AND filing_period = 'second_quarter'
          AND document_kind = 'quarterly' AND NOT is_termination
        ORDER BY dt_posted, filing_uuid
    """).fetchall()
    assert [r[0] for r in rows] == [
        "11a07448-5491-41a4-a7ee-25e4929c99bb",   # Q2, as originally filed
        "28a344fe-740e-49ab-a350-86fd7734a49a",   # 2A
        "bdc2d247-468f-4610-9a42-7e6dee80fb71",   # 2A filed 2015 — the current row
    ]
    assert [(r[2], r[3]) for r in rows] == [(False, True), (False, False), (True, False)]
    assert rows[0][4] == rows[1][0] and rows[1][4] == rows[2][0] and rows[2][4] is None


@pytest.mark.realdb
def test_every_lane_has_exactly_one_current_and_original(realdb):
    bad = realdb.execute("""
        SELECT count(*) FROM (
            SELECT 1 FROM filings
            GROUP BY registrant_id, client_id, filing_year, filing_period,
                     document_kind, is_termination
            HAVING count(*) FILTER (WHERE is_current) <> 1
                OR count(*) FILTER (WHERE is_original) <> 1
        ) violations
    """).fetchone()[0]
    assert bad == 0


@pytest.mark.realdb
def test_income_and_expenses_never_combined(realdb):
    assert realdb.execute(
        "SELECT count(*) FROM filings WHERE amount_type = 'income' AND amount <> income"
    ).fetchone()[0] == 0
    assert realdb.execute(
        "SELECT count(*) FROM filings WHERE amount_type = 'expenses' AND amount <> expenses"
    ).fetchone()[0] == 0
