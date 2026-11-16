import assert from "node:assert/strict";
import { test } from "node:test";
import { studyMarkets, studySchema } from "./schema";

const summary = {
  title: "Título",
  dek: "De qué trata.",
  findings: ["Uno.", "Dos."],
  stats: [{ value: "38%", label: "de las menciones", base: "Base: 1,000 menciones" }],
  method_note: "Cómo se hizo."
};

const study = {
  id: "triggers-barriers-telecom-mexico-2026",
  industry: "telecom",
  market: "MX",
  method: "Triggers & Barriers",
  period: { label: "ene–oct 2026", start: "2026-01-01", end: "2026-10-31" },
  base: { mentions: 1000, channels: ["TikTok"], cut_date: "2026-11-14" },
  access: "registro",
  full_language: "es",
  es: summary,
  en: summary
};

test("a complete study passes", () => {
  assert.equal(studySchema.safeParse(study).success, true);
});

test("the delivery template, with empty fields, does not pass", () => {
  const template = { ...study, base: { ...study.base, mentions: 0 }, es: { ...summary, title: "" } };
  const result = studySchema.safeParse(template);
  assert.equal(result.success, false);
  const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  assert.ok(paths.includes("base.mentions"));
  assert.ok(paths.includes("es.title"));
});

test("an unknown market or access mode does not pass", () => {
  assert.equal(studySchema.safeParse({ ...study, market: "IT" }).success, false);
  assert.equal(studySchema.safeParse({ ...study, market: ["UK", "IT"] }).success, false);
  assert.equal(studySchema.safeParse({ ...study, market: [] }).success, false);
  assert.equal(studySchema.safeParse({ ...study, access: "privado" }).success, false);
});

test("a study can read several markets; the first is the main one", () => {
  const parsed = studySchema.parse({ ...study, market: ["UK", "DE", "ES", "FR", "UK"] });
  assert.deepEqual(studyMarkets(parsed), ["UK", "DE", "ES", "FR"]);
  assert.deepEqual(studyMarkets(studySchema.parse({ ...study, market: "MX" })), ["MX"]);
});
