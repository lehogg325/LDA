# LDA API Notes — reconnaissance findings

All findings verified live against `https://lda.gov/api/v1/` and its OpenAPI 3.0.2 spec
(`https://lda.gov/api/openapi/v1/`) on **2026-08-02/03**. Nothing here is taken from third-party
wrappers or prior knowledge. The old host `lda.senate.gov` is sunset (2026-07-31) and must not
appear anywhere in this codebase; note that the OpenAPI document itself still contains
`lda.senate.gov` example URLs — ignore them, the same paths work on `lda.gov`.

## Endpoints

| Endpoint | Notes |
|---|---|
| `filings/` | LD-1/LD-2. List response embeds **everything** (see below) |
| `filings/{filing_uuid}/` | Exists, but unnecessary for the bulk pull |
| `contributions/` | LD-203 contribution reports, same pagination rules as filings |
| `registrants/`, `clients/`, `lobbyists/` | Entity listings (+ `{id}/` detail); extra fields beyond what filings embed |
| `constants/filing/filingtypes/` · `constants/filing/lobbyingactivityissues/` · `constants/filing/governmententities/` · `constants/general/countries/` · `constants/general/states/` · `constants/lobbyist/prefixes/` · `constants/lobbyist/suffixes/` · `constants/contribution/itemtypes/` | Reference data; **exempt from rate limits**; fetched and stored, never hardcoded |

## Authentication and rate limits

- Header: `Authorization: Token <key>` (literal `Token` prefix + space).
- Registered: **120 requests/minute**. Anonymous: **15/minute** (per originating IP).
  All keys of one user share one quota.
- 429 response: JSON `{"detail": "Request was throttled. Expected available in N seconds."}` with a
  `Retry-After` header in seconds. The docs' own example shows `Retry-After: 1596`, which implies a
  secondary (hourly-scale) quota beyond the per-minute rate — the rate limiter must sleep arbitrary
  durations without treating them as errors.
- Invalid key → 401 `{"detail": "Invalid token."}`.

## Pagination

- `page_size` maximum is **25** (also the default). Requesting `page_size=100` silently returns 25
  (verified live). This fixes the request count for any pull.
- `filings/` and `contributions/` **require at least one query filter to paginate** beyond page 1
  (400 otherwise). Recommended pattern per the docs: filter by `filing_year`.
- Response shape: `{count, next, previous, results[]}`.
- Passing invalid parameter values yields 400/404 with a JSON detail message.

## The fork: list responses embed everything (cheap side)

`filings/` **list** results are complete `Filing` objects: `filing_uuid`, `filing_type(+_display)`,
`filing_year`, `filing_period(+_display)`, `income`, `expenses`, `expenses_method`, `dt_posted`,
`termination_date`, `filing_document_url`, registrant address fields, nested
`registrant{id, name, …}`, `client{id, name, state, country, …}`, and
`lobbying_activities[]` — each with `general_issue_code(+_display)`, `description`,
`government_entities[]`, and `lobbyists[]` (with `covered_position` etc.) — plus
`foreign_entities`, `affiliated_organizations`, `conviction_disclosures`.

**No per-filing detail fetch is needed.** The full pull is ~100K requests, not ~1.6M.

## Measured volumes (retrieved 2026-08-03, anonymous probes)

Filings by `filing_year`:

| Year | Count | | Year | Count |
|---|---|---|---|---|
| 2008 | 94,010 | | 2018 | 78,417 |
| 2009 | 95,600 | | 2019 | 80,047 |
| 2010 | 90,786 | | 2020 | 84,097 |
| 2011 | 84,349 | | 2021 | 90,778 |
| 2012 | 77,892 | | 2022 | 93,513 |
| 2013 | 75,822 | | 2023 | 95,305 |
| 2014 | 74,385 | | 2024 | 96,929 |
| 2015 | 73,908 | | 2025 | 108,914 |
| 2016 | 72,192 | | 2026 (partial) | 54,447 |
| 2017 | 77,223 | | **Total** | **1,598,614** |

Other volumes: contributions 2019 → 35,380; 2025 → 40,375 (≈665K records estimated 2008–2026).
Entity listings: registrants 17,436 · clients 136,082 · lobbyists 88,719.
Partition probe: 2013 `second_quarter` → 19,085 filings (764 pages).

## Full-pull cost estimate

| Component | Records | Pages (25/page) |
|---|---|---|
| filings (19 years × 6 periods) | 1,598,614 | ~64,000 |
| contributions (19 years × 2 periods) | ~665,000 (est.) | ~26,600 |
| registrants + clients + lobbyists | 242,237 | ~9,700 |
| constants | — | 8 (rate-exempt) |
| **Total** | ~2.5M | **~100,300** |

- **Wall-clock, keyed (120/min)**: sequential fetching is latency-bound at roughly 75–110 req/min →
  **~15–22 hours**. Anonymous (15/min): ~4.7 days.
- **Disk**: one filings page ≈ 80 KB JSON → ~5.5 GB raw filings + ~2 GB other endpoints
  uncompressed; **≈ 1–1.5 GB gzipped** on disk.
- The manifest makes multi-session pulls harmless; if a secondary quota throttles the run it simply
  takes longer.

## Ordering / count-drift strategy

- `ordering=dt_posted` is accepted on `filings/` and returns ascending `dt_posted` (verified on
  2013 Q2 page 1). Amendments to old filings post *today* under their historical `filing_year`, so
  partition counts can grow mid-pull; with ascending `dt_posted` new rows sort to the tail and
  already-fetched pages don't shift. Procedure: record count at partition start, paginate to the
  end, re-read count, fetch tail pages until stable. The normalizer additionally dedupes by
  `filing_uuid` (latest retrieval wins), so residual reshuffles cost only harmless duplicates —
  a *missing* uuid is the only fatal condition, and completeness verification catches it.
- Page-1 ascending order still needs a full-partition stability check during step 2 (ties, cross-page).

## Data caveats that shape the schema

1. **Government-entity attribution regime change.** Filings *posted* before **2021-02-14** list
   government entities for the filing as a whole (legacy import); only later postings break them
   down per lobbying activity. Every entity edge carries `attribution_level ∈ {activity, filing}`
   and the UI must not present filing-level rows as activity-scoped.
2. **Client/lobbyist ID scope — open until step 2.** 136K distinct client IDs may be per
   registrant-client *registration* rather than per real-world client (one company lobbied by 40
   firms could be 40 IDs). Step 2 measures distinct `client.id` per exact name string in one
   partition and reports here. Either way, API IDs stay the node keys (spec: no name dedup).
3. **`filing_period` enum** is `first_quarter…fourth_quarter, mid_year, year_end`. Semiannual
   periods (`mid_year`, `year_end`) belong to pre-2008-style filings and LD-203 contributions but
   are enumerated for filings partitions too, so nothing hides.
4. **Money fields**: `income` (firm lobbying for a client) and `expenses` (organization self-filing)
   are separate fields with `expenses_method`; they measure different things and are never summed.
   Zero/None amounts commonly mean below-threshold, not "no lobbying".
5. **Advanced text search** exists on `filing_specific_lobbying_issues`,
   `lobbyist_conviction_disclosure`, `lobbyist_covered_position` (quoted phrases, OR, `-` negation)
   — not needed for the pull, useful for future features.

## Filter parameters on `filings/` (server-side)

`filing_uuid`, `registrant_id`, `registrant_name`, `registrant_country`, `registrant_ppb_country`,
`client_id`, `client_name`, `client_state`, `client_country`, `client_ppb_state`,
`client_ppb_country`, `lobbyist_id`, `lobbyist_name`, `lobbyist_covered_position(+_indicator)`,
`lobbyist_conviction_disclosure(+_indicator)`, `lobbyist_conviction_date_range_after/before`,
`filing_type`, `filing_year`, `filing_period`, `filing_dt_posted_after/before`,
`filing_amount_reported_min/max`, `filing_specific_lobbying_issues`,
`affiliated_organization_*`, `foreign_entity_*`, `ordering`.

Note: there is **no** issue-code filter on `filings/` — issue-based queries happen against our own
tables, another reason the full pull is required.

`filing_type` enum: `RR, RA` (registration/amendment), and per quarter `n ∈ 1..4`:
`Qn` (report), `QnY` (no-activity variant), `nA, nAY` (amendments), `nT, nTY` (terminations),
`n@, n@Y` (termination amendments). Exact display names come from `constants/filing/filingtypes/`;
the normalizer classifies from that constants list and fails loudly on unknown codes.

## Terms of service

Users must cite the date data were retrieved and state that the Senate Office of Public Records
cannot vouch for data or analyses derived after retrieval. Implementation: retrieval timestamps are
recorded per page in the archive envelope and per partition in the manifest, propagated to Postgres
(`load_state`), and surfaced with the disclaimer in the application footer via `/api/meta`.
