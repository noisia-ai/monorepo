import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drainSignalWorkspaceInterestDecisionRetriesV2 } from "./signal-workspace-interest-decision-retry-runtime-v2";

const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED: "true",
  NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED: "true",
  NOISIA_SIGNAL_INTEREST_DECISION_BATCH_PROVIDER_ENABLED: "true" };

test("V2 retry stays off without the V2 feature flag", async () => {
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionRetriesV2({ env: {},
    database: { connect: async () => assert.fail("disabled retry must not connect") } as never }),
  { disabled: true, schema_ready: false, prepared: 0 });
});

test("retry prepares the same sealed request only after a terminal known failure", async () => {
  const ownerId = randomUUID(), actorId = randomUUID(), pageId = randomUUID();
  const callId = randomUUID(), requestDigest = `sha256:${"a".repeat(64)}`;
  const sql: string[] = [], params: unknown[][] = [];
  const database = { connect: async () => ({
    query: async (statement: string, values: unknown[] = []) => {
      sql.push(statement); params.push(values);
      if (statement.includes("to_regprocedure")) return { rows: [{ ready: true }] };
      if (statement.includes("JOIN LATERAL")) return { rows: [{ owner_id: ownerId,
        actor_user_id: actorId, page_id: pageId, request_digest: requestDigest,
        prior_call_id: callId, attempt_index: 1 }] };
      if (statement.includes("renew_signal_interest_decision_admission_v2"))
        return { rows: [{ result: { admission_id: randomUUID() } }] };
      if (statement.includes("prepare_signal_interest_decision_batch_v2"))
        return { rows: [{ result: { batch_id: randomUUID(), replayed: false } }] };
      return { rows: [] };
    }, release() {},
  }) };
  const result = await drainSignalWorkspaceInterestDecisionRetriesV2({ env: enabled,
    database: database as never });
  assert.deepEqual(result, { disabled: false, schema_ready: true, prepared: 1 });
  const selector = sql.find(statement => statement.includes("JOIN LATERAL"))!;
  assert.match(selector, /c\.attempt_index<5/u);
  assert.match(selector, /b\.state IN \('applied','rejected'\)/u);
  assert.match(selector, /c\.status='definitely_not_sent'/u);
  assert.match(selector, /c\.validation_status IN \('invalid_output','refusal','max_tokens','invalid_message'\)/u);
  assert.match(selector, /NOT EXISTS \(SELECT 1 FROM signal_interest_decision_root_evidence_v1/u);
  const preparedAt = sql.findIndex(statement => statement.includes("SELECT prepare_signal_interest_decision_batch_v2"));
  assert.ok(sql.findIndex(statement => statement.includes("SELECT renew_signal_interest_decision_admission_v2")) < preparedAt);
  assert.deepEqual(params[preparedAt]!.slice(0, 3), [ownerId, pageId, [requestDigest]]);
  assert.match(String(params[preparedAt]![3]), /^interest-decision-retry:[0-9a-f-]{36}:[0-9a-f]{32}$/u);
});
