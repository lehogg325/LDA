from __future__ import annotations

import httpx
import psycopg
import pytest

from lda_api import db as apidb
from lda_api.main import create_app
from lda_api.settings import Settings
from lda_pipeline.db import env
from lda_pipeline.migrate import migrate

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from miniworld import build_miniworld  # noqa: E402


@pytest.fixture(scope="session")
def pg_url() -> str:
    url = env().get("DATABASE_URL_TEST")
    if not url:
        pytest.skip("DATABASE_URL_TEST not configured")
    return url


@pytest.fixture(scope="session")
def miniworld_db(pg_url: str) -> str:
    with psycopg.connect(pg_url) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        conn.commit()
    migrate(pg_url)
    build_miniworld(pg_url)
    return pg_url


@pytest.fixture()
async def client(miniworld_db: str):
    async with _client_for(Settings(database_url=miniworld_db)) as c:
        yield c


@pytest.fixture()
async def tiny_cap_client(miniworld_db: str):
    """App with caps small enough that the miniworld triggers truncation."""
    async with _client_for(Settings(database_url=miniworld_db,
                                    node_cap=3, neighbor_cap=2)) as c:
        yield c


class _client_for:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def __aenter__(self) -> httpx.AsyncClient:
        app = create_app(self.settings)
        self.pool = apidb.create_pool(self.settings.database_url)
        await self.pool.open()
        app.state.settings = self.settings
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                        base_url="http://test")
        return self.client

    async def __aexit__(self, *exc):
        await self.client.aclose()
        await self.pool.close()
