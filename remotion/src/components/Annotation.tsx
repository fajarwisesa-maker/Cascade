import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, EASE, FONT, LAYOUT } from "../styles/theme";

/** A callout pinned over the footage. Used for the disambiguation labels that
 *  Fase 4 requires (chain duration vs warning window, "inside 6 detected chains"). */
export const Callout: React.FC<{
  at: number; x: number; y: number; width?: number;
  tone?: "cyan" | "amber" | "danger";
  title: string; body?: string;
}> = ({ at, x, y, width = 420, tone = "cyan", title, body }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 16], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });
  const accent = tone === "amber" ? COLOR.amber : tone === "danger" ? COLOR.danger : COLOR.cyan;
  return (
    <div style={{
      position: "absolute", left: x, top: y, width,
      opacity: p, transform: `translateY(${(1 - p) * 14}px)`,
      background: "rgba(10,23,51,0.93)",
      borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: "14px 18px",
      boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 17, fontWeight: 500, letterSpacing: "0.04em",
        color: accent, textTransform: "uppercase",
      }}>{title}</div>
      {body ? (
        <div style={{ fontFamily: FONT.body, fontSize: 21, color: COLOR.mist, marginTop: 6, lineHeight: 1.35 }}>
          {body}
        </div>
      ) : null}
    </div>
  );
};

/** Ring drawn at an interaction point. The headless capture has no mouse pointer,
 *  so this is an explicit annotation - it never pretends to be a real cursor. */
export const InteractionRing: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 20], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });
  const fade = interpolate(f, [at + 20, at + 34], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const r = 10 + p * 24;
  return (
    <div style={{
      position: "absolute", left: LAYOUT.footage.x + x - r, top: LAYOUT.footage.y + y - r,
      width: r * 2, height: r * 2, borderRadius: "50%",
      border: `2px solid ${COLOR.cyan}`, opacity: fade * 0.9,
    }} />
  );
};

/** Thin rule that draws itself left-to-right. Used to tie a callout to its target. */
export const Leader: React.FC<{ at: number; x: number; y: number; w: number }> = ({ at, x, y, w }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 14], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.inOut,
  });
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: w * p, height: 2,
      background: COLOR.cyan, opacity: 0.8,
    }} />
  );
};
