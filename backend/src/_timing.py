"""Tiny perf-timing helper used across the pipeline.

Each `with timed("label"):` block logs elapsed milliseconds at INFO,
which makes the CLI's default output enough to localise a slow step
without enabling `--verbose`.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger("timing")


@contextmanager
def timed(label: str) -> Iterator[None]:
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info("%-32s %7.0f ms", label, elapsed_ms)
