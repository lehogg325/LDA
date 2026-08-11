-- Logs a SearchBox selection (never raw keystrokes) so /search-events/top can rank
-- actually-searched entities — distinct from node_metrics-derived "importance."
-- No IP/session/user tracking: just what was looked up and when.
CREATE TABLE search_events (
    id          bigserial PRIMARY KEY,
    node_type   text NOT NULL CHECK (node_type IN ('registrant', 'client', 'lobbyist', 'gov_entity')),
    label       text NOT NULL,
    searched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_events_lookup_idx ON search_events (node_type, searched_at);
