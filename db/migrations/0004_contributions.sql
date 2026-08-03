-- LD-203 contribution reports. Same amendment-resolution treatment as filings,
-- grouped on (filer identity, filing_year, filing_period).

CREATE TABLE contribution_filings (
    filing_uuid   uuid PRIMARY KEY,
    filing_type   text NOT NULL,
    filing_year   integer NOT NULL,
    filing_period text NOT NULL,
    registrant_id bigint REFERENCES registrants (id),
    lobbyist_id   bigint REFERENCES lobbyists (id),
    filer_type    text NOT NULL CHECK (filer_type IN ('registrant', 'lobbyist')),
    no_contributions bool NOT NULL DEFAULT false,
    dt_posted     timestamptz NOT NULL,
    is_current    bool NOT NULL DEFAULT true,
    is_original   bool NOT NULL DEFAULT true,
    superseded_by uuid REFERENCES contribution_filings (filing_uuid),
    filing_document_url text,
    raw_extra     jsonb,                   -- filer display fields not yet typed
    retrieved_at  timestamptz NOT NULL,
    source_request_url text NOT NULL
);

CREATE INDEX contribution_filings_quarter_idx ON contribution_filings (filing_year, filing_period);
CREATE INDEX contribution_filings_registrant_idx ON contribution_filings (registrant_id);
CREATE INDEX contribution_filings_lobbyist_idx ON contribution_filings (lobbyist_id);

CREATE TABLE contribution_items (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    filing_uuid  uuid NOT NULL REFERENCES contribution_filings (filing_uuid) ON DELETE CASCADE,
    item_type    text,
    amount       numeric(16, 2),
    contribution_date date,
    contributor_name text,
    payee_name   text,
    honoree_name text
);
CREATE INDEX contribution_items_filing_idx ON contribution_items (filing_uuid);
