import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const ROOT = "/agent/repos/AEGIS-SPILT/pitch";
const FPS = 24;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/film.html";
      const file = normalize(join(ROOT, pathname));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("no");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
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

async function makePage(browser, port) {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.goto(`http://127.0.0.1:${port}/film.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.CUES && typeof window.renderAt === "function");
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const cues = JSON.parse(await readFile(join(ROOT, "build/cues.json"), "utf8"));
const server = await startServer();
const { port } = server.address();
const stills = process.argv.includes("--stills");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

if (stills) {
  await mkdir(join(ROOT, "build/stills"), { recursive: true });
  const page = await makePage(browser, port);
  const shots = [["open", 0.2]];
  for (const beat of cues.beats) {
    shots.push([`${beat.scene}-${beat.id}`, (beat.start + beat.end) / 2]);
  }
  shots.push(["end", Math.max(0, cues.duration - 0.45)]);
  for (const [name, time] of shots) {
    await page.evaluate((t) => window.renderAt(t), time);
    const file = join(ROOT, "build/stills", `${name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 86 });
    console.log(name, time.toFixed(2));
  }
} else {
  const frames = Math.ceil(cues.duration * FPS);
  await mkdir(join(ROOT, "build/frames"), { recursive: true });
  const workers = Math.max(1, Number(process.env.WORKERS || 3));
  const slice = Math.ceil(frames / workers);
  console.log(`frames ${frames} workers ${workers} duration ${cues.duration}`);
  await Promise.all(
    Array.from({ length: workers }, async (_, worker) => {
      const start = worker * slice;
      const end = Math.min(frames, start + slice);
      if (start >= frames) return;
      const page = await makePage(browser, port);
      for (let index = start; index < end; index += 1) {
        await page.evaluate((t) => window.renderAt(t), index / FPS);
        await page.screenshot({
          path: join(ROOT, "build/frames", `${String(index).padStart(5, "0")}.jpg`),
          type: "jpeg",
          quality: 84,
        });
        if ((index - start) % FPS === 0) {
          console.log(`worker ${worker} ${index}/${end}`);
        }
      }
      await page.close();
    })
  );
}

await browser.close();
server.close();
