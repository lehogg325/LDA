from __future__ import annotations

import os

from psycopg_pool import AsyncConnectionPool

# The backend deliberately has no HTTP-client dependency: every byte it serves comes
# from Postgres. Runtime calls to the LDA API are structurally impossible.

_pool: AsyncConnectionPool | None = None


def create_pool(database_url: str) -> AsyncConnectionPool:
    # Serverless deployments (one pool per warm function instance) should set
    # PGPOOL_MIN=0 / PGPOOL_MAX=4 or so; the defaults suit a long-lived server.
    global _pool
    _pool = AsyncConnectionPool(
        database_url,
        min_size=int(os.environ.get("PGPOOL_MIN", "1")),
        max_size=int(os.environ.get("PGPOOL_MAX", "8")),
        open=False,
    )
    return _pool


def pool() -> AsyncConnectionPool:
    assert _pool is not None, "pool not initialized (app lifespan not started)"
    return _pool
