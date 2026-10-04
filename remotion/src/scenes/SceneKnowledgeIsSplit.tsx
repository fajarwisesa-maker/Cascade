import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { Rise, CountUp, Label } from "../components/Primitives";
import { COLOR, EASE, FONT } from "../styles/theme";

/* S2 scale of the problem. Cues: 0 two-hundred-eleven | 149 thirty-one-and-434h
   297 only-36-percent | 416 knowledge-isnt-missing | 465 split-across-files */
const CUE = { wo: 0, breakdowns: 149, pct: 297, notMissing: 416, split: 465 };

const Stat: React.FC<{ at: number; value: React.ReactNode; label: string; size?: number }> = ({
  at, value, label, size = 104,
}) => (
  <Rise at={at} style={{ flex: 1 }}>
    <div style={{
      fontFamily: FONT.display, fontWeight: 600, fontSize: size, lineHeight: 1,
      color: COLOR.white, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
    }}>{value}</div>
    <div style={{
      fontFamily: FONT.body, fontSize: 19, letterSpacing: "0.08em", textTransform: "uppercase",
      color: COLOR.muted, marginTop: 10,
    }}>{label}</div>
  </Rise>
);

const FILES = ["Datasheets", "P&IDs", "Interlock C&E", "One-point lessons", "Work orders"];

export const SceneKnowledgeIsSplit: React.FC = () => {
  const f = useCurrentFrame();
  const bar = interpolate(f, [CUE.pct, CUE.pct + 30], [0, 0.36], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out,
  });
  return (
    <Stage>
      <div style={{ position: "absolute", left: 96, top: 170, width: 1728 }}>
        <Rise at={CUE.wo}>
          <Label>Committee dataset · June 2024 to December 2025 · 8 assets</Label>
        </Rise>

        <div style={{ display: "flex", gap: 40, marginTop: 36 }}>
          <Stat at={CUE.wo} label="Work orders" value={<CountUp at={CUE.wo} to={211} dur={30} />} />
          <Stat at={CUE.breakdowns} label="Breakdowns" value={<CountUp at={CUE.breakdowns} to={31} dur={26} />} />
          <Stat at={CUE.breakdowns + 20} label="Hours of downtime"
                value={<CountUp at={CUE.breakdowns + 20} to={434} dur={30} />} />
          <Stat at={CUE.breakdowns + 40} label="Maintenance cost" size={88}
                value={<>
                  <CountUp at={CUE.breakdowns + 40} to={537.77} decimals={2} dur={32} prefix="Rp " />
                  <span style={{ fontSize: 40, color: COLOR.muted }}> jt</span>
                </>} />
        </div>

        {/* only 36% of the work orders carry a reusable root cause */}
        <Rise at={CUE.pct} style={{ marginTop: 72 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <div style={{
              fontFamily: FONT.display, fontWeight: 600, fontSize: 86, lineHeight: 1,
              color: COLOR.cyan, fontVariantNumeric: "tabular-nums",
            }}>36%</div>
            <div style={{ fontFamily: FONT.body, fontSize: 28, color: COLOR.mist }}>
              of those work orders carry a root cause anyone can reuse
            </div>
          </div>
          <div style={{
            marginTop: 20, height: 12, width: 1360, borderRadius: 6,
            background: "rgba(255,255,255,0.08)", overflow: "hidden",
          }}>
            <div style={{ height: "100%", width: `${bar * 100}%`, background: COLOR.cyan }} />
          </div>
        </Rise>

        <Rise at={CUE.notMissing} style={{ marginTop: 58 }}>
          <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 38, color: COLOR.white }}>
            The knowledge is not missing.
          </div>
        </Rise>

        <Rise at={CUE.split} style={{ marginTop: 22 }}>
          <div style={{ display: "flex", gap: 14 }}>
            {FILES.map((n) => (
              <div key={n} style={{
                fontFamily: FONT.mono, fontSize: 17, color: COLOR.mist,
                border: `1px solid ${COLOR.line}`, borderRadius: 8, padding: "12px 18px",
                background: "rgba(19,36,73,0.6)",
              }}>{n}</div>
            ))}
          </div>
          <div style={{ fontFamily: FONT.body, fontSize: 26, color: COLOR.muted, marginTop: 20 }}>
            It is split across files nobody reads side by side.
          </div>
        </Rise>
      </div>
    </Stage>
  );
};
