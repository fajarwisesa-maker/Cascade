/* CASCADE design tokens. Brand colours come from the product's own design system,
   never from the motion-graphics guide (its palette is explicitly out of scope). */

export const COLOR = {
  navy: "#192F7B",
  cyan: "#03BED7",
  bgDeep: "#0A1733",
  bgMid: "#0D1B3A",
  bgLift: "#132449",
  ink: "#0B1222",
  white: "#FFFFFF",
  mist: "#C9D6EE",
  muted: "#8CA2C9",
  line: "#24395F",
  amber: "#F0A732",
  danger: "#E4573D",
  ok: "#2FB67C",
} as const;

export const FONT = {
  display: "Barlow Condensed",
  body: "Barlow",
  mono: "IBM Plex Mono",
} as const;

/* 1920x1080 canvas. Footage is placed at native 1280x720 - never upscaled -
   which leaves a deliberate annotation column on the right. */
export const LAYOUT = {
  W: 1920,
  H: 1080,
  margin: 96,
  footage: { x: 64, y: 180, w: 1280, h: 720 },
  rail: { x: 1392, y: 180, w: 464 },
  lowerThirdReserved: 180,
} as const;

/* Restrained easing. No overshoot anywhere; punch-in is capped at 1.12x. */
export const EASE = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),      // power3.out
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4), // power4.out
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
} as const;

export const PUNCH_MAX = 1.08;
