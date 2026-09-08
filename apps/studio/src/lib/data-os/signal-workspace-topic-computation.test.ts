import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkspaceTopicComputationRequestV1 } from "./signal-workspace-topic-computation";

test("workspace search accepts only the chosen embedding receipt, never client authority or publication", () => {
  const body = { embedding_run_id: "00000000-0000-4000-8000-000000000001" };
  assert.equal(validateWorkspaceTopicComputationRequestV1(body), true);
  for (const extra of ["workspace_id", "actor_user_id", "publish_when_ready", "algorithm_profile", "input_snapshot", "hard_cap_micro_usd"]) {
    assert.equal(validateWorkspaceTopicComputationRequestV1({ ...body, [extra]: "injected" }), false);
  }
  for (const malformed of [null, [], {}, { embedding_run_id: "invalid" }, { embedding_run_id: 12 }]) {
    assert.equal(validateWorkspaceTopicComputationRequestV1(malformed), false);
  }
});
