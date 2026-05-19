class EnrichmentError(Exception):
    """Base error for the enrichment pipeline."""


class CompanyNotFoundError(EnrichmentError):
    """KBO search returned no matches for the given query."""


class AmbiguousCompanyError(EnrichmentError):
    """KBO search returned several candidates and we cannot pick one."""

    def __init__(self, message: str, candidates: list[dict]) -> None:
        super().__init__(message)
        self.candidates = candidates


class NBBClientError(EnrichmentError):
    """The NBB Authentic Data Query API returned an unexpected response."""


class NoFilingsError(EnrichmentError):
    """The company has no published annual filings."""


class FinancialExtractionError(EnrichmentError):
    """We could not pull a financial statement out of a filing."""
