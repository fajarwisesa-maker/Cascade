"""
Export everything the browser engine needs as ONE JSON bundle.

Principle: anything that can be computed once in Python is shipped as data,
not re-implemented in JavaScript. Only the query-time logic is ported, which
keeps the surface where the two engines could diverge as small as possible.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from dataclasses import asdict  # noqa: E402

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS  # noqa: E402

from qa import Engine  # noqa: E402

OUT = ROOT / "out"


def main() -> int:
    eng = Engine()
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True).stdout.strip()

    keep_rec = ("wo", "tag", "equipment", "date", "work_type", "criticality", "breakdown",
                "downtime_h", "cost_idr", "problem", "root_cause", "action", "related_interlock",
                "primary_mode", "causal_mode", "components", "cause_recorded")
    K = json.loads((OUT / "knowledge.json").read_text())
    for group in ("opl", "interlock", "datasheet"):
        for x in K[group]:
            x["source_path"] = Path(x["source_path"]).name   # what the Python output shows

    chains_all = json.loads((OUT / "chains_all.json").read_text()) if (OUT / "chains_all.json").exists() else []

    bundle = {
        "meta": {"engine_commit": commit, "pilot": list(eng.K and ("GA-1201A", "EA-5601")),
                 "retrieval_mode": eng.R.mode},
        "knowledge": K,
        "records": [{k: r[k] for k in keep_rec} for r in eng.recs],
        "chains": eng.chains,
        "chains_all": [{k: c[k] for k in ("chain_id", "tag", "equipment", "root_mechanism", "n_events",
                                          "first_seen", "last_seen", "span_days", "total_downtime_h",
                                          "total_cost_idr", "confidence", "loss_of_containment", "wos")}
                       for c in chains_all],
        "page_text": eng.page_text,
        "passages": [asdict(p) for p in eng.R.P],
        "instrument_owner": eng.instrument_owner,
        "safeguard_tags": sorted(eng.safeguard_tags()),
        "safeguard_everything": sorted(eng.safeguard_everything()),
        "stop_words": sorted(ENGLISH_STOP_WORDS),
    }
    path = ROOT / "web" / "bundle.json"
    path.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"bundle: {path.stat().st_size / 1024:.0f} KB, {len(bundle['passages'])} passages, "
          f"{len(bundle['records'])} records, commit {commit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
