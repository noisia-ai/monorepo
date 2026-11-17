import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { studyMarkets, studySchema } from "../../src/content/studies/schema";
import { parseArgs, requireEnv } from "./env";

/**
 * Writes the image of a study: the house style (content-db/STUDY_IMAGES.md) plus the study's own
 * brief (`image.brief` in estudio.json) become one prompt, and OpenAI draws the candidates.
 *
 *   pnpm content:image <web folder> [--n 2] [--dry-run]
 *
 * Writes imagen.prompt.txt and imagen-1.png, imagen-2.png… next to estudio.json. Whoever reviews
 * them renames the chosen one to imagen.png; `pnpm content:study` then loads it as the study's
 * image. Each candidate costs money (about USD 0.20 at high quality), so --n stays at 4 or less.
 * Needs OPENAI_API_KEY in the repo root's .env.local. --dry-run only writes the prompt.
 */

const MODEL = process.env.STUDY_IMAGE_MODEL || "gpt-image-2.6-sunburst";
const SIZE = "1024x1536";
const MAX_N = 4;

const { flags, positional } = parseArgs(process.argv.slice(2));
const folder = positional[0] ? resolve(positional[0]) : "";
if (!folder || !existsSync(join(folder, "estudio.json"))) {
  console.error("Usage: pnpm content:image <folder with estudio.json> [--n 2] [--dry-run]");
  process.exit(1);
}

const parsed = studySchema.safeParse(JSON.parse(readFileSync(join(folder, "estudio.json"), "utf8")));
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`estudio.json ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const study = parsed.data;
if (!study.image?.brief) {
  console.error('estudio.json has no image.brief. Write who is in the picture and what they are doing (content-db/STUDY_IMAGES.md).');
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

/** The house style. Mirrors content-db/STUDY_IMAGES.md; change both together. */
const STYLE = [
  "Editorial documentary photograph for the page of a consumer research study.",
  "A real, ordinary person photographed naturally, as if caught in the moment: honest expression, real skin texture, minimal retouching, no posing for the camera, no stock-photo smile.",
  "Waist-up or three-quarter framing, the person centered, looking slightly away from the camera, mid-gesture.",
  "Soft natural daylight from one side. Neutral, muted wardrobe; at most one small accent in cyan or coral.",
  "Isolated on a seamless pure white background (#FFFFFF) with no floor, no horizon and no environment; only the few props the person holds. Generous white space on every side so the figure can melt into a white web page. No cast shadow.",
  "Never: text, letters, numbers, logos, brand names, readable phone or laptop screens (a screen shows only a soft blur of color), watermarks, celebrities or recognizable public figures, children.",
  "Vertical 2:3 composition."
].join(" ");

const people = studyMarkets(study).map((m) => MARKET_PEOPLE[m]).join(", ");
const prompt = [
  STYLE,
  `The study: "${study.en.title}". ${study.en.dek}`,
  `The person looks like an everyday resident of ${people}.`,
  `Scene: ${study.image.brief}`
].join("\n\n");

writeFileSync(join(folder, "imagen.prompt.txt"), `${prompt}\n`);
console.log(`Prompt written to ${join(folder, "imagen.prompt.txt")} (${MODEL}, ${SIZE}).`);
if (flags.has("dry-run")) process.exit(0);

const n = Math.min(MAX_N, Math.max(1, Number.parseInt(String(flags.get("n") ?? "2"), 10) || 2));
const key = requireEnv("OPENAI_API_KEY");
console.log(`Asking for ${n} candidate${n > 1 ? "s" : ""}...`);
const response = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality: "high", background: "opaque", output_format: "png", n })
});
const body = (await response.json().catch(() => ({}))) as {
  data?: { b64_json?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};
if (!response.ok || !body.data?.length) {
  console.error(`OpenAI answered ${response.status}: ${body.error?.message ?? "no images"}`);
  process.exit(1);
}
body.data.forEach((image, i) => {
  if (!image.b64_json) return;
  const file = join(folder, `imagen-${i + 1}.png`);
  writeFileSync(file, Buffer.from(image.b64_json, "base64"));
  console.log(`  ${file}`);
});
if (body.usage) console.log(`Tokens: ${body.usage.input_tokens ?? "?"} in, ${body.usage.output_tokens ?? "?"} out.`);
console.log("Pick one, rename it to imagen.png, add image_alt in es and en, then run pnpm content:study.");
