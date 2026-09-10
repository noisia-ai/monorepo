import assert from "node:assert/strict";
import test from "node:test";

import { signalTopicCandidateRefinementLabChildTestOnly } from
  "./run-signal-topic-candidate-refinement-lab-child-v1";

test("child emits only an allowlisted domain error code", () => {
  const { safeChildErrorCode } = signalTopicCandidateRefinementLabChildTestOnly;
  assert.equal(safeChildErrorCode({ code: "topic_refinement_local_credential_missing" }),
    "topic_refinement_local_credential_missing");
  assert.equal(safeChildErrorCode(new Error("raw provider request detail must not surface")),
    "topic_refinement_local_child_failed");
});
