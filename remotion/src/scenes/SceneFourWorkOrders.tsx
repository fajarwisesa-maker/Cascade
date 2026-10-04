import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { Rise } from "../components/Primitives";
import { CHAIN_WOS } from "../data/workOrders";
import { COLOR, EASE, FONT } from "../styles/theme";

/* S1 hook. Cues: 3 first-card | 117 second | 186 third | 258 fourth
   334 four-work-orders | 441 closed-as-routine
   The link line starts but deliberately stops at 70% - the connection is the
   thing the film has not earned yet. */
const CARD_AT = [3, 117, 186, 258];
const CLOSED_AT = 441;
const LINE_AT = 334;

const Card: React.FC<{ i: number }> = ({ i }) => {
  const f = useCurrentFrame();
  const wo = CHAIN_WOS[i];
  const stampAt = CLOSED_AT + i * 9;
  const stamp = interpolate(f, [stampAt, stampAt + 12], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });
  return (
    <Rise at={CARD_AT[i]} dy={30} dur={20} style={{ flex: 1 }}>
      <div style={{
        background: "rgba(19,36,73,0.86)", border: `1px solid ${COLOR.line}`,
        borderRadius: 12, padding: "22px 22px 26px", height: 268, position: "relative",
      }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 17, color: COLOR.cyan, letterSpacing: "0.04em" }}>
          {wo.id}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 15, color: COLOR.muted, marginTop: 4 }}>
          {wo.date}
        </div>
        <div style={{
          fontFamily: FONT.body, fontSize: 23, lineHeight: 1.3, color: COLOR.white, marginTop: 18,
        }}>{wo.text}</div>
        <div style={{
          position: "absolute", left: 22, bottom: 22, display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{
            fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.06em", color: COLOR.muted,
            border: `1px solid ${COLOR.line}`, borderRadius: 4, padding: "3px 8px",
          }}>{wo.tag}</span>
          <span style={{
            fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.1em", color: COLOR.ok,
            border: `1px solid ${COLOR.ok}`, borderRadius: 4, padding: "3px 8px",
            opacity: stamp, transform: `scale(${0.96 + stamp * 0.04})`,
          }}>CLOSED</span>
        </div>
      </div>
    </Rise>
  );
};

export const SceneFourWorkOrders: React.FC = () => {
  const f = useCurrentFrame();
  /* the connector draws, then stops short of joining the last card */
  const line = interpolate(f, [LINE_AT, LINE_AT + 70], [0, 0.7], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.inOut,
  });
  return (
    <Stage>
      <div style={{ position: "absolute", left: 96, top: 286, width: 1728 }}>
        <div style={{ display: "flex", gap: 26 }}>
          {CHAIN_WOS.map((_, i) => <Card key={i} i={i} />)}
        </div>
        <div style={{ position: "relative", height: 3, marginTop: 44 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 3, width: 1728 * line, background: COLOR.cyan, opacity: 0.55 }} />
        </div>
        <Rise at={CLOSED_AT + 40} style={{ marginTop: 40, textAlign: "center" }}>
          <div style={{ fontFamily: FONT.body, fontSize: 30, color: COLOR.mist }}>
            Four work orders. Four separate repairs.
          </div>
        </Rise>
      </div>
    </Stage>
  );
};
