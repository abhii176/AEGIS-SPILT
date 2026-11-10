/**
 * Capture the real Aegis-Split UI in the states the pitch talks about.
 * The app shell is the shipped public/ page. Copy is filled in the DOM
 * because this pass does not require Postgres or PayPal.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const ROOT = "/agent/repos/AEGIS-SPILT";
const PUBLIC = join(ROOT, "public");
const OUT = join(ROOT, "pitch/build/shots");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const file = normalize(join(PUBLIC, pathname));
      if (!file.startsWith(PUBLIC)) {
        res.writeHead(403);
        res.end("no");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const AGREEMENT = `Aegis-Split User Consent Agreement
Version 2.0.0

1. Identity verification
Complete government-ID verification before funding escrow or linking GitHub work.

2. Platform-only communication
Keep project negotiation, delivery updates, and payment discussions on the platform.

3. Exit and penalty rules
A one-sided client cancel pays 50% of the remaining vault to the freelancer.

4. Dispute resolution
Counselors review the chat, the audit, the diff, and call recordings.`;

async function dress(page, shot) {
  await page.evaluate(
    ({ shot, agreement }) => {
      const $ = (sel) => document.querySelector(sel);
      document.querySelectorAll(".panel").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.step === shot);
      });
      document.querySelectorAll(".step-rail button").forEach((button) => {
        button.classList.toggle("active", button.dataset.go === shot);
      });
      const chip = $("#session-chip");
      const name = $("#session-name");
      if (chip && name) {
        chip.hidden = false;
        const who =
          shot === "counselor"
            ? "Maya Rao · COUNSELOR"
            : shot === "work" || shot === "paid"
              ? "Rohan Mehta · FREELANCER"
              : "Sarah Chen · CLIENT";
        name.textContent = who;
      }
      const health = $("#health-dot");
      if (health) health.className = "ok";
      document.querySelector(".site-foot")?.setAttribute("hidden", "");

      if (shot === "verify") {
        const kyc = document.querySelector('[data-flag="kyc"]');
        const consent = document.querySelector('[data-flag="consent"]');
        kyc?.classList.add("on");
        consent?.classList.add("on");
        if (kyc) kyc.querySelector("strong").textContent = "yes (sandbox)";
        if (consent) consent.querySelector("strong").textContent = "yes";
        const done = $("#kyc-quick-done");
        if (done) {
          done.hidden = false;
          done.textContent = "Identity verified.";
        }
        const quick = $("#btn-kyc-quick");
        if (quick) quick.hidden = true;
        const pre = $("#consent-md");
        if (pre) pre.textContent = agreement;
        const box = $("#consent-agree");
        if (box) box.checked = true;
        const consentName = $("#consent-name");
        if (consentName) consentName.value = "Sarah Chen";
        const date = $("#consent-date");
        if (date) date.value = "2026-05-12";
        const sign = $("#btn-consent");
        if (sign) sign.hidden = true;
        const next = $("#btn-verify-next");
        if (next) next.hidden = false;
        const hint = $("#verify-hint");
        if (hint) hint.textContent = "Identity and consent are on file.";
      }

      if (shot === "project") {
        const panel = $("#chat-panel");
        const list = $("#chat-list");
        if (panel) panel.hidden = false;
        if (list) {
          list.innerHTML = `
            <li class="chat-bubble theirs">
              <div class="chat-meta"><span>Sarah Chen</span><span>9:14 AM</span></div>
              <div class="chat-body">Milestone is funded. Criteria stay locked: login form, session cookie, hero CTA.</div>
            </li>
            <li class="chat-bubble mine">
              <div class="chat-meta"><span>Rohan Mehta</span><span>9:22 AM</span></div>
              <div class="chat-body">Pull request 1 is merged on demo/aegis-auth. The audit can read the diff.</div>
            </li>`;
        }
        const hint = $("#project-hint");
        if (hint) hint.textContent = "Project chat stays on the platform.";
      }

      if (shot === "fund") {
        const hint = $("#fund-hint");
        if (hint) hint.textContent = "Escrow captured. $250.00 is locked.";
        const button = $("#btn-fund");
        if (button) {
          button.textContent = "Escrow locked · $250.00";
          button.disabled = true;
        }
        const status = $("#deposit-status");
        if (status) {
          status.hidden = false;
          status.textContent = "Freelancer deposit: $25.00 held";
        }
        const depositHint = $("#deposit-hint");
        if (depositHint) depositHint.hidden = true;
      }

      if (shot === "work") {
        const hint = $("#work-hint");
        if (hint) hint.textContent = "Pull request merged. The audit passed.";
        const board = $("#audit-board");
        if (board) board.hidden = false;
        const verdict = $("#audit-verdict");
        if (verdict) {
          verdict.textContent = "PASS — criteria met";
          verdict.className = "audit-verdict pass";
        }
        const checks = $("#audit-checks");
        if (checks) {
          checks.innerHTML = `
            <li>✓ <strong>Ship hero CTA</strong> — found in the diff</li>
            <li>✓ <strong>login form</strong> — found in the diff</li>
            <li>✓ <strong>session cookie</strong> — found in the diff</li>
            <li>✓ <strong>Lighthouse a11y &gt;= 90</strong> — noted on the pull request</li>`;
        }
        const report = $("#audit-report");
        if (report) {
          report.textContent =
            "demo/aegis-auth #1 merged\n+ hero CTA\n+ login form\n+ session cookie\nAcceptance criteria matched. Payout released in full. Platform fee 0%.";
        }
        const submit = $("#btn-submit-work");
        if (submit) submit.hidden = true;
        const next = $("#btn-work-next");
        if (next) next.hidden = false;
      }

      if (shot === "paid") {
        const amount = $("#paid-amount");
        if (amount) amount.textContent = "$250.00 USD";
        const status = $("#paid-status");
        if (status) status.textContent = "Status: PAID — full amount released to freelancer (0% platform fee)";
        const meta = $("#paid-meta");
        if (meta) {
          meta.innerHTML = `
            <div><dt>Milestone</dt><dd>Milestone 1 — Login + session</dd></div>
            <div><dt>Audit</dt><dd>PASS</dd></div>
            <div><dt>Release</dt><dd>Automatic after AI pass</dd></div>
            <div><dt>Platform fee</dt><dd>0%</dd></div>
            <div><dt>Payout batch</dt><dd>SANDBOX-PAYOUT-250</dd></div>
            <div><dt>Merge SHA</dt><dd>e9f21c4</dd></div>`;
        }
        const hint = $("#paid-hint");
        if (hint) hint.textContent = "PayPal Payouts sent the full milestone.";
      }

      if (shot === "exit") {
        const select = $("#exit-path");
        if (select) select.value = "CLIENT_ONESIDED";
        const preview = $("#exit-preview");
        if (preview) preview.hidden = false;
        const lines = $("#exit-lines");
        if (lines) {
          lines.innerHTML = `
            <li><strong>$125.00</strong> → Rohan — early-exit penalty (50%)</li>
            <li><strong>$125.00</strong> → Sarah — remainder of the vault</li>
            <li><strong>$25.00</strong> → Rohan — security deposit returned</li>`;
        }
        const warn = $("#exit-warn");
        if (warn) warn.textContent = "Nothing moves until Confirm. This is the one-sided client cancel.";
        const hint = $("#exit-hint");
        if (hint) hint.textContent = "Preview first. The penalty is part of the contract.";
      }

      if (shot === "counselor") {
        const recording = window.AegisCallRecording
          ? window.AegisCallRecording.render({
              label: "Call recording (preview - sample)",
              lines: [
                { at: "00:12", speaker: "Sarah", text: "The session cookie was not in the first push." },
                { at: "00:21", speaker: "Rohan", text: "It landed in the merged pull request. The diff has it." },
                {
                  at: "00:34",
                  speaker: "Sarah",
                  text: "If the audit fails I want the vault refunded.",
                  flagged: true,
                  flag: "Payment dispute",
                },
              ],
            })
          : "";
        const list = $("#counselor-list");
        if (list) {
          list.innerHTML = `
            <article class="counselor-case">
              <h3>Auth service MVP · OPEN</h3>
              <p>Sarah Chen raised this. Milestone merged, client disagrees with the audit.</p>
              ${recording}
              <div class="evidence-grid">
                <section class="evidence-card">
                  <h4>Chat</h4>
                  <ul class="counselor-chat">
                    <li><strong>Sarah Chen</strong> Please hold the payout until Maya looks.<time>Today, 9:41 AM</time></li>
                    <li><strong>Rohan Mehta</strong> The diff matches the locked criteria.<time>Today, 9:44 AM</time></li>
                  </ul>
                </section>
                <section class="evidence-card">
                  <h4>AI audit</h4>
                  <p><strong>PASS</strong> · Milestone 1 — Login + session</p>
                  <pre class="audit-snippet">hero CTA, login form, and session cookie are in the merged diff.</pre>
                </section>
              </div>
              <form class="dispute-form">
                <label class="check-inline"><input type="radio" name="decision" /> Release to freelancer</label>
                <label class="check-inline"><input type="radio" name="decision" /> Refund client</label>
                <label class="check-inline"><input type="radio" name="decision" checked /> Split</label>
                <label>Note<textarea rows="2">Reviewing the merged diff against the locked criteria.</textarea></label>
                <div class="action-row"><button type="button" class="btn primary">Confirm decision</button></div>
              </form>
            </article>`;
        }
      }
    },
    { shot, agreement: AGREEMENT }
  );
}

const SHOTS = ["verify", "project", "fund", "work", "paid", "exit", "counselor"];

const server = await startServer();
const { port } = server.address();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.clear());
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (url.includes("/api/") || url.endsWith("/health")) {
    route.abort();
    return;
  }
  route.continue();
});
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".step-rail button");
await page.evaluate(() => document.fonts.ready);

for (const shot of SHOTS) {
  await page.click(`.step-rail button[data-go="${shot}"]`);
  await page.waitForTimeout(250);
  await dress(page, shot);
  await page.waitForTimeout(350);
  await dress(page, shot);
  await page.screenshot({ path: join(OUT, `${shot === "project" ? "chat" : shot}.png`) });
  await page.waitForTimeout(700);
}

await context.close();
await browser.close();
server.close();
console.log("shots", SHOTS.join(", "));
