import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceTopicEditorialBatchStatusV2 } from "./signal-topic-editorial-batch-control-v2";

const grammarRecovery = {
  materialized: false,
  preparation_failed: false,
  technical_errors: 0,
  ambiguous_micro_usd: "0",
  pending: 1,
  recovering: 1,
  batch_states: { applied: 1 },
  contract_version: "signal-topic-editorial-screening-plan-v2",
};

test("recovering grammar-rate-limit items remain pending/running, never terminal or publishable Noise", () => {
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2(grammarRecovery), "running");
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2({ ...grammarRecovery, materialized: true }), "running");
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2({ ...grammarRecovery, pending: 0 }), "running");
});

test("completed requires materialization and no pending/recovering/technical/ambiguous work", () => {
  const accepted = { ...grammarRecovery, materialized: true, pending: 0, recovering: 0 };
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2(accepted), "completed");
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2({ ...accepted, technical_errors: 1 }), "failed");
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2({ ...accepted, ambiguous_micro_usd: "1" }), "failed");
});

test("a technical error is visible while other batches continue; failure is terminal only after work settles", () => {
  const active={...grammarRecovery,technical_errors:1,batch_states:{applied:2,in_progress:1}};
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2(active),"running");
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2({...active,pending:0,recovering:0}),"failed");
  assert.equal(resolveWorkspaceTopicEditorialBatchStatusV2({...active,preparation_failed:true}),"failed");
});

test("grammar retry status does not expose a manual retry or complete-catalog gate", () => {
  const status = resolveWorkspaceTopicEditorialBatchStatusV2(grammarRecovery);
  assert.equal(status === "review_ready" || status === "completed", false);
});
