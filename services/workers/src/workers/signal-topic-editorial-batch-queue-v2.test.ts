import assert from "node:assert/strict";
import { test } from "node:test";
import type { SignalTopicEditorialBatchDatabaseV2 } from "@noisia/db";
import { drainSignalTopicEditorialBatchesV2, signalTopicEditorialBatchConfigurationV2,
  signalTopicEditorialBatchJobV2, startSignalTopicEditorialBatchDrainerV2,
  SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2 } from "./signal-topic-editorial-batch-queue-v2";

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

test("existing Data OS queue carries only the batch ID; receipt polls survive sends disabled", async () => {
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const added: unknown[] = [], retries: string[] = [];
  let released = false;
  const database = { connect: async () => ({ query: async (sql: string, values: unknown[]) => {
    assert.match(sql, /state <> 'prepared' OR \$1::boolean/u);
    assert.match(sql, /next_poll_at <= clock_timestamp/u);
    assert.deepEqual(values, [false]);
    return { rows: ids.map(id => ({ id })) };
  }, release() { released = true; } }) } as unknown as SignalTopicEditorialBatchDatabaseV2;
  const queue = { getJob: async (id: string) => id.endsWith(ids[0]!)
    ? { getState: async () => "failed", retry: async (state: "completed" | "failed") => { retries.push(state); } } : null,
  add: async (name: string, data: { batch_id: string }, options: Record<string, unknown>) => {
    assert.equal(name, SIGNAL_TOPIC_EDITORIAL_BATCH_JOB_V2);
    assert.deepEqual(data, { batch_id: ids[1] });
    assert.equal(options.removeOnComplete, true);
    added.push(data);
  } };
  assert.deepEqual(await drainSignalTopicEditorialBatchesV2({ database, queue,
    env: { NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true", NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED: "false" } }),
  { disabled: false, dispatched: 2 });
  assert.equal(released, true); assert.equal(added.length, 1); assert.deepEqual(retries, ["failed"]);
});

test("worker rejects foreign job identity before DB or provider construction", async () => {
  await assert.rejects(signalTopicEditorialBatchJobV2({ id: "unrelated", data: {
    batch_id: "00000000-0000-4000-8000-000000000001" } },
  { env: { NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true" },
    database: { connect: async () => { assert.fail("invalid job cannot connect"); } } }), /topic_editorial_batch_job_invalid/u);
});
