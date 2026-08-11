// Browsable front door for the landing page: the top companies (client nodes) for
// the most recent filed quarter, by a chosen metric — using /quarter/{year}/{period}/
// top, a backend endpoint the app had never actually called from anywhere.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ordLabel, type TopMetric, type TopResult } from "../api/client";
import type { Anchor } from "../state/store";

const METRIC_OPTIONS: { value: TopMetric; label: string }[] = [
  { value: "weighted_degree", label: "Most connected (by reported $)" },
  { value: "degree", label: "Most connections" },
  { value: "total_income", label: "Highest reported income" },
  { value: "total_expenses", label: "Highest reported expenses" },
  { value: "betweenness", label: "Most central (betweenness)" },
];

function metricValue(r: TopResult, metric: TopMetric): string {
  if (metric === "total_income" || metric === "total_expenses") {
    const v = r[metric];
    return v != null ? `$${v.toLocaleString()}` : "—";
  }
  if (metric === "betweenness") return r.betweenness != null ? r.betweenness.toFixed(3) : "—";
  return r[metric].toLocaleString();
}

export function TrendingPanel({ onSelect }: { onSelect: (anchor: Anchor) => void }) {
  const [metric, setMetric] = useState<TopMetric>("weighted_degree");
  const [resolving, setResolving] = useState<string | null>(null);
  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity });
  const latest = meta.data?.quarters[meta.data.quarters.length - 1];

  const top = useQuery({
    queryKey: ["quarterTop", latest?.year, latest?.period, metric, "client"],
    queryFn: () => api.quarterTop(latest!.year, latest!.period, metric, 10, "client"),
    enabled: latest !== undefined,
    staleTime: Infinity,
  });

  async function select(r: TopResult) {
    const key = `${r.node_type}:${r.node_id}`;
    setResolving(key);
    // /quarter/top returns one registration-scoped id; a company's real network spans
    // every id sharing its exact name (search.py groups client hits the same way the
    // search box does) — resolve that group so the anchor isn't a partial slice.
    let ids = [r.node_id];
    try {
      const s = await api.search(r.label);
      const hit = s.results.find((h) => h.node_type === "client" && h.label === r.label);
      if (hit) ids = hit.ids;
    } catch { /* fall back to the single id */ }
    setResolving(null);
    onSelect({ node_type: r.node_type, ids, label: r.label });
  }

  return (
    <div className="trending-panel">
      <div className="trending-header">
        <span className="trending-title">
          Trending companies{latest && ` — ${ordLabel(latest.period_ord)}`}
        </span>
        <select value={metric} onChange={(e) => setMetric(e.target.value as TopMetric)}>
          {METRIC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {!top.data ? (
        <p className="trending-status">Loading…</p>
      ) : top.data.results.length === 0 ? (
        <p className="trending-status">No data for this quarter.</p>
      ) : (
        <ul className="trending-list">
          {top.data.results.map((r) => {
            const key = `${r.node_type}:${r.node_id}`;
            return (
              <li key={key}>
                <button disabled={resolving === key} onClick={() => select(r)}>
                  <span className="trending-label">{r.label}</span>
                  <span className="trending-value">{metricValue(r, metric)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
