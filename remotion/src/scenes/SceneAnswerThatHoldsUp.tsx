import React from "react";
import { staticFile } from "remotion";
import { Stage, SceneSlug } from "../components/Stage";
import { FootageFrame } from "../components/FootageFrame";
import { Rise, Label, Headline, Mono } from "../components/Primitives";
import { COLOR, FONT, LAYOUT } from "../styles/theme";

/* S5 - the trusted answer. Phrase cues from the recorded voiceover:
   0 engineer-asks | (96-199 typing gap the narration leaves) | 199 answers-from-approved
   306 every-line-carries-source | 396 checked-word-for-word | 450 confidence
   475 seventy-five | 548 eighteen-checks | 591 eighteen-passed | 633 nothing-withheld
   668 states-what-it-cannot-see | 745 no-live-plant-data
   The punch-in sits at 450, inside the window where the capture has stopped
   scrolling, so the only motion on screen is the scale. It is anchored to the
   left edge: a centred origin crops the product sidebar mid-word, which reads
   as a broken frame rather than a deliberate zoom. */

const CUE = { answered: 199, source: 306, confidence: 475, checks: 591, notVerified: 745 };

const RailCard: React.FC<{ at: number; children: React.ReactNode; accent?: string }> = ({
  at, children, accent = COLOR.cyan,
}) => (
  <Rise at={at} style={{ marginBottom: 28 }}>
    <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 18 }}>{children}</div>
  </Rise>
);

export const SceneAnswerThatHoldsUp: React.FC = () => (
  <Stage>
    <SceneSlug>Ask CASCADE · GA-1201A</SceneSlug>

    <FootageFrame
      src={staticFile("footage/S5-answer.mp4")}
      startFrom={40}
      punch={{ at: CUE.confidence - 25, dur: 22, hold: 70, originX: 0, originY: 0.42 }}
    />

    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <RailCard at={CUE.answered}>
        <Label>Status</Label>
        <Headline size={32}>Answered from approved sources</Headline>
      </RailCard>

      <RailCard at={CUE.source}>
        <Label>Every line</Label>
        <div style={{ fontFamily: FONT.body, fontSize: 22, color: COLOR.mist, lineHeight: 1.35 }}>
          carries the source it came from
        </div>
        <div style={{ marginTop: 8 }}><Mono size={18}>VERBATIM · CHECKED</Mono></div>
      </RailCard>

      <RailCard at={CUE.confidence}>
        <Label>Confidence</Label>
        <div style={{
          fontFamily: FONT.display, fontWeight: 600, fontSize: 86, lineHeight: 1,
          color: COLOR.white, fontVariantNumeric: "tabular-nums",
        }}>75<span style={{ fontSize: 36, color: COLOR.muted }}>/100</span></div>
      </RailCard>

      <RailCard at={CUE.checks}>
        <div style={{ fontFamily: FONT.body, fontSize: 26, color: COLOR.white }}>
          18 of 18 checks passed
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: 20, color: COLOR.muted, marginTop: 4 }}>
          0 statements withheld
        </div>
      </RailCard>

      <RailCard at={CUE.notVerified} accent={COLOR.amber}>
        <Label color={COLOR.amber}>And what it cannot see</Label>
        <div style={{ fontFamily: FONT.body, fontSize: 21, color: COLOR.mist, lineHeight: 1.35 }}>
          No live historian in this pilot
        </div>
      </RailCard>
    </div>
  </Stage>
);
