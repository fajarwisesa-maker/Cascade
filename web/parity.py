"""
Parity test: the browser engine (web/engine.js) must give the SAME answer as
the Python reference (src/qa.py) for every question in the parity set, and
the same retrieval ranking for every query x asset x kind combination.

Compared: status, intent, asset, safety flags, headline, reason, every
section/item/evidence/derived field, confidence (score, band, factor values,
caps), verification counts and removed statements, escalation, and the
retrieval top-k passage ids. Excluded: latency and raw fused scores.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from qa import Engine  # noqa: E402

WEB = ROOT / "web"
KIND_SETS = [None, ("OPL_STEPS",), ("OPL_TROUBLE", "WO"), ("DS_PARAM",), ("IL_CAUSE", "IL_PERMISSIVE")]


def norm(a: dict) -> dict:
    a = json.loads(json.dumps(a))
    a.pop("latency_ms", None)
    a.pop("summary", None)
    if "retrieval" in a:
        a["retrieval"] = {"mode": a["retrieval"]["mode"], "top": [h["pid"] for h in a["retrieval"]["top"]]}
    return a


def first_diff(x, y, path="$"):
    if type(x) != type(y) and not (isinstance(x, (int, float)) and isinstance(y, (int, float))):
        return f"{path}: type {type(x).__name__} != {type(y).__name__} ({str(x)[:80]!r} vs {str(y)[:80]!r})"
    if isinstance(x, dict):
        for k in sorted(set(x) | set(y)):
            if k not in x or k not in y:
                return f"{path}.{k}: missing on {'python' if k not in x else 'js'}"
            d = first_diff(x[k], y[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(x, list):
        if len(x) != len(y):
            return f"{path}: len {len(x)} != {len(y)}"
        for i, (a, b) in enumerate(zip(x, y)):
            d = first_diff(a, b, f"{path}[{i}]")
            if d:
                return d
        return None
    if isinstance(x, float) or isinstance(y, float):
        return None if abs(x - y) < 1e-9 else f"{path}: {x} != {y}"
    return None if x == y else f"{path}: {str(x)[:100]!r} != {str(y)[:100]!r}"


def main() -> int:
    qs = json.loads((WEB / "parity_questions.json").read_text())
    eng = Engine()
    py = {q: norm(eng.ask(q)) for q in qs}

    ret_cases = []
    for q in qs[:120]:
        for tag in ("GA-1201A", "EA-5601", None):
            for kinds in KIND_SETS:
                ret_cases.append({"q": q, "tag": tag, "kinds": list(kinds) if kinds else None})
    py_ret = [[h["pid"] for h in eng.R.search(c["q"], tag=c["tag"],
                                                kinds=tuple(c["kinds"]) if c["kinds"] else None, k=8)]
              for c in ret_cases]

    (WEB / "_ret_cases.json").write_text(json.dumps(ret_cases))
    res = subprocess.run(["node", str(WEB / "parity_node.js")], capture_output=True, text=True, cwd=WEB)
    if res.returncode != 0:
        print(res.stderr[-3000:])
        return 2
    js = json.loads((WEB / "_js_out.json").read_text())

    ret_bad = [(c, p, j) for c, p, j in zip(ret_cases, py_ret, js["retrieval"]) if p != j]
    ans_bad = []
    for q in qs:
        d = first_diff(py[q], norm(js["answers"][q]))
        if d:
            ans_bad.append((q, d))

    print(f"retrieval parity : {len(ret_cases) - len(ret_bad)}/{len(ret_cases)} identical top-8 rankings")
    for c, p, j in ret_bad[:5]:
        print(f"   DIFF {c}\n      py {p}\n      js {j}")
    print(f"answer parity    : {len(qs) - len(ans_bad)}/{len(qs)} identical answers")
    for q, d in ans_bad[:12]:
        print(f"   DIFF {q[:70]!r}\n      {d}")
    statuses = {}
    for a in py.values():
        statuses[a["status"]] = statuses.get(a["status"], 0) + 1
    print(f"coverage by status: {statuses}")
    ok = not ret_bad and not ans_bad
    print("PARITY: IDENTICAL" if ok else "PARITY: DIVERGES")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
