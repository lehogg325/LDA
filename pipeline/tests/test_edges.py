"""Edge-table reconciliation against the normalized tables (realdb: runs on loaded quarters)."""

from __future__ import annotations

import pytest


@pytest.fixture(scope="module")
def quarters(realdb):
    rows = realdb.execute(
        "SELECT DISTINCT filing_year, filing_period FROM edges").fetchall()
    if not rows:
        pytest.skip("no edges built yet")
    return rows


@pytest.mark.realdb
def test_represents_edges_reconcile_with_filings(realdb, quarters):
    for year, period in quarters:
        n_edges, n_filings = realdb.execute("""
            SELECT (SELECT count(*) FROM edges
                     WHERE edge_type='represents' AND filing_year=%s AND filing_period=%s),
                   (SELECT count(*) FROM filings
                     WHERE filing_year=%s AND filing_period=%s)
        """, (year, period, year, period)).fetchone()
        assert n_edges == n_filings, (year, period)


@pytest.mark.realdb
def test_worked_on_edges_are_two_per_filing_lobbyist(realdb, quarters):
    for year, period in quarters:
        n_edges, n_fl = realdb.execute("""
            SELECT (SELECT count(*) FROM edges
                     WHERE edge_type='worked_on' AND filing_year=%s AND filing_period=%s),
                   (SELECT count(*) FROM filing_lobbyists fl JOIN filings f USING (filing_uuid)
                     WHERE f.filing_year=%s AND f.filing_period=%s)
        """, (year, period, year, period)).fetchone()
        assert n_edges == 2 * n_fl, (year, period)


@pytest.mark.realdb
def test_every_edge_traceable_to_its_filing(realdb):
    mismatched = realdb.execute("""
        SELECT count(*) FROM edges e JOIN filings f USING (filing_uuid)
        WHERE e.filing_year <> f.filing_year OR e.filing_period <> f.filing_period
           OR e.is_superseded = f.is_current
    """).fetchone()[0]
    assert mismatched == 0
    no_doc_url = realdb.execute(
        "SELECT count(*) FROM edges e JOIN filings f USING (filing_uuid) "
        "WHERE f.filing_document_url IS NULL").fetchone()[0]
    # Debug view requirement: every edge resolves to a filing with a public document URL.
    assert no_doc_url == 0


@pytest.mark.realdb
def test_legacy_quarters_have_no_activity_scoped_entity_edges(realdb):
    bad = realdb.execute("""
        SELECT count(*) FROM edges e JOIN filings f USING (filing_uuid)
        WHERE e.edge_type='targeted'
          AND e.attribution_level <> f.attribution_level
    """).fetchone()[0]
    assert bad == 0
