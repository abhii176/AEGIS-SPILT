import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { Backdrop, Caption, Progress } from "./components/Chrome";
import { Close } from "./scenes/Close";
import { Concept } from "./scenes/Concept";
import { Hook } from "./scenes/Hook";
import { Safety } from "./scenes/Safety";
import { Workflow } from "./scenes/Workflow";
import { cues } from "./timeline";

export function Pitch() {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#061412", overflow: "hidden" }}>
      <Backdrop />
      <Hook />
      <Concept />
      <Workflow />
      <Safety />
      <Close />
      <Caption />
      <Progress />
      {cues.map((cue) => {
        const from = Math.max(0, Math.round(cue.start * fps));
        const durationInFrames = Math.ceil(cue.duration * fps) + 4;
        return (
          <Sequence
            key={cue.id}
            from={from}
            durationInFrames={durationInFrames}
            premountFor={Math.min(Math.round(0.4 * fps), from)}
          >
            <Audio src={staticFile(`audio/${cue.file}`)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
