import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { definedInterestDecisionV2Enabled, startDefinedInterestDecisionProductV2,
  startDefinedInterestDecisionSelfServiceV2 } from "./signal-defined-interest-decision-v2";

const id = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const source = "00000000-0000-4000-8000-000000000003";
const execution = "00000000-0000-4000-8000-000000000004";
const owner = "00000000-0000-4000-8000-000000000005";
const scope = { workspace_id: id, actor_user_id: id, term_key: "consent" };
const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED: "true" };

test("V2 entry is off by default before DB or bootstrap access", async () => {
  assert.equal(definedInterestDecisionV2Enabled({}), false);
  assert.equal(definedInterestDecisionV2Enabled(enabled), true);
  const database = { connect: async () => assert.fail("disabled V2 opened DB") } as unknown as Pool;
  await assert.rejects(startDefinedInterestDecisionProductV2(scope, "request-12345678", database, {}),
    /interest_decision_v2_unavailable/u);
  await assert.rejects(startDefinedInterestDecisionSelfServiceV2(scope, "request-12345678", {
    database, env: {}, bootstrap: async () => assert.fail("disabled V2 bootstrapped model"),
    attempt: async () => assert.fail("disabled V2 attempted admission"),
  }), /interest_decision_v2_unavailable/u);
});

test("ambiguous V2 start replays the original admission before current source or bootstrap", async () => {
  const statements: string[] = [];
  const client = { async query(sql: string, params?: unknown[]) {
    statements.push(sql);
    if (sql.includes("FROM signal_interest_decision_request_keys_v1")) return { rows: [{
      generation_id: generation, source_execution_id: source, execution_id: execution,
      term_key: "consent", provider_contract_version: 2 }] };
    if (sql.includes("SELECT request_signal_interest_decision_v2")) {
      assert.deepEqual(params, [id,id,generation,source,"request-12345678"]);
      return { rows: [{ result: { owner_id: owner, generation_id: generation,
        expected_roots: 43159, replayed: true } }] };
    }
    return { rows: [] };
  }, release() {} } as unknown as PoolClient;
  const database = { connect: async () => client } as unknown as Pick<Pool, "connect">;
  assert.deepEqual(await startDefinedInterestDecisionProductV2(scope, "request-12345678", database, enabled),
    { owner_id: owner, generation_id: generation, expected_roots: 43159,
      replayed: true, execution_id: execution });
  assert.equal(statements.at(-1), "COMMIT");
  assert.equal(statements.some(sql => sql.includes("tagging_model_versions")), false);
  assert.equal(statements.some(sql => sql.includes("request_signal_interest_decision_v1")), false);
});

test("V1 historical paid key replays through V1 admission under the V2 flag", async () => {
  const statements: string[] = [];
  const client = { async query(sql: string) {
    statements.push(sql);
    if (sql.includes("FROM signal_interest_decision_request_keys_v1")) return { rows: [{
      generation_id: generation, source_execution_id: source, execution_id: execution,
      term_key: "consent", provider_contract_version: 1 }] };
    if (sql.includes("SELECT request_signal_interest_decision_v1")) return { rows: [{ result: {
      owner_id: owner, generation_id: generation, expected_roots: 43159, replayed: true } }] };
    return { rows: [] };
  }, release() {} } as unknown as PoolClient;
  const database = { connect: async () => client } as unknown as Pick<Pool, "connect">;
  const result = await startDefinedInterestDecisionProductV2(scope, "request-12345678", database, enabled);
  assert.equal(result.owner_id, owner);
  assert.equal(result.replayed, true);
  assert.equal(statements.some(sql => sql.includes("request_signal_interest_decision_v2")), false);
});

test("V1 bootstrap key without paid owner fences V2 admission", async () => {
  const statements: string[] = [];
  const hash = `sha256:${"0".repeat(64)}`;
  const identity = { contract_version: "signal-workspace-classification-v1",
    workspace_id: id, engine_key: "interest_decision", engine_version: 1,
    engine_artifact_digest: hash, embedding_config_digest: hash,
    catalog_digest: hash, compiler_digest: hash, context_digest: hash,
    decision_policy_digest: hash };
  const client = { async query(sql: string) {
    statements.push(sql);
    if (sql.includes("FROM signal_interest_decision_model_bootstrap_keys_v1 key")) return { rows: [{
      interest_term_key: "consent", identity }] };
    return { rows: [] };
  }, release() {} } as unknown as PoolClient;
  const database = { connect: async () => client } as unknown as Pick<Pool, "connect">;
  await assert.rejects(startDefinedInterestDecisionProductV2(scope, "request-12345678", database, enabled),
    /interest_decision_v1_bootstrap_replay_required/u);
  assert.equal(statements.some(sql => sql.includes("request_signal_interest_decision_v2")), false);
  assert.equal(statements.at(-1), "ROLLBACK");
});

test("V2 bootstrap happens only for missing authority and retains the same replay key", async () => {
  let attempts = 0, bootstraps = 0;
  const database = { connect: async () => assert.fail("mock attempt must own DB") } as unknown as Pool;
  const result = await startDefinedInterestDecisionSelfServiceV2(scope, "request-12345678", {
    database, env: enabled,
    attempt: async (_scope, key, pool, environment) => {
      assert.equal(key, "request-12345678"); assert.equal(pool, database);
      assert.equal(environment, enabled);
      return ++attempts === 1 ? Promise.reject(new Error("interest_decision_model_authority_required"))
        : { owner_id: owner, generation_id: generation, execution_id: execution,
          expected_roots: 43159, replayed: false };
    },
    bootstrap: async input => { bootstraps++; assert.equal(input.database, database);
      return { model_version_id: id, prepublication_receipt_id: id, approval_policy_id: id,
        replayed: false }; },
  });
  assert.equal(result.owner_id, owner);
  assert.equal(attempts, 2);
  assert.equal(bootstraps, 1);
});

test("historical V1 bootstrap key delegates to V1 self-service without V2 registration", async () => {
  const database = { connect: async () => assert.fail("mock attempt owns DB") } as unknown as Pool;
  let attempts = 0, legacy = 0;
  const receipt = { owner_id: owner, generation_id: generation, execution_id: execution,
    expected_roots: 43159, replayed: true };
  const result = await startDefinedInterestDecisionSelfServiceV2(scope, "request-12345678", {
    database, env: enabled,
    attempt: async () => { attempts++; throw new Error("interest_decision_model_authority_required"); },
    bootstrap: async () => { throw new Error("interest_decision_v1_bootstrap_replay_required"); },
    legacy: async (legacyScope, key, options) => {
      legacy++; assert.deepEqual(legacyScope, scope); assert.equal(key, "request-12345678");
      assert.equal(options?.database, database); return receipt;
    },
  });
  assert.deepEqual(result, receipt);
  assert.equal(attempts, 1);
  assert.equal(legacy, 1);
});
