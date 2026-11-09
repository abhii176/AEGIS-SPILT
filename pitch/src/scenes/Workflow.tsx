import { AbsoluteFill, interpolate } from "remotion";
import { Kicker, ProductShot } from "../components/Chrome";
import { body, color, display } from "../theme";
import { enter, useScene } from "../timeline";

const STEPS = [
  { id: "vault", n: "01", title: "Secure vaulting" },
  { id: "audit", n: "02", title: "AI auditing" },
  { id: "payout", n: "03", title: "Instant payout" },
];

export function Workflow() {
  const { opacity, visual, localFrame, fps, hidden } = useScene("workflow");
  if (hidden) return null;
  const active = visual === "model" ? "audit" : visual === "overview" ? "" : visual;
  return (
    <AbsoluteFill style={{ opacity, padding: "72px 72px 180px" }}>
      <Kicker index="03" label="End to end" />
      <div style={{ display: "flex", gap: 28, marginTop: 18, height: 640 }}>
        <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
          {STEPS.map((step, index) => {
            const on = active === step.id;
            const motion = enter(localFrame, fps, visual === "overview" ? index * 0.18 : 0);
            return (
              <div
                key={step.id}
                style={{
                  opacity: motion.opacity,
                  transform: `translateY(${motion.y}px)`,
                  padding: "16px 18px",
                  borderRadius: 18,
                  border: `1px solid ${on ? "rgba(232,184,74,0.75)" : color.line}`,
                  background: on ? "rgba(232,184,74,0.12)" : color.glass,
                }}
              >
                <div style={{ fontFamily: body, color: color.gold, letterSpacing: "0.14em", fontSize: 13, fontWeight: 700 }}>{step.n}</div>
                <div style={{ fontFamily: display, fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em" }}>{step.title}</div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          {visual === "overview" ? <Overview frame={localFrame} fps={fps} /> : null}
          {visual === "vault" ? <Vault frame={localFrame} fps={fps} /> : null}
          {visual === "audit" || visual === "model" ? <Audit frame={localFrame} fps={fps} phase={visual} /> : null}
          {visual === "payout" ? <Payout frame={localFrame} fps={fps} /> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Overview({ frame, fps }: { frame: number; fps: number }) {
  const motion = enter(frame, fps, 0.05);
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", opacity: motion.opacity, transform: `translateY(${motion.y}px)` }}>
      <div>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 72, letterSpacing: "-0.045em", lineHeight: 0.95 }}>
          Fund. Merge.
          <br />
          Verify. Pay.
        </div>
        <div style={{ marginTop: 16, fontFamily: body, fontSize: 26, color: color.mist, maxWidth: 640 }}>
          Sarah locks the milestone. Rohan ships on GitHub. The auditor releases the vault.
        </div>
      </div>
    </div>
  );
}

function Vault({ frame, fps }: { frame: number; fps: number }) {
  const card = enter(frame, fps, 0.15);
  const lock = interpolate(frame, [0.8 * fps, 1.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorX = interpolate(frame, [0.2 * fps, 1.4 * fps], [120, 210], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", height: "100%" }}>
      <ProductShot src="ui/fund.png" frame={frame} width={720} height={450} cursor={{ x: cursorX, y: 210 }} />
      <div
        style={{
          width: 280,
          opacity: card.opacity,
          transform: `translateY(${card.y}px)`,
          background: color.glass,
          border: `1px solid ${color.line}`,
          borderRadius: 22,
          padding: 20,
        }}
      >
        <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 12, fontWeight: 700, color: color.gold }}>PAYPAL ORDERS</div>
        <div style={{ fontFamily: display, fontSize: 42, fontWeight: 800, marginTop: 8 }}>$250</div>
        <div style={{ fontFamily: body, color: color.mist, marginTop: 4 }}>Sarah Chen · milestone 1</div>
        <div
          style={{
            marginTop: 16,
            height: 10,
            borderRadius: 99,
            background: "rgba(216,239,232,0.08)",
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${lock * 100}%`, height: "100%", background: color.sea }} />
        </div>
        <div style={{ marginTop: 10, fontFamily: body, fontWeight: 700, color: lock > 0.95 ? color.gold : color.mist }}>
          {lock > 0.95 ? "Locked in escrow" : "Locking funds…"}
        </div>
      </div>
    </div>
  );
}

function Audit({ frame, fps, phase }: { frame: number; fps: number; phase: string }) {
  const checks = ["Ship hero CTA", "Login form", "Session cookie", "Lighthouse a11y ≥ 90"];
  const showChecks = phase === "model";
  const cursorX = interpolate(frame, [0.3 * fps, 1.6 * fps], [300, 360], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <ProductShot
          src={showChecks ? "ui/audit.png" : "ui/github.png"}
          frame={frame}
          width={620}
          height={388}
          cursor={{ x: cursorX, y: 180 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 12, fontWeight: 700, color: color.gold }}>
            {showChecks ? "ACCEPTANCE CRITERIA" : "GIT DIFF"}
          </div>
          <div
            style={{
              marginTop: 10,
              background: "#04110f",
              borderRadius: 16,
              border: `1px solid ${color.line}`,
              padding: 16,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 16,
              lineHeight: 1.55,
            }}
          >
            {showChecks
              ? checks.map((check, index) => {
                  const on = interpolate(frame, [(0.25 + index * 0.45) * fps, (0.55 + index * 0.45) * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  });
                  return (
                    <div key={check} style={{ display: "flex", gap: 8, opacity: 0.35 + on * 0.65, color: on > 0.8 ? "#8ee0bf" : color.mist }}>
                      <span>{on > 0.8 ? "✓" : "·"}</span>
                      <span>{check}</span>
                    </div>
                  );
                })
              : (
                <>
                  <div style={{ color: "#8ee0bf" }}>+ session cookie set</div>
                  <div style={{ color: "#8ee0bf" }}>+ login form wired</div>
                  <div style={{ color: color.mist }}>demo/aegis-auth #1 merged</div>
                </>
              )}
          </div>
          {showChecks ? (
            <div style={{ marginTop: 12, fontFamily: display, fontWeight: 800, fontSize: 36, color: color.gold }}>PASS</div>
          ) : (
            <div style={{ marginTop: 12, fontFamily: body, color: color.mist, fontSize: 18 }}>Backend reads the raw pull-request diff.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Payout({ frame, fps }: { frame: number; fps: number }) {
  const card = enter(frame, fps, 0.1);
  const fly = interpolate(frame, [0.4 * fps, 1.3 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", gap: 28 }}>
      <div
        style={{
          opacity: 1 - fly * 0.35,
          width: 240,
          padding: 20,
          borderRadius: 22,
          border: `1px solid ${color.line}`,
          background: color.glass,
        }}
      >
        <div style={{ fontFamily: body, fontSize: 13, letterSpacing: "0.12em", color: color.mist }}>VAULT</div>
        <div style={{ fontFamily: display, fontSize: 40, fontWeight: 800 }}>$250</div>
      </div>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(216,239,232,0.08)", position: "relative" }}>
        <div style={{ width: `${fly * 100}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${color.sea}, ${color.gold})` }} />
      </div>
      <div
        style={{
          width: 340,
          opacity: card.opacity,
          transform: `translateY(${card.y}px) scale(${0.96 + fly * 0.04})`,
          padding: 24,
          borderRadius: 24,
          background: "rgba(31,157,106,0.14)",
          border: "1px solid rgba(31,157,106,0.55)",
        }}
      >
        <div style={{ fontFamily: body, letterSpacing: "0.14em", fontSize: 13, fontWeight: 700, color: "#8ee0bf" }}>PAYPAL PAYOUTS</div>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 56, letterSpacing: "-0.04em" }}>$250</div>
        <div style={{ fontFamily: body, fontSize: 22, marginTop: 4 }}>Rohan Mehta</div>
        <div style={{ marginTop: 12, fontFamily: display, fontWeight: 800, fontSize: 28, color: color.gold }}>{fly > 0.92 ? "PAID" : "RELEASING"}</div>
      </div>
    </div>
  );
}
