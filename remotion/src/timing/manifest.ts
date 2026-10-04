/* CASCADE demo video - timing manifest.
 * DERIVED FROM THE ACTUAL RECORDED VOICEOVER, not from the Fase 4 estimates.
 * Voiceover is the master timeline (Fase 5 hard rule): every scene boundary below
 * sits in a real pause measured in public/audio/voiceover.wav.
 * Source VO: 171.650625 s, normalised to -16 LUFS (gain only, duration untouched).
 * Max drift vs the approved Fase 4 estimate: 0.85 s.
 */

export const FPS = 30;
export const TOTAL_FRAMES = 5150; // 171.67 s = 2:51.67

export type Scene = {
  sceneId: string;
  component: string;
  startFrame: number;
  endFrame: number;
  durationInFrames: number;
  voiceoverCue: string;
  visualCue: string;
  productCue: string | null;
  sfx: string;
  /* Frame offsets, relative to the scene start, of each spoken phrase.
     Animations land on these, never on arbitrary round numbers. */
  phraseCues: number[];
};

export const SCENES: Scene[] = [
  {
    sceneId: "S1",
    component: "SceneFourWorkOrders",
    startFrame: 0,
    endFrame: 544,
    durationInFrames: 544,
    voiceoverCue: "A pump trips on high vibration...",
    visualCue: "4 work-order cards rise, CLOSED stamps, link line stops at 70%",
    productCue: null,
    sfx: "tick x4 (CLOSED stamps)",
    phraseCues: [3, 86, 117, 186, 258, 334, 441],
  },
  {
    sceneId: "S2",
    component: "SceneKnowledgeIsSplit",
    startFrame: 544,
    endFrame: 1113,
    durationInFrames: 569,
    voiceoverCue: "Across eighteen months, this plant logged...",
    visualCue: "count-up 211/31/434h/Rp537.77jt, 36% bar, 5 separate file icons",
    productCue: null,
    sfx: "counter x1",
    phraseCues: [0, 149, 297, 416, 465],
  },
  {
    sceneId: "S3",
    component: "SceneChainReveal",
    startFrame: 1113,
    endFrame: 1955,
    durationInFrames: 842,
    voiceoverCue: "CASCADE reads them together...",
    visualCue: "chain timeline node reveal + line construction, punch-in on detectable 19 Mar 2025",
    productCue: "#ask type 'why does the hexane pump keep failing?' -> cut -> #chain/CH-GA-1201A-01",
    sfx: "tick x4 (nodes)",
    phraseCues: [0, 63, 147, 204, 256, 381, 472, 558, 648, 728],
  },
  {
    sceneId: "S4",
    component: "SceneLessonLatency",
    startFrame: 1955,
    endFrame: 2406,
    durationInFrames: 451,
    voiceoverCue: "The lesson did arrive...",
    visualCue: "lesson-latency bars 400/502/583 d, tint on 'written after chain'",
    productCue: "#chains + Lesson Latency panel",
    sfx: "none",
    phraseCues: [0, 68, 156, 219, 278, 349],
  },
  {
    sceneId: "S5",
    component: "SceneAnswerThatHoldsUp",
    startFrame: 2406,
    endFrame: 3238,
    durationInFrames: 832,
    voiceoverCue: "So when an engineer asks the question that actually matters...",
    visualCue: "answer anatomy, punch-in headline, reframe to NOT VERIFIED block",
    productCue: "#ask type 'GA-1201A tripped on high vibration, can I restart?'",
    sfx: "none",
    phraseCues: [0, 199, 306, 396, 450, 475, 548, 591, 633, 668, 745],
  },
  {
    sceneId: "S6",
    component: "SceneOpenTheSource",
    startFrame: 3238,
    endFrame: 3760,
    durationInFrames: 522,
    voiceoverCue: "Select any evidence tag...",
    visualCue: "evidence rail opens, zoom+pan to extracted page text, highlight cited line",
    productCue: "click evidence tag E5 OPL, rail opens",
    sfx: "tick x1 (highlight)",
    phraseCues: [0, 123, 160, 225, 309, 376, 458],
  },
  {
    sceneId: "S7",
    component: "SceneWhenTheAnswerIsNo",
    startFrame: 3760,
    endFrame: 4314,
    durationInFrames: 554,
    voiceoverCue: "And when the request crosses a safeguard...",
    visualCue: "REFUSED pill, hard cut, NOT ANSWERED (silent)",
    productCue: "#ask bypass question -> REFUSED; then warranty question -> NOT ANSWERED",
    sfx: "none - deliberate silence",
    phraseCues: [0, 77, 159, 300, 423, 471],
  },
  {
    sceneId: "S8",
    component: "SceneOneMechanismFiveAssets",
    startFrame: 4314,
    endFrame: 4815,
    durationInFrames: 501,
    voiceoverCue: "Across the plant, six detected chains...",
    visualCue: "5 asset tags link to POLYMER FINES FOULING, count-up with INSIDE 6 DETECTED CHAINS label",
    productCue: "#plant Plant Insights",
    sfx: "counter x1",
    phraseCues: [0, 166, 226, 309, 372],
  },
  {
    sceneId: "S9",
    component: "SceneDeployableClosing",
    startFrame: 4815,
    endFrame: 5150,
    durationInFrames: 335,
    voiceoverCue: "Read-only. On-premise.",
    visualCue: "read-only diagram, reframe desktop->tablet, closing card + logos",
    productCue: "#asset/GA-1201A desktop then tablet-landscape reframe",
    sfx: "chime x1",
    phraseCues: [0, 35, 72, 152, 258],
  },
];

/* S5 carries a 3.45 s pause (abs 83.40-86.85 s) that the voiceover leaves for the
   typing beat. The editorial cut from typing to result goes inside it. */
export const S5_TYPING_GAP = { startFrame: 96, endFrame: 199 };
