import { Composition } from "remotion";
import { SCENES, FPS, TOTAL_FRAMES } from "./timing/manifest";
import { CascadeDemo, CascadeDemoPreview } from "./CascadeDemo";

const s3 = SCENES.find((s) => s.sceneId === "S3")!;
const s5 = SCENES.find((s) => s.sceneId === "S5")!;

/* Remotion rejects underscores in a composition id, so the brief's
   CASCADE_DEMO_FINAL is spelled with hyphens here. */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CASCADE-DEMO-FINAL"
        component={CascadeDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="CASCADE-PREVIEW-S3-S5"
        component={CascadeDemoPreview}
        durationInFrames={s3.durationInFrames + s5.durationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
