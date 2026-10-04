import React from "react";
import { interpolate, staticFile, useCurrentFrame } from "remotion";
import { Stage, SceneSlug } from "../components/Stage";
import { FootageFrame } from "../components/FootageFrame";
import { Rise, Label } from "../components/Primitives";
import { COLOR, EASE, FONT, LAYOUT } from "../styles/theme";

/* S4 lesson latency. Cues: 0 lesson-did-arrive | 68 four-hundred-days
   156 after-every-failure | 278 measures-that-delay | 349 doesnt-claim-earlier */
const CUE = { arrive: 0, days400: 68, after: 156, measures: 278, noClaim: 349 };

const LAT = [
  { chain: "CH-GA-1201A-01", days: 400, w: 0.686 },
  { chain: "CH-GA-1201A-02", days: 502, w: 0.861 },
  { chain: "CH-EA-5601-03", days: 583, w: 1.0 },
];

const Bar: React.FC<{ at: number; chain: string; days: number; w: number }> = ({ at, chain, days, w }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 26], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });
  return (
    <div style={{ marginBottom: 22, opacity: p }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 15, color: COLOR.muted, marginBottom: 6 }}>{chain}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ height: 14, width: 300 * w * p, background: COLOR.amber, borderRadius: 7 }} />
        <div style={{
          fontFamily: FONT.display, fontWeight: 600, fontSize: 34, color: COLOR.white,
          fontVariantNumeric: "tabular-nums",
        }}>{days} <span style={{ fontSize: 20, color: COLOR.amber }}>d</span></div>
      </div>
    </div>
  );
};

export const SceneLessonLatency: React.FC = () => (
  <Stage>
    <SceneSlug>Failure chains · lesson latency</SceneSlug>
    <FootageFrame src={staticFile("screenshots/S4-chains-latency.png")} still />
    <div style={{ position: "absolute", left: LAYOUT.rail.x, top: LAYOUT.rail.y, width: LAYOUT.rail.w }}>
      <Rise at={CUE.arrive}>
        <Label color={COLOR.amber}>Days until the first covering lesson</Label>
      </Rise>
      <div style={{ marginTop: 22 }}>
        <Bar at={CUE.days400} {...LAT[0]} />
        <Bar at={CUE.after} {...LAT[1]} />
        <Bar at={CUE.after + 28} {...LAT[2]} />
      </div>
      <Rise at={CUE.measures} style={{ marginTop: 18 }}>
        <div style={{ fontFamily: FONT.body, fontSize: 22, color: COLOR.mist, lineHeight: 1.4 }}>
          Every linked failure had already happened before the lesson was shared.
        </div>
      </Rise>
      <Rise at={CUE.noClaim} style={{ marginTop: 22 }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 16, letterSpacing: "0.05em", color: COLOR.cyan,
          textTransform: "uppercase", lineHeight: 1.5,
        }}>CASCADE measures the delay<br />· it does not claim the lesson came earlier</div>
      </Rise>
    </div>
  </Stage>
);
