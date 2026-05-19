"""OpenAI token counting and budget-aware truncation.

We use :mod:`tiktoken` when available so the count is exact for the
target model. tiktoken doesn't know about every recent model name
(e.g. ``gpt-5.4-mini``), so when ``encoding_for_model`` raises we fall
back to ``o200k_base`` — the encoding shared by every gpt-4o / gpt-4.1
/ gpt-5 family model, which is what we'll actually be hitting.

If tiktoken can't be imported at all (it's listed in requirements but
shouldn't be a hard install dependency), we degrade to a character
heuristic: ~4 characters per token. The heuristic is conservative
enough not to silently exceed the budget — but precise counts are
strongly preferred and the import path is the default.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Approximate chars-per-token used only when tiktoken isn't available.
# Belgian filing text trends to short numeric tokens, so 3.5 is a
# safer estimate than the usual 4 — it slightly *over-counts* tokens
# which is the conservative side of the trade.
_CHARS_PER_TOKEN_FALLBACK = 3.5


def _encoding_for(model: str):
    try:
        import tiktoken
    except ImportError:
        return None
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        # Unknown model name (e.g. very new release). Every model in the
        # gpt-4o / gpt-4.1 / gpt-5 line uses the o200k_base encoding.
        try:
            return tiktoken.get_encoding("o200k_base")
        except Exception:
            return None


def count_tokens(text: str, model: str) -> int:
    enc = _encoding_for(model)
    if enc is None:
        return int(len(text) / _CHARS_PER_TOKEN_FALLBACK) + 1
    return len(enc.encode(text))


def truncate_to_token_budget(text: str, max_tokens: int, model: str) -> tuple[str, int, bool]:
    """Return ``(truncated_text, token_count, was_truncated)``.

    Truncates from the END so the beginning of the document (where the
    balance sheet and income statement live for NBB filings after
    segmentation) is preserved.
    """
    if max_tokens <= 0:
        return "", 0, True

    enc = _encoding_for(model)
    if enc is None:
        # Char-based fallback. Slightly over-estimate so we err on the side
        # of cutting more than tiktoken would.
        char_budget = int(max_tokens * _CHARS_PER_TOKEN_FALLBACK)
        if len(text) <= char_budget:
            return text, int(len(text) / _CHARS_PER_TOKEN_FALLBACK) + 1, False
        return text[:char_budget], max_tokens, True

    tokens = enc.encode(text)
    if len(tokens) <= max_tokens:
        return text, len(tokens), False
    logger.warning(
        "Input exceeded token budget (%d > %d); truncating",
        len(tokens),
        max_tokens,
    )
    truncated = enc.decode(tokens[:max_tokens])
    return truncated, max_tokens, True
