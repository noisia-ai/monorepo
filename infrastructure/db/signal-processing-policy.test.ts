import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { admitSignalProcessingWithClientV1, readSignalProcessingPolicyWithQueryableV1,
  loadSignalProcessingPolicyV1, SignalProcessingPolicyError, type SignalProcessingAdmitArgsV1 } from "./signal-processing-policy";

const workspace = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const target = "00000000-0000-4000-8000-000000000003";
const digest = `sha256:${"a".repeat(64)}`;
const authority = { workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "admin", organization_status: "active", brand_same_organization: true };
const policy = { id: target, version: "1", status: "active", policy_digest: digest, valid_from: "2026-09-11T00:00:00Z",
  valid_until: "2026-09-12T00:00:00Z", budget_timezone: "America/Mexico_City", daily_cap_micro_usd: "1000",
  budget_date: "2026-09-11", current: true, exposure: { confirmed_micro_usd: "100", reserved_micro_usd: "200",
    ambiguous_micro_usd: "300", total_micro_usd: "600" }, actions: [
    { action: "corpus_preparation", kind: "free", provider: null, model: null, configuration_digest: digest, max_execution_micro_usd: "0", automatic_allowed: false },
    { action: "corpus_embeddings", kind: "provider", provider: "voyage", model: "voyage-4-large", configuration_digest: digest, max_execution_micro_usd: "700", automatic_allowed: false }] };
function reader(row: unknown = policy, overrides = {}) {
  const queries: string[] = [];
  const queryable = { async query(sql: string, values?: unknown[]) {
    queries.push(sql);
    if (sql.includes("grant_access.access_level")) { assert.deepEqual(values, [workspace, actor]); return { rows: [{ ...authority, ...overrides }] }; }
    assert.match(sql, /signal_processing_org_exposure_v1\(w.organization_id/u);
    assert.match(sql, /policy.organization_id=w.organization_id/u);
    assert.deepEqual(values, [workspace]); return { rows: row ? [row] : [] };
  } } as Parameters<typeof readSignalProcessingPolicyWithQueryableV1>[0]["queryable"];
  return { queryable, queries };
}
test("policy reads derive tenant and count each exposure category once; no provider activation", async () => {
  const { queryable, queries } = reader();
  const result = await readSignalProcessingPolicyWithQueryableV1({ queryable, workspace_id: workspace, actor_user_id: actor });
  assert.equal(result.remaining_micro_usd, "400"); assert.equal(result.status, "provider_unavailable");
  assert.equal(result.actions[0]?.available, true); assert.equal(result.actions[1]?.available, false);
  assert.equal(result.can_request_processing, true);
  assert.equal(queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/u.test(sql)), false);
});
test("available provider only changes availability, never policy money or scope", async () => {
  const result = await readSignalProcessingPolicyWithQueryableV1({ ...reader(), workspace_id: workspace, actor_user_id: actor,
    action_availability: { corpus_embeddings: true } });
  assert.equal(result.status, "ready"); assert.equal(result.remaining_micro_usd, "400");
  assert.equal(result.actions[1]?.available, true); assert.equal(result.actions[1]?.max_execution_micro_usd, "700");
});
test("missing, expired, revoked and exhausted policies preserve read state and free action semantics", async () => {
  for (const [row, state] of [[null, "missing"], [{ ...policy, current: false }, "expired"],
    [{ ...policy, status: "revoked", current: false }, "revoked"],
    [{ ...policy, exposure: { ...policy.exposure, total_micro_usd: "1200" } }, "daily_cap_exhausted"]] as const) {
    const result = await readSignalProcessingPolicyWithQueryableV1({ ...reader(row), workspace_id: workspace, actor_user_id: actor,
      action_availability: { corpus_embeddings: true } });
    assert.equal(result.status, state); assert.equal(result.actions.some(a => a.kind === "provider" && a.available), false);
    if (state === "daily_cap_exhausted") { assert.equal(result.remaining_micro_usd, "0"); assert.equal(result.actions[0]?.available, true); }
  }
});
test("read grant cannot become execution request and foreign tenant cannot read exposure", async () => {
  const read = await readSignalProcessingPolicyWithQueryableV1({ ...reader(policy, { brand_access_level: "read" }),
    workspace_id: workspace, actor_user_id: actor, action_availability: { corpus_embeddings: true } });
  assert.equal(read.can_request_processing, false); assert.equal(read.actions.some(a => a.available), false);
  const denied = reader(policy, { same_organization: false });
  await assert.rejects(readSignalProcessingPolicyWithQueryableV1({ ...denied, workspace_id: workspace, actor_user_id: actor }),
    (error: unknown) => error instanceof SignalProcessingPolicyError && error.status === 403);
  assert.equal(denied.queries.length, 1);
});
const request: SignalProcessingAdmitArgsV1 = { workspace_id: workspace, actor_user_id: actor, action: "corpus_embeddings",
  target_id: target, idempotency_key: "test-request-1", request_digest: digest, execution_cap_micro_usd: "300" };
test("admission delegates the exact quote and idempotency to SQL inside caller transaction", async () => {
  const client = { async query(sql: string, params: unknown[]) {
    assert.match(sql, /^SELECT admit_signal_processing_v1/u);
    assert.deepEqual(params, [workspace, actor, "corpus_embeddings", target, "test-request-1", digest, "300", false]);
    return { rows: [{ result: { replayed: true, receipt: { id: target, execution_cap_micro_usd: 300 } } }] };
  } } as unknown as PoolClient;
  const result = await admitSignalProcessingWithClientV1(client, request);
  assert.equal(result.replayed, true); assert.equal(result.receipt.execution_cap_micro_usd, "300");
});
test("invalid action or cap never reaches SQL; SQL guard failures stay typed", async () => {
  let calls = 0;
  const client = { async query() { calls++; throw new Error("processing_daily_cap_exhausted"); } } as unknown as PoolClient;
  for (const execution_cap_micro_usd of ["-1", "1.5", "01", "9999999999999999"]) await assert.rejects(
    admitSignalProcessingWithClientV1(client, { ...request, execution_cap_micro_usd }), { status: 400 });
  assert.equal(calls, 0);
  await assert.rejects(admitSignalProcessingWithClientV1(client, request), { code: "processing_daily_cap_exhausted", status: 409 });
});
test("public reader transaction is read-only, releases on success and rolls back on auth failure", async () => {
  for (const denied of [false, true]) {
    const statements: string[] = []; const local = reader(policy, denied ? { same_organization: false } : {});
    const database = { async connect() { return { async query(sql: string, values?: unknown[]) {
      statements.push(sql); if (/^(BEGIN|COMMIT|ROLLBACK)/u.test(sql)) return { rows: [] };
      return local.queryable.query(sql, values);
    }, release() { statements.push("release"); } }; } } as unknown as Parameters<typeof loadSignalProcessingPolicyV1>[0]["database"];
    const promise = loadSignalProcessingPolicyV1({ database, workspace_id: workspace, actor_user_id: actor });
    if (denied) await assert.rejects(promise); else await promise;
    assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.deepEqual(statements.slice(-2), [denied ? "ROLLBACK" : "COMMIT", "release"]);
  }
});
test("DDL retains specialized guards and excludes release/no-send from capacity without creating money tables", () => {
  const sql = readFileSync(new URL("./migrations/0155_signal_processing_policy.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION (?:guard_workspace_engine|guard_signal_workspace_embedding|validate_signal_brand_context)/u);
  assert.match(sql, /r.status<>'released'/u); assert.match(sql, /c.status<>'definitely_not_sent'/u);
  assert.match(sql, /c.call_state='settled' THEN 'confirmed'/u);
  assert.doesNotMatch(sql, /IN\('settled','terminal_confirmed'\) THEN 'confirmed'/u);
  assert.match(sql, /processing_budget_timezone_immutable/u); assert.match(sql, /processing_admission_binding_immutable/u);
  assert.match(sql, /configuration_digest IS DISTINCT FROM signal_semantic_context_digest_json_v2/u);
  assert.equal((sql.match(/CREATE TABLE /gu) ?? []).length, 3);
});

test("one enabled Claude action cannot enable another Claude action", async () => {
  const row = { ...policy, actions: ["brand_context_proposal", "topic_interpretation"].map(action => ({
    action, kind: "provider", provider: "anthropic", model: "claude-sonnet-4-6", configuration_digest: digest,
    max_execution_micro_usd: "700", automatic_allowed: false })) };
  const result = await readSignalProcessingPolicyWithQueryableV1({ ...reader(row), workspace_id: workspace, actor_user_id: actor,
    action_availability: { brand_context_proposal: true } });
  assert.equal(result.actions.find(action => action.action === "brand_context_proposal")?.available, true);
  assert.equal(result.actions.find(action => action.action === "topic_interpretation")?.available, false);
});
test("monetary org is assigned at insertion, retained on updates and used independently of current workspace tenant", () => {
  const sql = readFileSync(new URL("./migrations/0155_signal_processing_policy.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/ADD COLUMN processing_organization_id uuid/gu) ?? []).length, 3);
  assert.match(sql, /SELECT organization_id INTO NEW.processing_organization_id FROM signal_workspaces/u);
  assert.match(sql, /NEW.processing_organization_id IS DISTINCT FROM OLD.processing_organization_id/u);
  assert.equal((sql.match(/COALESCE\([rc].processing_organization_id,w.organization_id\)=target_org/gu) ?? []).length, 3);
  assert.match(sql, /reservation_org IS NOT NULL AND reservation_org IS DISTINCT FROM/u);
  assert.match(sql, /reserved_at,processing_organization_id INTO entry_id,amount,stamp,reservation_org/u);
  assert.doesNotMatch(sql, /UPDATE (?:engine_cost_events|signal_workspace_embedding_calls|signal_semantic_context_budget_reservations) SET processing_organization_id/u);
});

test("all policy functions revoke PostgreSQL default PUBLIC execution and anonymous application roles", () => {
  const sql = readFileSync(new URL("./migrations/0155_signal_processing_policy.sql", import.meta.url), "utf8");
  const defined = [...sql.matchAll(/^CREATE FUNCTION ([a-z0-9_]+)\(/gmu)].map(match => match[1]).sort();
  const revoked = [...sql.matchAll(/^REVOKE ALL ON FUNCTION ([a-z0-9_]+)\([^;]*\) FROM PUBLIC;/gmu)].map(match => match[1]).sort();
  assert.equal(defined.length, 13); assert.deepEqual(revoked, defined);
  const roleLoop = sql.slice(sql.lastIndexOf("DO $$ DECLARE role_name text; function_identity text;"));
  assert.match(roleLoop, /ARRAY\['anon','authenticated'\]/u);
  for (const name of defined) assert.ok(roleLoop.includes(`'${name}(`));
  assert.match(roleLoop, /REVOKE ALL ON FUNCTION %s FROM %I/u);
  assert.doesNotMatch(sql, /GRANT .* ON FUNCTION/u);
});

test("Drizzle policy schema retains cross-tenant and action composite constraints", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const { signalProcessingPolicyVersions: versions, signalProcessingAdmissions: admissions,
    signalSemanticContextProposalRuns: runs } = await import("./schema/index");
  const policyConfig = getTableConfig(versions);
  assert.ok(policyConfig.uniqueConstraints.some(constraint => constraint.columns.map(column => column.name).join() === "organization_id,id"));
  const active = policyConfig.indexes.find(index => index.config.name === "uq_signal_processing_policy_active");
  assert.equal(active?.config.unique, true); assert.ok(active?.config.where);
  const admissionConfig = getTableConfig(admissions);
  const fks = admissionConfig.foreignKeys.map(fk => fk.reference().columns.map(column => column.name).join());
  assert.ok(fks.includes("organization_id,policy_version_id")); assert.ok(fks.includes("policy_version_id,action"));
  assert.ok(admissionConfig.uniqueConstraints.some(constraint => constraint.columns.map(column => column.name).join() === "workspace_id,id"));
  assert.ok(admissionConfig.uniqueConstraints.some(constraint => constraint.columns.map(column => column.name).join() === "workspace_id,actor_user_id,idempotency_key"));
  assert.ok(getTableConfig(runs).foreignKeys.some(fk => fk.reference().columns[0]?.name === "processing_admission_id"));
});

test("the free corpus exception is fenced independently and never opens provider or general owner authority", () => {
  const sql = readFileSync(new URL("./migrations/0155_signal_processing_policy.sql", import.meta.url), "utf8");
  const helper = sql.split("CREATE FUNCTION signal_processing_lock_corpus_actor_v1")[1]?.split("CREATE FUNCTION signal_processing_owner_guard_v1")[0] ?? "";
  assert.match(helper, /FOR SHARE OF u,w,b,o/u); assert.match(helper, /ORDER BY a.id FOR SHARE OF a/u);
  assert.match(helper, /IN\('client_admin','brand_manager','client_owner'\)/u);
  assert.match(helper, /a.access_level IN\('comment','admin'\)/u);
  for (const invariant of ["o.status='active'", "u.organization_id=w.organization_id", "b.organization_id=w.organization_id", "a.revoked_at IS NULL"])
    assert.ok(helper.includes(invariant));
  assert.doesNotMatch(helper, /processing_admissions|signal_processing_lock_actor_v1|provider|cost_events/u);
  const owner = sql.split("CREATE FUNCTION signal_processing_owner_guard_v1")[1]?.split("CREATE TRIGGER aaa_processing_owner")[0] ?? "";
  assert.match(owner, /TG_TABLE_NAME='signal_corpus_preparation_runs' AND NEW.processing_admission_id IS NULL/u);
  assert.match(owner, /NEW.status='running' AND \(OLD.status<>'running' OR NEW.execution_token IS DISTINCT FROM OLD.execution_token/u);
  assert.match(owner, /OR NEW.execution_expires_at IS DISTINCT FROM OLD.execution_expires_at\)\)/u);
  assert.doesNotMatch(owner, /NEW.status IN\('queued','running'\)/u);
  assert.match(owner, /NEW.request_keys IS DISTINCT FROM OLD.request_keys/u);
  assert.match(owner, /jsonb_each_text\(NEW.request_keys\) entry WHERE NOT OLD.request_keys \? entry.key/u);
  assert.match(owner, /signal_processing_lock_corpus_actor_v1\(NEW.workspace_id,request_actor::uuid\)/u);
});

test("every new modeled check and foreign key has the same explicit SQL identity below PostgreSQL's name limit", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const schema = await import("./schema/index");
  const sql = ["0155_signal_processing_policy.sql", "0175_signal_topic_consolidation_control.sql"]
    .map(file => readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8")).join("\n");
  for (const table of [schema.signalProcessingPolicyVersions, schema.signalProcessingPolicyActions, schema.signalProcessingAdmissions]) {
    const config = getTableConfig(table);
    const names = [...config.checks.map(check => check.name), ...config.foreignKeys.map(fk => fk.getName()),
      ...config.uniqueConstraints.map(unique => unique.name), ...config.primaryKeys.map(pk => pk.getName())];
    for (const name of names) {
      assert.ok(name && name.length <= 63, String(name));
      assert.ok(sql.includes(`CONSTRAINT ${name} `), String(name));
    }
  }
  for (const table of [schema.engineCostEvents, schema.signalSemanticContextBudgetReservations, schema.signalSemanticContextProposalRuns]) {
    for (const fk of getTableConfig(table).foreignKeys.filter(fk => fk.reference().columns.some(column => column.name.startsWith("processing_")))) {
      assert.ok(fk.getName().length <= 63); assert.ok(sql.includes(`CONSTRAINT ${fk.getName()} `));
    }
  }
});
