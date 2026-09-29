"""
CASCADE — Trusted Q&A engine

    question -> resolve asset -> classify intent + safety gate
             -> retrieve (hybrid, asset-filtered)
             -> compose from STRUCTURED objects (never free generation)
             -> verbatim gate + grounding gate
             -> confidence (computed, capped, explained)
             -> answer | clarify | abstain | refuse-and-escalate

Composition rule: every sentence shown is either
  (a) a verbatim cell from an approved document, or
  (b) a template sentence whose facts are all present in the evidence it
      cites (or are CASCADE arithmetic over that evidence, declared as such).
An optional LLM may add a short summary; it passes the same grounding gate.

Run:  python3 src/qa.py "GA-1201A tripped on high vibration, can I restart?"
"""
from __future__ import annotations

import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_index import load_retriever  # noqa: E402
from verify import check_grounding, check_verbatim, ws  # noqa: E402
from llm import available as llm_available, summarize  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "out"
PILOT = ("GA-1201A", "EA-5601")

# ---------------------------------------------------------------- config ---
# Safety taxonomy is configuration owned by HSE, not model behaviour.
SAFETY_TAXONOMY = {
    "trip / shutdown": r"\btrip\w*|\bshut ?down|\besd\b|\bmati mendadak",
    "restart / reset": r"\bre-?start|\breset\b|\bstart[- ]?up|\bstartup|\bnyalakan",
    "loss of containment": r"\bleak\w*|\bbocor|\brembes|\bspill",
    "isolation / LOTO": r"\bisolat\w*|\bloto\b|\block ?out",
    "overpressure / relief": r"\bover ?pressure|\bpsv\b|\brelief|\bcar[- ]seal",
    "interlock bypass": r"\bbypass|\bby-pass|\bdefeat|\boverride|\bjumper|\binhibit",
    "hot work / permit": r"\bhot work|\bpermit",
}
DEVIATION = re.compile(r"\b(bypass|by-pass|defeat|override|jumper(ed)?( out)?|jump out|inhibit|"
                       r"disable|force(d)? (the )?(interlock|trip)|matikan interlock|"
                       r"put \w+ in bypass|mask (the )?(trip|alarm))\b", re.I)
# Changing a protective setting is a deviation too (held-out #3): it needs MOC.
SETPOINT_CHANGE = re.compile(
    r"\b(raise|increase|lower|decrease|change|adjust|move|widen|reset the setting|naikkan|turunkan|ubah)\b"
    r"[^.?!]{0,40}\b(trip|set ?point|setting|alarm( limit)?|set pressure)\b"
    r"(?=[^.?!]*(\bto \d|\bhigher\b|\blower\b|\bup\b|\bdown\b|so (it|we)|nuisance|\bmore\b|\bless\b))", re.I)
PROTECTION_REMOVAL = re.compile(
    r"\b(remove|break|cut|lepas\w*|open)\b[^.?!]{0,25}\bcar[- ]?seal|"
    r"\bblock[- ]?in\b[^.?!]{0,25}\b(psv|relief)|\bisolate\b[^.?!]{0,25}\b(psv|relief valve)", re.I)
NEGATED = re.compile(r"\b(won'?t|will not|do not|don'?t|never|not going to|tidak|tanpa)\s+(\w+\s+){0,2}$", re.I)
# Asking CASCADE to judge a live condition. It never does.
JUDGEMENT_CUE = re.compile(r"\b(is it safe|safe to|still safe|ok to (run|continue|keep)|"
                           r"can i keep (it )?running|keep running|aman( tidak)?|masih aman|boleh jalan)\b", re.I)
# History / cost questions belong to work orders, never to the datasheet.
HISTORY_CUE = re.compile(r"\b(cost|biaya|how much did|downtime|how long was|when did|what happened|"
                         r"last time|history|riwayat|kapan)\b", re.I)
PARAM_CUE = re.compile(r"\b(what is|what's|berapa|set ?point|setting|set pressure|value|rated|design|"
                       r"spec\w*|material|limit|alarm at|trip at|capacity|nilai|how many|how much|"
                       r"number of|what oil|which oil|goes in|"
                       r"what (type|kind|model)|which (type|model|seal|bearing|oil)|"
                       r"what \w+( \w+)? (does|do) .* (use|have|run))\b", re.I)
ACTION_CUE = re.compile(r"\b(can i|should i|restart|re-?start|reset|what (do|should) i do|"
                        r"boleh|bisa)\b", re.I)
TRIP_CUE = re.compile(r"\b(trip\w*|shut ?down|restart|re-?start|reset|interlock|permissive|esd)\b", re.I)
RECUR_CUE = re.compile(r"(\bkeeps?\s+\w+ing\b|\brecurr\w*|\brepeat\w*|\bagain\b|\bhistory\b|"
                       r"\broot cause\b|\bchain\b|\bsering\b|\bberulang|\bterus\s+rusak|"
                       r"\bwhy does .* fail|\bfailure pattern)", re.I)
PROC_CUE = re.compile(r"\b(steps?|procedure|how (do|to|should|can)|what should i do|"
                      r"langkah|prosedur|cara|bagaimana|checklist)\b", re.I)
SYMPTOM_CUE = re.compile(r"\b(leak\w*|bocor|noise|noisy|vibrat\w*|getaran|hot|overheat\w*|"
                         r"hunting|erratic|crack\w*|water (found )?in|panas|rising temperature|"
                         r"low (outlet )?temperature|knocking|hammer|drip\w*)\b", re.I)
WHY_CUE = re.compile(r"\b(why|kenapa|mengapa|what causes|what caused|penyebab)\b", re.I)

ALIASES = {
    "GA-1201A": [r"hexane (feed )?pump", r"\bfeed pump\b", r"pompa (umpan )?hexane",
                 r"\bga-?1201b\b", r"\bpump\b", r"\bpompa\b"],
    "EA-5601": [r"solvent heater", r"\bheat exchanger\b", r"\bexchanger\b",
                r"\bheater\b", r"pemanas"],
}
OUT_OF_PILOT_HINT = {
    "YD-2301": r"\bdryer\b|fluid bed", "DC-3401A": r"\breactor\b",
    "KC-4501": r"\bcompressor\b|kompresor", "LV-6701": r"level control valve",
    "CT-7801": r"cooling tower", "FA-8901": r"reflux|accumulator|\bdrum\b",
}
TAG_RE = re.compile(r"\b([A-Z]{2,5})[-\s]?(\d{3,4}[A-Z]?)\b", re.I)

# Initiator keywords -> interlock cause tags (per asset; from the C&E matrix).
INITIATOR_HINTS = [
    (r"vibrat|getaran|vshh", "VSHH"), (r"low[- ]?flow|min(imum)?[- ]?flow|fsll|deadhead", "FSLL"),
    (r"suction|psll|npsh", "PSLL"), (r"bearing temp|tshh|bearing (is )?hot", "TSHH"),
    (r"overload|electrical|mpr|motor fault", "MPR"), (r"emergency stop|e-?stop|hs-", "HS"),
    (r"foul|dp\b|pdah|differential", "PDAH"), (r"relief|psv|overpressure", "PSV"),
    (r"outlet temp|tic-|temperature control", "TIC"),
]
# Which OPL governs the recovery after a given initiator (title keywords).
INITIATOR_OPL = {"VSHH": "vibration", "FSLL": "minimum flow", "PSLL": "priming",
                 "TSHH": "bearing", "MPR": "start-up", "HS": "start-up",
                 "PDAH": "fouling", "PSV": "psv", "TIC": "thermal"}


def sp(c: dict) -> str:
    """Display a C&E set-point cell without doubling words ('set point set 16 barg')."""
    v = c["setpoint"]
    return v if re.match(r"(set|sp)\b", v, re.I) else f"set point {v}"


# ---------------------------------------------------------------- model ---
@dataclass
class Evidence:
    eid: str
    kind: str
    label: str
    doc: str
    locator: str
    meta: dict
    ground_text: str           # what grounding checks against
    quote: str = ""
    source_path: str = ""


@dataclass
class Item:
    text: str
    evidence: list[str]
    verbatim: bool = False
    check: str = ""             # for verbatim steps: the acceptance column
    derived: dict = field(default_factory=dict)
    verification: dict = field(default_factory=dict)


@dataclass
class Section:
    kind: str
    title: str
    items: list[Item] = field(default_factory=list)
    note: str = ""


# ---------------------------------------------------------------- engine ---
class Engine:
    def __init__(self) -> None:
        self.K = json.loads((OUT / "knowledge.json").read_text())
        self.recs = json.loads((OUT / "failure_records.json").read_text())
        self.chains = json.loads((OUT / "chains_enriched.json").read_text())
        docs = json.loads((OUT / "documents.json").read_text())
        text_by_id = {d["doc_id"]: d["full_text"] for d in docs}
        self.opl = {o["opl_no"]: o for o in self.K["opl"]}
        self.il = {i["asset_tag"]: i for i in self.K["interlock"]}
        self.ds = {d["asset_tag"]: d for d in self.K["datasheet"]}
        # Page text keyed by the CONTROLLED document number each structured
        # object carries, resolved through its anchor to the PDF it came from.
        self.page_text = {}
        for o in self.K["opl"]:
            self.page_text[o["opl_no"]] = text_by_id.get(o["anchor"]["doc_id"], "")
        for x in self.K["interlock"] + self.K["datasheet"]:
            self.page_text[x["doc_number"]] = text_by_id.get(x["anchor"]["doc_id"], "")
        self.wo = {r["wo"]: r for r in self.recs}
        self.assets = {}
        for r in self.recs:
            self.assets.setdefault(r["tag"], {"tag": r["tag"], "name": r["equipment"],
                                              "criticality": r["criticality"]})
        self.instrument_owner = self._instrument_map()
        self.R = load_retriever()

    # ------------------------------------------------------------ helpers
    def _instrument_map(self) -> dict[str, str]:
        owner: dict[str, str] = {}
        for tag in PILOT:
            blob = " ".join([json.dumps(o) for o in self.K["opl"] if o["asset_tag"] == tag]
                            + [json.dumps(self.il.get(tag, {})), json.dumps(self.ds.get(tag, {}))])
            for pre, num in TAG_RE.findall(blob):
                owner.setdefault(f"{pre.upper()}-{num.upper()}", tag)
        return owner

    def resolve_asset(self, q: str) -> tuple[str | None, float, str]:
        """Return (tag, asset_match_score, how)."""
        for pre, num in TAG_RE.findall(q):
            t = f"{pre.upper()}-{num.upper()}"
            if t in self.assets:
                return t, 1.0, f"tag {t} named in question"
            if t == "GA-1201B":
                return "GA-1201A", 0.9, "GA-1201B is the standby of GA-1201A (same interlock SEQ-1201)"
            if t in self.instrument_owner:
                own = self.instrument_owner[t]
                return own, 0.9, f"instrument {t} belongs to {own}"
        for tag, pats in OUT_OF_PILOT_HINT.items():
            if re.search(pats, q, re.I):
                return tag, 0.8, "described equipment"
        for tag, pats in ALIASES.items():
            for p in pats:
                if re.search(p, q, re.I):
                    generic = p in (r"\bpump\b", r"\bpompa\b", r"\bheater\b", r"\bexchanger\b")
                    return tag, 0.75 if generic else 0.85, f"'{re.search(p, q, re.I).group(0)}' -> {tag}"
        return None, 0.0, "no asset identified"

    def safeguard_tags(self) -> set[str]:
        """Every instrument that initiates or IS a safeguard, from the C&E data.
        A deviation verb aimed at any of these is a deviation request, whether
        or not the operator says the word 'interlock'."""
        tags = set()
        for il in self.il.values():
            for c in il["causes"]:
                tags.add(c["tag"].upper())
            if il["logic_no"].startswith("SEQ"):
                tags.add(il["logic_no"].upper())
        return tags

    @staticmethod
    def _unnegated(pat: re.Pattern, q: str) -> bool:
        """True if the pattern occurs at least once WITHOUT a negation just
        before it ("I won't bypass anything" is not a bypass request)."""
        return any(not NEGATED.search(q[:m.start()]) for m in pat.finditer(q))

    def classify(self, q: str) -> str:
        named = {f"{p.upper()}-{n.upper()}" for p, n in TAG_RE.findall(q)}
        guarded = bool(re.search(r"interlock|trip|alarm|safety|sis|permissive|min-?flow|psv|relief", q, re.I)
                       or named & self.safeguard_tags())
        if (self._unnegated(DEVIATION, q) and guarded) or self._unnegated(PROTECTION_REMOVAL, q) \
                or (self._unnegated(SETPOINT_CHANGE, q) and guarded):
            return "DEVIATION"
        if JUDGEMENT_CUE.search(q):
            return "JUDGEMENT"
        if HISTORY_CUE.search(q):
            return "RECURRING"
        if TRIP_CUE.search(q) and PARAM_CUE.search(q) and not ACTION_CUE.search(q):
            return "PARAMETER"
        if TRIP_CUE.search(q):
            return "TRIP_RESTART"
        if RECUR_CUE.search(q):
            return "RECURRING"
        if PROC_CUE.search(q):
            return "PROCEDURE"
        if PARAM_CUE.search(q) and not SYMPTOM_CUE.search(q):
            return "PARAMETER"
        if SYMPTOM_CUE.search(q):
            return "SYMPTOM"
        # "why ..." about equipment is a troubleshooting question; the
        # symptom composer still abstains if no recorded case matches.
        if WHY_CUE.search(q):
            return "SYMPTOM"
        return "GENERAL"

    def safety_flags(self, q: str, intent: str) -> list[str]:
        flags = [name for name, pat in SAFETY_TAXONOMY.items() if re.search(pat, q, re.I)]
        if intent in ("TRIP_RESTART", "DEVIATION") and not flags:
            flags.append("trip / shutdown")
        if intent == "JUDGEMENT":
            flags.append("live-condition judgement requested")
        if intent == "DEVIATION" and (SETPOINT_CHANGE.search(q) or PROTECTION_REMOVAL.search(q)):
            flags.append("change to a protective setting / device")
        return flags

    # ------------------------------------------------------ evidence builders
    def ev_opl(self, E: list[Evidence], opl_no: str, section: str, quote: str = "") -> str:
        o = self.opl[opl_no]
        eid = f"E{len(E) + 1}"
        steps = " ".join(f"{s['n']}. {s['action']} ({s['check']})" for s in o["steps"])
        trouble = " ".join(f"{r['symptom']} {r['cause']} {r['action']}" for r in o["troubleshooting"])
        E.append(Evidence(
            eid, "OPL", f"{o['opl_no']} — {o['title']}", o["opl_no"],
            f"{section}, p1",
            {"classification": o["classification"], "date_shared": o["date_shared"],
             "approved_by": o["approved_by"], "reviewed_by": o["reviewed_by"],
             "related_interlock": o["related_interlock"], "pid_ref": o["pid_ref"]},
            f"{o['opl_no']} {o['title']} shared {o['date_shared']} {o['related_interlock']} "
            f"{o['pid_ref']} {steps} {trouble} {' '.join(o['safety'])} {' '.join(o['key_learning'])}",
            quote, o["source_path"]))
        return eid

    def ev_il(self, E: list[Evidence], tag: str, locator: str, quote: str = "") -> str:
        il = self.il[tag]
        eid = f"E{len(E) + 1}"
        rows = " ".join(f"{c['id']} {c['initiator']} {c['tag']} {c['setpoint']} {c['vote']} "
                        f"{' '.join(il['effects'].get(e, e) for e in c['effects'])}" for c in il["causes"])
        perm = " ".join(f"{p['condition']} {p['signal']}" for p in il["permissives"])
        E.append(Evidence(
            eid, "INTERLOCK", f"{il['doc_number']} Rev {il['revision']} — {il['logic_no']} ({il['sil']})",
            il["doc_number"], locator,
            {"revision": il["revision"], "logic": il["logic_no"], "sil": il["sil"]},
            f"{il['doc_number']} {il['logic_no']} {il['sil']} {il['description']} {rows} {perm} "
            f"{' '.join(il['notes'])}",
            quote, il["source_path"]))
        return eid

    def ev_ds(self, E: list[Evidence], tag: str, field_: str) -> str:
        ds = self.ds[tag]
        eid = f"E{len(E) + 1}"
        E.append(Evidence(
            eid, "DATASHEET", f"{ds['doc_number']} Rev {ds['revision']}", ds["doc_number"],
            f"field '{field_}', p1", {"revision": ds["revision"]},
            f"{tag} {ds['doc_number']} {field_} {ds['params'][field_]}",
            ds["params"][field_], ds["source_path"]))
        return eid

    def ev_wo(self, E: list[Evidence], wo: str) -> str:
        r = self.wo[wo]
        eid = f"E{len(E) + 1}"
        E.append(Evidence(
            eid, "WORK_ORDER", f"{wo} ({r['date'][:10]}, {r['work_type']})", wo,
            "Maintenance History (CMMS export)",
            {"date": r["date"][:10], "downtime_h": r["downtime_h"], "cost_idr": r["cost_idr"]},
            f"{wo} {r['tag']} {r['date'][:10]} {r['problem']} {r['root_cause']} {r['action']} "
            f"downtime {r['downtime_h']} h cost {r['cost_idr']} {r['related_interlock']}",
            r["root_cause"], ""))
        return eid

    def ev_chain(self, E: list[Evidence], ch: dict) -> str:
        eid = f"E{len(E) + 1}"
        E.append(Evidence(
            eid, "CHAIN", f"{ch['chain_id']} (CASCADE chain detector)", ch["chain_id"],
            f"{ch['n_events']} linked work orders",
            {"confidence": ch["confidence"], "links": ch["links"]},
            f"{ch['chain_id']} {ch['tag']} {ch['root_mechanism']} {' '.join(ch['wos'])} "
            + " ".join(f"{e['date'][:10]} {e['problem']} {e['root_cause']}" for e in ch["events"])
            + f" detectable {ch['detectable_on']} lesson {ch.get('first_lesson_shared_on', '')}",
            "", ""))
        return eid

    # ------------------------------------------------------------ pickers
    def best_opl(self, tag: str, query: str, prefer: str = "") -> str | None:
        hits = self.R.search(query, tag=tag, kinds=("OPL_STEPS",), k=6)
        if prefer:
            for h in hits:
                if prefer in self.opl[h["ref"]["opl_no"]]["title"].lower():
                    return h["ref"]["opl_no"]
            for o in self.opl.values():
                if o["asset_tag"] == tag and prefer in o["title"].lower():
                    return o["opl_no"]
        return hits[0]["ref"]["opl_no"] if hits else None

    def steps_section(self, E, opl_no: str, title: str) -> Section:
        o = self.opl[opl_no]
        eid = self.ev_opl(E, opl_no, "4. DETAILED PROCEDURE / STEPS")
        sec = Section("steps", title,
                      note=f"{o['opl_no']} · {o['classification']} · approved by {o['approved_by']} · "
                           f"shared {o['date_shared']} · interlock {o['related_interlock']} · "
                           f"P&ID {o['pid_ref']}")
        for s in o["steps"]:
            sec.items.append(Item(f"{s['n']}. {s['action']}", [eid], verbatim=True, check=s["check"]))
        return sec

    def safety_section(self, E, opl_no: str) -> Section:
        o = self.opl[opl_no]
        eid = self.ev_opl(E, opl_no, "2. SAFETY PRECAUTIONS")
        return Section("safety", "Safety precautions (verbatim)",
                       [Item(s, [eid], verbatim=True) for s in o["safety"]])

    def chains_for(self, tag: str) -> list[dict]:
        return sorted([c for c in self.chains if c["tag"] == tag],
                      key=lambda c: (c["n_events"], c["total_downtime_h"]), reverse=True)

    def chain_of(self, wo: str) -> dict | None:
        return next((c for c in self.chains if wo in c["wos"]), None)

    # ---------------------------------------------------------- composers
    def compose_chain(self, E, ch: dict, headline_only: bool = False) -> Section:
        cid = self.ev_chain(E, ch)
        mech = ch["root_mechanism"].lower().replace("_", " ")
        sec = Section("chain", f"{ch['chain_id']}: {ch['n_events']} linked failures — {mech}",
                      note=f"chain confidence {ch['confidence']}"
                           + (" · LOSS OF CONTAINMENT in chain" if ch["loss_of_containment"] else ""))
        wo_eids = []
        for e in ch["events"]:
            weid = self.ev_wo(E, e["wo"])
            wo_eids.append(weid)
            dt = f", {e['downtime_h']:g} h down" if e["downtime_h"] else ""
            cost = f", Rp {e['cost_idr']:,.0f}" if e.get("cost_idr") else ""
            sec.items.append(Item(f"{e['date'][:10]} · {e['wo']} · {e['problem']} — root cause: "
                                  f"{e['root_cause']}{dt}{cost}", [weid, cid]))
        if headline_only:
            return sec
        # why these are linked
        for ln in ch["links"]:
            sec.items.append(Item(f"Link {ln['frm']} → {ln['to']}: {ln['rationale']} "
                                  f"(score {ln['score']}, {ln['factors']['gap_days']} d apart).",
                                  [cid], derived={f"{ln['score']}": "link score",
                                                  f"{ln['factors']['gap_days']} d": "date difference"}))
        # was the mechanism eliminated?
        acted = [e["wo"] for e in ch["events"][:-1]]
        if len(ch["events"]) >= 3:
            sec.items.append(Item(
                f"Corrective actions on {', '.join(acted)} were each followed by a further linked failure; "
                f"the mechanism was not eliminated by {ch['events'][-1]['date'][:10]}.",
                wo_eids + [cid]))
        dt_sum = ch["total_downtime_h"]
        cost = ch["total_cost_idr"]
        sec.items.append(Item(
            f"Recorded impact across the chain: {dt_sum:g} h downtime, Rp {cost:,.0f} maintenance cost, "
            f"over {ch['span_days']} days.",
            wo_eids, derived={f"{dt_sum:g} h": "sum of Downtime_Hours", f"Rp {cost:,.0f}": "sum of Total_Cost_IDR",
                              f"{ch['span_days']} days": "last − first event"}))
        return sec

    def compose_lesson(self, E, ch: dict) -> Section | None:
        k = [h for h in ch.get("knowledge_links", []) if h.get("date_shared")]
        if not k:
            return None
        first = min(k, key=lambda h: h["date_shared"])
        oeid = self.ev_opl(E, first["opl_no"], "header / signature block")
        cid = self.ev_chain(E, ch)
        ev2 = ch["events"][1]
        w2 = self.ev_wo(E, ev2["wo"])
        lat = ch.get("lesson_latency_days")
        gain = (int(first["date_shared"][:4]) * 0)  # placeholder to keep types simple
        from datetime import date
        early = (date.fromisoformat(first["date_shared"]) - date.fromisoformat(ch["detectable_on"])).days
        sec = Section("lesson", "Lesson timeline")
        sec.items.append(Item(
            f"CASCADE could raise this chain on {ch['detectable_on']}, when its second linked work order "
            f"{ev2['wo']} was recorded.", [w2, cid]))
        sec.items.append(Item(
            f"The first OPL covering it, {first['opl_no']} ({first['classification']}), was shared on "
            f"{first['date_shared']} — {lat} days after the first event, and after "
            + ("both linked failures" if ch["events_before_lesson"] == 2 == ch["n_events"]
               else f"all {ch['events_before_lesson']} linked failures" if ch["events_before_lesson"] == ch["n_events"]
               else f"{ch['events_before_lesson']} of {ch['n_events']} linked failures")
            + " had occurred.",
            [oeid, cid], derived={f"{lat} days": "date_shared − first event date"}))
        sec.items.append(Item(
            f"Detection at the second event would have surfaced the pattern {early} days before that OPL existed.",
            [oeid, w2], derived={f"{early} days": "date_shared − detectable_on"}))
        _ = gain
        return sec

    def not_verified(self, items: list[str]) -> Section:
        return Section("not_verified", "Not verified by CASCADE — confirm in the field",
                       [Item(x, []) for x in items])

    # ------------------------------------------------------------- intents
    def a_recurring(self, q, tag, E, S):
        chains = self.chains_for(tag)
        if not chains:
            return "no_chain"
        for ch in chains:
            S.append(self.compose_chain(E, ch))
            les = self.compose_lesson(E, ch)
            if les:
                S.append(les)
        top = chains[0]
        opl_no = top["knowledge_links"][0]["opl_no"] if top.get("knowledge_links") else None
        # If the question names an instrument, the OPL that works on that
        # instrument beats the chain's generic top match.
        named = {f"{p.upper()}-{n.upper()}" for p, n in TAG_RE.findall(q)} - {tag}
        if named:
            cand = self.best_opl(tag, q)
            if cand and any(t in json.dumps(self.opl[cand]["steps"]) + self.opl[cand]["title"] for t in named):
                opl_no = cand
        if opl_no:
            S.append(self.steps_section(E, opl_no, "Current approved check (verbatim)"))
        return None

    def a_trip(self, q, tag, E, S, notv):
        il = self.il.get(tag)
        if not il:
            return "no_interlock"
        if not il["causes"] or not il["logic_no"].startswith("SEQ"):
            # No SIS trip exists. Say so from the document, then give what DOES
            # govern a restart: control/alarm/relief rows, permissives, and the
            # approved start-up OPL.
            eid = self.ev_il(E, tag, "header", il["logic_no"])
            sec = Section("cause_effect", f"{tag} has no dedicated ESD trip",
                          [Item(f"Logic: {il['logic_no']} — {il['description']}", [eid], verbatim=False)])
            for c in il["causes"]:
                ceid = self.ev_il(E, tag, f"C&E row {c['id']}")
                sec.items.append(Item(f"{c['id']} · {c['initiator']} · {c['tag']} · {c['setpoint']} · "
                                      f"{c['vote']} → {', '.join(il['effects'].get(e, e) for e in c['effects'])}",
                                      [ceid], verbatim=True))
            S.append(sec)
            if il["permissives"]:
                peid = self.ev_il(E, tag, "START PERMISSIVE (AND-gate)")
                S.append(Section("permissives", "Return to service only when ALL start permissives are true (AND gate)",
                                 [Item(f"{p['n']}. {p['condition']} — {p['signal']}", [peid], verbatim=True)
                                  for p in il["permissives"]]))
            opl_no = self.best_opl(tag, q + " start-up", "start-up")
            if opl_no:
                S.append(self.steps_section(E, opl_no, "Approved start-up check (verbatim)"))
            notv += ["What stopped the unit — no SIS trip exists, so the stop was manual or upstream",
                     "Current process values (no live historian / DCS connection in this pilot)",
                     "Status of each start permissive signal in the field"]
            return None

        # which initiator?
        cause = None
        for pre, num in TAG_RE.findall(q):
            t = f"{pre.upper()}-{num.upper()}"
            cause = next((c for c in il["causes"] if c["tag"] == t), None) or cause
        if not cause:
            for pat, prefix in INITIATOR_HINTS:
                if re.search(pat, q, re.I):
                    cause = next((c for c in il["causes"] if c["tag"].startswith(prefix)), None)
                    if cause:
                        break

        sec = Section("cause_effect", f"Interlock {il['logic_no']} ({il['sil']}) — cause & effect")
        rows = [cause] if cause else il["causes"]
        for c in rows:
            ceid = self.ev_il(E, tag, f"C&E row {c['id']}")
            sec.items.append(Item(
                f"{c['id']} · {c['initiator']} · {c['tag']} · {sp(c)} · vote {c['vote']}",
                [ceid], verbatim=True))
            for e in c["effects"]:
                sec.items.append(Item(f"   → {e}: {il['effects'].get(e, e)}", [ceid], verbatim=True))
        if not cause:
            sec.note = "Initiator not stated — all trip causes shown. Name the alarm (e.g. VSHH-1201) to narrow."
        latch = next((n for n in il["notes"] if "latched" in n.lower()), "")
        if latch:
            leid = self.ev_il(E, tag, "NOTES", latch)
            sec.items.append(Item(latch, [leid], verbatim=True))
        dummy = next((n for n in il["notes"] if "dummy" in n.lower()), "")
        if dummy:
            deid = self.ev_il(E, tag, "NOTES", dummy)
            sec.items.append(Item(f"Document caveat: {dummy}", [deid], verbatim=True))
        S.append(sec)

        peid = self.ev_il(E, tag, "START PERMISSIVE (AND-gate)")
        S.append(Section("permissives", "Restart only when ALL start permissives are true (AND gate)",
                         [Item(f"{p['n']}. {p['condition']} — {p['signal']}", [peid], verbatim=True)
                          for p in il["permissives"]]))

        prefer = INITIATOR_OPL.get(cause["tag"].split("-")[0], "") if cause else ""
        opl_no = self.best_opl(tag, q, prefer)
        if opl_no:
            S.append(self.steps_section(E, opl_no, "Approved recovery check (verbatim)"))

        # history of this same trip
        if cause:
            prior = [r for r in self.recs if r["tag"] == tag and cause["tag"] in
                     f"{r['problem']} {r['root_cause']}" and r["work_type"] == "Corrective"]
            if prior:
                hs = Section("history", f"Previous {cause['tag']} trips on {tag}")
                for r in prior:
                    weid = self.ev_wo(E, r["wo"])
                    hs.items.append(Item(f"{r['date'][:10]} · {r['wo']} · {r['problem']} — root cause: "
                                         f"{r['root_cause']}", [weid]))
                    ch = self.chain_of(r["wo"])
                    if ch:
                        ceid = self.ev_chain(E, ch)
                        hs.items.append(Item(
                            f"{r['wo']} opened chain {ch['chain_id']} "
                            f"({ch['root_mechanism'].lower()}): {ch['n_events']} linked failures followed. "
                            f"Treat a repeat trip as a possible continuation of that chain, not a new event.",
                            [weid, ceid]))
                S.append(hs)
        notv += ["Current process values (no live historian / DCS connection in this pilot)",
                 "Status of each start permissive signal in the field",
                 "That the cause of THIS trip has been found and cleared (interlock is latched)",
                 "Active permits and isolations"]
        return None

    def a_procedure(self, q, tag, E, S):
        opl_no = self.best_opl(tag, q)
        if not opl_no:
            return "no_procedure"
        S.append(self.steps_section(E, opl_no, f"{self.opl[opl_no]['title']} (verbatim)"))
        S.append(self.safety_section(E, opl_no))
        others = [h["ref"]["opl_no"] for h in self.R.search(q, tag=tag, kinds=("OPL_STEPS",), k=3)
                  if h["ref"]["opl_no"] != opl_no]
        if others:
            rel = Section("related", "Related procedures")
            for o in others[:2]:
                eid = self.ev_opl(E, o, "title")
                rel.items.append(Item(f"{o} — {self.opl[o]['title']}", [eid]))
            S.append(rel)
        return None

    def a_parameter(self, q, tag, E, S):
        found = False
        il = self.il.get(tag)
        named = {f"{p.upper()}-{n.upper()}" for p, n in TAG_RE.findall(q)}
        # A named C&E instrument ALWAYS routes to the C&E matrix: its set point
        # lives there, not in the datasheet (PSV-5607 "set 16 barg" is not the
        # same statement as the tube design pressure, even when equal).
        il_named = bool(il) and any(c["tag"] in named for c in il["causes"])
        if il and (il_named or re.search(r"trip|alarm|set ?point|setting|set pressure|interlock", q, re.I)):
            rows = []
            for pat, prefix in INITIATOR_HINTS:
                if re.search(pat, q, re.I):
                    rows += [c for c in il["causes"] if c["tag"].startswith(prefix)]
            for pre, num in TAG_RE.findall(q):
                rows += [c for c in il["causes"] if c["tag"] == f"{pre.upper()}-{num.upper()}"]
            if rows:
                sec = Section("parameter", f"Set points — {il['doc_number']} Rev {il['revision']}")
                for c in {c["id"]: c for c in rows}.values():
                    eid = self.ev_il(E, tag, f"C&E row {c['id']}")
                    sec.items.append(Item(f"{c['id']} · {c['initiator']} · {c['tag']} · {sp(c)} · "
                                          f"vote {c['vote']}", [eid], verbatim=True))
                    self._also_stated(E, sec, tag, c["tag"])
                dummy = next((n for n in il["notes"] if "dummy" in n.lower()), "")
                if dummy:
                    sec.items.append(Item(f"Document caveat: {dummy}", [self.ev_il(E, tag, "NOTES", dummy)],
                                          verbatim=True))
                S.append(sec)
                found = True
        if not found:
            fields = self.match_fields(q, tag)
            if fields:
                ds = self.ds[tag]
                sec = Section("parameter", f"Design data — {ds['doc_number']} Rev {ds['revision']}")
                for f in fields[:2]:
                    eid = self.ev_ds(E, tag, f)
                    sec.items.append(Item(f"{f}: {ds['params'][f]}", [eid], verbatim=True))
                S.append(sec)
                found = True
        return None if found else "no_parameter"

    # Query words -> datasheet field vocabulary. Verbatim guarantees a value is
    # FAITHFUL; this gate guarantees it is RELEVANT. Without it, "warranty
    # period" would retrieve some GA-1201A field and quote it perfectly.
    FIELD_SYNONYMS = {"pressure": ["p/t", "pressure"], "temperature": ["p/t", "temp"],
                      "temp": ["p/t", "temp"], "power": ["output"], "motor": ["output", "driver"],
                      "flow": ["flow"], "head": ["head"], "seal": ["seal"], "bearing": ["bearing"],
                      "material": ["material"], "speed": ["speed"], "rpm": ["speed"],
                      "tubes": ["tube"], "gasket": ["gasket"], "duty": ["duty"], "area": ["area"],
                      "lubrication": ["lubrication"], "oil": ["lubrication"], "coupling": ["coupling"],
                      "npsh": ["npsh"], "steam": ["steam"], "fouling": ["fouling"],
                      "classification": ["classification", "ex protection"], "hazardous": ["classification"],
                      "criticality": ["criticality"], "current": ["current"], "voltage": ["voltage"],
                      "many": ["no. of"], "number": ["no. of"], "count": ["no. of"],
                      "passes": ["passes"], "length": ["length"], "shaft": ["shaft"],
                      "impeller": ["impeller"], "casing": ["casing"], "baffle": ["baffle"]}
    GENERIC = {"what", "which", "the", "for", "and", "design", "rated", "value", "spec", "specs",
               "datasheet", "data", "sheet", "is", "of", "berapa", "nilai", "please", "tell", "me"}

    def match_fields(self, q: str, tag: str) -> list[str]:
        ds = self.ds.get(tag)
        if not ds:
            return []
        toks = [t for t in re.findall(r"[a-z0-9/]+", q.lower())
                if len(t) >= 3 and t not in self.GENERIC and t not in tag.lower()
                and t not in {"ga-1201a", "ea-5601", "pump", "hexane", "heater", "solvent", "feed"}]
        if not toks:
            return []
        scored = []
        for f, v in ds["params"].items():
            ftxt = f.lower()
            s = 0
            for t in toks:
                alts = self.FIELD_SYNONYMS.get(t, [t])
                if any(a in ftxt for a in alts):
                    s += 1
            if s:
                s += 0.5 * sum(1 for g in ("design", "rated") if g in q.lower() and g in ftxt)
                scored.append((s, f))
        if not scored:
            return []
        best = max(s for s, _ in scored)
        return [f for s, f in sorted(scored, reverse=True) if s == best]

    def _also_stated(self, E, sec: Section, tag: str, inst: str) -> None:
        """Corroboration: where else is this instrument's limit stated?"""
        for o in self.opl.values():
            if o["asset_tag"] != tag:
                continue
            for s in o["steps"]:
                if inst in s["action"] and re.search(r"\d", s["action"]):
                    eid = self.ev_opl(E, o["opl_no"], f"step {s['n']}")
                    sec.items.append(Item(f"   also stated in {o['opl_no']} step {s['n']}: {s['action']}",
                                          [eid], verbatim=False))

    def a_symptom(self, q, tag, E, S, notv):
        hits = self.R.search(q, tag=tag, kinds=("OPL_TROUBLE", "WO"), k=8)
        if not hits:
            return "no_symptom"
        # troubleshooting rows are copied across OPLs: de-duplicate by symptom
        seen, rows = set(), []
        for h in hits:
            if h["kind"] != "OPL_TROUBLE":
                continue
            o = self.opl[h["ref"]["opl_no"]]
            r = o["troubleshooting"][h["ref"]["row"]]
            key = ws(r["symptom"]).lower()
            if key in seen:
                continue
            seen.add(key)
            rows.append((o, r))
        if not rows:
            return "no_symptom"
        o, r = rows[0]
        copies = [x["opl_no"] for x in self.opl.values() if x["asset_tag"] == tag and
                  any(ws(t["symptom"]).lower() == ws(r["symptom"]).lower() for t in x["troubleshooting"])]
        # Cite the most topical OPL AMONG THOSE THAT CONTAIN THE ROW. Picking
        # the most topical OPL overall mis-attributes the quote — the verbatim
        # gate caught exactly that in held-out testing.
        ranked = [h["ref"]["opl_no"] for h in
                  self.R.search(f"{r['symptom']} {r['cause']}", tag=tag, kinds=("OPL_STEPS",), k=20)]
        home = next((x for x in ranked if x in copies), o["opl_no"])
        # the approved CHECK to show may come from the most topical OPL overall
        check_opl = self.best_opl(tag, f"{r['symptom']} {r['cause']}") or home
        eid = self.ev_opl(E, home, "5. COMMON PROBLEMS & TROUBLESHOOTING")
        sec = Section("troubleshooting", "Recorded case matching your description (verbatim)",
                      note=f"row appears in {len(copies)} OPL(s); cited from {home}")
        sec.items += [Item(f"Symptom: {r['symptom']}", [eid], verbatim=True),
                      Item(f"Likely cause: {r['cause']}", [eid], verbatim=True),
                      Item(f"Action taken: {r['action']}", [eid], verbatim=True)]
        # The OPL cell is often truncated in the source PDF ("...seal dr."), so
        # match the originating work order on the cell as a PREFIX.
        stem = ws(r["symptom"]).lower().rstrip(". ")
        wo = next((x for x in self.recs if x["tag"] == tag and
                   ws(x["problem"]).lower().startswith(stem[:max(20, len(stem) - 3)])), None)
        if wo:
            weid = self.ev_wo(E, wo["wo"])
            full = ws(wo["problem"]) != ws(r["symptom"])
            sec.items.append(Item(
                f"Source work order: {wo['wo']} ({wo['date'][:10]})"
                + (f" — full record: {wo['problem']}. Root cause: {wo['root_cause']}." if full else "."),
                [weid]))
        S.append(sec)
        if wo:
            ch = self.chain_of(wo["wo"])
            if ch:
                S.append(self.compose_chain(E, ch))
                les = self.compose_lesson(E, ch)
                if les:
                    S.append(les)
        S.append(self.steps_section(E, check_opl, f"Approved check — {self.opl[check_opl]['title']} (verbatim)"))
        notv += ["Whether the current condition matches the recorded case",
                 "Current process values (no live historian / DCS connection in this pilot)"]
        return None

    GUARD_TEXT = re.compile(r"defeat|bypass|override|never block|car-sealed|car seal|never isolat|"
                            r"without an authori[sz]ed", re.I)

    def a_deviation(self, q, tag, E, S):
        named = {f"{p.upper()}-{n.upper()}" for p, n in TAG_RE.findall(q)}
        sec = Section("refusal", "Deviation from an approved safeguard — CASCADE will not advise a workaround")
        cands = []   # (priority, opl_no, locator, text)
        for o in self.opl.values():
            if o["asset_tag"] != tag:
                continue
            about_named = any(t in o["title"] or t in json.dumps(o["steps"]) for t in named)
            for s in o["steps"]:
                if self.GUARD_TEXT.search(s["action"]):
                    cands.append((0 if about_named else 1, o["opl_no"], f"step {s['n']}", s["action"]))
            for s in o["safety"]:
                if re.search(r"defeat|override", s, re.I):
                    cands.append((2, o["opl_no"], "2. SAFETY PRECAUTIONS", s))
        seen = set()
        for _, opl_no, loc, text in sorted(cands):
            if ws(text) in seen or len(sec.items) >= 3:
                continue
            seen.add(ws(text))
            sec.items.append(Item(text, [self.ev_opl(E, opl_no, loc)], verbatim=True))
        S.append(sec)
        # A set-point change request: show the APPROVED value, unchanged.
        il = self.il.get(tag)
        if il and SETPOINT_CHANGE.search(q):
            rows = [c for c in il["causes"] if c["tag"] in named]
            if rows:
                cur = Section("parameter", "Approved set point — changing it requires Management of Change")
                for c in rows:
                    cur.items.append(Item(f"{c['id']} · {c['initiator']} · {c['tag']} · {sp(c)} · vote {c['vote']}",
                                          [self.ev_il(E, tag, f"C&E row {c['id']}")], verbatim=True))
                S.append(cur)
        return None

    def a_judgement(self, q, tag, E, S, notv):
        """'Is it safe to…' — show approved limits and the response procedure.
        Never a verdict: the live condition is not visible to CASCADE."""
        il = self.il.get(tag)
        cause = None
        if il:
            for pre, num in TAG_RE.findall(q):
                cause = next((c for c in il["causes"] if c["tag"] == f"{pre.upper()}-{num.upper()}"), None) or cause
            if not cause:
                for pat, prefix in INITIATOR_HINTS:
                    if re.search(pat, q, re.I):
                        cause = next((c for c in il["causes"] if c["tag"].startswith(prefix)), None)
                        if cause:
                            break
        if not cause:
            return "no_limit"
        sec = Section("parameter", f"Approved limits for {cause['tag']} — compare with your live reading")
        sec.items.append(Item(f"{cause['id']} · {cause['initiator']} · {cause['tag']} · {sp(cause)} · "
                              f"vote {cause['vote']}", [self.ev_il(E, tag, f"C&E row {cause['id']}")],
                              verbatim=True))
        self._also_stated(E, sec, tag, cause["tag"])
        S.append(sec)
        prefer = INITIATOR_OPL.get(cause["tag"].split("-")[0], "")
        opl_no = self.best_opl(tag, q, prefer)
        if opl_no:
            S.append(self.steps_section(E, opl_no, "Approved response procedure (verbatim)"))
        notv += ["Whether the current condition is safe — CASCADE never makes that judgement",
                 "Your reading's trend and rate of change (no live historian / DCS connection in this pilot)"]
        return None

    # ------------------------------------------------------------- verify
    def verify(self, E: list[Evidence], S: list[Section]) -> dict:
        emap = {e.eid: e for e in E}
        v_total = v_pass = g_total = g_pass = 0
        removed = []
        for sec in S:
            keep = []
            for it in sec.items:
                if not it.evidence:            # "not verified" list items state absence
                    keep.append(it)
                    continue
                if it.verbatim:
                    v_total += 1
                    src = self._source_cell(it, emap)
                    page = self.page_text.get(emap[it.evidence[0]].doc, "")
                    res = check_verbatim(src[0], src[1], page)
                    it.verification = {"verbatim": res}
                    if res["passed"]:
                        v_pass += 1
                        keep.append(it)
                    else:
                        removed.append({"text": it.text, "why": "verbatim mismatch", **res})
                else:
                    g_total += 1
                    res = check_grounding(it.text, [emap[e].ground_text for e in it.evidence if e in emap],
                                          it.derived)
                    it.verification = {"grounding": res}
                    if res["passed"]:
                        g_pass += 1
                        keep.append(it)
                    else:
                        removed.append({"text": it.text, "why": "unsupported facts",
                                        "unsupported": res["unsupported"]})
            sec.items = keep
        return {"verbatim": {"checked": v_total, "passed": v_pass},
                "grounding": {"checked": g_total, "passed": g_pass}, "removed": removed}

    def _source_cell(self, it: Item, emap) -> tuple[str, str]:
        """Return (quote_as_shown, source_cell) for a verbatim item."""
        text = it.text
        # strip display prefixes the composer adds around a verbatim cell
        m = re.match(r"^(\d+)\. (.*)$", text)
        if m and it.check is not None:
            core = m.group(2)
            e = emap[it.evidence[0]]
            if e.kind == "OPL":
                o = self.opl[e.doc]
                step = next((s for s in o["steps"] if s["n"] == int(m.group(1))), None)
                if step and ws(step["action"]) == ws(core):
                    return core, step["action"]
                if e.kind == "OPL":
                    pass
            if e.kind == "INTERLOCK":
                il = self.il[next(t for t, x in self.il.items() if x["doc_number"] == e.doc)]
                p = next((p for p in il["permissives"] if p["n"] == int(m.group(1))), None)
                if p:
                    shown = f"{p['condition']} — {p['signal']}"
                    return (p["condition"] + " " + p["signal"],
                            p["condition"] + " " + p["signal"]) if ws(shown) == ws(core) else (core, "")
        e = emap[it.evidence[0]]
        for prefix in ("Symptom: ", "Likely cause: ", "Action taken: ", "Document caveat: "):
            if text.startswith(prefix):
                core = text[len(prefix):]
                return core, core if ws(core).lower() in ws(e.ground_text).lower() else ""
        if e.kind == "INTERLOCK":
            core = re.sub(r"^\s*→\s*EFF-\d+:\s*", "", text)
            cells = re.split(r"\s·\s|\s→\s", core)
            cells = [re.sub(r"^(set point|vote)\s+", "", c.strip()) for c in cells if c.strip()]
            joined = " ".join(cells)
            ok = all(ws(c).lower() in ws(e.ground_text).lower() for c in cells)
            return joined, joined if ok else ""
        if e.kind == "DATASHEET":
            k, _, v = text.partition(": ")
            return v, e.quote
        return text, text if ws(text).lower() in ws(e.ground_text).lower() else ""

    # ---------------------------------------------------------- confidence
    def confidence(self, E: list[Evidence], ver: dict, asset_match: float, intent: str,
                   safety: list[str], retrieval_top: list[dict]) -> dict:
        auth = {"OPL": 1.0, "INTERLOCK": 1.0, "DATASHEET": 1.0, "WORK_ORDER": 0.7, "CHAIN": 0.6}
        used = [e for e in E]
        a = sum(auth[e.kind] for e in used) / len(used) if used else 0
        claims = ver["verbatim"]["checked"] + ver["grounding"]["checked"]
        ok = ver["verbatim"]["passed"] + ver["grounding"]["passed"]
        cov = ok / claims if claims else 0
        kinds = {e.kind for e in used}
        corr = min(len(kinds) / 3, 1.0)
        # Did we find the evidence TYPES this kind of question needs?
        need = {"TRIP_RESTART": {"INTERLOCK", "OPL"}, "RECURRING": {"CHAIN", "WORK_ORDER", "OPL"},
                "PROCEDURE": {"OPL"}, "PARAMETER": {"DATASHEET", "INTERLOCK"},
                "SYMPTOM": {"OPL", "WORK_ORDER"}, "DEVIATION": {"OPL"}}.get(intent, set())
        if intent == "PARAMETER":
            fit = 1.0 if kinds & need else 0.0
        else:
            fit = len(kinds & need) / len(need) if need else 0.5
        factors = [
            {"name": "Source authority", "weight": 0.30, "value": round(a, 2),
             "note": "controlled documents 1.0 · work orders 0.7 · derived chains 0.6"},
            {"name": "Asset match", "weight": 0.25, "value": asset_match,
             "note": "1.0 tag named · 0.9 via instrument tag · <0.9 via description"},
            {"name": "Evidence coverage", "weight": 0.25, "value": round(cov, 2),
             "note": "claims passing verbatim/grounding gates"},
            {"name": "Corroboration", "weight": 0.10, "value": round(corr, 2),
             "note": f"independent source types: {', '.join(sorted(kinds)) or '-'}"},
            {"name": "Intent coverage", "weight": 0.10, "value": round(fit, 2),
             "note": f"evidence types this question needs: {', '.join(sorted(need)) or '-'}"},
        ]
        score = round(100 * sum(f["weight"] * f["value"] for f in factors))
        caps = []
        # Only answers that depend on the CURRENT plant condition are capped for
        # missing live data. A set point or a refusal does not change with it.
        if intent in ("TRIP_RESTART", "SYMPTOM", "JUDGEMENT"):
            if score > 75:
                caps.append("Capped at 75: no live process data in this pilot (read-only historian not connected)")
                score = 75
        if ver["removed"]:
            caps.append(f"{len(ver['removed'])} statement(s) removed by verification")
            score = min(score, 70)
        if asset_match < 0.8:
            caps.append("Asset inferred from a generic description — confirm the tag")
            score = min(score, 65)
        if intent == "GENERAL":
            caps.append("No direct answer: closest sources only, no recommendation")
            score = min(score, 55)
        band = "High" if score >= 80 else "Medium" if score >= 60 else "Low"
        return {"score": score, "band": band, "factors": factors, "caps": caps}

    # ----------------------------------------------------------------- ask
    def ask(self, q: str, model_fn=None) -> dict:
        t0 = time.time()
        tag, amatch, how = self.resolve_asset(q)
        intent = self.classify(q)
        safety = self.safety_flags(q, intent)
        E: list[Evidence] = []
        S: list[Section] = []
        notv: list[str] = []
        base = {"query": q, "intent": intent, "safety_critical": bool(safety),
                "safety_flags": safety, "asset_resolution": how}

        if tag is None:
            return {**base, "status": "needs_clarification", "asset": None,
                    "headline": "Which equipment? Name the tag (e.g. GA-1201A) or the unit.",
                    "sections": [], "evidence": [], "latency_ms": int((time.time() - t0) * 1000),
                    "indexed_assets": [self.assets[t] for t in PILOT]}
        asset = self.assets.get(tag, {"tag": tag})
        if tag not in PILOT:
            n = sum(1 for r in self.recs if r["tag"] == tag)
            return {**base, "status": "abstained", "asset": asset,
                    "headline": f"{tag} is outside the pilot scope — no approved documents indexed for it.",
                    "reason": f"Pilot covers {', '.join(PILOT)}. {n} work orders exist for {tag} and "
                              f"become answerable when its document set is ingested.",
                    "sections": [], "evidence": [], "latency_ms": int((time.time() - t0) * 1000)}

        handler = {"RECURRING": lambda: self.a_recurring(q, tag, E, S),
                   "TRIP_RESTART": lambda: self.a_trip(q, tag, E, S, notv),
                   "PROCEDURE": lambda: self.a_procedure(q, tag, E, S),
                   "PARAMETER": lambda: self.a_parameter(q, tag, E, S),
                   "SYMPTOM": lambda: self.a_symptom(q, tag, E, S, notv),
                   "DEVIATION": lambda: self.a_deviation(q, tag, E, S),
                   "JUDGEMENT": lambda: self.a_judgement(q, tag, E, S, notv)}.get(intent)
        miss = handler() if handler else "general"

        retrieval_top = self.R.search(q, tag=tag, k=5)
        if miss:
            # sources only, no recommendation — the PRD's low-confidence path
            # A source is only "close" if it shares MOST of the question's
            # content words — one incidental hit ("match" in "Parts match BOM")
            # is not relevance.
            stop = {"what", "which", "does", "have", "about", "there", "with", "that", "this",
                    "from", "when", "kenapa", "apakah", "bagaimana", "yesterday", "today", "please",
                    "team", "would", "could", "should", "their", "they", "your"}
            content = [t for t in re.findall(r"[a-z]{4,}", q.lower())
                       if t not in stop and t not in tag.lower()]
            def share(h):
                return (sum(1 for c in content if c in h["text"].lower()) / len(content)) if content else 0
            relevant = [h for h in retrieval_top if h["bm25"] > 2.0 and share(h) >= 0.6]
            if not relevant:
                return {**base, "status": "abstained", "asset": asset,
                        "headline": "No approved source answers this. CASCADE will not guess.",
                        "reason": f"no evidence above threshold for intent {intent}",
                        "escalation": ({"role": "Shift supervisor",
                                        "why": f"safety-critical question without an approved source: "
                                               f"{', '.join(safety)}"} if safety else
                                       {"role": "Process / reliability engineer for the unit",
                                        "why": "question outside indexed knowledge"}),
                        "sections": [], "evidence": [], "latency_ms": int((time.time() - t0) * 1000)}
            sec = Section("sources", "Closest sources (no recommendation made)")
            for h in relevant[:3]:
                if h["kind"] == "WO":
                    eid = self.ev_wo(E, h["ref"]["wo"])
                elif h["kind"].startswith("OPL"):
                    eid = self.ev_opl(E, h["ref"]["opl_no"], h["anchor"].get("section", ""))
                elif h["kind"] == "DS_PARAM":
                    eid = self.ev_ds(E, tag, h["ref"]["field"])
                elif h["kind"] == "CHAIN":
                    eid = self.ev_chain(E, next(c for c in self.chains if c["chain_id"] == h["ref"]["chain_id"]))
                else:
                    eid = self.ev_il(E, tag, h["anchor"].get("row", ""))
                sec.items.append(Item(ws(h["text"])[:220], [eid]))
            S.append(sec)
            status = "sources_only"
        else:
            status = "refused_deviation" if intent == "DEVIATION" else "answered"

        if notv:
            S.append(self.not_verified(notv))
        ver = self.verify(E, S)
        conf = self.confidence(E, ver, amatch, intent, safety, retrieval_top)

        # safety gate: a safety-critical answer with any removed statement is withdrawn
        if safety and ver["removed"]:
            status = "abstained"
        if safety and conf["band"] == "Low":
            status = "abstained"

        escalation = None
        if intent == "DEVIATION":
            escalation = {"role": "Shift supervisor + process engineer; MOC / authorised override permit",
                          "why": "any defeat of an interlock, change to a protective set point, or removal of "
                                 "a protective device requires Management of Change or an approved override permit"}
        elif intent == "JUDGEMENT":
            escalation = {"role": "Shift supervisor decides; reliability engineer for trend assessment",
                          "why": "a live-condition safety judgement is never made by CASCADE"}
        elif status == "abstained" and safety:
            escalation = {"role": "Shift supervisor", "why": f"safety-critical question without an approved "
                                                            f"source: {', '.join(safety)}"}
        elif safety:
            escalation = {"role": "Shift supervisor (acknowledgement before acting)",
                          "why": f"safety-critical: {', '.join(safety)}"}
        if intent == "TRIP_RESTART" and re.search(r"vibrat|vshh|getaran", q, re.I):
            escalation["role"] += "; reliability engineer if the 1x running-speed component dominates (OPL-GA-1201A-07 step 5)"

        headline = self.headline(intent, tag, S, status)
        used = {e for s in S for it in s.items for e in it.evidence}
        result = {
            **base, "status": status, "asset": asset, "headline": headline,
            "sections": [{"kind": s.kind, "title": s.title, "note": s.note,
                          "items": [{"text": it.text, "evidence": it.evidence, "verbatim": it.verbatim,
                                     "check": it.check if it.verbatim and it.check else "",
                                     "derived": it.derived}
                                    for it in s.items]}
                         for s in S if s.items],
            "evidence": [{"eid": e.eid, "kind": e.kind, "label": e.label, "doc": e.doc,
                          "locator": e.locator, "meta": e.meta, "quote": e.quote,
                          "source_path": Path(e.source_path).name if e.source_path else ""}
                         for e in E if e.eid in used],
            "confidence": conf, "verification": ver, "escalation": escalation,
            "retrieval": {"mode": self.R.mode,
                          "top": [{"pid": h["pid"], "kind": h["kind"], "score": h["score"]} for h in retrieval_top]},
        }
        # Optional LLM summary over the VERIFIED answer; dropped unless every
        # sentence passes citation, grounding and action gates.
        if status == "answered" and (model_fn or llm_available()):
            result["summary"] = summarize(result, {e.eid: e.ground_text for e in E if e.eid in used},
                                          model_fn=model_fn)
        result["latency_ms"] = int((time.time() - t0) * 1000)
        return result

    def headline(self, intent: str, tag: str, S: list[Section], status: str) -> str:
        if status == "abstained":
            return "Withheld: a safety-critical statement failed verification. Escalate."
        if status == "sources_only":
            return f"No direct answer for {tag}; closest approved sources listed, no recommendation made."
        chains = [s for s in S if s.kind == "chain"]
        if intent == "RECURRING" and chains:
            return (f"{tag} has {len(chains)} open failure chain(s); the largest is "
                    f"{chains[0].title.split(': ', 1)[1]}.")
        if intent == "TRIP_RESTART":
            return (f"Do not restart {tag} until the trip cause is cleared and every start permissive is true. "
                    f"Steps below are verbatim from approved documents.")
        if intent == "SYMPTOM":
            return (f"This matches a recorded case on {tag}" +
                    (" that belongs to a recurring failure chain." if chains else "."))
        if intent == "PROCEDURE":
            st = next((s for s in S if s.kind == "steps"), None)
            return f"Approved procedure for {tag}: {st.title if st else ''}"
        if intent == "PARAMETER":
            return f"Values below are quoted from the controlled documents for {tag}."
        if intent == "DEVIATION":
            if any(s.kind == "parameter" for s in S):
                return ("Refused: changing a trip set point requires Management of Change. "
                        "The approved value is shown unchanged; escalation below.")
            return "Refused: CASCADE never advises defeating, bypassing or removing a safeguard. Escalation below."
        if intent == "JUDGEMENT":
            return ("CASCADE does not judge whether a live condition is safe. Approved limits and the "
                    "response procedure are below; the shift supervisor decides.")
        return tag


# ------------------------------------------------------------------- CLI ---
def render(a: dict) -> str:
    L = []
    tag = a["asset"]["tag"] if a.get("asset") else "?"
    L.append(f"\nQ: {a['query']}")
    L.append(f"   asset={tag} ({a['asset_resolution']}) | intent={a['intent']} | "
             f"safety={'YES ' + str(a['safety_flags']) if a['safety_critical'] else 'no'} | "
             f"status={a['status'].upper()} | {a['latency_ms']} ms")
    L.append(f"\n>> {a['headline']}")
    if a.get("reason"):
        L.append(f"   reason: {a['reason']}")
    for s in a.get("sections", []):
        L.append(f"\n  [{s['title']}]" + (f"  — {s['note']}" if s["note"] else ""))
        for it in s["items"]:
            tagv = " ✓verbatim" if it["verbatim"] else ""
            chk = f"  | check: {it['check']}" if it["check"] else ""
            ev = f"  [{', '.join(it['evidence'])}]" if it["evidence"] else ""
            L.append(f"   • {it['text']}{chk}{ev}{tagv}")
    if a.get("evidence"):
        L.append("\n  Evidence:")
        for e in a["evidence"]:
            meta = ", ".join(f"{k}={v}" for k, v in e["meta"].items()
                             if k in ("classification", "date_shared", "revision", "date", "sil", "approved_by") and v)
            L.append(f"   {e['eid']:4s} {e['kind']:10s} {e['label']} · {e['locator']}" + (f" · {meta}" if meta else ""))
    if a.get("confidence"):
        c = a["confidence"]
        L.append(f"\n  Confidence: {c['band']} ({c['score']})  " +
                 " · ".join(f"{f['name']} {f['value']}" for f in c["factors"]))
        for cap in c["caps"]:
            L.append(f"   cap: {cap}")
    if a.get("verification"):
        v = a["verification"]
        L.append(f"  Verification: verbatim {v['verbatim']['passed']}/{v['verbatim']['checked']} · "
                 f"grounding {v['grounding']['passed']}/{v['grounding']['checked']} · "
                 f"removed {len(v['removed'])}")
        for r in v["removed"]:
            L.append(f"   REMOVED: {r['text'][:90]} ({r['why']})")
    if a.get("escalation"):
        L.append(f"  Escalate to: {a['escalation']['role']} — {a['escalation']['why']}")
    if a.get("summary"):
        s = a["summary"]
        L.append(f"  LLM summary: {'ACCEPTED' if s['accepted'] else 'DROPPED'}"
                 + (f" — {s['text']}" if s["accepted"] else
                    f" — {s.get('skipped') or s.get('error') or [r.get('fail') for r in s.get('sentences', [])]}"))
    return "\n".join(L)


if __name__ == "__main__":
    eng = Engine()
    qs = sys.argv[1:] or ["why does GA-1201A keep failing?"]
    for q in qs:
        print(render(eng.ask(q)))
