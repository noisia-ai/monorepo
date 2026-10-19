#!/usr/bin/env node
/**
 * Exports an insight story to MP4 from the same code the website plays.
 *
 *   node scripts/export-story.mjs <story-id> [--locale es|en] [--base http://localhost:3010] [--out renders]
 *
 * Needs the site running (pnpm dev or pnpm start) and Google Chrome installed.
 * Frames are captured one by one at 1080×1920 from /render/<id>?mode=video and encoded with ffmpeg.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!id) {
  console.error("Usage: node scripts/export-story.mjs <story-id> [--locale es|en] [--base URL] [--out DIR]");
  process.exit(1);
}
const locale = flag("locale", "es");
const base = flag("base", "http://localhost:3010").replace(/\/$/, "");
const outDir = resolve(flag("out", "renders"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const url = `${base}${locale === "en" ? "/en" : ""}/render/${id}?frame=0&mode=video`;
const frames = mkdtempSync(join(tmpdir(), `noisia-${id}-`));
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--force-device-scale-factor=1"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => typeof window.__noisiaSetFrame === "function");
  const root = await page.$("#render-root");
  const duration = Number(await page.$eval("#render-root", (node) => node.getAttribute("data-duration")));
  console.log(`Capturing ${duration} frames from ${url}`);
  for (let frame = 0; frame < duration; frame++) {
    await page.evaluate((n) => window.__noisiaSetFrame(n), frame);
    await root.screenshot({ path: join(frames, `${String(frame).padStart(5, "0")}.png`) });
    if (frame % 60 === 0) process.stdout.write(`  ${frame}/${duration}\n`);
  }
} finally {
  await browser.close();
}

const output = join(outDir, `${id}.${locale}.mp4`);
const result = spawnSync(
  ffmpeg.path,
  ["-y", "-framerate", "30", "-i", join(frames, "%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", output],
  { stdio: "inherit" }
);
rmSync(frames, { recursive: true, force: true });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Saved ${output}`);
