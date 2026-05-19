"""Supabase-backed persistence for the enrichment layer.

Public surface:

* :func:`get_service_client` — builds a Supabase client using the
  service-role key. Use from the backend (FastAPI handlers, ingestion
  scripts) where RLS is intentionally bypassed.
* :func:`get_anon_client` — anon-key client subject to RLS. Anonymous
  reads only (the frontend uses this; the JWT is optional and not
  needed for the read-anyone enrichment tables).
* :class:`EnrichmentRepository` — upsert + read for companies, NACE
  codes, functions, filings, financial statements.

The repository does not commit transactions in the SQL sense — every
write is a single PostgREST request. Multi-table writes (saving a
Company together with its NACE codes and functions) are wrapped in
``save_report`` which sequences the individual calls but cannot roll
back partial failures. If you need atomicity, push the logic into a
SQL function and call it via :meth:`postgrest.rpc`.
"""

from .analysis_repo import AnalysisRepository
from .client import SupabaseUnavailableError, get_anon_client, get_service_client
from .enrichment_repo import EnrichmentRepository

__all__ = [
    "AnalysisRepository",
    "EnrichmentRepository",
    "SupabaseUnavailableError",
    "get_anon_client",
    "get_service_client",
]
