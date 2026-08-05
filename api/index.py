"""Vercel serverless entrypoint: exposes the FastAPI app as an ASGI function.

Vercel routes /api/* here (see vercel.json rewrites); the static frontend build is
served by Vercel's CDN, so FastAPI's local StaticFiles mount simply never engages.
The app is read-only over Postgres — the LDA API is never called at runtime.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend" / "src"))

from lda_api.main import create_app  # noqa: E402

app = create_app()
