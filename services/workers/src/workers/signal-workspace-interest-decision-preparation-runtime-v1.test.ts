import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  drainSignalWorkspaceInterestDecisionPreparationsV1,
  signalWorkspaceInterestDecisionPreparationJobV1,
  SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V1,
} from "./signal-workspace-interest-decision-preparation-runtime-v1";

const owner = { owner_id: randomUUID(), workspace_id: randomUUID(), actor_user_id: randomUUID(),
  generation_id: randomUUID(), source_execution_id: randomUUID() };
const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_PREPARATION_ENABLED: "true" };
const jobId = `interest-decision-preparation-v1-${owner.owner_id}`;

test("preparation scheduler and job are off without the independent opt-in", async () => {
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionPreparationsV1({ env: {} }),
    { disabled: true, schema_ready: false, dispatched: 0 });
  assert.deepEqual(await signalWorkspaceInterestDecisionPreparationJobV1({ id: jobId, data: owner }, { env: {} }),
    { disabled: true });
});

test("scheduler checks SQL0211 and enqueues a single owner identity on the existing queue", async () => {
  const statements: string[] = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    statements.push(statement);
    if (statement.includes("to_regclass")) return { rows: [{ ready: true }] };
    if (statement.includes("FROM signal_interest_decision_owners_v1 o")) return { rows: [owner] };
    throw new Error("unexpected query");
  }, release: () => undefined }) };
  const added: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const queue = { getJob: async () => null, add: async (name: string, data: unknown,
    options: Record<string, unknown>) => { added.push({ name, data, options }); } };
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionPreparationsV1({ env: enabled,
    database: database as never, queue: queue as never }),
    { disabled: false, schema_ready: true, dispatched: 1 });
  assert.equal(added[0]?.name, SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V1);
  assert.deepEqual(added[0]?.data, { owner_id: owner.owner_id });
  assert.equal(added[0]?.options.jobId, jobId);
  assert.ok(statements.some(sql => sql.includes("NOT EXISTS") && sql.includes("interest-decision-page:")));
  added.length = 0;
  const activeQueue = { getJob: async () => ({ getState: async () => "active", retry: async () => {
    throw new Error("active job must not retry"); } }), add: queue.add };
  await drainSignalWorkspaceInterestDecisionPreparationsV1({ env: enabled,
    database: database as never, queue: activeQueue as never });
  assert.equal(added.length, 0);
});

test("job validates identity and limits each invocation to one page or batch", async () => {
  const database = { connect: async () => ({ query: async (statement: string) => {
    if (statement.includes("to_regclass")) return { rows: [{ ready: true }] };
    if (statement.includes("FROM signal_interest_decision_owners_v1 WHERE")) return { rows: [owner] };
    throw new Error("unexpected query");
  }, release: () => undefined }) };
  let calls = 0;
  const prepare = async (args: typeof owner & { database: unknown; max_pages?: number; max_batches?: number }) => {
    calls++;
    assert.equal(args.owner_id, owner.owner_id);
    assert.equal(args.max_pages, 1);
    assert.equal(args.max_batches, 1);
    return { owner_id: owner.owner_id, manifest_roots: 64, page_count: 1,
      batch_ids: [], phase: "sealing" as const };
  };
  const result = await signalWorkspaceInterestDecisionPreparationJobV1({ id: jobId,
    data: { owner_id: owner.owner_id } }, { env: enabled, database: database as never,
    prepare: prepare as never });
  assert.equal(result.disabled, false);
  assert.equal(calls, 1);
  await assert.rejects(signalWorkspaceInterestDecisionPreparationJobV1({ id: "foreign",
    data: { owner_id: owner.owner_id } }, { env: enabled, database: database as never,
    prepare: prepare as never }), /workspace_interest_preparation_runtime_job_invalid/u);
  assert.equal(calls, 1);
});
