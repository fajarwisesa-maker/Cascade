# CASCADE — failure-chain reconstruction + trusted Q&A (CALIBER 2026, Case 1)

Built on the committee's own baseline data. Pilot scope: **GA-1201A** (hexane feed pump)
and **EA-5601** (solvent heater). Nothing in the causal or answer layer is generated:
chains come from rules over the work orders, answers are assembled from structured
document cells, and every sentence passes a verbatim or grounding gate before display.
An LLM is optional and only ever summarises an already-verified answer.

```bash
pip install pdfplumber pandas openpyxl scikit-learn numpy
export CASCADE_DATA="/path/to/Case 1_ Manufacturing Knowledge Hub"   # the unzipped case folder
./run_all.sh                      # rebuild everything from raw data + run every test
python3 src/qa.py "GA-1201A tripped on high vibration, can I restart?"
python3 src/server.py 8765        # JSON API for the UI  (/ask /chains /demo /health)
```

Optional: `export ANTHROPIC_API_KEY=...` turns on the gated LLM summary.
`pip install sentence-transformers` adds dense retrieval to the fusion automatically.

## Pipeline

| Step | File | Output |
|---|---|---|
| 1 | `extract.py` | PDFs → anchored chunks. Rebuilds reading order from word geometry (the OPL text layer is out of order; all 24 pilot PDFs needed it). |
| 2 | `normalize.py` | 211 work orders → failure records (damage vs mechanism). 134 routine "no finding" rows excluded. |
| 3 | `structure.py` | OPL (metadata, date shared, verbatim steps, troubleshooting), Interlock C&E + permissives, datasheet parameters. |
| 4 | `chain.py` | Temporal causal linking into failure chains. `--all` for all 8 assets. |
| 5 | `link_knowledge.py` | Chain → OPL with **real dates**: lesson latency, detectability, OPL gap detector. |
| 6 | `rag_index.py` | 226 typed passages; BM25 + word tf-idf + char tf-idf, reciprocal rank fusion; Bahasa Indonesia query expansion. |
| 7 | `qa.py` | Asset resolution → intent + HSE safety taxonomy → composer → verbatim/grounding gates → computed confidence → answer / clarify / abstain / refuse. |
| 8 | `verify.py`, `llm.py` | Gates. LLM output also passes a citation gate and an action gate (no deviation verbs). |
| 9 | `server.py` | stdlib HTTP API. |

## Intents the engine answers

| Intent | Built from | Safety behaviour |
|---|---|---|
| TRIP_RESTART | C&E row, effects, latch note, start permissives (AND gate), recovery OPL, prior trips + chain | verbatim only; "not verified" list; supervisor escalation; confidence capped at 75 (no live data) |
| RECURRING | chains, link rationale, impact, lesson timeline, current OPL | — |
| SYMPTOM | de-duplicated troubleshooting row, source WO, chain, approved check | capped at 75; escalation if loss of containment |
| PROCEDURE | OPL steps + check column + safety precautions (verbatim) | — |
| PARAMETER | datasheet field or C&E set point, cross-document corroboration, document caveats | relevance gate: no field match → abstain |
| DEVIATION | refusal with verbatim "do not defeat" text | MOC / override-permit escalation; detected from C&E instrument tags, not keywords |

## Test results (reproduced by `run_all.sh`)

| Suite | Result |
|---|---|
| Causal golden set | chain recall 3/3, link precision 6/6, 3/3 traps rejected |
| Q&A golden set | 28/28 · verbatim 157/157 · grounding 72/72 · LLM gates 4/4 |
| Regression suite | all pass — 54 bypass combinations, set-point changes (EN+ID), final-element manipulation, plus over-blocking probes |
| Latency | p50 ≈ 5 ms, p95 ≈ 12 ms |

**Held-out rounds — FIRST RUN of each, untuned. Quote these for generalisation:**

| Round | First run | Serious failures found | Class |
|---|---|---|---|
| #1 | 12/16 | 2 | bypass via instrument tag; set point from wrong document |
| #2 | 13/14 | 0 | — (1 safe miss left open on purpose) |
| #3 | 15/20 by its rules | 3–4 on manual review | set-point change, cost from datasheet, "is it safe", car-seal removal |
| #4 | 12/18 | 3 | Indonesian set-point change, SIS effect (auto-start), wrong-component chain |
| #5 (final gate) | 16/18 | 1 | hand-closing a min-flow final element |

Every serious failure was an **omission in the regex intent router** (a request not
refused, or routed to the wrong composer). None was a fabricated or unverified
statement: verbatim and grounding were 100% in every round. All were fixed with
permanent regression tests; after the fixes every round passes with 0 serious.

## Facts about the dataset that shape the story

- **Every OPL was shared Mar–May 2026, after every work order (last: Dec 2025).** The OPLs'
  troubleshooting tables reproduce work-order text. The honest claim is *lesson latency*,
  not "the knowledge existed and was ignored":
  misalignment chain 400 d, EA-5601 fouling chain 583 d, seal-leak chain 502 d.
- The same three troubleshooting rows are copied into most OPLs of an asset; OPL topic
  is therefore taken from title/purpose/steps only.
- Some OPL table cells are truncated in the source PDF ("…seal dr."); the full text is in the work order.
- Interlock notes state set points are **dummy training values** — surfaced as a caveat in answers.
- EA-5601 has **no dedicated ESD trip** (control loop only) — answered as such.
- Uncovered failure mode: instrument impulse-line plugging (4 occurrences, no OPL) — the first event of both fouling chains.

## Not claimed

P&IDs are raster PNG with no tag list → no drawing tag extraction. No live historian → every
condition-dependent answer says so and is capped. Six of eight assets have work orders only.
