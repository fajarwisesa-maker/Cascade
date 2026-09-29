"""
CASCADE — Golden-set validation

The PRD promised a golden set and never built one. This is it, for the
causal layer: chains hand-labelled by reading the 211 root-cause strings,
then scored against what the detector actually produced.

Positives are the chains an engineer would defend in an RCA review.
Negatives are the traps: a planned turnaround finding used as a cause, and
two work orders that merely sit near each other in time.
"""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "out"

# ---- ground truth, labelled from the root-cause text -----------------------
EXPECTED_CHAINS = {
    "misalignment cascade on GA-1201A": [
        "WO-240003", "WO-240013", "WO-240004", "WO-240007"],
    "polymer-fines fouling to tube leak on EA-5601": [
        "WO-240115", "WO-240110", "WO-240113"],
    "small-bore fouling to hexane seal leak on GA-1201A": [
        "WO-240008", "WO-240002"],
}
# Links that must NOT be produced.
FORBIDDEN_LINKS = [
    ("WO-240011", "WO-240003", "planned T/A overhaul used as a cause"),
    ("WO-240009", "WO-240008", "loop tuning cannot plug an impulse line"),
    ("WO-240008", "WO-240006", "proof-test finding is surveillance, not damage"),
]


def main() -> int:
    chains = json.loads((OUT / "chains_enriched.json").read_text())
    records = {r["wo"]: r for r in json.loads((OUT / "failure_records.json").read_text())}

    found_links = [(l["frm"], l["to"]) for c in chains for l in c["links"]]
    membership = {w: c["chain_id"] for c in chains for w in c["wos"]}

    print("=" * 74)
    print("GOLDEN-SET VALIDATION — causal layer")
    print("=" * 74)

    # ---- recall: is each expected chain recovered intact? ----
    print("\n[1] Expected chains recovered")
    recovered = 0
    for name, wos in EXPECTED_CHAINS.items():
        ids = {membership.get(w) for w in wos}
        ok = len(ids) == 1 and None not in ids
        missing = [w for w in wos if w not in membership]
        status = "PASS" if ok else "FAIL"
        if ok:
            recovered += 1
        print(f"  [{status}] {name}")
        print(f"         expected {wos}")
        print(f"         chain_id {ids if ok else ids}"
              + (f"  missing={missing}" if missing else ""))
    print(f"  chain recall: {recovered}/{len(EXPECTED_CHAINS)}")

    # ---- precision: every produced link inside an expected chain? ----
    print("\n[2] Link precision")
    tp, fp = [], []
    for frm, to in found_links:
        inside = any(frm in wos and to in wos
                     for wos in EXPECTED_CHAINS.values())
        (tp if inside else fp).append((frm, to))
    total = len(found_links)
    print(f"  links produced : {total}")
    print(f"  true positives : {len(tp)}")
    print(f"  false positives: {len(fp)}  {fp if fp else ''}")
    print(f"  precision      : {len(tp)/total:.0%}" if total else "  n/a")

    # ---- the traps ----
    print("\n[3] Forbidden links rejected")
    for frm, to, why in FORBIDDEN_LINKS:
        hit = (frm, to) in found_links
        print(f"  [{'FAIL' if hit else 'PASS'}] {frm} -> {to}  ({why})")

    # ---- no planned work inside a chain ----
    print("\n[4] No planned surveillance work inside a chain")
    planned_in = [
        w for w in membership
        if records[w]["work_type"] in ("Preventive", "Inspection", "Calibration")
    ]
    print(f"  [{'FAIL' if planned_in else 'PASS'}] "
          f"{len(planned_in)} planned WO inside chains {planned_in}")

    # ---- knowledge linkage, with the dates checked ----
    print("\n[5] Knowledge linkage and lesson latency (dates verified)")
    for c in chains:
        k = c["knowledge_links"]
        undated = [h["opl_no"] for h in k if not h.get("date_shared")]
        ok = bool(k) and not undated
        print(f"  [{'PASS' if ok else 'FAIL'}] {c['chain_id']}: {len(k)} OPL matched, "
              f"all dated={not undated}; existed before first event="
              f"{c['knowledge_existed_before_first_event']}; "
              f"latency {c.get('lesson_latency_days')} d; "
              f"detectable {c['detectable_on']}")

    # ---- impact ----
    print("\n[6] Measured impact of detected chains")
    tot_dt = sum(c["total_downtime_h"] for c in chains)
    tot_cost = sum(c["total_cost_idr"] for c in chains)
    n_ev = sum(c["n_events"] for c in chains)
    print(f"  chains {len(chains)} | events {n_ev} | "
          f"downtime {tot_dt:.1f} h | cost Rp{tot_cost:,.0f}")
    for c in chains:
        first = c["events"][0]
        last = c["events"][-1]
        print(f"   {c['chain_id']}: {c['n_events']} events over {c['span_days']}d, "
              f"{c['total_downtime_h']:.1f} h, Rp{c['total_cost_idr']:,.0f}"
              + ("  [loss of containment]" if c["loss_of_containment"] else ""))
        print(f"      first: {first['date'][:10]} {first['root_cause'][:58]}")
        print(f"      last : {last['date'][:10]} {last['root_cause'][:58]}")

    # ---- cross-asset pattern ----
    print("\n[7] Cross-asset pattern (same mechanism, different unit)")
    by_mech: dict[str, list[str]] = {}
    for c in chains:
        by_mech.setdefault(c["root_mechanism"], []).append(c["tag"])
    for mech, tags in by_mech.items():
        if len(set(tags)) > 1:
            print(f"  {mech}: appears on {sorted(set(tags))} — "
                  f"plant-wide mechanism, not an asset problem")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
