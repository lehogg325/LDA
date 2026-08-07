// Typed wrappers over the backend API. All data comes from our Postgres —
// the browser never talks to the LDA API.

export type NodeType = "registrant" | "client" | "lobbyist" | "gov_entity";
export type ViewMode = "amended" | "original";

export interface SearchHit {
  node_type: NodeType;
  label: string;
  ids: number[];
  n_ids: number;
  first_ord: number | null;
  last_ord: number | null;
  n_filings: number | null;
}

export interface NodeMetrics {
  degree: number;
  weighted_degree: number;
  total_income: number | null;
  total_expenses: number | null;
  community_id: number | null;
  betweenness: number | null;
}

export interface EgoNode {
  node_type: NodeType;
  node_id: number;
  label: string;
  is_anchor: boolean;
  metrics: NodeMetrics | null;
}

export interface EgoEdge {
  edge_type: "represents" | "worked_on" | "targeted";
  source: { node_type: NodeType; node_id: number };
  target: { node_type: NodeType; node_id: number };
  filing_uuid: string;
  amount: number | null;
  amount_type: "income" | "expenses" | null;
  issue_codes: string[] | null;
  attribution_level: "activity" | "filing" | null;
  is_superseded: boolean;
  /** Client-side only: how many parallel edges were aggregated into this one. */
  agg_count?: number;
  /** Client-side only: same-amount_type sum across the aggregated edges. */
  agg_amount?: number;
  /** Client-side only: pre-collapse endpoints (name-group anchors render as one
   * node, but the underlying registration-scoped IDs stay distinct). */
  orig_source?: { node_type: NodeType; node_id: number };
  orig_target?: { node_type: NodeType; node_id: number };
  /** Client-side only: distinct underlying endpoint ids behind an aggregated edge. */
  source_ids?: number[];
  target_ids?: number[];
}

export interface EgoResponse {
  nodes: EgoNode[];
  edges: EgoEdge[];
  truncated: boolean;
  dropped: { node_type: NodeType; node_id: number; dropped_neighbors: number }[];
  year: number;
  period: string;
}

export interface TimelineQuarter {
  year: number;
  period: string;
  period_ord: number;
  degree: number;
  weighted_degree: number;
  total_income: number | null;
  total_expenses: number | null;
}

export interface Meta {
  quarters: { year: number; period: string; period_ord: number }[];
  retrieved_from: string | null;
  retrieved_to: string | null;
  counts: Record<string, number>;
  disclaimer: string;
}

export interface IssueActivity {
  filing_uuid: string;
  description: string | null;
  registrant: string;
  client: string;
  filing_document_url: string;
}

export interface IssueGroup {
  code: string;
  display: string;
  n_activities: number;
  activities: IssueActivity[]; // capped server-side; n_activities is the true count
}

export interface NodeActivities {
  issues: IssueGroup[];
  n_filings: number;
  truncated: boolean;
}

export interface FilingBehindEdge {
  filing_uuid: string;
  filing_type_display: string;
  amount: number | null;
  amount_type: string | null;
  is_current: boolean;
  filing_document_url: string;
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// Anchoring fetches up to ~74 quarters; unbounded parallelism stampedes serverless
// backends (one function invocation per request) into database connection limits.
// A small semaphore keeps the window load fast without the thundering herd.
// Aborted requests (cleared expansions, anchor change) bail before taking a slot —
// otherwise hundreds of dead fetches would starve the next anchor's load.
const MAX_CONCURRENT_EGO = 6;
let egoActive = 0;
const egoWaiters: (() => void)[] = [];
async function egoSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const bail = () => {
    throw new DOMException("ego request aborted before start", "AbortError");
  };
  if (signal?.aborted) bail();
  if (egoActive >= MAX_CONCURRENT_EGO) {
    await new Promise<void>((resolve) => egoWaiters.push(resolve));
    if (signal?.aborted) {
      egoWaiters.shift()?.(); // hand the slot on before bailing
      bail();
    }
  }
  egoActive++;
  try {
    return await fn();
  } finally {
    egoActive--;
    egoWaiters.shift()?.();
  }
}

export const api = {
  search: (q: string) =>
    get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  ego: (t: NodeType, ids: number[], year: number, period: string, hops: number,
        view: ViewMode, signal?: AbortSignal) =>
    egoSlot(() => get<EgoResponse>(
      `/api/ego/${t}/${ids[0]}?ids=${ids.join(",")}&year=${year}&period=${period}&hops=${hops}&view=${view}`,
      signal,
    ), signal),
  timeline: (t: NodeType, ids: number[]) =>
    get<{ quarters: TimelineQuarter[] }>(`/api/timeline/${t}/${ids[0]}?ids=${ids.join(",")}`),
  meta: () => get<Meta>("/api/meta"),
  nodeActivities: (t: NodeType, ids: number[], year: number, period: string, view: ViewMode) =>
    get<NodeActivities>(
      `/api/node-activities?node_type=${t}&ids=${ids.join(",")}&year=${year}` +
        `&period=${period}&view=${view}`,
    ),
  edgeFilings: (e: EgoEdge, year: number, period: string) => {
    // A display edge may aggregate several registration-scoped IDs (a name-group
    // anchor collapses to one node); the backend accepts CSV id lists for that.
    const sIds = e.source_ids?.length ? e.source_ids : [e.source.node_id];
    const tIds = e.target_ids?.length ? e.target_ids : [e.target.node_id];
    return get<{ filings: FilingBehindEdge[] }>(
      `/api/edge-filings?source_type=${e.source.node_type}&source_id=${sIds[0]}` +
        `&source_ids=${sIds.join(",")}` +
        `&target_type=${e.target.node_type}&target_id=${tIds[0]}` +
        `&target_ids=${tIds.join(",")}&year=${year}&period=${period}`,
    );
  },
};

export const PERIODS = ["first_quarter", "second_quarter", "third_quarter", "fourth_quarter"];
export const periodLabel = (p: string) =>
  ({ first_quarter: "Q1", second_quarter: "Q2", third_quarter: "Q3", fourth_quarter: "Q4",
     mid_year: "MY", year_end: "YE" })[p] ?? p;
