import { AbsoluteFill, interpolate } from "remotion";
import { Kicker, ProductShot } from "../components/Chrome";
import { body, color, display } from "../theme";
import { enter, useScene } from "../timeline";

export function Concept() {
  const { opacity, visual, localFrame, fps, hidden } = useScene("concept");
  if (hidden) return null;
  return (
    <AbsoluteFill style={{ opacity }}>
      {visual === "platform" ? <Platform frame={localFrame} fps={fps} /> : null}
      {visual === "trust" ? <Trust frame={localFrame} fps={fps} /> : null}
      {visual === "how" ? <How frame={localFrame} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

function Platform({ frame, fps }: { frame: number; fps: number }) {
  const title = enter(frame, fps, 0.05);
  const people = ["Developers", "Designers", "Fast-moving tech clients"];
  const cursorX = interpolate(frame, [0.4 * fps, 2.2 * fps], [180, 250], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ padding: "78px 80px 190px" }}>
      <Kicker index="02" label="Who it’s for" />
      <div style={{ display: "flex", gap: 40, marginTop: 26, alignItems: "center" }}>
        <div style={{ width: 760 }}>
          <div
            style={{
              fontFamily: display,
              fontWeight: 800,
              fontSize: 68,
              letterSpacing: "-0.045em",
              lineHeight: 0.96,
              opacity: title.opacity,
              transform: `translateY(${title.y}px)`,
            }}
          >
            AI-verified micro-escrow.
          </div>
          <div style={{ marginTop: 22, display: "grid", gap: 12 }}>
            {people.map((person, index) => {
              const motion = enter(frame, fps, 0.35 + index * 0.22);
              return (
                <div
                  key={person}
                  style={{
                    opacity: motion.opacity,
                    transform: `translateY(${motion.y}px)`,
                    fontFamily: body,
                    fontSize: 28,
                    fontWeight: 600,
                    padding: "14px 18px",
                    borderRadius: 16,
                    border: `1px solid ${color.line}`,
                    background: color.glass,
                  }}
                >
                  <span style={{ color: color.gold, marginRight: 12 }}>0{index + 1}</span>
                  {person}
                </div>
              );
            })}
          </div>
        </div>
        <ProductShot src="ui/users.png" frame={frame} cursor={{ x: cursorX, y: 250 }} />
      </div>
    </AbsoluteFill>
  );
}

function Trust({ frame, fps }: { frame: number; fps: number }) {
  const strike = interpolate(frame, [0.45 * fps, 1.05 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const reveal = enter(frame, fps, 1.15);
  const rows = ["Human bias", "Middleman delays"];
  return (
    <AbsoluteFill style={{ padding: "78px 80px 190px", justifyContent: "center" }}>
      <Kicker index="02" label="Automate trust" />
      <div style={{ marginTop: 28, display: "grid", gap: 18 }}>
        {rows.map((row) => (
          <div key={row} style={{ position: "relative", display: "inline-block", width: "fit-content" }}>
            <div style={{ fontFamily: display, fontWeight: 750, fontSize: 64, letterSpacing: "-0.04em", color: "rgba(216,239,232,0.55)" }}>
              {row}
            </div>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "54%",
                height: 6,
                width: `${strike * 100}%`,
                background: color.coral,
                borderRadius: 99,
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 28,
          opacity: reveal.opacity,
          transform: `translateY(${reveal.y}px)`,
          fontFamily: display,
          fontWeight: 800,
          fontSize: 72,
          letterSpacing: "-0.045em",
          color: color.gold,
        }}
      >
        Automated trust.
      </div>
    </AbsoluteFill>
  );
}

function How({ frame, fps }: { frame: number; fps: number }) {
  const left = enter(frame, fps, 0.1);
  const right = enter(frame, fps, 0.35);
  const plus = enter(frame, fps, 0.7);
  return (
    <AbsoluteFill style={{ padding: "78px 80px 190px" }}>
      <Kicker index="02" label="The combination" />
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 56, letterSpacing: "-0.04em", marginTop: 16 }}>
        Two systems. One release.
      </div>
      <div style={{ display: "flex", gap: 22, marginTop: 32, alignItems: "stretch" }}>
        <Pillar motion={left} kicker="Financial rails" title="PayPal" copy="Orders lock the milestone. Payouts release it." />
        <div
          style={{
            alignSelf: "center",
            fontFamily: display,
            fontSize: 64,
            color: color.gold,
            opacity: plus.opacity,
            transform: `scale(${plus.scale})`,
          }}
        >
          +
        </div>
        <Pillar motion={right} kicker="Autonomous verification" title="AI audit" copy="The git diff is checked against acceptance criteria." />
      </div>
    </AbsoluteFill>
  );
}

function Pillar({
  motion,
  kicker,
  title,
  copy,
}: {
  motion: { opacity: number; y: number };
  kicker: string;
  title: string;
  copy: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        opacity: motion.opacity,
        transform: `translateY(${motion.y}px)`,
        background: color.glass,
        border: `1px solid ${color.line}`,
        borderRadius: 28,
        padding: "32px 32px 36px",
        minHeight: 280,
      }}
    >
      <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 14, fontWeight: 700, color: color.gold }}>{kicker.toUpperCase()}</div>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 64, letterSpacing: "-0.04em", marginTop: 12 }}>{title}</div>
      <div style={{ fontFamily: body, fontSize: 24, color: color.mist, marginTop: 12, maxWidth: 460 }}>{copy}</div>
    </div>
  );
}
