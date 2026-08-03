"""Enumerates the partitions of the full historical pull.

Filings and contributions are partitioned by (filing_year, filing_period) because those
endpoints require at least one filter to paginate. All six period values are enumerated for
filings (mid_year/year_end should be ~empty post-2008 — one request each proves it).
Entity listings are single unpartitioned pulls. Constants are fetched separately (rate-exempt).
"""

from __future__ import annotations

from datetime import date

FIRST_YEAR = 2008

QUARTER_PERIODS = ("first_quarter", "second_quarter", "third_quarter", "fourth_quarter")
SEMI_PERIODS = ("mid_year", "year_end")
ALL_PERIODS = QUARTER_PERIODS + SEMI_PERIODS

ENTITY_ENDPOINTS = ("registrants", "clients", "lobbyists")

CONSTANTS_ENDPOINTS = (
    "constants/filing/filingtypes",
    "constants/filing/lobbyingactivityissues",
    "constants/filing/governmententities",
    "constants/general/countries",
    "constants/general/states",
    "constants/lobbyist/prefixes",
    "constants/lobbyist/suffixes",
    "constants/contribution/itemtypes",
)


def plan_partitions(last_year: int | None = None) -> list[tuple[str, int, str]]:
    last_year = last_year or date.today().year
    parts: list[tuple[str, int, str]] = []
    for year in range(FIRST_YEAR, last_year + 1):
        for period in ALL_PERIODS:
            parts.append(("filings", year, period))
        for period in SEMI_PERIODS:
            parts.append(("contributions", year, period))
    for endpoint in ENTITY_ENDPOINTS:
        parts.append((endpoint, 0, "all"))
    return parts
