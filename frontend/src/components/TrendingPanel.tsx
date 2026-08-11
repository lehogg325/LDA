// Browsable front door for the landing page: the companies and registrants users
// have actually searched for the most in the last 30 days — real usage, via the
// search_events log (SearchBox.tsx logs a selection; see api.logSearch) — not a
// node_metrics-derived proxy like connections or reported income.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type NodeType, type SearchTrendingResult } from "../api/client";
import type { Anchor } from "../state/store";

const TYPE_LABEL: Record<string, string> = { registrant: "Registrant", client: "Client" };
const WINDOW_DAYS = 30;

export function TrendingPanel({ onSelect }: { onSelect: (anchor: Anchor) => void }) {
  const [resolving, setResolving] = useState<string | null>(null);
  const top = useQuery({
    queryKey: ["searchTrending", WINDOW_DAYS],
    queryFn: () => api.searchTrending(WINDOW_DAYS),
    staleTime: Infinity,
  });

  async function select(r: SearchTrendingResult) {
    const key = `${r.node_type}:${r.label}`;
    setResolving(key);
    // The log only keeps (node_type, label) — resolve current ids fresh, same
    // re-resolution pattern used elsewhere (NodePanel.expand, edge-filings ids).
    let ids: number[] | null = null;
    try {
      const s = await api.search(r.label);
      const hit = s.results.find((h) => h.node_type === r.node_type && h.label === r.label);
      if (hit) ids = hit.ids;
    } catch { /* fall through to the not-found case below */ }
    setResolving(null);
    if (ids) onSelect({ node_type: r.node_type as NodeType, ids, label: r.label });
  }

  return (
    <div className="trending-panel">
      <div className="trending-header">
        <span className="trending-title">Trending — Last {WINDOW_DAYS} Days</span>
      </div>
      {!top.data ? (
        <p className="trending-status">Loading…</p>
      ) : top.data.results.length === 0 ? (
        <p className="trending-status">No searches recorded yet.</p>
      ) : (
        <ul className="trending-list">
          {top.data.results.map((r) => {
            const key = `${r.node_type}:${r.label}`;
            return (
              <li key={key}>
                <button disabled={resolving === key} onClick={() => select(r)}>
                  <span className={`badge badge-${r.node_type}`}>{TYPE_LABEL[r.node_type]}</span>
                  <span className="trending-label">{r.label}</span>
                  <span className="trending-value">
                    {r.count} search{r.count === 1 ? "" : "es"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
