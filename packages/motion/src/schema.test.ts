import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deckSchema, socialSchema, storySchema, studySchema, timingSchema } from "./schema";

const ex = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", name), "utf8"));
const STORIES = join(import.meta.dirname, "..", "..", "..", "apps", "website-next", "src", "content", "stories", "public");

test("every example piece validates", () => {
  for (const file of readdirSync(join(import.meta.dirname, "..", "examples"))) {
    if (!file.endsWith(".json") || file.endsWith(".timing.json")) continue;
    const piece = ex(file);
    const schema = { social: socialSchema, study: studySchema, deck: deckSchema }[piece.format as string];
    assert.ok(schema, `${file}: unknown format`);
    schema.parse(piece);
  }
});

test("every website story renders as a clip", () => {
  for (const file of readdirSync(STORIES)) {
    const data = JSON.parse(readFileSync(join(STORIES, file), "utf8"));
    for (const story of Array.isArray(data) ? data : [data]) storySchema.parse(story);
  }
});

test("example quotes are literal excerpts of published evidence (VIDEO.md §2)", () => {
  const evidence = readdirSync(STORIES)
    .flatMap((f) => [JSON.parse(readFileSync(join(STORIES, f), "utf8"))].flat())
    .flatMap((s: { es: { evidence: { quote: string }[]; scenes: { type: string; text?: string }[] } }) => [
      ...s.es.evidence.map((e) => e.quote),
      ...s.es.scenes.filter((sc) => sc.type === "quote").map((sc) => sc.text ?? "")
    ]);
  const quotes: string[] = [];
  for (const file of ["social.json", "social-muted.json", "study.json"]) {
    const piece = ex(file);
    for (const sc of piece.scenes) {
      if (sc.type === "quote") quotes.push(sc.text);
      if (sc.quote) quotes.push(sc.quote.text);
      for (const c of sc.chat ?? []) quotes.push(c.text);
    }
  }
  for (const q of quotes) assert.ok(evidence.some((e) => e.includes(q)), `not a literal excerpt: ${q}`);
});

test("the study timing matches its piece", () => {
  const piece = studySchema.parse(ex("study.json"));
  const timing = timingSchema.parse(ex("study.timing.json"));
  assert.equal(timing.scenes.length, piece.scenes.length);
  assert.equal(timing.total, timing.scenes.reduce((s, t) => s + t.len, 0));
  timing.scenes.forEach((t, i) => assert.equal(t.id, piece.scenes[i].id));
});

test("a figure without its base note is rejected (VIDEO.md §2)", () => {
  const social = ex("social.json");
  delete social.scenes[1].note;
  assert.throws(() => socialSchema.parse(social), /without its note/);
  // A study that does not open with the base (no cold open) still needs a note on every chart.
  const study = ex("study.json");
  study.scenes = study.scenes.filter((s: { type: string }) => s.type !== "cold");
  delete study.scenes[0].note;
  assert.throws(() => studySchema.parse(study), /without its note/);
});

test("after a cold open (which states the base) a chapter may drop its note", () => {
  const study = ex("study.json");
  delete study.scenes[1].note;
  assert.doesNotThrow(() => studySchema.parse(study));
});

test("a note under 5,000 mentions is rejected: the figure goes in % instead", () => {
  const study = ex("study.json");
  study.scenes[1].note.mentions = 219;
  assert.throws(() => studySchema.parse(study), /thin study/);
});

test("a piece without its base scene is rejected", () => {
  for (const file of ["social.json", "study.json"]) {
    const piece = ex(file);
    piece.scenes = piece.scenes.filter((s: { type: string }) => s.type !== "base");
    const schema = file.startsWith("social") ? socialSchema : studySchema;
    assert.throws(() => schema.parse(piece), /base scene/);
  }
});

test("a quote that was not verified is rejected", () => {
  const piece = ex("study.json");
  piece.scenes[1].quote.verified = false;
  assert.throws(() => studySchema.parse(piece));
});

test("the narration says analizamos, never escuchamos, and has no reveal colon", () => {
  const study = ex("study.json");
  study.scenes[1].vo = "Escuchamos a la gente hablar de su casa.";
  assert.throws(() => studySchema.parse(study), /never ..escuchamos/);
  const colon = ex("study.json");
  colon.scenes[1].vo = "La base: un millón de menciones.";
  assert.throws(() => studySchema.parse(colon), /reveal colon/);
  // A quote is a real post, literal: the rule does not touch it.
  const social = ex("social.json");
  const quote = social.scenes.find((s: { type: string }) => s.type === "quote");
  if (quote) {
    quote.text = "yo escucho a todos";
    assert.doesNotThrow(() => socialSchema.parse(social));
  }
});

test("an official figure carries its source instead of mentions", () => {
  const study = ex("study.json");
  study.scenes[1].note = { period: "2021", source: "cómputo oficial 2021" };
  assert.doesNotThrow(() => studySchema.parse(study));
  study.scenes[1].note = { period: "2021" };
  assert.throws(() => studySchema.parse(study), /source of an official figure/);
});
