-- Entity nodes. API numeric IDs are the primary keys; names are display labels only.
-- NO deduplication on name, NO fuzzy matching, nothing auto-merges (spec mandate).
-- Note (measured, see docs/api-notes.md): client IDs are registration-scoped — one
-- real-world client has a distinct ID per registrant relationship. Exact-name grouping
-- for search/display happens through entity_names, never by merging rows.

CREATE TABLE registrants (
    id            bigint PRIMARY KEY,
    display_name  text,
    house_registrant_id bigint,
    city          text,
    state         text,
    country       text,
    ppb_country   text,
    contact_name  text,
    dt_updated    timestamptz
);

CREATE TABLE clients (
    id            bigint PRIMARY KEY,
    display_name  text,
    registrant_scoped_client_id bigint,   -- the filing's per-registrant "client_id" field
    is_government_entity bool,
    state         text,
    country       text,
    ppb_state     text,
    ppb_country   text,
    effective_date date
);

CREATE TABLE lobbyists (
    id            bigint PRIMARY KEY,
    display_name  text,                   -- "FIRST [MIDDLE] LAST", assembled at load
    prefix        text,
    first_name    text,
    middle_name   text,
    nickname      text,
    last_name     text,
    suffix        text
);

-- Alias history: one row per (node, exact name, quarter) observation, deleted and
-- reinserted per partition so normalize re-runs are idempotent.
-- Quarter ordinal = filing_year * 10 + (Q1..Q4 -> 1..4, MY -> 5, YE -> 6).
CREATE TABLE entity_name_observations (
    node_type  text   NOT NULL CHECK (node_type IN ('registrant', 'client', 'lobbyist')),
    node_id    bigint NOT NULL,
    name       text   NOT NULL,
    period_ord integer NOT NULL,
    n_filings  integer NOT NULL,
    PRIMARY KEY (node_type, node_id, name, period_ord)
);

-- Search/alias surface: aggregated once per normalize run (REFRESH MATERIALIZED VIEW).
CREATE MATERIALIZED VIEW entity_names AS
SELECT node_type, node_id, name,
       min(period_ord) AS first_seen_ord,
       max(period_ord) AS last_seen_ord,
       sum(n_filings)::integer AS n_filings
FROM entity_name_observations
GROUP BY node_type, node_id, name;

CREATE UNIQUE INDEX entity_names_pk ON entity_names (node_type, node_id, name);
CREATE INDEX entity_names_trgm ON entity_names USING gin (name gin_trgm_ops);
CREATE INDEX entity_names_name ON entity_names (name);
