"""Vercel Python serverless entry.

Vercel detects every file under ``api/`` as a serverless function.
This module just re-exports the FastAPI application from ``src.api.main``
so the function handles every route the app declares.

The Vercel build step runs ``pip install -r requirements.txt`` from
the directory containing ``vercel.json`` (the ``backend/`` root), so
``src`` is on the import path because of the implicit working
directory.

For local development this file is irrelevant — use
``uvicorn src.api.main:app`` as before.
"""

from src.api.main import app

# Vercel's Python runtime looks for either ``app`` or ``handler`` at
# module scope. ``app`` is the natural one for ASGI frameworks.
__all__ = ["app"]
