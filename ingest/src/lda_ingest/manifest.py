"""SQLite manifest: the source of truth for what has been fetched.

A page is *committed* iff its row exists in `pages` — and rows are inserted only after the
part file holding those pages has been fsynced and atomically renamed into place. The ingest
therefore survives kill -9 at any instant without duplicating or skipping work.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS partitions (
  endpoint      TEXT NOT NULL,
  filing_year   INTEGER NOT NULL,          -- 0 for non-year-partitioned endpoints
  filing_period TEXT NOT NULL,             -- 'all' for non-period-partitioned endpoints
  status        TEXT NOT NULL DEFAULT 'pending',
                -- pending | in_progress | fetched | verified | failed
  count_first_seen INTEGER,
  count_final      INTEGER,
  pages_expected   INTEGER,
  started_at TEXT, fetched_at TEXT, verified_at TEXT,
  failure_reason TEXT,
  PRIMARY KEY (endpoint, filing_year, filing_period)
);
CREATE TABLE IF NOT EXISTS pages (
  endpoint TEXT NOT NULL,
  filing_year INTEGER NOT NULL,
  filing_period TEXT NOT NULL,
  page INTEGER NOT NULL,
  request_url TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  retrieved_at TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  part_file TEXT NOT NULL,
  PRIMARY KEY (endpoint, filing_year, filing_period, page)
);
CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  url TEXT NOT NULL,
  http_status INTEGER,
  attempt INTEGER,
  slept_seconds REAL,
  note TEXT
);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Manifest:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    # -- partitions -------------------------------------------------------

    def ensure_partition(self, endpoint: str, year: int, period: str) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO partitions (endpoint, filing_year, filing_period) VALUES (?,?,?)",
            (endpoint, year, period),
        )
        self.db.commit()

    def partition(self, endpoint: str, year: int, period: str) -> sqlite3.Row:
        self.db.row_factory = sqlite3.Row
        row = self.db.execute(
            "SELECT * FROM partitions WHERE endpoint=? AND filing_year=? AND filing_period=?",
            (endpoint, year, period),
        ).fetchone()
        self.db.row_factory = None
        return row

    def partitions(self, statuses: tuple[str, ...] | None = None) -> list[sqlite3.Row]:
        self.db.row_factory = sqlite3.Row
        if statuses:
            marks = ",".join("?" * len(statuses))
            rows = self.db.execute(
                f"SELECT * FROM partitions WHERE status IN ({marks}) "
                "ORDER BY endpoint, filing_year, filing_period",
                statuses,
            ).fetchall()
        else:
            rows = self.db.execute(
                "SELECT * FROM partitions ORDER BY endpoint, filing_year, filing_period"
            ).fetchall()
        self.db.row_factory = None
        return rows

    def update_partition(self, endpoint: str, year: int, period: str, **fields) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(
            f"UPDATE partitions SET {cols} WHERE endpoint=? AND filing_year=? AND filing_period=?",
            (*fields.values(), endpoint, year, period),
        )
        self.db.commit()

    # -- pages ------------------------------------------------------------

    def max_committed_page(self, endpoint: str, year: int, period: str) -> int:
        row = self.db.execute(
            "SELECT COALESCE(MAX(page), 0) FROM pages WHERE endpoint=? AND filing_year=? AND filing_period=?",
            (endpoint, year, period),
        ).fetchone()
        return int(row[0])

    def committed_page_stats(self, endpoint: str, year: int, period: str) -> tuple[int, int, int]:
        """(n_pages, max_page, sum_records) for gap detection and verification."""
        row = self.db.execute(
            "SELECT COUNT(*), COALESCE(MAX(page),0), COALESCE(SUM(record_count),0) "
            "FROM pages WHERE endpoint=? AND filing_year=? AND filing_period=?",
            (endpoint, year, period),
        ).fetchone()
        return int(row[0]), int(row[1]), int(row[2])

    def part_files(self, endpoint: str, year: int, period: str) -> list[str]:
        rows = self.db.execute(
            "SELECT DISTINCT part_file FROM pages WHERE endpoint=? AND filing_year=? AND filing_period=? "
            "ORDER BY part_file",
            (endpoint, year, period),
        ).fetchall()
        return [r[0] for r in rows]

    def commit_pages(self, rows: list[tuple]) -> None:
        """rows: (endpoint, year, period, page, request_url, http_status, retrieved_at,
        record_count, part_file). One transaction — all-or-nothing."""
        with self.db:
            self.db.executemany(
                "INSERT OR REPLACE INTO pages VALUES (?,?,?,?,?,?,?,?,?)", rows
            )

    # -- fetch log ---------------------------------------------------------

    def log_retry(self, url: str, status: int, attempt: int, slept: float, note: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO fetch_log (ts, url, http_status, attempt, slept_seconds, note) "
                "VALUES (?,?,?,?,?,?)",
                (utcnow(), url, status, attempt, slept, note),
            )
