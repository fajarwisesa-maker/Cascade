"""Cross-platform CASCADE verification runner.

Use ``--rebuild`` to regenerate data artefacts first.  Without it, the checked-in
v1.3 artefacts are tested without touching the raw-data pipeline outputs.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent


def run(label: str, *command: str) -> None:
    print(f"\n--- {label}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True, env={**os.environ, "PYTHONUTF8": "1"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true", help="rebuild out/*.json from CASCADE_DATA")
    parser.add_argument("--skip-ui", action="store_true", help="skip the jsdom structural suite")
    args = parser.parse_args()

    py = sys.executable
    if args.rebuild:
        for script in ("extract.py", "normalize.py", "structure.py", "chain.py", "link_knowledge.py", "rag_index.py"):
            run(f"rebuild {script}", py, str(ROOT / "src" / script))

    run("causal validation", py, str(ROOT / "src" / "validate.py"))
    run("Q&A golden set", py, str(ROOT / "src" / "eval_qa.py"))
    run("regression", py, str(ROOT / "src" / "test_regression.py"))
    run("provider + selector unit tests", py, str(ROOT / "src" / "test_llm.py"))
    run("server contract tests", py, str(ROOT / "src" / "test_server.py"))
    run("LLM-core adversarial proof", py, str(ROOT / "src" / "test_llm_core.py"))
    for number, script in enumerate(("eval_heldout.py", "eval_heldout2.py", "eval_heldout3.py", "eval_heldout4.py", "eval_heldout5.py"), 1):
        run(f"held-out #{number}", py, str(ROOT / "src" / script))
    run("Python/JavaScript parity", py, str(ROOT / "web" / "parity.py"))
    run("single-file build", py, str(ROOT / "web" / "build.py"))

    if not args.skip_ui:
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("npm is required for the jsdom UI suite")
        if not (ROOT / "web" / "node_modules").is_dir():
            run("install locked UI test dependencies", npm, "ci", "--prefix", str(ROOT / "web"))
        run("jsdom structural checks", npm, "test", "--prefix", str(ROOT / "web"))
        run("logo embedding (present / missing)", py, str(ROOT / "web" / "test_logo.py"))
    print("\nALL PRODUCT GATES PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
