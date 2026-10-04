import React from "react";
import { AbsoluteFill } from "remotion";
import { COLOR, LAYOUT } from "../styles/theme";

/** Shared background for every scene: a restrained industrial navy field. */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{
    background: `radial-gradient(1200px 820px at 18% 12%, ${COLOR.bgLift} 0%, ${COLOR.bgMid} 46%, ${COLOR.bgDeep} 100%)`,
  }}>
    {children}
  </AbsoluteFill>
);

/** Scene caption in the top-left corner, outside the footage frame. */
export const SceneSlug: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    position: "absolute", left: LAYOUT.margin - 32, top: 72,
    fontFamily: "Barlow", fontWeight: 500, fontSize: 19, letterSpacing: "0.16em",
    textTransform: "uppercase", color: COLOR.muted,
  }}>{children}</div>
);
