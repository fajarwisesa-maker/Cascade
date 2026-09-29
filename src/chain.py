"""
CASCADE — Failure Chain Detector
Links maintenance work orders across time into latent-cause chains.

The claim the product makes to an engineer is: "this is event #4 of an
unresolved <mechanism> first recorded on <date>". That claim must be
defensible, so every link carries its own evidence breakdown and every
factor is inspectable. Nothing here is generated.

Link score (0..1) between an earlier record A and a later record B on the
same asset:

    0.40  mechanism back-reference   B's root cause names A's mechanism
    0.15  component continuity       same part, or same mechanical train
    0.20  lexical evidence           tf-idf cosine(A.cause+action, B.problem+cause)
    0.10  recurrence cue             "prolonged", "repeated", "-induced", ...
    0.15  temporal proximity         exponential decay across the window

A link is kept at >= LINK_THRESHOLD. Each record takes at most one
predecessor (its best), which turns the link graph into a forest of chains.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

OUT = Path(__file__).resolve().parents[1] / "out"
PILOT_TAGS = ("GA-1201A", "EA-5601")

WINDOW_DAYS = 365          # a full year: recurrence across one T/A cycle
LINK_THRESHOLD = 0.50
MECH_FLOOR = 0.60          # no chain link on time + wording alone
W = {"mechanism": 0.40, "component": 0.15, "lexical": 0.20,
     "cue": 0.10, "temporal": 0.15}

# Parts that share a mechanical train: damage propagates between them.
TRAINS = [
    # rotating train: misalignment energy propagates along it
    {"coupling", "bearing_DE", "bearing_NDE", "baseplate_grout", "motor",
     "mechanical_seal", "impeller"},
    # pressure envelope of a heat exchanger
    {"tube_bundle", "gasket", "valve"},
    # small-bore / auxiliary lines: they plug with the same contaminant,
    # which is why a fouled impulse line and a plugged seal-flush orifice
    # are the same story on a hexane service
    {"instrument", "seal_flush", "lube_system"},
]

# A planned finding is the outcome of scheduled work, not a failure mechanism.
# It may be chain CONTEXT but never a chain cause.
PLANNED_CUES = ("per rbi plan", "end-of-run", "scheduled", "as per plan",
                "turnaround", "proof test", "routine")

# A mechanism, once present, keeps damaging these modes downstream.
MECH_TO_DAMAGE = {
    "MISALIGNMENT": {"BEARING_FAILURE", "COUPLING_FAILURE", "SEAL_LEAK",
                     "STRUCTURAL_SUPPORT", "VIBRATION"},
    "VIBRATION": {"STRUCTURAL_SUPPORT", "BEARING_FAILURE", "COUPLING_FAILURE",
                  "INSTRUMENT_DRIFT"},
    "FOULING": {"TUBE_LEAK", "SEAL_LEAK", "INSTRUMENT_DRIFT", "GASKET_LEAK",
                "THERMAL_DAMAGE", "FOULING"},
    "THERMAL_DAMAGE": {"TUBE_LEAK", "GASKET_LEAK", "SIGHT_GLASS"},
    "CORROSION_EROSION": {"TUBE_LEAK", "GASKET_LEAK", "STRUCTURAL_SUPPORT",
                          "VALVE_FAILURE"},
    "LUBRICATION": {"BEARING_FAILURE"},
    # A badly tuned loop does not cause an instrument to drift — the reverse.
    "CONTROL_LOOP": {"VALVE_FAILURE", "PROCESS_UPSET"},
}

HAZARD_WORDS = ("hexane", "leak", "flammable", "hydrocarbon", "solvent")


@dataclass
class Link:
    frm: str
    to: str
    score: float
    factors: dict = field(default_factory=dict)
    rationale: str = ""


@dataclass
class Chain:
    chain_id: str
    tag: str
    equipment: str
    root_mechanism: str
    wos: list[str]
    first_seen: str
    last_seen: str
    span_days: int
    n_events: int
    total_downtime_h: float
    total_cost_idr: float
    confidence: float
    loss_of_containment: bool
    events: list = field(default_factory=list)
    links: list = field(default_factory=list)


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def is_planned_finding(r: dict) -> bool:
    """Scheduled work whose 'cause' is an expected, planned observation."""
    blob = f"{r['problem']} {r['root_cause']}".lower()
    return (r["work_type"] in ("Overhaul", "Inspection", "Preventive",
                               "Calibration")
            and any(c in blob for c in PLANNED_CUES))


def same_train(a: list[str], b: list[str]) -> float:
    if set(a) & set(b):
        return 1.0
    for t in TRAINS:
        if set(a) & t and set(b) & t:
            return 0.6
    return 0.0


def mechanism_link(a: dict, b: dict) -> tuple[float, str]:
    """Does B's root cause point back at A's mechanism?"""
    a_mech = a.get("causal_mode") or ""
    b_mech = b.get("causal_mode") or ""
    a_terms = set(a.get("mechanisms", []))
    b_terms = set(b.get("mechanisms", []))

    if a_mech and b_mech and a_mech == b_mech:
        return 1.0, f"both root causes name {a_mech.lower().replace('_',' ')}"

    # B's damage is a known consequence of A's mechanism.
    if a_mech and b["primary_mode"] in MECH_TO_DAMAGE.get(a_mech, set()):
        shared = a_terms & b_terms
        if shared:
            return 0.9, (f"{b['primary_mode'].lower().replace('_',' ')} is a known "
                         f"consequence of {a_mech.lower().replace('_',' ')}; "
                         f"shared term(s): {', '.join(sorted(shared))}")
        return 0.65, (f"{b['primary_mode'].lower().replace('_',' ')} is a known "
                      f"consequence of {a_mech.lower().replace('_',' ')}")

    # A's damage mode reappears as B's mechanism (symptom became the cause).
    if b_mech and a["primary_mode"] in MECH_TO_DAMAGE.get(b_mech, set()):
        return 0.5, (f"{b_mech.lower().replace('_',' ')} in B repeats the "
                     f"condition behind A")

    shared = a_terms & b_terms
    if shared:
        return 0.45, f"shared mechanism term(s): {', '.join(sorted(shared))}"
    return 0.0, ""


def build_links(recs: list[dict], tfidf) -> list[Link]:
    idx = {r["wo"]: i for i, r in enumerate(recs)}
    links: list[Link] = []
    for b in recs:
        for a in recs:
            if a["wo"] == b["wo"]:
                continue
            if a["tag"] != b["tag"]:
                continue
            # Planned surveillance findings are not failure events: they stay
            # out of the spine in both directions and are reported separately.
            if is_planned_finding(a) or is_planned_finding(b):
                continue
            ta, tb = dt(a["date"]), dt(b["date"])
            if not (ta < tb):
                continue
            gap = (tb - ta).days
            if gap > WINDOW_DAYS:
                continue

            mech, why = mechanism_link(a, b)
            comp = same_train(a["components"], b["components"])
            lex = float(tfidf[idx[a["wo"]], idx[b["wo"]]])
            cue = 1.0 if b["has_backref_cue"] else 0.0
            temporal = math.exp(-gap / (WINDOW_DAYS / 2))

            score = (W["mechanism"] * mech + W["component"] * comp
                     + W["lexical"] * lex + W["cue"] * cue
                     + W["temporal"] * temporal)

            if score >= LINK_THRESHOLD and mech >= MECH_FLOOR:
                links.append(Link(
                    frm=a["wo"], to=b["wo"], score=round(score, 3),
                    factors={"mechanism": round(mech, 2),
                             "component": round(comp, 2),
                             "lexical": round(lex, 3),
                             "recurrence_cue": cue,
                             "temporal": round(temporal, 3),
                             "gap_days": gap},
                    rationale=why,
                ))
    return links


def assemble(recs: list[dict], links: list[Link]) -> list[Chain]:
    by_wo = {r["wo"]: r for r in recs}
    best_pred: dict[str, Link] = {}
    for ln in links:
        cur = best_pred.get(ln.to)
        if cur is None or ln.score > cur.score:
            best_pred[ln.to] = ln

    successors: dict[str, list[str]] = {}
    for to, ln in best_pred.items():
        successors.setdefault(ln.frm, []).append(to)

    roots = [r["wo"] for r in recs
             if r["wo"] not in best_pred and r["wo"] in successors]

    chains: list[Chain] = []
    for n, root in enumerate(sorted(roots), start=1):
        seq = [root]
        frontier = list(successors.get(root, []))
        while frontier:
            nxt = sorted(frontier, key=lambda w: by_wo[w]["date"])
            seq.extend(nxt)
            frontier = []
            for w in nxt:
                frontier.extend(successors.get(w, []))
        seq = sorted(dict.fromkeys(seq), key=lambda w: by_wo[w]["date"])
        if len(seq) < 2:
            continue

        evs = [by_wo[w] for w in seq]
        chain_links = [asdict(best_pred[w]) for w in seq if w in best_pred]
        mech = next((e["causal_mode"] for e in evs if e["causal_mode"]), "")
        dtime = sum(e["downtime_h"] or 0 for e in evs)
        cost = sum(e["cost_idr"] or 0 for e in evs)
        span = (dt(evs[-1]["date"]) - dt(evs[0]["date"])).days
        conf = round(sum(l["score"] for l in chain_links) / max(len(chain_links), 1), 3)
        loc = any(
            any(h in (e["problem"] + " " + e["root_cause"]).lower()
                for h in HAZARD_WORDS[:1])
            and "leak" in (e["problem"] + e["root_cause"]).lower()
            for e in evs
        )

        chains.append(Chain(
            chain_id=f"CH-{evs[0]['tag']}-{n:02d}",
            tag=evs[0]["tag"],
            equipment=evs[0]["equipment"],
            root_mechanism=mech or "UNSPECIFIED",
            wos=seq,
            first_seen=evs[0]["date"][:10],
            last_seen=evs[-1]["date"][:10],
            span_days=span,
            n_events=len(seq),
            total_downtime_h=dtime,
            total_cost_idr=cost,
            confidence=conf,
            loss_of_containment=loc,
            events=[{k: e[k] for k in
                     ("wo", "date", "work_type", "primary_mode", "causal_mode",
                      "problem", "root_cause", "action", "downtime_h",
                      "cost_idr", "related_interlock", "components")}
                    for e in evs],
            links=chain_links,
        ))
    chains.sort(key=lambda c: (c.n_events, c.confidence), reverse=True)
    return chains


def main() -> int:
    import sys
    scope_all = "--all" in sys.argv
    recs_all = json.loads((OUT / "failure_records.json").read_text())
    recs = [r for r in recs_all
            if (scope_all or r["tag"] in PILOT_TAGS) and r["cause_recorded"]]
    print("scope:", "ALL 8 ASSETS" if scope_all else f"PILOT {PILOT_TAGS}")
    print(f"pilot records eligible for chaining: {len(recs)}")

    corpus_a = [f"{r['root_cause']} {r['action']}" for r in recs]
    corpus_b = [f"{r['problem']} {r['root_cause']}" for r in recs]
    vec = TfidfVectorizer(ngram_range=(1, 2), stop_words="english",
                          sublinear_tf=True)
    vec.fit(corpus_a + corpus_b)
    sim = cosine_similarity(vec.transform(corpus_a), vec.transform(corpus_b))

    links = build_links(recs, sim)
    chains = assemble(recs, links)

    (OUT / "chains.json").write_text(
        json.dumps([asdict(c) for c in chains], indent=1, ensure_ascii=False),
        encoding="utf-8")

    print(f"links above threshold: {len(links)}")
    print(f"chains assembled     : {len(chains)}\n")
    for c in chains:
        flag = "  [LOSS OF CONTAINMENT]" if c.loss_of_containment else ""
        print(f"{c.chain_id} | {c.tag} | {c.n_events} events | "
              f"{c.first_seen} -> {c.last_seen} ({c.span_days}d) | "
              f"mech={c.root_mechanism} | conf={c.confidence} | "
              f"{c.total_downtime_h:.1f}h | Rp{c.total_cost_idr:,.0f}{flag}")
        for i, e in enumerate(c.events, 1):
            print(f"    {i}. {e['wo']} {e['date'][:10]} {e['primary_mode']:18s} "
                  f"{e['root_cause'][:64]}")
        for l in c.links:
            print(f"       link {l['frm']}->{l['to']} {l['score']} :: {l['rationale']}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
