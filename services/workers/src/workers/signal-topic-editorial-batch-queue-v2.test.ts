import assert from "node:assert/strict";
import { test } from "node:test";
import type { SignalTopicEditorialBatchDatabaseV2 } from "@noisia/db";
import { drainSignalTopicEditorialBatchesV2, signalTopicEditorialBatchConfigurationV2,
  signalTopicEditorialBatchJobV2, signalTopicEditorialBatchPreparationJobV2, startSignalTopicEditorialBatchDrainerV2,
  SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2, SIGNAL_TOPIC_EDITORIAL_BATCH_PREPARATION_JOB_V2,
  safeSignalTopicEditorialBatchDispatchErrorV2 } from "./signal-topic-editorial-batch-queue-v2";

test("dispatch diagnostics preserve phase and safe codes without leaking private messages", () => {
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(Object.assign(new Error("private SQL details"), { code: "42P01" }), "database_read"),
    "topic_editorial_batch_dispatch_database_read_postgres_42p01");
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(Object.assign(new Error("redis://private-secret"), { code: "ECONNRESET" }), "queue_lookup"),
    "topic_editorial_batch_dispatch_queue_lookup_transport_econnreset");
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(new Error("topic_editorial_batch_storage_receipt_invalid"), "queue_enqueue"),
    "topic_editorial_batch_dispatch_queue_enqueue_topic_editorial_batch_storage_receipt_invalid");
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(new Error("postgres://user:secret@db/private"), "anything/unexpected"),
    "topic_editorial_batch_dispatch_unknown_error");
  const wrapped = new Error("private wrapper", { cause: Object.assign(new Error("socket details"), { code: "ENOTFOUND" }) });
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(wrapped, "database_read"),
    "topic_editorial_batch_dispatch_database_read_error_cause_error_enotfound");
  const unsafeCode = Object.assign(new Error("private SQL details"), { code: "password=private" });
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(unsafeCode, "database_read"),
    "topic_editorial_batch_dispatch_database_read_error");
  const safelyWrapped = new Error("topic_editorial_batch_database_read_error", {
    cause: Object.assign(new Error("private SQL text"), { code: "42P01" }),
  });
  assert.equal(safeSignalTopicEditorialBatchDispatchErrorV2(safelyWrapped, "database_read"),
    "topic_editorial_batch_dispatch_database_read_error_cause_error_42p01");
});

test("disabled Batch lane does not open DB, queue, key, timer or provider", async () => {
  const database = { connect: async () => { assert.fail("disabled database"); } };
  const env = new Proxy({}, { get(_object, key) {
    if (key === "ANTHROPIC_API_KEY") assert.fail("disabled key read");
    return undefined;
  } });
  assert.deepEqual(signalTopicEditorialBatchConfigurationV2(env), { enabled: false, provider_enabled: false });
  assert.deepEqual(await drainSignalTopicEditorialBatchesV2({ env, database }), { disabled: true, dispatched: 0 });
  assert.deepEqual(await signalTopicEditorialBatchJobV2({ id: "bad", data: { batch_id: "bad" } }, { env, database }), { disabled: true });
  const drainer = startSignalTopicEditorialBatchDrainerV2({ env, database });
  await drainer.drainNow(); await drainer.close();
});

test("existing Data OS queue carries only durable IDs and still polls receipts when sends are disabled", async () => {
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const executionId = "00000000-0000-4000-8000-000000000003";
  const added: unknown[] = [], retries: string[] = [];
  let released = false;
  const database = { connect: async () => ({ query: async (sql: string, values: unknown[]) => {
    if (/SELECT id FROM signal_topic_editorial_provider_batches_v2/u.test(sql)) {
      assert.match(sql, /state <> 'prepared' OR \$1::boolean/u);
      assert.match(sql, /next_poll_at <= clock_timestamp/u);
      assert.deepEqual(values, [false]);
      return { rows: ids.map(id => ({ id })) };
    }
    assert.match(sql, /signal-topic-editorial-screening-plan-v2/u);
    assert.match(sql, /e\.status IN\('queued','running'\)/u);
    assert.match(sql, /NOT EXISTS\(SELECT 1 FROM signal_topic_editorial_provider_batches_v2/u);
    assert.match(sql, /NOT EXISTS\(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2/u);
    return { rows: [{ id: executionId }] };
  }, release() { released = true; } }) } as unknown as SignalTopicEditorialBatchDatabaseV2;
  const queue = { getJob: async (id: string) => id.endsWith(ids[0]!) || id === `topic-editorial-batch-v2-prepare-${executionId}`
    ? { getState: async () => "failed", retry: async (state: "completed" | "failed") => { retries.push(`${id}:${state}`); } } : null,
  add: async (name: string, data: { batch_id: string } | { execution_id: string }, options: Record<string, unknown>) => {
    if ("execution_id" in data) {
      assert.equal(name, SIGNAL_TOPIC_EDITORIAL_BATCH_PREPARATION_JOB_V2);
      assert.equal(data.execution_id, executionId);
      assert.equal(options.jobId, `topic-editorial-batch-v2-prepare-${executionId}`);
    } else {
      assert.equal(name, SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2);
      assert.deepEqual(data, { batch_id: ids[1] });
      assert.equal(options.jobId, `topic-editorial-batch-v2-${ids[1]}`);
    }
    assert.equal(options.removeOnComplete, true);
    added.push(data);
  } };
  assert.deepEqual(await drainSignalTopicEditorialBatchesV2({ database, queue,
    env: { NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true", NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED: "false" } }),
  { disabled: false, dispatched: 3 });
  assert.equal(released, true); assert.equal(added.length, 1);
  assert.deepEqual(retries, [`topic-editorial-batch-v2-prepare-${executionId}:failed`, `topic-editorial-batch-v2-${ids[0]}:failed`]);
});

test("preparation job is deterministic, replayable and independent of provider send permission", async () => {
  const executionId = "00000000-0000-4000-8000-000000000004";
  const events: string[] = [];
  const env = new Proxy({ NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true",
    NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED: "false" }, { get(target, key) {
    if (key === "ANTHROPIC_API_KEY") assert.fail("preparation must not read a provider key");
    return Reflect.get(target, key);
  } });
  const result = await signalTopicEditorialBatchPreparationJobV2({
    id: `topic-editorial-batch-v2-prepare-${executionId}`, data: { execution_id: executionId },
  }, { env, database: {} as SignalTopicEditorialBatchDatabaseV2,
    reuse: async input => { assert.equal(input.execution_id, executionId); events.push("reuse"); return { reused_items: 12, needs_review_items: 3 }; },
    prepare: async input => { assert.equal(input.execution_id, executionId); events.push("prepare");
      return { batch_id: "00000000-0000-4000-8000-000000000005", manifest_digest: "sha256:test", replayed: true,
        provider_items: 3 }; },
  });
  assert.deepEqual(events, ["reuse", "prepare"]);
  assert.deepEqual(result, { disabled: false, execution_id: executionId, reused_items: 12, needs_review_items: 3,
    provider_items: 3, batch_id: "00000000-0000-4000-8000-000000000005" });
});

test("preparation scan excludes V1, completed/failed, manifest-ready and all-reused work", async () => {
  let sql = "";
  const database = { connect: async () => ({ query: async (text: string) => {
    sql = text;
    return { rows: [] };
  }, release() {} }) } as unknown as SignalTopicEditorialBatchDatabaseV2;
  await drainSignalTopicEditorialBatchesV2({ database,
    queue: { getJob: async () => null, add: async () => assert.fail("no candidates should enqueue") },
    env: { NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true", NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED: "false" } });
    assert.match(sql, /signal-topic-editorial-screening-plan-v2/u, "V1 plans are excluded");
  assert.match(sql, /e\.status IN\('queued','running'\)/u, "completed/failed execution states are excluded");
  assert.match(sql, /NOT EXISTS\(SELECT 1 FROM signal_topic_editorial_provider_batches_v2/u, "existing manifests are excluded");
    assert.match(sql, /EXISTS\(SELECT 1 FROM signal_topic_editorial_requests r[\s\S]*?NOT EXISTS\(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2/u,
    "fully reused executions are excluded");
  assert.match(sql, /JOIN signal_topic_editorial_batch_owners_v2 o[\s\S]*o\.stage<>'preparation_failed'/u,
    "a durable terminal preparation failure is not re-enqueued forever");
});

test("terminal preparation failure is recorded only on the last queue attempt", async () => {
  const executionId = "00000000-0000-4000-8000-000000000006";
  const env = { NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true",
    NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED: "false" };
  const job = { id: `topic-editorial-batch-v2-prepare-${executionId}`, data: { execution_id: executionId },
    attemptsMade: 2, opts: { attempts: 3 } };
  const marks: string[] = [];
  await assert.rejects(signalTopicEditorialBatchPreparationJobV2(job, { env,
    database: {} as SignalTopicEditorialBatchDatabaseV2,
    reuse: async () => { throw new Error("private storage details"); },
    prepare: async () => assert.fail("preparation cannot follow failed reuse"),
    markFailed: async args => { marks.push(args.execution_id); return { execution_id: args.execution_id, stage: "preparation_failed", replayed: false }; },
  }), /private storage details/u);
  assert.deepEqual(marks, [executionId]);

  marks.length = 0;
  await assert.rejects(signalTopicEditorialBatchPreparationJobV2({ ...job, attemptsMade: 1 }, { env,
    database: {} as SignalTopicEditorialBatchDatabaseV2,
    reuse: async () => { throw new Error("retryable storage details"); },
    markFailed: async args => { marks.push(args.execution_id); return { execution_id: args.execution_id, stage: "preparation_failed", replayed: false }; },
  }), /retryable storage details/u);
  assert.deepEqual(marks, []);
});

test("worker rejects foreign job identity before DB or provider construction", async () => {
  await assert.rejects(signalTopicEditorialBatchJobV2({ id: "unrelated", data: {
    batch_id: "00000000-0000-4000-8000-000000000001" } },
  { env: { NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true" },
    database: { connect: async () => { assert.fail("invalid job cannot connect"); } } }), /topic_editorial_batch_job_invalid/u);
});
