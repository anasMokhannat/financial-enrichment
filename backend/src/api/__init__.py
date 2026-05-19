"""FastAPI service wrapping the enrichment pipeline.

Mount: ``uvicorn src.api.main:app --reload``

The API is a thin layer over :class:`src.pipeline.EnrichmentPipeline`
and :class:`src.db.EnrichmentRepository`. It does no business logic of
its own — every endpoint either reads from Supabase, calls the
pipeline, or both.

There is no per-user authentication. The five tables we expose are
public reference data (KBO + NBB) and there is no per-user state in
this project (the lead-management UI is design reference only). When
auth is needed, plug Supabase Auth in front of the routes via a
dependency that validates the JWT and pass it through to the
anon-keyed Supabase client.
"""
