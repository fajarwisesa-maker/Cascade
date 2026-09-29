"""
CASCADE — "Knowledge that existed" linker + OPL gap detector

For every detected failure chain, find the approved knowledge that was
already in the plant when the chain started, and quote it verbatim with its
anchor. Then invert the question: which failure modes in the maintenance
history have NO approved knowledge covering them at all?

Retrieval here is hybrid: tf-idf over OPL section text (semantic-ish) plus a
hard lexical gate on mechanism and component terms, so an OPL is only
offered when it actually speaks about the failing part.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

OUT = Path(__file__).resolve().parents[1] / "out"
MATCH_THRESHOLD = 0.08

# Terms that must co-occur for an OPL to count as covering a mechanism.
MECH_TERMS = {
    "MISALIGNMENT": ["align", "alignment", "shim", "laser", "coupling",
                     "vibration"],
    "VIBRATION": ["vibration", "trend", "alarm", "mm/s", "balance"],
    "FOULING": ["foul", "clean", "plug", "orifice", "flush", "deposit",
                "hydrojet", "blockage", "fines", "scale"],
    "THERMAL_DAMAGE": ["thermal", "shock", "warm", "start-up", "cycling"],
    "CORROSION_EROSION": ["corrosion", "thickness", "inspection", "wall"],
    "LUBRICATION": ["oil", "lube", "greas", "level", "bath"],
    "CONTROL_LOOP": ["loop", "control", "tuning", "setpoint"],
}
DAMAGE_TERMS = {
    "SEAL_LEAK": ["seal", "flush", "plan 11", "gland"],
    "TUBE_LEAK": ["tube", "leak", "plugging", "tubesheet"],
    "BEARING_FAILURE": ["bearing", "oil", "greas", "vibration"],
    "COUPLING_FAILURE": ["coupling", "align"],
    "GASKET_LEAK": ["gasket", "flange", "box"],
    "STRUCTURAL_SUPPORT": ["align", "grout", "baseplate", "vibration"],
    "INSTRUMENT_DRIFT": ["calibrat", "transmitter", "impulse", "analyz"],
    "STEAM_TRAP": ["steam trap", "trap"],
    "SIGHT_GLASS": ["gauge", "glass", "bridle", "level"],
    "VALVE_FAILURE": ["valve", "packing", "actuator", "car seal"],
}

STEP_SECTION = re.compile(r"DETAILED PROCEDURE|PROCEDURE / STEPS|STEPS", re.I)


def opl_docs(docs: list[dict]) -> list[dict]:
    return [d for d in docs if d["doc_type"] == "OPL"]


def pretty_title(doc_id: str) -> str:
    # "OPL-GA-1201A-03 - Pump_Motor_Alignment_Check_Laser_edited" ->
    # "Pump Motor Alignment Check Laser"
    part = doc_id.split(" - ", 1)[-1]
    part = re.sub(r"_?(EDITED|edited|one_page|ONE_PAGE|KEEP_SIZE|REFINED_TABLE|"
                  r"refined|_edited)\w*", "", part)
    return re.sub(r"[_]+", " ", part).strip(" -_")


def opl_no(doc_id: str) -> str:
    m = re.match(r"(OPL-[A-Z]{2}-\d{4}[A-Z]?-\d{2})", doc_id)
    return m.group(1) if m else doc_id


def verbatim_steps(doc: dict) -> dict | None:
    for c in doc["chunks"]:
        if STEP_SECTION.search(c["section"]):
            return {
                "opl_no": opl_no(doc["doc_id"]),
                "section": c["section"],
                "page": c["page"],
                "chunk_id": c["chunk_id"],
                "text": c["text"],
            }
    return None


def term_hits(text: str, mech: str, damages: list[str]) -> list[str]:
    """Which mechanism/damage terms this OPL actually talks about."""
    t = text.lower()
    wanted: list[str] = list(MECH_TERMS.get(mech, []))
    for d in damages:
        wanted += DAMAGE_TERMS.get(d, [])
    return sorted({k for k in wanted if k in t})


def coverage_terms(mode: str) -> list[str]:
    """A mode is covered if its mechanism OR damage vocabulary is present."""
    return MECH_TERMS.get(mode, []) + DAMAGE_TERMS.get(mode, [])


def main() -> int:
    docs = json.loads((OUT / "documents.json").read_text())
    chains = json.loads((OUT / "chains.json").read_text())
    records = json.loads((OUT / "failure_records.json").read_text())
    knowledge = json.loads((OUT / "knowledge.json").read_text())
    opl_meta = {o["opl_no"]: o for o in knowledge["opl"]}

    opls = opl_docs(docs)

    # An OPL's TOPIC is its title, purpose, steps and first learning point.
    # Its troubleshooting table is excluded on purpose: in this corpus the
    # same three work-order cases are copied into almost every OPL of an
    # asset, which would make a lubrication OPL look like an alignment OPL.
    def topic(d: dict) -> str:
        m = opl_meta.get(opl_no(d["doc_id"]), {})
        steps = " ".join(s["action"] for s in m.get("steps", []))
        learn = (m.get("key_learning") or [""])[0]
        return f"{m.get('title', '')}. {m.get('purpose', '')} {steps} {learn}"

    corpus = [topic(d) for d in opls]
    vec = TfidfVectorizer(ngram_range=(1, 2), stop_words="english",
                          sublinear_tf=True, min_df=1)
    mat = vec.fit_transform(corpus)

    enriched = []
    for ch in chains:
        damages = [e["primary_mode"] for e in ch["events"]]
        query = " ".join(
            [ch["root_mechanism"].replace("_", " ")]
            + [e["problem"] for e in ch["events"]]
            + [e["root_cause"] for e in ch["events"]]
            + [c for e in ch["events"] for c in e["components"]]
        )
        sims = cosine_similarity(vec.transform([query]), mat)[0]

        hits = []
        for d, s in zip(opls, sims):
            if d["asset_tag"] != ch["tag"]:
                continue
            if s < MATCH_THRESHOLD:
                continue
            body = topic(d)
            hit_terms = term_hits(body, ch["root_mechanism"], damages)
            if not hit_terms:
                continue
            # Reward an OPL that speaks the failure's own vocabulary, so a
            # generic procedure cannot outrank the one that names the part.
            score = float(s) * (1 + 0.18 * len(hit_terms))
            hits.append({
                "opl_no": opl_no(d["doc_id"]),
                "title": pretty_title(d["doc_id"]),
                "relevance": round(float(s), 3),
                "matched_terms": hit_terms,
                "score": round(score, 3),
                "doc_id": d["doc_id"],
                "source_path": d["source_path"],
                "steps": verbatim_steps(d),
            })
        hits.sort(key=lambda h: h["score"], reverse=True)
        hits = hits[:3]

        # ---- temporal truth: when did this knowledge actually exist? ----
        first = date.fromisoformat(ch["first_seen"])
        last = date.fromisoformat(ch["last_seen"])
        # CASCADE can raise a chain as soon as its second linked event lands.
        detect = date.fromisoformat(ch["events"][1]["date"][:10])
        wo_problems = [e["problem"].lower() for e in ch["events"]]
        for h in hits:
            meta = opl_meta.get(h["opl_no"], {})
            shared = meta.get("date_shared", "")
            h["classification"] = meta.get("classification", "")
            h["date_shared"] = shared
            h["title"] = meta.get("title", h["title"])
            if not shared:
                h["relation"] = "undated"
                continue
            d = date.fromisoformat(shared)
            h["relation"] = ("existed_before_chain" if d < first else
                             "written_during_chain" if d <= last else
                             "written_after_chain")
            h["lesson_latency_days"] = (d - first).days
            h["days_earlier_if_detected_at_event_2"] = (d - detect).days
            # Was this OPL written FROM these very work orders?
            rows = meta.get("troubleshooting", [])
            h["cites_chain_work_orders"] = sum(
                1 for r in rows
                if any(r["symptom"].lower()[:40] in p or p[:40] in r["symptom"].lower()
                       for p in wo_problems))

        dated = [h for h in hits if h.get("date_shared")]
        ch["knowledge_links"] = hits
        ch["knowledge_existed_before_first_event"] = any(
            h["relation"] == "existed_before_chain" for h in dated)
        ch["detectable_on"] = detect.isoformat()
        ch["first_lesson_shared_on"] = min((h["date_shared"] for h in dated), default="")
        if ch["first_lesson_shared_on"]:
            ch["lesson_latency_days"] = (
                date.fromisoformat(ch["first_lesson_shared_on"]) - first).days
            ch["events_before_lesson"] = sum(
                1 for e in ch["events"]
                if e["date"][:10] < ch["first_lesson_shared_on"])
        enriched.append(ch)

    # ---------------- OPL gap detector ----------------
    gaps = []
    for tag in sorted({c["tag"] for c in chains}):
        tag_opls = [d for d in opls if d["asset_tag"] == tag]
        blob = " ".join(topic(d) for d in tag_opls).lower()
        modes = Counter(
            r["primary_mode"] for r in records
            if r["tag"] == tag and r["cause_recorded"]
            and r["primary_mode"] != "UNCLASSIFIED"
        )
        for mode, n in modes.most_common():
            terms = coverage_terms(mode)
            covered = bool(terms) and any(t in blob for t in terms)
            if not covered:
                gaps.append({"tag": tag, "failure_mode": mode,
                             "occurrences": n, "covered_by_opl": False})

    (OUT / "chains_enriched.json").write_text(
        json.dumps(enriched, indent=1, ensure_ascii=False), encoding="utf-8")
    (OUT / "opl_gaps.json").write_text(
        json.dumps(gaps, indent=1, ensure_ascii=False), encoding="utf-8")

    for ch in enriched:
        print(f"\n{ch['chain_id']}  {ch['tag']}  mech={ch['root_mechanism']}  "
              f"{ch['n_events']} events  {ch['first_seen']} -> {ch['last_seen']}")
        print(f"   detectable by CASCADE on : {ch['detectable_on']} (event #2)")
        print(f"   first lesson shared on    : {ch.get('first_lesson_shared_on') or '-'}"
              f"   -> lesson latency {ch.get('lesson_latency_days','-')} days, "
              f"{ch.get('events_before_lesson','-')}/{ch['n_events']} events happened before it")
        print(f"   knowledge existed before first event: "
              f"{ch['knowledge_existed_before_first_event']}")
        if not ch["knowledge_links"]:
            print("   (no approved knowledge matched — this is a genuine gap)")
        for h in ch["knowledge_links"]:
            print(f"   {h['opl_no']} [{h['classification']}] shared {h['date_shared']} "
                  f"— {h['relation']}, cites {h['cites_chain_work_orders']} chain WO(s) "
                  f"| {h['title'][:50]}")

    print("\n-- OPL coverage gaps (failure modes with no approved knowledge) --")
    if not gaps:
        print("   none")
    for g in gaps:
        print(f"   {g['tag']}: {g['failure_mode']} x{g['occurrences']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
