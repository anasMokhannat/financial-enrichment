"""Print the structure of a cached XBRL filing.

    python scripts/debug_xbrl.py <reference>

Useful when an expected NBB code (like 9087, average FTE) doesn't
make it through the extractor. Dumps:

  1. Every <xbrli:context> with its period and the set of contexts
     that the year-based picker would currently accept as "current".
  2. Every numeric fact whose contextRef is in the current set,
     grouped by whether the extractor's regex finds a known heading
     code in the element's local name.
  3. A targeted view of "employee-like" facts — anything containing
     'employee', 'personnel', 'FTE', '9087' or '1003' anywhere in the
     element name, attributes, or contextRef.

The third section is the one to paste back when reporting an
extraction miss — it usually tells us exactly what's going on.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

from lxml import etree

# Make the project package importable so we can reuse HEADING_MAP +
# the same regex the extractor uses, keeping this script in lock-step
# with the real code path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.extraction.headings import HEADING_MAP  # noqa: E402
from src.extraction.xbrl_extractor import (  # noqa: E402
    _CODE_RE,
    _CODE_TO_FIELD,
    _XBRLI_NS,
    _code_for,
    _local,
    _parse_xbrl_number,
)

EMPLOYEE_HINT_RE = re.compile(
    r"employee|personnel|fte|9087|1003|effectif|personeel",
    re.IGNORECASE,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", help="Filing reference, e.g. 2023-00194787")
    parser.add_argument(
        "--cache-dir",
        default=".cache",
        help="Cache directory (relative to backend/).",
    )
    args = parser.parse_args()

    path = Path(args.cache_dir) / f"{args.reference}.xbrl"
    if not path.exists():
        raise SystemExit(f"XBRL file not found at {path}. Trigger a refresh first.")

    root = etree.fromstring(path.read_bytes())

    print(f"=== file: {path.name}  ({path.stat().st_size // 1024} KB)")

    # 1) contexts
    print("\n=== contexts (id -> period)")
    ctx_to_end: dict[str, str] = {}
    for ctx in root.iterfind(f".//{{{_XBRLI_NS}}}context"):
        ctx_id = ctx.get("id")
        if not ctx_id:
            continue
        start = ctx.find(f".//{{{_XBRLI_NS}}}startDate")
        end = ctx.find(f".//{{{_XBRLI_NS}}}endDate")
        inst = ctx.find(f".//{{{_XBRLI_NS}}}instant")
        period_repr = (
            f"{start.text} -> {end.text}"
            if start is not None and end is not None
            else f"instant {inst.text}"
            if inst is not None
            else "?"
        )
        end_text = (end.text if end is not None else inst.text if inst is not None else "") or ""
        ctx_to_end[ctx_id] = end_text.strip()
        print(f"  {ctx_id:30}  {period_repr}")

    if not ctx_to_end:
        print("  (no contexts found — file looks malformed)")
        return 0

    latest_year = max(ctx_to_end.values())[:4]
    current_contexts = {
        ctx_id for ctx_id, end in ctx_to_end.items() if end.startswith(latest_year)
    }
    print(f"\nlatest year:  {latest_year}")
    print(f"current ctx:  {sorted(current_contexts)}")

    # 2) facts in current contexts, by mapped vs unmapped
    mapped: dict[str, list[tuple[str, str]]] = defaultdict(list)  # code -> [(local, value)]
    unmapped: list[tuple[str, str, str]] = []  # (local, contextRef, value)
    employee_hits: list[dict] = []

    for elem in root.iter():
        ctx_ref = elem.get("contextRef")
        if not ctx_ref:
            continue
        text = (elem.text or "").strip()
        local = _local(elem.tag)

        # Anything employee-related, regardless of contextRef. Wider net
        # than the extractor so we can spot the right element even if
        # the regex misses it.
        haystack = f"{local} {ctx_ref} {' '.join(elem.attrib.values())}"
        if EMPLOYEE_HINT_RE.search(haystack):
            employee_hits.append(
                {
                    "local_name": local,
                    "contextRef": ctx_ref,
                    "value": text,
                    "attrs": dict(elem.attrib),
                    "parsed": _parse_xbrl_number(text),
                }
            )

        if ctx_ref not in current_contexts:
            continue
        if _parse_xbrl_number(text) is None:
            continue

        code = _code_for(local)
        if code is not None:
            mapped[code].append((local, text))
        else:
            unmapped.append((local, ctx_ref, text))

    print(f"\n=== mapped facts in current year  ({sum(len(v) for v in mapped.values())} total)")
    for code in sorted(mapped):
        field = _CODE_TO_FIELD.get(code, "?")
        for local, val in mapped[code]:
            print(f"  code {code:7}  field {field:24}  {local}  =  {val}")

    print(f"\n=== unmapped numeric facts in current year  ({len(unmapped)} total)")
    print("    (first 30; rerun the script with > tee debug.txt for the full list)")
    for local, ctx_ref, val in unmapped[:30]:
        codes_in_name = ", ".join(m.group(1) for m in _CODE_RE.finditer(local)) or "(none)"
        print(f"  {local:40}  ctx={ctx_ref:18}  val={val:>14}  digits={codes_in_name}")

    print(f"\n=== employee-like elements anywhere in the file  ({len(employee_hits)} total)")
    for hit in employee_hits[:25]:
        print(
            f"  local={hit['local_name']!r}\n"
            f"    contextRef={hit['contextRef']!r}\n"
            f"    value={hit['value']!r}  parsed={hit['parsed']}\n"
            f"    attrs={hit['attrs']}"
        )

    print("\n=== heading codes the extractor cares about (HEADING_MAP)")
    for field, codes in HEADING_MAP.items():
        marker = "  HIT" if any(c in mapped for c in codes) else "  MISS"
        print(f"  {field:24}  {codes}  {marker}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
