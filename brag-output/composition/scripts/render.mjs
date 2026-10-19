// Deterministic frame renderer. Starts the composition's Vite server, opens N headless Chromium workers (software WebGL),
// and screenshots each frame as setTime(t) at 1920x1080 / 30 fps.
//   node scripts/render.mjs --out <dir> [--frames 0-899] [--workers 4] [--still 1.5,2.5]  [--fmt png|jpeg] [--pr 1.5]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const comp = path.resolve(here, "..");
const fe = path.resolve(comp, "../../frontend");
const req = createRequire(path.join(fe, "package.json"));
const { chromium } = req("playwright-core");
const { createServer } = await import(pathToFileURL(req.resolve("vite")).href);

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg("out", path.join(comp, "../_render/frames")));
const workers = Number(arg("workers", "4"));
const fmt = arg("fmt", "png");
const pr = arg("pr", "1.5");
const FPS = 30, TOTAL = 900;
let frames = [];
if (arg("still")) {
  frames = arg("still").split(",").map((t) => ({ name: `still_${Number(t).toFixed(2)}`, t: Number(t) }));
} else {
  const [a, b] = arg("frames", `0-${TOTAL - 1}`).split("-").map(Number);
  // Frame 0 carries the poster composition (the settled opening shot with the tagline) so the poster is baked into the video's first frame.
  const posterT = Number(arg("poster-t", "2.88"));
  for (let i = a; i <= b; i++) frames.push({ name: `f_${String(i).padStart(4, "0")}`, t: i === 0 ? posterT : i / FPS });
}
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const server = await createServer({ configFile: path.join(comp, "vite.config.mjs"), server: { port: 5199, strictPort: false }, logLevel: "warn" });
await server.listen();
const addr = server.resolvedUrls.local[0];
console.log("server", addr, "frames", frames.length);

const browser = await chromium.launch({
  executablePath: chrome,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--font-render-hinting=none"],
});
// Resume support: frames that already exist on disk are skipped (delete a file to re-render that frame).
const ext = fmt === "jpeg" ? "jpg" : "png";
const queue = frames.filter((f) => !fs.existsSync(path.join(out, `${f.name}.${ext}`)) || arg("force"));
const t0 = Date.now();
let done = 0;
async function openPage(ctx, id) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log(`[w${id}]`, m.text()); });
  page.on("pageerror", (e) => console.log(`[w${id}] pageerror`, e.message));
  await page.goto(`${addr}?pr=${pr}`);
  await page.waitForFunction(() => window.__brag?.ready || window.__bragError, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__bragError);
  if (err) throw new Error(err);
  return page;
}
async function worker(id) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  let page = await openPage(ctx, id);
  while (queue.length) {
    const f = queue.shift();
    const file = path.join(out, `${f.name}.${ext}`);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await page.evaluate((t) => window.__brag.setTime(t), f.t);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.screenshot(fmt === "jpeg" ? { path: file, type: "jpeg", quality: 93, timeout: 120000 } : { path: file, type: "png", timeout: 120000 });
        ok = true;
      } catch (e) {
        console.log(`[w${id}] retry ${f.name} (${attempt + 1}): ${String(e.message).split("\n")[0]}`);
        try { await page.close(); } catch {}
        page = await openPage(ctx, id);
      }
    }
    if (!ok) throw new Error(`frame ${f.name} failed`);
    done++;
    if (done % 20 === 0 || frames.length < 20) console.log(`${done}/${queue.length + done} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await ctx.close();
}
try {
  await Promise.all(Array.from({ length: Math.min(workers, frames.length) }, (_, i) => worker(i)));
} finally {
  await browser.close();
  await server.close();
}
console.log("done", done, "frames in", ((Date.now() - t0) / 1000).toFixed(0), "s ->", out);
