import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { SignalWorkspaceEngineError, type SignalWorkspaceEngineStatusV1 } from "@noisia/db";
import { loadWorkspaceAnalysisForActorV1, requestWorkspaceAnalysisForActorV1, validateWorkspaceAnalysisRequestV1,
  workspaceAnalysisAdmissionProviderAvailableV1, workspaceAnalysisInterpretationPolicyV1, workspaceAnalysisPreflightStateV1, workspaceAnalysisRequestScopeV1, workspaceAnalysisRunViewV1 } from "./signal-workspace-analysis";

const id = "00000000-0000-4000-8000-000000000001", hash = `sha256:${"1".repeat(64)}`;
const body = { action: "start", embedding_run_id: id, expected_context_digest: hash, expected_catalog_digest: hash, claude_cap_micro_usd: 0 };
const granted = { workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "admin" };
function authorityDatabase(authority: unknown) {
  let queries = 0;
  return { async query(_sql: string, params: unknown[]) {
    assert.equal(++queries, 1, "Denied access stops before context, run, imports or queue reads");
    assert.deepEqual(params, [id, "actor"]); return { rows: authority ? [authority] : [] };
  }, async connect() { throw new Error("Denied before transaction"); } } as unknown as Pick<Pool, "query" | "connect">;
}
test("analysis status and mutation enforce DB authority before reading corpus or execution", async () => {
  for (const authority of [null, { ...granted, workspace_status: "archived" }, { ...granted, actor_status: "suspended" },
    { ...granted, same_organization: false }, { ...granted, brand_access_level: null }]) {
    for (const action of ["load", "start", "retry", "retry_progress", "retry_numeric", "retry_incremental_delivery"]) {
      const args = { database: authorityDatabase(authority), workspaceId: id, actorUserId: "actor" };
      await assert.rejects(action === "load" ? loadWorkspaceAnalysisForActorV1(args) : requestWorkspaceAnalysisForActorV1({ ...args,
        idempotencyKey: "analysis-test-request", body: action === "start" ? body : { action, run_id: id } }),
      (error: unknown) => error instanceof SignalWorkspaceEngineError && error.status === 403);
    }
  }
});
test("import-capable client does not gain engine permission from a zero cost cap", async () => {
  await assert.rejects(requestWorkspaceAnalysisForActorV1({ database: authorityDatabase(granted), workspaceId: id,
    actorUserId: "actor", idempotencyKey: "analysis-test-request", body }),
  (error: unknown) => error instanceof SignalWorkspaceEngineError && error.status === 403);
});
test("analysis request is sealed to saved context and server engine config; retry only targets a run", () => {
  assert.equal(validateWorkspaceAnalysisRequestV1(body), true);
  assert.equal(validateWorkspaceAnalysisRequestV1({ action: "retry", run_id: id }), true);
  assert.equal(validateWorkspaceAnalysisRequestV1({ action: "retry_progress", run_id: id }), true);
  assert.equal(validateWorkspaceAnalysisRequestV1({ action: "retry_numeric", run_id: id }), true);
  assert.equal(validateWorkspaceAnalysisRequestV1({ action: "retry_numeric", run_id: id, claude_cap_micro_usd: 0 }), false);
  assert.equal(validateWorkspaceAnalysisRequestV1({ action: "retry_progress", run_id: id, claude_cap_micro_usd: 30_000_000 }), false);
  for (const value of [null, [], {}, { ...body, engine_config: { seed: 2 } }, { ...body, actor_user_id: "other" },
    { ...body, texts: ["injected"] }, { ...body, publish: true }, { ...body, claude_cap_micro_usd: "0" },
    { ...body, claude_cap_micro_usd: -1 }, { ...body, claude_cap_micro_usd: 0.5 }, { ...body, claude_cap_micro_usd: NaN },
    { ...body, expected_context_digest: "bad" }, { action: "retry", run_id: id, claude_cap_micro_usd: 0 }])
    assert.equal(validateWorkspaceAnalysisRequestV1(value), false);
});
test("disabled interpretation cannot enqueue a paid run", async () => {
  await assert.rejects(requestWorkspaceAnalysisForActorV1({ database: authorityDatabase({ ...granted,
    user_type: "noisia_internal", primary_role: "noisia_admin" }), workspaceId: id, actorUserId: "actor",
    idempotencyKey: "analysis-test-request", body: { ...body, claude_cap_micro_usd: 1 } }),
  (error: unknown) => error instanceof SignalWorkspaceEngineError && error.code === "workspace_analysis_interpretation_unavailable");
});
test("preflight distinguishes accepted files, complete preparation, embedding cache and context without requiring interests", () => {
  const inputs = { received: true, prepared: true, embeddingRunId: id, missingGuides: 0 };
  assert.equal(workspaceAnalysisPreflightStateV1(inputs), "ready");
  assert.equal(workspaceAnalysisPreflightStateV1({ ...inputs, received: false }), "awaiting_import");
  assert.equal(workspaceAnalysisPreflightStateV1({ ...inputs, prepared: false }), "needs_preparation");
  assert.equal(workspaceAnalysisPreflightStateV1({ ...inputs, embeddingRunId: null }), "missing_embeddings");
  assert.equal(workspaceAnalysisPreflightStateV1({ ...inputs, missingGuides: 3 }), "missing_context");
  assert.notEqual(workspaceAnalysisRequestScopeV1(id, "a"), workspaceAnalysisRequestScopeV1(id, "b"));
  assert.notEqual(workspaceAnalysisRequestScopeV1(id, "a"), workspaceAnalysisRequestScopeV1("other", "a"));
});
test("run view does not fabricate a Claude reservation and only exposes retry for a current transient failure", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 25, expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 25, processed_chunks: 30,
    error_code: "workspace_engine_worker_failed", is_current: true, model_version_id: null, artifact_count: 0,
    claude_cap_micro_usd: 0, result_kind: null, fit_completed: false,
    expected_interpretation_units: 0, interpreted_units: 0, materialized_topics: 0 };
  assert.equal(workspaceAnalysisRunViewV1(run)?.retryable, true);
  assert.deepEqual(workspaceAnalysisRunViewV1(run)?.claude_cost, { hard_cap_micro_usd: 0, settled_micro_usd: 0,
    reserved_micro_usd: 0, unknown_reserved_micro_usd: 0, terminal_reserved_micro_usd: 0 });
  assert.equal(workspaceAnalysisRunViewV1({ ...run, is_current: false })?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...run, error_code: "workspace_engine_chunk_integrity_failed" })?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...run, error_code: "workspace_engine_outcome_unknown" })?.outcome_unknown, true);
});
test("UI recovery matches storage transport failures but never authorizes retry for corrupt or unauthorized artifacts", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 30, expected_roots: 3, expected_chunks: 133, expected_guides: 6, processed_roots: 3, processed_chunks: 133,
    error_code: "workspace_engine_storage_transport_failed", is_current: true, model_version_id: null, artifact_count: 1,
    claude_cap_micro_usd: 0, result_kind: null, fit_completed: false,
    expected_interpretation_units: 0, interpreted_units: 0, materialized_topics: 0 };
  for (const error_code of ["workspace_engine_storage_transport_failed", "workspace_engine_storage_unavailable", "topic_queue_unavailable"]) {
    assert.equal(workspaceAnalysisRunViewV1({ ...run, error_code })?.retryable, true);
    assert.equal(workspaceAnalysisRunViewV1({ ...run, error_code, is_current: false })?.retryable, false);
    assert.equal(workspaceAnalysisRunViewV1({ ...run, error_code, status: "running" })?.retryable, false);
  }
  for (const error_code of ["workspace_engine_storage_digest_invalid", "workspace_engine_storage_part_invalid",
    "workspace_engine_storage_reference_invalid", "workspace_engine_storage_bucket_not_private", "workspace_engine_forbidden"])
    assert.equal(workspaceAnalysisRunViewV1({ ...run, error_code })?.retryable, false);
});


test("storage verification retry requires server evidence of no committed artifacts, checkpoints or provider calls", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 0, expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 0, processed_chunks: 0,
    error_code: "workspace_engine_storage_verification_failed", is_current: true, model_version_id: null, artifact_count: 0,
    claude_cap_micro_usd: 0, result_kind: null, fit_completed: false,
    expected_interpretation_units: 0, interpreted_units: 0, materialized_topics: 0 };
  assert.equal(workspaceAnalysisRunViewV1(run)?.retryable, false, "zero counters are not authority to retry an integrity failure");
  assert.equal(workspaceAnalysisRunViewV1({ ...run, storage_recovery_eligible: false })?.retryable, false);
  const recoverable = { ...run, storage_recovery_eligible: true };
  assert.equal(workspaceAnalysisRunViewV1(recoverable)?.retryable, true);
  assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, is_current: false })?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, status: "running" })?.retryable, false);
  for (const error_code of ["workspace_engine_storage_digest_invalid", "workspace_engine_storage_reference_invalid", "workspace_engine_forbidden"])
    assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, error_code })?.retryable, false);
  const unknownBudget = { confirmed_micro_usd: 0, reserved_micro_usd: 1, unknown_reserved_micro_usd: 1,
    terminal_reserved_micro_usd: 0, observed_exception_micro_usd: 0, hard_cap_micro_usd: 10 };
  assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, claude_cap_micro_usd: 10 }, unknownBudget)?.retryable, false);
});


test("interpretation evidence retry requires its own server eligibility and never reopens unrelated integrity failures", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 80, expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 100, processed_chunks: 130,
    error_code: "workspace_engine_interpretation_cluster_invalid", is_current: true, model_version_id: null, artifact_count: 15,
    claude_cap_micro_usd: 0, result_kind: null, fit_completed: false,
    expected_interpretation_units: 0, interpreted_units: 0, materialized_topics: 0 };
  assert.equal(workspaceAnalysisRunViewV1(run)?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...run, interpretation_evidence_recovery_eligible: false })?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...run, storage_recovery_eligible: true })?.retryable, false,
    "A storage retry receipt does not authorize recovering interpretation evidence");
  const recoverable = { ...run, interpretation_evidence_recovery_eligible: true };
  assert.equal(workspaceAnalysisRunViewV1(recoverable)?.retryable, true);
  assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, is_current: false })?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, status: "running" })?.retryable, false);
  for (const error_code of ["workspace_engine_storage_verification_failed", "workspace_engine_interpretation_evidence_invalid",
    "workspace_engine_storage_digest_invalid", "workspace_engine_forbidden"])
    assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, error_code })?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...recoverable, claude_cap_micro_usd: 10 }, {
    confirmed_micro_usd: 0, reserved_micro_usd: 1, unknown_reserved_micro_usd: 1,
    terminal_reserved_micro_usd: 0, observed_exception_micro_usd: 0, hard_cap_micro_usd: 10 })?.retryable, false);
});


test("editorial repair retry requires its exact server eligibility while settled invalid output remains a known cost", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 80, expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 100, processed_chunks: 130,
    error_code: "workspace_engine_interpretation_output_invalid", is_current: true, model_version_id: id, artifact_count: 15,
    claude_cap_micro_usd: 30_000_000, result_kind: "computational_grouping", fit_completed: true,
    expected_interpretation_units: 357, interpreted_units: 0, materialized_topics: 0 };
  const budget = { confirmed_micro_usd: 147_415, reserved_micro_usd: 0, unknown_reserved_micro_usd: 0,
    terminal_reserved_micro_usd: 0, observed_exception_micro_usd: 0, hard_cap_micro_usd: 30_000_000 };
  assert.equal(workspaceAnalysisRunViewV1(run, budget)?.retryable, false);
  const eligible = { ...run, editorial_repair_recovery_eligible: true };
  const view = workspaceAnalysisRunViewV1(eligible, budget)!;
  assert.equal(view.retryable, true); assert.equal(view.outcome_unknown, false);
  assert.equal(view.claude_cost.settled_micro_usd, 147_415);
  assert.equal(workspaceAnalysisRunViewV1({ ...eligible, is_current: false }, budget)?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...eligible, status: "running" }, budget)?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1(eligible, { ...budget, unknown_reserved_micro_usd: 1 })?.retryable, false);
  for (const error_code of ["workspace_engine_interpretation_repair_invalid", "workspace_engine_interpretation_cluster_invalid",
    "workspace_engine_storage_verification_failed", "workspace_engine_forbidden"])
    assert.equal(workspaceAnalysisRunViewV1({ ...eligible, error_code }, budget)?.retryable, false);
});


test("terminal transport recovery is server-derived and preserves the unsettled reservation instead of inventing a confirmed charge", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 80, expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 100, processed_chunks: 130,
    error_code: "workspace_engine_interpretation_transport_terminal_confirmed", is_current: true, model_version_id: id, artifact_count: 15,
    claude_cap_micro_usd: 30_000_000, result_kind: "computational_grouping", fit_completed: true,
    expected_interpretation_units: 357, interpreted_units: 0, materialized_topics: 0 };
  const budget = { confirmed_micro_usd: 147_415, reserved_micro_usd: 1_681_800, terminal_reserved_micro_usd: 1_681_800,
    unknown_reserved_micro_usd: 0, observed_exception_micro_usd: 0, hard_cap_micro_usd: 30_000_000 };
  assert.equal(workspaceAnalysisRunViewV1(run, budget)?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...run, transport_recovery_eligible: false }, budget)?.retryable, false);
  const eligible = { ...run, transport_recovery_eligible: true }, view = workspaceAnalysisRunViewV1(eligible, budget)!;
  assert.equal(view.retryable, true); assert.equal(view.outcome_unknown, false);
  assert.deepEqual(view.claude_cost, { hard_cap_micro_usd: 30_000_000, settled_micro_usd: 147_415, reserved_micro_usd: 1_681_800,
    unknown_reserved_micro_usd: 0, terminal_reserved_micro_usd: 1_681_800 });
  assert.equal(workspaceAnalysisRunViewV1({ ...eligible, is_current: false }, budget)?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1({ ...eligible, status: "running" }, budget)?.retryable, false);
  assert.equal(workspaceAnalysisRunViewV1(eligible, { ...budget, reserved_micro_usd: 1_681_801, unknown_reserved_micro_usd: 1 })?.retryable, false);
  for (const error_code of ["workspace_engine_interpretation_transport_outcome_unknown", "workspace_engine_interpretation_output_invalid",
    "workspace_engine_interpretation_repair_invalid", "workspace_engine_interpretation_transport_retry_exhausted",
    "workspace_engine_storage_verification_failed", "workspace_engine_forbidden"])
    assert.equal(workspaceAnalysisRunViewV1({ ...eligible, error_code }, budget)?.retryable, false);
});

test("provider availability requires explicit complete budget policy and a current configured key", () => {
  const env = { NOISIA_WORKSPACE_INTERPRETATION_ENABLED: "true", ANTHROPIC_API_KEY: "test_not_real",
    NOISIA_WORKSPACE_INTERPRETATION_MAX_COST_MICRO_USD: "30000000",
    NOISIA_WORKSPACE_INTERPRETATION_DAILY_CAP_MICRO_USD: "20000000",
    NOISIA_WORKSPACE_INTERPRETATION_BUDGET_TIMEZONE: "America/Mexico_City" };
  assert.equal(workspaceAnalysisInterpretationPolicyV1(env).available, true);
  assert.equal(workspaceAnalysisInterpretationPolicyV1(env).maximum_cap_micro_usd, 20_000_000);
  for (const change of [{ ANTHROPIC_API_KEY: "" }, { NOISIA_WORKSPACE_INTERPRETATION_ENABLED: "false" },
    { NOISIA_WORKSPACE_INTERPRETATION_MAX_COST_MICRO_USD: "-1" }, { NOISIA_WORKSPACE_INTERPRETATION_DAILY_CAP_MICRO_USD: "NaN" },
    { NOISIA_WORKSPACE_INTERPRETATION_BUDGET_TIMEZONE: "not/a/timezone" }]) {
    assert.equal(workspaceAnalysisInterpretationPolicyV1({ ...env, ...change }).available, false);
  }
});

test("explicit authorization expiry remains non-retryable while preserving interpretation progress and cost receipts", () => {
  const run: NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> = { execution_id: id, status: "failed", phase: "failed",
    progress: 82, expected_roots: 100, expected_chunks: 130, expected_guides: 2, processed_roots: 100, processed_chunks: 130,
    error_code: "workspace_engine_interpretation_daily_authority_expired", is_current: true, model_version_id: id, artifact_count: 23,
    claude_cap_micro_usd: 30_000_000, result_kind: "computational_grouping", fit_completed: true,
    expected_interpretation_units: 357, interpreted_units: 32, materialized_topics: 0 };
  const budget = { confirmed_micro_usd: 1_918_865, reserved_micro_usd: 1_681_800, terminal_reserved_micro_usd: 1_681_800,
    unknown_reserved_micro_usd: 0, observed_exception_micro_usd: 0, hard_cap_micro_usd: 30_000_000 };
  const view = workspaceAnalysisRunViewV1(run, budget)!;
  assert.equal(view.retryable, false); assert.equal(view.outcome_unknown, false);
  assert.equal(view.error_code, run.error_code); assert.equal(view.interpreted_units, 32); assert.equal(view.expected_interpretation_units, 357);
  assert.deepEqual(view.claude_cost, { hard_cap_micro_usd: 30_000_000, settled_micro_usd: 1_918_865, reserved_micro_usd: 1_681_800,
    unknown_reserved_micro_usd: 0, terminal_reserved_micro_usd: 1_681_800 });
  const generic = workspaceAnalysisRunViewV1({ ...run, error_code: "workspace_engine_worker_failed" }, budget)!;
  assert.equal(generic.error_code, "workspace_engine_worker_failed"); assert.equal(generic.retryable, true);
  assert.deepEqual(generic.claude_cost, view.claude_cost);
});

test("the configured admission deadline disables new starts at expiry without changing historical run views", () => {
  const env = { NOISIA_WORKSPACE_INTERPRETATION_ENABLED: "true", ANTHROPIC_API_KEY: "test_not_real",
    NOISIA_WORKSPACE_INTERPRETATION_MAX_COST_MICRO_USD: "30000000", NOISIA_WORKSPACE_INTERPRETATION_DAILY_CAP_MICRO_USD: "30000000",
    NOISIA_WORKSPACE_INTERPRETATION_BUDGET_TIMEZONE: "America/Mexico_City",
    NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL: "2026-09-09T06:00:00.000Z" };
  const expiry = Date.parse(env.NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL);
  assert.equal(workspaceAnalysisInterpretationPolicyV1(env, expiry - 1).available, true);
  for (const now of [expiry, expiry + 1, Number.NaN]) {
    const policy = workspaceAnalysisInterpretationPolicyV1(env, now);
    assert.equal(policy.available, false); assert.equal(policy.maximum_cap_micro_usd, 0);
    assert.equal(policy.daily_cap_micro_usd, 30_000_000, "a closed admission does not rewrite its original cap");
    assert.equal(policy.budget_timezone, "America/Mexico_City");
  }
  for (const deadline of ["", "not-a-date", "2026-09-09T06:00:00Z", "2026-02-30T06:00:00.000Z", "2026-09-09T01:00:00.000-05:00"]) {
    assert.equal(workspaceAnalysisInterpretationPolicyV1({ ...env, NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL: deadline }, expiry - 1).available, false);
  }
  assert.equal(workspaceAnalysisInterpretationPolicyV1({ ...env, NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL: undefined }, expiry).available, true,
    "absence keeps the existing unbounded-date policy; configured invalid or expired values never do");
});


test("numeric recovery reaches the dedicated DB discriminator and rejects an editorial run before any update or paid preflight", async () => {
  const numericId = "00000000-0000-4000-8000-000000000002";
  const queries: string[] = []; let released = false, locked = false;
  const authority = { ...granted, user_type: "noisia_internal", primary_role: "noisia_admin" };
  const query = async (sql: string, params?: unknown[]) => {
    queries.push(sql);
    if (sql.includes("workspace.status workspace_status")) return { rows: [authority] };
    if (/^(BEGIN|SET LOCAL|ROLLBACK)/u.test(sql) || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("engine_request_keys->$2 alias")) { assert.deepEqual(params, [id, "numeric-exact-request"]); return { rows: [] }; }
    if (sql.startsWith("SELECT workspace_id FROM signal_topic_catalog_executions")) { assert.deepEqual(params, [numericId]); return { rows: [{ workspace_id: id }] }; }
    if (sql.startsWith("SELECT workspace_id FROM signal_corpus_preparation_input_state")) { assert.deepEqual(params, [id]); return { rows: [{ workspace_id: id }] }; }
    if (sql.includes("FOR UPDATE")) { locked = true; assert.deepEqual(params, [numericId]);
      return { rows: [{ id: numericId, workspace_id: id, actor_user_id: "actor", input_snapshot: {}, status: "failed" }] }; }
    throw new Error("Unexpected SQL before numeric discriminator");
  };
  const database = { query, connect: async () => ({ query, release() { released = true; } }) } as unknown as Pick<Pool, "query" | "connect">;
  await assert.rejects(requestWorkspaceAnalysisForActorV1({ database, workspaceId: id, actorUserId: "actor",
    idempotencyKey: "numeric-exact-request", body: { action: "retry_numeric", run_id: numericId } }),
  (error: unknown) => error instanceof SignalWorkspaceEngineError && error.code === "workspace_engine_incremental_retry_unavailable");
  assert.equal(locked, true); assert.equal(released, true);
  assert.ok(queries.includes("ROLLBACK")); assert.ok(!queries.some(sql => /^(INSERT|UPDATE)/u.test(sql)));
});


test("new admission uses DB dates and ceilings but preserves the server kill switch; it cannot enable infrastructure", () => {
  const env = { NOISIA_WORKSPACE_INTERPRETATION_ENABLED: "true", ANTHROPIC_API_KEY: "local-test-placeholder",
    NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL: "2026-09-08T06:00:00.000Z" };
  assert.equal(workspaceAnalysisAdmissionProviderAvailableV1(env), true);
  assert.equal(workspaceAnalysisInterpretationPolicyV1(env, Date.parse("2026-09-09T07:00:00Z")).available, false);
  assert.equal(workspaceAnalysisAdmissionProviderAvailableV1({ ...env, NOISIA_WORKSPACE_INTERPRETATION_ENABLED: "false" }), false);
  assert.equal(workspaceAnalysisAdmissionProviderAvailableV1({ ...env, ANTHROPIC_API_KEY: "" }), false);
});
test("admission actions reject client execution rights and ignore caller model or budget actor injection", async () => {
  const authorize = { action: "authorize_interpretation", run_id: id, expected_admission_operation_id: null,
    grant_cap_micro_usd: 1_000_000, admission_not_after: "2026-09-10T06:00:00.000Z" };
  const revoke = { action: "revoke_interpretation", run_id: id, expected_admission_operation_id: id };
  for (const candidate of [authorize, revoke]) {
    assert.equal(validateWorkspaceAnalysisRequestV1(candidate), true);
    await assert.rejects(requestWorkspaceAnalysisForActorV1({ database: authorityDatabase(granted), workspaceId: id,
      actorUserId: "actor", idempotencyKey: "admission-test-request", body: candidate }),
    (error: unknown) => error instanceof SignalWorkspaceEngineError && error.status === 403);
    for (const injected of [{ model: "claude-opus-5" }, { budget_actor_user_id: id }, { daily_cap_micro_usd: 100_000_000 }])
      assert.equal(validateWorkspaceAnalysisRequestV1({ ...candidate, ...injected }), false);
  }
});
test("stopping sends reaches the admin store even while the provider is disabled; authorizing cannot", async () => {
  const prior = process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED;
  process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED = "false";
  try {
    let connections = 0;
    const unavailableDatabase = new Error("local database seam");
    const database = { query: async () => ({ rows: [{ ...granted, user_type: "noisia_internal", primary_role: "noisia_admin" }] }),
      connect: async () => { connections++; throw unavailableDatabase; } } as unknown as Pick<Pool, "query" | "connect">;
    const args = { database, workspaceId: id, actorUserId: "actor", idempotencyKey: "admission-control-request" };
    await assert.rejects(requestWorkspaceAnalysisForActorV1({ ...args, body: { action: "authorize_interpretation", run_id: id,
      expected_admission_operation_id: null, grant_cap_micro_usd: 1, admission_not_after: "2026-09-10T06:00:00.000Z" } }),
    (error: unknown) => error instanceof SignalWorkspaceEngineError && error.code === "workspace_analysis_interpretation_unavailable");
    assert.equal(connections, 0);
    await assert.rejects(requestWorkspaceAnalysisForActorV1({ ...args, body: { action: "revoke_interpretation", run_id: id,
      expected_admission_operation_id: id } }), error => error === unavailableDatabase);
    assert.equal(connections, 1);
  } finally { if (prior === undefined) delete process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED; else process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED = prior; }
});

test("incremental delivery accepts only the numeric execution target and rejects client phase, budget or generation overrides", () => {
  const request = { action: "retry_incremental_delivery", run_id: id };
  assert.equal(validateWorkspaceAnalysisRequestV1(request), true);
  for (const patch of [{ phase: "projection" }, { generation_id: id }, { binding_artifact_id: id },
    { claude_cap_micro_usd: 0 }, { actor_user_id: "other" }, { run_id: "invalid" }])
    assert.equal(validateWorkspaceAnalysisRequestV1({ ...request, ...patch }), false);
});
