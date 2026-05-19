"""Helpers for Belgian enterprise (BCE/KBO/CBE) numbers.

An enterprise number is a 10-digit identifier whose first digit is
either ``0`` or ``1``. Inputs in the wild come with dots, spaces or
no separators at all — :func:`normalise` strips everything down to
the canonical 10-digit form, while :func:`format_human` renders it
back as ``XXXX.XXX.XXX`` for display.
"""

from __future__ import annotations

import re


_DIGITS_RE = re.compile(r"\D")


def normalise(raw: str) -> str:
    """Return the canonical 10-digit enterprise number, or raise ``ValueError``."""
    digits = _DIGITS_RE.sub("", raw)
    if len(digits) != 10 or digits[0] not in {"0", "1"}:
        raise ValueError(f"Not a valid Belgian enterprise number: {raw!r}")
    return digits


def try_normalise(raw: str) -> str | None:
    """Return the canonical number, or ``None`` if ``raw`` is not one."""
    try:
        return normalise(raw)
    except ValueError:
        return None


def format_human(number: str) -> str:
    return f"{number[0:4]}.{number[4:7]}.{number[7:10]}"
