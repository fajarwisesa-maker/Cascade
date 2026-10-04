import { Composition } from "remotion";
import { SCENES, FPS } from "./timing/manifest";
import { CascadeDemoPreview } from "./CascadeDemo";

const s3 = SCENES.find((s) => s.sceneId === "S3")!;
const s5 = SCENES.find((s) => s.sceneId === "S5")!;

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
