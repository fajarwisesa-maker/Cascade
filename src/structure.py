"""
CASCADE — Structured knowledge objects
Turns the three controlled document types into queryable records, each field
keeping its anchor (doc number, revision, page, table).

  OPL        -> metadata, classification, date shared, verbatim steps,
                troubleshooting rows, safety precautions
  INTERLOCK  -> cause & effect matrix, effects, start permissives (AND gate)
  DATASHEET  -> key/value design parameters

Tables come from pdfplumber cells: the cell text IS the source text, which is
what the verbatim verifier later compares against.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "out"

# Tolerant: in the "EDITED" OPL layouts the year wraps onto a later line, with
# other signature-block words in between ("Friday, 03 April Technician
# (EMP-1113) (EMP-0912) 2026").
DATE_PAT = re.compile(
    r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*"
    r"(\d{1,2})\s+(January|February|March|April|May|June|July|August|"
    r"September|October|November|December)\b[\s\S]{0,160}?\b(20\d{2})\b"
)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def parse_date(text: str) -> str:
    m = DATE_PAT.search(text or "")
    if not m:
        return ""
    return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}",
                             "%d %B %Y").date().isoformat()


def find_table(doc: dict, head: str) -> dict | None:
    for t in doc["tables"]:
        if t["rows"] and head.lower() in norm(t["rows"][0][0]).lower():
            return t
    return None


def find_grid(doc: dict, first_col: str, second_col: str) -> list[list[str]]:
    """Locate a table by its column header row, wherever that row sits.

    Two OPL layouts exist: one with a section-title row above the header
    ("4. DETAILED PROCEDURE / STEPS" / "Step | Action | Check"), and the
    EDITED one-page layout where the header row comes first. Return only the
    data rows below the header in both cases."""
    for t in doc["tables"]:
        for i, row in enumerate(t["rows"][:3]):
            cells = [norm(c).lower() for c in row]
            if len(cells) >= 2 and cells[0] == first_col and second_col in cells[1]:
                return t["rows"][i + 1:]
    return []


def header_value(doc: dict, label: str) -> str:
    """OPL header is a 10-col grid; the value is the next non-empty cell."""
    for t in doc["tables"]:
        for row in t["rows"]:
            for i, cell in enumerate(row):
                if norm(cell).lower().startswith(label.lower()):
                    for v in row[i + 1:]:
                        if norm(v):
                            return norm(v)
    return ""


# --------------------------------------------------------------------------
def build_opl(doc: dict) -> dict:
    ft = doc["full_text"]
    opl_no = re.search(r"OPL-[A-Z]{2}-\d{4}[A-Z]?-\d{2}", doc["doc_id"]).group(0)

    cls = ""
    for t in doc["tables"][:1]:
        for row in t["rows"]:
            for c in row:
                if "[X]" in c:
                    cls = norm(c.replace("[X]", ""))
    if not cls:
        m = re.search(r"\[X\]\s*(Basic Knowledge|Improvement|Trouble Case)", ft)
        cls = m.group(1) if m else "Unspecified"

    # Signature block: Prepared / Reviewed / Approved / Date of Sharing
    sig = find_table(doc, "Prepared by")
    prepared = reviewed = approved = ""
    date_shared = ""
    if sig and len(sig["rows"]) > 1:
        r = sig["rows"][1] + ["", "", "", ""]
        prepared, reviewed, approved = norm(r[0]), norm(r[1]), norm(r[2])
        date_shared = parse_date(r[3])
        # a merged header row can land in the data row: reject label text
        if re.search(r"by \(|reviewed|approved", f"{reviewed} {approved}", re.I):
            reviewed = approved = ""
    if not date_shared:
        date_shared = parse_date(ft)
    # EDITED layouts: the signature grid is not detected as a table; the
    # names still carry employee ids ("Wahyu Setiadi (EMP-1113)").
    if not (reviewed and approved):
        tail = ft[ft.find("Prepared by"):] if "Prepared by" in ft else ft
        names = re.findall(r"([A-Z][a-z]+ [A-Z][a-z]+) \((EMP-\d{4})\)", tail)
        if len(names) < 2:
            # names and employee ids wrapped onto separate lines: pair by order
            skip = {"Panel Operator", "Date of", "Reviewed by", "Approved by", "Prepared by"}
            nm = [n for n in re.findall(r"\b([A-Z][a-z]+ [A-Z][a-z]+)\b", tail[:300])
                  if n not in skip and not n.startswith(("Friday", "Monday", "Tuesday", "Wednesday",
                                                         "Thursday", "Saturday", "Sunday", "Cross"))]
            ids = re.findall(r"EMP-\d{4}", tail[:300])
            names = list(zip(nm, ids))
        if len(names) >= 2:
            reviewed = reviewed or f"{names[-2][0]} ({names[-2][1]})"
            approved = approved or f"{names[-1][0]} ({names[-1][1]})"
        if not prepared and "Panel Operator" in tail:
            prepared = "Panel Operator / Technician"

    steps = []
    for row in find_grid(doc, "step", "action"):
        if row and norm(row[0]).isdigit():
            steps.append({"n": int(norm(row[0])),
                          "action": norm(row[1]),
                          "check": norm(row[2]) if len(row) > 2 else ""})

    trouble = []
    for row in find_grid(doc, "symptom", "cause"):
        if len(row) >= 3 and norm(row[0]):
            trouble.append({"symptom": norm(row[0]),
                            "cause": norm(row[1]),
                            "action": norm(row[2])})

    safety, learning, purpose = [], [], ""
    for c in doc["chunks"]:
        sec = c["section"].upper()
        lines = [l.strip() for l in c["text"].split("\n") if l.strip()]
        if "SAFETY" in sec:
            for l in lines:
                l2 = re.sub(r"^[n■●•\-]\s+", "", l)
                if l2 and not l2.lower().startswith("hazard note"):
                    safety.append(l2)
                elif l2.lower().startswith("hazard note"):
                    safety.insert(0, l2)
        elif "KEY LEARNING" in sec:
            learning += [re.sub(r"^[n■●•\-\d.)]+\s*", "", l) for l in lines]
        elif "PURPOSE" in sec:
            purpose = norm(" ".join(lines))

    step_chunk = next((c for c in doc["chunks"]
                       if "PROCEDURE" in c["section"].upper()), None)

    return {
        "kind": "OPL",
        "opl_no": opl_no,
        "asset_tag": doc["asset_tag"],
        "title": header_value(doc, "OPL Title") or opl_no,
        "discipline": header_value(doc, "Discipline"),
        "equipment": header_value(doc, "Equipment"),
        "area": header_value(doc, "Area / Unit"),
        "related_interlock": header_value(doc, "Related Interlock"),
        "pid_ref": header_value(doc, "P&ID"),
        "classification": cls,
        "prepared_by": prepared,
        "reviewed_by": reviewed,
        "approved_by": approved,
        "date_shared": date_shared,
        "purpose": purpose,
        "safety": safety,
        "steps": steps,
        "troubleshooting": trouble,
        "key_learning": [x for x in learning if x],
        "anchor": {"doc_id": doc["doc_id"], "page": 1,
                   "section": "4. DETAILED PROCEDURE / STEPS",
                   "chunk_id": step_chunk["chunk_id"] if step_chunk else ""},
        "source_path": doc["source_path"],
    }


# --------------------------------------------------------------------------
def build_interlock(doc: dict) -> dict:
    ft = doc["full_text"]
    # "SEQ-1201" on the pump; "N/A (control loop only)" on the heater, which
    # has no dedicated ESD trip — that absence is itself an answer.
    logic = re.search(r"LOGIC No:?\s*(SEQ-\d+|N/A[^\n]*?)(?:\s{2,}|DESCRIPTION)", ft)
    sil = re.search(r"\bSIL:?\s*(SIL\s*\d|N/A)", ft)
    desc = re.search(r"DESCRIPTION:?\s*(.+?)(?:\s{2,}|\s+SIL:|$)", ft, re.M)

    ce = find_table(doc, "ID")
    effects_hdr, causes = [], []
    if ce:
        hdr = [norm(h) for h in ce["rows"][0]]
        effects_hdr = [re.match(r"(EFF-\d+)", h).group(1)
                       for h in hdr if re.match(r"EFF-\d+", h)]
        eff_cols = [i for i, h in enumerate(hdr) if h.startswith("EFF-")]
        for row in ce["rows"][1:]:
            if not row or not norm(row[0]):
                continue
            fired = [hdr[i].split()[0] for i in eff_cols
                     if i < len(row) and norm(row[i]).upper() == "X"]
            causes.append({"id": norm(row[0]), "initiator": norm(row[1]),
                           "tag": norm(row[2]), "setpoint": norm(row[3]),
                           "vote": norm(row[4]), "effects": fired})

    effects = {}
    et = find_table(doc, "EFFECT ID")
    if et:
        for row in et["rows"][1:]:
            if norm(row[0]).startswith("EFF-"):
                effects[norm(row[0])] = norm(row[1])

    permissives = []
    pt = next((t for t in doc["tables"] if t["rows"]
               and "PERMISSIVE" in " ".join(t["rows"][0]).upper()), None)
    if pt:
        for row in pt["rows"][1:]:
            if norm(row[0]).isdigit():
                permissives.append({"n": int(norm(row[0])),
                                    "condition": norm(row[1]),
                                    "signal": norm(row[2])})

    notes = []
    m = re.search(r"NOTES:(.+)$", ft, re.S)
    if m:
        notes = [norm(x) for x in re.split(r"\s\d\.\s", " " + m.group(1)) if norm(x)]

    return {
        "kind": "INTERLOCK",
        "asset_tag": doc["asset_tag"],
        "doc_number": doc["doc_number"],
        "revision": doc["revision"],
        "logic_no": logic.group(1) if logic else "",
        "sil": norm(sil.group(1)) if sil else "",
        "description": norm(desc.group(1)) if desc else "",
        "causes": causes,
        "effects": effects,
        "permissives": permissives,
        "notes": notes,
        "anchor": {"doc_id": doc["doc_id"], "page": 1,
                   "section": "CAUSE & EFFECT MATRIX"},
        "source_path": doc["source_path"],
    }


# --------------------------------------------------------------------------
def build_datasheet(doc: dict) -> dict:
    params = {}
    for t in doc["tables"]:
        for row in t["rows"]:
            cells = [norm(c) for c in row]
            if len(cells) >= 4:
                pairs = [(cells[0], cells[1]), (cells[2], cells[3])]
            elif len(cells) == 2:
                pairs = [(cells[0], cells[1])]
            else:
                continue
            for k, v in pairs:
                if k and v and k.isupper() and len(k) < 40:
                    params[k] = v
    return {
        "kind": "DATASHEET",
        "asset_tag": doc["asset_tag"],
        "doc_number": re.search(r"TJC-[A-Z]+-DS-[A-Z0-9\-]+", doc["full_text"]).group(0)
        if re.search(r"TJC-[A-Z]+-DS-[A-Z0-9\-]+", doc["full_text"]) else doc["doc_number"],
        "revision": doc["revision"],
        "params": params,
        "anchor": {"doc_id": doc["doc_id"], "page": 1, "section": "DATA SHEET"},
        "source_path": doc["source_path"],
    }


def main() -> int:
    docs = json.loads((OUT / "documents.json").read_text())
    opls = [build_opl(d) for d in docs if d["doc_type"] == "OPL"]
    ils = [build_interlock(d) for d in docs if d["doc_type"] == "INTERLOCK"]
    dss = [build_datasheet(d) for d in docs if d["doc_type"] == "DATASHEET"]

    (OUT / "knowledge.json").write_text(json.dumps(
        {"opl": opls, "interlock": ils, "datasheet": dss},
        indent=1, ensure_ascii=False), encoding="utf-8")

    print(f"OPL {len(opls)} | interlock {len(ils)} | datasheet {len(dss)}\n")
    for o in sorted(opls, key=lambda x: x["opl_no"]):
        print(f"{o['opl_no']:17s} {o['classification']:16s} shared {o['date_shared'] or '??':10s} "
              f"steps={len(o['steps'])} trouble={len(o['troubleshooting'])} "
              f"safety={len(o['safety'])} | {o['title'][:48]}")
    for i in ils:
        print(f"\n{i['asset_tag']} {i['logic_no']} {i['sil']} rev{i['revision']} — {i['description'][:60]}")
        for c in i["causes"]:
            print(f"   {c['id']:3s} {c['tag']:10s} {c['setpoint']:20s} {c['vote']:7s} -> {c['effects']}")
        print(f"   permissives: {[p['signal'] for p in i['permissives']]}")
    for d in dss:
        print(f"\n{d['asset_tag']} datasheet {d['doc_number']} rev{d['revision']}: {len(d['params'])} params")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
