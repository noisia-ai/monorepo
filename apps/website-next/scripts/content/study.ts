import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { studySchema, type StudyInput } from "../../src/content/studies/schema";
import { connect, parseArgs } from "./env";
import { lintDeckHtml, lintTexts } from "./lint";

/**
 * Loads a marketing study into the content database as a draft.
 *
 *   pnpm content:study <web folder> [--dry-run]
 *
 * The folder is what a study agent delivers (estudios/<industria>/web/):
 *   estudio.json   the study page and its access mode (src/content/studies/schema.ts)
 *   deck/          the builder folder as is: index.html, deck-stage.js, css, assets
 *   piezas.json    optional, the Insights pieces of the study
 *   portada.png    optional cover; without it, the first slide is the cover
 *
 * Nothing is written unless everything passes: the schema, the privacy checks on the summary,
 * the pieces and the deck. Then it renders one image per slide (the phone view), the cover and,
 * if the deck folder has no PDF, the PDF, all with Google Chrome. A study that already exists
 * keeps its status; when its files changed it gets a new version and the old files are removed.
 */

const { flags, positional } = parseArgs(process.argv.slice(2));
const folder = positional[0] ? resolve(positional[0]) : "";
if (!folder || !existsSync(join(folder, "estudio.json"))) {
  console.error("Usage: pnpm content:study <folder with estudio.json and deck/> [--dry-run]");
  process.exit(1);
}
const dryRun = flags.has("dry-run");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;
const SKIP = /(^|\/)(\.[^/]*|node_modules|__MACOSX)(\/|$)|\.(md|txt|map|psd|ai|sketch|fig)$/i;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf"
};

type File = { path: string; contentType: string; bytes: Buffer };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const problems: string[] = [];
const warnings: string[] = [];

// ---------- estudio.json ----------
const raw = JSON.parse(readFileSync(join(folder, "estudio.json"), "utf8")) as unknown;
const parsed = studySchema.safeParse(raw);
if (!parsed.success) {
  for (const issue of parsed.error.issues) problems.push(`estudio.json ${issue.path.join(".")}: ${issue.message}`);
}
const study = parsed.success ? (parsed.data as StudyInput) : null;
if (study) {
  problems.push(...lintTexts("estudio.json es", study.es), ...lintTexts("estudio.json en", study.en));
  if (["estudios", "studies", "reportes", "reports"].includes(study.id)) problems.push(`estudio.json id: "${study.id}" is a reserved path`);
}

// ---------- deck ----------
const deckDir = join(folder, "deck");
const deckFiles: File[] = [];
let builderPdf: File | null = null;
let deckHtml = "";
if (!existsSync(join(deckDir, "index.html"))) problems.push("deck/index.html is missing");
else if (!existsSync(join(deckDir, "deck-stage.js"))) problems.push("deck/deck-stage.js is missing");
else {
  for (const full of walk(deckDir).sort()) {
    const rel = relative(deckDir, full).split("\\").join("/");
    if (SKIP.test(rel)) continue;
    const ext = extname(rel).toLowerCase();
    const contentType = TYPES[ext];
    if (!contentType) {
      warnings.push(`deck/${rel}: unknown file type, left out`);
      continue;
    }
    const bytes = readFileSync(full);
    if (bytes.length > MAX_FILE) problems.push(`deck/${rel}: ${(bytes.length / 1e6).toFixed(1)} MB, over the 15 MB limit per file`);
    if (ext === ".pdf") {
      if (builderPdf) warnings.push(`deck/${rel}: a second PDF, left out`);
      else builderPdf = { path: `pdf/${study?.id ?? "estudio"}.pdf`, contentType, bytes };
      continue;
    }
    if (/social|tweet|post|captura/i.test(rel) && /^image\//.test(contentType)) {
      warnings.push(`deck/${rel}: looks like a screenshot of a post. Check that no name, @user or photo of a person shows.`);
    }
    deckFiles.push({ path: `deck/${rel}`, contentType, bytes });
  }
  deckHtml = readFileSync(join(deckDir, "index.html"), "utf8");
  const { issues, external } = lintDeckHtml(deckHtml);
  problems.push(...issues);
  if (external.length) warnings.push(`deck loads files from other sites: ${external.join(", ")}`);
  // Speaker notes are for whoever presents, not for readers.
  const cleaned = deckHtml.replace(/(<script[^>]*id=["']speaker-notes["'][^>]*>)[\s\S]*?(<\/script>)/i, "$1[]$2");
  const index = deckFiles.find((file) => file.path === "deck/index.html");
  if (index) index.bytes = Buffer.from(cleaned, "utf8");
  const total = deckFiles.reduce((sum, file) => sum + file.bytes.length, 0) + (builderPdf?.bytes.length ?? 0);
  if (total > MAX_TOTAL) problems.push(`deck: ${(total / 1e6).toFixed(1)} MB in all, over the 60 MB limit`);
}

// ---------- pieces (validated by content:load, which also writes them) ----------
const piecesFile = join(folder, "piezas.json");
const hasPieces = existsSync(piecesFile);
function runLoad(extra: string[]) {
  return spawnSync(process.execPath, [...process.execArgv, join(import.meta.dirname, "load.ts"), piecesFile, ...extra], { stdio: "inherit", env: process.env });
}
if (hasPieces && study) {
  const check = runLoad(["--dry-run"]);
  if (check.status !== 0) problems.push("piezas.json does not pass (see above)");
}

for (const warning of warnings) console.warn(`  ! ${warning}`);
if (problems.length > 0 || !study) {
  console.error(`Nothing was loaded. Fix these ${problems.length} problems:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// ---------- render: slides, cover and PDF ----------
console.log(`Rendering ${study.id} with Chrome...`);
const rendered: File[] = [];
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--force-device-scale-factor=1"] });
try {
  const page = await browser.newPage();
  const deckUrl = pathToFileURL(join(deckDir, "index.html")).href;

  async function openDeck(width: number, height: number) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(deckUrl, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => Boolean(customElements.get("deck-stage")) && Boolean(document.querySelector("deck-stage")?.shadowRoot));
    // The slide counter and the tap zones are for whoever navigates, not for an image.
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = ".overlay, .tapzones, .rail, .rail-resize { display: none !important; }";
      document.querySelector("deck-stage")?.shadowRoot?.append(style);
    });
  }

  async function showSlide(index: number) {
    await page.evaluate((i) => (document.querySelector("deck-stage") as unknown as { goTo(i: number): void }).goTo(i), index);
    await new Promise((done) => setTimeout(done, 700));
  }

  await openDeck(1920, 1080);
  const indexes = await page.evaluate(() =>
    Array.from(document.querySelector("deck-stage")?.children ?? [])
      .filter((el) => !["TEMPLATE", "SCRIPT", "STYLE"].includes(el.tagName))
      .map((el, i) => (el.hasAttribute("data-deck-skip") ? -1 : i))
      .filter((i) => i >= 0)
  );
  if (indexes.length === 0) throw new Error("The deck has no slides");
  for (const [n, index] of indexes.entries()) {
    await showSlide(index);
    const bytes = Buffer.from(await page.screenshot({ type: "webp", quality: 82 }));
    rendered.push({ path: `slides/${String(n + 1).padStart(2, "0")}.webp`, contentType: "image/webp", bytes });
    process.stdout.write(`  slide ${n + 1}/${indexes.length}\n`);
  }

  const portada = ["portada.png", "portada.jpg", "portada.webp"].map((name) => join(folder, name)).find((file) => existsSync(file));
  if (portada) {
    await page.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1 });
    const data = readFileSync(portada).toString("base64");
    const type = TYPES[extname(portada).toLowerCase()];
    await page.setContent(`<html><body style="margin:0"><img src="data:${type};base64,${data}" style="width:1200px;height:675px;object-fit:cover;display:block"></body></html>`, { waitUntil: "load" });
  } else {
    await openDeck(1200, 675);
    await showSlide(indexes[0]);
  }
  rendered.push({ path: "cover.webp", contentType: "image/webp", bytes: Buffer.from(await page.screenshot({ type: "webp", quality: 85 })) });

  if (!builderPdf) {
    console.log("  no PDF in deck/, printing one");
    await openDeck(1920, 1080);
    const pdf = await page.pdf({ width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
    builderPdf = { path: `pdf/${study.id}.pdf`, contentType: "application/pdf", bytes: Buffer.from(pdf) };
  }
} finally {
  await browser.close();
}

const files = [...deckFiles, ...rendered, builderPdf!];
const slideCount = rendered.filter((file) => file.path.startsWith("slides/")).length;
const totalMb = (files.reduce((sum, file) => sum + file.bytes.length, 0) / 1e6).toFixed(1);
console.log(`${study.id}: ${slideCount} slides, ${files.length} files, ${totalMb} MB.`);

if (dryRun) {
  console.log("Everything passes. Nothing was written (--dry-run).");
  process.exit(0);
}

// ---------- write ----------
const db = connect("CONTENT_ADMIN_DATABASE_URL");
await db.connect();
try {
  await db.query("begin");
  const existing = await db.query<{ version: number; status: string }>("select version, status from content.studies where id = $1 for update", [study.id]);
  const current = existing.rows[0];
  let version = current?.version ?? 1;
  if (current) {
    const { rows } = await db.query<{ path: string; sha256: string }>("select path, sha256 from content.study_files where study_id = $1 and version = $2", [study.id, version]);
    const before = rows.map((row) => `${row.path}:${row.sha256}`).sort().join("\n");
    const after = files.map((file) => `${file.path}:${sha(file.bytes)}`).sort().join("\n");
    if (before !== after) version += 1;
  }
  const values = [
    study.id,
    study.access,
    study.industry,
    study.market,
    study.method,
    study.period.label,
    study.period.start,
    study.period.end,
    JSON.stringify(study.base),
    JSON.stringify({ es: study.es, en: study.en }),
    study.full_language,
    "cover.webp",
    "deck/index.html",
    builderPdf!.path,
    slideCount,
    version
  ];
  await db.query(
    `insert into content.studies (id, access_mode, industry, market, method, period_label, period_start, period_end, base, summary,
                                  full_language, cover_path, deck_path, pdf_path, slide_count, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16)
     on conflict (id) do update set access_mode = excluded.access_mode, industry = excluded.industry, market = excluded.market,
       method = excluded.method, period_label = excluded.period_label, period_start = excluded.period_start,
       period_end = excluded.period_end, base = excluded.base, summary = excluded.summary, full_language = excluded.full_language,
       cover_path = excluded.cover_path, deck_path = excluded.deck_path, pdf_path = excluded.pdf_path,
       slide_count = excluded.slide_count, version = excluded.version`,
    values
  );
  if (!current || version !== current.version) {
    for (const file of files) {
      await db.query(
        `insert into content.study_files (study_id, version, path, content_type, bytes, sha256) values ($1, $2, $3, $4, $5, $6)
         on conflict (study_id, version, path) do update set content_type = excluded.content_type, bytes = excluded.bytes, sha256 = excluded.sha256`,
        [study.id, version, file.path, file.contentType, file.bytes, sha(file.bytes)]
      );
    }
    await db.query("delete from content.study_files where study_id = $1 and version <> $2", [study.id, version]);
  }
  await db.query("commit");
  const status = current?.status ?? "borrador";
  console.log(`Loaded ${study.id} as ${status}, version ${version}${current && version === current.version ? " (files unchanged)" : ""}.`);
} catch (error) {
  await db.query("rollback");
  console.error(`Nothing was loaded: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}

if (process.exitCode !== 1 && hasPieces) {
  const load = runLoad(["--study", study.id]);
  if (load.status !== 0) process.exitCode = 1;
}
if (process.exitCode !== 1) console.log(`Review it in UAT, then: pnpm content:publish --study ${study.id}`);
