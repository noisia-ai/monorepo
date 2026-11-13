#!/usr/bin/env node
/**
 * build-video.mjs: one JSON piece in, one video out. Rules: packages/pitch-kit/VIDEO.md.
 *
 *   node builders/build-video.mjs --format clip   --in story.json --story <id> --locale es --out clip.mp4
 *   node builders/build-video.mjs --format social --in piece.json --out piece.mp4
 *   node builders/build-video.mjs --format study  --in piece.json --out study.mp4
 *   node builders/build-video.mjs --format deck   --in piece.json --out diagram.gif --gif
 *   ... --qa out/qa          stills at every scene marker plus a contact sheet, instead of the video
 *   ... --scale 0.5          quick draft at half size
 *
 * Social and study read <piece>.timing.json, written by builders/audio.py. If it is missing, this
 * runs `audio.py --estimate` (silent draft, no API call). The Remotion license key is read from
 * packages/motion/.env and passed to every render.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bundle } from "@remotion/bundler";
import { renderFrames, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const COMPOSITION = { clip: "Clip", social: "Social", study: "Study", deck: "Deck" };
const CRF = { clip: 18, social: 18, study: 22, deck: 16 };

// ---------------------------------------------------------------- args and env
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

// Keys: packages/motion/.env, then the repo root's .env.local, where the team keeps every tool key
// (both ignored by git). The first value found wins; the shell environment wins over both.
function loadEnv() {
  for (const file of [join(PKG, ".env"), join(PKG, "..", "..", ".env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

function fail(message) {
  console.error(`build-video: ${message}`);
  process.exit(1);
}

const opt = args(process.argv.slice(2));
loadEnv();
const format = opt.format;
if (!COMPOSITION[format]) fail("--format must be clip, social, study or deck");
if (!opt.in) fail("--in <piece.json> is required");
const input = resolve(opt.in);
if (!existsSync(input)) fail(`no such file: ${input}`);
const out = resolve(opt.out ?? join(PKG, "out", `${basename(input, ".json")}${opt.gif ? ".gif" : ".mp4"}`));
const licenseKey = process.env.REMOTION_LICENSE_KEY || null;
if (!licenseKey) console.warn("build-video: no REMOTION_LICENSE_KEY in the repo root's .env.local or packages/motion/.env; rendering without the company license key.");
const browserExecutable = process.env.CHROME_EXECUTABLE ? process.env.CHROME_EXECUTABLE.replace(/^~/, process.env.HOME) : null;
const scale = opt.scale ? Number(opt.scale) : 1;

// ---------------------------------------------------------------- the piece → input props
const raw = JSON.parse(readFileSync(input, "utf8"));
let inputProps;
let timing = null;
if (format === "clip") {
  const stories = Array.isArray(raw) ? raw : [raw];
  const story = opt.story ? stories.find((s) => s.id === opt.story) : stories[0];
  if (!story) fail(`story "${opt.story}" not found in ${input}. Ids: ${stories.map((s) => s.id).join(", ")}`);
  const locale = opt.locale === "en" ? "en" : "es";
  // The base card closes every clip: the story's channels, period and market (VIDEO.md §2).
  const base = story.sources?.length ? { channels: story.sources, period: story.period, market: story.market, method: story.method } : undefined;
  if (!base) console.warn("build-video: this story has no sources; the clip goes out without its base card.");
  inputProps = { title: story[locale].title, scenes: story[locale].scenes, locale, tag: opt.tag, showTitle: !opt["no-title"], base };
} else if (format === "deck") {
  inputProps = { piece: raw, rotate: 0 };
} else {
  if (raw.format !== format) fail(`the piece says format "${raw.format}", not "${format}"`);
  const timingFile = input.replace(/\.json$/, ".timing.json");
  const voiced = format === "study" || raw.scenes.some((s) => s.vo);
  if (voiced && !existsSync(timingFile)) {
    console.log("No timing yet: estimating it without audio (builders/audio.py --estimate).");
    const r = spawnSync("python3", [join(HERE, "audio.py"), input, "--estimate"], { stdio: "inherit" });
    if (r.status !== 0) fail("audio.py --estimate failed");
  }
  if (existsSync(timingFile)) {
    timing = JSON.parse(readFileSync(timingFile, "utf8"));
    if (timing.estimated) console.log("Timing is estimated (no audio): this is a silent draft.");
  }
  inputProps = { piece: raw, timing };
}

// ---------------------------------------------------------------- public folder: brand assets + the piece's own files
const work = mkdtempSync(join(tmpdir(), "noisia-motion-"));
const publicDir = join(work, "public");
// dereference: a symlinked public/ would otherwise make the piece files below land inside the kit.
cpSync(join(PKG, "public"), publicDir, { recursive: true, dereference: true });
for (const sub of ["audio", "images"]) {
  const from = join(dirname(input), sub);
  if (existsSync(from)) cpSync(from, join(publicDir, "piece", sub), { recursive: true });
}

console.log(`Bundling ${COMPOSITION[format]}…`);
// Root registers the website's compositions too, so every bundle needs the bridge (webpack-website.cjs).
const { websiteBridge } = createRequire(import.meta.url)("./webpack-website.cjs");
const serveUrl = await bundle({ entryPoint: join(PKG, "src", "index.ts"), publicDir, outDir: join(work, "bundle"), webpackOverride: websiteBridge });
const common = { serveUrl, browserExecutable, logLevel: "error" };

async function composition(props) {
  return selectComposition({ ...common, id: COMPOSITION[format], inputProps: props });
}

// ---------------------------------------------------------------- QA stills
function markersOf(comp) {
  const props = comp.props;
  const at = [];
  if (format === "deck") {
    const total = comp.durationInFrames;
    return [["complete", Math.round(total * 0.7)], ["start", 20], ["middle", Math.round(total * 0.4)], ["loop-end", total - 4]];
  }
  if (format === "clip") {
    let from = 0;
    const len = { hook: 84, stat: 108, compare: 138, journey: 156, split: 120, tension: 126, quote: 156, takeaway: 108, base: 120 };
    props.scenes.forEach((s, i) => {
      from += len[s.type] ?? 110;
      at.push([`${i + 1}-${s.type}`, from - 14]);
    });
    if (props.base) at.push(["base", from + 100]);
    at.push(["logo", comp.durationInFrames - 4]);
    return at;
  }
  if (!props.timing) {
    let from = 0;
    const len = { hook: 84, stat: 108, compare: 138, journey: 156, split: 120, tension: 126, quote: 156, takeaway: 108, base: 120 };
    props.piece.scenes.forEach((s, i) => {
      from += len[s.type] ?? 110;
      at.push([`${i + 1}-${s.type}`, from - 14]);
    });
    at.push(["logo", comp.durationInFrames - 4]);
    return at;
  }
  props.timing.scenes.forEach((t, i) => {
    const sc = props.piece.scenes[i];
    const name = `${i + 1}-${t.id}`;
    const vo = t.clips.find((c) => c.kind === "vo");
    const q = t.clips.find((c) => c.kind === "quote");
    if (vo) at.push([`${name}-voice-end`, t.from + vo.at + vo.len]);
    if (q) at.push([`${name}-quote-end`, t.from + q.at + q.len]);
    if (t.marks.words_at != null) at.push([`${name}-words`, t.from + t.marks.words_at + 30]);
    if (t.marks.zero_at != null) at.push([`${name}-zero`, t.from + t.marks.zero_at + 6]);
    if (t.marks.chat_at != null) at.push([`${name}-chat`, t.from + (t.marks.spark_at ?? t.len) - 10]);
    if (t.marks.spark_at != null) at.push([`${name}-spark`, t.from + t.marks.spark_at + 30]);
    if (t.marks.logo_at != null) at.push([`${name}-logo`, t.from + t.marks.logo_at + 30]);
    if (!vo && !q) at.push([`${name}-${sc.type}`, t.from + t.len - 14]);
    // Transitions too: the scene's first beat and the frame just before each mark, where the phase
    // going out and the one coming in can overlap.
    at.push([`${name}-in`, t.from + 24]);
    for (const [k, v] of Object.entries(t.marks)) if (v != null && v > 30) at.push([`${name}-pre-${k.replace(/_at$/, "")}`, t.from + v - 4]);
    if (q) at.push([`${name}-pre-quote`, t.from + q.at + 6]);
  });
  if (format === "social") at.push(["logo", comp.durationInFrames - 4]);
  return at.filter(([, f]) => f < comp.durationInFrames);
}

if (opt.qa) {
  const dir = resolve(opt.qa);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The study turns its layout guard on: a still where two blocks cross fails with their names
  // (src/common/LayoutGuard.tsx). The still is then rendered again without the guard, so the contact
  // sheet still shows the problem.
  const guarded = format === "study";
  const comp = await composition(guarded ? { ...inputProps, qa: true } : inputProps);
  const marks = [...new Map(markersOf(comp).map(([n, f]) => [f, [n, f]])).values()].sort((a, b) => a[1] - b[1]);
  const problems = [];
  for (const [name, frame] of marks) {
    const output = join(dir, `${String(frame).padStart(5, "0")}-${name}.png`);
    try {
      await renderStill({ ...common, composition: comp, frame, output, inputProps: comp.props, scale: 0.5, licenseKey });
    } catch (e) {
      const m = String(e?.message ?? e).match(/layout guard, frame \d+: [^\n]*/);
      if (!m) throw e;
      problems.push(`${name}: ${m[0]}`);
      const plain = { ...comp.props, qa: false };
      await renderStill({ ...common, composition: { ...comp, props: plain }, frame, output, inputProps: plain, scale: 0.5, licenseKey });
    }
  }
  const r = spawnSync("python3", [join(HERE, "qa.py"), "sheet", dir, join(dir, "_contact-sheet.png")], { stdio: "inherit" });
  if (r.status !== 0) fail("qa.py sheet failed");
  console.log(`${marks.length} stills → ${dir}`);
  rmSync(work, { recursive: true, force: true });
  if (problems.length) {
    console.error(`\nQA failed: ${problems.length} still(s) with overlapping blocks. An overlap blocks delivery (VIDEO.md §7).`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (guarded) console.log("Layout guard: no block crosses another in any still.");
  process.exit(0);
}

// ---------------------------------------------------------------- render
mkdirSync(dirname(out), { recursive: true });
const concurrency = Math.max(1, Math.min(6, cpus().length - 2));
if (opt.gif) {
  if (format !== "deck") fail("--gif is for deck motion");
  // The GIF starts on the complete diagram (Slides' PDF shows only the first frame).
  const first = await composition(inputProps);
  const rotate = Math.round(first.durationInFrames * 0.7);
  const comp = await composition({ ...inputProps, rotate });
  const seq = join(work, "seq");
  mkdirSync(seq);
  await renderFrames({ ...common, composition: comp, inputProps: comp.props, imageFormat: "png", outputDir: seq, everyNthFrame: 2, concurrency, onStart: () => {} });
  const r = spawnSync("python3", [join(HERE, "mkgif.py"), seq, out], { stdio: "inherit" });
  if (r.status !== 0) fail("mkgif.py failed");
} else {
  const comp = await composition(inputProps);
  let last = -1;
  await renderMedia({
    ...common,
    composition: comp,
    inputProps: comp.props,
    codec: "h264",
    crf: CRF[format],
    pixelFormat: "yuv420p",
    scale,
    outputLocation: out,
    concurrency,
    licenseKey,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10);
      if (p !== last) (last = p), process.stdout.write(`\r  rendering ${p * 10}%`);
    }
  });
  process.stdout.write("\n");
}
rmSync(work, { recursive: true, force: true });
const mb = (statSync(out).size / 1e6).toFixed(1);
console.log(`${out} · ${mb} MB`);
