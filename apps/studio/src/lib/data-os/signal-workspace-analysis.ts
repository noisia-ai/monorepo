import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { beginSignalWorkspaceEngineV1, loadSignalWorkspaceCapabilitiesStoreV1,
  loadSignalWorkspaceCorpusPreparationStoreV1, loadSignalWorkspaceEnginePreflightV1,
  loadSignalWorkspaceEngineStatusV1, retrySignalWorkspaceEngineV1, isSignalWorkspaceEngineRetryableErrorV1, SignalWorkspaceEngineError,
  type SignalWorkspaceEngineStatusV1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 } from "@noisia/query-engine";
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
export function workspaceAnalysisRunViewV1(run: SignalWorkspaceEngineStatusV1["latest_run"]): WorkspaceAnalysisRun | null {
  if (!run) return null;
  // This producer only fits local computational models. No Claude request or
  // reservation is made here; interpretation must add its own real receipt.
  const unknown = Boolean(run.error_code && /outcome_unknown/u.test(run.error_code));
  return { ...run, outcome_unknown: unknown,
    retryable: run.status === "failed" && !unknown && run.is_current
      && isSignalWorkspaceEngineRetryableErrorV1(run.error_code),
    claude_cost: { hard_cap_micro_usd: run.claude_cap_micro_usd,
      settled_micro_usd: 0, reserved_micro_usd: 0, unknown_reserved_micro_usd: 0 } };
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
  const preparation = await loadSignalWorkspaceCorpusPreparationStoreV1({ queryable: access.database, workspace_id: args.workspaceId });
  const received = (await access.database.query<{ received: boolean }>(`SELECT EXISTS(SELECT 1 FROM import_batches
    WHERE workspace_id=$1::uuid AND status='completed') received`, [args.workspaceId])).rows[0]?.received === true;
  const preflight = await loadSignalWorkspaceEnginePreflightV1(access);
  const latest = workspaceAnalysisRunViewV1(raw.latest_run);
  const result: WorkspaceAnalysisStatus = { ...raw, contract_version: "signal-workspace-analysis-v1",
    request_scope: workspaceAnalysisRequestScopeV1(args.workspaceId, args.actorUserId), can_execute: access.capabilities.can_execute_topics,
    latest_run: latest, active_run: latest && ["queued", "running"].includes(latest.status) ? latest : null,
    latest_complete: workspaceAnalysisRunViewV1(raw.latest_complete), request_run: workspaceAnalysisRunViewV1(raw.request_run),
    preflight: {
      state: workspaceAnalysisPreflightStateV1({ received, prepared: preparation.is_current,
        embeddingRunId: preflight.embedding_run_id, missingGuides: preflight.missing_guides }),
      embedding_run_id: preflight.embedding_run_id, context_digest: preflight.expected_context_digest,
      catalog_digest: preflight.expected_catalog_digest,
      cost: { claude: { estimated_upper_micro_usd: 0, maximum_cap_micro_usd: 0, provider_available: false },
        voyage: { estimated_upper_micro_usd: 0 } }
    } };
  if (!validWorkspaceAnalysisStatus(result)) throw new SignalWorkspaceEngineError("workspace_analysis_status_invalid", 503);
  return result;
}
export async function requestWorkspaceAnalysisForActorV1(args: Access & { idempotencyKey: string; body: unknown }): Promise<WorkspaceAnalysisStatus> {
  if (!requestKeyPattern.test(args.idempotencyKey) || !validateWorkspaceAnalysisRequestV1(args.body)) throw new SignalWorkspaceEngineError("workspace_analysis_request_invalid", 422);
  const access = await authorize(args, true);
  if (args.body.action === "start") {
    // A nonzero cap would imply an interpretation reservation this fit-only
    // producer cannot honor. Never silently accept or charge it.
    if (args.body.claude_cap_micro_usd !== 0) throw new SignalWorkspaceEngineError("workspace_analysis_interpretation_unavailable", 422);
    await beginSignalWorkspaceEngineV1({ ...access, idempotency_key: args.idempotencyKey,
      embedding_run_id: args.body.embedding_run_id, expected_context_digest: args.body.expected_context_digest,
      expected_catalog_digest: args.body.expected_catalog_digest, claude_cap_micro_usd: 0,
      engine_config: SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 });
  } else {
    await retrySignalWorkspaceEngineV1({ ...access, execution_id: args.body.run_id, idempotency_key: args.idempotencyKey });
  }
  return loadWorkspaceAnalysisForActorV1({ ...args, database: access.database });
}
