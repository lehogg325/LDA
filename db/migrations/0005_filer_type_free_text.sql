-- filer_type is not the two-value enum assumed ('organization' observed in 2008 data,
-- alongside registrant/lobbyist filers). Keep it free text — values are data-driven,
-- like every other constant in this schema.
ALTER TABLE contribution_filings DROP CONSTRAINT contribution_filings_filer_type_check;
