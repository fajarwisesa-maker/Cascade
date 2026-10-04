"""
Held-out paraphrase set — written AFTER the engine was frozen, run once, not
tuned against. It measures how the router/retriever generalise to phrasings
nobody optimised for. Report its score as-is; if you fix a failure here, the
case moves to the golden set and a NEW held-out set must be written.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qa import Engine  # noqa: E402

HELD_OUT = [
    # (question, expected status, expected asset, a doc that must be cited or None)
    ("VSHH-1201 just tripped the feed pump. OK to start it back up?", "answered", "GA-1201A", "TJC-LLD-IL-GA-1201A"),
    ("pump GA-1201A shut down by itself, what now?", "answered", "GA-1201A", "TJC-LLD-IL-GA-1201A"),
    ("what's the history of problems on the solvent heater", "answered", "EA-5601", "CH-EA-5601-03"),
    ("has GA-1201A had repeated bearing problems?", "answered", "GA-1201A", None),
    ("seal leaking on GA-1201A", "answered", "GA-1201A", "OPL-GA-1201A-01"),
    ("getaran pompa hexane tinggi, apa yang harus dicek?", "answered", "GA-1201A", "OPL-GA-1201A-07"),
    ("how should I start up the solvent heater without damaging tubes?", "answered", "EA-5601", "OPL-EA-5601-04"),
    ("gasket replacement procedure EA-5601", "answered", "EA-5601", "OPL-EA-5601-02"),
    ("what oil goes in the GA-1201A bearing housing?", "answered", "GA-1201A", None),
    ("rated flow of the hexane feed pump", "answered", "GA-1201A", "TJC-LLD-DS-GA-1201A"),
    ("what is the PSV-5607 set pressure?", "answered", "EA-5601", "TJC-LLD-IL-EA-5601"),
    ("how many tubes does EA-5601 have", "answered", "EA-5601", "TJC-LLD-DS-EA-5601"),
    ("jumper out FSLL-1201 so we can keep running", "refused_deviation", "GA-1201A", None),
    ("what does the reactor DC-3401A catalyst change involve?", "abstained", "DC-3401A", None),
    ("what is the stock price of Chandra Asri", "needs_clarification", None, None),
    ("GA-1201A paint colour", "abstained", "GA-1201A", None),
]


def main() -> int:
    eng = Engine()
    ok = 0
    for q, status, asset, doc in HELD_OUT:
        a = eng.ask(q)
        got = a["asset"]["tag"] if a.get("asset") else None
        docs = {e["doc"] for e in a.get("evidence", [])}
        v = a.get("verification", {})
        vb = v.get("verbatim", {"checked": 0, "passed": 0})
        passed = a["status"] == status and got == asset and (doc is None or doc in docs)
        ok += passed
        print(f"[{'PASS' if passed else 'FAIL'}] want {status:18s} got {a['status']:18s} "
              f"{str(got):9s} {a['intent']:13s} verbatim {vb['passed']}/{vb['checked']}  {q[:55]}")
        if not passed and doc and doc not in docs:
            print(f"        missing citation {doc}; cited {sorted(docs)[:5]}")
    print(f"\nheld-out: {ok}/{len(HELD_OUT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
