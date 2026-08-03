"""Postgres connection + raw-archive access shared by normalize/edges/metrics.

The pipeline reads two data contracts produced by the ingest layer (deliberately without
importing lda_ingest — the packages stay decoupled): the SQLite manifest, and the gzipped
JSONL part files. Only partitions the ingest marked 'verified' are ever loaded.
"""

from __future__ import annotations

import gzip
import json
import os
import sqlite3
from pathlib import Path

import psycopg


def _read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                values[k.strip()] = v.strip().strip("'\"")
    return values


def env() -> dict[str, str]:
    return {**_read_dotenv(Path.cwd() / ".env"), **os.environ}


def connect(database_url: str | None = None) -> psycopg.Connection:
    url = database_url or env().get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set (in .env or environment)")
    return psycopg.connect(url)


def data_dir() -> Path:
    return Path(env().get("LDA_DATA_DIR", "./data")).resolve()


def manifest_conn() -> sqlite3.Connection:
    path = data_dir() / "manifest.sqlite"
    if not path.exists():
        raise SystemExit(f"manifest not found at {path}")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def verified_partitions(endpoint: str | None = None) -> list[sqlite3.Row]:
    with manifest_conn() as conn:
        q = "SELECT * FROM partitions WHERE status = 'verified'"
        args: tuple = ()
        if endpoint:
            q += " AND endpoint = ?"
            args = (endpoint,)
        return conn.execute(q + " ORDER BY endpoint, filing_year, filing_period", args).fetchall()


def partition_part_files(endpoint: str, year: int, period: str) -> list[str]:
    """Part files for a partition, including its repair rounds ('filings#repair1', ...).
    Repair rounds re-pull the same slice under reversed ordering; the loader dedupes by
    record key, so unioning them here is exactly right."""
    with manifest_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT part_file FROM pages "
            "WHERE (endpoint = ? OR endpoint LIKE ?) AND filing_year=? AND filing_period=? "
            "ORDER BY part_file",
            (endpoint, f"{endpoint}#repair%", year, period),
        ).fetchall()
    return [r["part_file"] for r in rows]


def iter_partition_records(endpoint: str, year: int, period: str):
    """Yield (record, retrieved_at, request_url) from a partition's committed pages."""
    base = data_dir()
    for part_file in partition_part_files(endpoint, year, period):
        with gzip.open(base / part_file, "rt", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                envelope = json.loads(line)
                for record in envelope["body"]["results"]:
                    yield record, envelope["retrieved_at"], envelope["request_url"]
