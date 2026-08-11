import { useEffect, useRef, useState } from "react";
import { api, ordLabel as formatOrd, type SearchHit } from "../api/client";
import { useStore } from "../state/store";

const TYPE_BADGE: Record<string, string> = {
  registrant: "Registrant", client: "Client", lobbyist: "Lobbyist", gov_entity: "Gov entity",
};

export function SearchBox() {
  const [q, setQ] = useState("");
  // null = not yet searched (query too short, or just cleared) — distinct from an
  // empty array, which means a search actually completed with zero matches.
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const setAnchor = useStore((s) => s.setAnchor);
  const anchor = useStore((s) => s.anchor);
  const timer = useRef<number | undefined>(undefined);
  const suppressSearch = useRef(false);

  // Masthead click (or anything else) clearing the anchor returns to the landing
  // page — the box should not keep showing the previous company.
  useEffect(() => {
    if (anchor === null) {
      setQ("");
      setHits(null);
      setOpen(false);
    }
  }, [anchor]);

  useEffect(() => {
    if (suppressSearch.current) { suppressSearch.current = false; return; }
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) { setHits(null); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.search(q.trim());
        setHits(r.results);
        setOpen(true);
      } catch { setHits(null); }
    }, 180);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  const ordLabel = (ord: number | null) => (ord === null ? "" : formatOrd(ord));

  return (
    <div className="searchbox">
      <input
        value={q}
        placeholder="Search registrants, clients, lobbyists, government entities…"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits !== null && setOpen(true)}
      />
      {open && hits !== null && (
        <ul className="search-results" onMouseLeave={() => setOpen(false)}>
          {hits.length === 0 ? (
            <li className="search-no-results">No matches for “{q.trim()}”</li>
          ) : hits.map((h) => (
            <li
              key={`${h.node_type}:${h.label}:${h.ids[0]}`}
              onClick={() => {
                setAnchor({ node_type: h.node_type, ids: h.ids, label: h.label });
                api.logSearch(h.node_type, h.label).catch(() => {}); // best-effort beacon
                setOpen(false);
                suppressSearch.current = true;   // programmatic setQ must not re-search
                setQ(h.label);
                setHits(null);
              }}
            >
              <span className={`badge badge-${h.node_type}`}>{TYPE_BADGE[h.node_type]}</span>
              <span className="hit-label">{h.label}</span>
              <span className="hit-meta">
                {h.n_ids > 1 && <em title="Registration-scoped IDs grouped by exact name">{h.n_ids} registrations</em>}
                {h.first_ord && ` · ${ordLabel(h.first_ord)}–${ordLabel(h.last_ord)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
