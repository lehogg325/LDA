import { useEffect, useRef, useState } from "react";
import { api, periodLabel, type SearchHit } from "../api/client";
import { useStore } from "../state/store";

const TYPE_BADGE: Record<string, string> = {
  registrant: "Registrant", client: "Client", lobbyist: "Lobbyist", gov_entity: "Gov entity",
};

export function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const setAnchor = useStore((s) => s.setAnchor);
  const timer = useRef<number | undefined>(undefined);
  const suppressSearch = useRef(false);

  useEffect(() => {
    if (suppressSearch.current) { suppressSearch.current = false; return; }
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) { setHits([]); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.search(q.trim());
        setHits(r.results);
        setOpen(true);
      } catch { setHits([]); }
    }, 180);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  const ordLabel = (ord: number | null) =>
    ord === null ? "" : `${Math.floor(ord / 10)} ${periodLabel(
      ["", "first_quarter", "second_quarter", "third_quarter", "fourth_quarter", "mid_year", "year_end"][ord % 10])}`;

  return (
    <div className="searchbox">
      <input
        value={q}
        placeholder="Search registrants, clients, lobbyists, government entities…"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
      />
      {open && hits.length > 0 && (
        <ul className="search-results" onMouseLeave={() => setOpen(false)}>
          {hits.map((h) => (
            <li
              key={`${h.node_type}:${h.label}:${h.ids[0]}`}
              onClick={() => {
                setAnchor({ node_type: h.node_type, ids: h.ids, label: h.label });
                setOpen(false);
                suppressSearch.current = true;   // programmatic setQ must not re-search
                setQ(h.label);
                setHits([]);
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
