import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalClassificationCoverageV1,
  normalizeSignalLabelingFunctionContractV1,
  signalClassificationAssignmentAuthorityV1,
  signalClassificationEvaluationMetricsV1,
  signalClassificationGenerationDigestV1
} from "./signal-classification-authority-v1";

const generation = {
  key: "topics-v1",
  version: 1,
  definition_digest: `sha256:${"1".repeat(64)}`,
  population_digest: `sha256:${"2".repeat(64)}`,
  watermark_digest: `sha256:${"3".repeat(64)}`
};

test("coverage keeps abstentions in the denominator and reconciles exactly", () => {
  const result = buildSignalClassificationCoverageV1({
    available: true,
    generation,
    denominator: 10,
    approved: 4,
    pending: 2,
    rejected: 1,
    abstained: 2,
    error: 1
  });
  assert.equal(result.resolved, 9);
  assert.equal(result.coverage, 0.9);
  assert.equal(result.abstained, 2);
});

test("unknown coverage is null and not fabricated as measured zero", () => {
  const result = buildSignalClassificationCoverageV1({ available: false });
  assert.equal(result.availability, "not_available");
  assert.equal(result.denominator, null);
  assert.equal(result.abstained, null);
  assert.equal(result.coverage, null);
});

test("score 1.0 and high confidence cannot approve without authority", () => {
  assert.equal(signalClassificationAssignmentAuthorityV1({
    method: "model",
    proposed_disposition: "approved",
    human_actor_present: false,
    approved_policy_present: false,
    score: 1,
    confidence: "high"
  }), "pending");
  assert.equal(signalClassificationAssignmentAuthorityV1({
    method: "labeling_function",
    proposed_disposition: "approved",
    human_actor_present: false,
    approved_policy_present: false,
    score: 1,
    confidence: "high"
  }), "pending");
});

test("only an explicit human or approved versioned policy can approve", () => {
  assert.equal(signalClassificationAssignmentAuthorityV1({
    method: "human",
    proposed_disposition: "approved",
    human_actor_present: true,
    approved_policy_present: false
  }), "approved");
  assert.equal(signalClassificationAssignmentAuthorityV1({
    method: "model",
    proposed_disposition: "approved",
    human_actor_present: false,
    approved_policy_present: true,
    approved_model_present: false,
    score: 1,
    confidence: "high"
  }), "pending");
  assert.equal(signalClassificationAssignmentAuthorityV1({
    method: "model",
    proposed_disposition: "approved",
    human_actor_present: false,
    approved_policy_present: true,
    approved_model_present: true
  }), "approved");
  assert.equal(signalClassificationAssignmentAuthorityV1({
    method: "exact",
    proposed_disposition: "approved",
    human_actor_present: false,
    approved_policy_present: true
  }), "approved");
  assert.throws(() => signalClassificationAssignmentAuthorityV1({
    method: "human",
    proposed_disposition: "approved",
    human_actor_present: false,
    approved_policy_present: false
  }), /human_actor_required/);
});

test("labeling function contracts are closed, typed and always support abstention", () => {
  const contract = normalizeSignalLabelingFunctionContractV1({
    contract_version: "signal-labeling-function-v1",
    owner_kind: "workspace",
    function_key: "normalized-platform-match",
    version: 1,
    input_contract: { fields: ["platform", "language"] },
    output_contract: { outcomes: ["vote", "abstain"] },
    definition_hash: `sha256:${"a".repeat(64)}`
  });
  assert.deepEqual(contract.input_contract.fields, ["language", "platform"]);
  assert.deepEqual(contract.output_contract.outcomes, ["abstain", "vote"]);
  assert.throws(() => normalizeSignalLabelingFunctionContractV1({
    ...contract,
    input_contract: { fields: ["platform"], sql: "select true" }
  }), /unknown_field/);
  assert.throws(() => normalizeSignalLabelingFunctionContractV1({
    ...contract,
    output_contract: { outcomes: ["vote"] }
  }), /contract_invalid/);
  assert.throws(() => normalizeSignalLabelingFunctionContractV1({
    ...contract,
    workspace_id: "browser-controlled"
  }), /unknown_field/);
});

test("generation hashes and evaluation metrics are reproducible", () => {
  const input = {
    workspace_key: "workspace-one",
    taxonomy_profile_key: "topics-v1",
    generation_key: "g1",
    generation_version: 1,
    population_digest: generation.population_digest,
    watermark_digest: generation.watermark_digest,
    identity_catalog_digest: generation.definition_digest,
    denominator: 3
  };
  assert.equal(signalClassificationGenerationDigestV1(input), signalClassificationGenerationDigestV1({ ...input }));
  const evaluation = signalClassificationEvaluationMetricsV1({
    denominator: 3,
    approved: 1,
    pending: 0,
    rejected: 0,
    abstained: 1,
    error: 1,
    comparable_gold: { true_positive: 1, false_positive: 1, false_negative: 0 }
  });
  assert.equal(evaluation.precision, 0.5);
  assert.equal(evaluation.recall, 1);
  assert.equal(evaluation.f1, 2 / 3);
});

test("non-reconciling coverage fails closed", () => {
  assert.throws(() => buildSignalClassificationCoverageV1({
    available: true,
    generation,
    denominator: 2,
    approved: 1,
    pending: 0,
    rejected: 0,
    abstained: 0,
    error: 0
  }), /does_not_reconcile/);
});
