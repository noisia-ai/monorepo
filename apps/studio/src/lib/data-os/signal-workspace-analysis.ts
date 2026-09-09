import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { beginSignalWorkspaceEngineV1, loadSignalWorkspaceCapabilitiesStoreV1,
  loadSignalWorkspaceCorpusPreparationStoreV1, loadSignalWorkspaceEnginePreflightV1,
  loadSignalWorkspaceEngineStatusV1, retrySignalWorkspaceEngineV1, isSignalWorkspaceEngineRetryableErrorV1, SignalWorkspaceEngineError,
  retrySignalWorkspaceEngineProgressV1, loadSignalWorkspaceAnalysisUpdateV1,
  loadSignalWorkspaceEngineInterpretationBudgetV1,
  type SignalWorkspaceEngineInterpretationBudgetV1, type SignalWorkspaceEngineStatusV1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 } from "@noisia/query-engine";
import { parsePendingWorkspaceAnalysis, validWorkspaceAnalysisStatus,
  type WorkspaceAnalysisRequest, type WorkspaceAnalysisRun, type WorkspaceAnalysisStatus } from "./signal-workspace-analysis-ui";

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
export function workspaceAnalysisPreflightStateV1(args: {
  received: boolean; prepared: boolean; embeddingRunId: string | null; missingGuides: number;
}): WorkspaceAnalysisStatus["preflight"]["state"] {
  if (!args.received) return "awaiting_import";
  if (!args.prepared) return "needs_preparation";
  if (!args.embeddingRunId) return "missing_embeddings";
  return args.missingGuides > 0 ? "missing_context" : "ready";
}
export async function loadWorkspaceAnalysisForActorV1(args: Access & { idempotencyKey?: string }): Promise<WorkspaceAnalysisStatus> {
  if (args.idempotencyKey !== undefined && !requestKeyPattern.test(args.idempotencyKey)) throw new SignalWorkspaceEngineError("workspace_analysis_request_invalid", 422);
  const access = await authorize(args, false);
  const raw = await loadSignalWorkspaceEngineStatusV1({ ...access, idempotency_key: args.idempotencyKey });
  const update = await loadSignalWorkspaceAnalysisUpdateV1(access);
  const preparation = await loadSignalWorkspaceCorpusPreparationStoreV1({ queryable: access.database, workspace_id: args.workspaceId });
  const received = (await access.database.query<{ received: boolean }>(`SELECT EXISTS(SELECT 1 FROM import_batches
    WHERE workspace_id=$1::uuid AND status='completed') received`, [args.workspaceId])).rows[0]?.received === true;
  const preflight = await loadSignalWorkspaceEnginePreflightV1(access);
  const policy = workspaceAnalysisInterpretationPolicyV1();
  const budgets = new Map<string, SignalWorkspaceEngineInterpretationBudgetV1>();
  const runs = [raw.latest_run, raw.latest_complete, raw.request_run].filter((run) => run && run.claude_cap_micro_usd > 0);
  await Promise.all([...new Set(runs.map(run => run!.execution_id))].map(async execution_id => {
    budgets.set(execution_id, await loadSignalWorkspaceEngineInterpretationBudgetV1({ ...access, execution_id }));
  }));
  const view = (run: SignalWorkspaceEngineStatusV1["latest_run"]) => workspaceAnalysisRunViewV1(run, run ? budgets.get(run.execution_id) : undefined);
  const latest = view(raw.latest_run);
  const result: WorkspaceAnalysisStatus = { ...raw, update, contract_version: "signal-workspace-analysis-v1",
    request_scope: workspaceAnalysisRequestScopeV1(args.workspaceId, args.actorUserId), can_execute: access.capabilities.can_execute_topics,
    latest_run: latest, active_run: latest && ["queued", "running"].includes(latest.status) ? latest : null,
    latest_complete: view(raw.latest_complete), request_run: view(raw.request_run),
    preflight: {
      state: workspaceAnalysisPreflightStateV1({ received, prepared: preparation.is_current,
        embeddingRunId: preflight.embedding_run_id, missingGuides: preflight.missing_guides }),
      embedding_run_id: preflight.embedding_run_id, context_digest: preflight.expected_context_digest,
      catalog_digest: preflight.expected_catalog_digest,
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
  } else if (args.body.action === "retry_progress") {
    // This resumes only delivery of settled evidence. It cannot renew or
    // restart the editorial execution or authorize provider spending.
    await retrySignalWorkspaceEngineProgressV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  } else {
    await retrySignalWorkspaceEngineV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  }
  return loadWorkspaceAnalysisForActorV1({ ...args, database: access.database });
}
