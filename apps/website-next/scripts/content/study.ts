import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { studyMarkets, studySchema, type StudyInput } from "../../src/content/studies/schema";
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
 *   deck-en/       optional, the same deck in English, with as many slides as deck/ (README.md)
 *   piezas.json    optional, the Insights pieces of the study
 *   portada.png    optional cover; without it, the first slide is the cover
 *   imagen.png     optional image of the study for its page, vertical (content-db/STUDY_IMAGES.md);
 *   imagen-wide.png optional horizontal version for its card and its access email;
 *                  needs `image_alt` in both languages. `pnpm content:image` writes its prompt.
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

// ---------- the study's image ----------
const imagen = ["imagen.png", "imagen.jpg", "imagen.jpeg", "imagen.webp"].map((name) => join(folder, name)).find((file) => existsSync(file));
if (imagen && study) {
  for (const lang of ["es", "en"] as const) {
    if (!study[lang].image_alt) problems.push(`estudio.json ${lang}.image_alt: the folder has ${relative(folder, imagen)}, describe it for people who cannot see it`);
  }
  if (statSync(imagen).size > MAX_FILE) problems.push(`${relative(folder, imagen)}: over the 15 MB limit`);
}
// The horizontal version, for the card and the email. It needs the vertical one.
const imagenWide = ["imagen-wide.png", "imagen-wide.jpg", "imagen-wide.jpeg", "imagen-wide.webp"].map((name) => join(folder, name)).find((file) => existsSync(file));
if (imagenWide && !imagen) problems.push(`${relative(folder, imagenWide)}: the folder has the horizontal image but not imagen.png`);
if (imagenWide && statSync(imagenWide).size > MAX_FILE) problems.push(`${relative(folder, imagenWide)}: over the 15 MB limit`);

// ---------- deck (and its English twin) ----------
type Deck = { name: "deck" | "deck-en"; dir: string; files: File[]; pdf: File | null };

function readDeck(name: Deck["name"], pdfPath: string): Deck {
  const dir = join(folder, name);
  const deck: Deck = { name, dir, files: [], pdf: null };
  if (!existsSync(join(dir, "index.html"))) {
    problems.push(`${name}/index.html is missing`);
    return deck;
  }
  if (!existsSync(join(dir, "deck-stage.js"))) {
    problems.push(`${name}/deck-stage.js is missing`);
    return deck;
  }
  for (const full of walk(dir).sort()) {
    const rel = relative(dir, full).split("\\").join("/");
    if (SKIP.test(rel)) continue;
    const ext = extname(rel).toLowerCase();
    const contentType = TYPES[ext];
    if (!contentType) {
      warnings.push(`${name}/${rel}: unknown file type, left out`);
      continue;
    }
    const bytes = readFileSync(full);
    if (bytes.length > MAX_FILE) problems.push(`${name}/${rel}: ${(bytes.length / 1e6).toFixed(1)} MB, over the 15 MB limit per file`);
    if (ext === ".pdf") {
      if (deck.pdf) warnings.push(`${name}/${rel}: a second PDF, left out`);
      else deck.pdf = { path: pdfPath, contentType, bytes };
      continue;
    }
    if (/social|tweet|post|captura/i.test(rel) && /^image\//.test(contentType)) {
      warnings.push(`${name}/${rel}: looks like a screenshot of a post. Check that no name, @user or photo of a person shows.`);
    }
    deck.files.push({ path: `${name}/${rel}`, contentType, bytes });
  }
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const { issues, external } = lintDeckHtml(html);
  problems.push(...issues.map((issue) => (name === "deck" ? issue : issue.replace(/^deck:/, `${name}:`))));
  if (external.length) warnings.push(`${name} loads files from other sites: ${external.join(", ")}`);
  // Speaker notes are for whoever presents, not for readers.
  const cleaned = html.replace(/(<script[^>]*id=["']speaker-notes["'][^>]*>)[\s\S]*?(<\/script>)/i, "$1[]$2");
  const index = deck.files.find((file) => file.path === `${name}/index.html`);
  if (index) index.bytes = Buffer.from(cleaned, "utf8");
  return deck;
}

const id = study?.id ?? "estudio";
const decks: Deck[] = [readDeck("deck", `pdf/${id}.pdf`)];
if (existsSync(join(folder, "deck-en"))) decks.push(readDeck("deck-en", `pdf-en/${id}.pdf`));
const deckFiles = decks.flatMap((deck) => deck.files);
const total = deckFiles.reduce((sum, file) => sum + file.bytes.length, 0) + decks.reduce((sum, deck) => sum + (deck.pdf?.bytes.length ?? 0), 0);
if (total > MAX_TOTAL) problems.push(`decks: ${(total / 1e6).toFixed(1)} MB in all, over the 60 MB limit`);

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
  async function openDeck(width: number, height: number, deck: Deck = decks[0]!) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(deck.dir, "index.html")).href, { waitUntil: "networkidle0" });
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

  // One image per slide, for each deck. The English deck must have as many slides as the main one.
  const slideCounts: number[] = [];
  let firstIndex = 0;
  for (const deck of decks) {
    await openDeck(1920, 1080, deck);
    const indexes = await page.evaluate(() =>
      Array.from(document.querySelector("deck-stage")?.children ?? [])
        .filter((el) => !["TEMPLATE", "SCRIPT", "STYLE"].includes(el.tagName))
        .map((el, i) => (el.hasAttribute("data-deck-skip") ? -1 : i))
        .filter((i) => i >= 0)
    );
    if (indexes.length === 0) throw new Error(`${deck.name} has no slides`);
    if (deck.name === "deck") firstIndex = indexes[0]!;
    const prefix = deck.name === "deck" ? "slides" : "slides-en";
    for (const [n, index] of indexes.entries()) {
      await showSlide(index);
      const bytes = Buffer.from(await page.screenshot({ type: "webp", quality: 82 }));
      rendered.push({ path: `${prefix}/${String(n + 1).padStart(2, "0")}.webp`, contentType: "image/webp", bytes });
      process.stdout.write(`  ${prefix} ${n + 1}/${indexes.length}\n`);
    }
    slideCounts.push(indexes.length);
  }
  if (slideCounts.length === 2 && slideCounts[0] !== slideCounts[1]) {
    throw new Error(`deck/ has ${slideCounts[0]} slides and deck-en/ has ${slideCounts[1]}: they must match`);
  }

  const portada = ["portada.png", "portada.jpg", "portada.webp"].map((name) => join(folder, name)).find((file) => existsSync(file));
  if (portada) {
    await page.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1 });
    const data = readFileSync(portada).toString("base64");
    const type = TYPES[extname(portada).toLowerCase()];
    await page.setContent(`<html><body style="margin:0"><img src="data:${type};base64,${data}" style="width:1200px;height:675px;object-fit:cover;display:block"></body></html>`, { waitUntil: "load" });
  } else {
    await openDeck(1200, 675);
    await showSlide(firstIndex);
  }
  rendered.push({ path: "cover.webp", contentType: "image/webp", bytes: Buffer.from(await page.screenshot({ type: "webp", quality: 85 })) });

  /** An image at its own proportions, at most 1600 px on the long side, as webp. */
  async function webp(file: string): Promise<Buffer> {
    const data = readFileSync(file).toString("base64");
    const type = TYPES[extname(file).toLowerCase()];
    await page.setViewport({ width: 1600, height: 1600, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" src="data:${type};base64,${data}"></body></html>`, { waitUntil: "load" });
    const size = await page.evaluate(() => {
      const img = document.getElementById("i") as HTMLImageElement;
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.round(img.naturalWidth * scale);
      const height = Math.round(img.naturalHeight * scale);
      img.style.cssText = `display:block;width:${width}px;height:${height}px`;
      return { width, height };
    });
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    return Buffer.from(await page.screenshot({ type: "webp", quality: 86, omitBackground: true }));
  }

  if (imagen) {
    const data = readFileSync(imagen).toString("base64");
    const type = TYPES[extname(imagen).toLowerCase()];
    rendered.push({ path: "hero.webp", contentType: "image/webp", bytes: await webp(imagen) });
    if (imagenWide) rendered.push({ path: "hero-wide.webp", contentType: "image/webp", bytes: await webp(imagenWide) });

    // The banner of the access email (content-db/STUDY_EMAIL.md): 1040 × 560, shown at 520 × 280,
    // a JPEG flattened on white (email clients show transparency as black and classic Outlook shows
    // no webp). The image melts into white with multiply over a faint cyan and red aura, the brand's
    // neon used as glow, never as a fill.
    // With the horizontal image, the banner is that photograph, cropped to fill the frame.
    const wide = imagenWide ? { data: readFileSync(imagenWide).toString("base64"), type: TYPES[extname(imagenWide).toLowerCase()] } : null;
    await page.setViewport({ width: 1040, height: 560, deviceScaleFactor: 1 });
    await page.setContent(
      wide
        ? `<html><body style="margin:0;width:1040px;height:560px;background:#fff;overflow:hidden"><img src="data:${wide.type};base64,${wide.data}" style="display:block;width:1040px;height:560px;object-fit:cover;object-position:center 40%"></body></html>`
        : `<html><body style="margin:0;width:1040px;height:560px;background:#fff;position:relative;overflow:hidden">
        <div style="position:absolute;left:250px;top:150px;width:300px;height:380px;border-radius:50%;background:#009CA8;opacity:.2;filter:blur(70px)"></div>
        <div style="position:absolute;left:490px;top:120px;width:300px;height:380px;border-radius:50%;background:#D91441;opacity:.1;filter:blur(70px)"></div>
        <img src="data:${type};base64,${data}" style="position:absolute;left:50%;bottom:0;max-width:980px;max-height:556px;transform:translateX(-50%);mix-blend-mode:multiply">
      </body></html>`,
      { waitUntil: "load" }
    );
    rendered.push({ path: "email-banner.jpg", contentType: "image/jpeg", bytes: Buffer.from(await page.screenshot({ type: "jpeg", quality: 86 })) });

    // The 2:3 thumbnail of the first access emails, kept so the emails already sent still show it.
    await page.setViewport({ width: 264, height: 396, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:#fff"><img src="data:${type};base64,${data}" style="width:264px;height:396px;object-fit:cover;object-position:center top;display:block"></body></html>`,
      { waitUntil: "load" }
    );
    rendered.push({ path: "email.jpg", contentType: "image/jpeg", bytes: Buffer.from(await page.screenshot({ type: "jpeg", quality: 84 })) });
  }

  for (const deck of decks) {
    if (deck.pdf) continue;
    console.log(`  no PDF in ${deck.name}/, printing one`);
    await openDeck(1920, 1080, deck);
    const pdf = await page.pdf({ width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
    deck.pdf = { path: deck.name === "deck" ? `pdf/${study.id}.pdf` : `pdf-en/${study.id}.pdf`, contentType: "application/pdf", bytes: Buffer.from(pdf) };
  }
} finally {
  await browser.close();
}

const files = [...deckFiles, ...rendered, ...decks.map((deck) => deck.pdf!)];
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
    studyMarkets(study)[0],
    study.method,
    study.period.label,
    study.period.start,
    study.period.end,
    JSON.stringify(study.base),
    JSON.stringify({ es: study.es, en: study.en }),
    study.full_language,
    "cover.webp",
    "deck/index.html",
    decks[0]!.pdf!.path,
    slideCount,
    version,
    studyMarkets(study),
    imagen ? "hero.webp" : null
  ];
  await db.query(
    `insert into content.studies (id, access_mode, industry, market, method, period_label, period_start, period_end, base, summary,
                                  full_language, cover_path, deck_path, pdf_path, slide_count, version, markets, hero_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17::text[], $18)
     on conflict (id) do update set access_mode = excluded.access_mode, industry = excluded.industry, market = excluded.market, markets = excluded.markets,
       method = excluded.method, period_label = excluded.period_label, period_start = excluded.period_start,
       period_end = excluded.period_end, base = excluded.base, summary = excluded.summary, full_language = excluded.full_language,
       cover_path = excluded.cover_path, deck_path = excluded.deck_path, pdf_path = excluded.pdf_path,
       slide_count = excluded.slide_count, version = excluded.version, hero_path = excluded.hero_path`,
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
