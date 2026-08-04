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

## Step-5 pins (verified 2026-08-04 against official print documents) — `pipeline/tests/test_handchecks.py`

**1. National Association of Realtors** (registrant 27070, self-filer → `expenses`):
2023 quarterly expenses $13,320,000 / $10,080,000 / $10,360,000 / $18,360,000
(FY total $52.12M, consistent with public reporting). Q4 amount confirmed verbatim in
`https://lda.gov/filings/public/filing/39b697e9-f1c9-49e7-8b6a-0b0e5ae4f5bb/print/`.

**2. Chamber of Commerce of the U.S.A.** (registrant 38756, self-filer → `expenses`):
2023 quarterly expenses $18,660,000 / $16,390,000 / $13,590,000 / $19,080,000
(FY total $67.72M). Q1 amount confirmed verbatim in
`https://lda.gov/filings/public/filing/5198725f-3d13-4ad9-b14d-f796a3a2e856/print/`.

**3. Akin Gump Strauss Hauer & Feld → City of Houston** (client 100481 → `income`):
the same represents-edge appears in **73 consecutive quarters (2008 Q1 – 2026 Q1)** at
$50,000/quarter income in 2023. Q4 2023 confirmed verbatim (firm name, client name,
amount) in `https://lda.gov/filings/public/filing/5f1f3b80-d8d2-4cea-bf3c-678b1acfd83a/print/`.

These also demonstrate the two money regimes staying disjoint: the self-filers report
only `expenses`, the firm/client pair only `income`, and no view combines them.
