"""
CASCADE — Answer verifiers

Two gates every answer passes before it is shown:

1. VERBATIM  — a quoted procedure step / cause-effect cell must be identical
   (whitespace aside) to the source table cell, AND its words must occur in
   order in the page text extracted from the same PDF. Two independent
   extractions agreeing is the evidence that nothing was rewritten.

2. GROUNDING — every generated sentence is reduced to its hard facts
   (equipment/instrument tags, work-order ids, numbers with units, dates).
   Each fact must appear in the evidence that sentence cites. A sentence with
   an unsupported fact is removed, never shown with a warning.

The grounding gate is also what keeps an optional LLM honest: its output is
treated exactly like any other generated sentence.
"""
from __future__ import annotations

import re

FACT_PATTERNS = [
    ("tag", re.compile(r"\b[A-Z]{1,5}-\d{3,4}[A-Z]?\b")),          # VSHH-1201, GA-1201A
    ("wo", re.compile(r"\bWO-\d{6}\b")),
    ("opl", re.compile(r"\bOPL-[A-Z]{2}-\d{4}[A-Z]?-\d{2}\b")),
    ("date", re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")),
    ("qty", re.compile(r"(?<![\w.])\d+(?:[.,]\d+)?\s?(?:mm/s|barg|bar|degC|°C|m3/h|kW|rpm|"
                       r"mm/100mm|mm|MW|kg/h|h|years?|months?|weeks?|days?|d)\b")),
    ("money", re.compile(r"Rp\s?[\d.,]+")),
]


def ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def words(s: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+", s.lower())


def ordered_subsequence(needle: list[str], hay: list[str]) -> bool:
    it = iter(hay)
    return all(any(w == h for h in it) for w in needle)


def check_verbatim(quote: str, source_cell: str, page_text: str) -> dict:
    cell_exact = ws(quote) == ws(source_cell)
    in_page = ordered_subsequence(words(quote), words(page_text))
    return {"cell_exact": cell_exact, "in_page_order": in_page,
            "passed": cell_exact and in_page}


def facts(sentence: str) -> list[tuple[str, str]]:
    out = []
    for kind, pat in FACT_PATTERNS:
        for m in pat.findall(sentence):
            out.append((kind, m if isinstance(m, str) else m[0]))
    return out


def _norm_fact(kind: str, f: str) -> str:
    f = f.replace(",", "").replace(" ", "").lower()
    return f


def fact_supported(kind: str, fact: str, evidence_text: str) -> bool:
    ev = evidence_text.replace(",", "").lower()
    f = _norm_fact(kind, fact)
    if kind == "qty":
        num = re.match(r"[\d.]+", f).group(0)
        # the number must appear as a standalone value, not as a digit glued to a
        # letter (e.g. "5" must not be "supported" by the cause-row label "T5").
        return re.search(rf"(?<![\w.]){re.escape(num)}(?![\d])", ev) is not None
    if kind == "money":
        digits = re.sub(r"\D", "", f)
        return digits in re.sub(r"\D", "", ev) or digits in ev.replace(".", "")
    return f in ev.replace(" ", "")


def check_grounding(sentence: str, evidence_texts: list[str],
                    derived: dict[str, str] | None = None) -> dict:
    """`derived` holds values computed by CASCADE itself (sums, day counts)
    with the formula that produced them, so they are grounded in arithmetic
    over cited evidence rather than in a document."""
    blob = " \n ".join(evidence_texts)
    derived = derived or {}
    unsupported = []
    fs = facts(sentence)
    for kind, f in fs:
        if fact_supported(kind, f, blob):
            continue
        if any(_norm_fact(kind, f).startswith(_norm_fact("qty", d)) or
               _norm_fact(kind, f) == _norm_fact("qty", d) for d in derived):
            continue
        unsupported.append(f)
    return {"facts": len(fs), "unsupported": unsupported, "passed": not unsupported}
