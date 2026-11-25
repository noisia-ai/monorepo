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
    frame: "Vertical 2:3 frame. Use the camera distance and the placement written in the moment; do not default to one person standing off-center. Keep heads, faces and hands well inside the frame."
  },
  wide: {
    size: "1536x1024",
    prompt: "imagen-wide.prompt.txt",
    file: "imagen-wide",
    frame: "Horizontal 3:2 frame. Use the camera distance and the placement written in the moment. Keep the people and the action inside the central band of the frame: it will be cropped to 16:9 and to 1.85:1."
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
 * The house style: real people caught in the study's moment, in soft haze with an anaglyph edge, in
 * the real place washed to white. Only the finish is fixed here; who, how many, where the camera
 * stands, the emotion and the light come from each study's `image.brief` and `image.place`, so the
 * studies do not look alike. Mirrors content-db/STUDY_IMAGES.md ("How the prompt is built"); change
 * both together. The order matters: the model weighs the start of the prompt most.
 */
const STYLE = {
  photograph:
    "A real documentary photograph, taken on location by a photojournalist on 35mm film, for the page of a consumer research study. Candid: the people are caught in the middle of the moment, not posing and not looking at the camera. It must read as an honest photograph of real people in a real place: never a cutout on a blank background, never a digital illustration, never a stock photo.",
  person:
    "The people are ordinary people, not models and not attractive stock faces: plain, everyday faces with lines, pores, stubble, glasses or freckles, uneven hair, everyday clothes, and the age, build and hair written in the moment. They are the only things in the frame with full tone and a little muted, natural color. Their faces and bodies carry the emotion named in the moment below, which comes from the study and is not always worry. When a face is visible it is natural and asymmetrical, mid-expression, never retouched. A soft luminous haze wraps the people and fades the lower edges of the frame into light. Anaglyph chromatic split on the edges of the people only: a coral-red fringe (#D91441) on one side and a cyan fringe (#009CA8) on the other, like a slightly misregistered print.",
  place:
    "Around them, the real place where the moment happens, sharp enough to be recognized but pushed far back. The whole place is black and white, including the ground, the sky, plants and other bystanders far back; only the main people keep color. The place is very high-key and low contrast, washed toward white so it almost melts into the paper, as if the exposure were set for the people. The time of day still reads in the direction and quality of the light (hard midday sun, low golden sun, blue dusk, a single lamp), but even a night scene stays pale. Real architecture, furniture and objects with natural perspective. The edges of the frame fade to white.",
  finish: "Fine photochemical grain over the whole frame. Editorial and specific: the distance, placement, number of people and energy of the photograph come from the moment below, not from a template.",
  never:
    "Never: text, letters, numbers, logos, brand names, readable documents, labels or screens (a screen shows only a soft blur), watermarks, celebrities or public figures, children. No one looks into the camera. No stock-photo gestures: no hand on the forehead, no head in the hands, no one staring at a letter in despair, unless the moment asks for it. No plastic skin, no perfectly symmetrical faces. No person isolated on a white or transparent background."
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
    `The people look like everyday residents of ${people}.`,
    `The moment: ${image!.brief}`,
    `The place, washed almost to white around them: ${image!.place}`
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
