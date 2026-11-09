import { Composition } from "remotion";
import { Pitch } from "./Pitch";
import { DURATION_SECONDS, FPS } from "./timeline";

export function RemotionRoot() {
  return (
    <Composition
      id="Pitch"
      component={Pitch}
      durationInFrames={Math.ceil(DURATION_SECONDS * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
}
