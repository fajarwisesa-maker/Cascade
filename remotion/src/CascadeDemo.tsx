import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import "./styles/fonts";
import { SCENES } from "./timing/manifest";
import { SceneChainReveal } from "./scenes/SceneChainReveal";
import { SceneAnswerThatHoldsUp } from "./scenes/SceneAnswerThatHoldsUp";

const REGISTRY: Record<string, React.FC> = {
  SceneChainReveal,
  SceneAnswerThatHoldsUp,
};

/** Preview build: the two core scenes, S3 and S5, cut back to back with the
 *  real voiceover for each one trimmed from the master recording. Scene
 *  boundaries and every animation cue come from the timing manifest. */
export const CascadeDemoPreview: React.FC = () => {
  const s3 = SCENES.find((s) => s.sceneId === "S3")!;
  const s5 = SCENES.find((s) => s.sceneId === "S5")!;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0A1733" }}>
      <Sequence durationInFrames={s3.durationInFrames}>
        <SceneChainReveal />
        <Audio src={staticFile("audio/voiceover.mp3")} startFrom={s3.startFrame} />
      </Sequence>
      <Sequence from={s3.durationInFrames} durationInFrames={s5.durationInFrames}>
        <SceneAnswerThatHoldsUp />
        <Audio src={staticFile("audio/voiceover.mp3")} startFrom={s5.startFrame} />
      </Sequence>
    </AbsoluteFill>
  );
};
