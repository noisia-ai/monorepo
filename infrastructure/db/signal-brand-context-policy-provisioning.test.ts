import assert from "node:assert/strict";
import test from "node:test";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { provisionSignalBrandContextPolicyV1 } from "./signal-brand-context-policy-provisioning";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = {
  NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID: id(6),
  NOISIA_BRAND_CONTEXT_POLICY_DAILY_CAP_MICRO_USD: "1100000",
  NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL: "2099-01-01T00:00:00Z",
  NOISIA_SEMANTIC_CONTEXT_MODEL: "claude-sonnet-4-6", NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION: "claude-sonnet-4-6",
  NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION: "synthetic-v1", NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS: "20000",
  NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS: "64000", NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS: "3",
  NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS: "15", NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD: "1000000",
  NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD: "100000"
};
type Options = { role?: string; userType?: string; actorActive?: boolean; scopeValid?: boolean; sameOrganization?: boolean; sealedCreatorMatches?: boolean;
  grantLevel?: string; grantRevoked?: boolean; creatorType?: string; creatorRole?: string; creatorActive?: boolean; creatorMissing?: boolean;
  history?: string[]; deadlineValid?: boolean; timezoneValid?: boolean; configurationValid?: boolean; failActions?: boolean };
function fixture(options: Options = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let state = [...(options.history ?? [])], previous = [...state], releases = 0;
  const database = { async connect() { return { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    assert.doesNotMatch(sql, /signal_processing_admissions|proposal_runs|budget_reservations|outbox|embedding_calls/iu);
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) user_brand_access/iu);
    if (sql.startsWith("BEGIN")) previous = [...state];
    if (sql === "ROLLBACK") state = previous;
    if (sql.includes("SELECT organization_id")) return { rows: [{ organization_id: id(3) }] };
    if (sql.includes("FOR SHARE OF w,b,o,u")) {
      assert.match(sql, /w\.organization_id=\$4::uuid/u);
      assert.match(sql, /b\.organization_id=w\.organization_id/u);
      assert.match(sql, /w\.metadata->>'created_by_user_id'=u\.id::text/u);
      assert.match(sql, /w\.status='active' AND b\.status='active' AND o\.status='active' AND u\.status='active'/u);
      assert.match(sql, /FOR SHARE OF w,b,o,u NOWAIT/u);
      assert.deepEqual(values, [id(1), id(2), id(4), id(3)]);
      assert.match(sql, /u\.user_type='client' AND u\.primary_role='client_admin' AND u\.organization_id=w\.organization_id/u);
      const userType = options.userType ?? "client";
      const allowed = options.scopeValid !== false && options.actorActive !== false && options.sealedCreatorMatches !== false
        && (userType === "noisia_internal"
          ? ["noisia_admin", "founder", "admin", "analyst", "kam", "insights_manager", "ux_data_specialist"].includes(options.role ?? "noisia_admin")
          : userType === "client" && (options.role ?? "client_admin") === "client_admin" && options.sameOrganization !== false);
      return { rows: allowed ? [{ timezone: "Asia/Tokyo", user_type: userType }] : [] };
    }
    if (sql.includes("FROM user_brand_access")) {
      assert.match(sql, /access_level='admin' AND revoked_at IS NULL/u);
      assert.match(sql, /FOR SHARE NOWAIT/u); assert.deepEqual(values, [id(2), id(4)]);
      return { rows: options.grantRevoked || (options.grantLevel ?? "admin") !== "admin" ? [] : [{ id: id(7) }] };
    }
    if (sql.includes("SELECT id FROM users")) {
      assert.match(sql, /status='active' AND user_type='noisia_internal'/u);
      assert.match(sql, /primary_role IN\('noisia_admin','founder','admin'\)/u);
      assert.match(sql, /FOR SHARE NOWAIT/u); assert.deepEqual(values, [id(6)]);
      const valid = !options.creatorMissing && options.creatorActive !== false && (options.creatorType ?? "noisia_internal") === "noisia_internal"
        && ["noisia_admin", "founder", "admin"].includes(options.creatorRole ?? "noisia_admin");
      return { rows: valid ? [{ id: id(6) }] : [] };
    }
    if (sql.includes("SELECT status FROM signal_processing_policy_versions")) return { rows: state.map(status => ({ status })) };
    if (sql.includes("pg_timezone_names")) return { rows: [{ deadline_valid: options.deadlineValid ?? true,
      timezone_valid: options.timezoneValid ?? true, configuration_valid: options.configurationValid ?? true }] };
    if (sql.startsWith("INSERT INTO signal_processing_policy_versions")) { state.push("draft"); return { rows: [{ id: id(5) }] }; }
    if (sql.startsWith("INSERT INTO signal_processing_policy_actions") && options.failActions) throw new Error("synthetic_action_failure");
    if (sql.startsWith("UPDATE signal_processing_policy_versions")) { state = ["active"]; return { rows: [{ id: id(5) }] }; }
    return { rows: [] };
  }, release() { releases++; } }; } } as unknown as Parameters<typeof provisionSignalBrandContextPolicyV1>[0]["database"];
  return { database, calls, get state() { return state; }, get releases() { return releases; } };
}
const request = { workspace_id: id(1), initiator_user_id: id(2), brand_id: id(4), env };

test("client-admin creation provisions exact policy with the configured system creator and no grant/admission/work mutation", async () => {
  const f = fixture();
  assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database })).status, "provisioned");
  const lock = f.calls.findIndex(call => call.sql.includes("pg_advisory_xact_lock"));
  assert.ok(lock > 0 && lock < f.calls.findIndex(call => call.sql.includes("FOR SHARE OF")));
  assert.deepEqual(f.calls[lock]!.values, [id(3)]);
  const policy = f.calls.find(call => call.sql.startsWith("INSERT INTO signal_processing_policy_versions"))!;
  assert.deepEqual(policy.values, [id(3), env.NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL, "Asia/Tokyo", "1100000", id(6)]);
  assert.notEqual(policy.values.at(-1), request.initiator_user_id);
  assert.ok(f.calls.findIndex(call => call.sql.includes("FROM user_brand_access")) < f.calls.indexOf(policy));
  const actions = f.calls.filter(call => call.sql.startsWith("INSERT INTO signal_processing_policy_actions"));
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map(call => [call.values[1], call.values[5], call.values[6]]), [
    ["brand_context_proposal", "1000000", false], ["topic_prototype_embeddings", "100000", true]
  ]);
  const semantic = JSON.parse(actions[0]!.values[4] as string);
  assert.deepEqual(Object.keys(semantic).sort(), ["provider", "model", "model_version", "pricing_version", "max_input_tokens",
    "max_output_tokens", "input_usd_per_million_tokens", "output_usd_per_million_tokens"].sort());
  assert.equal(semantic.model, "claude-sonnet-4-6");
  assert.deepEqual(JSON.parse(actions[1]!.values[4] as string), SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1);
  assert.equal(f.calls.at(-1)?.sql, "COMMIT"); assert.equal(f.releases, 1);
});

test("same creation replay can recover a missing policy, and subsequent calls preserve every existing policy", async () => {
  const f = fixture();
  await provisionSignalBrandContextPolicyV1({ ...request, database: f.database });
  f.calls.length = 0;
  assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database, env: {} })).status, "existing_policy");
  assert.ok(f.calls.every(call => !/^(INSERT|UPDATE|DELETE)/u.test(call.sql)));
  for (const history of [["active"], ["draft"], ["revoked"]]) {
    const existing = fixture({ history });
    assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: existing.database })).status,
      history[0] === "active" ? "existing_policy" : "configuration_required");
    assert.deepEqual(existing.state, history);
    assert.ok(existing.calls.every(call => !/^(INSERT|UPDATE|DELETE)/u.test(call.sql)));
  }
});

test("foreign/revoked initiators, wrong roles and missing or downgraded admin grants cannot bootstrap policy", async () => {
  for (const options of [{ role: "client_viewer" }, { role: "client_owner" }, { role: "brand_manager" },
    { actorActive: false }, { scopeValid: false }, { sameOrganization: false }, { sealedCreatorMatches: false },
    { userType: "unknown" }, { userType: "noisia_internal", role: "client_admin" },
    { grantRevoked: true }, { grantRevoked: true, history: ["active"] }, { grantLevel: "comment" }, { grantLevel: "read" }]) {
    const f = fixture(options);
    assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database })).status, "not_eligible");
    assert.ok(f.calls.every(call => !/^(INSERT|UPDATE|DELETE)/u.test(call.sql)));
  }
});

test("authorized internal initiators use the same configured creator without acquiring any brand grant", async () => {
  for (const role of ["noisia_admin", "analyst"]) {
    const f = fixture({ userType: "noisia_internal", role });
    assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database })).status, "provisioned");
    assert.ok(f.calls.every(call => !call.sql.includes("FROM user_brand_access")));
    assert.equal(f.calls.find(call => call.sql.startsWith("INSERT INTO signal_processing_policy_versions"))?.values.at(-1), id(6));
  }
});

test("missing, client, revoked or non-administrative configured creators leave configuration required", async () => {
  for (const options of [{ creatorMissing: true }, { creatorType: "client" }, { creatorRole: "analyst" }, { creatorActive: false }]) {
    const f = fixture(options);
    assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database })).status, "configuration_required");
    assert.ok(f.calls.every(call => !/^(INSERT|UPDATE|DELETE)/u.test(call.sql)));
  }
});

test("missing, insufficient or malformed explicit budget/window/config leaves no policy", async () => {
  for (const changed of [{}, { ...env, NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID: "" },
    { ...env, NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID: "not-an-actor" },
    { ...env, NOISIA_BRAND_CONTEXT_POLICY_DAILY_CAP_MICRO_USD: "1099999" },
    { ...env, NOISIA_BRAND_CONTEXT_POLICY_DAILY_CAP_MICRO_USD: "1.1" },
    { ...env, NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL: "" },
    { ...env, NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL: "tomorrow" },
    { ...env, NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL: "2099-02-30T00:00:00Z" },
    { ...env, NOISIA_SEMANTIC_CONTEXT_MODEL: "other-model" },
    { ...env, NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD: "0" }]) {
    const f = fixture();
    assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database, env: changed })).status, "configuration_required");
    assert.deepEqual(f.state, []); assert.ok(f.calls.every(call => !/^(INSERT|UPDATE|DELETE)/u.test(call.sql)));
  }
  for (const options of [{ deadlineValid: false }, { timezoneValid: false }, { configurationValid: false }]) {
    const f = fixture(options);
    assert.equal((await provisionSignalBrandContextPolicyV1({ ...request, database: f.database })).status, "configuration_required");
    assert.deepEqual(f.state, []);
  }
});

test("a partial action failure rolls back the draft and remains retryable", async () => {
  const f = fixture({ failActions: true });
  await assert.rejects(provisionSignalBrandContextPolicyV1({ ...request, database: f.database }), /synthetic_action_failure/u);
  assert.deepEqual(f.state, []); assert.equal(f.calls.at(-1)?.sql, "ROLLBACK"); assert.equal(f.releases, 1);
});
