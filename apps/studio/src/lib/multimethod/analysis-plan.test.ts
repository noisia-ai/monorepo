import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStudyAnalysisPlan,
  composerModulesForLenses,
  defaultStudyLensSlugs,
  normalizeStudyAnalysisPlan,
  STUDY_LENS_OPTIONS
} from "./analysis-plan";

test("defaultStudyLensSlugs keeps only the production methodology selected", () => {
  assert.deepEqual(defaultStudyLensSlugs(), ["triggers-barriers"]);
});

test("buildStudyAnalysisPlan forces the primary lens and drops unknown slugs", () => {
  const plan = buildStudyAnalysisPlan(["value-perception-matrix", "unknown-lens"], "triggers-barriers");

  assert.deepEqual(plan.selected_lenses, ["triggers-barriers", "value-perception-matrix"]);
  assert.equal(plan.primary_methodology_slug, "triggers-barriers");
  assert.equal(plan.lens_configs["triggers-barriers"]?.runtime, "tb_pipeline");
  assert.equal(plan.lens_configs["value-perception-matrix"]?.runtime, "engine_lens");
  assert.equal((plan.lens_configs["value-perception-matrix"]?.query_pack as Record<string, unknown>).requires_competitors, true);
  assert.deepEqual(plan.lens_configs["value-perception-matrix"]?.signal_module_keys, ["live_composer", "value_perception", "opportunities"]);
});

test("normalizeStudyAnalysisPlan falls back to the safe default", () => {
  const plan = normalizeStudyAnalysisPlan({ selected_lenses: ["unknown-lens"] }, "missing-primary");

  assert.deepEqual(plan.selected_lenses, ["triggers-barriers"]);
  assert.equal(plan.primary_methodology_slug, "triggers-barriers");
});

test("buildStudyAnalysisPlan preserves every selected study lens", () => {
  const everyLens = STUDY_LENS_OPTIONS.map((option) => option.slug);
  const plan = buildStudyAnalysisPlan(everyLens, "triggers-barriers");

  assert.deepEqual(plan.selected_lenses, everyLens);
  assert.equal(plan.selected_lenses.length, STUDY_LENS_OPTIONS.length);
});

test("Signal Pulse uses its own report kind and does not force T&B lenses", () => {
  const plan = buildStudyAnalysisPlan(["triggers-barriers", "narrative-ownership"], "signal-pulse");

  assert.equal(plan.report_kind, "signal_pulse");
  assert.deepEqual(plan.selected_lenses, ["signal-pulse"]);
  assert.equal(plan.lens_configs["signal-pulse"]?.runtime, "signal_pulse_pipeline");
  assert.deepEqual(plan.composer_modules.slice(0, 3), ["overview", "signals", "marketing_moves"]);
});

test("normalizeStudyAnalysisPlan preserves Signal Pulse budget and marketing brief", () => {
  const plan = normalizeStudyAnalysisPlan({
    primary_methodology_slug: "signal-pulse",
    selected_lenses: ["signal-pulse"],
    marketing_brief: { objective: "Defender presupuesto de pauta" },
    budget_cap_usd: 5
  });

  assert.equal(plan.report_kind, "signal_pulse");
  assert.deepEqual(plan.marketing_brief, { objective: "Defender presupuesto de pauta" });
  assert.equal(plan.budget_cap_usd, 5);
});

test("composerModulesForLenses dedupes module slugs", () => {
  assert.deepEqual(
    composerModulesForLenses(["triggers-barriers", "narrative-ownership"]).slice(0, 3),
    ["overview", "tb_decision_field", "opportunities"]
  );
});
