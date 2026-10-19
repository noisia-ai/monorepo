import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAssessmentNoiseEligibility } from "./assessment-noise";

const baseInput = {
  expectedRevision: 1,
  currentRevision: 1,
  latestAssessedRevision: 1,
  lockedByAnalysisId: null,
  assessment: {
    id: "11111111-1111-4111-8111-111111111111",
    corpusRevision: 1,
    status: "completed",
    sampleStrategy: "full_population",
    populationSize: 3_331,
    sampleSize: 3_331
  },
  includedCount: 3_331,
  classifiedIncludedCount: 3_331,
  noiseIncludedCount: 2_125
};

test("allows exact exclusion when the current full population was classified", () => {
  const result = evaluateAssessmentNoiseEligibility(baseInput);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.impact, {
    assessmentId: baseInput.assessment.id,
    corpusRevision: 1,
    includedCount: 3_331,
    excludedCount: 2_125,
    retainedCount: 1_206,
    noisePercentage: 63.8
  });
});

test("rejects a sampled assessment", () => {
  const result = evaluateAssessmentNoiseEligibility({
    ...baseInput,
    assessment: {
      ...baseInput.assessment,
      sampleStrategy: "deterministic_platform_stratified",
      sampleSize: 2_000
    },
    classifiedIncludedCount: 2_000,
    noiseIncludedCount: 1_200
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "assessment_sampled");
});

test("rejects a stale corpus revision", () => {
  const result = evaluateAssessmentNoiseEligibility({
    ...baseInput,
    currentRevision: 2
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "stale_revision");
});

test("rejects an incomplete classification set", () => {
  const result = evaluateAssessmentNoiseEligibility({
    ...baseInput,
    classifiedIncludedCount: 3_300
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "classification_incomplete");
});
