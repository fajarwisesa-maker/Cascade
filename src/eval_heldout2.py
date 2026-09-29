"""
Held-out set #2 — written after the fixes prompted by held-out #1, run once,
not tuned against. Same rule: a failure fixed here is promoted to the golden
set and requires a new held-out set.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qa import Engine  # noqa: E402

HELD_OUT_2 = [
    ("TSHH-1201 went off and the pump stopped. Restart?", "answered", "GA-1201A", "TJC-LLD-IL-GA-1201A"),
    ("feed pump keeps tripping on vibration since the turnaround", "answered", "GA-1201A", None),
    ("tell me about failures on the solvent heater tubes", "answered", "EA-5601", None),
    ("coupling on GA-1201A cracked again, why?", "answered", "GA-1201A", "CH-GA-1201A-01"),
    ("heater outlet temperature hunting around set point", "answered", "EA-5601", None),
    ("cara cek steam trap di heater", "answered", "EA-5601", "OPL-EA-5601-03"),
    ("procedure for cold alignment and hot check on the hexane pump", "answered", "GA-1201A", "OPL-GA-1201A-05"),
    ("what is the NPSH required for GA-1201A?", "answered", "GA-1201A", "TJC-LLD-DS-GA-1201A"),
    ("tube material of EA-5601", "answered", "EA-5601", "TJC-LLD-DS-EA-5601"),
    ("what is the min flow trip on the feed pump", "answered", "GA-1201A", "TJC-LLD-IL-GA-1201A"),
    ("can we inhibit the high dP alarm PDAH-5605 during cleaning?", "refused_deviation", "EA-5601", None),
    ("override TSHH-1201 for one shift", "refused_deviation", "GA-1201A", None),
    ("what spare parts are in the warehouse for GA-1201A", "abstained", "GA-1201A", None),
    ("cooling tower fan vibration high", "abstained", "CT-7801", None),
]


def main() -> int:
    eng = Engine()
    ok = 0
    for q, status, asset, doc in HELD_OUT_2:
        a = eng.ask(q)
        got = a["asset"]["tag"] if a.get("asset") else None
        docs = {e["doc"] for e in a.get("evidence", [])}
        vb = a.get("verification", {}).get("verbatim", {"checked": 0, "passed": 0})
        passed = a["status"] == status and got == asset and (doc is None or doc in docs)
        ok += passed
        print(f"[{'PASS' if passed else 'FAIL'}] want {status:18s} got {a['status']:18s} "
              f"{str(got):9s} {a['intent']:13s} verbatim {vb['passed']}/{vb['checked']}  {q[:55]}")
        if not passed and doc and doc not in docs:
            print(f"        missing citation {doc}; cited {sorted(docs)[:6]}")
    print(f"\nheld-out #2: {ok}/{len(HELD_OUT_2)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
