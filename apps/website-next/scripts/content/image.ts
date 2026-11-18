import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { studyMarkets, studySchema } from "../../src/content/studies/schema";
import { parseArgs, requireEnv } from "./env";

/**
 * Writes the images of a study: the house style (content-db/STUDY_IMAGES.md) plus the study's own
 * scene (`image` in estudio.json) become one prompt per shape, and OpenAI draws the candidates.
 *
 *   pnpm content:image <web folder> [--shape both|vertical|wide] [--n 2] [--dry-run]
 *
 * vertical (2:3, the study's page)  -> imagen.prompt.txt,      imagen-1.png, imagen-2.png…
 * wide     (3:2, card and email)    -> imagen-wide.prompt.txt, imagen-wide-1.png…
 *
 * Whoever reviews them renames the chosen ones to imagen.png and imagen-wide.png; `pnpm
 * content:study` then loads them. Each candidate costs money (about USD 0.20 at high quality):
 * --n stays at 4 or less and the script prints the cost before asking. Needs OPENAI_API_KEY in the
 * repo root's .env.local. --dry-run only writes the prompts.
 */

const MODEL = process.env.STUDY_IMAGE_MODEL || "gpt-image-2.6-sunburst";
const COST_PER_IMAGE_USD = 0.2;
const MAX_N = 4;

const SHAPES = {
  vertical: {
    size: "1024x1536",
    prompt: "imagen.prompt.txt",
    file: "imagen",
    frame: "Vertical 2:3 frame. The person stands slightly off-center, seen from waist or knees up, with the room rising behind them and pale space above."
  },
  wide: {
    size: "1536x1024",
    prompt: "imagen-wide.prompt.txt",
    file: "imagen-wide",
    frame: "Horizontal 3:2 frame. The person stands in the left or right third, seen from waist or knees up; the rest of the frame is the pale room, so the place reads. Keep the person well inside the frame: it will be cropped to 16:9 and to 1.85:1."
  }
} as const;
type Shape = keyof typeof SHAPES;

const { flags, positional } = parseArgs(process.argv.slice(2));
const folder = positional[0] ? resolve(positional[0]) : "";
if (!folder || !existsSync(join(folder, "estudio.json"))) {
  console.error("Usage: pnpm content:image <folder with estudio.json> [--shape both|vertical|wide] [--n 2] [--dry-run]");
  process.exit(1);
}

const parsed = studySchema.safeParse(JSON.parse(readFileSync(join(folder, "estudio.json"), "utf8")));
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`estudio.json ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const study = parsed.data;
const image = study.image;
if (!image?.brief || !image.place) {
  console.error(
    "estudio.json needs image.brief (who, and the moment they are living) and image.place (where it happens and what is behind them). See content-db/STUDY_IMAGES.md."
  );
  process.exit(1);
}

const MARKET_PEOPLE: Record<string, string> = {
  MX: "Mexico",
  UK: "the United Kingdom",
  BR: "Brazil",
  DE: "Germany",
  "US-CA": "the United States and Canada",
  ES: "Spain",
  FR: "France"
};

/**
 * The house style: a person in soft haze with an anaglyph edge, standing in the real place of the
 * study, washed to white. Mirrors content-db/STUDY_IMAGES.md ("The style, block by block");
 * change both together. Each block answers one question and the order matters: the model weighs
 * the start of the prompt most.
 */
const STYLE = {
  photograph:
    "A real documentary photograph, shot on location with a large-format film camera, for the page of a consumer research study. It must read as an honest photograph of a real place: never a cutout on a blank background, never a digital illustration.",
  person:
    "The person is seen in profile or three-quarter from behind; the face is turned down or away and is never readable. They are the only thing in the frame with tone and a little muted color. A soft luminous haze wraps the figure and dissolves the lower body into light. Anaglyph chromatic split on the figure's edges only: a coral-red fringe (#D91441) on one side and a cyan fringe (#009CA8) on the other, like a slightly misregistered print.",
  place:
    "Behind the person, the real place where the moment happens, sharp enough to be recognized but pushed far back: black and white, very high-key and overexposed, low contrast, washed toward white so it almost melts into the paper, like a bright room photographed with the exposure set for the person. Real architecture, furniture and objects with natural perspective and soft daylight; no harsh shadows. The edges of the frame fade to white. The person clearly stands out against this pale context.",
  finish: "Fine photochemical grain over the whole frame. Quiet, cinematic, editorial. One clear human action that is the subject of the study.",
  never:
    "Never: text, letters, numbers, logos, brand names, readable documents, labels or screens (a screen shows only a soft blur), watermarks, recognizable faces, celebrities or public figures, children. No person isolated on a white or transparent background."
};

const people = studyMarkets(study).map((m) => MARKET_PEOPLE[m]).join(", ");

function prompt(shape: Shape): string {
  return [
    STYLE.photograph,
    STYLE.person,
    STYLE.place,
    STYLE.finish,
    SHAPES[shape].frame,
    STYLE.never,
    `The study: "${study.en.title}". ${study.en.dek}`,
    `The person looks like an everyday resident of ${people}.`,
    `The moment: ${image!.brief}`,
    `The place, washed almost to white behind them: ${image!.place}`
  ].join("\n\n");
}

const shapeFlag = String(flags.get("shape") ?? "both");
const shapes: Shape[] = shapeFlag === "both" ? ["vertical", "wide"] : shapeFlag === "vertical" || shapeFlag === "wide" ? [shapeFlag] : [];
if (shapes.length === 0) {
  console.error("--shape is both, vertical or wide");
  process.exit(1);
}
for (const shape of shapes) {
  writeFileSync(join(folder, SHAPES[shape].prompt), `${prompt(shape)}\n`);
  console.log(`Prompt written to ${join(folder, SHAPES[shape].prompt)} (${MODEL}, ${SHAPES[shape].size}).`);
}
if (flags.has("dry-run")) process.exit(0);

const n = Math.min(MAX_N, Math.max(1, Number.parseInt(String(flags.get("n") ?? "2"), 10) || 2));
const key = requireEnv("OPENAI_API_KEY");
console.log(`Asking for ${n * shapes.length} image${n * shapes.length > 1 ? "s" : ""}, about USD ${(n * shapes.length * COST_PER_IMAGE_USD).toFixed(2)}...`);

await Promise.all(
  shapes.map(async (shape) => {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: prompt(shape), size: SHAPES[shape].size, quality: "high", background: "opaque", output_format: "png", n })
    });
    const body = (await response.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!response.ok || !body.data?.length) {
      console.error(`${shape}: OpenAI answered ${response.status}: ${body.error?.message ?? "no images"}`);
      process.exitCode = 1;
      return;
    }
    body.data.forEach((item, i) => {
      if (!item.b64_json) return;
      const file = join(folder, `${SHAPES[shape].file}-${i + 1}.png`);
      writeFileSync(file, Buffer.from(item.b64_json, "base64"));
      console.log(`  ${file}`);
    });
  })
);
console.log("Pick one of each, rename them to imagen.png and imagen-wide.png, check image_alt in es and en, then run pnpm content:study.");
