"""
CASCADE — Document Extraction Layer
Layout-aware extraction of the CALIBER 2026 Case 1 technical corpus.

Why not plain pdftotext: the OPL PDFs have a broken text-layer ordering.
pdftotext emits safety bullets interleaved ("Beware ofhazardous / Confirm
flammable, hot..."), which would make any verbatim quote of a SAFETY
PRECAUTION section wrong. We rebuild reading order from word geometry
(line clustering by y-position, then x-order), which repairs it.

Every emitted chunk keeps its anchor: doc_id, page, section, char span.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path

import pdfplumber

# --------------------------------------------------------------------------
# Corpus location
# --------------------------------------------------------------------------
import os

# Point CASCADE_DATA at the unzipped "Case 1_ Manufacturing Knowledge Hub" folder.
CASE_ROOT = Path(os.environ.get(
    "CASCADE_DATA",
    "/tmp/claude-0/-home-claude/87223855-0a75-5709-b12f-32624d036336/"
    "scratchpad/case1/Case 1_ Manufacturing Knowledge Hub"))
PILOT_SETS = {
    "GA-1201A": "Set_01_GA-1201A_HEXANE_FEED_PUMP",
    "EA-5601": "Set_05_EA-5601_SOLVENT_HEATER",
}
OUT = Path(__file__).resolve().parents[1] / "out"

BOILERPLATE = re.compile(
    r"this is sample data provided for\s*(caliber purposes( only)?)?", re.I
)

# Section headers seen in the OPL template + datasheet + interlock sheets.
SECTION_PAT = re.compile(
    r"^\s*(\d{1,2})\s*[.)]\s+([A-Z][A-Z /&\-,()']{3,60})\s*$"
)
CAPS_SECTION_PAT = re.compile(r"^\s*([A-Z][A-Z /&\-,()'0-9]{6,60})\s*$")


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------
@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    doc_type: str
    asset_tag: str
    page: int
    section: str
    text: str
    char_start: int
    char_end: int


@dataclass
class Document:
    doc_id: str
    doc_type: str
    asset_tag: str
    title: str
    source_path: str
    doc_number: str = ""
    revision: str = ""
    n_pages: int = 0
    full_text: str = ""
    tables: list = field(default_factory=list)
    chunks: list = field(default_factory=list)
    extraction_notes: list = field(default_factory=list)


# --------------------------------------------------------------------------
# Reading-order repair
# --------------------------------------------------------------------------
def page_lines(page, y_tol: float = 2.2) -> list[str]:
    """Rebuild lines from word geometry instead of trusting the text layer.

    pdfplumber gives every word an (x0, top). We cluster words into lines by
    `top` within y_tol, then sort each line left-to-right. This is what fixes
    the interleaved OPL safety bullets.
    """
    words = page.extract_words(
        use_text_flow=False,
        keep_blank_chars=False,
        extra_attrs=["size"],
    )
    if not words:
        return []

    words.sort(key=lambda w: (round(w["top"], 1), w["x0"]))
    lines: list[list[dict]] = []
    current: list[dict] = [words[0]]

    for w in words[1:]:
        if abs(w["top"] - current[-1]["top"]) <= y_tol:
            current.append(w)
        else:
            lines.append(current)
            current = [w]
    lines.append(current)

    out = []
    for ln in lines:
        ln.sort(key=lambda w: w["x0"])
        # Insert a wide gap marker so table columns stay visually separated,
        # which the failure-mode parser relies on.
        parts = []
        prev_x1 = None
        for w in ln:
            if prev_x1 is not None and (w["x0"] - prev_x1) > 14:
                parts.append("   ")
            parts.append(w["text"])
            prev_x1 = w["x1"]
        out.append(" ".join(parts).replace("   ", "   "))
    return out


def clean(line: str) -> str:
    line = BOILERPLATE.sub("", line)
    line = re.sub(r"[ \t]{2,}", "   ", line)
    return line.rstrip()


# --------------------------------------------------------------------------
# Classification + metadata
# --------------------------------------------------------------------------
def classify(path: Path) -> str:
    n = path.name.lower()
    if n.startswith("opl") or "one point lesson" in str(path.parent).lower():
        return "OPL"
    if "datasheet" in n:
        return "DATASHEET"
    if "interlock" in n:
        return "INTERLOCK"
    if "ga drawing" in n:
        return "GA_DRAWING"
    if "plot plan" in n:
        return "PLOT_PLAN"
    if n.endswith(".png"):
        return "PID"
    return "OTHER"


def scrape_meta(text: str) -> tuple[str, str]:
    doc_no = ""
    rev = ""
    m = re.search(r"DOC\s*NO:?\s*([A-Z0-9\-]+)", text, re.I)
    if m:
        doc_no = m.group(1)
    m = re.search(r"OPL\s*No:?\s*([A-Z0-9\-]+)", text, re.I)
    if m:
        doc_no = m.group(1)
    m = re.search(r"\bREV(?:ISION)?\s*:?\s*(\d+)", text, re.I)
    if m:
        rev = m.group(1)
    return doc_no, rev


def split_sections(lines: list[str]) -> list[tuple[str, list[str]]]:
    sections: list[tuple[str, list[str]]] = []
    current_name = "HEADER"
    buf: list[str] = []
    for ln in lines:
        s = ln.strip()
        m = SECTION_PAT.match(s)
        if not m and len(s) > 6:
            m2 = CAPS_SECTION_PAT.match(s)
            if m2 and sum(c.isalpha() for c in s) > 5 and len(s.split()) <= 7:
                m = None
                sections.append((current_name, buf))
                current_name = m2.group(1).strip()
                buf = []
                continue
        if m:
            sections.append((current_name, buf))
            current_name = f"{m.group(1)}. {m.group(2).strip()}"
            buf = []
            continue
        buf.append(ln)
    sections.append((current_name, buf))
    return [(n, b) for n, b in sections if any(x.strip() for x in b)]


# --------------------------------------------------------------------------
# Main extraction
# --------------------------------------------------------------------------
def extract_pdf(path: Path, asset_tag: str) -> Document:
    doc_type = classify(path)
    doc_id = path.stem
    doc = Document(
        doc_id=doc_id,
        doc_type=doc_type,
        asset_tag=asset_tag,
        title=path.stem,
        source_path=str(path),
    )

    all_lines: list[tuple[int, str]] = []
    with pdfplumber.open(path) as pdf:
        doc.n_pages = len(pdf.pages)
        for pno, page in enumerate(pdf.pages, start=1):
            raw = page.extract_text() or ""
            repaired = [clean(x) for x in page_lines(page)]
            repaired = [x for x in repaired if x.strip()]

            # Evidence that the native text layer was out of order.
            if raw:
                native = [clean(x) for x in raw.split("\n") if x.strip()]
                if native and native != repaired:
                    diff = sum(1 for a, b in zip(native, repaired) if a != b)
                    if diff > len(repaired) * 0.15:
                        doc.extraction_notes.append(
                            f"p{pno}: reading order repaired "
                            f"({diff}/{len(repaired)} lines reordered)"
                        )

            for ln in repaired:
                all_lines.append((pno, ln))

            for tbl in page.extract_tables() or []:
                rows = [
                    [(c or "").strip().replace("\n", " ") for c in row]
                    for row in tbl
                ]
                rows = [r for r in rows if any(r)]
                if len(rows) >= 2:
                    doc.tables.append({"page": pno, "rows": rows})

    doc.full_text = "\n".join(ln for _, ln in all_lines)
    doc.doc_number, doc.revision = scrape_meta(doc.full_text)

    # Chunk by section, carrying the page of the section's first line.
    cursor = 0
    page_of_line = {i: p for i, (p, _) in enumerate(all_lines)}
    lines_only = [ln for _, ln in all_lines]
    idx = 0
    for sec_name, buf in split_sections(lines_only):
        if not buf:
            continue
        try:
            idx = lines_only.index(buf[0], idx)
        except ValueError:
            pass
        page = page_of_line.get(idx, 1)
        text = "\n".join(buf).strip()
        start = doc.full_text.find(buf[0], cursor)
        if start < 0:
            start = cursor
        end = start + len(text)
        cursor = max(cursor, start)
        doc.chunks.append(
            Chunk(
                chunk_id=f"{doc_id}::p{page}::{len(doc.chunks):02d}",
                doc_id=doc_id,
                doc_type=doc_type,
                asset_tag=asset_tag,
                page=page,
                section=sec_name,
                text=text,
                char_start=start,
                char_end=end,
            )
        )
    return doc


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    docs: list[Document] = []

    for tag, folder in PILOT_SETS.items():
        base = CASE_ROOT / folder
        if not base.exists():
            print(f"!! missing set folder: {base}", file=sys.stderr)
            continue
        for path in sorted(base.rglob("*.pdf")):
            try:
                docs.append(extract_pdf(path, tag))
            except Exception as exc:  # keep going; report at the end
                print(f"!! {path.name}: {exc}", file=sys.stderr)
        for png in sorted(base.rglob("*.png")):
            docs.append(
                Document(
                    doc_id=png.stem,
                    doc_type="PID",
                    asset_tag=tag,
                    title=png.stem,
                    source_path=str(png),
                    extraction_notes=[
                        "raster P&ID — no text layer; tag extraction deferred "
                        "to vision pass (see roadmap)"
                    ],
                )
            )

    payload = [asdict(d) for d in docs]
    for d in payload:
        d["chunks"] = [c if isinstance(c, dict) else asdict(c) for c in d["chunks"]]

    (OUT / "documents.json").write_text(
        json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    by_type: dict[str, int] = {}
    n_chunks = 0
    n_repaired = 0
    for d in docs:
        by_type[d.doc_type] = by_type.get(d.doc_type, 0) + 1
        n_chunks += len(d.chunks)
        n_repaired += len(d.extraction_notes)

    print(f"documents : {len(docs)}")
    print(f"by type   : {by_type}")
    print(f"chunks    : {n_chunks}")
    print(f"docs with repaired reading order: "
          f"{sum(1 for d in docs if d.extraction_notes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
