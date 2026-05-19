"""Side-by-side benchmark of the regex extractor vs the OpenAI LLM extractor.

Usage:
    python scripts/compare_extractors.py [--filing 2023-00194787]

Defaults to the Umicore VOL-kap filing we already cached. Both extractors
run against the same cached PDF on disk — no NBB API call is made — so
this only needs an OPENAI_API_KEY in .env.

Writes ``output/extractor-comparison.json`` (full diff) and prints a
two-column table to the console.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from decimal import Decimal
from pathlib import Path
from typing import Optional

# Make the project importable when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings
from src.extraction.extractor import _pdf_to_text, _scan_pdf_headings
from src.extraction.headings import HEADING_MAP
from src.extraction.llm_extractor import LLMExtractor, _SYSTEM_PROMPT, _RESPONSE_SCHEMA
from src.extraction.page_segmenter import select_financial_text
from src.extraction._tokens import count_tokens, truncate_to_token_budget
from src.models import FilingFormat, FilingReference, FinancialStatement

FIELDS = [
    "revenue",
    "operating_profit",
    "net_profit",
    "total_assets",
    "fixed_assets",
    "current_assets",
    "total_equity",
    "total_liabilities",
    "long_term_debt",
    "short_term_debt",
    "cash_and_equivalents",
    "inventory",
    "depreciation",
    "employees_fte",
]


def _regex_extract(pdf_bytes: bytes) -> dict[str, Optional[Decimal]]:
    """Run our regex scanner without going through the FinancialExtractor class.

    We don't have an NBBClient here (no need — the PDF is on disk), so we
    bypass the class wrapper and call the same low-level helpers directly.
    """
    text = _pdf_to_text(pdf_bytes)
    headings = _scan_pdf_headings(text)
    out: dict[str, Optional[Decimal]] = {}
    for field, codes in HEADING_MAP.items():
        out[field] = next(
            (headings[code] for code in codes if code in headings),
            None,
        )
    return out


def _llm_extract(pdf_bytes: bytes) -> tuple[dict[str, Optional[Decimal]], dict]:
    """Run the LLM extractor directly against the cached PDF bytes.

    Bypasses the NBBClient.download_pdf round-trip — we already have the
    bytes in hand. Returns ``(values, segmentation_diagnostics)``.
    """
    from openai import OpenAI

    if not settings.has_openai_credentials:
        raise SystemExit(
            "OPENAI_API_KEY is not set. Add it to your .env file."
        )

    client = OpenAI(api_key=settings.openai_api_key)
    raw_text = _pdf_to_text(pdf_bytes)
    body, diag = select_financial_text(raw_text)

    system_tokens = count_tokens(_SYSTEM_PROMPT, settings.openai_model)
    user_budget = (
        settings.openai_max_input_tokens
        - system_tokens
        - settings.openai_safety_margin_tokens
    )
    payload_text, used_tokens, truncated = truncate_to_token_budget(
        body, user_budget, settings.openai_model
    )
    diag["token_budget"] = {
        "max_input_tokens": settings.openai_max_input_tokens,
        "system_prompt_tokens": system_tokens,
        "safety_margin_tokens": settings.openai_safety_margin_tokens,
        "user_content_tokens": used_tokens,
        "truncated": truncated,
    }

    resp = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": payload_text},
        ],
        response_format={"type": "json_schema", "json_schema": _RESPONSE_SCHEMA},
        temperature=0,
    )
    payload = json.loads(resp.choices[0].message.content)
    out: dict[str, Optional[Decimal]] = {}
    for field in FIELDS:
        v = payload.get(field)
        out[field] = Decimal(str(v)) if v is not None else None
    # Surface the OpenAI usage tallies if the SDK gave them to us.
    usage = getattr(resp, "usage", None)
    if usage is not None:
        diag["openai_usage"] = {
            "prompt_tokens": getattr(usage, "prompt_tokens", None),
            "completion_tokens": getattr(usage, "completion_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
        }
    return out, diag


def _fmt(v: Optional[Decimal]) -> str:
    if v is None:
        return "—"
    f = float(v)
    if abs(f) >= 1e9:
        return f"{f / 1e9:,.2f}B"
    if abs(f) >= 1e6:
        return f"{f / 1e6:,.2f}M"
    if abs(f) >= 1e3:
        return f"{f / 1e3:,.1f}K"
    return f"{f:,.0f}"


def _agreement(a: Optional[Decimal], b: Optional[Decimal]) -> str:
    """Classify two extractions of the same field.

    'match'   - both None, or within 0.5% of each other
    'differ'  - both present, values disagree materially
    'regex-only' / 'llm-only' - one extracted, the other didn't
    """
    if a is None and b is None:
        return "match"
    if a is None:
        return "llm-only"
    if b is None:
        return "regex-only"
    fa, fb = float(a), float(b)
    if fa == fb:
        return "match"
    denom = max(abs(fa), abs(fb))
    return "match" if denom > 0 and abs(fa - fb) / denom < 0.005 else "differ"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--filing",
        default="2023-00194787",
        help="Reference of a cached filing under .cache/ (without the .pdf extension).",
    )
    parser.add_argument(
        "--cache-dir",
        default=str(settings.cache_dir),
        help="Cache directory containing the PDFs.",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    pdf_path = Path(args.cache_dir) / f"{args.filing}.pdf"
    if not pdf_path.exists():
        raise SystemExit(f"PDF not found at {pdf_path}")
    pdf_bytes = pdf_path.read_bytes()

    print(f"Benchmarking on {pdf_path.name}  ({pdf_path.stat().st_size // 1024} KB)")
    print(f"OpenAI model: {settings.openai_model}")
    print()

    t0 = time.perf_counter()
    regex_values = _regex_extract(pdf_bytes)
    regex_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    llm_values, llm_diag = _llm_extract(pdf_bytes)
    llm_ms = (time.perf_counter() - t0) * 1000

    if llm_diag.get("segmented"):
        print(
            f"segmentation: kept sections "
            f"{', '.join(llm_diag.get('sections_matched', []))}  |  "
            f"{llm_diag['kept_chars']:,} of {llm_diag['original_chars']:,} chars "
            f"({llm_diag['kept_chars'] * 100 // max(llm_diag['original_chars'], 1)}%)"
        )
    else:
        print(f"segmentation: NOT applied — {llm_diag.get('reason', '?')}")
    if "token_budget" in llm_diag:
        b = llm_diag["token_budget"]
        flag = "  TRUNCATED" if b["truncated"] else ""
        print(
            f"token budget: user={b['user_content_tokens']:,}  "
            f"system={b['system_prompt_tokens']:,}  "
            f"margin={b['safety_margin_tokens']:,}  "
            f"cap={b['max_input_tokens']:,}{flag}"
        )
    if "openai_usage" in llm_diag:
        u = llm_diag["openai_usage"]
        print(f"openai usage: prompt={u['prompt_tokens']}  completion={u['completion_tokens']}")
    print()

    summary = {"match": 0, "differ": 0, "regex-only": 0, "llm-only": 0}
    rows: list[dict] = []
    print(f"{'Field':<22}{'Regex':>14}{'LLM':>14}   Verdict")
    print("-" * 72)
    for field in FIELDS:
        r = regex_values.get(field)
        l = llm_values.get(field)
        verdict = _agreement(r, l)
        summary[verdict] += 1
        marker = {
            "match": " ",
            "differ": "*",
            "regex-only": "<",
            "llm-only": ">",
        }[verdict]
        print(f"{field:<22}{_fmt(r):>14}{_fmt(l):>14}   {marker} {verdict}")
        rows.append(
            {
                "field": field,
                "regex": str(r) if r is not None else None,
                "llm": str(l) if l is not None else None,
                "verdict": verdict,
            }
        )
    print("-" * 72)
    print(f"summary: {summary}")
    print(f"timing: regex {regex_ms:.0f} ms  |  llm {llm_ms:.0f} ms")

    report = {
        "filing": pdf_path.name,
        "openai_model": settings.openai_model,
        "regex_runtime_ms": round(regex_ms, 1),
        "llm_runtime_ms": round(llm_ms, 1),
        "segmentation": llm_diag,
        "summary": summary,
        "fields": rows,
    }
    out_path = Path("output") / "extractor-comparison.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print()
    print(f"saved: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
