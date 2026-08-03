"""Edge building: pure set-based SQL, one quarter at a time, delete+reinsert idempotent."""

from __future__ import annotations

import logging

import psycopg

log = logging.getLogger("lda_pipeline")

REPRESENTS_SQL = """
INSERT INTO edges (edge_type, source_type, source_id, target_type, target_id,
    filing_year, filing_period, period_ord, filing_uuid, document_kind, is_termination,
    amount, amount_type, issue_codes, attribution_level, is_superseded, is_original)
SELECT 'represents', 'registrant', f.registrant_id, 'client', f.client_id,
       f.filing_year, f.filing_period, f.period_ord, f.filing_uuid, f.document_kind,
       f.is_termination, f.amount, f.amount_type,
       (SELECT array_agg(DISTINCT a.general_issue_code)
          FROM filing_activities a
         WHERE a.filing_uuid = f.filing_uuid AND a.general_issue_code IS NOT NULL),
       f.attribution_level, NOT f.is_current, f.is_original
FROM filings f
WHERE f.filing_year = %(year)s AND f.filing_period = %(period)s
"""

WORKED_ON_SQL = """
INSERT INTO edges (edge_type, source_type, source_id, target_type, target_id,
    filing_year, filing_period, period_ord, filing_uuid, document_kind, is_termination,
    amount, amount_type, issue_codes, attribution_level, is_superseded, is_original)
SELECT 'worked_on', 'lobbyist', fl.lobbyist_id, ends.node_type, ends.node_id,
       f.filing_year, f.filing_period, f.period_ord, f.filing_uuid, f.document_kind,
       f.is_termination, NULL, NULL, NULL, f.attribution_level,
       NOT f.is_current, f.is_original
FROM filing_lobbyists fl
JOIN filings f USING (filing_uuid)
CROSS JOIN LATERAL (VALUES ('registrant', f.registrant_id),
                           ('client', f.client_id)) AS ends (node_type, node_id)
WHERE f.filing_year = %(year)s AND f.filing_period = %(period)s
"""

TARGETED_ACTIVITY_SQL = """
INSERT INTO edges (edge_type, source_type, source_id, target_type, target_id,
    filing_year, filing_period, period_ord, filing_uuid, document_kind, is_termination,
    amount, amount_type, issue_codes, attribution_level, is_superseded, is_original)
SELECT 'targeted', 'client', f.client_id, 'gov_entity', age.gov_entity_id,
       f.filing_year, f.filing_period, f.period_ord, f.filing_uuid, f.document_kind,
       f.is_termination, NULL, NULL,
       CASE WHEN a.general_issue_code IS NULL THEN NULL
            ELSE ARRAY[a.general_issue_code] END,
       'activity', NOT f.is_current, f.is_original
FROM activity_government_entities age
JOIN filing_activities a USING (filing_uuid, activity_index)
JOIN filings f USING (filing_uuid)
WHERE f.filing_year = %(year)s AND f.filing_period = %(period)s
  AND f.attribution_level = 'activity'
"""

TARGETED_FILING_SQL = """
INSERT INTO edges (edge_type, source_type, source_id, target_type, target_id,
    filing_year, filing_period, period_ord, filing_uuid, document_kind, is_termination,
    amount, amount_type, issue_codes, attribution_level, is_superseded, is_original)
SELECT 'targeted', 'client', f.client_id, 'gov_entity', ents.gov_entity_id,
       f.filing_year, f.filing_period, f.period_ord, f.filing_uuid, f.document_kind,
       f.is_termination, NULL, NULL,
       (SELECT array_agg(DISTINCT a2.general_issue_code)
          FROM filing_activities a2
         WHERE a2.filing_uuid = f.filing_uuid AND a2.general_issue_code IS NOT NULL),
       'filing', NOT f.is_current, f.is_original
FROM filings f
JOIN LATERAL (
    SELECT DISTINCT age.gov_entity_id
    FROM activity_government_entities age
    WHERE age.filing_uuid = f.filing_uuid
) ents ON true
WHERE f.filing_year = %(year)s AND f.filing_period = %(period)s
  AND f.attribution_level = 'filing'
"""


def build_quarter(conn: psycopg.Connection, year: int, period: str) -> dict[str, int]:
    params = {"year": year, "period": period}
    counts: dict[str, int] = {}
    with conn.cursor() as cur:
        cur.execute("DELETE FROM edges WHERE filing_year=%(year)s AND filing_period=%(period)s",
                    params)
        for name, sql in (("represents", REPRESENTS_SQL), ("worked_on", WORKED_ON_SQL),
                          ("targeted_activity", TARGETED_ACTIVITY_SQL),
                          ("targeted_filing", TARGETED_FILING_SQL)):
            cur.execute(sql, params)
            counts[name] = cur.rowcount
    conn.commit()
    log.info("edges %s/%s: %s", year, period, counts)
    return counts
