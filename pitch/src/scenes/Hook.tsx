import type { ReactNode } from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { Kicker } from "../components/Chrome";
import { body, color, display } from "../theme";
import { enter, useScene } from "../timeline";

export function Hook() {
  const { opacity, visual, localFrame, fps, hidden } = useScene("hook");
  if (hidden) return null;
  return (
    <AbsoluteFill style={{ opacity, padding: "78px 80px 190px" }}>
      {visual === "economy" ? <Economy frame={localFrame} fps={fps} /> : null}
      {visual === "broken" ? <Broken frame={localFrame} fps={fps} /> : null}
      {visual === "sides" ? <Sides frame={localFrame} fps={fps} /> : null}
      {visual === "platforms" ? <Platforms frame={localFrame} fps={fps} /> : null}
      {visual === "built" ? <Built frame={localFrame} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

function Economy({ frame, fps }: { frame: number; fps: number }) {
  const title = enter(frame, fps, 0.05);
  const sub = enter(frame, fps, 0.35);
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Kicker index="01" label="The problem" />
      <div style={{ marginTop: 120 }}>
        <div style={{ fontFamily: body, color: color.mist, fontSize: 22, letterSpacing: "0.16em", fontWeight: 700 }}>
          THE FREELANCE ECONOMY
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: display,
            fontWeight: 800,
            fontSize: 168,
            letterSpacing: "-0.05em",
            lineHeight: 0.9,
            color: color.fog,
            opacity: title.opacity,
            transform: `translateY(${title.y}px)`,
          }}
        >
          Billions
        </div>
        <div
          style={{
            marginTop: 18,
            maxWidth: 820,
            fontFamily: body,
            fontSize: 36,
            lineHeight: 1.35,
            color: color.mist,
            opacity: sub.opacity,
            transform: `translateY(${sub.y}px)`,
          }}
        >
          of dollars change hands every year — and the handshake is still the contract.
        </div>
      </div>
      {Array.from({ length: 6 }).map((_, index) => {
        const y = ((frame * 1.4 + index * 70) % 260) - 20;
        const opacity = interpolate(y, [-20, 40, 180, 240], [0, 0.55, 0.55, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              right: 90 + (index % 3) * 70,
              top: 160 + y,
              opacity,
              width: 48,
              height: 48,
              borderRadius: 24,
              border: `1.5px solid ${color.gold}`,
              color: color.gold,
              fontFamily: display,
              fontWeight: 700,
              fontSize: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            $
          </div>
        );
      })}
    </div>
  );
}

function Broken({ frame, fps }: { frame: number; fps: number }) {
  const title = enter(frame, fps, 0);
  const slash = interpolate(frame, [0.15 * fps, 0.55 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Kicker index="01" label="The problem" />
      <div style={{ marginTop: 36, position: "relative", display: "inline-block" }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: 104,
            letterSpacing: "-0.045em",
            lineHeight: 0.95,
            color: color.fog,
            opacity: title.opacity,
            transform: `translateY(${title.y}px)`,
            maxWidth: 1200,
          }}
        >
          The system is broken.
        </div>
        <div
          style={{
            marginTop: 22,
            height: 10,
            width: 420,
            borderRadius: 99,
            background: color.coral,
            transform: `scaleX(${slash})`,
            transformOrigin: "left center",
          }}
        />
      </div>
    </div>
  );
}

function Sides({ frame, fps }: { frame: number; fps: number }) {
  const left = enter(frame, fps, 0.1);
  const right = enter(frame, fps, 0.45);
  const unpaid = interpolate(frame, [0.7 * fps, 1.1 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ghost = interpolate(frame, [1.6 * fps, 2.2 * fps], [1, 0.28], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fail = interpolate(frame, [3.2 * fps, 3.8 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Kicker index="01" label="Both sides lose" />
      <div style={{ display: "flex", gap: 28, marginTop: 28 }}>
        <Party
          motion={left}
          role="Freelancer"
          name="Unpaid hours"
          tone="stress"
          screen={
            <div>
              <div style={{ fontFamily: body, fontSize: 13, letterSpacing: "0.14em", color: color.mist }}>INVOICE #1842</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <div style={{ fontFamily: display, fontSize: 36, fontWeight: 800 }}>$4,200</div>
                <div
                  style={{
                    opacity: unpaid,
                    background: "rgba(224,90,60,0.18)",
                    color: "#ffb0a1",
                    border: "1px solid rgba(224,90,60,0.7)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontFamily: body,
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: "0.08em",
                  }}
                >
                  UNPAID
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  opacity: ghost,
                  background: "rgba(216,239,232,0.06)",
                  borderRadius: 14,
                  padding: "10px 12px",
                  color: color.mist,
                  fontFamily: body,
                  fontSize: 16,
                }}
              >
                Client · message unavailable
              </div>
            </div>
          }
        />
        <Party
          motion={right}
          role="Client"
          name="Code that never lands"
          tone="wait"
          screen={
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 15, lineHeight: 1.55 }}>
              <div style={{ color: color.mist }}>+ login form shipped</div>
              <div style={{ color: fail > 0.5 ? "#ffb0a1" : color.mist }}>− session never merged</div>
              <div
                style={{
                  marginTop: 12,
                  opacity: fail,
                  color: "#ffb0a1",
                  fontFamily: body,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  fontSize: 14,
                }}
              >
                BUILD FAILED · PREPAID
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

function Party({
  motion,
  role,
  name,
  tone,
  screen,
}: {
  motion: { opacity: number; y: number };
  role: string;
  name: string;
  tone: "stress" | "wait";
  screen: ReactNode;
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
        padding: 28,
        minHeight: 520,
      }}
    >
      <div style={{ fontFamily: body, letterSpacing: "0.16em", fontSize: 13, fontWeight: 700, color: color.gold }}>
        {role.toUpperCase()}
      </div>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, letterSpacing: "-0.03em", marginTop: 6 }}>{name}</div>
      <div style={{ display: "flex", gap: 22, marginTop: 28, alignItems: "flex-end" }}>
        <Operator tone={tone} />
        <div
          style={{
            flex: 1,
            background: "#04110f",
            borderRadius: 16,
            border: `1px solid ${color.line}`,
            padding: 16,
            minHeight: 180,
          }}
        >
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <Dot c={color.coral} />
            <Dot c={color.gold} />
            <Dot c={color.sea} />
          </div>
          {screen}
        </div>
      </div>
    </div>
  );
}

function Operator({ tone }: { tone: "stress" | "wait" }) {
  return (
    <div style={{ position: "relative", width: 116, height: 168, flexShrink: 0 }}>
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 0,
          width: 56,
          height: 56,
          borderRadius: 28,
          background: "#f0c7ae",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 28,
          top: 0,
          width: 60,
          height: 26,
          borderRadius: "30px 30px 10px 10px",
          background: "#2b221c",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 46,
          top: 24,
          width: 18,
          height: 3,
          borderRadius: 2,
          background: "#6d4c3e",
          transform: tone === "stress" ? "rotate(-16deg)" : "rotate(8deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 16,
          top: 50,
          width: 84,
          height: 86,
          borderRadius: "42px 42px 18px 18px",
          background: tone === "stress" ? "#1a3330" : "#134e48",
        }}
      />
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <div style={{ width: 8, height: 8, borderRadius: 8, background: c }} />;
}

function Platforms({ frame, fps }: { frame: number; fps: number }) {
  const rows = [
    ["Manual approval", "A person has to click before anyone is paid."],
    ["Escrow banks", "Slow rails, extra fees, days of float."],
    ["The middle", "Trust is a queue, not a guarantee."],
  ];
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Kicker index="01" label="What exists today" />
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 64, letterSpacing: "-0.04em", marginTop: 18, maxWidth: 980 }}>
        Slow hands. Clunky banks.
      </div>
      <div style={{ marginTop: 28, display: "grid", gap: 16, maxWidth: 980 }}>
        {rows.map(([title, copy], index) => {
          const motion = enter(frame, fps, 0.15 + index * 0.28);
          return (
            <div
              key={title}
              style={{
                opacity: motion.opacity,
                transform: `translateY(${motion.y}px)`,
                display: "flex",
                gap: 18,
                alignItems: "center",
                padding: "18px 22px",
                borderRadius: 18,
                background: color.glass,
                border: `1px solid ${color.line}`,
              }}
            >
              <div style={{ fontFamily: display, fontSize: 28, color: color.coral, width: 54 }}>{`0${index + 1}`}</div>
              <div>
                <div style={{ fontFamily: display, fontSize: 28, fontWeight: 700 }}>{title}</div>
                <div style={{ fontFamily: body, fontSize: 20, color: color.mist, marginTop: 2 }}>{copy}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Built({ frame, fps }: { frame: number; fps: number }) {
  const kicker = enter(frame, fps, 0);
  const title = enter(frame, fps, 0.2);
  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ opacity: kicker.opacity, transform: `translateY(${kicker.y}px)` }}>
        <div style={{ fontFamily: body, fontSize: 28, color: color.mist }}>That’s why we built</div>
      </div>
      <div style={{ marginTop: 12, opacity: title.opacity, transform: `translateY(${title.y}px) scale(${title.scale})` }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: 132,
            letterSpacing: "-0.05em",
            lineHeight: 0.92,
            background: `linear-gradient(100deg, ${color.fog} 0%, ${color.sea} 46%, ${color.gold} 100%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Aegis-Split
        </div>
      </div>
    </div>
  );
}
