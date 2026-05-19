"""Tiny helpers to round-trip Pydantic models through Supabase JSON.

The Supabase Python SDK speaks PostgREST, which is JSON over HTTP.
Pydantic v2's ``model_dump(mode='json')`` already serialises:

* ``Decimal`` → string (preserves precision; Postgres ``numeric``
  accepts strings).
* ``date`` / ``datetime`` → ISO 8601 strings.
* Enum values → their ``value`` attribute.

…which is exactly what PostgREST wants. We just strip ``None`` values
on writes so the database doesn't overwrite existing columns with
NULL during partial upserts.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


def to_row(model: BaseModel, *, exclude_none: bool = True) -> dict[str, Any]:
    """Serialize a Pydantic model to a PostgREST-safe dict."""
    return model.model_dump(mode="json", exclude_none=exclude_none)


def to_rows(models: list[BaseModel], *, exclude_none: bool = True) -> list[dict[str, Any]]:
    return [to_row(m, exclude_none=exclude_none) for m in models]
