import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceTopicConsolidationCommandV1 } from "./signal-topic-consolidation-control";

const id = "00000000-0000-4000-8000-000000000001";
const quote = `v1.1789236000.${"a".repeat(64)}`;

test("accepts only the two provider-free consolidation commands", () => {
  assert.deepEqual(parseWorkspaceTopicConsolidationCommandV1({ action: "prepare_numeric",
    source_execution_id: id, quote_reference: quote }), { action: "prepare_numeric", source_execution_id: id, quote_reference: quote });
  assert.deepEqual(parseWorkspaceTopicConsolidationCommandV1({ action: "retry_numeric", execution_id: id }),
    { action: "retry_numeric", execution_id: id });
  assert.equal(parseWorkspaceTopicConsolidationCommandV1({ action: "review_with_claude", maximum_micro_usd: "20000000" }), null);
  assert.equal(parseWorkspaceTopicConsolidationCommandV1({ action: "prepare_numeric", source_execution_id: id,
    quote_reference: quote, provider_execution_enabled: true }), null);
});

test("retry returns its committed receipt even when the following status connection would fail", async () => {
  const { requestWorkspaceTopicConsolidationForActorV1 } = await import("./signal-topic-consolidation-control");
  let committed = false, connects = 0;
  const commands: string[] = [];
  const database = { connect: async () => {
    if (++connects > 1) throw new Error("status connection timeout after committed retry");
    return { query: async (sql: string, params?: unknown[]) => {
      commands.push(sql);
      if (sql.includes("retry_signal_topic_consolidation_v1")) {
        assert.deepEqual(params, [id, id, id, "same-retry-request-key"]);
        return { rows: [{ value: { execution_id: id, worker_job_id: `topic-consolidation-${id}-8`, replayed: false } }] };
      }
      if (sql === "COMMIT") committed = true;
      return { rows: [] };
    }, release: () => {} };
  } } as unknown as Pick<import("pg").Pool, "connect">;
  const receipt = await requestWorkspaceTopicConsolidationForActorV1({ database, workspaceId: id, actorUserId: id,
    idempotencyKey: "same-retry-request-key", body: { action: "retry_numeric", execution_id: id } });
  assert.equal(committed, true); assert.equal(connects, 1);
  assert.deepEqual(receipt, { contract_version: "signal-topic-consolidation-request-receipt-v1", workspace_id: id,
    action: "retry_numeric", execution_id: id, idempotency_key: "same-retry-request-key", replayed: false });
  assert.equal(commands.some(command => command.includes("signal_topic_consolidation_status_v1")), false);
});

test("revoked actor still receives a forbidden error with no receipt or status read", async () => {
  const { requestWorkspaceTopicConsolidationForActorV1 } = await import("./signal-topic-consolidation-control");
  let connects = 0; const commands: string[] = [];
  const database = { connect: async () => {
    connects++; return { query: async (sql: string) => {
      commands.push(sql); if (sql.includes("retry_signal_topic_consolidation_v1")) throw new Error("processing_forbidden");
      return { rows: [] };
    }, release: () => {} };
  } } as unknown as Pick<import("pg").Pool, "connect">;
  await assert.rejects(requestWorkspaceTopicConsolidationForActorV1({ database, workspaceId: id, actorUserId: id,
    idempotencyKey: "revoked-retry-key", body: { action: "retry_numeric", execution_id: id } }),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 403);
  assert.equal(connects, 1); assert.equal(commands.includes("COMMIT"), false); assert.ok(commands.includes("ROLLBACK"));
  assert.equal(commands.some(command => command.includes("signal_topic_consolidation_status_v1")), false);
});
