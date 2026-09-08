import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1 as contract,
  SIGNAL_WORKSPACE_CLASSIFICATION_OUTCOME_MAX_BYTES_V1,
  canReuseSignalWorkspaceClassificationOutcomeV1,
  parseSignalWorkspaceClassificationOutcomeV1,
  signalWorkspaceClassificationDecisionSchemaV1,
  signalWorkspaceClassificationIdentitySchemaV1,
  signalWorkspaceClassificationOutcomeSchemaV1,
  signalWorkspaceClassificationResolutionV1,
  signalWorkspaceClassificationReuseKeyV1,
  type SignalWorkspaceClassificationDecisionV1,
  type SignalWorkspaceClassificationIdentityV1,
  type SignalWorkspaceClassificationOutcomeV1
} from "./signal-workspace-classification-v1";
const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const identity: SignalWorkspaceClassificationIdentityV1 = {
  contract_version: contract, workspace_id: randomUUID(), engine_key: "fixture-engine", engine_version: 1,
  engine_artifact_digest: sha("a"), embedding_config_digest: sha("b"), catalog_digest: sha("c"),
  compiler_digest: sha("d"), context_digest: sha("e"), decision_policy_digest: sha("f")
};
const root = { root_id: randomUUID(), fingerprint: sha("1"), correction_digest: sha("2") };
function decision(): SignalWorkspaceClassificationDecisionV1 {
  return { taxonomy_term_id: randomUUID(), term_key: "fixture_topic", definition_revision: 1,
    definition_digest: sha("3"), disposition: "pending", resolution_method: "model",
    model_version_id: randomUUID(), labeling_function_version_id: null, approval_policy_id: null,
    decided_by_user_id: null, correction_operation_id: null, score: 0.98,
    evidence_digest: sha("4"), lineage_digest: sha("5") };
}
function outcome(): SignalWorkspaceClassificationOutcomeV1 {
  return { contract_version: contract, root, reuse_key: signalWorkspaceClassificationReuseKeyV1(identity, root),
    resolution_state: "pending", has_unresolved_topics: true, reason_code: "interpretation_required",
    technical_error_code: null, evidence_digest: sha("6"), decisions: [],
    coverage: { expected_chunks: 2, processed_chunks: 2, chunk_coverage_digest: sha("7") } };
}
test("sparse unresolved roots do not create one pending assignment per Topic", () => {
  const parsed = parseSignalWorkspaceClassificationOutcomeV1({ identity, root, outcome: outcome() });
  assert.equal(parsed.resolution_state, "pending");
  assert.deepEqual(parsed.decisions, []);
  assert.equal(signalWorkspaceClassificationResolutionV1([], false), "abstained");
  assert.equal(signalWorkspaceClassificationResolutionV1([], true), "pending");
  assert.throws(() => parseSignalWorkspaceClassificationOutcomeV1({ identity, root,
    outcome: { ...outcome(), result_kind: "retrieval_shortlist", candidate_limit: 32 } }));
});
test("a confirmed Topic remains present beside an unresolved Topic", () => {
  const human: SignalWorkspaceClassificationDecisionV1 = { ...decision(), disposition: "approved",
    resolution_method: "human", model_version_id: null, decided_by_user_id: randomUUID(), correction_operation_id: randomUUID() };
  const model = { ...decision(), term_key: "other_topic" };
  const value = { ...outcome(), decisions: [human, model] };
  assert.equal(parseSignalWorkspaceClassificationOutcomeV1({ identity, root, outcome: value }).resolution_state, "pending");
  assert.equal(signalWorkspaceClassificationResolutionV1([human], false), "approved");
  assert.equal(signalWorkspaceClassificationResolutionV1([{ disposition: "rejected" }], false), "rejected");
  assert.throws(() => signalWorkspaceClassificationOutcomeSchemaV1.parse({ ...value, resolution_state: "approved" }));
});
test("a high score supplies neither model approval nor human authority", () => {
  assert.equal(signalWorkspaceClassificationDecisionSchemaV1.parse(decision()).disposition, "pending");
  assert.throws(() => signalWorkspaceClassificationDecisionSchemaV1.parse({ ...decision(), disposition: "approved" }));
  assert.throws(() => signalWorkspaceClassificationDecisionSchemaV1.parse({ ...decision(), approval_policy_id: randomUUID() }));
  assert.throws(() => signalWorkspaceClassificationDecisionSchemaV1.parse({ ...decision(), resolution_method: "human", model_version_id: null }));
  assert.throws(() => signalWorkspaceClassificationDecisionSchemaV1.parse({ ...decision(), decided_by_user_id: randomUUID() }));
});
test("exact reuse excludes transient generation IDs and separates every semantic input", () => {
  const reuseKey = signalWorkspaceClassificationReuseKeyV1(identity, root);
  const prior = { reuse_key: reuseKey, resolution_state: "pending", source_generation_complete: true };
  assert.equal(canReuseSignalWorkspaceClassificationOutcomeV1({ identity, root, prior }), true);
  for (const field of ["engine_artifact_digest", "embedding_config_digest", "catalog_digest", "compiler_digest", "context_digest", "decision_policy_digest"] as const) {
    assert.notEqual(signalWorkspaceClassificationReuseKeyV1({ ...identity, [field]: sha("9") }, root), reuseKey, field);
  }
  assert.notEqual(signalWorkspaceClassificationReuseKeyV1({ ...identity, workspace_id: randomUUID() }, root), reuseKey);
  assert.notEqual(signalWorkspaceClassificationReuseKeyV1(identity, { ...root, fingerprint: sha("9") }), reuseKey);
  assert.notEqual(signalWorkspaceClassificationReuseKeyV1(identity, { ...root, correction_digest: sha("9") }), reuseKey);
  assert.notEqual(signalWorkspaceClassificationReuseKeyV1(identity, { ...root, root_id: randomUUID() }), reuseKey);
  for (const field of ["preparation_run_id", "embedding_run_id", "input_revision", "generation_id"]) {
    assert.throws(() => signalWorkspaceClassificationIdentitySchemaV1.parse({ ...identity, [field]: randomUUID() }));
  }
  for (const resolution_state of ["error", "invented_state"]) {
    assert.equal(canReuseSignalWorkspaceClassificationOutcomeV1({ identity, root, prior: { ...prior, resolution_state } }), false);
  }
  assert.equal(canReuseSignalWorkspaceClassificationOutcomeV1({ identity, root, prior: { ...prior, source_generation_complete: false } }), false);
});
test("changed content and cross-root outcomes cannot inherit a correction", () => {
  assert.throws(() => parseSignalWorkspaceClassificationOutcomeV1({ identity,
    root: { ...root, fingerprint: sha("9") }, outcome: outcome() }), /root_identity_mismatch/);
  assert.throws(() => parseSignalWorkspaceClassificationOutcomeV1({ identity, root,
    outcome: { ...outcome(), root: { ...root, root_id: randomUUID() } } }), /root_identity_mismatch/);
});
test("all chunks must be reconciled and technical errors stay explicit", () => {
  const partial = { ...outcome(), coverage: { ...outcome().coverage, processed_chunks: 1 } };
  assert.throws(() => signalWorkspaceClassificationOutcomeSchemaV1.parse(partial));
  assert.equal(signalWorkspaceClassificationOutcomeSchemaV1.parse({ ...partial,
    resolution_state: "error", technical_error_code: "engine_capacity_exceeded" }).resolution_state, "error");
  const human = { ...decision(), disposition: "approved", resolution_method: "human", model_version_id: null,
    decided_by_user_id: randomUUID(), correction_operation_id: randomUUID() };
  assert.equal(signalWorkspaceClassificationOutcomeSchemaV1.parse({ ...partial,
    resolution_state: "error", technical_error_code: "engine_capacity_exceeded", decisions: [human] }).decisions.length, 1);
  assert.throws(() => signalWorkspaceClassificationOutcomeSchemaV1.parse({ ...partial,
    resolution_state: "error", technical_error_code: "engine_capacity_exceeded", has_unresolved_topics: false }));
});
test("a thousand memberships are not silently reduced to top32 or128", () => {
  const decisions = Array.from({ length: 1_000 }, (_, index) => ({ ...decision(), term_key: `topic_${index}` }));
  assert.equal(parseSignalWorkspaceClassificationOutcomeV1({ identity, root, outcome: { ...outcome(), decisions } }).decisions.length, 1_000);
  assert.throws(() => parseSignalWorkspaceClassificationOutcomeV1({ identity, root,
    outcome: { ...outcome(), decisions: [decisions[0], decisions[0]] } }), /duplicate_decision/);
  assert.throws(() => parseSignalWorkspaceClassificationOutcomeV1({ identity, root,
    outcome: { ...outcome(), oversized: "x".repeat(SIGNAL_WORKSPACE_CLASSIFICATION_OUTCOME_MAX_BYTES_V1) } }), /capacity_exceeded/);
});
