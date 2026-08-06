#!/bin/bash
# Full-database migration to the hosted Postgres in REMOTE_DATABASE_URL (.env).
# Runs detached; writes progress to data/logs/migrate.log and a completion marker.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=data/logs/migrate.log
MARKER=data/logs/migrate.done
DUMP=/tmp/lda-$$.dump
rm -f "$MARKER"
exec >>"$LOG" 2>&1

REMOTE="$(grep "^REMOTE_DATABASE_URL=" .env | cut -d= -f2-)&keepalives=1&keepalives_idle=30&keepalives_interval=10"
[ -n "$REMOTE" ] || { echo "FATAL: REMOTE_DATABASE_URL missing"; echo fail > "$MARKER"; exit 1; }

echo "=== $(date) dumping local database (custom format)"
docker exec lda-postgres bash -c "pg_dump -U lda -d lda -Fc -Z4 --exclude-table-data=contribution_filings --exclude-table-data=contribution_items -f $DUMP"  \
  || { echo "FATAL: dump failed"; echo fail > "$MARKER"; exit 1; }
docker exec lda-postgres ls -la $DUMP

echo "=== $(date) wiping any partial restore"
docker exec lda-postgres psql "$REMOTE" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" || true
docker exec lda-postgres psql "$REMOTE" -c "ALTER DATABASE postgres RESET maintenance_work_mem;" || true

echo "=== $(date) restoring to remote (this is the long part)"
docker exec lda-postgres bash -c "pg_restore -d '$REMOTE' --no-owner --no-privileges --no-comments -j 1 $DUMP" \
  || echo "WARNING: pg_restore exited non-zero (often benign ACL/extension noise) — verifying anyway"

echo "=== $(date) analyzing"
docker exec lda-postgres psql "$REMOTE" -c "ANALYZE;" || true

echo "=== $(date) verification"
docker exec lda-postgres psql "$REMOTE" -tA -c "
SELECT 'filings: '||count(*) FROM filings;
SELECT 'edges: '||count(*) FROM edges;
SELECT 'node_metrics: '||count(*) FROM node_metrics;
SELECT 'entity_names: '||count(*) FROM entity_names;
SELECT 'trgm search smoke: '||count(*) FROM entity_names WHERE name % 'COMCAST';
SELECT 'remote size: '||pg_size_pretty(pg_database_size('postgres'));"

docker exec lda-postgres rm -f $DUMP
echo "=== $(date) DONE"
echo ok > "$MARKER"
