import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { startDefinedInterestDecisionProductV1 } from "./signal-defined-interest-decision";

const id = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const source = "00000000-0000-4000-8000-000000000003";
const execution = "00000000-0000-4000-8000-000000000004";
const owner = "00000000-0000-4000-8000-000000000005";

test("a lost response replays the paid receipt even when the current corpus changed", async () => {
  const statements: string[] = [];
  let released = false;
  const client = { async query(text: string, params?: unknown[]) {
    statements.push(text);
    if (text.includes("FROM signal_interest_decision_request_keys_v1")) return { rows: [{
      generation_id: generation, source_execution_id: source, execution_id: execution, term_key: "consent" }] };
    if (text.includes("SELECT request_signal_interest_decision_v1")) {
      assert.deepEqual(params, [id, id, generation, source, "request-12345678"]);
      return { rows: [{ result: { owner_id: owner, generation_id: generation,
        expected_roots: 43159, replayed: true } }] };
    }
    return { rows: [] };
  }, release() { released = true; } } as unknown as PoolClient;
  const database = { async connect() { return client; } } as unknown as Pick<Pool, "connect">;
  const result = await startDefinedInterestDecisionProductV1({
    workspace_id: id, actor_user_id: id, term_key: "consent" }, "request-12345678", database);
  assert.deepEqual(result, { owner_id: owner, generation_id: generation,
    expected_roots: 43159, replayed: true, execution_id: execution });
  assert.equal(statements.at(-1), "COMMIT");
  assert.equal(statements.some(sql => sql.includes("tagging_model_versions") || sql.includes("loadSignalWorkspace")), false);
  assert.equal(released, true);
});

test("a key for another interest cannot be reused or create another generation", async () => {
  const statements: string[] = [];
  let released = false;
  const client = { async query(text: string) {
    statements.push(text);
    if (text.includes("FROM signal_interest_decision_request_keys_v1")) return { rows: [{
      generation_id: generation, source_execution_id: source, execution_id: execution, term_key: "other" }] };
    return { rows: [] };
  }, release() { released = true; } } as unknown as PoolClient;
  const database = { async connect() { return client; } } as unknown as Pick<Pool, "connect">;
  await assert.rejects(startDefinedInterestDecisionProductV1({
    workspace_id: id, actor_user_id: id, term_key: "consent" }, "request-12345678", database),
  /processing_idempotency_conflict/u);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.some(sql => sql.includes("SELECT request_signal_interest_decision_v1")), false);
  assert.equal(released, true);
});
