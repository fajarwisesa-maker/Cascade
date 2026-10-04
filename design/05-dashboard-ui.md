# CASCADE — Industrial dashboard UI (single source of truth)

Applies to every screen. It extends the root `design/01–09` notes without replacing their safety
rules. The palette is fixed: only the existing CSS tokens (navy, cyan, bg, surface, ink, line,
ok/warn/crit/info and their tints, dark-mode tokens). Tints and opacity of those tokens are allowed;
no new hues.

## 1. Principles
1. **Status first.** Every screen and module opens with its state (status badge, KPI, severity)
   before any explanation.
2. **Three levels of information.**
   - L1: a headline or status line, always visible.
   - L2: key facts (KPIs, the first 5 items, fields).
   - L3: details behind a disclosure ("Show all", "How this was verified", accordions).
3. **One idea per module.** A module answers one question ("What are the steps?", "What are the limits?").
4. **No text wall.** Lines are at most 70 characters (`max-width: 70ch`). Anything longer than about
   3 lines goes behind "Show more". Engine safety and escalation wording is never truncated.
5. **Scan, then act.** The numbers are tabular, the labels are uppercase condensed, and the action
   sits in the module footer.

## 2. Type scale (compact, px)
| Token | Size / line | Use |
|---|---|---|
| micro | 11 / 1.3 mono | IDs, tags, evidence chips |
| label | 12 / 1.2 condensed 600, uppercase, .06em | field labels, module titles, tab text |
| small | 13 / 1.45 | secondary text, table cells |
| body | 14 / 1.5 | default body |
| lead | 16 / 1.4 600 | module lead lines |
| decision | 18 (phone) / 20 (≥761) / 1.3 600 | the one-line answer |
| kpi | 24 / 1.1 600 tabular | KPI values |
| title | 20 / 1.2 condensed 700, uppercase | page titles |

## 3. Spacing, radius, borders, elevation
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 only (`--s-1 --s-2 --s-3 --s-4 --s-6`). Module padding is
  12 × 16; the gap between modules is 12; the page gutter is 16 on phones and 24 on desktop.
- **Radius:** 4 for chips, inputs, badges and buttons; 6 for modules and cards. Pills are reserved
  for question chips.
- **Borders:** 1 px `--line` around every module. 1 px `--line-strong` for inputs and focus
  containers. A 3 px left rule in the status colour marks status modules (decision bar, safety,
  "not verified").
- **Elevation:** flat. Borders separate surfaces. Shadows (`--e3`) are used only for overlays: the
  evidence sheet, chat panel, glossary, P&ID viewer and tooltips.

## 4. Fonts (offline)
Barlow 400/500/600, Barlow Condensed 500/600/700 and IBM Plex Mono 400/500. Each is subset to the
latin range plus the arrows and symbols the UI uses, stored as WOFF2 in `web/fonts/` (OFL licences
alongside), and embedded by `build.py` as `@font-face` data URIs (~195 KB). There is no network
font request, and the build fails if a Google Fonts URL reappears. The 10,000,000-byte cap is
unchanged.

## 5. Components
- **Status badge:** icon + text + colour, never colour alone. It uses the status tokens (`st-*`):
  ok = answered, warn = sources only / needs detail, crit = not answered / refused.
- **KPI tile:** a number (kpi), a label (label) and an optional sub-line (small). A severity tile
  adds a 3 px left rule plus an icon and text. The whole tile is a link to the screen it
  summarises (≥44 px).
- **Data table:** sticky header (`--surface-2`), tabular numbers, row hover `--surface-2`, 36–40 px
  rows on desktop, and sorting on numeric columns where useful. No zebra striping.
- **Module card:**
  - Title bar: a label, then a count, then an optional help "?".
  - Body: up to 5 items (L2).
  - Footer: an optional action ("Show all (n)", "Open …").
- **Chip / tag:** mono 11–12 px with a 4 px radius for IDs. Question chips are pill-shaped. Every
  chip that does something is ≥44 px tall at ≤1080 px.
- **Key-value list:** a 2-column `dl` with labels in `--ink-muted` 11.5–12 px and values in
  `--ink` 13 px tabular.
- **Accordion / disclosure:** a `details/summary`, ≥44 px summary, with a chevron and text.
- **Tab strip / filter:** condensed uppercase, a 2 px underline for the current item, a count in
  parentheses, and horizontal scroll inside the strip only.
- **States:**
  - empty: one line + the next action;
  - loading: a status line ("Indexing …", "Checking the plant data…");
  - error: a crit rule + what happened + one action.

## 6. Shell
- **Desktop (>1080):** a 208 px sidebar with icons and labels, and a current item marked by a cyan
  bar plus `--nav-active` fill. There is also a 48 px top bar: section title and engine status.
- **Tablet (761–1080):** a 64 px icon rail plus the same top bar.
- **Phone (≤760):**
  - A 56 px top bar with the logo, the section title and the menu.
  - A bottom tab bar, Ask · Assets · Chains · Plant · More, that respects the safe area. "More"
    opens the drawer (Documents, Test record, Help, Glossary, Theme).
  - Content gets bottom padding so nothing hides under the bar.
- Glossary, Help and Theme controls stay in the sidebar or drawer. The glossary also opens from
  Help (orientation → "Open glossary") and from the inline term links.
- **Floating chat button:** a 56 px circle (52 px on phones), navy with a white chat icon, fixed
  20 px from the bottom-right (16 px on phones, above the tab bar), plus the safe-area insets.
  It is the only floating control and the one place a resting shadow is allowed. It opens the
  chat panel, hides while the panel is open, and takes focus back when it closes. Content gets
  bottom padding so it never covers the last row; every overlay sits above it.

## 7. Phone rules (≤760; ≤430 is the narrow phone)
- Tables become compact cards showing 3 key fields plus an expander. Modules stack in one column.
- Secondary data collapses behind disclosures.
- Every interactive target is ≥44 × 44 px. There is no horizontal page scroll, and only strips
  scroll inside themselves.
- On the Answer screen, the hero collapses to a single input row and the question line shares a
  row with "Ask something else".

## 8. Screen patterns
- **Home:**
  1. Ask module: title, input, starter chips, engine status line, Open chat.
  2. KPI status strip from real counts: assets covered, failure chains, linked events, downtime,
     cost, approved documents, loss of containment, one shared mechanism.
  3. "Go to" links to the main screens.
  4. The plant-pattern callout.
  No long intro text.
- **Answer:**
  - Order: question line, then the safety/escalation banner (unchanged, first), then the decision
    bar (status badge, asset tag, one-line answer, plain status meaning, next steps).
  - After that: the confidence line and verification disclosure, then the modules.
  - Modules: Not verified (never truncated), Steps, Limits and interlocks, History, Related
    findings, Evidence. Each shows ≤5 items plus "Show all".
  - A filter strip (All · Steps · Limits · …) narrows the modules.
  - Evidence chips keep the existing source viewer (rail, sheet or bottom sheet).
- **Lists (Assets, Chains, Documents):** a KPI strip, then a table on desktop and compact cards on
  phones. Detail pages use breadcrumbs, a header with status, KPI tiles, then modules.

## 9. Acceptance criteria (measured by `web/browser_responsive_audit.js`)
1. At 375 × 667, after a safety-critical demo question, the status badge and the one-line answer
   sit fully above the bottom tab bar without scrolling.
2. No screen scrolls sideways at any width; this is the existing sweep from 320 to 1920 px.
3. On phones every main screen is ≤2 taps away: Ask, Assets, Chains and Plant take 1 tap on the
   tab bar; Documents and Test record take More + 1.
4. All colour pairs meet WCAG AA (4.5:1 for text, 3:1 for UI marks) in light and dark. New pairs are
   listed in the commit note.
5. Touch targets are ≥44 px at ≤1080 px, the existing gate.
