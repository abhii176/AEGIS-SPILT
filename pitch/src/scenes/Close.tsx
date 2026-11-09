import { AbsoluteFill } from "remotion";
import { Kicker, ProductShot } from "../components/Chrome";
import { body, color, display } from "../theme";
import { enter, useScene } from "../timeline";

const REPO = "github.com/abhii176/AEGIS-SPILT";

export function Close() {
  const { opacity, visual, localFrame, fps, hidden } = useScene("close");
  if (hidden) return null;
  return (
    <AbsoluteFill style={{ opacity, padding: "78px 80px 190px" }}>
      {visual === "transform" ? <Transform frame={localFrame} fps={fps} /> : null}
      {visual === "cta" ? <Cta frame={localFrame} fps={fps} /> : null}
      {visual === "thanks" ? <Thanks frame={localFrame} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

function Transform({ frame, fps }: { frame: number; fps: number }) {
  const from = enter(frame, fps, 0.05);
  const to = enter(frame, fps, 0.7);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Kicker index="05" label="The shift" />
      <div
        style={{
          marginTop: 20,
          fontFamily: display,
          fontWeight: 700,
          fontSize: 42,
          color: "rgba(216,239,232,0.55)",
          opacity: from.opacity,
          transform: `translateY(${from.y}px)`,
        }}
      >
        From a game of trust
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: display,
          fontWeight: 800,
          fontSize: 68,
          letterSpacing: "-0.045em",
          lineHeight: 0.98,
          maxWidth: 1200,
          opacity: to.opacity,
          transform: `translateY(${to.y}px)`,
        }}
      >
        to a mathematically secure, AI-verified partnership.
      </div>
    </div>
  );
}

function Cta({ frame, fps }: { frame: number; fps: number }) {
  const copy = enter(frame, fps, 0.05);
  return (
    <div style={{ display: "flex", gap: 36, alignItems: "center", height: "100%" }}>
      <div style={{ width: 760, opacity: copy.opacity, transform: `translateY(${copy.y}px)` }}>
        <Kicker index="05" label="Open source" />
        <div style={{ marginTop: 16, fontFamily: display, fontWeight: 800, fontSize: 54, letterSpacing: "-0.04em", lineHeight: 1 }}>
          Repository and demo
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 26,
            color: color.gold,
            wordBreak: "break-all",
          }}
        >
          {REPO}
        </div>
        <div style={{ marginTop: 14, fontFamily: body, fontSize: 24, color: color.mist, maxWidth: 640 }}>
          The live demo UI ships in the repo. Run it with npm start.
        </div>
      </div>
      <ProductShot src="ui/landing.png" frame={frame} width={736} height={460} cursor={{ x: 430, y: 250 }} />
    </div>
  );
}

function Thanks({ frame, fps }: { frame: number; fps: number }) {
  const motion = enter(frame, fps, 0.02);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", opacity: motion.opacity, transform: `translateY(${motion.y}px)` }}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 800,
          fontSize: 120,
          letterSpacing: "-0.05em",
          background: `linear-gradient(100deg, ${color.fog} 0%, ${color.sea} 50%, ${color.gold} 100%)`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          width: "fit-content",
        }}
      >
        Thank you.
      </div>
      <div style={{ marginTop: 18, fontFamily: body, fontSize: 32, color: color.mist }}>Money locked. Code proven. Paid.</div>
    </div>
  );
}
