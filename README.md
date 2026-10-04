# CASCADE v1.4 — verified plant-knowledge Q&A

CASCADE reconstructs failure chains and answers plant-equipment questions from the
committee dataset. The deterministic engine remains authoritative: every displayed
answer item passes verbatim or grounding checks and retains its evidence IDs. An
optional LLM may only select up to three already-verified claims for a short TL;DR;
it cannot write user-visible prose or replace the answer.

The checked-in product is a **code-complete candidate**. LLM access is off by
default. It becomes a final release only after the live Gemini utility benchmark in
`claim-selector-benchmark.md` passes with the selected stable model and credential.

## Run and verify

Python 3.10+ and Node.js/npm are required for the full product gates.

```bash
python run_all.py                 # every test, parity, build, and jsdom UI gate
python run_all.py --rebuild       # also rebuild data artefacts from CASCADE_DATA
python src/qa.py "GA-1201A tripped on high vibration, can I restart?"
python src/server.py 8765         # http://127.0.0.1:8765
```

On POSIX systems, `./run_all.sh` runs the same release suites, including held-out
rounds #1–#5. `run_all.py` sets UTF-8 explicitly, so Windows parity does not depend
on a shell environment override.

## Dual-mode product

`CASCADE Knowledge Hub.html` is built as one self-contained file:

- Opened through `file://` or ordinary static hosting, it runs the JavaScript
  deterministic engine fully offline and makes no LLM request.
- Served by `src/server.py` on loopback, the same deterministic answer appears
  immediately. A same-origin `/ask` request may then add a Verified TL;DR.
- Before showing a TL;DR, the UI verifies both the engine commit and the canonical
  deterministic-answer fingerprint returned by the backend.
- Timeout, provider failure, malformed output, or fingerprint mismatch leaves the
  full deterministic answer intact and marks the TL;DR unavailable.

The backend binds to `127.0.0.1` by default, caps questions at 240 characters,
does not enable wildcard CORS, and reports only safe configuration metadata.

## Optional LLM configuration

Provider selection is explicit; the default is `off`. Credentials remain in the
backend process environment and are never embedded in the HTML or JSON response.
Copy names from `.env.example`, but do not commit an actual `.env` file.

```bash
# Gemini example; choose and record an exact stable non-preview model before release.
export CASCADE_LLM_PROVIDER=gemini
export CASCADE_LLM_MODEL=gemini-3.8-flash
export GEMINI_API_KEY=...
python src/server.py 8765
```

Supported values for `CASCADE_LLM_PROVIDER` are `off`, `gemini`, `groq`,
`anthropic`, `openai`, `ollama`, `openai-compatible`, and the `vllm` alias.
`CASCADE_LLM_BASE_URL` configures Ollama or an OpenAI-compatible private endpoint;
`CASCADE_LLM_API_KEY` is optional for that compatible endpoint. Groq defaults to a
70B-class model rather than the less JSON-reliable 8B model.

The selector receives deterministic claim IDs (`C1…Cn`) and must return exactly
one JSON object such as `{"claims":["C2","C5"]}`. Unknown IDs, duplicates, extra
fields, prose, empty lists, and more than three IDs are rejected. The backend then
renders the original verified text and evidence IDs; raw model output is never sent
to the browser.

## Reproducible single-file build

The visual production UI is source-controlled under `web/`:

| Source | Purpose |
|---|---|
| `template.html` | production HTML and CSS with build placeholders |
| `app.js` | routes, renderers, offline engine integration, async TL;DR UI |
| `bundle.json` | deterministic data bundle, commit `0fbef8b` |
| `engine.js` | JavaScript CascadeEngine |
| `piddata.json` | embedded P&ID images |
| `photodata.json` | embedded hero and representative equipment photos |
| `photosources.json` | which source file and recipe produced each equipment photo (lets `build.py` skip unchanged ones) |
| `i18n.json` | every user-facing UI string, one object per language (English first) |
| `../assets/Cascade Logo.*` | optional logo, embedded by `build.py` (see Logo) |
| `build.py` | assertion-driven assembler |

```bash
python web/export_bundle.py      # Python artefacts -> bundle.json when data changes
python web/parity_questions.py   # regenerate parity question set when tests change
python web/parity.py             # 467 answers + 1,800 retrieval comparisons
python web/build.py              # -> web/dist/cascade.html
npm ci --prefix web
npm test --prefix web            # jsdom dual-mode and 8 asset-route checks
```

### Logo

Put the logo at **`assets/Cascade Logo.<ext>`** in the project folder that contains
`cascade/` (that is, `../assets/` from here). Accepted extensions: `.svg`, `.webp`,
`.png`, `.jpg` or `.jpeg`. The name is matched case-insensitively, so the current
`assets/CASCADE LOGO.png` is found, and an SVG wins over a raster file. `web/build.py`
embeds it once as a base64 `data:` payload in `<script id="logodata">`, the same
pattern as `photodata.json`. The logo takes the place and size of the original brand
mark: a 34 px square beside the unchanged "CASCADE / Manufacturing Knowledge Hub" text in
the sidebar, and a 32 px square in the phone top bar. It also becomes the favicon. The
mark sits on a white rounded square that stays legible on the navy navigation in both
themes. Alt text is "CASCADE logo". For a raster lockup (emblem above the word) the
browser cuts out the emblem, the tallest block of content on the flat background, for
these small squares; the embedded bytes are the original file.

**Equipment photos.** `build.py` reads `../assets/photos/<TYPE>.jpg` (also `.jpeg`, `.png`,
`.webp`), one per type that `typeOf()` in `app.js` returns: PUMP, DRYER, REACTOR, COMPRESSOR,
HEATER, VALVE, FAN, DRUM. Each is cover-cropped to 4:3, resized to 640 × 480 with Lanczos,
kept in natural sRGB colour and embedded in `photodata.json` as WebP q82 (about 40–75 KB).
A type is re-encoded only when its source changes (`photosources.json`). A missing source
keeps the current image and prints a warning; the build fails if a re-encoded photo is under
640 px wide or over 100 KB. The sources stay local (`assets/` is git-ignored); the hero image
is a separate payload and is not touched.

If the logo is missing, unreadable, larger than 1,500,000 bytes, or would push the
single file over the 10,000,000-byte cap, the build prints a warning and keeps the text
wordmark "CASCADE" and its SVG favicon. It never fails because of the logo.
`CASCADE_LOGO_DIR` overrides the folder, and `python web/test_logo.py` covers the
present, missing and oversized cases with temporary placeholders.

The build fails if a placeholder remains, if its embedded bundle or engine differs
byte-for-byte from the source, if an i18n key is missing, or if the file exceeds
10,000,000 bytes. The permanent jsdom harness stubs
`window.scrollTo = () => {}` only in `beforeParse`; production code is untouched.

## Pipeline

| Step | File | Output |
|---|---|---|
| 1 | `extract.py` | PDFs to anchored chunks with reconstructed reading order |
| 2 | `normalize.py` | 211 work orders to failure records; routine no-finding rows excluded |
| 3 | `structure.py` | OPL, interlock/permissive, and datasheet structures |
| 4 | `chain.py` | temporal causal failure chains (`--all` covers all 8 assets) |
| 5 | `link_knowledge.py` | chain-to-OPL links, lesson latency, and gap detection |
| 6 | `rag_index.py` | typed passages and reciprocal-rank fusion retrieval |
| 7 | `qa.py` | asset/intent routing, safety taxonomy, composer, gates, confidence |
| 8 | `verify.py` | deterministic verbatim and grounding gates |
| 9 | `llm.py`, `llm_client.py` | strict claim selector and provider transports |
| 10 | `server.py` | loopback HTTP API and same-origin product server |

## Evidence and safety boundaries

- The pilot has full document coverage for GA-1201A and EA-5601; the other six
  assets have work-order coverage only.
- There is no live historian. Condition-dependent answers say so and confidence is
  capped; CASCADE does not infer current safe operating state.
- Interlock set points are dummy training values, and answers surface that caveat.
- EA-5601 has no dedicated ESD trip; its documented control-loop behavior is kept
  distinct from a shutdown function.
- P&IDs remain raster reference images; the product does not claim drawing tag
  extraction.

## Release evidence

The complete commands, hashes, suite totals, dual-mode UI checks, and archive audit
are recorded in `../llm-integration-execution-log.md`. The live-provider utility
gate and its thresholds are recorded in `../claim-selector-benchmark.md`.
