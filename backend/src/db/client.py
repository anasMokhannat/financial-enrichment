"""Supabase client builders.

Two clients exist:

* **Service-role client** — bypasses RLS. Use from the backend only.
  Never expose to the browser.
* **Anon client** — subject to RLS; this is what the frontend gets.

Both clients are thin wrappers around :func:`supabase.create_client`;
we keep them here so callers don't import the SDK directly and so we
can swap implementations (sync vs async, PostgREST vs psycopg) without
touching every caller.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from src.config import settings


class SupabaseUnavailableError(RuntimeError):
    """Raised when the environment isn't configured for Supabase."""


@lru_cache(maxsize=1)
def get_service_client() -> Client:
    """Return a singleton Supabase client using the service-role key.

    Raises :class:`SupabaseUnavailableError` when ``SUPABASE_URL`` or
    ``SUPABASE_SERVICE_ROLE_KEY`` are missing — better than failing
    later with an opaque 401 from PostgREST.
    """
    if not settings.has_supabase_credentials:
        raise SupabaseUnavailableError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "Get them from Project Settings → API in the Supabase dashboard."
        )
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )


def get_anon_client(jwt: str | None = None) -> Client:
    """Return a Supabase client using the anon key, optionally with a user JWT.

    Pass the user's JWT (from Supabase Auth on the frontend) to make
    RLS policies see ``auth.uid()`` as the right user. Without a JWT
    the client is anonymous — only world-readable rows are visible.
    """
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise SupabaseUnavailableError(
            "SUPABASE_URL and SUPABASE_ANON_KEY must be set."
        )
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    if jwt:
        client.postgrest.auth(jwt)
    return client
