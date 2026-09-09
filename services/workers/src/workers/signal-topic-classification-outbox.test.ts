import assert from "node:assert/strict";
import test from "node:test";

import { drainSignalTopicClassificationOutboxV1 } from "./signal-topic-classification-outbox";
import { SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME } from "./signal-workspace-topic-computation";
import { SIGNAL_WORKSPACE_ENGINE_JOB_V1 } from "@noisia/query-engine";

const claimed = {
  outbox_id: "10000000-0000-4000-8000-000000000001",
  execution_id: "20000000-0000-4000-8000-000000000002",
  workspace_id: "30000000-0000-4000-8000-000000000003",
  lease_token: "40000000-0000-4000-8000-000000000004",
  worker_job_id: "signal-topic-classification-20000000-0000-4000-8000-000000000002",
  attempt_count: 1,
  input_contract: "legacy-topic-catalog-v1"
};
const schedule = async () => ({ requeued: 0 });

test("topic classification outbox dispatches with the durable job id and acknowledges its lease", async () => {
  const statements: string[] = [];
  const database = { query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes("RETURNING outbox.id::text")) return { rows: [claimed], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const jobs: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const queue = { getJob: async () => null, add: async (name: string, data: unknown, options: Record<string, unknown>) => {
    jobs.push({ name, data, options });
  } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule });
  assert.equal(result.dispatched, 1);
  assert.deepEqual(jobs[0]?.data, { execution_id: claimed.execution_id });
  assert.equal(jobs[0]?.options.jobId, claimed.worker_job_id);
  assert.ok(statements.some((sql) => sql.includes("status='dispatched'")));
});

test("topic classification outbox preserves retryable dispatch failures", async () => {
  const statements: string[] = [];
  const database = { query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes("RETURNING outbox.id::text")) return { rows: [claimed], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const queue = { getJob: async () => null, add: async () => { throw new Error("redis unavailable"); } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule, max_attempts: 8 });
  assert.equal(result.failed, 1);
  assert.ok(statements.some((sql) => sql.includes("status='failed'")));
  assert.ok(statements.some((sql) => sql.includes("make_interval")));
});

test("topic classification outbox makes an exhausted queue failure visible on the execution", async () => {
  const statements: string[] = [];
  const database = { query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes("RETURNING outbox.id::text")) {
      return { rows: [{ ...claimed, attempt_count: 8 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  } };
  const queue = { getJob: async () => null, add: async () => { throw new Error("redis unavailable"); } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule, max_attempts: 8 });
  assert.equal(result.dead_lettered, 1);
  assert.ok(statements.some((sql) => sql.includes("status='dead_letter'")
    && sql.includes("error_code='topic_queue_unavailable'")));
});

test("workspace topic execution is routed to its complete-chunk worker and never the legacy handler", async () => {
  let scheduled = false;
  const database = { query: async (sql: string) => {
    assert.equal(scheduled, true);
    if (sql.includes("RETURNING outbox.id::text")) return { rows: [{ ...claimed,
      input_contract: "workspace-topic-computation-v1" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const jobs: string[] = [];
  const queue = { getJob: async () => null, add: async (name: string) => { jobs.push(name); } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue,
    schedule: async () => { scheduled = true; return { requeued: 1 }; } });
  assert.equal(result.dispatched, 1);
  assert.deepEqual(jobs, [SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME]);
});

test("authorized outbox redelivery resumes retained completed jobs without adding another job", async () => {
  const database = { query: async (sql: string) => sql.includes("RETURNING outbox.id::text")
    ? { rows: [{ ...claimed, input_contract: "workspace-topic-computation-v1" }], rowCount: 1 }
    : { rows: [], rowCount: 1 } };
  const retries: string[] = [];
  const queue = { getJob: async () => ({ name: SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME,
    getState: async () => "completed", retry: async (state: string) => { retries.push(state); } }),
  add: async () => { assert.fail("retained job must be reused"); } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule });
  assert.equal(result.dispatched, 1);
  assert.deepEqual(retries, ["completed"]);
});

test("workspace engine routes to the Python worker with one attempt and resumes its retained job", async () => {
  const database = { query: async (sql: string) => sql.includes("RETURNING outbox.id::text")
    ? { rows: [{ ...claimed, input_contract: "workspace-topic-engine-v1" }], rowCount: 1 }
    : { rows: [], rowCount: 1 } };
  let added = 0;
  const queue = { getJob: async () => null, add: async (name: string, data: unknown, options: Record<string, unknown>) => {
    assert.equal(name, SIGNAL_WORKSPACE_ENGINE_JOB_V1);
    assert.equal(options.attempts, 1);
    assert.equal(options.jobId, claimed.worker_job_id);
    assert.deepEqual(data, { execution_id: claimed.execution_id }); added++;
  } };
  assert.equal((await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule })).dispatched, 1);
  assert.equal(added, 1);
  const retries: string[] = [];
  const retained = { getJob: async () => ({ name: SIGNAL_WORKSPACE_ENGINE_JOB_V1,
    getState: async () => "failed", retry: async (state: string) => { retries.push(state); } }),
  add: async () => assert.fail("must resume durable engine job") };
  assert.equal((await drainSignalTopicClassificationOutboxV1({ database: database as never, queue: retained, schedule })).dispatched, 1);
  assert.deepEqual(retries, ["failed"]);
});

test("unknown contracts and mismatched retained job names cannot reach either classifier", async () => {
  for (const inputContract of ["unknown-future-contract", "workspace-topic-computation-v1"]) {
    const database = { query: async (sql: string) => sql.includes("RETURNING outbox.id::text")
      ? { rows: [{ ...claimed, input_contract: inputContract }], rowCount: 1 }
      : { rows: [], rowCount: 1 } };
    const queue = { getJob: async () => ({ name: "legacy-wrong-job",
      getState: async () => "completed", retry: async () => assert.fail("must not retry wrong contract") }),
    add: async () => assert.fail("must not dispatch an unknown or mismatched contract") };
    const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule });
    assert.equal(result.failed, 1);
    assert.equal(result.dispatched, 0);
  }
});


test("only a sealed source projection routes native classification to the projection worker",async()=>{
 const {topicExecutionJobNameV1}=await import('./signal-topic-classification-outbox');
 assert.equal(topicExecutionJobNameV1('workspace-topic-classification-v1',true),'signal_workspace_topic_projection_v1');
 assert.throws(()=>topicExecutionJobNameV1('workspace-topic-classification-v1',false),/contract_unknown/u);
});

test("engine progress dispatch uses workspace and actor scope without reopening the numerical engine", async () => {
  const actor = "50000000-0000-4000-8000-000000000005";
  const database = { query: async (sql: string) => sql.includes("RETURNING outbox.id::text")
    ? { rows: [{ ...claimed, input_contract: "workspace-topic-engine-v1", dispatch_kind: "engine_progress", actor_user_id: actor }], rowCount: 1 }
    : { rows: [], rowCount: 1 } };
  let added = 0;
  const queue = { getJob: async () => null, add: async (name: string, data: unknown, options: Record<string, unknown>) => {
    assert.equal(name, "signal_workspace_engine_progress_v1");
    assert.deepEqual(data, { execution_id: claimed.execution_id, workspace_id: claimed.workspace_id, actor_user_id: actor });
    assert.equal(options.attempts, 1); added++;
  } };
  assert.equal((await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule })).dispatched, 1);
  assert.equal(added, 1);
});

test("progress dispatch identity never routes other contracts or unknown dispatch kinds", async () => {
  const { topicExecutionJobNameV1 } = await import("./signal-topic-classification-outbox");
  for (const input of ["legacy-topic-catalog-v1", "workspace-topic-computation-v1", "workspace-topic-classification-v1"])
    assert.throws(() => topicExecutionJobNameV1(input, true, "engine_progress"), /contract_unknown/u);
  assert.throws(() => topicExecutionJobNameV1("workspace-topic-engine-v1", false, "future"), /contract_unknown/u);
});

test("incremental binding derivation carries its durable scope without reopening the numeric execution", async () => {
  const actor = "50000000-0000-4000-8000-000000000005";
  const database = { query: async (sql: string) => sql.includes("RETURNING outbox.id::text")
    ? { rows: [{ ...claimed, input_contract: "workspace-topic-engine-v1", dispatch_kind: "incremental_projection", actor_user_id: actor }], rowCount: 1 }
    : { rows: [], rowCount: 1 } };
  const jobs: unknown[] = [];
  const queue = { getJob: async () => null, add: async (name: string, data: unknown, options: Record<string, unknown>) => {
    assert.equal(name, "signal_workspace_incremental_derivation_v1");
    assert.equal(options.attempts, 1); assert.equal(options.jobId, claimed.worker_job_id); jobs.push(data);
  } };
  assert.equal((await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule })).dispatched, 1);
  assert.deepEqual(jobs, [{ execution_id: claimed.execution_id, workspace_id: claimed.workspace_id, actor_user_id: actor }]);
});

test("incremental classification routes only its explicit source contract and retains its previous job", async () => {
  const database = { query: async (sql: string) => sql.includes("RETURNING outbox.id::text")
    ? { rows: [{ ...claimed, input_contract: "workspace-topic-classification-v1", source_projection: true,
      source_projection_contract: "workspace-topic-incremental-projection-v1", dispatch_kind: "execution" }], rowCount: 1 }
    : { rows: [], rowCount: 1 } };
  const retries: string[] = [];
  const queue = { getJob: async () => ({ name: "signal_workspace_incremental_projection_v1", getState: async () => "failed",
    retry: async (state: string) => { retries.push(state); } }), add: async () => assert.fail("same durable job must be retained") };
  assert.equal((await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, schedule })).dispatched, 1);
  assert.deepEqual(retries, ["failed"]);
  const { topicExecutionJobNameV1: route } = await import("./signal-topic-classification-outbox");
  assert.equal(route("workspace-topic-classification-v1", true, "execution", "workspace-topic-projection-v1"), "signal_workspace_topic_projection_v1");
  assert.throws(() => route("workspace-topic-classification-v1", true, "execution", "unknown-projection"), /contract_unknown/u);
  for (const contract of ["legacy-topic-catalog-v1", "workspace-topic-computation-v1", "workspace-topic-classification-v1"])
    assert.throws(() => route(contract, true, "incremental_projection"), /contract_unknown/u);
});
