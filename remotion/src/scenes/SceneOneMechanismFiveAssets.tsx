import React from "react";
import { staticFile } from "remotion";
import { Stage, SceneSlug } from "../components/Stage";
import { FootageFrame } from "../components/FootageFrame";
import { Rise, CountUp, Label } from "../components/Primitives";
import { COLOR, FONT, LAYOUT } from "../styles/theme";

/* S8 measured impact. Cues: 0 six-chains-96.5h | 166 twenty-two-percent
   226 five-of-six-one-mechanism | 309 addressable-exposure | 372 flags-gaps
   Every figure here is a total across all six detected chains, so each one
   carries that label explicitly. "Exposure", never "saving". */
const CUE = { hours: 0, pct: 166, mech: 226, exposure: 309, gap: 372 };
const ASSETS = ["EA-5601", "FA-8901", "GA-1201A", "KC-4501", "YD-2301"];

export const SceneOneMechanismFiveAssets: React.FC = () => (
  <Stage>
    <SceneSlug>Plant insights · shared mechanism</SceneSlug>
    <FootageFrame src={staticFile("screenshots/S8-plant-pattern.png")} still />

    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <Rise at={CUE.hours}>
        <Label>Inside 6 detected chains</Label>
        <div style={{
          fontFamily: FONT.display, fontWeight: 600, fontSize: 92, lineHeight: 1,
          color: COLOR.white, fontVariantNumeric: "tabular-nums",
        }}>
          <CountUp at={CUE.hours} to={96.5} decimals={1} dur={30} />
          <span style={{ fontSize: 36, color: COLOR.muted }}> h</span>
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: 20, color: COLOR.muted, marginTop: 4 }}>
          of recorded downtime
        </div>
      </Rise>

      <Rise at={CUE.pct} style={{ marginTop: 28 }}>
        <div style={{ fontFamily: FONT.body, fontSize: 26, color: COLOR.mist }}>
          <span style={{ color: COLOR.cyan, fontWeight: 700 }}>22%</span> of the plant total
        </div>
      </Rise>

      <Rise at={CUE.mech} style={{ marginTop: 30 }}>
        <Label>5 of 6 chains · one mechanism</Label>
        <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 30, color: COLOR.white, marginBottom: 12 }}>
          Polymer fines fouling
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ASSETS.map((a) => (
            <span key={a} style={{
              fontFamily: FONT.mono, fontSize: 15, color: COLOR.mist,
              border: `1px solid ${COLOR.line}`, borderRadius: 5, padding: "5px 9px",
            }}>{a}</span>
          ))}
        </div>
      </Rise>

      <Rise at={CUE.exposure} style={{ marginTop: 28 }}>
        <div style={{ fontFamily: FONT.body, fontSize: 24, color: COLOR.white }}>
          Rp 114.69 jt inside those chains
        </div>
        <div style={{
          fontFamily: FONT.mono, fontSize: 15, letterSpacing: "0.05em", color: COLOR.cyan,
          textTransform: "uppercase", marginTop: 6,
        }}>Addressable exposure · not a saving</div>
      </Rise>

      <Rise at={CUE.gap} style={{ marginTop: 24 }}>
        <div style={{ fontFamily: FONT.body, fontSize: 20, color: COLOR.muted, lineHeight: 1.4 }}>
          And it flags a recurring failure mode with no covering lesson yet.
        </div>
      </Rise>
    </div>
  </Stage>
);
