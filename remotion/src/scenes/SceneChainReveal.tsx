import React from "react";
import { AbsoluteFill, Audio, staticFile, Sequence } from "remotion";
import { Stage, SceneSlug } from "../components/Stage";
import { FootageFrame } from "../components/FootageFrame";
import { Rise, Label, Headline, Mono } from "../components/Primitives";
import { COLOR, FONT, LAYOUT } from "../styles/theme";

/* S3 - the aha. Phrase cues measured from the recorded voiceover:
   0 reads-together | 63 links-by-mechanism | 147 rebuilds-chain | 204 four-failures
   256 one-root-cause | 381 marks-the-day | 472 19-March | 558 from-that-day
   648 159-days | 728 measured-not-predicted
   The footage scrolls on its own, so there is no punch-in here: two competing
   motions would fight. The rail carries the explanation instead. */

const CUE = { four: 204, cause: 256, detect: 472, window: 648, measured: 728 };

const RailCard: React.FC<{ at: number; children: React.ReactNode; accent?: string }> = ({
  at, children, accent = COLOR.cyan,
}) => (
  <Rise at={at} style={{ marginBottom: 26 }}>
    <div style={{
      borderLeft: `3px solid ${accent}`, paddingLeft: 18,
    }}>{children}</div>
  </Rise>
);

export const SceneChainReveal: React.FC = () => (
  <Stage>
    <SceneSlug>Failure chain · CH-GA-1201A-01</SceneSlug>

    {/* real product capture, native 1280x720, never upscaled */}
    <FootageFrame src={staticFile("footage/S3-chain.mp4")} startFrom={120} />

    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <RailCard at={CUE.four}>
        <Label>Linked by the detector</Label>
        <Headline size={40}>4 linked failures</Headline>
        <div style={{ marginTop: 8, fontFamily: FONT.body, fontSize: 19, color: COLOR.muted }}>
          <Mono size={18}>182 d</Mono>
          {" chain duration · 23 Feb → 25 Aug 2025"}
        </div>
      </RailCard>

      <RailCard at={CUE.cause}>
        <Label>Root mechanism</Label>
        <Headline size={34}>Misalignment</Headline>
      </RailCard>

      <RailCard at={CUE.detect} accent={COLOR.amber}>
        <Label color={COLOR.amber}>Became detectable</Label>
        <Headline size={36}>19 March 2025</Headline>
        <div style={{ fontFamily: FONT.body, fontSize: 19, color: COLOR.muted, marginTop: 6 }}>
          at the second linked work order
        </div>
      </RailCard>

      <RailCard at={CUE.window} accent={COLOR.amber}>
        <div style={{
          fontFamily: FONT.display, fontWeight: 600, fontSize: 92, lineHeight: 1,
          color: COLOR.white, fontVariantNumeric: "tabular-nums",
        }}>159 <span style={{ fontSize: 40, color: COLOR.amber }}>days</span></div>
        <div style={{ fontFamily: FONT.body, fontSize: 20, color: COLOR.mist, marginTop: 8, lineHeight: 1.35 }}>
          from detectable to the last failure in this chain
        </div>
      </RailCard>

      <Rise at={CUE.measured}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 17, letterSpacing: "0.05em",
          color: COLOR.cyan, textTransform: "uppercase",
        }}>Measured from the records · not predicted</div>
      </Rise>
    </div>
  </Stage>
);
