#!/usr/bin/env node
/**
 * website-assets.mjs: noisia.ai animations as slide assets (COMMERCIAL.md §2.1, src/website/registry.tsx).
 *
 *   node builders/website-assets.mjs --names understand,survey --locale es --out <dir>
 *   node builders/website-assets.mjs --list
 *
 * For each name it writes, in <dir>:
 *   <name>.<locale>.mp4   plays from the start, for presenting from the HTML deck
 *   <name>.<locale>.gif   for the PPTX: opens on the finished diagram (the website's poster frame)
 *   <name>.<locale>.png   the finished diagram, for the PDF and as the video's poster
 * Files already there are reused (pass --force to render them again). One bundle for all names.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderFrames, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const { websiteBridge } = createRequire(import.meta.url)("./webpack-website.cjs");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else (out[a.slice(2)] = next), i++;
  }
  return out;
}
for (const file of [join(PKG, ".env"), join(PKG, "..", "..", ".env.local")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const opt = args(process.argv.slice(2));
const licenseKey = process.env.REMOTION_LICENSE_KEY || null;
const browserExecutable = process.env.CHROME_EXECUTABLE ? process.env.CHROME_EXECUTABLE.replace(/^~/, process.env.HOME) : null;
const locale = opt.locale === "en" ? "en" : "es";

const work = mkdtempSync(join(tmpdir(), "noisia-website-"));
const publicDir = join(work, "public");
cpSync(join(PKG, "public"), publicDir, { recursive: true, dereference: true });
const serveUrl = await bundle({ entryPoint: join(PKG, "src", "index.ts"), publicDir, outDir: join(work, "bundle"), webpackOverride: websiteBridge });
const common = { serveUrl, browserExecutable, logLevel: "error" };
const pick = (props) => selectComposition({ ...common, id: "Website", inputProps: props });

// The registry lives in the bundle; the composition hands its catalog back in its props.
const first = await pick({ name: "understand", locale, rotate: 0 });
const registry = first.props.catalog;
if (opt.list) {
  for (const [k, v] of Object.entries(registry)) console.log(`${k.padEnd(20)} ${String(v.frames).padStart(4)} frames · ${v.about}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}
if (!opt.names || !opt.out) {
  console.error("website-assets: --names a,b --locale es|en --out <dir>   (or --list)");
  process.exit(1);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const concurrency = Math.max(1, Math.min(6, cpus().length - 2));

for (const name of String(opt.names).split(",").map((s) => s.trim()).filter(Boolean)) {
  const e = registry[name];
  if (!e) {
    console.error(`website-assets: no "${name}". Names: ${Object.keys(registry).join(", ")}`);
    process.exit(1);
  }
  const base = join(out, `${name}.${locale}`);
  const done = [".mp4", ".gif", ".png"].every((x) => existsSync(base + x));
  if (done && !opt.force) {
    console.log(`${name}.${locale}: already there`);
    continue;
  }
  const plain = await pick({ name, locale, rotate: 0 });
  console.log(`${name}.${locale}: ${e.frames} frames, poster ${e.poster}`);
  await renderStill({ ...common, composition: plain, frame: e.poster, output: base + ".png", inputProps: plain.props, licenseKey });
  await renderMedia({ ...common, composition: plain, inputProps: plain.props, codec: "h264", crf: 20, pixelFormat: "yuv420p", outputLocation: base + ".mp4", concurrency, licenseKey });
  const rotated = await pick({ name, locale, rotate: e.poster });
  const seq = join(work, `seq-${name}`);
  mkdirSync(seq);
  await renderFrames({ ...common, composition: rotated, inputProps: rotated.props, imageFormat: "png", outputDir: seq, everyNthFrame: 2, scale: 0.75, concurrency, onStart: () => {} });
  const r = spawnSync("python3", [join(HERE, "mkgif.py"), seq, base + ".gif"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}
rmSync(work, { recursive: true, force: true });
