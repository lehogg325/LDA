"""Pure transform: one raw filing JSON record -> typed row bundles.

No database access here; everything is deterministic and unit-testable. Money rule:
income and expenses are different measures and are never combined — `amount` is whichever
single figure the filing reports, labeled by `amount_type`. A reported zero is flagged,
never interpreted as absence of lobbying.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal

PERIOD_ORD = {"first_quarter": 1, "second_quarter": 2, "third_quarter": 3,
              "fourth_quarter": 4, "mid_year": 5, "year_end": 6}

# Filings *posted* before this date report government entities at whole-filing level
# (the per-activity arrays hold one duplicated list). ISO string comparison is safe here.
ACTIVITY_ATTRIBUTION_SINCE = "2021-02-14"


class UnknownFilingType(Exception):
    pass


@dataclass
class Bundle:
    """Accumulated rows for one partition."""
    registrants: dict = field(default_factory=dict)
    clients: dict = field(default_factory=dict)
    lobbyists: dict = field(default_factory=dict)
    gov_entities: dict = field(default_factory=dict)
    issue_codes: dict = field(default_factory=dict)
    filings: list = field(default_factory=list)
    activities: list = field(default_factory=list)
    activity_lobbyists: list = field(default_factory=list)
    activity_entities: list = field(default_factory=list)
    filing_lobbyists: set = field(default_factory=set)
    # (node_type, node_id, name) -> n_filings, all at this partition's period_ord
    name_obs: dict = field(default_factory=dict)


def _dec(value) -> Decimal | None:
    return None if value in (None, "") else Decimal(str(value))


def _int_or_none(value):
    """Incidental reference numbers (house_registrant_id, per-registrant client numbers)
    contain stray strings in legacy data (observed: "New"). Core node IDs are NOT run
    through this — a dirty node ID must fail loudly, not be silently dropped."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _lobbyist_display(lob: dict) -> str:
    return " ".join(p for p in (lob.get("first_name"), lob.get("middle_name"),
                                lob.get("last_name")) if p).strip().upper()


def add_filing(bundle: Bundle, f: dict, retrieved_at: str, request_url: str,
               type_map: dict[str, tuple[str, bool, bool, bool]]) -> None:
    code = f["filing_type"]
    if code not in type_map:
        raise UnknownFilingType(f"filing {f['filing_uuid']} has unknown filing_type {code!r}")
    kind, is_term, is_amend, is_noact = type_map[code]

    year, period = f["filing_year"], f["filing_period"]
    period_ord = year * 10 + PERIOD_ORD[period]
    uuid = f["filing_uuid"]

    reg, cli = f["registrant"], f["client"]
    income, expenses = _dec(f.get("income")), _dec(f.get("expenses"))
    amount = income if income is not None else expenses
    amount_type = ("income" if income is not None
                   else "expenses" if expenses is not None else None)

    bundle.registrants[reg["id"]] = (
        reg["id"], reg.get("name"), _int_or_none(reg.get("house_registrant_id")), reg.get("city"),
        reg.get("state"), reg.get("country"), reg.get("ppb_country"),
        reg.get("contact_name"), reg.get("dt_updated"),
    )
    bundle.clients[cli["id"]] = (
        cli["id"], cli.get("name"), _int_or_none(cli.get("client_id")), cli.get("client_government_entity"),
        cli.get("state"), cli.get("country"), cli.get("ppb_state"), cli.get("ppb_country"),
        cli.get("effective_date"),
    )

    dt_posted = f["dt_posted"]
    attribution = "activity" if dt_posted >= ACTIVITY_ATTRIBUTION_SINCE else "filing"

    registrant_address = {k: f.get(k) for k in (
        "registrant_address_1", "registrant_address_2", "registrant_city",
        "registrant_state", "registrant_zip", "registrant_country",
        "registrant_ppb_country", "registrant_different_address")}

    bundle.filings.append((
        uuid, code, kind, is_term, is_amend, is_noact,
        year, period, period_ord,
        reg["id"], cli["id"],
        income, expenses, f.get("expenses_method"),
        amount, amount_type, amount is not None and amount == 0,
        dt_posted, f.get("termination_date"), attribution,
        f.get("posted_by_name"), f.get("filing_document_url"),
        json.dumps(registrant_address),
        json.dumps(f.get("foreign_entities") or []),
        json.dumps(f.get("affiliated_organizations") or []),
        json.dumps(f.get("conviction_disclosures") or []),
        retrieved_at, request_url,
    ))

    def observe(node_type: str, node_id: int, name: str | None) -> None:
        if name:
            key = (node_type, node_id, name.strip().upper())
            bundle.name_obs[key] = bundle.name_obs.get(key, 0) + 1

    observe("registrant", reg["id"], reg.get("name"))
    observe("client", cli["id"], cli.get("name"))

    seen_lobbyists: set[int] = set()
    for idx, act in enumerate(f.get("lobbying_activities") or []):
        issue = act.get("general_issue_code")
        if issue:
            bundle.issue_codes.setdefault(issue, act.get("general_issue_code_display") or issue)
        bundle.activities.append((uuid, idx, issue, act.get("description"),
                                  act.get("foreign_entity_issues")))

        act_lobs: set[int] = set()
        for entry in act.get("lobbyists") or []:
            lob = entry.get("lobbyist") or {}
            lid = lob.get("id")
            if lid is None or lid in act_lobs:
                continue
            act_lobs.add(lid)
            display = _lobbyist_display(lob)
            bundle.lobbyists[lid] = (
                lid, display, lob.get("prefix"), lob.get("first_name"),
                lob.get("middle_name"), lob.get("nickname"), lob.get("last_name"),
                lob.get("suffix"),
            )
            bundle.activity_lobbyists.append((uuid, idx, lid,
                                              entry.get("covered_position"), entry.get("new")))
            if lid not in seen_lobbyists:
                seen_lobbyists.add(lid)
                bundle.filing_lobbyists.add((uuid, lid))
                observe("lobbyist", lid, display)

        act_ents: set[int] = set()
        for ent in act.get("government_entities") or []:
            if ent["id"] in act_ents:
                continue
            act_ents.add(ent["id"])
            bundle.gov_entities.setdefault(ent["id"], ent.get("name") or str(ent["id"]))
            bundle.activity_entities.append((uuid, idx, ent["id"]))
