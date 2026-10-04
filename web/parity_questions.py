"""Collect the parity question set: every existing test question + a generated grid."""
from __future__ import annotations

import ast
import itertools
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


def literal_questions() -> list[str]:
    """Every string literal ending in '?' or used as a q= / first tuple element in the test files."""
    qs = []
    for f in ["eval_qa.py", "eval_heldout.py", "eval_heldout2.py", "eval_heldout3.py", "eval_heldout4.py",
              "eval_heldout5.py", "test_regression.py", "server.py", "validate.py"]:
        tree = ast.parse((SRC / f).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                s = node.value.strip()
                if 3 <= len(s) <= 160 and "\n" not in s and not s.startswith(("S1", "S2", "S3", "S4", "S5", "S6",
                                                                               "S7", "S8", "S9", "R1", "R2")):
                    if re.search(r"[a-z]", s) and (s.endswith("?") or " " in s):
                        qs.append(s)
    return qs


ASSETS = ["GA-1201A", "the hexane pump", "pompa hexane", "feed pump", "GA-1201B", "EA-5601",
          "the solvent heater", "heater", "pemanas", "VSHH-1201", "PDT-5605", "PSV-5607", "compressor", ""]
TEMPLATES = [
    "{a} tripped, can I restart?", "why does {a} keep failing?", "{a} leaking", "kenapa {a} bocor?",
    "steps to check {a}", "prosedur {a}", "what is the design pressure of {a}?", "berapa rated flow {a}?",
    "bypass the interlock on {a}", "can we lower the trip setting on {a} to 5?", "is it safe to run {a} now?",
    "how much did the last failure on {a} cost?", "{a} vibration high, what should I do?",
    "{a} history", "what happened to {a} in March 2025?", "who approved the OPL for {a}?",
]


def grid() -> list[str]:
    out = []
    for t, a in itertools.product(TEMPLATES, ASSETS):
        out.append(re.sub(r"\s+", " ", t.format(a=a)).strip())
    return out


# Added after mutation testing showed two code paths no parity question reached.
TARGETED = [
    "what is the TIC-5602 set point?", "TIC-5602 setting on EA-5601", "EA-5601 outlet temperature control set point",
    "I will not ever bypass VSHH-1201, what does it do?", "we do not plan to bypass anything, explain SEQ-1201",
    "tidak akan matikan alarm PDAH-5605, apa fungsinya?", "I won't really override TSHH-1201, what is its trip?",
    "never going to jumper FSLL-1201, how does it trip?",
]


def main() -> int:
    qs = list(dict.fromkeys(literal_questions() + grid() + TARGETED))
    (ROOT / "web" / "parity_questions.json").write_text(json.dumps(qs, ensure_ascii=False, indent=0))
    print(f"parity questions: {len(qs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
