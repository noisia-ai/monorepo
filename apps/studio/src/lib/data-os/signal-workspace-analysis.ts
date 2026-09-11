import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { beginSignalWorkspaceEngineV1, loadSignalWorkspaceCapabilitiesStoreV1,
  loadSignalWorkspaceCorpusPreparationStoreV1, loadSignalWorkspaceEnginePreflightV1,
  loadSignalWorkspaceEngineStatusV1, retrySignalWorkspaceEngineV1, isSignalWorkspaceEngineRetryableErrorV1, SignalWorkspaceEngineError,
  retrySignalWorkspaceEngineProgressV1, retrySignalWorkspaceNumericUpdateV1, retrySignalWorkspaceIncrementalDeliveryV1, loadSignalWorkspaceAnalysisUpdateV1, loadSignalWorkspaceNumericReadinessV1,
  loadSignalWorkspaceInterpretationAdmissionV1, authorizeSignalWorkspaceInterpretationAdmissionV1, revokeSignalWorkspaceInterpretationAdmissionV1,
  loadSignalWorkspaceIncrementalEditorialPreparationV1, requestSignalWorkspaceIncrementalEditorialPreparationV1,
  loadSignalWorkspaceIncrementalEditorialAdmissionV1, beginAndEnqueueSignalWorkspaceIncrementalEditorialV1, revokeSignalWorkspaceIncrementalEditorialV1,
  renewAndEnqueueSignalWorkspaceIncrementalEditorialV1,
  loadSignalWorkspaceIncrementalEditorialStatusV1, retrySignalWorkspaceIncrementalEditorialV1,
  loadSignalWorkspaceEngineInterpretationBudgetV1,
  SignalTopicCatalogError,
  type SignalWorkspaceEngineInterpretationBudgetV1, type SignalWorkspaceEngineStatusV1, type SignalWorkspaceIncrementalEditorialStatusV1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 } from "@noisia/query-engine";
import { parsePendingWorkspaceAnalysis, validWorkspaceAnalysisStatus,
  type WorkspaceAnalysisRequest, type WorkspaceAnalysisRun, type WorkspaceAnalysisStatus } from "./signal-workspace-analysis-ui";
import type { WorkspaceIncrementalEditorial } from "./signal-workspace-incremental-editorial-ui";

type Database = Pick<Pool, "query" | "connect">;
type Access = { database?: Database; workspaceId: string; actorUserId: string };
const requestKeyPattern = /^[A-Za-z0-9._:-]{8,200}$/u;
export function validateWorkspaceAnalysisRequestV1(value: unknown): value is WorkspaceAnalysisRequest {
  return parsePendingWorkspaceAnalysis({ version: 1, workspace_id: "validation", request_scope: "validation", key: "validation", body: value }, "validation", "validation") !== null;
}
export function workspaceAnalysisRequestScopeV1(workspaceId: string, actorUserId: string) {
  return `sha256:${createHash("sha256").update(JSON.stringify(["workspace-analysis-v1", workspaceId, actorUserId])).digest("hex")}`;
}
async function authorize(args: Access, execute: boolean) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId });
  if (!capabilities.can_view || execute && !capabilities.can_execute_topics) throw new SignalWorkspaceEngineError("workspace_engine_forbidden", 403);
  return { database, capabilities, workspace_id: args.workspaceId, actor_user_id: args.actorUserId };
}
export function workspaceAnalysisInterpretationPolicyV1(env: Readonly<Record<string, string | undefined>> = process.env, nowMilliseconds = Date.now()) {
  const maximum = Number(env.NOISIA_WORKSPACE_INTERPRETATION_MAX_COST_MICRO_USD ?? 0);
  const daily = Number(env.NOISIA_WORKSPACE_INTERPRETATION_DAILY_CAP_MICRO_USD ?? 0);
  const timezone = env.NOISIA_WORKSPACE_INTERPRETATION_BUDGET_TIMEZONE ?? "UTC";
  let validTimezone = false;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); validTimezone = true; } catch { /* Invalid config disables sends. */ }
  const expires = env.NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL;
  const admissionOpen = expires === undefined || typeof expires === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(expires)
    && Number.isFinite(Date.parse(expires)) && new Date(expires).toISOString() === expires
    && Number.isFinite(nowMilliseconds) && nowMilliseconds < Date.parse(expires);
  const available = env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true" && Boolean(env.ANTHROPIC_API_KEY)
    && [maximum, daily].every(value => Number.isSafeInteger(value) && value > 0) && validTimezone && admissionOpen;
  return { available, maximum_cap_micro_usd: available ? Math.min(maximum, daily) : 0,
    daily_cap_micro_usd: daily, budget_timezone: timezone };
}
/** New DB admission receipts own their date and sealed budgets. The operating
 * kill switch still prevents new sends; an expired legacy env date is not a renewal veto. */
export function workspaceAnalysisAdmissionProviderAvailableV1(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true" && Boolean(env.ANTHROPIC_API_KEY);
}
export function workspaceIncrementalEditorialExecutionViewV1(run: SignalWorkspaceIncrementalEditorialStatusV1 | null, providerAvailable: boolean) {
  return run ? { ...run, can_retry: run.can_retry && (providerAvailable || run.recorded_recovery_available),
    renewal: run.renewal ? { ...run.renewal, can_renew: run.renewal.can_renew && providerAvailable,
      blocked_reason: run.renewal.can_renew && !providerAvailable ? "workspace_analysis_interpretation_unavailable" : run.renewal.blocked_reason } : run.renewal } : null;
}
const incrementalEditorialReaders = {
  admission: (args: Parameters<typeof loadSignalWorkspaceIncrementalEditorialAdmissionV1>[0]) => loadSignalWorkspaceIncrementalEditorialAdmissionV1(args),
  preparation: loadSignalWorkspaceIncrementalEditorialPreparationV1,
  execution: loadSignalWorkspaceIncrementalEditorialStatusV1
};
/** Resolve accepted admission keys before choosing a numeric source. Historical
 * receipts must not depend on the current preparation or catalog still existing. */
export async function loadWorkspaceIncrementalEditorialForActorV1(args: {
  database: Database; workspace_id: string; actor_user_id: string; idempotency_key?: string;
}, readers = incrementalEditorialReaders): Promise<WorkspaceIncrementalEditorial | null> {
  const admission = await readers.admission(args);
  const preparation = await readers.preparation({ ...args,
    numeric_execution_id: admission?.request?.receipt.numeric_execution_id });
  const execution = await readers.execution({ ...args,
    execution_id: admission?.request?.receipt.execution_id ?? admission?.operation?.execution_id });
  const providerAvailable = workspaceAnalysisAdmissionProviderAvailableV1();
  return preparation || admission || execution ? { preparation,
    execution: workspaceIncrementalEditorialExecutionViewV1(execution, providerAvailable),
    admission: admission ? { ...admission, adapter_available: true, provider_available: providerAvailable } : null } : null;
}
export function workspaceAnalysisRunViewV1(run: SignalWorkspaceEngineStatusV1["latest_run"], budget?: SignalWorkspaceEngineInterpretationBudgetV1): WorkspaceAnalysisRun | null {
  if (!run) return null;
  if (run.claude_cap_micro_usd > 0 && !budget) throw new SignalWorkspaceEngineError("workspace_analysis_budget_unavailable", 503);
  const unknown = Boolean(run.error_code && /outcome_unknown/u.test(run.error_code)) || (budget?.unknown_reserved_micro_usd ?? 0) > 0;
  return { ...run, outcome_unknown: unknown, transport_recovery_eligible: run.transport_recovery_eligible === true,
    retryable: run.status === "failed" && !unknown && run.is_current
      && isSignalWorkspaceEngineRetryableErrorV1(run.error_code, run),
    claude_cost: { hard_cap_micro_usd: run.claude_cap_micro_usd,
      settled_micro_usd: budget?.confirmed_micro_usd ?? 0, reserved_micro_usd: budget?.reserved_micro_usd ?? 0,
      unknown_reserved_micro_usd: budget?.unknown_reserved_micro_usd ?? 0,
      terminal_reserved_micro_usd: budget?.terminal_reserved_micro_usd ?? 0 } };
}
export function workspaceAnalysisActiveRunV1(run: WorkspaceAnalysisRun | null): WorkspaceAnalysisRun | null {
  return run?.is_current && ["queued", "running"].includes(run.status) ? run : null;
}
export function workspaceAnalysisPreflightStateV1(args: {
  received: boolean; prepared: boolean; embeddingRunId: string | null; missingGuides: number;
}): WorkspaceAnalysisStatus["preflight"]["state"] {
  if (!args.received) return "awaiting_import";
  if (!args.prepared) return "needs_preparation";
  if (!args.embeddingRunId) return "missing_embeddings";
  return args.missingGuides > 0 ? "missing_context" : "ready";
}
/** A missing or stale Brand Context is an expected, repairable preflight state.
 * Reads keep historical runs and cost receipts visible; execution still reaches
 * the strict DB preflight and cannot start until current authority exists. */
export function workspaceAnalysisContextPreflightStateV1(error: unknown): WorkspaceAnalysisStatus["preflight"]["state"] | null {
  return error instanceof SignalTopicCatalogError
    && ["brand_context_semantic_context_required", "brand_context_source_stale"].includes(error.code)
    ? "missing_context" : null;
}
export async function loadWorkspaceAnalysisPreflightForReadV1<T>(loader: () => Promise<T>): Promise<{
  value: T | null; state: WorkspaceAnalysisStatus["preflight"]["state"] | null;
}> {
  try { return { value: await loader(), state: null }; }
  catch (error) {
    const state = workspaceAnalysisContextPreflightStateV1(error);
    if (!state) throw error;
    return { value: null, state };
  }
}
export async function loadWorkspaceAnalysisForActorV1(args: Access & { idempotencyKey?: string }): Promise<WorkspaceAnalysisStatus> {
  if (args.idempotencyKey !== undefined && !requestKeyPattern.test(args.idempotencyKey)) throw new SignalWorkspaceEngineError("workspace_analysis_request_invalid", 422);
  const access = await authorize(args, false);
  // Read admission first so an acknowledged execution is visible to the following run readers.
  const numeric_readiness = await loadSignalWorkspaceNumericReadinessV1(access);
  const raw = await loadSignalWorkspaceEngineStatusV1({ ...access, idempotency_key: args.idempotencyKey });
  const update = await loadSignalWorkspaceAnalysisUpdateV1({ ...access, idempotency_key: args.idempotencyKey });
  const preparation = await loadSignalWorkspaceCorpusPreparationStoreV1({ queryable: access.database, workspace_id: args.workspaceId });
  const received = (await access.database.query<{ received: boolean }>(`SELECT EXISTS(SELECT 1 FROM import_batches
    WHERE workspace_id=$1::uuid AND status='completed') received`, [args.workspaceId])).rows[0]?.received === true;
  const preflightRead = await loadWorkspaceAnalysisPreflightForReadV1(() => loadSignalWorkspaceEnginePreflightV1(access));
  const preflight = preflightRead.value;
  const policy = workspaceAnalysisInterpretationPolicyV1();
  const budgets = new Map<string, SignalWorkspaceEngineInterpretationBudgetV1>();
  const runs = [raw.latest_run, raw.latest_complete, raw.request_run].filter((run) => run && run.claude_cap_micro_usd > 0);
  await Promise.all([...new Set(runs.map(run => run!.execution_id))].map(async execution_id => {
    budgets.set(execution_id, await loadSignalWorkspaceEngineInterpretationBudgetV1({ ...access, execution_id }));
  }));
  const view = (run: SignalWorkspaceEngineStatusV1["latest_run"]) => workspaceAnalysisRunViewV1(run, run ? budgets.get(run.execution_id) : undefined);
  const loadedAdmission = await loadSignalWorkspaceInterpretationAdmissionV1({ ...access, idempotency_key: args.idempotencyKey });
  const admission = loadedAdmission ? { ...loadedAdmission, provider_available: workspaceAnalysisAdmissionProviderAvailableV1() } : null;
  const incremental_editorial = await loadWorkspaceIncrementalEditorialForActorV1({ ...access, idempotency_key: args.idempotencyKey });
  const latest = view(raw.latest_run);
  const result: WorkspaceAnalysisStatus = { ...raw, update, numeric_readiness, admission, incremental_editorial, contract_version: "signal-workspace-analysis-v1",
    request_scope: workspaceAnalysisRequestScopeV1(args.workspaceId, args.actorUserId), can_execute: access.capabilities.can_execute_topics,
    latest_run: latest, active_run: workspaceAnalysisActiveRunV1(latest),
    latest_complete: view(raw.latest_complete), request_run: view(raw.request_run),
    preflight: {
      state: preflightRead.state ?? workspaceAnalysisPreflightStateV1({ received, prepared: preparation.is_current,
        embeddingRunId: preflight?.embedding_run_id ?? null, missingGuides: preflight?.missing_guides ?? 0 }),
      embedding_run_id: preflight?.embedding_run_id ?? null, context_digest: preflight?.expected_context_digest ?? null,
      catalog_digest: preflight?.expected_catalog_digest ?? null,
      cost: { claude: { estimated_upper_micro_usd: null, maximum_cap_micro_usd: policy.maximum_cap_micro_usd, provider_available: policy.available },
        voyage: { estimated_upper_micro_usd: 0 } }
    } };
  if (!validWorkspaceAnalysisStatus(result)) throw new SignalWorkspaceEngineError("workspace_analysis_status_invalid", 503);
  return result;
}
export async function requestWorkspaceAnalysisForActorV1(args: Access & { idempotencyKey: string; body: unknown }): Promise<WorkspaceAnalysisStatus> {
  if (!requestKeyPattern.test(args.idempotencyKey) || !validateWorkspaceAnalysisRequestV1(args.body)) throw new SignalWorkspaceEngineError("workspace_analysis_request_invalid", 422);
  const access = await authorize(args, true);
  if (args.body.action === "start") {
    const policy = workspaceAnalysisInterpretationPolicyV1();
    if (!policy.available) throw new SignalWorkspaceEngineError("workspace_analysis_interpretation_unavailable", 422);
    if (args.body.claude_cap_micro_usd <= 0 || args.body.claude_cap_micro_usd > policy.maximum_cap_micro_usd) {
      throw new SignalWorkspaceEngineError("workspace_analysis_interpretation_cap_invalid", 422);
    }
    await beginSignalWorkspaceEngineV1({ ...access, idempotency_key: args.idempotencyKey,
      embedding_run_id: args.body.embedding_run_id, expected_context_digest: args.body.expected_context_digest,
      expected_catalog_digest: args.body.expected_catalog_digest, claude_cap_micro_usd: args.body.claude_cap_micro_usd,
      engine_config: SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, interpretation_config: {
        call_configuration: SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,
        budget_timezone: policy.budget_timezone, daily_cap_micro_usd: policy.daily_cap_micro_usd } });
  } else if (args.body.action === "prepare_incremental_editorial") {
    await requestSignalWorkspaceIncrementalEditorialPreparationV1({ ...access, numeric_execution_id: args.body.run_id,
      expected_source_digest: args.body.expected_source_digest, idempotency_key: args.idempotencyKey });
  } else if (args.body.action === "begin_incremental_editorial") {
    await beginAndEnqueueSignalWorkspaceIncrementalEditorialV1({ ...access, numeric_execution_id: args.body.run_id,
      expected_evidence_plan_artifact_id: args.body.expected_evidence_plan_artifact_id,
      expected_numeric_checkpoint_digest: args.body.expected_numeric_checkpoint_digest,
      expected_target_unit_digest: args.body.expected_target_unit_digest, expected_history_cut_digest: args.body.expected_history_cut_digest,
      cap_micro_usd: args.body.cap_micro_usd, admission_not_after: args.body.admission_not_after, idempotency_key: args.idempotencyKey,
      provider_available: workspaceAnalysisAdmissionProviderAvailableV1() });
  } else if (args.body.action === "renew_incremental_editorial") {
    await renewAndEnqueueSignalWorkspaceIncrementalEditorialV1({ ...access, execution_id: args.body.run_id,
      expected_admission_operation_id: args.body.expected_admission_operation_id,
      grant_cap_micro_usd: args.body.grant_cap_micro_usd, admission_not_after: args.body.admission_not_after,
      idempotency_key: args.idempotencyKey, provider_available: workspaceAnalysisAdmissionProviderAvailableV1() });
  } else if (args.body.action === "revoke_incremental_editorial") {
    await revokeSignalWorkspaceIncrementalEditorialV1({ ...access, execution_id: args.body.run_id,
      expected_admission_operation_id: args.body.expected_admission_operation_id, idempotency_key: args.idempotencyKey });
  } else if (args.body.action === "retry_incremental_editorial") {
    await retrySignalWorkspaceIncrementalEditorialV1({ ...access, execution_id: args.body.run_id,
      expected_worker_job_id: args.body.expected_worker_job_id, idempotency_key: args.idempotencyKey,
      provider_available: workspaceAnalysisAdmissionProviderAvailableV1() });
  } else if (args.body.action === "authorize_interpretation") {
    if (!workspaceAnalysisAdmissionProviderAvailableV1()) throw new SignalWorkspaceEngineError("workspace_analysis_interpretation_unavailable", 422);
    await authorizeSignalWorkspaceInterpretationAdmissionV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey,
      expected_admission_operation_id: args.body.expected_admission_operation_id, grant_cap_micro_usd: args.body.grant_cap_micro_usd,
      admission_not_after: args.body.admission_not_after });
  } else if (args.body.action === "revoke_interpretation") {
    await revokeSignalWorkspaceInterpretationAdmissionV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey,
      expected_admission_operation_id: args.body.expected_admission_operation_id });
  } else if (args.body.action === "retry_incremental_delivery") {
    // The store selects the existing derivation/projection phase; no numeric or editorial execution is restarted.
    await retrySignalWorkspaceIncrementalDeliveryV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  } else if (args.body.action === "retry_numeric") {
    // Resume only this zero-provider numeric execution; editorial receipts stay separate.
    await retrySignalWorkspaceNumericUpdateV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  } else if (args.body.action === "retry_progress") {
    // This resumes only delivery of settled evidence. It cannot renew or
    // restart the editorial execution or authorize provider spending.
    await retrySignalWorkspaceEngineProgressV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  } else {
    await retrySignalWorkspaceEngineV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  }
  return loadWorkspaceAnalysisForActorV1({ ...args, database: access.database });
}
