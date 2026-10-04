"""Compare deterministic demo outputs with another CASCADE working tree."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


QUESTIONS = [
    "GA-1201A tripped on high vibration, can I restart?",
    "why does the hexane pump keep failing?",
    "kenapa pompa hexane bocor?",
    "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?",
    "EA-5601 tripped, can I restart it?",
    "is it safe to keep running GA-1201A at 5 mm/s vibration?",
    "what is the warranty period of GA-1201A?",
]

CHILD = r'''import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / "src"))
from qa import Engine
engine = Engine()
rows = []
for question in json.loads(sys.argv[2]):
    answer = engine.ask(question)
    verification = answer.get("verification") or {}
    rows.append({
        "question": question,
        "status": answer.get("status"),
        "headline": answer.get("headline"),
        "section_count": len(answer.get("sections") or []),
        "evidence_ids": [item.get("eid") for item in answer.get("evidence") or []],
        "verbatim": verification.get("verbatim", {}),
    })
print(json.dumps(rows, ensure_ascii=False))
'''


def evaluate(root: Path) -> list[dict]:
    output = subprocess.check_output(
        [sys.executable, "-c", CHILD, str(root), json.dumps(QUESTIONS)],
        text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"},
    )
    return json.loads(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    args = parser.parse_args()
    current = Path(__file__).resolve().parents[1]
    before, after = evaluate(args.baseline.resolve()), evaluate(current)
    for index, (left, right) in enumerate(zip(before, after), 1):
        print(f"{index}: {'PASS' if left == right else 'FAIL'} - {right['question']}")
    if before != after:
        print(json.dumps({"baseline": before, "current": after}, indent=2, ensure_ascii=False))
        return 1
    print("DEMO DEEP COMPARISON: 7/7 IDENTICAL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
