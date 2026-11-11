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

test("a quote that was not verified is rejected", () => {
  const piece = ex("study.json");
  piece.scenes[1].quote.verified = false;
  assert.throws(() => studySchema.parse(piece));
});
