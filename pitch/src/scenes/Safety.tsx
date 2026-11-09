import { AbsoluteFill, interpolate } from "remotion";
import { Img, staticFile } from "remotion";
import { Kicker } from "../components/Chrome";
import { body, color, display } from "../theme";
import { enter, useScene } from "../timeline";

export function Safety() {
  const { opacity, visual, localFrame, fps, hidden } = useScene("safety");
  if (hidden) return null;
  return (
    <AbsoluteFill style={{ opacity, padding: "72px 76px 180px" }}>
      {visual === "more" ? <More frame={localFrame} fps={fps} /> : null}
      {visual === "gates" ? <Gates frame={localFrame} fps={fps} /> : null}
      {visual === "dispute" ? <Dispute frame={localFrame} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

function More({ frame, fps }: { frame: number; fps: number }) {
  const motion = enter(frame, fps, 0.05);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Kicker index="04" label="Safety" />
      <div
        style={{
          marginTop: 18,
          fontFamily: display,
          fontWeight: 800,
          fontSize: 92,
          letterSpacing: "-0.05em",
          lineHeight: 0.95,
          maxWidth: 1100,
          opacity: motion.opacity,
          transform: `translateY(${motion.y}px)`,
        }}
      >
        We didn’t stop at automation.
      </div>
    </div>
  );
}

function Gates({ frame, fps }: { frame: number; fps: number }) {
  const cards = [
    {
      kicker: "Identity",
      title: "KYC",
      copy: "Government ID and monitoring consent before any money moves.",
    },
    {
      kicker: "On platform",
      title: "Stay inside",
      copy: "Work and messages stay on-platform, where the record exists.",
    },
    {
      kicker: "Contracts",
      title: "Early exit",
      copy: "Clear terms, with penalties if someone walks away early.",
    },
  ];
  return (
    <div>
      <Kicker index="04" label="Gates" />
      <div style={{ display: "flex", gap: 18, marginTop: 22 }}>
        {cards.map((card, index) => {
          const motion = enter(frame, fps, 0.12 + index * 0.28);
          return (
            <div
              key={card.title}
              style={{
                flex: 1,
                opacity: motion.opacity,
                transform: `translateY(${motion.y}px)`,
                background: color.glass,
                border: `1px solid ${color.line}`,
                borderRadius: 24,
                padding: 22,
                minHeight: 430,
              }}
            >
              <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 13, fontWeight: 700, color: color.gold }}>
                {card.kicker.toUpperCase()}
              </div>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 48, letterSpacing: "-0.04em", marginTop: 8 }}>{card.title}</div>
              <div style={{ fontFamily: body, fontSize: 22, color: color.mist, marginTop: 10, lineHeight: 1.35 }}>{card.copy}</div>
              {index === 0 ? (
                <div style={{ marginTop: 18, height: 180, borderRadius: 14, overflow: "hidden", border: `1px solid ${color.line}` }}>
                  <Img src={staticFile("ui/verify.png")} style={{ width: 720, height: 450, transformOrigin: "left top" }} />
                </div>
              ) : null}
              {index === 2 ? (
                <div style={{ marginTop: 22, fontFamily: "JetBrains Mono, monospace", fontSize: 15, color: color.mist, lineHeight: 1.6 }}>
                  <div>exit_before_delivery</div>
                  <div style={{ color: color.gold }}>penalty: protected</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Dispute({ frame, fps }: { frame: number; fps: number }) {
  const lines = [
    ["Sarah", "The session cookie was in the spec."],
    ["Rohan", "Merged on demo/aegis-auth #1."],
    ["Record", "Call captured · chat retained"],
  ];
  return (
    <div>
      <Kicker index="04" label="If there’s a dispute" />
      <div style={{ display: "flex", gap: 22, marginTop: 20 }}>
        <div style={{ flex: 1.2, background: color.glass, border: `1px solid ${color.line}`, borderRadius: 24, padding: 22 }}>
          <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 13, fontWeight: 700, color: color.gold }}>AUDIT TRAIL</div>
          <div style={{ marginTop: 16, display: "flex", gap: 4, alignItems: "flex-end", height: 54 }}>
            {Array.from({ length: 28 }).map((_, index) => {
              const h = 12 + Math.abs(Math.sin(frame / 6 + index * 0.45)) * 40;
              return <div key={index} style={{ width: 8, height: h, borderRadius: 4, background: index % 4 === 0 ? color.gold : color.sea }} />;
            })}
          </div>
          <div style={{ marginTop: 8, fontFamily: body, color: color.mist, fontSize: 16 }}>Agora voice recording</div>
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {lines.map(([who, text], index) => {
              const motion = enter(frame, fps, 0.3 + index * 0.45);
              return (
                <div key={who} style={{ opacity: motion.opacity, transform: `translateY(${motion.y}px)` }}>
                  <div style={{ fontFamily: body, fontSize: 13, letterSpacing: "0.08em", color: color.gold, fontWeight: 700 }}>{who.toUpperCase()}</div>
                  <div style={{ fontFamily: body, fontSize: 22 }}>{text}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 0.8, display: "flex", alignItems: "center" }}>
          <Counselor frame={frame} fps={fps} />
        </div>
      </div>
    </div>
  );
}

function Counselor({ frame, fps }: { frame: number; fps: number }) {
  const motion = enter(frame, fps, 0.35);
  const fill = interpolate(frame, [1.4 * fps, 3.2 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        width: "100%",
        opacity: motion.opacity,
        transform: `translateY(${motion.y}px)`,
        background: color.glass,
        border: `1px solid ${color.line}`,
        borderRadius: 24,
        padding: 24,
      }}
    >
      <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 13, fontWeight: 700, color: color.gold }}>HUMAN REVIEW</div>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 42, letterSpacing: "-0.04em", marginTop: 8 }}>Counselor</div>
      <div style={{ fontFamily: body, fontSize: 22, color: color.mist, marginTop: 8 }}>
        Reads the chat and the call. Settles the conflict on the record.
      </div>
      <div style={{ marginTop: 20, height: 10, borderRadius: 99, background: "rgba(216,239,232,0.08)" }}>
        <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: 99, background: color.gold }} />
      </div>
      <div style={{ marginTop: 10, fontFamily: body, fontWeight: 700 }}>{fill > 0.95 ? "Settled fairly" : "Reviewing the trail…"}</div>
    </div>
  );
}
