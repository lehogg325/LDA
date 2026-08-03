# Pinned verification facts

Hand-verifiable assertions, each backed by an automated test. Verify manually via the
public filing search at `https://lda.gov/filings/public/` (search by registrant/client,
open the filing, compare the print view).

## Amendment resolution (step 4) — `pipeline/tests/test_amendments.py::test_known_amended_filing_resolves_correctly`

**THE ADVOCACY GROUP → CIGAR ASSOCIATION OF AMERICA, INC., 2013 second quarter** (LD-2).
Three filings form the lane, resolved as a chain:

| filing_uuid | type | dt_posted | resolution |
|---|---|---|---|
| `11a07448-5491-41a4-a7ee-25e4929c99bb` | Q2 | 2013-07-22 | original, superseded |
| `28a344fe-740e-49ab-a350-86fd7734a49a` | 2A | 2013-07-22 (later) | superseded |
| `bdc2d247-468f-4610-9a42-7e6dee80fb71` | 2A | **2015-07-20** | **current** |

The two-year-late amendment is why partition counts drift during the pull, and why the
as-filed / as-amended toggle is a real distinction (registrant_id 261, client_id 100366).

Print view URL pattern: `https://lda.gov/filings/public/filing/{filing_uuid}/print/`.

## Global invariants (asserted on every normalized quarter)

- Every amendment lane (registrant, client, year, period, kind, termination-flag) has
  exactly one `is_current` and exactly one `is_original` row —
  `test_every_lane_has_exactly_one_current_and_original`.
- `amount` always equals the filing's own `income` or `expenses` figure, matching
  `amount_type`; the two measures are never combined —
  `test_income_and_expenses_never_combined`.
- Raw-archive completeness: per partition, distinct filing UUIDs across all pull rounds
  ≥ the API's reported count (ingest `verify`, fails loudly otherwise).

## Step-5 pins (to be added when edges are built)

Planned: National Association of Realtors self-filer quarterly expenses (2023),
U.S. Chamber of Commerce expenses, and a long-running firm/client represents-edge
with income figures matched to the public search.
