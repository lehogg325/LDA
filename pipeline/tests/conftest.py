from __future__ import annotations

import os

import psycopg
import pytest

from lda_pipeline.db import env
from lda_pipeline.migrate import migrate


def _test_url() -> str | None:
    return env().get("DATABASE_URL_TEST")


@pytest.fixture(scope="session")
def pg_url() -> str:
    url = _test_url()
    if not url:
        pytest.skip("DATABASE_URL_TEST not configured")
    return url


@pytest.fixture()
def pg(pg_url: str):
    """Fresh schema per test: drop + migrate + minimal reference rows."""
    with psycopg.connect(pg_url) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        conn.commit()
    migrate(pg_url)
    with psycopg.connect(pg_url) as conn:
        conn.execute("""
            INSERT INTO ref_filing_types VALUES
              ('RR', 'Registration',                'registration', false, false, false),
              ('Q1', '1st Quarter - Report',        'quarterly',    false, false, false),
              ('1A', '1st Quarter - Amendment',     'quarterly',    false, true,  false),
              ('1T', '1st Quarter - Termination',   'quarterly',    true,  false, false),
              ('Q2', '2nd Quarter - Report',        'quarterly',    false, false, false),
              ('2A', '2nd Quarter - Amendment',     'quarterly',    false, true,  false)
        """)
        conn.execute("INSERT INTO registrants (id, display_name) VALUES (1, 'FIRM A'), (2, 'FIRM B')")
        conn.execute("INSERT INTO clients (id, display_name) VALUES (10, 'CLIENT X'), (11, 'CLIENT Y')")
        conn.commit()
        yield conn


@pytest.fixture(scope="session")
def realdb():
    """Production DB with normalized data loaded; realdb tests skip when absent."""
    url = env().get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not configured")
    with psycopg.connect(url) as conn:
        try:
            n = conn.execute("SELECT count(*) FROM filings").fetchone()[0]
        except psycopg.errors.UndefinedTable:
            pytest.skip("filings table not present")
        if n == 0:
            pytest.skip("no normalized filings loaded yet")
        yield conn
