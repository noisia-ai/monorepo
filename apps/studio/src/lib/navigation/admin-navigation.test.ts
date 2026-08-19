import assert from "node:assert/strict";
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

test("brand context navigation uses semantic deep links", () => {
  assert.deepEqual(buildBrandContextNavigation("brand-1").map((item) => item.href), [
    "/studio/brands/brand-1",
    "/studio/brands/brand-1/data",
    "/studio/brands/brand-1/data/mentions",
    "/studio/brands/brand-1/data/review",
    "/studio/brands/brand-1/brand-os",
    "/studio/brands/brand-1/reports",
    "/studio/brands/brand-1/settings"
  ]);
  assert.equal(brandIdFromStudioPath("/studio/brands/brand-1/reports"), "brand-1");
  assert.equal(brandIdFromStudioPath("/studio/brands/new"), null);
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
