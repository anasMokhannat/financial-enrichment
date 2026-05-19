"""Smoke-test the Supabase connection.

Run::

    python scripts/verify_supabase.py

The script checks, in order:
  1. SUPABASE_URL is set and looks like a URL.
  2. SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are set.
  3. The supabase-py client can be constructed.
  4. Each of the five expected tables exists and is queryable.

Every check prints `ok` or `fail` so the output is grep-friendly.
A single failure is fatal (we exit with status 1 immediately) because
each subsequent check assumes the previous one passed.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make `src` importable when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings  # noqa: E402
from src.db import SupabaseUnavailableError, get_service_client  # noqa: E402

TABLES = (
    "companies",
    "nace_codes",
    "functions",
    "filing_references",
    "financial_statements",
)


def row(label: str, status: str, detail: str = "") -> None:
    pad = " " * max(0, 28 - len(label))
    print(f"{label}{pad}{status}  {detail}".rstrip())


def fatal(message: str) -> "None":
    print()
    print(f"FAIL: {message}")
    raise SystemExit(1)


def main() -> int:
    # 1. Environment
    if not settings.supabase_url:
        row("SUPABASE_URL", "fail", "not set in .env")
        fatal("missing SUPABASE_URL")
    if not settings.supabase_url.startswith(("http://", "https://")):
        row("SUPABASE_URL", "fail", f"not a URL: {settings.supabase_url!r}")
        fatal("SUPABASE_URL must start with https://")
    row("SUPABASE_URL", "ok", settings.supabase_url)

    if not settings.supabase_service_role_key:
        row("service_role key", "fail", "not set in .env")
        fatal("missing SUPABASE_SERVICE_ROLE_KEY")
    row(
        "service_role key",
        "ok",
        f"({len(settings.supabase_service_role_key)} chars)",
    )

    if not settings.supabase_anon_key:
        row("anon key", "warn", "not set; frontend won't work")
    else:
        row("anon key", "ok", f"({len(settings.supabase_anon_key)} chars)")

    # 2. Client
    try:
        client = get_service_client()
    except SupabaseUnavailableError as exc:
        row("client connect", "fail", str(exc))
        fatal("could not build the Supabase client")
    row("client connect", "ok")

    # 3. Tables
    failures = 0
    for table in TABLES:
        try:
            resp = client.table(table).select("*", count="exact").limit(0).execute()
            count = resp.count if resp.count is not None else "?"
            row(f"table {table}", "ok", f"({count} rows)")
        except Exception as exc:
            failures += 1
            row(f"table {table}", "fail", str(exc)[:120])

    print()
    if failures:
        print(f"FAIL: {failures} table(s) inaccessible.")
        print("- Did you run the migration in supabase/migrations/ ?")
        print("- If yes, check that the *service_role* key is in .env "
              "(not the anon key).")
        return 1

    print("All checks passed — Supabase is wired up.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
