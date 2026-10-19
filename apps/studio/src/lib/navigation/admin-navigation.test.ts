import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  brandIdFromStudioPath,
  buildAdminNavigation,
  buildBrandContextNavigation,
  buildCorpusContextNavigation,
  corpusIdFromStudioPath
} from "./admin-navigation";

test("admin manifest exposes team only to Noisia admins", () => {
  assert.equal(buildAdminNavigation("noisia_admin").some((item) => item.key === "team"), true);
  assert.equal(buildAdminNavigation("analyst").some((item) => item.key === "team"), false);
  assert.deepEqual(buildAdminNavigation("unknown"), []);
});

test("brand context navigation keeps the self-service journey primary", () => {
  const hrefs = buildBrandContextNavigation("brand-1").map((item) => item.href);
  assert.deepEqual(hrefs, [
    "/studio/brands/brand-1",
    "/studio/brands/brand-1/brand-os",
    "/studio/brands/brand-1/topics",
    "/studio/brands/brand-1/data",
    "/studio/brands/brand-1/data/mentions",
    "/studio/brands/brand-1/reports",
    "/studio/brands/brand-1/settings"
  ]);
  assert.equal(hrefs.includes("/studio/brands/brand-1/data/review"), false);
  assert.equal(hrefs.includes("/studio/brands/brand-1/data/discovery-review"), false);
  assert.equal(brandIdFromStudioPath("/studio/brands/brand-1/reports"), "brand-1");
  assert.equal(brandIdFromStudioPath("/studio/brands/brand-1/data/review"), "brand-1");
  assert.equal(brandIdFromStudioPath("/studio/brands/brand-1/data/discovery-review"), "brand-1");
  assert.equal(brandIdFromStudioPath("/studio/brands/new"), null);
});

test("legacy review pages remain available only as deep routes", async () => {
  const pages = await Promise.all([
    "../../app/studio/brands/[id]/data/review/page.tsx",
    "../../app/studio/brands/[id]/data/discovery-review/page.tsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of pages) assert.match(source, /export default async function/u);
});

test("corpus context navigation uses the shared shell and semantic deep links", () => {
  assert.deepEqual(buildCorpusContextNavigation("corpus-1").map((item) => item.href), [
    "/studio/corpora/corpus-1/engine",
    "/studio/corpora/corpus-1/mentions",
    "/studio/corpora/corpus-1/analysis"
  ]);
  assert.equal(corpusIdFromStudioPath("/studio/corpora/corpus-1/mentions"), "corpus-1");
  assert.equal(corpusIdFromStudioPath("/studio/corpora/new"), null);
});
