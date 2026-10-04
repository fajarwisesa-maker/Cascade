import React from "react";
import { Audio, Sequence, staticFile } from "remotion";

/* Sound design: one cue per movement.
 *
 * Levels are set per sound from its measured mean, so each cue lands roughly
 * 20 dB under the narration rather than at whatever level the file happens to
 * carry. Lengths are the real file durations, rounded up.
 *
 * Two rules survive from the approved plan and are deliberate, not oversights:
 *   - no whooshes, and nothing on a scene entering or leaving;
 *   - S7's NOT ANSWERED stays completely silent. No answer, no sound - that
 *     silence is the point of the beat, so it is the one movement with no cue.
 */
const SOUND = {
  tick:    { vol: 0.68, len: 8 },   // a discrete item being marked
  pop:     { vol: 0.13, len: 10 },  // a card or panel arriving
  snap:    { vol: 0.27, len: 10 },  // an emphasis landing
  switchy: { vol: 0.43, len: 10, file: "switch" }, // a state changing
  fill:    { vol: 1.00, len: 45 },  // a bar or line drawing itself
  counter: { vol: 0.39, len: 35 },  // figures rolling
  chime:   { vol: 0.12, len: 35 },  // the close, once
} as const;

type Key = keyof typeof SOUND;
export type Cue = { at: number; s: Key };

export const CUES: Cue[] = [
  // S1 - four work orders arrive, the link draws, each is stamped CLOSED
  { at: 3, s: "pop" }, { at: 117, s: "pop" }, { at: 186, s: "pop" }, { at: 258, s: "pop" },
  { at: 334, s: "fill" },
  { at: 441, s: "tick" }, { at: 450, s: "tick" }, { at: 459, s: "tick" }, { at: 468, s: "tick" },

  // S2 - the scale figures roll, the 36% bar fills, the files land apart
  { at: 544, s: "counter" }, { at: 693, s: "counter" },
  { at: 841, s: "fill" }, { at: 960, s: "snap" }, { at: 1009, s: "tick" },

  // S3 - each fact the detector establishes, then the warning window
  { at: 1317, s: "pop" }, { at: 1369, s: "pop" },
  { at: 1585, s: "snap" }, { at: 1761, s: "snap" }, { at: 1841, s: "tick" },

  // S4 - three latency bars, then the framing lines
  { at: 2023, s: "fill" }, { at: 2111, s: "tick" }, { at: 2139, s: "tick" },
  { at: 2233, s: "pop" }, { at: 2304, s: "tick" },

  // S5 - the answer assembles, the punch-in lands on the confidence
  { at: 2605, s: "pop" }, { at: 2712, s: "pop" }, { at: 2856, s: "snap" },
  { at: 2881, s: "pop" }, { at: 2997, s: "tick" }, { at: 3151, s: "pop" },

  // S6 - the tag is clicked, the rail opens, the cited line is found
  { at: 3238, s: "pop" }, { at: 3264, s: "snap" }, { at: 3361, s: "pop" },
  { at: 3398, s: "tick" }, { at: 3463, s: "pop" }, { at: 3696, s: "snap" },

  // S7a - the refusal is a state change
  { at: 3837, s: "switchy" }, { at: 3919, s: "pop" },
  // S7b - NOT ANSWERED: intentionally silent, no cues

  // S8 - the impact figures roll, the shared mechanism resolves
  { at: 4314, s: "counter" }, { at: 4480, s: "pop" }, { at: 4540, s: "pop" },
  { at: 4623, s: "pop" }, { at: 4686, s: "tick" },

  // S9 - three deployment badges, the reframe, one chime to close
  { at: 4815, s: "tick" }, { at: 4850, s: "tick" }, { at: 4887, s: "tick" },
  { at: 4967, s: "pop" }, { at: 5073, s: "chime" },
];

export const SfxTrack: React.FC = () => (
  <>
    {CUES.map((c, i) => {
      const s = SOUND[c.s];
      const file = "file" in s ? (s as { file: string }).file : c.s;
      return (
        <Sequence key={i} from={c.at} durationInFrames={s.len} name={`sfx:${file}`}>
          <Audio src={staticFile(`sfx/${file}.wav`)} volume={s.vol} />
        </Sequence>
      );
    })}
  </>
);
