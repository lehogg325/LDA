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
        pool = db.create_pool(settings.database_url)
        await pool.open()
        app.state.settings = settings
        yield
        await pool.close()

    app = FastAPI(title="LDA Network Visualizer API", lifespan=lifespan)
    for router in (search.router, ego.router, timeline.router,
                   diff.router, quarter.router, meta.router, filings.router):
        app.include_router(router, prefix="/api")

    dist = Path(__file__).resolve().parents[4] / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
