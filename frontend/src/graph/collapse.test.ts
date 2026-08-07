import { describe, expect, it } from "vitest";
import type { EgoEdge, EgoNode, EgoResponse, NodeType } from "../api/client";
import { makeCollapse, mergeQuarter, superKeyOf, toDisplaySpace } from "./collapse";

const node = (t: NodeType, id: number, degree: number | null, extra: Partial<EgoNode> = {}): EgoNode => ({
  node_type: t, node_id: id, label: `${t}-${id}`, is_anchor: false,
  metrics: degree === null ? null : {
    degree, weighted_degree: degree * 2, total_income: null, total_expenses: null,
    community_id: 7, betweenness: 0.5,
  },
  ...extra,
});

const edge = (st: NodeType, sid: number, tt: NodeType, tid: number, uuid = "f1"): EgoEdge => ({
  edge_type: "targeted", source: { node_type: st, node_id: sid },
  target: { node_type: tt, node_id: tid }, filing_uuid: uuid, amount: null,
  amount_type: null, issue_codes: null, attribution_level: "activity", is_superseded: false,
});

const resp = (nodes: EgoNode[], edges: EgoEdge[]): EgoResponse => ({
  nodes, edges, truncated: false, dropped: [], year: 2023, period: "first_quarter",
});

describe("makeCollapse", () => {
  it("uses the numeric min id (key strings sort lexicographically)", () => {
    const c = makeCollapse({ node_type: "client", ids: [79, 9, 100], label: "ACME" });
    expect(c.node_id).toBe(9);
    expect(superKeyOf(c)).toBe("client:9");
    expect(c.members).toEqual(new Set(["client:79", "client:9", "client:100"]));
  });

  it("labels the aggregation itself; single-id anchors keep the plain label", () => {
    expect(makeCollapse({ node_type: "client", ids: [1, 2], label: "ACME" }).label)
      .toBe("ACME · 2 registrations");
    expect(makeCollapse({ node_type: "client", ids: [1], label: "ACME" }).label).toBe("ACME");
  });
});

describe("toDisplaySpace", () => {
  const anchor = { node_type: "client" as const, ids: [1, 2, 3], label: "ACME" };
  const c = makeCollapse(anchor);

  it("is the identity for single-id anchors (same reference, cache-friendly)", () => {
    const r = resp([node("client", 1, 3, { is_anchor: true })], [edge("client", 1, "gov_entity", 500)]);
    expect(toDisplaySpace(r, makeCollapse({ ...anchor, ids: [1] }))).toBe(r);
  });

  it("merges member rows into one anchor row with summed degrees; idle members (metrics null) contribute nothing", () => {
    const r = resp([
      node("client", 1, 3, { is_anchor: true }),
      node("client", 2, null, { is_anchor: true }),   // idle registration this quarter
      node("client", 3, 5, { is_anchor: true }),
      node("registrant", 10, 4),
    ], []);
    const d = toDisplaySpace(r, c);
    const anchors = d.nodes.filter((n) => n.is_anchor);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].node_id).toBe(1);
    expect(anchors[0].label).toBe("ACME · 3 registrations");
    expect(anchors[0].metrics?.degree).toBe(8);            // 3 + 0 + 5, never a phantom +1
    expect(anchors[0].metrics?.weighted_degree).toBe(16);
    expect(anchors[0].metrics?.community_id).toBeNull();   // per-member; doesn't aggregate
    expect(d.nodes.find((n) => n.node_type === "registrant")).toBe(r.nodes[3]);
  });

  it("metrics stay null when every member is idle", () => {
    const r = resp([node("client", 1, null), node("client", 2, null)], []);
    expect(toDisplaySpace(r, c).nodes[0].metrics).toBeNull();
  });

  it("sums income and expenses separately, null-safe (never mixed)", () => {
    const r = resp([
      node("client", 1, 1, { metrics: { degree: 1, weighted_degree: 1, total_income: 100,
        total_expenses: null, community_id: null, betweenness: null } }),
      node("client", 2, 1, { metrics: { degree: 1, weighted_degree: 1, total_income: 50,
        total_expenses: 20, community_id: null, betweenness: null } }),
    ], []);
    const m = toDisplaySpace(r, c).nodes[0].metrics!;
    expect(m.total_income).toBe(150);
    expect(m.total_expenses).toBe(20);
  });

  it("re-points member edge endpoints and preserves the originals", () => {
    const r = resp(
      [node("client", 2, 1), node("gov_entity", 500, 1), node("registrant", 10, 1)],
      [edge("client", 2, "gov_entity", 500), edge("registrant", 10, "client", 3),
       edge("registrant", 10, "gov_entity", 500)],
    );
    const d = toDisplaySpace(r, c);
    expect(d.edges[0].source).toEqual({ node_type: "client", node_id: 1 });
    expect(d.edges[0].orig_source).toEqual({ node_type: "client", node_id: 2 });
    expect(d.edges[1].target).toEqual({ node_type: "client", node_id: 1 });
    expect(d.edges[1].orig_target).toEqual({ node_type: "client", node_id: 3 });
    expect(d.edges[2]).toBe(r.edges[2]);   // untouched edges pass by reference
    expect(r.edges[0].source.node_id).toBe(2);   // raw response never mutated
  });

  it("passes dropped[] and quarter metadata through untouched", () => {
    const r = resp([node("client", 1, 1)], []);
    r.dropped = [{ node_type: "registrant", node_id: 10, dropped_neighbors: 4 }];
    const d = toDisplaySpace(r, c);
    expect(d.dropped).toBe(r.dropped);
    expect(d.year).toBe(2023);
  });
});

describe("mergeQuarter", () => {
  const anchor = { node_type: "client" as const, ids: [1, 2], label: "ACME" };
  const c = makeCollapse(anchor);

  const anchorDisplay = toDisplaySpace(
    resp(
      [node("client", 1, 3, { is_anchor: true }), node("client", 2, 2, { is_anchor: true }),
       node("registrant", 10, 4)],
      [edge("client", 1, "gov_entity", 500, "f1"),
       { ...edge("registrant", 10, "client", 1, "f2"), edge_type: "represents" } as EgoEdge],
    ), c);

  it("returns the anchor response untouched when there are no expansions", () => {
    expect(mergeQuarter(anchorDisplay, [], c)).toBe(anchorDisplay);
  });

  it("dedups anchor↔expansion duplicate edges by RAW identity", () => {
    // Expanding registrant:10 re-surfaces the same represents filing f2 (raw endpoint
    // client:1) plus a new client of its own.
    const exp = resp(
      [node("registrant", 10, 4, { is_anchor: true }), node("client", 1, 3), node("client", 70, 1)],
      [{ ...edge("registrant", 10, "client", 1, "f2"), edge_type: "represents" } as EgoEdge,
       { ...edge("registrant", 10, "client", 70, "x1"), edge_type: "represents" } as EgoEdge],
    );
    const m = mergeQuarter(anchorDisplay, [{ resp: exp, memberKeys: new Set(["registrant:10"]) }], c);
    const f2 = m.edges.filter((e) => e.filing_uuid === "f2");
    expect(f2).toHaveLength(1);
    expect(m.edges.filter((e) => e.filing_uuid === "x1")).toHaveLength(1);
    expect(m.nodes.some((n) => n.node_type === "client" && n.node_id === 70)).toBe(true);
  });

  it("preserves a group anchor's same-uuid member pair (display-identical, raw-distinct)", () => {
    // One filing naming both members via different raw endpoints must keep BOTH rows
    // (their display signature is identical — raw identity is what distinguishes them).
    const disp = toDisplaySpace(
      resp(
        [node("client", 1, 1, { is_anchor: true }), node("client", 2, 1, { is_anchor: true }),
         node("gov_entity", 500, 2)],
        [edge("client", 1, "gov_entity", 500, "fx"), edge("client", 2, "gov_entity", 500, "fx")],
      ), c);
    const m = mergeQuarter(disp, [{
      resp: resp([node("registrant", 10, 1, { is_anchor: true })], []),
      memberKeys: new Set(["registrant:10"]),
    }], c);
    expect(m.edges.filter((e) => e.filing_uuid === "fx")).toHaveLength(2);
  });

  it("strips is_anchor from expansion rows; the anchor's own rows win", () => {
    const exp = resp(
      [node("registrant", 10, 9, { is_anchor: true, label: "EXPANDED LABEL" }),
       node("client", 1, 3, { is_anchor: true })],
      [{ ...edge("registrant", 10, "client", 1, "f9"), edge_type: "represents" } as EgoEdge],
    );
    const m = mergeQuarter(anchorDisplay, [{ resp: exp, memberKeys: new Set(["registrant:10"]) }], c);
    const anchors = m.nodes.filter((n) => n.is_anchor);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].node_id).toBe(1); // the collapsed anchor row, from the anchor response
    const reg = m.nodes.find((n) => n.node_type === "registrant" && n.node_id === 10)!;
    expect(reg.label).toBe("registrant-10"); // anchor response's row won
  });

  it("drops the expansion's seeded row in its inactive quarters", () => {
    const exp = resp([node("registrant", 77, null, { is_anchor: true })], []);
    const m = mergeQuarter(anchorDisplay, [{ resp: exp, memberKeys: new Set(["registrant:77"]) }], c);
    expect(m.nodes.some((n) => n.node_id === 77)).toBe(false);
  });

  it("keeps the anchor's truncation signal only", () => {
    const exp = resp([node("registrant", 77, 1, { is_anchor: true })], []);
    exp.truncated = true;
    exp.dropped = [{ node_type: "registrant", node_id: 77, dropped_neighbors: 400 }];
    const m = mergeQuarter(anchorDisplay, [{ resp: exp, memberKeys: new Set(["registrant:77"]) }], c);
    expect(m.truncated).toBe(false);
    expect(m.dropped).toHaveLength(0);
  });
});
