import React from "react";
import { Audio, Sequence, staticFile } from "remotion";

/* Only three sounds in the whole film: a tick on a thing being marked, the
   counter while a number rolls, and one chime on the closing card. No whooshes,
   nothing on a card entering or leaving, and S5 and S7 carry no sound at all -
   the abstention in S7 is silent on purpose.
   Levels put each cue roughly 20 dB under the narration. */
const LEVEL = { tick: 0.5, counter: 0.3, chime: 0.12 } as const;

export type Cue = { at: number; sound: keyof typeof LEVEL };

export const CUES: Cue[] = [
  // S1 - each work order being stamped CLOSED
  { at: 441, sound: "tick" }, { at: 450, sound: "tick" },
  { at: 459, sound: "tick" }, { at: 468, sound: "tick" },
  // S2 - the scale figures rolling
  { at: 544, sound: "counter" },
  // S3 - each fact the detector establishes
  { at: 1317, sound: "tick" }, { at: 1369, sound: "tick" },
  { at: 1585, sound: "tick" }, { at: 1761, sound: "tick" },
  // S6 - the cited line landing
  { at: 3398, sound: "tick" },
  // S8 - the impact figures rolling
  { at: 4314, sound: "counter" },
  // S9 - the close
  { at: 5073, sound: "chime" },
];

export const SfxTrack: React.FC = () => (
  <>
    {CUES.map((c, i) => (
      <Sequence key={i} from={c.at} durationInFrames={40} name={`sfx:${c.sound}`}>
        <Audio src={staticFile(`sfx/${c.sound}.wav`)} volume={LEVEL[c.sound]} />
      </Sequence>
    ))}
  </>
);
