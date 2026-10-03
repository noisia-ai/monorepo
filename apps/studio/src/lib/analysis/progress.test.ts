import assert from "node:assert/strict";
import test from "node:test";

import { computeAnalysisProgress } from "./progress";

const steps = [
  "preflight",
  "step1_open_pass",
  "step2_coding",
  "step3_hierarchy",
  "step4_mobility",
  "step5_comparative",
  "step6_synthesis",
  "quality_gates",
  "review"
];

test("failed analyses preserve their last real pipeline progress", () => {
  const progress = computeAnalysisProgress(
    {
      analysis: { status: "failed" },
      steps: steps.slice(0, 5).map((step) => ({ step, status: "completed" }))
    },
    steps
  );

  assert.equal(progress, 67);
});

test("review-ready analyses are the only terminal runs reported as complete", () => {
  assert.equal(
    computeAnalysisProgress(
      {
        analysis: { status: "needs_review" },
        steps: steps.slice(0, 8).map((step) => ({ step, status: "completed" }))
      },
      steps
    ),
    100
  );
});
