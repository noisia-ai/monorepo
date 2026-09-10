import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSignalTopicCandidateRefinementSuccessorFlightV1,
  signalTopicCandidateRefinementFlightPreparationTestOnly
} from "./prepare-signal-topic-candidate-refinement-successor-flight-v1";

const receipt = {
  clone_name: "noisia_topic_eval_lab_20260905_0123456789ab",
  parent_output_digest: `sha256:${"a".repeat(64)}`
} as never;

const proof = {
  database_name: "noisia_topic_eval_lab_20260905_0123456789ab",
  source_run_key: "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17",
  output_digest: `sha256:${"a".repeat(64)}`,
  run_count: 1, authorizations: 1, model_turns: 12, retrievals: 11, retrieval_evidence: 30,
  candidates: 10, candidate_revisions: 10, candidate_evidence: 30, rankings: 10, provider_calls: 12,
  candidate_editorial_revisions: 0, proposals: 0, adoption: 0, publication: 0, serving: 0,
  sessions: 0, flights: 0, claims: 0, terminals: 0,
  migration_0116: 1, migration_0117: 1, migration_0118: 1, migration_0119: 1,
  migration_0120: 1, migration_0121: 1, host_anchor_count: 1
};

test("preparation is disabled before it can inspect a host or open a pool", async () => {
  let inspected = false;
  await assert.rejects(prepareSignalTopicCandidateRefinementSuccessorFlightV1({}, {
    verifyHostReceipt: async () => { inspected = true; return {} as never; }
  }), /topic_refinement_flight_preparation_disabled/u);
  assert.equal(inspected, false);
});

test("pristine proof requires every completed LAB-2G count and zero refinement effects", () => {
  assert.equal(signalTopicCandidateRefinementFlightPreparationTestOnly.isPristine(proof, receipt), true);
  assert.equal(signalTopicCandidateRefinementFlightPreparationTestOnly.isPristine({ ...proof, proposals: 1 }, receipt), false);
  assert.equal(signalTopicCandidateRefinementFlightPreparationTestOnly.isPristine({ ...proof, migration_0121: 0 }, receipt), false);
  assert.equal(signalTopicCandidateRefinementFlightPreparationTestOnly.isPristine({ ...proof, output_digest: `sha256:${"b".repeat(64)}` }, receipt), false);
});

test("missing or insufficient cross-experiment balance rejects before host access or writes", async () => {
  for (const value of [undefined, "NaN", "1.5", "999999", "20000000"]) {
    let inspected = false;
    await assert.rejects(prepareSignalTopicCandidateRefinementSuccessorFlightV1({
      NOISIA_RUNTIME_PROFILE: "local_disposable_lab_v1",
      NOISIA_TOPIC_REFINEMENT_FLIGHT_PREPARATION_ENABLED: "true",
      NOISIA_TOPIC_REFINEMENT_FLIGHT_PREPARATION_CONFIRMATION:
        signalTopicCandidateRefinementFlightPreparationTestOnly.CONFIRMATION,
      NOISIA_TOPIC_REFINEMENT_AGGREGATE_REMAINING_MICRO_USD: value
    }, { verifyHostReceipt: async () => { inspected = true; return {} as never; } }),
    /topic_refinement_flight_preparation_budget_invalid/u);
    assert.equal(inspected, false);
  }
});

test("exact migration ledger rejects a later authority migration with the wrong checksum or name", async () => {
  const expected = [116, 117, 118, 119, 120, 121].map((ordinal) => ({ ordinal,
    name: `0${ordinal}_fixture.sql`, checksum_sha256: `sha256:${String(ordinal).padStart(64, "0")}` }));
  const pool = { query: async () => ({ rows: [{ payload: JSON.stringify(expected.map((entry) => ({
    ordinal: entry.ordinal, migration_name: entry.name, checksum_sha256: entry.checksum_sha256
  }))) }], rowCount: 1 }) };
  await signalTopicCandidateRefinementFlightPreparationTestOnly.exactMigrationLedger(pool as never, expected);
  const malformed = { query: async () => ({ rows: [{ payload: JSON.stringify(expected.map((entry) =>
    entry.ordinal === 121 ? { ...entry, checksum_sha256: `sha256:${"f".repeat(64)}` } : entry)) }], rowCount: 1 }) };
  await assert.rejects(signalTopicCandidateRefinementFlightPreparationTestOnly.exactMigrationLedger(malformed as never, expected),
    /topic_refinement_flight_preparation_migration_ledger_mismatch/u);
});
