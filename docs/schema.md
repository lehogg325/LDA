# Schema conventions

The migrations in `db/migrations/` are the source of truth; this documents the decisions
that aren't obvious from the DDL.

## Entity keys and names

API numeric IDs are node primary keys. Names are display labels only — never deduplicated,
never fuzzy-matched, nothing auto-merges (spec mandate). **Client IDs are
registration-scoped** (measured: Comcast = 31 IDs in one quarter, one per firm
relationship; see `docs/api-notes.md`). Search and the UI group client results by *exact
name string* via `entity_names` — a display-level grouping over untouched per-ID rows.

`entity_name_observations` records (node, exact name, quarter, filing-count); the
`entity_names` materialized view aggregates first/last-seen. Quarter ordinal =
`filing_year * 10 + (Q1..Q4 → 1..4, MY → 5, YE → 6)`. Canonical display name for a node =
its name with the greatest `last_seen_ord`.

## Amendment lanes

Resolution groups on `(registrant_id, client_id, filing_year, filing_period,
document_kind, is_termination)` — reports and their amendments share a lane; terminations
and termination-amendments form a separate lane that never supersedes reports;
registrations (RR/RA) likewise. Within a lane, order is `dt_posted ASC, filing_uuid ASC`
(uuid = deterministic tie-break); `superseded_by` chains each row to its immediate
successor; `is_current` marks the tail, `is_original` the head. Latest-filed wins even if
a plain report posts after an amendment. A registration amendment filed in a later year
than its RR forms a separate lane — accepted, registrations are excluded from the
quarterly series anyway.

"As-originally-filed" = `is_original` (chain head), NOT "not superseded". Both flags are
copied onto edge rows so the toggle is a WHERE clause.

## Money

`income` (firm reports what a client paid) and `expenses` (organization reports its own
lobbying spend) measure different things, double-count when combined, and are **never
summed anywhere** — not in tables, not in metrics, not in API responses. `amount` /
`amount_type` is the filing's single reportable figure. `is_reported_zero` flags reported
zeros: below-threshold amounts are commonly filed as $0, so zero is not evidence of no
lobbying. In `node_metrics`, `weighted_degree` is edge multiplicity (NOT a money sum);
money lives in `total_income` / `total_expenses`, kept separate.

## Edge orientations (spec leaves these open; chosen here, cheap to rebuild)

| edge_type | source → target | carries | notes |
|---|---|---|---|
| `represents` | registrant → client | amount, amount_type, all issue codes | one row per filing |
| `worked_on` | lobbyist → registrant AND lobbyist → client | — | two rows per (filing, lobbyist); `filing_uuid` preserves the triple; 1-hop ego = one indexed scan |
| `targeted` | client → gov_entity | issue code(s) | per (filing, activity, entity) when `attribution_level='activity'`; per (filing, entity) for legacy `'filing'` rows |

Every edge row carries `filing_uuid` (traceability / debug view), `document_kind` +
`is_termination` (so quarterly-series consumers can exclude registrations/terminations),
and both resolution flags.

## Government-entity attribution regimes

Filings *posted* before 2021-02-14 list entities for the filing as a whole; the API
duplicates that list onto every activity (verified: 0 of 7,368 multi-activity 2013
filings differ). Normalized rows keep the per-activity shape; edge building dedupes
legacy rows to filing level and stamps `attribution_level='filing'`. The UI must render
the regimes differently and never present legacy rows as activity-scoped.

## Raw-archive contract (ingest → pipeline)

The pipeline reads the ingest's SQLite manifest and gzipped part files directly (no code
dependency). Only `status='verified'` partitions are loaded. A partition's data is the
union of its main round and any `#repairN` rounds (re-pulls under reversed ordering that
recover records lost at page seams inside same-timestamp tie blocks); the loader dedupes
by record key keeping the latest `retrieved_at`. Per-partition loads are idempotent:
delete + COPY + re-resolve inside one transaction.
