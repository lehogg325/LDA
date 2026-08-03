from __future__ import annotations

from psycopg_pool import AsyncConnectionPool

# The backend deliberately has no HTTP-client dependency: every byte it serves comes
# from Postgres. Runtime calls to the LDA API are structurally impossible.

_pool: AsyncConnectionPool | None = None


def create_pool(database_url: str) -> AsyncConnectionPool:
    global _pool
    _pool = AsyncConnectionPool(database_url, min_size=1, max_size=8, open=False)
    return _pool


def pool() -> AsyncConnectionPool:
    assert _pool is not None, "pool not initialized (app lifespan not started)"
    return _pool
