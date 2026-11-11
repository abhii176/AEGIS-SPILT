/**
 * Screen recording of the live Aegis-Split demo, paced to the pitch voiceover.
 * Requires the API on http://127.0.0.1:3000 with PAYPAL_MOCK=true.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const ROOT = "/agent/repos/AEGIS-SPILT";
const PITCH = `${ROOT}/pitch`;
const BUILD = `${PITCH}/build`;
const BASE = "http://127.0.0.1:3000";
const KEY = "hackathon-demo-key";
const WIDTH = 1280;
const HEIGHT = 720;

const cues = JSON.parse(await readFile(`${BUILD}/cues.json`, "utf8"));
const DURATION = cues.duration;

async function api(path, { method = "GET", body, user, demo = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body != null) headers["Content-Type"] = "application/json";
  if (user) headers["X-User-Id"] = user;
  if (demo) headers["X-Demo-Admin-Key"] = KEY;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

async function seedCounselorCase() {
  const open = await api("/api/disputes?status=OPEN", { demo: true });
  if ((open.disputes || []).length) {
    console.log("counselor case already open");
    return;
  }
  const seeded = await api("/api/admin/demo/users/seed", { method: "POST", demo: true, body: {} });
  const users = Object.fromEntries(seeded.users.map((user) => [user.key, user]));
  for (const key of ["sarah", "rohan"]) {
    const id = users[key].id;
    await api("/api/auth/kyc/sandbox/quick", { method: "POST", user: id, body: {} });
    await api("/api/consent/monitoring", {
      method: "POST",
      user: id,
      body: {
        accepted: true,
        agreedName: users[key].name,
        agreedDate: "2026-05-12",
        consentVersion: "2.0.0",
      },
    });
  }
  const { project } = await api("/api/projects", {
    method: "POST",
    user: users.sarah.id,
    body: {
      title: "Homepage hero",
      description: "Dispute sample for the counselor screen",
      freelancerId: users.rohan.id,
      clientId: users.sarah.id,
      status: "ACTIVE",
      earlyExitPenaltyPercent: 50,
    },
  });
  const { milestone } = await api(`/api/projects/${project.id}/milestones`, {
    method: "POST",
    user: users.sarah.id,
    body: {
      title: "Hero and navigation",
      taskDescription: "Ship the homepage hero",
      acceptanceCriteria: "Hero headline, primary button, and a sticky nav",
      amountCents: 120000,
      requiresManualSignoff: true,
    },
  });
  await api("/api/vault/fund", {
    method: "POST",
    user: users.sarah.id,
    body: { projectId: project.id, milestoneId: milestone.id, capture: true },
  });
  await api(`/api/projects/${project.id}/deposit/fund`, {
    method: "POST",
    user: users.rohan.id,
    body: { capture: true },
  });
  await api(`/api/projects/${project.id}/milestones/${milestone.id}/github`, {
    method: "POST",
    user: users.rohan.id,
    body: { githubRepoFullName: "demo/homepage-hero", githubPrNumber: 4 },
  });
  await api(`/api/admin/demo/milestones/${milestone.id}/simulate-merge`, {
    method: "POST",
    demo: true,
    user: users.rohan.id,
    body: {},
  });
  await api(`/api/projects/${project.id}/messages`, {
    method: "POST",
    user: users.sarah.id,
    body: { body: "The hero button is missing. That was in the criteria." },
  });
  await api(`/api/projects/${project.id}/disputes`, {
    method: "POST",
    user: users.sarah.id,
    body: {
      milestoneId: milestone.id,
      reason: "The merged page is missing the primary button from the locked criteria.",
    },
  });
  console.log("counselor case ready", project.id);
}

function installCursor(page) {
  return page.addInitScript(() => {
    const mount = () => {
      if (!document.head || !document.body || document.getElementById("rec-cursor")) return;
      const style = document.createElement("style");
      style.textContent = `
        #rec-cursor { position: fixed; z-index: 100000; width: 36px; height: 36px; margin: -2px 0 0 -4px; pointer-events: none; filter: drop-shadow(0 3px 4px rgba(0,0,0,.65)); }
        #rec-cursor.click { transform: scale(0.84); }
        #rec-caption { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99990; min-height: 108px; padding: 42px 72px 26px; box-sizing: border-box; background: linear-gradient(transparent, rgba(4,12,11,.96) 46%); text-align: center; font: 600 28px/1.28 Figtree, sans-serif; color: #f4fffb; pointer-events: none; }
      `;
      document.head.appendChild(style);
      const cursor = document.createElement("div");
      cursor.id = "rec-cursor";
      cursor.innerHTML = `<svg width="36" height="36" viewBox="0 0 28 28" aria-hidden="true"><path d="M5 3 L5 22.5 L10.2 17.4 L14 25.2 L17.2 23.8 L13.3 16.2 L20.2 15.6 Z" fill="#fffef8" stroke="#0b1c1a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
      const caption = document.createElement("div");
      caption.id = "rec-caption";
      document.body.appendChild(cursor);
      document.body.appendChild(caption);
    };
    window.__placeCursor = (x, y) => {
      mount();
      const cursor = document.getElementById("rec-cursor");
      if (!cursor) return;
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    };
    window.__caption = (text) => {
      mount();
      const el = document.getElementById("rec-caption");
      if (el) el.textContent = text || "";
    };
    document.addEventListener("DOMContentLoaded", mount);
  });
}

async function point(page) {
  return page.evaluate(() => {
    const cursor = document.getElementById("rec-cursor");
    return {
      x: parseFloat(cursor?.style.left || "240"),
      y: parseFloat(cursor?.style.top || "180"),
    };
  });
}

async function glide(page, x, y) {
  const start = await point(page);
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const eased = 1 - (1 - t) ** 3;
    const nextX = start.x + (x - start.x) * eased;
    const nextY = start.y + (y - start.y) * eased;
    await page.mouse.move(nextX, nextY);
    await page.evaluate(([px, py]) => window.__placeCursor?.(px, py), [nextX, nextY]);
    await page.waitForTimeout(14);
  }
}

async function clickAt(page, locator) {
  const target = locator.first();
  await target.waitFor({ state: "attached", timeout: 12000 });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`no box for ${target}`);
  const x = box.x + Math.min(box.width / 2, 180);
  const y = box.y + Math.min(Math.max(box.height / 2, 12), 28);
  await glide(page, x, y);
  await page.mouse.down();
  await page.evaluate(() => document.getElementById("rec-cursor")?.classList.add("click"));
  await page.waitForTimeout(70);
  await page.mouse.up();
  await page.evaluate(() => document.getElementById("rec-cursor")?.classList.remove("click"));
  await page.waitForTimeout(160);
}

async function main() {
  await seedCounselorCase();
  await mkdir(`${BUILD}/screen-take`, { recursive: true });
  await rm(`${BUILD}/screen-take`, { recursive: true, force: true });
  await mkdir(`${BUILD}/screen-take`, { recursive: true });

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: `${BUILD}/screen-take`, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  await installCursor(page);
  const started = Date.now();
  await page.goto(`${BASE}/#landing`, { waitUntil: "networkidle" });
  await page.waitForSelector("#btn-start-demo");
  await page.evaluate(() => window.__placeCursor(280, 220));
  await page.mouse.move(280, 220);
  await page.waitForTimeout(200);
  const lead = (Date.now() - started) / 1000;
  const origin = Date.now();
  const elapsed = () => (Date.now() - origin) / 1000;
  const until = async (second) => {
    const wait = second * 1000 - (Date.now() - origin);
    if (wait > 40) await page.waitForTimeout(wait);
  };
  const mark = (label) => console.log(`${elapsed().toFixed(1)}s  ${label}`);

  const captions = setInterval(() => {
    const t = elapsed();
    const line = cues.captions.find((item) => t >= item.start && t < item.end + 0.05);
    page.evaluate((text) => window.__caption?.(text), line ? line.text : "").catch(() => {});
  }, 180);

  let failed = null;
  try {
    mark("landing");
    await glide(page, 430, 340);
    await until(7.2);
    const ghost = page.locator(".trust-row li").first();
    await ghost.scrollIntoViewIfNeeded();
    const ghostBox = await ghost.boundingBox();
    if (ghostBox) await glide(page, ghostBox.x + 80, ghostBox.y + 28);
    await until(16.2);
    await glide(page, 520, 460);
    await until(20.6);
    mark("start demo");
    await clickAt(page, page.locator("#btn-start-demo"));
    await page.waitForSelector(".persona[data-persona='sarah']:not([disabled])");
    await until(26.2);
    mark("people");
    for (const key of ["sarah", "rohan", "maya"]) {
      const card = page.locator(`.persona[data-persona="${key}"]`);
      const box = await card.boundingBox();
      if (box) await glide(page, box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(280);
    }
    await until(33.4);
    await clickAt(page, page.locator(".persona[data-persona='sarah']"));
    await page.waitForSelector("#verify-status");
    mark("verify");
    const quick = page.locator("#btn-kyc-quick");
    if (await quick.isVisible()) {
      await until(36.2);
      await clickAt(page, quick);
      await page.waitForSelector("#kyc-quick-done:not([hidden])");
      await clickAt(page, page.locator("#consent-agree"));
      await clickAt(page, page.locator("#btn-consent"));
    }
    await page.waitForSelector("#btn-verify-next:not([hidden])");
    await until(38.6);
    await clickAt(page, page.locator("#btn-verify-next"));
    await page.waitForSelector("#btn-create-project");
    mark("create");
    await until(45.4);
    await clickAt(page, page.locator("#btn-create-project"));
    await page.waitForSelector("#btn-project-next:not([hidden])");
    await clickAt(page, page.locator("#btn-project-next"));
    await page.waitForSelector("#btn-fund");
    mark("fund");
    await clickAt(page, page.locator("#panel-fund details.more summary"));
    await clickAt(page, page.locator("#fund-capture"));
    await clickAt(page, page.locator("#btn-fund"));
    await page.waitForFunction(() => {
      const status = document.querySelector("#deposit-status");
      return status && !status.hidden;
    });
    await until(56.5);
    mark("deposit");
    await clickAt(page, page.locator("#btn-switch-user"));
    await page.waitForSelector(".persona[data-persona='rohan']");
    await clickAt(page, page.locator(".persona[data-persona='rohan']"));
    await clickAt(page, page.locator(".step-rail button[data-go='fund']"));
    await page.waitForSelector("#btn-deposit:not([hidden])");
    await clickAt(page, page.locator("#btn-deposit"));
    await page.waitForSelector("#btn-fund-next:not([hidden])");
    await until(63.5);
    mark("submit");
    await clickAt(page, page.locator("#btn-fund-next"));
    await page.waitForSelector("#btn-submit-work");
    await clickAt(page, page.locator("#btn-submit-work"));
    await page.waitForSelector("#audit-verdict");
    await until(72.2);
    mark("paid");
    await clickAt(page, page.locator("#btn-work-next"));
    await page.waitForSelector("#paid-amount");
    await until(80.4);
    mark("kyc revisit");
    await clickAt(page, page.locator(".step-rail button[data-go='verify']"));
    await page.waitForSelector("[data-flag='kyc'].on, [data-flag='kyc']");
    await until(85.6);
    mark("chat");
    await clickAt(page, page.locator(".step-rail button[data-go='project']"));
    await page.waitForSelector("#chat-input");
    await clickAt(page, page.locator("#chat-input"));
    await page.keyboard.type("Login form and session cookie are in the merge.", { delay: 22 });
    await clickAt(page, page.locator("#btn-chat-send"));
    await until(90.3);
    mark("exit");
    await clickAt(page, page.locator(".step-rail button[data-go='exit']"));
    await page.waitForSelector("#exit-path");
    await page.locator("#exit-path").selectOption("CLIENT_ONESIDED");
    const exitBox = await page.locator("#exit-path").boundingBox();
    if (exitBox) await glide(page, exitBox.x + 40, exitBox.y + 16);
    await until(93.2);
    mark("counselor");
    await clickAt(page, page.locator("#btn-switch-user"));
    await clickAt(page, page.locator(".persona[data-persona='maya']"));
    await clickAt(page, page.locator(".step-rail button[data-go='counselor']"));
    await page.waitForSelector(".counselor-case");
    const recording = page.locator(".call-recording, .counselor-case h3").first();
    await recording.scrollIntoViewIfNeeded();
    await until(98.4);
    const note = page.locator(".counselor-case textarea[name='note']").first();
    await note.scrollIntoViewIfNeeded();
    await clickAt(page, note);
    await page.keyboard.type("Split the vault. The button was in the criteria.", { delay: 18 });
    await clickAt(page, page.locator(".counselor-case button[data-confirm]").first());
    await page.waitForSelector("[data-preview-lines]:not([hidden])");
    await until(107.6);
    mark("close");
    await clickAt(page, page.locator(".brand-mark"));
    await page.waitForSelector("#btn-start-demo");
    await glide(page, 360, 300);
    await until(DURATION + 0.35);
    mark("done");
  } catch (error) {
    failed = error;
    await page.screenshot({ path: "/tmp/screen-qa/fail.jpg" }).catch(() => {});
    console.error(error);
  } finally {
    clearInterval(captions);
  }
  const video = page.video();
  const rawPath = await video.path();
  await context.close();
  await browser.close();
  if (failed) process.exit(1);
  console.log("lead", lead.toFixed(2), "raw", rawPath);
    const out = `${PITCH}/aegis-split-pitch.mp4`;
    const args = [
      "-y",
      "-ss", lead.toFixed(3),
      "-i", rawPath,
      "-i", `${BUILD}/vo.wav`,
      "-i", `${BUILD}/bed.wav`,
      "-filter_complex",
      `[0:v]scale=1920:1080:flags=lanczos,fps=24,format=yuv420p[v];[1:a]volume=4dB[voice];[2:a]volume=8dB[bed];[voice][bed]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.97[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-t", String(DURATION),
      "-c:v", "libx264",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-ar", "48000",
      "-b:a", "192k",
      "-movflags", "+faststart",
      out,
    ];
    const mixed = spawnSync("ffmpeg", args, { stdio: "inherit" });
    if (mixed.status !== 0) process.exit(mixed.status || 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
