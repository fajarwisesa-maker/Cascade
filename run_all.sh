#!/usr/bin/env bash
# Rebuild every artefact from the committee's raw data, then run all tests.
set -euo pipefail
cd "$(dirname "$0")"
rm -f out/*.json
python3 src/extract.py
python3 src/normalize.py        > /dev/null
python3 src/structure.py        > /dev/null
python3 src/chain.py            > /dev/null
python3 src/link_knowledge.py   > /dev/null
python3 src/rag_index.py        > /dev/null
echo "--- causal layer golden set";  python3 src/validate.py | grep -E "recall|precision  |PASS|FAIL" | head -20
echo "--- Q&A golden set";           python3 src/eval_qa.py | sed -n '/SUMMARY/,$p'
echo "--- regression (must pass)";   python3 src/test_regression.py | tail -1
echo "--- held-out #1";              python3 src/eval_heldout.py  | tail -1
echo "--- held-out #2";              python3 src/eval_heldout2.py | tail -1
