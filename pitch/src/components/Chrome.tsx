import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { body, color } from "../theme";
import { DURATION_SECONDS, useClock } from "../timeline";

export function Backdrop() {
  const { frame } = useClock();
  const drift = Math.sin(frame / 90) * 18;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(165deg, #04110f 0%, #0a2420 46%, #071816 100%)" }}>
      <div
        style={{
          position: "absolute",
          width: 680,
          height: 680,
          borderRadius: 680,
          left: -160 + drift,
          top: 40,
          background: "radial-gradient(circle, rgba(23,163,138,0.42), transparent 68%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: 520,
          right: -80 - drift,
          bottom: -40,
          background: "radial-gradient(circle, rgba(232,184,74,0.22), transparent 70%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(216,239,232,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(216,239,232,0.045) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          opacity: 0.7,
        }}
      />
    </AbsoluteFill>
  );
}

export function Progress() {
  const { time } = useClock();
  const width = interpolate(time, [0, DURATION_SECONDS], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: "rgba(216,239,232,0.08)" }}>
      <div style={{ width: `${width}%`, height: "100%", background: `linear-gradient(90deg, ${color.sea}, ${color.gold})` }} />
    </div>
  );
}

export function Kicker({ index, label }: { index: string; label: string }) {
  return (
    <div
      style={{
        fontFamily: body,
        letterSpacing: "0.18em",
        fontSize: 15,
        fontWeight: 700,
        color: color.gold,
        textTransform: "uppercase",
      }}
    >
      {index}  ·  {label}
    </div>
  );
}

export function Caption() {
  const { cue, cueFrame, fps, time } = useClock();
  const visible = time >= cue.start - 0.05;
  const opacity = visible
    ? interpolate(cueFrame, [0, 0.18 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        bottom: 34,
        opacity,
      }}
    >
      <div
        style={{
          display: "inline-block",
          maxWidth: 1560,
          background: "rgba(4, 16, 15, 0.88)",
          border: `1px solid ${color.line}`,
          borderRadius: 18,
          padding: "16px 22px",
        }}
      >
        <div style={{ fontFamily: body, fontSize: 28, lineHeight: 1.35, fontWeight: 500, color: color.fog }}>
          {cue.caption}
        </div>
      </div>
    </div>
  );
}

export function ProductShot({
  src,
  frame,
  cursor,
  width = 768,
  height = 480,
}: {
  src: string;
  frame: number;
  cursor?: { x: number; y: number };
  width?: number;
  height?: number;
}) {
  const zoom = interpolate(frame, [0, 120], [1, 1.035], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  return (
    <div style={{ width }}>
      <div
        style={{
          marginBottom: 8,
          fontFamily: body,
          fontSize: 12,
          letterSpacing: "0.16em",
          fontWeight: 700,
          color: color.gold,
        }}
      >
        DEMO UI
      </div>
      <div
        style={{
          width,
          height,
          borderRadius: 18,
          overflow: "hidden",
          position: "relative",
          border: `1px solid ${color.line}`,
          boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          background: "#04110f",
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
            transform: `scale(${zoom})`,
          }}
        />
        {cursor ? <Pointer x={cursor.x} y={cursor.y} /> : null}
      </div>
    </div>
  );
}

function Pointer({ x, y }: { x: number; y: number }) {
  return (
    <svg width="32" height="32" viewBox="0 0 28 28" style={{ position: "absolute", left: x, top: y }}>
      <path d="M4 2 L4 23 L10.2 17.4 L14.4 26 L18.2 24.2 L14 15.6 L22.5 15.2 Z" fill="#f6fff9" stroke="#0b1c1a" strokeWidth="1.4" />
    </svg>
  );
}
