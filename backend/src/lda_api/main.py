from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import db
from .routers import diff, ego, filings, meta, quarter, search, timeline
from .settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Pre-warm when lifespan runs (uvicorn, tests). Serverless runtimes may skip
        # lifespan entirely — the pool then lazy-opens on first request (db.get_pool).
        db.create_pool(settings.database_url)
        await db.get_pool()
        yield
        await db.close_pool()

    app = FastAPI(title="LDA Network Visualizer API", lifespan=lifespan)
    app.state.settings = settings  # set here, not in lifespan — serverless may skip lifespan
    for router in (search.router, ego.router, timeline.router,
                   diff.router, quarter.router, meta.router, filings.router):
        app.include_router(router, prefix="/api")

    dist = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
