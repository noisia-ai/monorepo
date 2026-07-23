import assert from "node:assert/strict";
import test from "node:test";

import { planAnalysisArtifactReview } from "./analysis-artifact-review";

test("correct and limit always fork an immutable artifact revision", () => {
  assert.deepEqual(planAnalysisArtifactReview({ action: "correct", published: false }), {
    nextStatus: "corrected",
    createRevision: true
  });
  assert.deepEqual(planAnalysisArtifactReview({ action: "limit", published: false }), {
    nextStatus: "limited",
    createRevision: true
  });
});

test("published artifacts are never reviewed in place", () => {
  assert.deepEqual(planAnalysisArtifactReview({ action: "reject", published: true }), {
    nextStatus: "rejected",
    createRevision: true
  });
  assert.deepEqual(planAnalysisArtifactReview({ action: "accept", published: false }), {
    nextStatus: "accepted",
    createRevision: false
  });
});
