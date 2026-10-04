import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, EASE, FONT } from "../styles/theme";

/** Fade + rise. The one entrance move used everywhere. Nothing bounces. */
export const Rise: React.FC<{
  at: number; children: React.ReactNode; dy?: number; dur?: number; style?: React.CSSProperties;
}> = ({ at, children, dy = 26, dur = 18, style }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + dur], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });
  return (
    <div style={{ ...style, opacity: p, transform: `translateY(${(1 - p) * dy}px)` }}>
      {children}
    </div>
  );
};

/** Count-up with tabular figures so digits never jitter. */
export const CountUp: React.FC<{
  at: number; to: number; dur?: number; decimals?: number; prefix?: string; suffix?: string;
  style?: React.CSSProperties;
}> = ({ at, to, dur = 27, decimals = 0, prefix = "", suffix = "", style }) => {
  const f = useCurrentFrame();
  const v = interpolate(f, [at, at + dur], [0, to], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.outQuart,
  });
  return (
    <span style={{ fontFamily: FONT.display, fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}{v.toFixed(decimals)}{suffix}
    </span>
  );
};

/** Small uppercase label that sits above a headline. */
export const Label: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <div style={{
    fontFamily: FONT.body, fontWeight: 500, fontSize: 20, letterSpacing: "0.09em",
    textTransform: "uppercase", color: color ?? COLOR.cyan, marginBottom: 10,
  }}>{children}</div>
);

export const Headline: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({
  children, size = 44, color,
}) => (
  <div style={{
    fontFamily: FONT.body, fontWeight: 700, fontSize: size, lineHeight: 1.15,
    color: color ?? COLOR.white, letterSpacing: "-0.01em",
  }}>{children}</div>
);

/** Monospace chip for tags, IDs and evidence labels. */
export const Mono: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({
  children, size = 19, color,
}) => (
  <span style={{
    fontFamily: FONT.mono, fontWeight: 500, fontSize: size, color: color ?? COLOR.mist,
    letterSpacing: "0.01em",
  }}>{children}</span>
);
