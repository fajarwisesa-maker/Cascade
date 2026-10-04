import React from "react";
import { Sequence, staticFile } from "remotion";
import { Stage, SceneSlug } from "../components/Stage";
import { FootageFrame } from "../components/FootageFrame";
import { Rise, Label, Headline } from "../components/Primitives";
import { COLOR, FONT, LAYOUT } from "../styles/theme";

/* S7 trust. Cues: 0 crosses-a-safeguard | 77 the-right-answer-is-no
   159 refuses-and-sends-to-MOC | 300 records-dont-cover (HARD CUT)
   423 and-it-says-so | 471 instead-of-guessing
   No sound effects at all in this scene. The abstention in particular is
   deliberately silent: no answer, no sound. */
const CUT = 300;
const CUE = { safeguard: 0, no: 77, moc: 159, cover: 0, says: 123, guessing: 171 }; // post-cut cues are relative

const RailCard: React.FC<{ at: number; children: React.ReactNode; accent?: string }> = ({
  at, children, accent = COLOR.cyan,
}) => (
  <Rise at={at} style={{ marginBottom: 26 }}>
    <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 18 }}>{children}</div>
  </Rise>
);

const Refused: React.FC = () => (
  <Stage>
    <SceneSlug>Ask CASCADE · interlock bypass</SceneSlug>
    <FootageFrame src={staticFile("footage/S7a-refused.mp4")} startFrom={141} />
    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <RailCard at={CUE.no} accent={COLOR.danger}>
        <Label color={COLOR.danger}>Status</Label>
        <Headline size={32}>Refused — escalate via MOC</Headline>
      </RailCard>
      <RailCard at={CUE.moc} accent={COLOR.danger}>
        <div style={{ fontFamily: FONT.body, fontSize: 22, color: COLOR.mist, lineHeight: 1.4 }}>
          CASCADE never advises defeating, bypassing or removing a safeguard.
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: 20, color: COLOR.muted, marginTop: 10 }}>
          Routed to Management of Change.
        </div>
      </RailCard>
    </div>
  </Stage>
);

const NotAnswered: React.FC = () => (
  <Stage>
    <SceneSlug>Ask CASCADE · outside the records</SceneSlug>
    <FootageFrame src={staticFile("footage/S7b-notanswered.mp4")} startFrom={225} />
    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <RailCard at={CUE.says} accent={COLOR.amber}>
        <Label color={COLOR.amber}>Status</Label>
        <Headline size={32}>Not answered</Headline>
      </RailCard>
      <Rise at={CUE.guessing}>
        <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 28, color: COLOR.white, lineHeight: 1.35 }}>
          “CASCADE will not guess.”
        </div>
      </Rise>
    </div>
  </Stage>
);

export const SceneWhenTheAnswerIsNo: React.FC = () => (
  <>
    <Sequence durationInFrames={CUT}><Refused /></Sequence>
    <Sequence from={CUT}><NotAnswered /></Sequence>
  </>
);
