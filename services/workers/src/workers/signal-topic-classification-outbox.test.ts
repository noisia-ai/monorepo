import assert from "node:assert/strict";
import test from "node:test";

import { drainSignalTopicClassificationOutboxV1 } from "./signal-topic-classification-outbox";

const claimed = {
  outbox_id: "10000000-0000-4000-8000-000000000001",
  execution_id: "20000000-0000-4000-8000-000000000002",
  workspace_id: "30000000-0000-4000-8000-000000000003",
  lease_token: "40000000-0000-4000-8000-000000000004",
  worker_job_id: "signal-topic-classification-20000000-0000-4000-8000-000000000002",
  attempt_count: 1
};

test("topic classification outbox dispatches with the durable job id and acknowledges its lease", async () => {
  const statements: string[] = [];
  const database = { query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes("RETURNING outbox.id::text")) return { rows: [claimed], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const jobs: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const queue = { add: async (name: string, data: unknown, options: Record<string, unknown>) => {
    jobs.push({ name, data, options });
  } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue });
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
  const queue = { add: async () => { throw new Error("redis unavailable"); } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, max_attempts: 8 });
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
  const queue = { add: async () => { throw new Error("redis unavailable"); } };
  const result = await drainSignalTopicClassificationOutboxV1({ database: database as never, queue, max_attempts: 8 });
  assert.equal(result.dead_lettered, 1);
  assert.ok(statements.some((sql) => sql.includes("status='dead_letter'")
    && sql.includes("error_code='topic_queue_unavailable'")));
});
