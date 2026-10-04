# CASCADE Demo Video — FASE 5 SHOT LIST

Required before the composition can be built. Seven shots: S3, S4, S5, S6, S7, S8, S9.
S1 and S2 are motion graphics and need no capture.

## CAPTURE SPEC (applies to every shot)

| Setting | Value |
|---|---|
| Resolution | **1280x720 native. No downscale, no deviceScaleFactor trick.** |
| Frame rate | 30 fps |
| Source | `CASCADE Knowledge Hub.html` opened via file:// |
| Theme | Light mode (dark mode exists but reads worse on a projector) |
| Browser chrome | Hidden, or a neutral frame. Never a branded browser UI. |
| System audio | Muted. Voiceover is the only audio in the film. |
| Cursor | Visible ONLY in S3 (chain click) and S6 (evidence click). Hidden elsewhere. |
| Typing | Real speed. Never sped up, never slowed. |
| Between states | Stop recording, reset, start again. Do not edit inside a take. |

Each take needs ~25% more footage than the scene duration, as handles.

## SHOTS

### SHOT 1 - S3 chain reveal (28.05 s needed, record ~35 s)
- Route: `#ask`, then `#chain/CH-GA-1201A-01`
- Interaction: type `why does the hexane pump keep failing?` -> click ASK -> wait for
  the answer -> click the chain `CH-GA-1201A-01`
- Expected: `ANSWERED FROM APPROVED SOURCES`, then the chain page showing
  `4 linked failures`, `182 d first to last`, `chain score 0.71`,
  `detectable from 19 Mar 2025`, and the four-node work order timeline
- Framing: whole viewport. The timeline and the "detectable from" block must both be
  on screen at some point, since the punch-in targets them.

### SHOT 2 - S4 lesson latency (15.05 s needed, record ~20 s)
- Route: `#chains`
- Interaction: land on the page, let the timeline chart settle, scroll so the
  lesson-latency rows are fully visible
- Expected: the three latency figures `400 d`, `502 d`, `583 d` and the
  `written after chain` labels
- Framing: the chart and the three rows. No clicking needed.

### SHOT 3 - S5 the answer (27.75 s needed, record ~35 s)
- Route: `#ask`
- Interaction: type `GA-1201A tripped on high vibration, can I restart?` -> click ASK
- Expected: `SAFETY-CRITICAL` banner, `ANSWERED FROM APPROVED SOURCES`,
  `Confidence 75/100 - 18/18 checks - 0 withheld`, `VERBATIM - CHECKED`,
  `NOT VERIFIED BY CASCADE (4)`
- Framing: start on the empty ask box so the typing reads, then the full answer.
  Scroll down far enough that the NOT VERIFIED block is fully visible.
- NOTE: the voiceover leaves a 3.45 s gap for the typing beat. Record the typing
  unhurried; the editorial cut lands inside that gap.

### SHOT 4 - S6 open the source (17.40 s needed, record ~24 s)
- Route: continue from Shot 3's answer state
- Interaction: click the evidence tag `E5 - OPL`
- Expected: the right rail opens with `E5 - OPL - CITED BY 5 LINES`,
  `OPL-GA-1201A-07`, `Approved by Arya Wibisono (EMP-0912)`, and
  `EXTRACTED PAGE TEXT` with the cited lines highlighted
- Framing: keep the rail fully in frame. The extracted page text is the zoom target,
  so it must be sharp and unscrolled at the moment of the click.

### SHOT 5 - S7 refuse and abstain (18.45 s needed, record ~25 s, TWO takes)
- Take A: type `can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?`
  -> ASK. Expected `REFUSED - ESCALATE VIA MOC`, `Confidence 93/100 - 3/3 checks`,
  and the MOC escalation line.
- Take B: type `what is the warranty period of GA-1201A?` -> ASK.
  Expected `NOT ANSWERED` and "No approved source answers this. CASCADE will not guess."
- Framing: both takes identically framed, so the hard cut between them reads as a
  deliberate edit rather than a camera move.

### SHOT 6 - S8 plant insights (16.70 s needed, record ~22 s)
- Route: `#plant`
- Interaction: land on the page, let the KPI tiles and bar chart settle, scroll to
  `PATTERNS ACROSS EQUIPMENT`
- Expected: `96.5 h`, `22%`, `Rp 114.69 jt`, `5 of 8 assets affected`,
  `SHARED MECHANISMS 2`, and the POLYMER FINES FOULING panel
- Framing: the KPI row and the pattern panel. The overlay label
  `INSIDE 6 DETECTED CHAINS` will be composited over the three figures.

### SHOT 7 - S9 deployability and close (11.15 s needed, record ~16 s, TWO takes)
- Take A, desktop 1280x720: `#asset/GA-1201A`, evidence or asset view settled
- Take B, tablet landscape 1024x768: the SAME asset `#asset/GA-1201A`, showing the
  SAME evidence tag, so the reframe keeps visual continuity
- Expected: identical content on both, which is what the reframe is proving
- NOTE: this is the first scene to cut if anything runs long. Record it, but it is
  the lowest priority of the seven.

## WHAT MUST NOT APPEAR IN ANY SHOT

- Dark mode
- A browser address bar showing a local file path
- Any mobile viewport (mobile is 0% of this film)
- A millisecond figure held long enough to read as a claim (it changes per run)
- Any state other than the exact expected states listed above
