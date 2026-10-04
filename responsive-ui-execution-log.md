# CASCADE Responsive UI Revision — Execution Log

Date: 2026-09-30

## 1. Source and no-touch guards

Source of truth before this revision:

- `CASCADE Knowledge Hub.html`: 2,848,864 bytes
- SHA-256: `37ae9e2a743ab16911cf398115264a5944e708110bb2a65b1d800c952c698c93`
- It was byte-identical to `web/dist/cascade.html`.

No-touch payload hashes remained identical before and after implementation:

| Payload | Bytes | SHA-256 before and after |
|---|---:|---|
| `web/bundle.json` | 402,229 | `b691e2cd0615dafbce157b69ccf59f9a75cf1f2382c18dddc214c388e5ebc10e` |
| `web/engine.js` | 62,007 | `2651b580bce672119effda7af3b54aa59d6cd309f7339bc4701d0f3460c7e7ce` |
| `web/piddata.json` | 1,891,931 | `77785dcb09360f584a8dab57bb33c0720504d0cabbf0416cace972d32298f7b3` |
| `web/photodata.json` | 380,235 | `4f24c186f710797ba245081dfce0551098b4303c558747fb897b37186d719883` |
| `cascade-v1.3.tar.gz` | 240,115 | `806f555f4616df078e79d619c5f042ff19442ef8de0f6cffd0637d56415ae5a1` |

The build assertion also confirmed that embedded bundle, engine, P&ID, photos, and app source are byte-identical to their source files.

## 2. Implementation

Files edited:

- `web/template.html`
- `web/app.js`
- `web/test_ui.js`
- `web/browser_responsive_audit.js` (new permanent browser gate)

Production changes:

1. Added a 56 px mobile top bar and accessible off-canvas navigation at `<=760px`, including backdrop close, Escape, focus trap, and focus return.
2. Preserved the 64 px rail at `761–1080px`; labels are available through hover/focus tooltips and the theme label no longer clips.
3. Reduced the phone Ask hero, stacked the input/button, retained one quick example, and added drill-down affordances to KPI cards.
4. Replaced the two always-open trust cards with a one-line verification summary and disclosure; moved Related Asset after answer content.
5. Replaced mobile/tablet evidence scrolling with a right sheet (`<=1080px`) and bottom sheet (`<=760px`), with backdrop, Escape, focus trap, and focus return.
6. Raised phone tap targets for navigation, answer tabs, evidence controls, asset tags, table disclosure, P&ID controls, and breadcrumbs to at least 44 px.
7. Changed provider-unavailable TL;DR treatment from amber caution to a neutral status.
8. Automatically uses table fallbacks for the Failure Chain and downtime charts at `<=430px`; chart scrolling retains an explicit cue at `431–980px`.
9. Added a dedicated Asset KPI grid: six columns on wide desktop, three on medium layouts, and two on phone/tablet; loss of containment now has icon, label, critical tint, and critical border.
10. Made Related Knowledge rows open the corresponding indexed document.
11. Added the Plant Insights chain CTA and a phone-specific callout hierarchy.
12. Added P&ID `Fit width` and `100%` controls, a pan hint, mobile fit-width default, 44 px close target, focus trap, and focus return.

No section-kind mapping, answer data, engine behavior, photo/P&ID payload, route, palette, or theme-default behavior changed.

## 3. Commands and verification

Build:

```powershell
python web/build.py
```

Result: `dist/cascade.html 2799 KB`.

Complete product gate:

```powershell
python run_all.py
```

Result: `ALL PRODUCT GATES PASSED`.

Key results:

- Golden Q&A: `28/28`
- Verbatim: `157/157`
- Grounding: `72/72`
- Regression: all pass
- Provider/selector unit tests: `9/9`
- Server contract tests: `3/3`
- LLM-core adversarial generations blocked: `9/9`; faithful selection accepted `1/1`
- Python/JavaScript retrieval parity: `1800/1800`
- Python/JavaScript answer parity: `467/467`
- Fingerprint parity: `467/467`
- jsdom structural UI gate: pass

Seven-question deep comparison against a fresh extraction of `cascade-v1.3.tar.gz`:

```powershell
python web/compare_demo.py <temporary-v1.3-working-tree>
```

Result: `DEMO DEEP COMPARISON: 7/7 IDENTICAL` for status, headline, section count, evidence-ID order, and verbatim counts.

Real-browser responsive gate:

```powershell
node web/browser_responsive_audit.js
```

Result: `PASS — 35 viewport/screen checks, 8/8 asset mappings`.

- Widths: `1440`, `1280`, `1024`, `768`, `430`, `390`, `375` CSS px
- Screens: Ask, Answer Workspace, Failure Chains, Asset Overview, Plant Insights
- No document-level horizontal overflow (`scrollWidth === clientWidth`; the browser's vertical scrollbar gutter makes `innerWidth` 15 px wider on desktop).
- Intentional overflow remains confined to table wrappers, tablet chart wrappers, and the P&ID pan container.
- At `<=760px`: nav height 56 px, all six routes reachable, drawer controls >=44 px.
- At `<=430px`: both main charts use open table fallback, Asset KPI grid has two columns, evidence uses a sheet, and P&ID starts in fit-width mode.
- Eight asset routes returned the correct type-based representative image, caption, and alt text.

Browser report and screenshots:

- `out/responsive-audit/report.json`
- `out/responsive-audit/<screen>-<width>.png`

## 4. Final artifact

`web/dist/cascade.html` was copied to the production filename only after all gates passed.

| File | Bytes | SHA-256 |
|---|---:|---|
| `CASCADE Knowledge Hub.html` | 2,866,190 | `8cd89b7691be3c6e93d7d72feda2d3af85b86ab355b7923f5234364ecb743ebd` |
| `web/dist/cascade.html` | 2,866,190 | `8cd89b7691be3c6e93d7d72feda2d3af85b86ab355b7923f5234364ecb743ebd` |

The two final HTML files are byte-identical. The production file is 28.7% of the 10,000,000-byte cap, leaving 7,133,810 bytes of margin.
