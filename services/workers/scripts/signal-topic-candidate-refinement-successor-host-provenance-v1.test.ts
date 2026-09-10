import assert from "node:assert/strict";
import test from "node:test";

import { parseSignalTopicCandidateRefinementSuccessorHostReceiptV1,
  signalTopicCandidateRefinementSuccessorHostReceiptDigestV1,
  SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const unsigned = {
  contract_version: "signal-topic-candidate-refinement-successor-host-provenance-v1" as const,
  created_at: "2026-09-05T18:00:00.000Z",
  container_name: "noisia-r24a-provenance-pg" as const,
  container_id: "a".repeat(64), image_id: digest, image_reference: "pgvector/pgvector:pg17" as const,
  endpoint_host: "127.0.0.1" as const, endpoint_port: 5432,
  clone_name: "noisia_topic_eval_lab_20260905_abcdef123456",
  parent_clone_name: SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE as typeof SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE,
  source_run_key: "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17" as const,
  source_snapshot_digest: digest, source_artifact_binding_digest: digest, source_membership_binding_digest: digest,
  parent_output_digest: digest, server_system_identifier: "123456789"
};

test("direct LAB-2G successor receipt is self-sealing and cannot point to another parent", () => {
  const receipt = { ...unsigned, receipt_digest: signalTopicCandidateRefinementSuccessorHostReceiptDigestV1(unsigned) };
  assert.deepEqual(parseSignalTopicCandidateRefinementSuccessorHostReceiptV1(receipt), receipt);
  assert.throws(() => parseSignalTopicCandidateRefinementSuccessorHostReceiptV1({
    ...receipt, parent_clone_name: "noisia_topic_eval_lab_20260905_deadbeef1234"
  }));
  assert.throws(() => parseSignalTopicCandidateRefinementSuccessorHostReceiptV1({
    ...receipt, parent_output_digest: digest.replace(/a$/u, "b")
  }));
});
