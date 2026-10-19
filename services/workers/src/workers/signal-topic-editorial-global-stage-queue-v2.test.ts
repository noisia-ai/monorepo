import assert from "node:assert/strict";
import { test } from "node:test";
import {
  drainSignalTopicEditorialGlobalStagesV2,
  drainSignalTopicEditorialGlobalAdvancementsV2,
  SIGNAL_TOPIC_EDITORIAL_GLOBAL_ADVANCE_JOB_V2,
  SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_JOB_V2,
  signalTopicEditorialGlobalStageConfigurationV2,
  signalTopicEditorialGlobalStageIdV2,
  signalTopicEditorialGlobalStageJobV2,
} from "./signal-topic-editorial-global-stage-queue-v2";

const batchId = "00000000-0000-4000-8000-000000000101";
const jobId = `topic-editorial-global-stage-v2-${batchId}`;
const enabled = {
  NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED: "true",
  NOISIA_SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_ENABLED: "true",
};
const providerEnabled = {
  ...enabled,
  NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED: "true",
  NOISIA_SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_PROVIDER_ENABLED: "true",
};

test("global stage dispatch stays off without its own opt-in", async () => {
  assert.deepEqual(signalTopicEditorialGlobalStageConfigurationV2({}), { enabled: false, provider_enabled: false });
  assert.deepEqual(signalTopicEditorialGlobalStageConfigurationV2(enabled), { enabled: true, provider_enabled: false });
  assert.deepEqual(signalTopicEditorialGlobalStageConfigurationV2(providerEnabled), { enabled: true, provider_enabled: true });
  assert.deepEqual(await drainSignalTopicEditorialGlobalStagesV2({ env: {} }), { disabled: true, dispatched: 0 });
});

test("stage identity is stable across Worker retries and scoped to the exact screening digest", () => {
  const execution = "00000000-0000-4000-8000-000000000103";
  const first = "sha256:" + "a".repeat(64), second = "sha256:" + "b".repeat(64);
  const id = signalTopicEditorialGlobalStageIdV2(execution, first);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(id, signalTopicEditorialGlobalStageIdV2(execution, first));
  assert.notEqual(id, signalTopicEditorialGlobalStageIdV2(execution, second));
});

test("global stage drainer only enqueues durable due batches and suppresses prepared sends while disabled", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const jobs: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const database = { connect: async () => ({
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values }); return { rows: [{ id: batchId }] };
    }, release: () => undefined,
  }) };
  const queue = { getJob: async () => null,
    add: async (name: string, data: unknown, options: Record<string, unknown>) => {
      jobs.push({ name, data, options });
    },
  };
  const result = await drainSignalTopicEditorialGlobalStagesV2({ env: enabled,
    database: database as never, queue });
  assert.deepEqual(result, { disabled: false, dispatched: 1 });
  assert.deepEqual(queries[0]?.values, [false]);
  assert.match(queries[0]?.text ?? "", /batch\.state <> 'prepared' OR \(\$1::boolean/u);
  assert.deepEqual(jobs, [{ name: SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_JOB_V2,
    data: { batch_id: batchId }, options: { jobId, attempts: 3,
      backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true,
      removeOnFail: { age: 604800, count: 500 } } }]);
});

test("global stage drainer retries one completed queue job without creating another batch", async () => {
  const retried: string[] = [], added: string[] = [];
  const database = { connect: async () => ({ query: async () => ({ rows: [{ id: batchId }] }), release: () => undefined }) };
  await drainSignalTopicEditorialGlobalStagesV2({ env: providerEnabled, database: database as never,
    queue: { getJob: async () => ({ getState: async () => "completed" as const,
      retry: async (state) => { retried.push(state); } }),
      add: async (name) => { added.push(name); } } });
  assert.deepEqual(retried, ["completed"]);
  assert.deepEqual(added, []);
});

test("advancement requires accepted V3 screening and includes imported terminal failures for blocking", async () => {
  const executionId = "00000000-0000-4000-8000-000000000102";
  const statements: string[] = [], jobs: Array<{ name: string; data: unknown }> = [];
  const database = { connect: async () => ({ query: async (sql: string) => {
    statements.push(sql); return { rows: [{ id: executionId }] };
  }, release: () => undefined }) };
  const result = await drainSignalTopicEditorialGlobalAdvancementsV2({ env: enabled,
    database: database as never,
    queue: { getJob: async () => null, add: async (name, data) => { jobs.push({ name, data }); } } });
  assert.deepEqual(result, { disabled: false, dispatched: 1 });
  assert.match(statements[0] ?? "", /o\.stage='review_pending'/u);
  assert.match(statements[0] ?? "", /item\.validation->>'status'='accepted'/u);
  assert.match(statements[0] ?? "", /call\.status='settled'/u);
  assert.match(statements[0] ?? "", /done\.state IN\('imported','rejected'\)/u);
  assert.match(statements[0] ?? "", /latest\.validation->>'status'='provider_error'/u);
  assert.doesNotMatch(statements[0] ?? "", /result\.validation->>'status' NOT IN/u);
  assert.deepEqual(jobs, [{ name: SIGNAL_TOPIC_EDITORIAL_GLOBAL_ADVANCE_JOB_V2,
    data: { execution_id: executionId } }]);
});

test("global stage job rejects malformed queue identity before accessing storage or provider", async () => {
  await assert.rejects(() => signalTopicEditorialGlobalStageJobV2({ id: "wrong", data: { batch_id: batchId } },
    { env: providerEnabled }), /topic_editorial_global_stage_job_invalid/u);
  await assert.rejects(() => signalTopicEditorialGlobalStageJobV2({ id: jobId, data: { batch_id: "../bad" } },
    { env: providerEnabled }), /topic_editorial_global_stage_job_invalid/u);
});
