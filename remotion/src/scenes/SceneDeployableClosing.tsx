import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { Rise } from "../components/Primitives";
import { COLOR, EASE, FONT, LAYOUT } from "../styles/theme";

/* S9 deployability and close. Cues: 0 read-only | 35 on-premise
   72 no-write-path | 152 warning-already-in-records (reframe to tablet)
   258 cascade-reads-them-together (closing card)
   The reframe shows the SAME asset on both devices, which is the only claim
   being made here: one knowledge layer, two screens. No field-readiness claim. */
const CUE = { readonly: 0, onprem: 35, nowrite: 72, reframe: 152, close: 258 };

const Badge: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => (
  <Rise at={at}>
    <div style={{
      fontFamily: FONT.mono, fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase",
      color: COLOR.cyan, border: `1px solid ${COLOR.line}`, borderRadius: 7,
      padding: "11px 18px", background: "rgba(19,36,73,0.6)",
    }}>{children}</div>
  </Rise>
);

const LOGOS = [
  "logos/cascade.webp", "logos/chandra-asri.png",
  "logos/caliber.webp", "logos/president-university.webp",
];

export const SceneDeployableClosing: React.FC = () => {
  const f = useCurrentFrame();

  /* desktop shrinks and a tablet showing the same asset takes its place */
  const rf = interpolate(f, [CUE.reframe, CUE.reframe + 26], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.inOut,
  });
  /* everything clears for the closing card */
  const out = interpolate(f, [CUE.close - 14, CUE.close + 6], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.inOut,
  });
  const closeIn = interpolate(f, [CUE.close, CUE.close + 24], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });

  const { x, y, w, h } = LAYOUT.footage;
  const dScale = 1 - rf * 0.22;
  const tabW = 660, tabH = 495;

  return (
    <Stage>
      {/* desktop, then the same asset reframed onto a tablet */}
      <div style={{ opacity: out }}>
        <div style={{
          position: "absolute", left: x, top: y, width: w, height: h,
          transform: `scale(${dScale})`, transformOrigin: "0% 50%",
          borderRadius: 14, overflow: "hidden", border: `1px solid ${COLOR.line}`,
          boxShadow: "0 28px 70px rgba(0,0,0,0.46)",
        }}>
          <Img src={staticFile("screenshots/S9-asset-desktop.png")} style={{ width: w, height: h, display: "block" }} />
        </div>

        <div style={{
          position: "absolute", left: x + w * dScale + 52, top: y + 112,
          width: tabW, height: tabH, opacity: rf,
          transform: `translateY(${(1 - rf) * 18}px)`,
          borderRadius: 12, overflow: "hidden", border: `1px solid ${COLOR.line}`,
          boxShadow: "0 22px 56px rgba(0,0,0,0.5)",
        }}>
          <Img src={staticFile("screenshots/S9-asset-tablet.png")}
               style={{ width: tabW, height: tabH, objectFit: "cover", display: "block" }} />
        </div>

        <div style={{
          position: "absolute", left: LAYOUT.margin, top: 112, display: "flex", gap: 12,
        }}>
          <Badge at={CUE.readonly}>Read-only</Badge>
          <Badge at={CUE.onprem}>On-premise</Badge>
          <Badge at={CUE.nowrite}>No write path to plant systems</Badge>
        </div>

        <Rise at={CUE.reframe + 20} style={{ position: "absolute", left: LAYOUT.margin, top: 948 }}>
          <div style={{ fontFamily: FONT.body, fontSize: 22, color: COLOR.muted }}>
            Same asset, same evidence — one knowledge layer.
          </div>
        </Rise>
      </div>

      {/* closing card. Every logo sits on white: these marks are drawn for a light
          background, and tinting them to a flat silhouette destroys them. */}
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", opacity: closeIn,
        transform: `translateY(${(1 - closeIn) * 16}px)`,
      }}>
        <div style={{
          width: 150, height: 150, borderRadius: 26, background: COLOR.white,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 18px 46px rgba(0,0,0,0.42)",
        }}>
          <Img src={staticFile("logos/cascade.webp")}
               style={{ width: 118, height: 118, objectFit: "contain" }} />
        </div>

        <div style={{
          fontFamily: FONT.body, fontWeight: 700, fontSize: 46, color: COLOR.white,
          marginTop: 34, textAlign: "center", lineHeight: 1.3, maxWidth: 1180,
        }}>
          The warning was already in the plant&rsquo;s own records.
        </div>
        <div style={{
          fontFamily: FONT.body, fontSize: 34, color: COLOR.cyan, marginTop: 10,
        }}>CASCADE is what reads them together.</div>

        <div style={{
          display: "flex", gap: 52, alignItems: "center", marginTop: 58,
          background: COLOR.white, borderRadius: 14, padding: "20px 44px",
          boxShadow: "0 14px 38px rgba(0,0,0,0.34)",
        }}>
          {LOGOS.slice(1).map((l) => (
            <Img key={l} src={staticFile(l)} style={{ height: 64, objectFit: "contain" }} />
          ))}
        </div>
      </div>
    </Stage>
  );
};
