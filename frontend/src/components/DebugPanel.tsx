// Debug view (spec): the filings behind any clicked edge, each linking to the
// official document. Every displayed dollar is labeled income or expense.

import { useEffect, useState } from "react";
import { api, periodLabel, type FilingBehindEdge } from "../api/client";
import { useStore } from "../state/store";

export function DebugPanel() {
  const edge = useStore((s) => s.selectedEdge);
  const quarterOrd = useStore((s) => s.quarterOrd);
  const setSelectedEdge = useStore((s) => s.setSelectedEdge);
  const [filings, setFilings] = useState<FilingBehindEdge[] | null>(null);

  useEffect(() => {
    setFilings(null);
    if (!edge || quarterOrd === null) return;
    const year = Math.floor(quarterOrd / 10);
    const period = ["", "first_quarter", "second_quarter", "third_quarter", "fourth_quarter", "mid_year", "year_end"][quarterOrd % 10];
    api.edgeFilings(edge, year, period).then((r) => setFilings(r.filings)).catch(() => setFilings([]));
  }, [edge, quarterOrd]);

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
      {edge.amount !== null && (
        <p className="money">
          ${edge.amount.toLocaleString()}{" "}
          <em>({edge.amount_type === "income" ? "reported income" : "reported expense"})</em>
        </p>
      )}
      {edge.attribution_level === "filing" && (
        <p className="note">Pre-2021 filing: government entities reported per filing, not per activity.</p>
      )}
      {edge.issue_codes && <p className="issues">Issues: {edge.issue_codes.join(", ")}</p>}
      <h4>Underlying filings {quarterOrd !== null && `(${Math.floor(quarterOrd / 10)} ${periodLabel(["", "first_quarter", "second_quarter", "third_quarter", "fourth_quarter", "mid_year", "year_end"][quarterOrd % 10])})`}</h4>
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
