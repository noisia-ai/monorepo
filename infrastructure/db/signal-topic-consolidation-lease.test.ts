import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  computeSignalTopicConsolidationCentroidsV1,
  persistSignalTopicConsolidationCentroidArtifactV1,
} from "./signal-topic-consolidation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const control = { execution_id: id(1), execution_token: id(2), workspace_id: id(3), actor_user_id: id(4) };

function failingDatabase(stopAt: RegExp) {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (stopAt.test(sql)) throw new Error("stop_after_authority_check");
      return { rows: [] };
    },
    release() {},
  };
  return { statements, database: { async connect() { return client; } } };
}

test("long centroid reads use the execution lease without taking the actor scope lock", async () => {
  const fake = failingDatabase(/SET LOCAL statement_timeout/u);
  await assert.rejects(computeSignalTopicConsolidationCentroidsV1({
    database: fake.database as never,
    workspace_id: control.workspace_id,
    actor_user_id: control.actor_user_id,
    source_execution_id: id(5),
    embedding_run_id: id(6),
    embedding_config_digest: digest("embedding"),
    memberships: [{ group_key: "open:group-1", ordinal: 0, chunk_sha256: digest("chunk") }],
    neighbor_k: 1,
    control_execution: control,
  }), /stop_after_authority_check/);
  assert.equal(fake.statements.some(sql => sql.includes("assert_signal_topic_consolidation_worker_lease_v1")), true);
  assert.equal(fake.statements.some(sql => sql.includes("assert_signal_topic_consolidation_worker_scope_v1")), false);
});

test("durable centroid artifact writes retain the full worker scope fence", async () => {
  const fake = failingDatabase(/assert_signal_topic_consolidation_worker_scope_v1/u);
  const setDigest = digest("centroid-set");
  await assert.rejects(persistSignalTopicConsolidationCentroidArtifactV1({
    database: fake.database as never,
    workspace_id: control.workspace_id,
    actor_user_id: control.actor_user_id,
    source_execution_id: id(5),
    source_checkpoint_digest: digest("checkpoint"),
    artifact: {
      name: `centroids.consolidation.${setDigest.slice(7, 23)}.json`,
      storage_key: "workspace-engine/test/centroids.json",
      sha256: digest("artifact"),
      size_bytes: 1,
      media_type: "application/json",
    },
    centroid_count: 1,
    centroid_set_digest: setDigest,
    control_execution: control,
  }), /stop_after_authority_check/);
  assert.equal(fake.statements.some(sql => sql.includes("assert_signal_topic_consolidation_worker_scope_v1")), true);
  assert.equal(fake.statements.some(sql => sql.includes("assert_signal_topic_consolidation_worker_lease_v1")), false);
});
