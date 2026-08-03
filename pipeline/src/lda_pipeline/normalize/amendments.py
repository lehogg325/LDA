"""Amendment resolution — the correctness heart of the longitudinal series.

Within a lane (registrant, client, filing_year, filing_period, document_kind,
is_termination), filings are ordered by dt_posted (filing_uuid as a deterministic
tie-break) and chained: superseded_by points to the immediate successor, is_current marks
the chain tail, is_original the head. Latest-filed wins even if a plain report posts after
an amendment. Terminations resolve only against terminations, registrations only against
registrations — neither ever supersedes a quarterly report (spec mandate).

Scoping note: a lane's members always share (filing_year, filing_period), so resolving a
single loaded partition is complete and correct in isolation.
"""

from __future__ import annotations

import psycopg

RESOLVE_SQL = """
WITH ranked AS (
    SELECT filing_uuid,
           lead(filing_uuid) OVER w AS next_uuid,
           lag(filing_uuid)  OVER w IS NULL AS is_original
    FROM filings
    WHERE filing_year = %(year)s AND filing_period = %(period)s
    WINDOW w AS (
        PARTITION BY registrant_id, client_id, filing_year, filing_period,
                     document_kind, is_termination
        ORDER BY dt_posted, filing_uuid
    )
)
UPDATE filings f
SET superseded_by = r.next_uuid,
    is_current    = (r.next_uuid IS NULL),
    is_original   = r.is_original
FROM ranked r
WHERE f.filing_uuid = r.filing_uuid
"""

RESOLVE_CONTRIBUTIONS_SQL = """
WITH ranked AS (
    SELECT filing_uuid,
           lead(filing_uuid) OVER w AS next_uuid,
           lag(filing_uuid)  OVER w IS NULL AS is_original
    FROM contribution_filings
    WHERE filing_year = %(year)s AND filing_period = %(period)s
    WINDOW w AS (
        PARTITION BY filer_type, registrant_id, lobbyist_id, filing_year, filing_period
        ORDER BY dt_posted, filing_uuid
    )
)
UPDATE contribution_filings f
SET superseded_by = r.next_uuid,
    is_current    = (r.next_uuid IS NULL),
    is_original   = r.is_original
FROM ranked r
WHERE f.filing_uuid = r.filing_uuid
"""


def resolve_partition(conn: psycopg.Connection, year: int, period: str,
                      table: str = "filings") -> None:
    sql = RESOLVE_SQL if table == "filings" else RESOLVE_CONTRIBUTIONS_SQL
    conn.execute(sql, {"year": year, "period": period})
