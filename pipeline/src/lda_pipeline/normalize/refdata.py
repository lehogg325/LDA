"""Loads the constants endpoints (stored raw by the ingest) into reference tables.

Filing-type classification is derived from the constants' own display names — no
hardcoded code lists. An unparseable display name fails loudly rather than guessing.
"""

from __future__ import annotations

import json

import psycopg

from ..db import data_dir


def classify_filing_type(code: str, name: str) -> tuple[str, bool, bool, bool]:
    if "Registration" in name:
        kind = "registration"
    elif "Quarter" in name:
        kind = "quarterly"
    elif "Mid-Year" in name or "Year-End" in name:
        kind = "semiannual"
    else:
        raise ValueError(f"cannot classify filing type {code!r} ({name!r}) — new code needs review")
    return (kind, "Termination" in name, "Amendment" in name, "(No Activity)" in name)


def _constants(slug: str) -> list[dict]:
    path = data_dir() / "raw" / "constants" / f"{slug}.json"
    if not path.exists():
        raise SystemExit(f"constants file missing: {path} (run lda-ingest first)")
    return json.loads(path.read_text())["body"]


def load_reference_tables(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        for item in _constants("filingtypes"):
            kind, term, amend, noact = classify_filing_type(item["value"], item["name"])
            cur.execute(
                "INSERT INTO ref_filing_types VALUES (%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (code) DO UPDATE SET display=EXCLUDED.display, "
                "document_kind=EXCLUDED.document_kind, is_termination=EXCLUDED.is_termination, "
                "is_amendment=EXCLUDED.is_amendment, is_no_activity=EXCLUDED.is_no_activity",
                (item["value"], item["name"], kind, term, amend, noact),
            )
        for slug, table in (("lobbyingactivityissues", "ref_issue_codes"),
                            ("states", "ref_states"),
                            ("countries", "ref_countries"),
                            ("itemtypes", "ref_contribution_item_types")):
            for item in _constants(slug):
                cur.execute(
                    f"INSERT INTO {table} VALUES (%s,%s) "
                    "ON CONFLICT (code) DO UPDATE SET display=EXCLUDED.display",
                    (item["value"], item["name"]),
                )
        for item in _constants("governmententities"):
            cur.execute(
                "INSERT INTO gov_entities VALUES (%s,%s) "
                "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name",
                (item["id"], item["name"]),
            )
    conn.commit()


def filing_type_map(conn: psycopg.Connection) -> dict[str, tuple[str, bool, bool, bool]]:
    rows = conn.execute(
        "SELECT code, document_kind, is_termination, is_amendment, is_no_activity "
        "FROM ref_filing_types"
    ).fetchall()
    return {r[0]: (r[1], r[2], r[3], r[4]) for r in rows}
