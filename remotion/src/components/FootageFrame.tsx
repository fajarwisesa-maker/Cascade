import React from "react";
import { OffthreadVideo, Img, interpolate, useCurrentFrame } from "remotion";
import { COLOR, EASE, LAYOUT, PUNCH_MAX } from "../styles/theme";

type Punch = { at: number; dur?: number; hold?: number; originX?: number; originY?: number };

/** Places a 1280x720 product capture inside the 1920x1080 canvas at NATIVE scale.
 *  The capture is never stretched to fill. An optional punch-in is capped at 1.12x,
 *  which is the only moment the footage is scaled above 100%. */
export const FootageFrame: React.FC<{
  src: string;
  startFrom?: number;          // trim-in on the source clip, in frames
  still?: boolean;             // render a PNG instead of a video
  punch?: Punch;
}> = ({ src, startFrom = 0, still = false, punch }) => {
  const f = useCurrentFrame();
  const { x, y, w, h } = LAYOUT.footage;

  let scale = 1;
  if (punch) {
    const dur = punch.dur ?? 18;
    scale = interpolate(f, [punch.at, punch.at + dur], [1, PUNCH_MAX], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.inOut,
    });
    if (punch.hold !== undefined) {
      const outAt = punch.at + dur + punch.hold;
      const back = interpolate(f, [outAt, outAt + dur], [0, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.inOut,
      });
      scale = scale - (scale - 1) * back;
    }
  }

  return (
    <div style={{
      position: "absolute", left: x, top: y, width: w, height: h,
      borderRadius: 14, overflow: "hidden",
      border: `1px solid ${COLOR.line}`,
      boxShadow: "0 28px 70px rgba(0,0,0,0.46)",
      background: COLOR.ink,
    }}>
      <div style={{
        width: w, height: h,
        transform: `scale(${scale})`,
        transformOrigin: `${(punch?.originX ?? 0.5) * 100}% ${(punch?.originY ?? 0.5) * 100}%`,
      }}>
        {still
          ? <Img src={src} style={{ width: w, height: h, display: "block" }} />
          : <OffthreadVideo src={src} startFrom={startFrom} muted
              style={{ width: w, height: h, display: "block" }} />}
      </div>
    </div>
  );
};
