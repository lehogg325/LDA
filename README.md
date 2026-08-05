# LDA Longitudinal Network Visualizer

Ingests the complete federal Lobbying Disclosure Act filing record (2008–present) from the
official `lda.gov` API, models it as a time-sliced multipartite network (registrants, clients,
lobbyists, government entities), and serves a React + sigma.js frontend where any entity's
network can be scrubbed quarter by quarter.

Spec: [lda-visualizer-spec.md](lda-visualizer-spec.md). API findings: [docs/api-notes.md](docs/api-notes.md).

## Architecture (four layers, strictly ordered)

1. **`ingest/`** (`lda-ingest`) — append-only raw archive: gzipped JSONL pages under `data/raw/`,
   SQLite manifest, kill-safe resume, completeness verified against API counts.
   The API is pulled exactly once; every downstream mistake is fixed by re-transforming this archive.
2. **`pipeline/`** (`lda-db`, `lda-normalize`) — normalized Postgres tables, amendment resolution,
   entity/alias tables keyed on API numeric IDs (names are labels only — never deduplicated).
3. **`pipeline/`** (`lda-edges`, `lda-metrics`) — per-quarter edge table + precomputed node metrics.
4. **`backend/`** (FastAPI) + **`frontend/`** (Vite/React/TS + sigma.js v3) — search, ego networks,
   quarter slider with pinned layout, temporal styling, timeline strip.

## Setup

```sh
brew install uv && brew install --cask orbstack   # once
cp .env.example .env                              # then paste your LDA API key into .env
docker compose up -d                              # postgres:17 on localhost:5433
uv sync
uv run lda-db migrate
```

Get an API key at <https://lda.gov/api/register/>. Without one the ingest runs at the
anonymous rate (15 req/min instead of 120) and the full pull takes ~3 days instead of ~12 hours.

## Deployment

Vercel-ready: static frontend + `api/index.py` serverless function (see
[docs/deploy.md](docs/deploy.md)). Requires a hosted Postgres (~12 GB loaded); the
ingest/pipeline stay local and the deployed app is read-only over the database.

## Data & terms

Raw archive and manifest live under `data/` (gitignored, ~1 GB gzipped / ~5 GB raw JSON).
Per the API terms of service, the application cites the retrieval date of the data and notes that
the Senate Office of Public Records cannot vouch for data or analyses derived after retrieval.
