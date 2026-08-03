"""Crafted test world exercising every rule the API must respect:
an amendment chain (as-filed vs as-amended amounts differ), a self-filer reporting
expenses, a reported-zero filing, two client IDs sharing an exact name (group search),
and a legacy filing-level attribution quarter. Edges and metrics are produced by the
REAL builders, not hand-inserted."""

from __future__ import annotations

import psycopg

from lda_pipeline.edges.build import build_quarter
from lda_pipeline.metrics.compute import compute_quarter
from lda_pipeline.normalize.amendments import resolve_partition

F_COLS = ("filing_uuid, filing_type, document_kind, is_termination, is_amendment, "
          "is_no_activity, filing_year, filing_period, period_ord, registrant_id, client_id, "
          "income, expenses, amount, amount_type, is_reported_zero, dt_posted, "
          "attribution_level, filing_document_url, retrieved_at, source_request_url")

U = {
    "f1":  "10000000-0000-0000-0000-000000000001",   # FIRM A -> CLIENT X(10), Q1, income 50k
    "f1a": "10000000-0000-0000-0000-000000000002",   # amendment of f1: income 75k
    "f2":  "10000000-0000-0000-0000-000000000003",   # SELFCO self-filing, expenses 120k
    "f4":  "10000000-0000-0000-0000-000000000004",   # FIRM A -> CLIENT X(12), reported zero
    "f5":  "10000000-0000-0000-0000-000000000005",   # Q2: FIRM A -> CLIENT X(10), income 60k
    "f6":  "10000000-0000-0000-0000-000000000006",   # 2019 legacy attribution
}

QUARTERS = [(2019, "first_quarter"), (2023, "first_quarter"), (2023, "second_quarter")]


def build_miniworld(url: str) -> None:
    with psycopg.connect(url) as conn:
        c = conn.cursor()
        c.execute("""
            INSERT INTO ref_filing_types VALUES
              ('Q1','1st Quarter - Report','quarterly',false,false,false),
              ('1A','1st Quarter - Amendment','quarterly',false,true,false),
              ('Q2','2nd Quarter - Report','quarterly',false,false,false)
        """)
        c.execute("INSERT INTO ref_issue_codes VALUES ('DEF','Defense'),('TAX','Taxation')")
        c.execute("INSERT INTO gov_entities VALUES (2,'HOUSE OF REPRESENTATIVES'),(3,'SENATE')")
        c.execute("INSERT INTO registrants (id, display_name) VALUES "
                  "(1,'FIRM A LLC'),(2,'SELFCO INDUSTRIES')")
        c.execute("INSERT INTO clients (id, display_name) VALUES "
                  "(10,'CLIENT X CORP'),(11,'SELFCO INDUSTRIES'),(12,'CLIENT X CORP')")
        c.execute("INSERT INTO lobbyists (id, display_name, first_name, last_name) VALUES "
                  "(100,'ALICE SMITH','ALICE','SMITH'),(101,'BOB JONES','BOB','JONES')")

        def filing(uuid, ftype, amend, year, period, ord_, reg, cli, income, expenses,
                   zero, posted, attribution):
            amount = income if income is not None else expenses
            atype = "income" if income is not None else ("expenses" if expenses is not None else None)
            c.execute(
                f"INSERT INTO filings ({F_COLS}) VALUES "
                "(%s,%s,'quarterly',false,%s,false,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
                "%s,%s,now(),'test://')",
                (uuid, ftype, amend, year, period, ord_, reg, cli, income, expenses,
                 amount, atype, zero, posted, attribution,
                 f"https://lda.gov/filings/public/filing/{uuid}/print/"))

        def activity(uuid, idx, issue, lobbyist_ids, entity_ids):
            c.execute("INSERT INTO filing_activities VALUES (%s,%s,%s,'desc','')",
                      (uuid, idx, issue))
            for lid in lobbyist_ids:
                c.execute("INSERT INTO activity_lobbyists VALUES (%s,%s,%s,NULL,false)",
                          (uuid, idx, lid))
                c.execute("INSERT INTO filing_lobbyists VALUES (%s,%s) ON CONFLICT DO NOTHING",
                          (uuid, lid))
            for eid in entity_ids:
                c.execute("INSERT INTO activity_government_entities VALUES (%s,%s,%s)",
                          (uuid, idx, eid))

        filing(U["f1"], "Q1", False, 2023, "first_quarter", 20231, 1, 10,
               50000, None, False, "2023-04-20", "activity")
        activity(U["f1"], 0, "DEF", [100], [2, 3])
        filing(U["f1a"], "1A", True, 2023, "first_quarter", 20231, 1, 10,
               75000, None, False, "2023-06-01", "activity")
        activity(U["f1a"], 0, "DEF", [100], [2, 3])
        filing(U["f2"], "Q1", False, 2023, "first_quarter", 20231, 2, 11,
               None, 120000, False, "2023-04-18", "activity")
        activity(U["f2"], 0, "TAX", [101], [2])
        filing(U["f4"], "Q1", False, 2023, "first_quarter", 20231, 1, 12,
               0, None, True, "2023-04-19", "activity")
        activity(U["f4"], 0, "TAX", [100], [3])
        filing(U["f5"], "Q2", False, 2023, "second_quarter", 20232, 1, 10,
               60000, None, False, "2023-07-20", "activity")
        activity(U["f5"], 0, "DEF", [100], [3])
        filing(U["f6"], "Q1", False, 2019, "first_quarter", 20191, 1, 10,
               40000, None, False, "2019-04-22", "filing")
        activity(U["f6"], 0, "DEF", [100], [2])
        activity(U["f6"], 1, "TAX", [100], [2])   # legacy: same entity list duplicated

        c.execute("""
            INSERT INTO entity_name_observations VALUES
              ('registrant',1,'FIRM A LLC',20231,3),('registrant',1,'FIRM A LLC',20232,1),
              ('registrant',2,'SELFCO INDUSTRIES',20231,1),
              ('client',10,'CLIENT X CORP',20231,2),('client',10,'CLIENT X CORP',20232,1),
              ('client',12,'CLIENT X CORP',20231,1),
              ('client',11,'SELFCO INDUSTRIES',20231,1),
              ('lobbyist',100,'ALICE SMITH',20231,3),('lobbyist',101,'BOB JONES',20231,1),
              ('registrant',1,'FIRM A LLC',20191,1),('client',10,'CLIENT X CORP',20191,1),
              ('lobbyist',100,'ALICE SMITH',20191,1)
        """)
        c.execute("""
            INSERT INTO load_state VALUES
              ('filings',2023,'first_quarter',4,'2026-08-01T00:00:00Z','2026-08-02T00:00:00Z',now())
        """)
        conn.commit()

        for year, period in QUARTERS:
            resolve_partition(conn, year, period)
        conn.commit()
        conn.execute("REFRESH MATERIALIZED VIEW entity_names")
        conn.commit()
        for year, period in QUARTERS:
            build_quarter(conn, year, period)
            compute_quarter(conn, year, period)
