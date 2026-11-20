#!/usr/bin/env python3
"""Build a SQL regression script that can only touch transaction-local fixtures.

python3 tests/sql/build_ceo_reminder_7d_test.py --baseline > /tmp/ceo-reminder-red.sql
python3 tests/sql/build_ceo_reminder_7d_test.py > /tmp/ceo-reminder-green.sql

Run the resulting SQL in one database request/session. The baseline is expected
to raise `FAIL: CEO receives no reminder before 168 hours (6d23h59m)`.
The candidate ends with ROLLBACK, including all temporary DDL and fixture data.
This program does not connect to a database or execute any SQL itself.
"""
from pathlib import Path
import argparse
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def isolated(sql: str) -> str:
    sql = sql.replace("auth.users", "pg_temp.auth_users").replace("public.", "pg_temp.")
    # A test never creates a definer function or grants production access.
    sql = re.sub(r"SECURITY\s+DEFINER", "SECURITY INVOKER", sql, flags=re.I)
    sql = re.sub(r"SET search_path TO[^\n]+", "SET search_path TO 'pg_temp'", sql, flags=re.I)
    sql = sql.replace("pg_advisory_xact_lock(2916, 7)", "pg_advisory_xact_lock(-2916, 7)")
    return sql


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    fixture = (HERE / "ceo_reminder_7d_fixture.sql").read_text()
    regression = (HERE / "ceo_reminder_7d_regression.sql").read_text()
    if args.baseline:
        source = (ROOT / "sql/baseline/approval_reminders_before_2916.sql").read_text()
        match = re.search(
            r"CREATE OR REPLACE FUNCTION public\.v23_enqueue_due_reminders\(\).*?AS \$function\$.*?\$function\$",
            source, re.S,
        )
        if not match:
            raise SystemExit("Baseline enqueue function was not found")
        # The first assertion fails before any new field/RPC is used.
        implementation = isolated(match.group()) + ";"
    else:
        source = (ROOT / "sql/ceo_reminder_7d.sql").read_text()
        # ACLs belong to deployment verification; never modify live grants in tests.
        source = re.sub(r"-- BEGIN DEPLOYMENT ACL\n.*?-- END DEPLOYMENT ACL\n", "", source, flags=re.S)
        source = re.sub(r"-- BEGIN DEPLOYMENT NOTIFY\n.*?-- END DEPLOYMENT NOTIFY\n", "", source, flags=re.S)
        implementation = isolated(source)
    output = "BEGIN;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL TIME ZONE 'UTC';\n" + fixture + "\n" + implementation + "\n" + regression + "\nROLLBACK;\n"
    if re.search(r"\b(?:public|auth)\.", output):
        raise SystemExit("Refusing to emit SQL that still references public/auth schema")
    if re.search(r"\bNOTIFY\s+pgrst\b", output, re.I):
        raise SystemExit("Refusing to emit a production PostgREST reload notification")
    sys.stdout.write(output)


if __name__ == "__main__":
    main()
