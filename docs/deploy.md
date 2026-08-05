# Deploying to Vercel

The app splits cleanly for Vercel: the **frontend** builds to static files served by the
CDN, and the **FastAPI backend** runs as a Python serverless function (`api/index.py`,
routed via the rewrites in `vercel.json`). The **database does not live on Vercel** —
you need a hosted Postgres, and the **ingest/pipeline never deploy at all**: they run
locally against the raw archive, and the deployed app is strictly read-only over
Postgres (the LDA API is never called at runtime, per the project spec).

## 1. Host the database

The loaded database is **~12 GB** (1.57M filings, 13.9M edge rows, 2.5M metric rows), so
free tiers won't fit. Any hosted Postgres ≥ 16 works: Neon (Scale), Supabase (Pro),
Railway, AWS RDS, etc. Prefer a provider/region close to Vercel's function region, and
use the provider's **pooled connection string** if offered (serverless functions each
open their own small pool).

Load it from the local Docker instance:

```sh
# dump (custom format, compressed) — ~2-4 GB file
docker exec lda-postgres pg_dump -U lda -d lda -Fc -Z6 -f /tmp/lda.dump
docker cp lda-postgres:/tmp/lda.dump ./lda.dump

# restore to the hosted instance
pg_restore -d "$REMOTE_DATABASE_URL" --no-owner --no-privileges -j 4 ./lda.dump
```

`pg_trgm` must be available (it is on all providers above; the migration created the
extension, which the dump recreates).

## 2. Deploy on Vercel

1. Import `github.com/lehogg325/LDA` in Vercel (or `npx vercel` from the repo root).
   `vercel.json` supplies the build command, output directory, function config, and
   routing — no framework preset needed.
2. Set environment variables (Project → Settings → Environment Variables):

   | Var | Value |
   |---|---|
   | `DATABASE_URL` | `postgresql://…?sslmode=require` (the hosted/pooled string) |
   | `PGPOOL_MIN` | `0` |
   | `PGPOOL_MAX` | `4` |

3. Deploy. `/` serves the app; `/api/*` hits the function; `/api/meta` is a quick
   health check (it also carries the ToS retrieval-date citation the footer displays).

## Troubleshooting

- **Check `/api/meta` first.** A JSON response means the function and database wiring
  work. `"search_ready": false` means the restore is missing the `pg_trgm` extension or
  the `entity_names` materialized view is empty — run on the hosted DB:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  REFRESH MATERIALIZED VIEW entity_names;
  ```
- **`/api/meta` errors or times out**: verify `DATABASE_URL` in Vercel env (must include
  `?sslmode=require` for most providers) and that the DB accepts connections from
  anywhere (serverless egress IPs vary). The pool opens lazily on first request —
  no ASGI lifespan support is required of the runtime.
- **Search returns 500 while other endpoints work**: almost always missing `pg_trgm`
  (the `%` similarity operator) — see the SQL above.

## Updating data later

Data updates happen locally (`lda-ingest run --all` → `lda-normalize --all-verified
--entities` → `lda-edges --all` → `lda-metrics --all`), then re-dump/restore. The
manifest makes incremental pulls cheap; only changed partitions reload.

## Local production preview

```sh
cd frontend && npm run build && cd ..
uv run uvicorn lda_api.main:app --port 8000   # serves frontend/dist + /api
```
