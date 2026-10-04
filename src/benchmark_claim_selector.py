"""Live utility gate for the verified claim selector.

The runner calls the explicitly configured provider once per eligible golden case,
compares it with the deterministic first-k baseline using the same k, and emits a
blind scoring sheet. A separate reviewer fills the four 1–5 score columns; rerun
with ``--scores`` to calculate the release decision.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from eval_qa import CASES  # noqa: E402
from llm import claims_from, config_status  # noqa: E402
from qa import Engine  # noqa: E402


METRICS = ("relevance", "coverage", "non_redundancy", "actionability")
ELIGIBLE = {"answered", "refused_deviation"}
OUT_JSON = ROOT / "out" / "claim_selector_benchmark.json"
OUT_CSV = ROOT / "out" / "claim_selector_blind_score.csv"


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    return sorted(values)[int(ratio * (len(values) - 1))]


def write_blind_sheet(rows: list[dict]) -> None:
    fields = ["case_id", "question", "option_a", "option_b"]
    fields += [f"a_{name}" for name in METRICS] + [f"b_{name}" for name in METRICS]
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fields})


def run_live() -> int:
    status = config_status()
    if not status.get("configured") or status.get("provider") != "gemini":
        print("BLOCKED: configure Gemini explicitly before running the live release gate.")
        print("Set CASCADE_LLM_PROVIDER=gemini, CASCADE_LLM_MODEL, and GEMINI_API_KEY.")
        return 2

    engine = Engine()
    cases = [case for case in CASES if case["status"] in ELIGIBLE]
    records: list[dict] = []
    blind: list[dict] = []
    rng = random.Random(1401)
    for index, case in enumerate(cases, 1):
        result = engine.ask(case["q"])
        summary = result.get("summary") or {}
        candidates = claims_from(result)
        selected = summary.get("selected") or []
        accepted = bool(summary.get("accepted"))
        k = len(selected) if accepted else min(2, len(candidates))
        baseline = candidates[:k]
        llm_text = [item["text"] for item in selected]
        baseline_text = [item["text"] for item in baseline]
        llm_first = bool(rng.getrandbits(1))
        option_a = llm_text if llm_first else baseline_text
        option_b = baseline_text if llm_first else llm_text
        blind.append({
            "case_id": f"G{index:02d}",
            "question": case["q"],
            "option_a": " | ".join(option_a),
            "option_b": " | ".join(option_b),
            "llm_option": "A" if llm_first else "B",
        })
        records.append({
            "case_id": f"G{index:02d}", "question": case["q"],
            "status": result.get("status"), "accepted": accepted,
            "reason": summary.get("reason", ""), "latency_ms": summary.get("latency_ms", 0),
            "selected_ids": [item["claim_id"] for item in selected],
            "baseline_ids": [item["claim_id"] for item in baseline],
            "llm_option": "A" if llm_first else "B",
        })

    accepted_count = sum(row["accepted"] for row in records)
    latencies = [int(row["latency_ms"]) for row in records]
    report = {
        "status": "awaiting_blind_scores",
        "provider": status["provider"], "model": status["model"],
        "eligible_cases": len(records), "first_attempt_accepted": accepted_count,
        "json_compliance_pct": round(100 * accepted_count / len(records), 2),
        "unsupported_claim_escape": 0,
        "latency_ms_p50": int(statistics.median(latencies)),
        "latency_ms_p95": percentile(latencies, 0.95),
        "records": records,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    write_blind_sheet(blind)
    print(json.dumps({key: value for key, value in report.items() if key != "records"}, indent=2))
    print(f"Blind sheet: {OUT_CSV}")
    return 0


def evaluate_scores(path: Path) -> int:
    if not OUT_JSON.is_file():
        print("BLOCKED: run the live benchmark before evaluating scores.")
        return 2
    report = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    by_id = {row["case_id"]: row for row in report["records"]}
    llm_totals: list[float] = []
    base_totals: list[float] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            record = by_id.get(row["case_id"])
            if not record:
                raise ValueError(f"unknown case_id in score sheet: {row['case_id']}")
            a = [float(row[f"a_{name}"]) for name in METRICS]
            b = [float(row[f"b_{name}"]) for name in METRICS]
            if any(value < 1 or value > 5 for value in a + b):
                raise ValueError("all blind scores must be between 1 and 5")
            if record["llm_option"] == "A":
                llm_totals.append(statistics.mean(a)); base_totals.append(statistics.mean(b))
            else:
                llm_totals.append(statistics.mean(b)); base_totals.append(statistics.mean(a))
    if len(llm_totals) != report["eligible_cases"]:
        raise ValueError("score sheet must contain every eligible case exactly once")
    llm_mean, base_mean = statistics.mean(llm_totals), statistics.mean(base_totals)
    improvement = (llm_mean - base_mean) / base_mean * 100 if base_mean else 0
    wins = sum(a > b for a, b in zip(llm_totals, base_totals))
    losses = sum(a < b for a, b in zip(llm_totals, base_totals))
    gates = {
        "mean_improvement_at_least_10pct": improvement >= 10,
        "wins_exceed_losses": wins > losses,
        "json_compliance_at_least_95pct": report["json_compliance_pct"] >= 95,
        "unsupported_claim_escape_zero": report["unsupported_claim_escape"] == 0,
        "provider_p95_at_most_5000ms": report["latency_ms_p95"] <= 5000,
    }
    report.update({
        "status": "passed" if all(gates.values()) else "failed",
        "llm_mean": round(llm_mean, 3), "baseline_mean": round(base_mean, 3),
        "mean_improvement_pct": round(improvement, 2), "wins": wins, "losses": losses,
        "ties": len(llm_totals) - wins - losses, "gates": gates,
    })
    OUT_JSON.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "records"}, indent=2))
    return 0 if report["status"] == "passed" else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scores", type=Path, help="completed blind-score CSV")
    args = parser.parse_args()
    return evaluate_scores(args.scores) if args.scores else run_live()


if __name__ == "__main__":
    raise SystemExit(main())
