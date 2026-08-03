-- Precomputed per-quarter node metrics (never computed in the browser or per request).
-- degree          : distinct neighbors in the quarter's current quarterly-activity graph
-- weighted_degree : incident edge-row count (relationship multiplicity). Deliberately NOT
--                   a money sum: income and expenses are different measures and are never
--                   combined — the split lives in total_income / total_expenses.
-- community_id    : Leiden assignment, per-quarter (labels not aligned across quarters)
-- betweenness     : exact or approximated; method recorded per row

CREATE TABLE node_metrics (
    filing_year   integer NOT NULL,
    filing_period text NOT NULL,
    period_ord    integer NOT NULL,
    node_type     text NOT NULL,
    node_id       bigint NOT NULL,
    degree        integer NOT NULL,
    weighted_degree integer NOT NULL,
    total_income  numeric(18, 2),
    total_expenses numeric(18, 2),
    community_id  integer,
    betweenness   double precision,
    betweenness_method text,
    PRIMARY KEY (filing_year, filing_period, node_type, node_id)
);

CREATE INDEX node_metrics_top_idx ON node_metrics (filing_year, filing_period, degree DESC);
CREATE INDEX node_metrics_node_idx ON node_metrics (node_type, node_id, period_ord);

CREATE TABLE quarters (
    filing_year   integer NOT NULL,
    filing_period text NOT NULL,
    period_ord    integer NOT NULL,
    n_nodes       integer,
    n_edges       integer,
    n_current_filings integer,
    computed_at   timestamptz,
    PRIMARY KEY (filing_year, filing_period)
);
