import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import "./styles/fonts";
import { SCENES } from "./timing/manifest";
import { SfxTrack } from "./components/Sfx";

import { SceneFourWorkOrders } from "./scenes/SceneFourWorkOrders";
import { SceneKnowledgeIsSplit } from "./scenes/SceneKnowledgeIsSplit";
import { SceneChainReveal } from "./scenes/SceneChainReveal";
import { SceneLessonLatency } from "./scenes/SceneLessonLatency";
import { SceneAnswerThatHoldsUp } from "./scenes/SceneAnswerThatHoldsUp";
import { SceneOpenTheSource } from "./scenes/SceneOpenTheSource";
import { SceneWhenTheAnswerIsNo } from "./scenes/SceneWhenTheAnswerIsNo";
import { SceneOneMechanismFiveAssets } from "./scenes/SceneOneMechanismFiveAssets";
import { SceneDeployableClosing } from "./scenes/SceneDeployableClosing";

const REGISTRY: Record<string, React.FC> = {
  SceneFourWorkOrders,
  SceneKnowledgeIsSplit,
  SceneChainReveal,
  SceneLessonLatency,
  SceneAnswerThatHoldsUp,
  SceneOpenTheSource,
  SceneWhenTheAnswerIsNo,
  SceneOneMechanismFiveAssets,
  SceneDeployableClosing,
};

/** The film. Scene boundaries and every animation cue come from the timing
 *  manifest, which was measured from the recorded voiceover - so the picture
 *  follows the voice rather than the other way round. */
export const CascadeDemo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#0A1733" }}>
    {SCENES.map((s) => {
      const Scene = REGISTRY[s.component];
      return (
        <Sequence key={s.sceneId} from={s.startFrame} durationInFrames={s.durationInFrames} name={s.sceneId}>
          <Scene />
        </Sequence>
      );
    })}
    <Audio src={staticFile("audio/voiceover.mp3")} />
    <SfxTrack />
  </AbsoluteFill>
);

/** Preview kept for the two core scenes, so they can be re-checked in isolation. */
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
