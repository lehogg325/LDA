-- Derived edge table: one row per relationship per quarter, always traceable to its
-- filing_uuid. Rows exist for superseded filings too (flags carried) so the
-- as-originally-filed / as-currently-amended toggle is a WHERE clause, not a rebuild.
--
-- Edge semantics (orientations documented in docs/schema.md):
--   represents : registrant -> client, carries the money (amount + amount_type)
--   worked_on  : lobbyist -> registrant AND lobbyist -> client (two rows per
--                (filing, lobbyist); filing_uuid preserves the triple)
--   targeted   : client -> government entity; per-activity for filings posted after
--                2021-02-14 (attribution_level='activity', that activity's issue code),
--                per-filing for legacy postings (attribution_level='filing', all codes)

CREATE TABLE edges (
    edge_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    edge_type     text NOT NULL CHECK (edge_type IN ('represents', 'worked_on', 'targeted')),
    source_type   text NOT NULL,
    source_id     bigint NOT NULL,
    target_type   text NOT NULL,
    target_id     bigint NOT NULL,
    filing_year   integer NOT NULL,
    filing_period text NOT NULL,
    period_ord    integer NOT NULL,
    filing_uuid   uuid NOT NULL REFERENCES filings (filing_uuid) ON DELETE CASCADE,
    document_kind text NOT NULL,
    is_termination bool NOT NULL,
    amount        numeric(16, 2),
    amount_type   text,
    issue_codes   text[],
    attribution_level text,
    is_superseded bool NOT NULL,
    is_original   bool NOT NULL
);

CREATE INDEX edges_quarter_idx ON edges (filing_year, filing_period);
CREATE INDEX edges_source_idx ON edges (source_type, source_id, period_ord);
CREATE INDEX edges_target_idx ON edges (target_type, target_id, period_ord);
CREATE INDEX edges_filing_idx ON edges (filing_uuid);
