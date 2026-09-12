import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { requestWorkspaceTopicConsolidationForActorV1 } from "./signal-topic-consolidation-control";
import { submitWorkspaceTopicConsolidationIntentV1, workspaceTopicConsolidationIntentV1,
  validWorkspaceTopicConsolidationReceiptV1, type WorkspaceTopicConsolidationReceiptV1 } from "./workspace-topic-consolidation-request";
const workspace = "00000000-0000-4000-8000-000000000001", execution = "00000000-0000-4000-8000-000000000002";
const body = { action: "retry_numeric" as const, execution_id: execution };
const receipt: WorkspaceTopicConsolidationReceiptV1 = { contract_version: "signal-topic-consolidation-request-receipt-v1",
  workspace_id: workspace, action: "retry_numeric", execution_id: execution, idempotency_key: "same-intent-request", replayed: false };

test("lost HTTP response after retry COMMIT replays the same key without a second mutation or status read", async () => {
  const keys: string[] = []; let writes = 0, requests = 0, allocated = 0;
  const database = { connect: async () => ({ query: async (sql: string, values?: unknown[]) => {
    if (sql.includes("retry_signal_topic_consolidation_v1")) {
      const key = String(values?.[3]); const replayed = keys.includes(key); keys.push(key); if (!replayed) writes++;
      return { rows: [{ value: { execution_id: execution, worker_job_id: `topic-consolidation-${execution}-8`, replayed } }] };
    }
    assert.equal(sql.includes("signal_topic_consolidation_status_v1"), false); return { rows: [] };
  }, release: () => {} } as unknown as PoolClient) } satisfies Pick<Pool, "connect">;
  const fetcher: typeof fetch = async (_url, options) => {
    const result = await requestWorkspaceTopicConsolidationForActorV1({ database, workspaceId: workspace, actorUserId: workspace,
      idempotencyKey: new Headers(options?.headers).get("Idempotency-Key")!, body: JSON.parse(String(options?.body)) });
    if (++requests === 1) throw new Error("response lost after commit");
    return Response.json(result, { status: 202 });
  };
  const createKey = () => { allocated++; return receipt.idempotency_key; };
  const initial = workspaceTopicConsolidationIntentV1({ workspace_id: workspace, body, previous: null, createKey });
  await assert.rejects(submitWorkspaceTopicConsolidationIntentV1({ intent: initial, fetcher }), /response lost/u);
  const replay = workspaceTopicConsolidationIntentV1({ workspace_id: workspace, body: { ...body }, previous: initial, createKey });
  assert.equal(replay, initial);
  assert.equal((await submitWorkspaceTopicConsolidationIntentV1({ intent: replay, fetcher })).replayed, true);
  assert.equal(writes, 1); assert.equal(allocated, 1); assert.deepEqual(keys, [receipt.idempotency_key, receipt.idempotency_key]);
});
test("rotating a visible prepare quote cannot change an uncertain sealed request", () => {
  const prepare = { action: "prepare_numeric" as const, source_execution_id: execution, quote_reference: `v1.1789000000.${"a".repeat(64)}` };
  const initial = workspaceTopicConsolidationIntentV1({ workspace_id: workspace, body: prepare, previous: null, createKey: () => "prepare-key-one" });
  const next = workspaceTopicConsolidationIntentV1({ workspace_id: workspace, body: { ...prepare, quote_reference: `v1.1789000001.${"b".repeat(64)}` },
    previous: initial, createKey: () => assert.fail("must retain original intent") });
  assert.equal(next, initial); assert.deepEqual(next.body, prepare);
});
test("receipts bind workspace, action, execution and exact request key; a different workspace gets a fresh intent", () => {
  const initial = workspaceTopicConsolidationIntentV1({ workspace_id: workspace, body, previous: null, createKey: () => receipt.idempotency_key });
  assert.equal(validWorkspaceTopicConsolidationReceiptV1(receipt, initial), true);
  for (const patch of [{ workspace_id: execution }, { action: "prepare_numeric" }, { execution_id: workspace },
    { idempotency_key: "different-key" }, { replayed: "true" }, { provider_execution_enabled: true }])
    assert.equal(validWorkspaceTopicConsolidationReceiptV1({ ...receipt, ...patch }, initial), false);
  const changed = workspaceTopicConsolidationIntentV1({ workspace_id: execution, body, previous: initial, createKey: () => "different-workspace-key" });
  assert.notEqual(changed, initial); assert.equal(changed.key, "different-workspace-key");
});
test("a committed receipt is returned without coupling acceptance to any later GET failure", async () => {
  const intent = workspaceTopicConsolidationIntentV1({ workspace_id: workspace, body, previous: null, createKey: () => receipt.idempotency_key });
  const calls: string[] = [];
  const fetcher: typeof fetch = async (_url, options) => { calls.push(String(options?.method)); return Response.json(receipt, { status: 202 }); };
  assert.deepEqual(await submitWorkspaceTopicConsolidationIntentV1({ intent, fetcher }), receipt);
  await assert.rejects(Promise.reject(new Error("independent status timeout")), /status timeout/u);
  assert.deepEqual(calls, ["POST"]);
});
