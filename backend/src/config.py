from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    nbb_api_base_url: str = Field(default="https://ws.cbso.nbb.be/authentic")
    nbb_api_subscription_key: str = Field(default="")
    # Single deposit endpoint used for both PDF and XBRL — format is
    # picked by the Accept header at request time, not by URL path.
    # Override via env if your subscription tier uses a different path
    # (some tiers use `/deposits/...` plural). `{reference}` is
    # substituted at call time.
    nbb_deposit_path: str = Field(default="/deposit/{reference}/accountingData")
    http_timeout: float = Field(default=30.0)
    cache_dir: Path = Field(default=Path(".cache"))

    openai_api_key: str = Field(default="")
    openai_model: str = Field(default="gpt-4o-mini")
    # Hard input-token limit for the chosen model. Default 272 000 matches
    # the user's stated cap; override per model if you switch to one with
    # a different context window. Leave room for the system prompt and
    # completion via openai_safety_margin_tokens below.
    openai_max_input_tokens: int = Field(default=272_000)
    openai_safety_margin_tokens: int = Field(default=4_000)

    # Supabase. Service role bypasses RLS — used by the backend for
    # ingestion. Anon key is what the Next.js frontend ships; it is
    # subject to RLS policies.
    supabase_url: str = Field(default="")
    supabase_service_role_key: str = Field(default="")
    supabase_anon_key: str = Field(default="")

    @property
    def has_nbb_credentials(self) -> bool:
        return bool(self.nbb_api_subscription_key)

    @property
    def has_openai_credentials(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def has_supabase_credentials(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


settings = Settings()

# Best-effort cache-dir creation. On serverless platforms (Vercel,
# Lambda) the working directory is read-only and the only writable
# path is /tmp. Set ``CACHE_DIR=/tmp/.cache`` in those environments;
# locally the default ``./.cache`` works fine. Failures here are
# non-fatal — the PDF cache is a speed-up, not a correctness
# requirement; Supabase is the durable store.
try:
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
except OSError:
    import logging

    logging.getLogger(__name__).warning(
        "Could not create cache_dir at %s; running without on-disk cache.",
        settings.cache_dir,
    )
