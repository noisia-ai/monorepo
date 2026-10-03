import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drainSignalWorkspaceInterestDecisionMaterializationsV2 } from "./signal-workspace-interest-decision-materialization-runtime-v2";

test("V2 owner completion is recovered before materialization dispatch", async () => {
  const ownerId = randomUUID(), executionId = randomUUID();
  const events: string[] = [];
  const database = { query: async (statement: string) => {
    if (statement.includes("to_regclass")) return { rows: [{ ready: true }] };
    if (statement.includes("SELECT o.id::text owner_id")) {
      events.push("read-ready"); return { rows: [{ owner_id: ownerId }] };
    }
    if (statement.includes("finish_signal_interest_decision_v2")) {
      events.push("finish-owner"); return { rows: [{ result: { owner_id: ownerId, completed: true } }] };
    }
    if (statement.includes("SELECT execution.id::text execution_id")) {
      events.push("read-completed"); return { rows: [{ execution_id: executionId }] };
    }
    return assert.fail("unexpected SQL");
  } };
  const queue = { getJob: async () => null, add: async (name: string) => {
    events.push(`dispatch:${name}`);
  } };
  const result = await drainSignalWorkspaceInterestDecisionMaterializationsV2({
    env: { NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED: "true",
      NOISIA_SIGNAL_INTEREST_DECISION_MATERIALIZATION_ENABLED: "true" },
    database: database as never, queue: queue as never });
  assert.deepEqual(result, { disabled: false, schema_ready: true, dispatched: 1 });
  assert.deepEqual(events, ["read-ready", "finish-owner", "read-completed",
    "dispatch:signal-workspace-interest-decision-materialization-v2"]);
});
