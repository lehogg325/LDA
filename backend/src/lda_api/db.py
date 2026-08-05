from __future__ import annotations

import os

from psycopg_pool import AsyncConnectionPool

# The backend deliberately has no HTTP-client dependency: every byte it serves comes
# from Postgres. Runtime calls to the LDA API are structurally impossible.
#
# The pool is LAZY: serverless runtimes (Vercel) don't reliably run ASGI lifespan, so
# the first request creates and opens it. The lifespan path still pre-warms it when it
# does run (local uvicorn, tests).

_pool: AsyncConnectionPool | None = None
_opened = False


def create_pool(database_url: str) -> AsyncConnectionPool:
    # Serverless deployments (one pool per warm function instance) should set
    # PGPOOL_MIN=0 / PGPOOL_MAX=4 or so; the defaults suit a long-lived server.
    global _pool, _opened
    _pool = AsyncConnectionPool(
        database_url,
        min_size=int(os.environ.get("PGPOOL_MIN", "1")),
        max_size=int(os.environ.get("PGPOOL_MAX", "8")),
        # Fail fast and loud when the database is unreachable (a misconfigured
        # DATABASE_URL in serverless otherwise reads as a 30s hang).
        timeout=8,
        kwargs={"connect_timeout": 5},
        open=False,
    )
    _opened = False
    return _pool


async def get_pool() -> AsyncConnectionPool:
    global _pool, _opened
    if _pool is None:
        from .settings import Settings

        create_pool(Settings().database_url)
    if not _opened:
        await _pool.open()  # type: ignore[union-attr]
        _opened = True
    return _pool  # type: ignore[return-value]


async def close_pool() -> None:
    global _pool, _opened
    if _pool is not None and _opened:
        await _pool.close()
    _pool = None
    _opened = False
