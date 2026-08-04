-- Self-referencing FKs need an index on the referencing column, or per-partition
-- DELETEs degrade to a seq scan per deleted row (observed: 72-minute partition reload).
CREATE INDEX filings_superseded_by_idx ON filings (superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX contribution_filings_superseded_by_idx ON contribution_filings (superseded_by) WHERE superseded_by IS NOT NULL;
