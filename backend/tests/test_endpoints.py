"""Endpoint behavior against the miniworld (built through the real normalize/edge/metric
code paths). Every named guarantee from the spec has a test here."""

from __future__ import annotations


async def test_search_groups_clients_by_exact_name(client):
    r = (await client.get("/api/search", params={"q": "CLIENT X"})).json()
    client_hits = [h for h in r["results"] if h["node_type"] == "client"]
    assert len(client_hits) == 1
    assert sorted(client_hits[0]["ids"]) == [10, 12]      # two registration-scoped IDs
    assert client_hits[0]["n_ids"] == 2


async def test_search_hits_all_four_node_types(client):
    for q, expected in (("FIRM A", "registrant"), ("ALICE", "lobbyist"),
                        ("SELFCO", "registrant"), ("HOUSE OF", "gov_entity")):
        r = (await client.get("/api/search", params={"q": q})).json()
        assert any(h["node_type"] == expected for h in r["results"]), (q, expected, r)


async def test_ego_respects_view_toggle(client):
    amended = (await client.get("/api/ego/registrant/1",
                                params={"year": 2023, "period": "first_quarter"})).json()
    rep = [e for e in amended["edges"]
           if e["edge_type"] == "represents" and e["target"]["node_id"] == 10]
    assert len(rep) == 1 and rep[0]["amount"] == 75000.0   # amendment wins

    original = (await client.get("/api/ego/registrant/1",
                                 params={"year": 2023, "period": "first_quarter",
                                         "view": "original"})).json()
    rep0 = [e for e in original["edges"]
            if e["edge_type"] == "represents" and e["target"]["node_id"] == 10]
    assert len(rep0) == 1 and rep0[0]["amount"] == 50000.0  # as originally filed


async def test_ego_truncation_signal(tiny_cap_client):
    r = (await tiny_cap_client.get("/api/ego/registrant/1",
                                   params={"year": 2023, "period": "first_quarter",
                                           "hops": 2})).json()
    assert r["truncated"] is True
    assert len(r["nodes"]) <= 3 + 1  # cap binds (anchor + capped expansion)


async def test_income_expenses_never_summed_in_responses(client):
    ego = (await client.get("/api/ego/registrant/2",
                            params={"year": 2023, "period": "first_quarter"})).json()
    rep = [e for e in ego["edges"] if e["edge_type"] == "represents"][0]
    assert rep["amount_type"] == "expenses" and rep["amount"] == 120000.0

    tl = (await client.get("/api/timeline/registrant/2")).json()
    q = tl["quarters"][0]
    assert q["total_expenses"] == 120000.0 and q["total_income"] is None
    # No response field anywhere combines the two measures.
    assert "total_spending" not in q and "amount_total" not in q


async def test_reported_zero_edge_visible_not_absent(client):
    """A reported-zero filing still produces an edge — zero is not absence of lobbying."""
    ego = (await client.get("/api/ego/client/12",
                            params={"year": 2023, "period": "first_quarter"})).json()
    rep = [e for e in ego["edges"] if e["edge_type"] == "represents"]
    assert len(rep) == 1 and rep[0]["amount"] == 0.0


async def test_client_group_ego_unions_ids(client):
    r = (await client.get("/api/ego/client/10",
                          params={"year": 2023, "period": "first_quarter",
                                  "ids": "10,12"})).json()
    reg_edges = [e for e in r["edges"] if e["edge_type"] == "represents"]
    assert {e["target"]["node_id"] for e in reg_edges} == {10, 12}


async def test_diff_classifies_added_dropped_persisting(client):
    r = (await client.get("/api/diff", params={
        "node_type": "registrant", "node_id": 1,
        "from_year": 2023, "from_period": "first_quarter",
        "to_year": 2023, "to_period": "second_quarter"})).json()
    persisting_rep = [p for p in r["persisting"] if p["edge"]["edge_type"] == "represents"]
    assert len(persisting_rep) == 1
    assert persisting_rep[0]["amount_before"] == 75000.0    # amended Q1 figure
    assert persisting_rep[0]["amount_after"] == 60000.0
    assert persisting_rep[0]["amount_delta"] == -15000.0
    dropped = {(e["edge_type"], e["target"]["node_id"]) for e in r["dropped"]}
    assert ("represents", 12) in dropped                    # reported-zero client gone in Q2


async def test_legacy_attribution_labeled(client):
    ego = (await client.get("/api/ego/client/10",
                            params={"year": 2019, "period": "first_quarter"})).json()
    targeted = [e for e in ego["edges"] if e["edge_type"] == "targeted"]
    assert targeted and all(e["attribution_level"] == "filing" for e in targeted)
    # Legacy entity lists dedupe to filing level: one edge despite two activities.
    assert len(targeted) == 1


async def test_every_edge_carries_filing_uuid(client):
    ego = (await client.get("/api/ego/registrant/1",
                            params={"year": 2023, "period": "first_quarter"})).json()
    assert ego["edges"] and all(e["filing_uuid"] for e in ego["edges"])


async def test_quarter_top(client):
    r = (await client.get("/api/quarter/2023/first_quarter/top",
                          params={"metric": "total_expenses"})).json()
    assert r["results"][0]["label"] == "SELFCO INDUSTRIES"
    assert r["results"][0]["total_expenses"] == 120000.0


async def test_filing_debug_view(client):
    detail = (await client.get(
        "/api/filings/10000000-0000-0000-0000-000000000002")).json()
    assert detail["amount"] == 75000.0 and detail["amount_type"] == "income"
    assert detail["is_current"] is True and detail["is_original"] is False
    assert detail["filing_document_url"].endswith("/print/")
    assert detail["activities"][0]["lobbyists"] == ["ALICE SMITH"]

    behind = (await client.get("/api/edge-filings", params={
        "source_type": "registrant", "source_id": 1, "target_type": "client",
        "target_id": 10, "year": 2023, "period": "first_quarter"})).json()
    # Both the original and the amendment stand behind this edge, each with its doc URL.
    assert len(behind["filings"]) == 2
    assert all(f["filing_document_url"] for f in behind["filings"])
    assert {f["is_current"] for f in behind["filings"]} == {True, False}


async def test_edge_filings_accepts_id_lists(client):
    """A collapsed name-group edge (CLIENT X CORP = ids 10 and 12, both targeting
    SENATE in 2023 Q1) queries with CSV id lists and gets the union of both member
    pairs' filings."""
    single = (await client.get("/api/edge-filings", params={
        "source_type": "client", "source_id": 10, "target_type": "gov_entity",
        "target_id": 3, "year": 2023, "period": "first_quarter"})).json()
    grouped = (await client.get("/api/edge-filings", params={
        "source_type": "client", "source_id": 10, "source_ids": "10,12",
        "target_type": "gov_entity", "target_id": 3, "target_ids": "3",
        "year": 2023, "period": "first_quarter"})).json()
    single_uuids = {f["filing_uuid"] for f in single["filings"]}
    grouped_uuids = {f["filing_uuid"] for f in grouped["filings"]}
    assert single_uuids < grouped_uuids
    # The second member's filing (f4: FIRM A -> CLIENT X(12), reported zero) appears.
    assert "10000000-0000-0000-0000-000000000004" in grouped_uuids
    # Batched detail keeps document URLs intact for every filing.
    assert all(f["filing_document_url"] for f in grouped["filings"])

    bad = await client.get("/api/edge-filings", params={
        "source_type": "client", "source_id": 10, "source_ids": "10,oops",
        "target_type": "gov_entity", "target_id": 3,
        "year": 2023, "period": "first_quarter"})
    assert bad.status_code == 422


async def test_node_activities(client):
    """The node panel's data: issues lobbied per quarter, honoring the view toggle."""
    # Registrant FIRM A in 2023 Q1: DEF via the amendment f1a (f1 superseded) + TAX via f4.
    r = (await client.get("/api/node-activities", params={
        "node_type": "registrant", "ids": "1", "year": 2023,
        "period": "first_quarter"})).json()
    assert {g["code"] for g in r["issues"]} == {"DEF", "TAX"}
    assert {g["display"] for g in r["issues"]} == {"Defense", "Taxation"}
    uuids = {a["filing_uuid"] for g in r["issues"] for a in g["activities"]}
    assert "10000000-0000-0000-0000-000000000002" in uuids   # amendment (current)
    assert "10000000-0000-0000-0000-000000000001" not in uuids  # superseded original
    assert r["n_filings"] == 2

    # As-filed view swaps the amendment for the original.
    r0 = (await client.get("/api/node-activities", params={
        "node_type": "registrant", "ids": "1", "year": 2023,
        "period": "first_quarter", "view": "original"})).json()
    uuids0 = {a["filing_uuid"] for g in r0["issues"] for a in g["activities"]}
    assert "10000000-0000-0000-0000-000000000001" in uuids0
    assert "10000000-0000-0000-0000-000000000002" not in uuids0

    # Lobbyist BOB JONES appears only on SELFCO's TAX activity.
    rl = (await client.get("/api/node-activities", params={
        "node_type": "lobbyist", "ids": "101", "year": 2023,
        "period": "first_quarter"})).json()
    assert [g["code"] for g in rl["issues"]] == ["TAX"]
    assert rl["issues"][0]["activities"][0]["client"] == "SELFCO INDUSTRIES"

    # CSV ids widen the scope (the collapsed CLIENT X CORP name-group: ids 10 and 12).
    rc = (await client.get("/api/node-activities", params={
        "node_type": "client", "ids": "10,12", "year": 2023,
        "period": "first_quarter"})).json()
    assert rc["n_filings"] == 2 and {g["code"] for g in rc["issues"]} == {"DEF", "TAX"}


async def test_search_events_logged_and_ranked(client):
    """POSTing a selection logs it; GET .../top ranks by count within the window,
    restricted to client/registrant (never lobbyist/gov_entity)."""
    await client.post("/api/search-events", params={"node_type": "registrant", "label": "FIRM A"})
    await client.post("/api/search-events", params={"node_type": "registrant", "label": "FIRM A"})
    await client.post("/api/search-events", params={"node_type": "client", "label": "CLIENT X CORP"})
    await client.post("/api/search-events", params={"node_type": "lobbyist", "label": "ALICE SMITH"})

    r = (await client.get("/api/search-events/top")).json()
    top_two = r["results"][:2]
    assert top_two[0] == {"node_type": "registrant", "label": "FIRM A", "count": 2}
    assert top_two[1] == {"node_type": "client", "label": "CLIENT X CORP", "count": 1}
    assert all(row["node_type"] != "lobbyist" for row in r["results"])

    bad = await client.post("/api/search-events", params={"node_type": "nope", "label": "X"})
    assert bad.status_code == 422


async def test_meta_serves_disclaimer_and_quarters(client):
    r = (await client.get("/api/meta")).json()
    assert "cannot vouch" in r["disclaimer"]
    assert {(q["year"], q["period"]) for q in r["quarters"]} >= {
        (2023, "first_quarter"), (2023, "second_quarter")}
    assert r["retrieved_from"] is not None
