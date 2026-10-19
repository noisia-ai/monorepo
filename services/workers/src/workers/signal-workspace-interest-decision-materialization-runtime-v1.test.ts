import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  drainSignalWorkspaceInterestDecisionMaterializationsV1,
  signalWorkspaceInterestDecisionMaterializationJobV1,
  SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1,
} from "./signal-workspace-interest-decision-materialization-runtime-v1";

const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_MATERIALIZATION_ENABLED: "true" };
const executionId = randomUUID();
const jobId = `workspace-classification-${executionId}`;

test("disabled materialization does not touch PostgreSQL or Redis", async () => {
  const result = await drainSignalWorkspaceInterestDecisionMaterializationsV1({ env: {},
    database: { query: async () => { throw new Error("database touched"); } } as never,
    queue: { getJob: async () => { throw new Error("queue touched"); }, add: async () => undefined } });
  assert.deepEqual(result,{ disabled: true, schema_ready: false, dispatched: 0 });
});

test("only completed SQL0211 owners with an open, unleased execution are scheduled", async () => {
  const added: Array<{ name: string; data: unknown; options: Record<string,unknown> }> = [];
  const sql: string[] = [];
  const database = { query: async (statement: string) => {
    sql.push(statement);
    if (statement.includes("to_regclass")) return { rows: [{ ready: true }] };
    return { rows: [{ execution_id: executionId }] };
  } };
  const result = await drainSignalWorkspaceInterestDecisionMaterializationsV1({ env: enabled,
    database: database as never,
    queue: { getJob: async () => null, add: async (name,data,options) => {
      added.push({ name,data,options });
    } } });
  assert.deepEqual(result,{ disabled: false, schema_ready: true, dispatched: 1 });
  assert.equal(added[0]?.name,SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1);
  assert.deepEqual(added[0]?.data,{ execution_id: executionId });
  assert.equal(added[0]?.options.jobId,jobId);
  assert.match(sql[1]!,/owner\.status='completed'/u);
  assert.match(sql[1]!,/owner\.manifest_complete/u);
  assert.match(sql[1]!,/execution\.execution_expires_at<=clock_timestamp\(\)/u);
  assert.match(sql[1]!,/generation\.status='open'/u);
});

test("the durable SQL cursor retries an old completed Redis job but leaves active work alone", async () => {
  const retries: string[] = [];
  let state = "completed";
  const queue = { getJob: async () => ({ name: SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1,
    getState: async () => state, retry: async (value: "completed" | "failed") => { retries.push(value); } }),
    add: async () => { throw new Error("duplicate enqueue"); } };
  const database = { query: async (sql: string) => ({ rows: sql.includes("to_regclass")
    ? [{ ready: true }] : [{ execution_id: executionId }] }) };
  await drainSignalWorkspaceInterestDecisionMaterializationsV1({ env: enabled,
    database: database as never, queue });
  state = "active";
  await drainSignalWorkspaceInterestDecisionMaterializationsV1({ env: enabled,
    database: database as never, queue });
  assert.deepEqual(retries,["completed"]);
});

test("incomplete owner and unapplied SQL never dispatch", async () => {
  let calls = 0;
  const queue = { getJob: async () => { calls++; return null; }, add: async () => { calls++; } };
  const incomplete = { query: async (sql: string) => ({ rows: sql.includes("to_regclass")
    ? [{ ready: true }] : [] }) };
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionMaterializationsV1({ env: enabled,
    database: incomplete as never, queue }),{ disabled: false, schema_ready: true, dispatched: 0 });
  const missingSchema = { query: async () => ({ rows: [{ ready: false }] }) };
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionMaterializationsV1({ env: enabled,
    database: missingSchema as never, queue }),{ disabled: false, schema_ready: false, dispatched: 0 });
  assert.equal(calls,0);
});

test("materialization job rejects a forged or mismatched ID before opening PostgreSQL", async () => {
  await assert.rejects(signalWorkspaceInterestDecisionMaterializationJobV1({ id: "other-job",
    data: { execution_id: executionId } },{ env: enabled,
    database: { query: async () => { throw new Error("database touched"); } } as never }),
  /job_invalid/u);
});
