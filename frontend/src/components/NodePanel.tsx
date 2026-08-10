// Node side panel: what the clicked registrant/lobbyist/client/entity lobbied on in
// the displayed quarter, grouped by general issue code, every activity traceable to
// its official filing document. Follows the quarter slider and the amended/original
// toggle. The collapsed anchor queries across its whole name-group.

import { useEffect, useState } from "react";
import { api, periodLabel, type NodeActivities } from "../api/client";
import type { ExpansionInfo } from "../graph/useEgoWindow";
import { MAX_EXPANSIONS, useStore } from "../state/store";

const TYPE_LABEL: Record<string, string> = {
  registrant: "Registrant", client: "Client", lobbyist: "Lobbyist", gov_entity: "Gov entity",
};

const PERIODS_BY_DIGIT = ["", "first_quarter", "second_quarter", "third_quarter",
                          "fourth_quarter", "mid_year", "year_end"];

interface NodePanelProps {
  expansionInfo?: ExpansionInfo[];
  highlighted?: boolean; // guided-tour spotlight
}

export function NodePanel({ expansionInfo, highlighted }: NodePanelProps) {
  const node = useStore((s) => s.selectedNode);
  const anchor = useStore((s) => s.anchor);
  const quarterOrd = useStore((s) => s.quarterOrd);
  const view = useStore((s) => s.view);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  const expansions = useStore((s) => s.expansions);
  const addExpansion = useStore((s) => s.addExpansion);
  const removeExpansion = useStore((s) => s.removeExpansion);
  const [data, setData] = useState<NodeActivities | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    setData(null);
    if (!node || quarterOrd === null) return;
    const year = Math.floor(quarterOrd / 10);
    const period = PERIODS_BY_DIGIT[quarterOrd % 10];
    // The collapsed anchor node carries min(group ids); expand back to the group.
    const ids = anchor && node.node_type === anchor.node_type
      && node.node_id === Math.min(...anchor.ids)
      ? anchor.ids : [node.node_id];
    api.nodeActivities(node.node_type, ids, year, period, view)
      .then(setData)
      .catch(() => setData({ issues: [], n_filings: 0, truncated: false }));
  }, [node, anchor, quarterOrd, view]);

  if (!node) return null;
  const quarter = quarterOrd !== null
    ? `${Math.floor(quarterOrd / 10)} ${periodLabel(PERIODS_BY_DIGIT[quarterOrd % 10])}`
    : "";

  // Expansion controls: hidden for the anchor (its connections ARE the graph).
  const isAnchor = anchor !== null && node.node_type === anchor.node_type
    && node.node_id === Math.min(...anchor.ids);
  const expanded = expansions.some(
    (x) => x.node_type === node.node_type && x.label === node.label);
  const info = expansionInfo?.find(
    (i) => i.node_type === node.node_type && i.label === node.label);
  const atCap = expansions.length >= MAX_EXPANSIONS;

  const expand = async () => {
    setResolving(true);
    let ids = [node.node_id];
    try {
      if (node.node_type === "client" || node.node_type === "lobbyist") {
        // These IDs are registration-scoped; resolve the exact-name group so the
        // expansion covers the entity's whole network, not one registration's slice.
        const r = await api.search(node.label);
        const hit = r.results.find(
          (h) => h.node_type === node.node_type && h.label === node.label);
        if (hit) ids = hit.ids;
      }
    } catch { /* fall back to the single id */ }
    addExpansion({ node_type: node.node_type, ids, label: node.label });
    setResolving(false);
  };

  return (
    <aside className={`debug-panel node-panel${highlighted ? " tour-highlight" : ""}`}>
      <header>
        <span><strong>{TYPE_LABEL[node.node_type]}</strong> · lobbying activity</span>
        <button onClick={() => setSelectedNode(null)}>×</button>
      </header>
      <h3 className="node-title">{node.label}</h3>
      {!isAnchor && (expanded ? (
        <p className="expand-row">
          {info?.state === "too-large" ? <em>⚠ too large to add — graph budget</em>
            : info?.state === "adding" ? <em>adding connections…</em>
            : <em>✓ connections in graph{info?.truncated ? " (server-capped)" : ""}</em>}
          <button onClick={() => removeExpansion(node.node_type, node.label)}>remove</button>
        </p>
      ) : (
        <button
          className="expand-btn"
          disabled={resolving || atCap}
          title={atCap ? `Limit of ${MAX_EXPANSIONS} expansions — remove some first` : undefined}
          onClick={expand}
        >
          {resolving ? "resolving…" : "⊕ Add connections to graph"}
        </button>
      ))}
      <h4>
        Issues lobbied ({quarter}{view === "original" ? ", as filed" : ""})
        {data && data.n_filings > 0 && ` · ${data.n_filings} filing${data.n_filings === 1 ? "" : "s"}`}
      </h4>
      {data === null ? (
        <p>Loading…</p>
      ) : data.issues.length === 0 ? (
        <p className="note">No activity detail reported this quarter.</p>
      ) : (
        <>
          {data.truncated && (
            <p className="note">Very large record — showing the first slice of activities.</p>
          )}
          {data.issues.map((g) => (
            <details key={g.code} className="issue-group" open={data.issues.length <= 3}>
              <summary>
                {g.display}
                <em> · {g.n_activities} activit{g.n_activities === 1 ? "y" : "ies"}</em>
              </summary>
              <ul>
                {g.activities.map((a, i) => (
                  <li key={`${a.filing_uuid}:${i}`}>
                    {a.description
                      ? <span className="desc">{a.description}</span>
                      : <em>No description given.</em>}
                    <div className="act-meta">
                      <a href={a.filing_document_url} target="_blank" rel="noreferrer">
                        {node.node_type === "registrant" ? `for ${a.client}`
                          : node.node_type === "client" ? `via ${a.registrant}`
                          : `${a.registrant} for ${a.client}`}
                      </a>
                    </div>
                  </li>
                ))}
                {g.n_activities > g.activities.length && (
                  <li className="note">…and {g.n_activities - g.activities.length} more</li>
                )}
              </ul>
            </details>
          ))}
        </>
      )}
    </aside>
  );
}
