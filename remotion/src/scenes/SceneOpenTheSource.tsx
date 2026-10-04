import React from "react";
import { staticFile } from "remotion";
import { Stage, SceneSlug } from "../components/Stage";
import { FootageFrame } from "../components/FootageFrame";
import { InteractionRing } from "../components/Annotation";
import { Rise, Label, Headline, Mono } from "../components/Primitives";
import { COLOR, FONT, LAYOUT } from "../styles/theme";

/* S6 traceability. Cues: 0 select-any-tag | 123 who-approved-it
   160 exact-line-on-page | 225 157-quoted-lines | 309 identical-to-source
   376 if-cascade-cant-show | 458 it-doesnt-say-it
   The capture has no mouse pointer, so the click is marked with an explicit
   ring rather than a drawn-on cursor pretending to be one. */
const CUE = { select: 0, approved: 123, line: 160, verbatim: 225, identical: 309, cant: 376, doesnt: 458 };

const RailCard: React.FC<{ at: number; children: React.ReactNode; accent?: string }> = ({
  at, children, accent = COLOR.cyan,
}) => (
  <Rise at={at} style={{ marginBottom: 26 }}>
    <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 18 }}>{children}</div>
  </Rise>
);

export const SceneOpenTheSource: React.FC = () => (
  <Stage>
    <SceneSlug>Evidence · E5 · OPL-GA-1201A-07</SceneSlug>
    <FootageFrame src={staticFile("footage/S6-evidence.mp4")} startFrom={150} />
    <InteractionRing at={CUE.select + 26} x={795} y={592} />

    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <RailCard at={CUE.select}>
        <Label>One tag, one source</Label>
        <Headline size={30}>The document itself</Headline>
      </RailCard>

      <RailCard at={CUE.approved}>
        <Label>Approved by</Label>
        <div style={{ fontFamily: FONT.body, fontSize: 24, color: COLOR.white }}>
          Arya Wibisono
        </div>
        <div style={{ marginTop: 4 }}><Mono size={17}>EMP-0912 · shared 15 Apr 2026</Mono></div>
      </RailCard>

      <RailCard at={CUE.verbatim}>
        <div style={{
          fontFamily: FONT.display, fontWeight: 600, fontSize: 78, lineHeight: 1,
          color: COLOR.white, fontVariantNumeric: "tabular-nums",
        }}>157<span style={{ fontSize: 34, color: COLOR.muted }}>/157</span></div>
        <div style={{ fontFamily: FONT.body, fontSize: 21, color: COLOR.mist, marginTop: 8 }}>
          quoted lines identical to their source
        </div>
      </RailCard>

      <Rise at={CUE.doesnt} style={{ marginTop: 10 }}>
        <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 27, color: COLOR.cyan, lineHeight: 1.35 }}>
          If CASCADE cannot show you the source, it does not say it.
        </div>
      </Rise>
    </div>
  </Stage>
);
