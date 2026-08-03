-- Core filings schema. The gzipped raw archive is the raw store; these tables hold the
-- typed, graph-relevant projection plus JSONB for display-oriented nested arrays.
--
-- Amendment resolution columns: within a group (registrant, client, year, period, kind-lane)
-- filings form a dt_posted chain; superseded_by points to the immediate successor,
-- is_current marks the chain tail, is_original the chain head. Terminations resolve in
-- their own lane and never supersede quarterly reports; registrations likewise.
--
-- Money: income (firm lobbying for a client) and expenses (self-filing organization) are
-- different measures and are NEVER summed. amount/amount_type carries the filing's single
-- reportable figure. A reported zero is not evidence of no lobbying (is_reported_zero).

CREATE TABLE filings (
    filing_uuid   uuid PRIMARY KEY,
    filing_type   text NOT NULL REFERENCES ref_filing_types (code),
    document_kind text NOT NULL,          -- denormalized from ref_filing_types
    is_termination bool NOT NULL,
    is_amendment   bool NOT NULL,
    is_no_activity bool NOT NULL,
    filing_year   integer NOT NULL,
    filing_period text NOT NULL,
    period_ord    integer NOT NULL,       -- filing_year*10 + period ordinal, for range scans
    registrant_id bigint NOT NULL REFERENCES registrants (id),
    client_id     bigint NOT NULL REFERENCES clients (id),
    income        numeric(16, 2),
    expenses      numeric(16, 2),
    expenses_method text,
    amount        numeric(16, 2),
    amount_type   text CHECK (amount_type IN ('income', 'expenses')),
    is_reported_zero bool NOT NULL DEFAULT false,
    dt_posted     timestamptz NOT NULL,
    termination_date date,
    attribution_level text NOT NULL CHECK (attribution_level IN ('activity', 'filing')),
    is_current    bool NOT NULL DEFAULT true,
    is_original   bool NOT NULL DEFAULT true,
    superseded_by uuid REFERENCES filings (filing_uuid),
    posted_by_name text,
    filing_document_url text,
    registrant_address jsonb,             -- filing-time registrant address block
    foreign_entities jsonb,
    affiliated_organizations jsonb,
    conviction_disclosures jsonb,
    retrieved_at  timestamptz NOT NULL,
    source_request_url text NOT NULL
);

CREATE INDEX filings_group_idx
    ON filings (registrant_id, client_id, filing_year, filing_period, document_kind);
CREATE INDEX filings_quarter_current_idx
    ON filings (filing_year, filing_period) WHERE is_current;
CREATE INDEX filings_client_idx ON filings (client_id);
CREATE INDEX filings_period_ord_idx ON filings (period_ord);

-- Composite natural key (filing_uuid, activity_index): children can be bulk-COPYed
-- without an id-mapping roundtrip against a surrogate key.
CREATE TABLE filing_activities (
    filing_uuid  uuid NOT NULL REFERENCES filings (filing_uuid) ON DELETE CASCADE,
    activity_index integer NOT NULL,
    general_issue_code text REFERENCES ref_issue_codes (code),
    description  text,
    foreign_entity_issues text,
    PRIMARY KEY (filing_uuid, activity_index)
);

CREATE TABLE activity_lobbyists (
    filing_uuid  uuid NOT NULL,
    activity_index integer NOT NULL,
    lobbyist_id  bigint NOT NULL REFERENCES lobbyists (id),
    covered_position text,
    is_new       bool,
    PRIMARY KEY (filing_uuid, activity_index, lobbyist_id),
    FOREIGN KEY (filing_uuid, activity_index)
        REFERENCES filing_activities (filing_uuid, activity_index) ON DELETE CASCADE
);
CREATE INDEX activity_lobbyists_lobbyist_idx ON activity_lobbyists (lobbyist_id);

-- Present for every filing. For filings posted before 2021-02-14 the per-activity lists
-- are the whole-filing list duplicated (verified: 0 of 7,368 multi-activity 2013 filings
-- differ across activities) — attribution_level on the filing records which regime applies.
CREATE TABLE activity_government_entities (
    filing_uuid   uuid NOT NULL,
    activity_index integer NOT NULL,
    gov_entity_id integer NOT NULL REFERENCES gov_entities (id),
    PRIMARY KEY (filing_uuid, activity_index, gov_entity_id),
    FOREIGN KEY (filing_uuid, activity_index)
        REFERENCES filing_activities (filing_uuid, activity_index) ON DELETE CASCADE
);
CREATE INDEX activity_gov_entities_entity_idx ON activity_government_entities (gov_entity_id);

-- Distinct lobbyists per filing (union over its activities), for 1-hop scans.
CREATE TABLE filing_lobbyists (
    filing_uuid uuid NOT NULL REFERENCES filings (filing_uuid) ON DELETE CASCADE,
    lobbyist_id bigint NOT NULL REFERENCES lobbyists (id),
    PRIMARY KEY (filing_uuid, lobbyist_id)
);
CREATE INDEX filing_lobbyists_lobbyist_idx ON filing_lobbyists (lobbyist_id);

-- Provenance per raw partition, feeds the ToS retrieval-date citation in the footer.
CREATE TABLE load_state (
    endpoint      text NOT NULL,
    filing_year   integer NOT NULL,
    filing_period text NOT NULL,
    records_loaded integer NOT NULL,
    retrieved_min timestamptz,
    retrieved_max timestamptz,
    loaded_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (endpoint, filing_year, filing_period)
);
