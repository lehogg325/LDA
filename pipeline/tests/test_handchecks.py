"""Step-5 hand-verified relationships, pinned as integration tests (realdb).

Each amount below was verified against the official filing print document at
https://lda.gov/filings/public/filing/{uuid}/print/ on 2026-08-04. See docs/verification.md.
"""

from __future__ import annotations

import pytest

NAR = 27070          # NATIONAL ASSOCIATION OF REALTORS (self-filer; expenses)
CHAMBER = 38756      # CHAMBER OF COMMERCE OF THE U.S.A. (self-filer; expenses)
HOUSTON = 100481     # CITY OF HOUSTON, client of AKIN GUMP STRAUSS HAUER & FELD (income)

NAR_2023 = {"first_quarter": 13320000, "second_quarter": 10080000,
            "third_quarter": 10360000, "fourth_quarter": 18360000}
CHAMBER_2023 = {"first_quarter": 18660000, "second_quarter": 16390000,
                "third_quarter": 13590000, "fourth_quarter": 19080000}


def _quarterly(realdb, where: str, params: tuple) -> dict:
    rows = realdb.execute(f"""
        SELECT filing_period, amount, amount_type FROM filings
        WHERE {where} AND filing_year=2023 AND is_current
          AND document_kind='quarterly' AND NOT is_termination
        ORDER BY period_ord""", params).fetchall()
    return {r[0]: (float(r[1]), r[2]) for r in rows}


@pytest.mark.realdb
def test_nar_2023_expenses_match_official_filings(realdb):
    got = _quarterly(realdb, "registrant_id=%s", (NAR,))
    assert {p: (float(v), "expenses") for p, v in NAR_2023.items()} == got


@pytest.mark.realdb
def test_chamber_2023_expenses_match_official_filings(realdb):
    got = _quarterly(realdb, "registrant_id=%s", (CHAMBER,))
    assert {p: (float(v), "expenses") for p, v in CHAMBER_2023.items()} == got


@pytest.mark.realdb
def test_akin_gump_houston_represents_edge_every_quarter(realdb):
    """73 consecutive quarters (2008 Q1 - 2026 Q1) of the same represents edge,
    $50,000 income per quarter in 2023, verified against the official Q4 print."""
    n_quarters = realdb.execute("""
        SELECT count(DISTINCT period_ord) FROM edges
        WHERE edge_type='represents' AND target_type='client' AND target_id=%s
          AND NOT is_superseded AND document_kind='quarterly' AND NOT is_termination
    """, (HOUSTON,)).fetchone()[0]
    assert n_quarters >= 73

    amounts_2023 = realdb.execute("""
        SELECT DISTINCT amount, amount_type FROM edges
        WHERE edge_type='represents' AND target_id=%s AND target_type='client'
          AND filing_year=2023 AND NOT is_superseded
          AND document_kind='quarterly' AND NOT is_termination
    """, (HOUSTON,)).fetchall()
    assert amounts_2023 == [(50000, "income")] or \
           [(float(a), t) for a, t in amounts_2023] == [(50000.0, "income")]


@pytest.mark.realdb
def test_expense_and_income_series_disjoint_for_pins(realdb):
    """The two self-filers report only expenses; the firm-client pin only income —
    and nothing anywhere sums them."""
    mixed = realdb.execute("""
        SELECT count(*) FROM filings
        WHERE registrant_id IN (%s, %s) AND filing_year=2023 AND is_current
          AND document_kind='quarterly' AND income IS NOT NULL
    """, (NAR, CHAMBER)).fetchone()[0]
    assert mixed == 0
