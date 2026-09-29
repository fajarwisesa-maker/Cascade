"""
CASCADE — Failure Record Normalisation
Turns free-text maintenance work orders into structured failure records.

Design choice that matters for the pitch: this layer is DETERMINISTIC
(lexicon + rules), not generative. A causal claim shown to an engineer must
be reproducible and auditable — the same 211 work orders always yield the
same failure modes. The LLM sits on top for language, never underneath the
causal chain.

Taxonomy is ISO 14224-flavoured: failure mode + maintainable item
(component) + failure mechanism.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict, field
from pathlib import Path

import pandas as pd

import os

CASE_ROOT = Path(os.environ.get(
    "CASCADE_DATA",
    "/tmp/claude-0/-home-claude/87223855-0a75-5709-b12f-32624d036336/"
    "scratchpad/case1/Case 1_ Manufacturing Knowledge Hub"))
XLSX = CASE_ROOT / "Maintenance History (All Equipment).xlsx"
OUT = Path(__file__).resolve().parents[1] / "out"
PILOT_TAGS = ("GA-1201A", "EA-5601")

# --------------------------------------------------------------------------
# Failure-mode lexicon: mode -> (regex terms, ISO-ish label)
# Order matters: the first match wins as the primary mode, but every match is
# retained in `modes` so a record can carry several.
# --------------------------------------------------------------------------
FAILURE_MODES: list[tuple[str, str, list[str]]] = [
    ("MISALIGNMENT", "Vibration / misalignment", [
        r"misalign", r"\balign(ment|ed)?\b", r"re-?shim", r"\bshim(med)?\b",
        r"soft foot"]),
    ("STRUCTURAL_SUPPORT", "Structural deficiency", [
        r"\bgrout", r"baseplate", r"foundation", r"hold-?down", r"anchor bolt"]),
    ("BEARING_FAILURE", "Bearing failure", [
        r"bearing", r"spalling", r"outer race", r"inner race", r"babbitt",
        r"\bthrust\b"]),
    ("COUPLING_FAILURE", "Coupling failure", [
        r"coupling", r"spacer element", r"rexnord"]),
    ("SEAL_LEAK", "Leakage — seal", [
        r"mechanical seal", r"seal gland", r"seal face", r"seal drain",
        r"seal flush", r"\bgland\b", r"api plan", r"\bt2100\b"]),
    ("TUBE_LEAK", "Leakage — tube / internal", [
        r"tube leak", r"tube-?to-?tubesheet", r"tubesheet", r"tube(s)? crack",
        r"tube(s)? leaking", r"plugg(ed|ing) tube", r"steam tube"]),
    ("GASKET_LEAK", "Leakage — gasket / flange", [
        r"gasket", r"flange leak", r"box-?up", r"\bweep(ing|age)?\b"]),
    ("FOULING", "Plugged / choked", [
        r"foul(ing|ed)?", r"\bscale\b", r"deposit", r"plugg?ed", r"blocked",
        r"restricted", r"clogg", r"coking", r"residue", r"fines"]),
    ("THERMAL_DAMAGE", "Overheating / thermal", [
        r"thermal cycl", r"thermal shock", r"thermal fatigue", r"overheat",
        r"hot ?spot", r"temperature high", r"rising temperature"]),
    ("CORROSION_EROSION", "Material deterioration", [
        r"corrosion", r"corroded", r"wall[- ]loss", r"thickness", r"pitting",
        r"erosion", r"wear ring", r"\bwear\b"]),
    ("LUBRICATION", "Lubrication failure", [
        r"lubricat", r"\blube\b", r"oil level", r"oil bath", r"greas",
        r"iso vg", r"oil supply", r"oil groove"]),
    ("INSTRUMENT_DRIFT", "Instrument / control failure", [
        r"calibrat", r"\bdrift", r"set-?point drift", r"re-?range",
        r"transmitter", r"analyz?er", r"impulse line", r"sample line"]),
    ("CONTROL_LOOP", "Control problem", [
        r"hunting", r"oscillat", r"poorly tuned", r"\btuning\b", r"loop\b"]),
    ("STEAM_TRAP", "Steam trap failure", [
        r"steam trap", r"trap element", r"condensate backup"]),
    ("SIGHT_GLASS", "Sight glass / level gauge failure", [
        r"sight ?glass", r"level gauge", r"gauge glass", r"bridle"]),
    ("VALVE_FAILURE", "Valve failure", [
        r"packing", r"actuator", r"\bstem\b", r"positioner", r"seat leak",
        r"car seal"]),
    ("ELECTRICAL", "Electrical failure", [
        r"insulation resistance", r"\bmegger", r"overload", r"\bmpr\b",
        r"termination", r"winding", r"motor fault"]),
    ("VIBRATION", "Vibration high", [
        r"vibration", r"\bvshh", r"unbalanc", r"\bbalance\b", r"mm/s"]),
    ("PROCESS_UPSET", "Abnormal process condition", [
        r"low[- ]low", r"trip(ped)?", r"deadhead", r"min-?flow", r"cavitat",
        r"surge", r"moisture", r"carry-?over"]),
]

# Mechanism terms — these are the words a LATER work order uses to point back
# at an EARLIER one. They carry most of the causal signal in this dataset.
MECHANISM_TERMS = [
    "misalignment", "vibration", "fatigue", "thermal cycling", "thermal shock",
    "fouling", "dry", "prolonged", "repeated", "settlement", "drift",
    "corrosion", "erosion", "wear", "plugged", "blocked", "restricted",
    "overheating", "cracked", "spalling", "leak",
]
BACKREF_CUES = re.compile(
    r"\b(prolonged|repeated|recurrent|again|persistent|continued|"
    r"following|after|since|residual|remaining|-?induced|secondary)\b", re.I
)

COMPONENT_PAT = [
    ("coupling", r"coupling|spacer element"),
    ("bearing_DE", r"\bde bearing\b|bearing de\b|7310|drive[- ]end"),
    ("bearing_NDE", r"\bnde bearing\b|6310|non[- ]drive"),
    ("mechanical_seal", r"mechanical seal|seal cartridge|seal face|t2100"),
    ("seal_flush", r"flush orifice|api plan|seal flush|ro-\d+"),
    ("baseplate_grout", r"grout|baseplate|foundation"),
    ("tube_bundle", r"tube|bundle|tubesheet"),
    ("motor", r"\bmotor\b|winding|insulation"),
    ("impeller", r"impeller|wear ring"),
    ("lube_system", r"oil|lube|greas"),
    ("instrument", r"transmitter|analyz?er|impulse|sample line|switch"),
    ("valve", r"\bvalve\b|packing|actuator|positioner"),
    ("fill_media", r"\bfill\b|drift eliminator|bar ?screen"),
]

# Split the taxonomy into what BROKE (damage) and what BROKE IT (mechanism).
# The chain detector links a later damage mode to an earlier record through
# the mechanism named in its root cause.
MECHANISM_MODES = {
    "MISALIGNMENT", "VIBRATION", "THERMAL_DAMAGE", "FOULING", "LUBRICATION",
    "CORROSION_EROSION", "PROCESS_UPSET", "CONTROL_LOOP",
}
DAMAGE_MODES = {
    "BEARING_FAILURE", "COUPLING_FAILURE", "SEAL_LEAK", "TUBE_LEAK",
    "GASKET_LEAK", "STRUCTURAL_SUPPORT", "VALVE_FAILURE", "ELECTRICAL",
    "INSTRUMENT_DRIFT", "STEAM_TRAP", "SIGHT_GLASS",
}

TAG_PAT = re.compile(r"\b([A-Z]{2,5}-\d{3,4}[A-Z]?)\b")
NUM_PAT = re.compile(r"(\d+(?:\.\d+)?)\s*(mm/s|barg|bar|degc|m3/h|mohm|mm)", re.I)


@dataclass
class FailureRecord:
    wo: str
    notification: str
    tag: str
    equipment: str
    date: str
    work_type: str
    discipline: str
    criticality: str
    breakdown: bool
    downtime_h: float | None
    cost_idr: float | None
    problem: str
    root_cause: str
    action: str
    related_interlock: str
    primary_mode: str
    causal_mode: str = ""
    modes: list[str] = field(default_factory=list)
    components: list[str] = field(default_factory=list)
    mechanisms: list[str] = field(default_factory=list)
    referenced_tags: list[str] = field(default_factory=list)
    measurements: list[str] = field(default_factory=list)
    has_backref_cue: bool = False
    cause_recorded: bool = True


def _blob(*parts: str) -> str:
    return " ".join(p for p in parts if p and p != "nan").lower()


def detect_modes(text: str) -> list[str]:
    hits = []
    for mode, _label, pats in FAILURE_MODES:
        if any(re.search(p, text, re.I) for p in pats):
            hits.append(mode)
    return hits


def detect_components(text: str) -> list[str]:
    return [c for c, p in COMPONENT_PAT if re.search(p, text, re.I)]


def detect_mechanisms(text: str) -> list[str]:
    return [m for m in MECHANISM_TERMS if m in text]


# PRD 6.5 "cause not recorded": routine closures that state a NEGATIVE finding.
# These are boilerplate in this corpus (~128 of 211 rows) and must never feed
# a causal chain — a proof test that passed is not a failure.
NO_CAUSE = re.compile(
    r"^(routine\b.*|no hotspot detected|no defect(s)? found|"
    r"all trips (functioned|healthy).*|trend within normal band|"
    r"loop within tolerance|within tolerance|set pressure within tolerance|"
    r"float healthy.*|no defects.*|.*insulation resistance healthy.*|"
    r"minor scale.*no distortion|no defect.*)$",
    re.I,
)


def build(row: pd.Series) -> FailureRecord:
    problem = str(row.get("Problem_Description", "") or "")
    cause = str(row.get("Root_Cause", "") or "")
    action = str(row.get("Corrective_Action", "") or "")
    blob = _blob(problem, cause, action)

    modes = detect_modes(blob)
    cause_modes = detect_modes(cause.lower()) if cause else []
    symptom_modes = detect_modes(problem.lower()) if problem else []

    # What broke: prefer a damage mode named in the problem, then in the cause.
    damage = [m for m in symptom_modes + cause_modes + modes if m in DAMAGE_MODES]
    primary = (damage or cause_modes or modes or ["UNCLASSIFIED"])[0]

    # What broke it: the mechanism named in the root cause. This is the
    # back-pointer the chain detector follows.
    mech = [m for m in cause_modes if m in MECHANISM_MODES]
    causal = mech[0] if mech else ""

    dt = row.get("Downtime_Hours")
    cost = row.get("Total_Cost_IDR")

    return FailureRecord(
        wo=str(row.get("WO_Number", "")),
        notification=str(row.get("Notification_No", "")),
        tag=str(row.get("Equipment_Tag", "")),
        equipment=str(row.get("Equipment_Name", "")),
        date=str(row.get("Report_Date", ""))[:19],
        work_type=str(row.get("Work_Type", "")),
        discipline=str(row.get("Discipline", "")),
        criticality=str(row.get("Criticality", "")),
        breakdown=str(row.get("Breakdown", "")).strip().lower() == "yes",
        downtime_h=None if pd.isna(dt) else float(dt),
        cost_idr=None if pd.isna(cost) else float(cost),
        problem=problem,
        root_cause=cause,
        action=action,
        related_interlock=str(row.get("Related_Interlock", "") or ""),
        primary_mode=primary,
        causal_mode=causal,
        modes=modes,
        components=detect_components(blob),
        mechanisms=detect_mechanisms(blob),
        referenced_tags=sorted(set(TAG_PAT.findall(f"{problem} {cause} {action}"))),
        measurements=[f"{v} {u}" for v, u in NUM_PAT.findall(f"{problem} {cause}")],
        has_backref_cue=bool(BACKREF_CUES.search(cause)),
        # "cause not recorded": a stated negative finding is never a cause.
        cause_recorded=bool(cause.strip()) and not NO_CAUSE.match(cause.strip()),
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.read_excel(XLSX)
    records = [build(r) for _, r in df.iterrows()]

    payload = [asdict(r) for r in records]
    (OUT / "failure_records.json").write_text(
        json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    total = len(records)
    classified = sum(1 for r in records if r.primary_mode != "UNCLASSIFIED")
    with_cause = sum(1 for r in records if r.cause_recorded)
    print(f"work orders          : {total}")
    print(f"classified to a mode : {classified} ({classified/total:.0%})")
    print(f"root cause recorded  : {with_cause} ({with_cause/total:.0%})")
    print(f"excluded from chaining (no recoverable cause): {total - with_cause}")

    print("\n-- pilot assets --")
    for tag in PILOT_TAGS:
        sub = [r for r in records if r.tag == tag]
        corr = [r for r in sub if r.cause_recorded]
        print(f"{tag}: {len(sub)} WO, {len(corr)} with recoverable cause")
        from collections import Counter
        c = Counter(r.primary_mode for r in corr)
        for mode, n in c.most_common(8):
            print(f"    {mode:20s} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
