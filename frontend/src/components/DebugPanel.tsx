// Debug view (spec): the filings behind any clicked edge, each linking to the
// official document. Every displayed dollar is labeled income or expense.

import { useEffect, useState } from "react";
import { api, ordLabel, ordToYearPeriod, type EgoEdge, type FilingBehindEdge } from "../api/client";
import { useStore } from "../state/store";

interface AmountDelta {
  amount_delta: number;
  amount_type: "income" | "expenses";
}

// Sum amount_delta across every persisting /diff entry touching this edge's
// non-anchor side — a display edge can aggregate several registration-scoped IDs
// (see edgeFilings' source_ids/target_ids), so one entry isn't always the whole story.
function extractDelta(edge: EgoEdge, persisting: { edge: { edge_type: string; target: { node_id: number } }; amount_delta?: number }[]): AmountDelta | null {
  const targetIds = new Set(edge.target_ids?.length ? edge.target_ids : [edge.target.node_id]);
  let sum = 0;
  let found = false;
  for (const p of persisting) {
    if (p.edge.edge_type !== edge.edge_type) continue;
    if (!targetIds.has(p.edge.target.node_id)) continue;
    if (p.amount_delta === undefined) continue;
    sum += p.amount_delta;
    found = true;
  }
  if (!found || edge.amount_type === null) return null;
  return { amount_delta: sum, amount_type: edge.amount_type };
}

interface DebugPanelProps {
  quarters: number[]; // the anchor's visible window, for finding the prior quarter
}

export function DebugPanel({ quarters }: DebugPanelProps) {
  const edge = useStore((s) => s.selectedEdge);
  const quarterOrd = useStore((s) => s.quarterOrd);
  const view = useStore((s) => s.view);
  const setSelectedEdge = useStore((s) => s.setSelectedEdge);
  const [filings, setFilings] = useState<FilingBehindEdge[] | null>(null);
  const [delta, setDelta] = useState<AmountDelta | null>(null);

  useEffect(() => {
    setFilings(null);
    if (!edge || quarterOrd === null) return;
    const { year, period } = ordToYearPeriod(quarterOrd);
    api.edgeFilings(edge, year, period).then((r) => setFilings(r.filings)).catch(() => setFilings([]));
  }, [edge, quarterOrd]);

  useEffect(() => {
    setDelta(null);
    if (!edge || quarterOrd === null) return;
    const idx = quarters.indexOf(quarterOrd);
    if (idx <= 0) return; // first quarter in the window — nothing prior to compare
    const prevOrd = quarters[idx - 1];
    const { year: fromYear, period: fromPeriod } = ordToYearPeriod(prevOrd);
    const { year: toYear, period: toPeriod } = ordToYearPeriod(quarterOrd);
    const sourceIds = edge.source_ids?.length ? edge.source_ids : [edge.source.node_id];
    api.diff(edge.source.node_type, sourceIds, fromYear, fromPeriod, toYear, toPeriod, view)
      .then((r) => setDelta(extractDelta(edge, r.persisting)))
      .catch(() => setDelta(null));
  }, [edge, quarterOrd, quarters, view]);

  if (!edge) return null;
  return (
    <aside className="debug-panel">
      <header>
        <span>
          <strong>{edge.edge_type}</strong> edge
          {(edge.agg_count ?? 1) > 1 && ` · ${edge.agg_count} filings`}
        </span>
        <button onClick={() => setSelectedEdge(null)}>×</button>
      </header>
      {(edge.agg_count ?? 1) > 1 && (edge.agg_amount ?? 0) > 0 && edge.amount_type !== null ? (
        // Aggregated display edge: one representative's amount would mislead — show
        // the same-type sum (income and expenses are never mixed).
        <p className="money">
          ${edge.agg_amount!.toLocaleString()}{" "}
          <em>
            ({edge.amount_type === "income" ? "reported income" : "reported expenses"} summed
            across {edge.agg_count} filings)
          </em>
        </p>
      ) : edge.amount !== null && (
        <p className="money">
          ${edge.amount.toLocaleString()}{" "}
          <em>({edge.amount_type === "income" ? "reported income" : "reported expense"})</em>
        </p>
      )}
      {delta && delta.amount_delta !== 0 && (
        <p className={`money-delta ${delta.amount_delta > 0 ? "up" : "down"}`}>
          {delta.amount_delta > 0 ? "▲" : "▼"} ${Math.abs(delta.amount_delta).toLocaleString()}{" "}
          <em>vs previous quarter ({delta.amount_type})</em>
        </p>
      )}
      {edge.attribution_level === "filing" && (
        <p className="note">Pre-2021 filing: government entities reported per filing, not per activity.</p>
      )}
      {edge.issue_codes && <p className="issues">Issues: {edge.issue_codes.join(", ")}</p>}
      <h4>Underlying filings {quarterOrd !== null && `(${ordLabel(quarterOrd)})`}</h4>
      {filings === null ? <p>Loading…</p> : (
        <ul>
          {filings.map((f) => (
            <li key={f.filing_uuid}>
              <a href={f.filing_document_url} target="_blank" rel="noreferrer">
                {f.filing_type_display}
              </a>{" "}
              {f.amount !== null && (
                <span>${f.amount.toLocaleString()} <em>({f.amount_type})</em></span>
              )}{" "}
              {f.is_current ? <b title="current after amendment resolution">current</b> : <s>superseded</s>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
