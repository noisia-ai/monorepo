import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { storySchema, type Story } from "../../src/content/stories/schema";
import { lintDeckHtml, lintStory } from "./lint";

const dir = join(process.cwd(), "src/content/stories/public");
const published = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    return (Array.isArray(raw) ? raw : [raw]).map((item) => storySchema.parse(item));
  });

test("the pieces already published pass the privacy checks", () => {
  assert.deepEqual(published.flatMap(lintStory), []);
});

function withQuote(text: string): Story {
  const base = structuredClone(published[0]);
  base.es.evidence = [{ quote: text, platform: "TikTok", date: "2026-03" }];
  return base;
}

test("a quote with a link, a handle or a provider name is rejected", () => {
  assert.equal(lintStory(withQuote("mira https://www.tiktok.com/@ana/video/1")).length >= 1, true);
  assert.match(lintStory(withQuote("como dijo @ana_lopez ayer"))[0], /@user/);
  assert.match(lintStory(withQuote("datos de SentiOne"))[0], /provider/);
});

test("an email address is not taken for a handle", () => {
  assert.deepEqual(lintStory(withQuote("escríbeme a ana@example.com")), []);
});

test("a deck that links to a post or shows a handle is rejected", () => {
  const html = `<html><head><style>@media print { a { color: red } }</style></head><body>
    <deck-stage><section><p>Una cita <a href="https://twitter.com/ana_lopez/status/123">ver</a></p></section>
    <section><p>como dijo @ana_lopez</p></section></deck-stage><script src="deck-stage.js"></script></body></html>`;
  const { issues } = lintDeckHtml(html);
  assert.equal(issues.some((issue) => /social post/.test(issue)), true);
  assert.equal(issues.some((issue) => /@user/.test(issue)), true);
});

test("a clean deck passes, and @media rules in its styles are not handles", () => {
  const html = `<html><head><style>@media (max-width: 600px) { .x { @apply y } }</style>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>
    <body><deck-stage><section><p>Escríbenos a hola@noisia.ai</p></section></deck-stage></body></html>`;
  const { issues, external } = lintDeckHtml(html);
  assert.deepEqual(issues, []);
  assert.deepEqual(external, ["fonts.googleapis.com"]);
});

test("a deck that names the data provider is rejected", () => {
  assert.match(lintDeckHtml("<section>Datos de Talkwalker</section>").issues[0], /provider/);
});
