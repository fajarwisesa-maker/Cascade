# CASCADE Demo Video — FASE 4 FINAL SCRIPT

Status: **AWAITING APPROVAL**. Runtime target 2:52 (172s), hard max 3:00.
VO = master timeline. Record only after this script is approved.

## RUNTIME BUDGET

| Seg | Timestamp | Dur | Words | wpm |
|---|---|---|---|---|
| S1 | 0:00-0:18 | 18s | 34 | 113 |
| S2 | 0:18-0:37 | 19s | 47 | 148 |
| S3 | 0:37-1:05 | 28s | 62 | 133 |
| S4 | 1:05-1:20 | 15s | 30 | 120 |
| S5 | 1:20-1:47 | 27s | 56 | 124 |
| S6 | 1:47-2:05 | 18s | 43 | 143 |
| S7 | 2:05-2:24 | 19s | 35 | 111 |
| S8 | 2:24-2:40 | 16s | 40 | 150 |
| S9 | 2:40-2:52 | 12s | 25 | 125 |
| **Total** | | **172s** | **372** | **130** |

## VOICEOVER (record in these blocks)

**S1** — A pump trips on high vibration. Weeks later, cracked grout under the
baseplate. Then a bearing running hot. Then the coupling fails. Four work orders.
Four separate repairs. Every one of them closed as routine.

**S2** — Across eighteen months, this plant logged two hundred eleven work orders.
Thirty-one were breakdowns. Four hundred thirty-four hours of downtime. And only
thirty-six percent carry a root cause anyone can reuse. The knowledge isn't
missing - it's split across files nobody reads side by side.

**S3** — CASCADE reads them together. It links work orders by mechanism, component
and timing, and rebuilds the chain. Four linked failures. One root cause:
misalignment. And it marks the day the pattern became readable - the nineteenth of
March, twenty twenty-five. From that day to the final failure in this chain: a
hundred and fifty-nine days. Measured from the records. Not predicted.

**S4** — The lesson did arrive - four hundred days after the first failure, and
after every linked failure had already happened. CASCADE measures that delay. It
doesn't claim the lesson came earlier.

**S5** — So when an engineer asks the question that actually matters -- (pause
while typing) -- CASCADE answers from approved documents only. Every line carries
the source it came from, checked word for word. Confidence, seventy-five out of a
hundred. Eighteen checks, eighteen passed, nothing withheld. And it states plainly
what it cannot see: there is no live plant data here.

**S6** — Select any evidence tag and you land on the document itself - who approved
it, and the exact line on the page. A hundred and fifty-seven quoted lines, all
identical to their source. If CASCADE can't show you the source, it doesn't say it.

**S7** — And when the request crosses a safeguard, the right answer is no. CASCADE
refuses, and sends it to Management of Change. Ask it something the records don't
cover -- (hard cut) -- and it says so, instead of guessing.

**S8** — Across the plant, six detected chains hold ninety-six and a half hours of
downtime - twenty-two percent of the total. Five of the six share one mechanism.
That's addressable exposure. CASCADE also flags recurring failures with no lesson yet.

**S9** — Read-only. On-premise. No write path to plant systems. The warning was
already in the plant's own records. CASCADE is what reads them together.

## DEMO QUESTIONS (verbatim, never paraphrase)

- S3: `why does the hexane pump keep failing?`
- S5: `GA-1201A tripped on high vibration, can I restart?`
- S7a: `can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?`
- S7b: `what is the warranty period of GA-1201A?`

## RUNTIME-VERIFIED ON-SCREEN NUMBERS

- S3 chain: `4 linked failures` `182 d first to last` `chain score 0.71`
  `detectable from 19 Mar 2025` `400 d until the lesson was published`
- S5 answer: `Confidence 75/100 - 18/18 checks - 0 withheld` (NOT 16/16; that is
  the Test Record verbatim column on a different screen)
- S8 plant: `96.5 h` `22%` `Rp 114.69 jt` = totals for ALL 6 chains, must be
  labelled `INSIDE 6 DETECTED CHAINS`. `5 of 8 assets affected`. `SHARED MECHANISMS 2`.
  Per mechanism: fouling 90 h / Rp 102.06 jt; misalignment 6.5 h / Rp 12.63 jt.

## REQUIRED OVERLAYS (disambiguation)

- S3: `CHAIN DURATION - 23 FEB -> 25 AUG 2025` on the 182 d figure
- S3: `DETECTABLE 19 MAR 2025 -> LAST FAILURE 25 AUG 2025 = 159 DAYS`
- S8: `INSIDE 6 DETECTED CHAINS` on 96.5 h / 22% / Rp 114.69 jt

## SFX (only three sounds, -20 dB under VO, no whoosh)

- `tick`: S1 x4, S3 x4, S6 x1 = 9
- `counter`: S2 x1, S8 x1 = 2
- `chime`: S9 x1 = 1
- S4, S5, S7 carry no SFX. NOT ANSWERED (S7) is deliberately silent.

## HARD PROHIBITIONS

- No "predict" / "forecast" anywhere
- No 159-day claim for the hexane chain CH-GA-1201A-02
- No "saving" - only "exposure"
- No 72/72, no 9/9
- No millisecond figure (it changes every run: observed 21, 23, 26 ms)
- No "mobile-ready" / "field-ready" / "fully responsive"
- No roadmap item presented as current capability
- Tag is always GA-1201A
- No speed-ramping of product interactions

## CAPTURE SPEC

- Screen recordings: **1280x720 native, no downscale**
- Final render: 1920x1080 @ 30fps, H.264/MP4; footage placed with padding and
  frame, never stretched
- Shot-list covering S3, S4, S5, S6, S7, S8, S9 due at start of Fase 5
- If recorded VO runs long, cut S9 first
