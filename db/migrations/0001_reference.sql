-- Reference data. Populated from the constants endpoints (never hardcoded);
-- classification columns on ref_filing_types come from a code map the loader
-- validates against the constants list, failing loudly on unknown codes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE ref_filing_types (
    code          text PRIMARY KEY,
    display       text NOT NULL,
    document_kind text NOT NULL CHECK (document_kind IN ('registration', 'quarterly', 'semiannual')),
    is_termination bool NOT NULL,
    is_amendment   bool NOT NULL,
    is_no_activity bool NOT NULL
);

CREATE TABLE ref_issue_codes (
    code    text PRIMARY KEY,
    display text NOT NULL
);

CREATE TABLE gov_entities (
    id   integer PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE ref_states (
    code    text PRIMARY KEY,
    display text NOT NULL
);

CREATE TABLE ref_countries (
    code    text PRIMARY KEY,
    display text NOT NULL
);

CREATE TABLE ref_contribution_item_types (
    code    text PRIMARY KEY,
    display text NOT NULL
);
