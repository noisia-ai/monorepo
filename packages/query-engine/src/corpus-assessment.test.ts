import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDeterministicCorpusAssessment,
  CORPUS_ASSESSMENT_BATCH_SIZE,
  CORPUS_ASSESSMENT_FULL_POPULATION_LIMIT,
  CORPUS_ASSESSMENT_STRATIFIED_SAMPLE_SIZE
} from "./corpus-assessment";

test("corpus assessment production limits protect population-level evidence", () => {
  assert.equal(CORPUS_ASSESSMENT_FULL_POPULATION_LIMIT, 5_000);
  assert.equal(CORPUS_ASSESSMENT_STRATIFIED_SAMPLE_SIZE, 2_000);
  assert.equal(CORPUS_ASSESSMENT_BATCH_SIZE, 75);
});

test("corpus readiness is computed from mention classifications instead of LLM scores", () => {
  const classifications = Array.from({ length: 1_000 }, (_, index) => ({
    mention_id: `m-${index}`,
    relevance: index < 700 ? "relevant" as const : index < 800 ? "partial" as const : "noise" as const,
    signal_types: index < 300
      ? ["trigger"]
      : index < 600
        ? ["barrier"]
        : index < 750
          ? ["experience"]
          : [],
    reason: "fixture"
  }));

  const result = computeDeterministicCorpusAssessment({ populationSize: 1_000, classifications });

  assert.equal(result.ready_for_study, true);
  assert.equal(result.verdict, "ready");
  assert.equal(result.coverage.noise_pct, 20);
  assert.equal(result.metrics.weighted_signal_density_pct, 75);
  assert.equal(result.metrics.full_population_classified, true);
});

test("corpus readiness blocks a large but noisy corpus", () => {
  const classifications = Array.from({ length: 2_000 }, (_, index) => ({
    mention_id: `m-${index}`,
    relevance: index < 400 ? "relevant" as const : "noise" as const,
    signal_types: index < 200 ? ["trigger"] : index < 400 ? ["barrier"] : [],
    reason: "fixture"
  }));

  const result = computeDeterministicCorpusAssessment({ populationSize: 10_000, classifications });

  assert.equal(result.ready_for_study, false);
  assert.equal(result.verdict, "corpus_too_noisy");
  assert.equal(result.coverage.noise_pct, 80);
  assert.equal(result.metrics.full_population_classified, false);
});
