import { interpolate, spring } from "remotion";
import { useCurrentFrame, useVideoConfig } from "remotion";
import data from "./timeline.json";

export type Cue = {
  id: string;
  scene: string;
  visual: string;
  caption: string;
  file: string;
  start: number;
  duration: number;
};

export const FPS = data.fps;
export const DURATION_SECONDS = data.duration;
export const cues = data.cues as Cue[];

export function useClock() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  let cue = cues[0];
  for (const candidate of cues) {
    if (time >= candidate.start) cue = candidate;
  }
  return { frame, fps, time, cue, cueFrame: (time - cue.start) * fps };
}

export function useScene(scene: string) {
  const clock = useClock();
  const mine = cues.filter((cue) => cue.scene === scene);
  const start = mine[0].start;
  const last = mine[mine.length - 1];
  const end = last.start + last.duration + 0.55;
  const opacity = interpolate(
    clock.time,
    [start - 0.22, start + 0.08, end - 0.18, end],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const visual =
    clock.cue.scene === scene
      ? clock.cue.visual
      : clock.time < start
        ? mine[0].visual
        : last.visual;
  const anchor =
    clock.cue.scene === scene ? clock.cue.start : clock.time < start ? start : last.start;
  return {
    ...clock,
    opacity,
    visual,
    localFrame: (clock.time - anchor) * clock.fps,
    hidden: opacity <= 0.01,
  };
}

export function enter(frame: number, fps: number, delay = 0) {
  const local = frame - delay * fps;
  if (local <= 0) {
    return { opacity: 0, y: 26, scale: 0.96 };
  }
  const progress = spring({
    frame: local,
    fps,
    config: { damping: 16, stiffness: 130, mass: 0.75 },
  });
  return {
    opacity: Math.min(1, progress),
    y: interpolate(progress, [0, 1], [26, 0]),
    scale: interpolate(progress, [0, 1], [0.96, 1]),
  };
}
