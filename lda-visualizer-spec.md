# LDA Longitudinal Network Visualizer: Build Spec

## What you are building

A web application that ingests the complete federal Lobbying Disclosure Act filing record from 2008 to the present, models it as a time-sliced multipartite network, and lets a user search any registrant, client, individual lobbyist, or lobbied government entity and watch that entity's connections change quarter by quarter.

Four node types in the initial build: registrant, client, lobbyist, government entity. Pull every field the API exposes even where the first version does not display it, so that adding node and edge types later requires no re-pull.

Note the terminology, because it drives the schema. A *registrant* is the filer: either a lobbying firm or an organization that self-files for its own in-house lobbying. A *client* is who the registrant lobbies for. A firm lobbying for itself appears as both. Individual lobbyists are listed per activity inside a filing, not as top-level filers.

---

## Before writing any code

Fetch and read `https://lda.gov/api/redoc/v1/`. Do not rely on prior knowledge of this API, and do not rely on mine.

The base URL is `https://lda.gov/api/v1/`. The old host, `lda.senate.gov`, is being decommissioned; posted shutoff dates were 2026-06-30 for the site and 2026-07-31 for the v1 documentation. Do not use `lda.senate.gov` anywhere in this codebase. Essentially every third-party wrapper, tutorial, and code sample you will find still points at the old host, including the CRAN `lobby` package. Ignore their base URLs.

Register a key at `https://lda.gov/api/register/`. Read it from the environment, never from a committed file.

Then determine, from the live docs and by probing with a small number of requests:

- The authentication header format for the API key.
- Whether `page_size` is adjustable and what its maximum is. Public listings suggest a 25-record default page, which sets the request count for a full historical pull.
- Actual rate limits for authenticated versus anonymous requests, and the shape of the 429 response.
- Which filters `filings/` accepts server-side: filing year, filing period, filing type, registrant, client, issue code, date posted.
- Whether the `filings/` list response embeds lobbying activities and lobbyist rosters, or whether those require a per-filing detail fetch against `filings/{filing_uuid}/`.

That last question is the fork that determines the size of this project. If activities are embedded in list responses, the full pull is on the order of tens of thousands of requests. If each filing needs a detail fetch, it is on the order of a million. Answer it before designing the ingest, and write your findings to `docs/api-notes.md`.

Fetch and store all of the constants endpoints: filing types, lobbying activity issues, government entities, countries, states, lobbyist prefixes. Do not hardcode issue codes or government entity names anywhere.

The API terms of service require that users cite the date data were retrieved and state that the Senate Office of Public Records cannot vouch for data or analyses derived after retrieval. Record retrieval timestamps per partition and surface that disclaimer in the application footer.

---

## Architecture: four layers, built and verified in that order

Do not build this as one program. The governing rule: the API gets pulled exactly once. Every schema mistake is fixed by re-transforming the raw archive, never by re-pulling. A full re-pull is a multi-day operation and you will make schema mistakes.

### Layer 1: Raw archive, append-only

Write raw JSON responses verbatim to gzipped JSONL, partitioned by year and period, for example `raw/filings/year=2019/period=Q2/part-0001.jsonl.gz`. Store the request URL, retrieval timestamp, and HTTP status alongside each page.

Maintain a manifest in SQLite recording every `(endpoint, year, period, page)` fetched with its status. The ingest resumes from the manifest. It must survive being killed at any point and restarted without duplicating or skipping work.

Verify completeness against the `count` field the API returns for each query. Log any partition where records retrieved does not equal the reported count, and fail loudly rather than silently proceeding.

Rate limit with a token bucket sized to whatever the docs actually permit. Exponential backoff with jitter on 429 and 5xx. Log every retry.

### Layer 2: Normalized relational tables

Postgres. Tables for filings, registrants, clients, lobbyists, filing_lobbyists, filing_activities, activity_government_entities, activity_lobbyists, and contributions (LD-203).

Two transform rules matter more than the rest of the schema, because getting either wrong corrupts the longitudinal series in ways that look plausible.

**Amendment resolution.** Filings get amended, and the API returns both the original and the amendment. Group on registrant, client, filing year, filing period, and document type, then mark the latest-filed record as current. Retain superseded rows with an `is_superseded` flag and a pointer to the row that superseded them; never delete them. Expose a toggle in the application for as-originally-filed versus as-currently-amended, since those are genuinely different histories and a researcher may want either. Registrations (LD-1) and terminations are separate document types and must not be folded into the quarterly activity series.

**Entity keys.** Use the API's numeric registrant, client, and lobbyist IDs as node primary keys. Names are display labels only. Store them in a separate names table with first-seen and last-seen quarters so alias history is queryable. Do not deduplicate on name, and do not fuzzy-match in this build. The same firm appears under many spellings across eighteen years, and if you key on names the network will appear to fragment and reassemble over time as an artifact of data entry. Later you can add a candidate-match table for human review, but nothing auto-merges.

On money: LD-2 separates income received by lobbying firms from expenses incurred by organizations lobbying on their own behalf. Confirm the exact field names against the docs, but do not sum the two into a single spending figure, because they measure different things and double-count when a self-filer also retains outside firms. Amounts below the statutory reporting threshold are commonly reported as zero or as a below-threshold indicator, so a zero is not evidence that no lobbying happened. Store the raw amount, its type, and a flag for reported-zero.

### Layer 3: Derived edge and metric tables

One row per relationship per quarter:

```
edges(
  edge_type, source_type, source_id, target_type, target_id,
  filing_year, filing_period, filing_uuid,
  amount, amount_type, issue_codes[], is_superseded
)
```

Edge types for this build: registrant-represents-client, drawn from the filing and carrying the money; lobbyist-worked-filing, projectable onto both registrant and client; and activity-targeted-entity, connecting a filing's lobbying activity to each government entity contacted. Client-to-client issue co-occurrence is a projection to compute on demand, not to store.

Index on `(filing_year, filing_period)` and on each type-and-id pair. A quarter slice then becomes one indexed predicate, and quarter-over-quarter comparison becomes set operations on this table: edges added, edges dropped, edges persisting with an amount delta.

Precompute per-quarter node metrics into a `node_metrics` table: degree, weighted degree, community assignment, and betweenness if it proves tractable at this scale. Centrality does not get computed in the browser or per request.

### Layer 4: Serving API and React frontend

Backend in FastAPI over Postgres. Endpoints:

- `/search?q=` typeahead across all four node types, returning type, id, canonical name, and the quarters in which the node appears.
- `/ego/{node_type}/{id}?year=&period=&hops=` returning the induced subgraph for one quarter.
- `/timeline/{node_type}/{id}` returning per-quarter metrics for sparklines.
- `/diff?from_year=&from_period=&to_year=&to_period=&...` returning added, dropped, and changed edges.
- `/quarter/{year}/{period}/top?metric=` for a landing view.

The hard frontend constraint: measure the real node and edge counts in step 1, but expect a full graph far too large to send to a browser. Never ship it. Every view is either an ego network around a search anchor or an aggregated subgraph, capped server-side at a few thousand nodes, with an explicit truncation signal when the cap binds.

Render with sigma.js v3 backed by graphology. Graphology supplies the graph data structure and algorithms; sigma renders through WebGL and holds up into the tens of thousands of nodes. Cytoscape.js is the alternative if you want richer interaction APIs, but it renders to canvas and degrades past roughly ten thousand elements. Do not use a D3 force simulation above about two thousand nodes.

Longitudinal interaction, in priority order:

A quarter slider from 2008 Q1 to the most recent filed quarter is the primary control. Moving it refetches the ego network for that quarter.

Pin layout positions across quarters. Compute one layout over the union graph across the visible window, then hold coordinates fixed and vary only which nodes and edges are drawn and how they are weighted. Running force layout independently per quarter scrambles the picture on every step and destroys the only signal the user came for. This is the most common way time-sliced network visualizers fail.

Style nodes and edges by temporal status: new this quarter, persisting from last quarter, dropped since last quarter. A timeline strip below the graph shows the anchor entity's degree and reported amounts by quarter and is clickable to jump.

---

## Build order, with a checkpoint after each step

Stop and report after each. Do not run ahead.

1. API reconnaissance. Produce `docs/api-notes.md` and a cost estimate for the full pull: request count, wall-clock time, disk footprint.
2. Ingest one quarter end to end into the raw archive, with the manifest working and completeness verified against `count`.
3. Start the full historical ingest as a background process. Report progress; do not block later steps on it finishing.
4. Normalizer over whatever partitions exist, amendment resolution included, with a test asserting that a known amended filing resolves to the right current row.
5. Edge and metric tables for a five-year window. Report row counts and check a relationship you can confirm by hand against the public filing search at `lda.gov`.
6. Backend endpoints with fixture-based tests.
7. Frontend: search plus a static single-quarter ego network. No slider yet.
8. Slider, pinned layout, temporal styling, timeline strip.

---

## Verification

Choose three or four relationships verifiable by hand through `lda.gov`'s public filing search and assert them as integration tests. Every aggregate the application displays must be traceable back to specific filing UUIDs, and a debug view should show the underlying filings behind any edge. Label every displayed dollar figure with whether it is reported income or reported expense.

---

## Do not

- Use `lda.senate.gov`.
- Call the LDA API to satisfy a page request at runtime.
- Deduplicate entities by name.
- Sum income and expense figures into one number.
- Read a reported zero as absence of lobbying.
- Recompute graph layout independently per quarter.
- Build the frontend before the edge tables are verified against hand-checked filings.
- Combine the ingest and the transform into one script.
