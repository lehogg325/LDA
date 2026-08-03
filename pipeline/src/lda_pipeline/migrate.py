"""lda-db: tiny forward-only migration runner over db/migrations/*.sql."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .db import connect


def migrations_dir() -> Path:
    for candidate in (Path.cwd() / "db" / "migrations",
                      Path(__file__).resolve().parents[4] / "db" / "migrations"):
        if candidate.is_dir():
            return candidate
    raise SystemExit("db/migrations directory not found (run from the repo root)")


def migrate(database_url: str | None = None) -> list[str]:
    applied: list[str] = []
    with connect(database_url) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        done = {r[0] for r in conn.execute("SELECT filename FROM schema_migrations").fetchall()}
        for sql_file in sorted(migrations_dir().glob("*.sql")):
            if sql_file.name in done:
                continue
            conn.execute(sql_file.read_text())
            conn.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (sql_file.name,))
            applied.append(sql_file.name)
        conn.commit()
    return applied


def main() -> None:
    ap = argparse.ArgumentParser(prog="lda-db")
    sub = ap.add_subparsers(dest="cmd", required=True)
    mig = sub.add_parser("migrate")
    mig.add_argument("--database-url", default=None)
    args = ap.parse_args()

    if args.cmd == "migrate":
        applied = migrate(args.database_url)
        if applied:
            print("applied:", ", ".join(applied))
        else:
            print("schema up to date")
        sys.exit(0)
