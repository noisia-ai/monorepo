import { isWorkspaceAdmissionAction, validWorkspaceAdmissionRequest, validWorkspaceInterpretationAdmission,
  type WorkspaceInterpretationAdmission, type WorkspaceInterpretationAdmissionRequest } from "./signal-workspace-interpretation-admission-ui";
import type { SignalWorkspaceEngineStatusV1 } from "@noisia/db";
import { embeddingCapUsdInput, latestCorpusEmbeddingSnapshot, parseEmbeddingCapMicroUsd } from "./workspace-corpus-embeddings-ui";
import { validWorkspaceAnalysisUpdate, validWorkspaceNumericReadiness, type WorkspaceAnalysisUpdate, type WorkspaceNumericReadiness } from "./signal-workspace-analysis-update-ui";
import { isWorkspaceIncrementalEditorialAction, validWorkspaceIncrementalEditorial, validWorkspaceIncrementalEditorialRequest,
  workspaceIncrementalEditorialHasReceipt, workspaceIncrementalEditorialPending,
  type WorkspaceIncrementalEditorial, type WorkspaceIncrementalEditorialRequest } from "./signal-workspace-incremental-editorial-ui";

export type WorkspaceAnalysisRun = NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> & {
  retryable: boolean; outcome_unknown: boolean; transport_recovery_eligible: boolean;
  claude_cost: { hard_cap_micro_usd: number; settled_micro_usd: number;
    reserved_micro_usd: number; unknown_reserved_micro_usd: number; terminal_reserved_micro_usd: number };
};
export type WorkspaceAnalysisStatus = Omit<SignalWorkspaceEngineStatusV1, "latest_run" | "latest_complete"> & {
  contract_version: "signal-workspace-analysis-v1";
  request_scope: string; can_execute: boolean;
  update?: WorkspaceAnalysisUpdate | null;
  numeric_readiness?: WorkspaceNumericReadiness | null;
  admission?: WorkspaceInterpretationAdmission | null;
  incremental_editorial?: WorkspaceIncrementalEditorial | null;
  preflight: { state: "ready" | "awaiting_import" | "needs_preparation" | "missing_embeddings" | "missing_context";
    embedding_run_id: string | null; context_digest: string | null; catalog_digest: string | null;
    cost: { claude: { estimated_upper_micro_usd: number | null; maximum_cap_micro_usd: number; provider_available: boolean };
      voyage: { estimated_upper_micro_usd: number } } };
  active_run: WorkspaceAnalysisRun | null; latest_run: WorkspaceAnalysisRun | null;
  latest_complete: WorkspaceAnalysisRun | null; request_run: WorkspaceAnalysisRun | null;
};
export type WorkspaceAnalysisRequest = { action: "start"; embedding_run_id: string;
  expected_context_digest: string; expected_catalog_digest: string; claude_cap_micro_usd: number }
  | { action: "retry"; run_id: string }
  | { action: "retry_progress"; run_id: string }
  | { action: "retry_numeric"; run_id: string }
  | { action: "retry_incremental_delivery"; run_id: string }
  | WorkspaceInterpretationAdmissionRequest | WorkspaceIncrementalEditorialRequest;
export type PendingWorkspaceAnalysis = { version: 1; workspace_id: string; request_scope: string;
  key: string; body: WorkspaceAnalysisRequest };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const nullable = (value: unknown, predicate: (item: unknown) => boolean) => value === null || predicate(value);

export function validWorkspaceAnalysisMaterialization(value: unknown): boolean {
  return value === undefined || value === null || object(value)
    && ["artifact_id", "output_catalog_profile_id", "projection_execution_id", "generation_id"].every(key => uuid(value[key]))
    && digest(value.mapping_digest)
    && ["interpreted_unit_count", "expected_interpretation_unit_count", "topic_count", "discovered_topic_count"].every(key => integer(value[key]))
    && Number(value.interpreted_unit_count) <= Number(value.expected_interpretation_unit_count)
    && Number(value.discovered_topic_count) <= Number(value.topic_count)
    && typeof value.interpretation_complete === "boolean"
    && (!value.interpretation_complete || value.interpreted_unit_count === value.expected_interpretation_unit_count);
}
/** Only a persisted receipt or the complete execution can invalidate the catalog. */
export function workspaceAnalysisCatalogReceiptKey(status: WorkspaceAnalysisStatus | null) {
  if (!status) return null;
  const incremental = status.update?.catalog_receipt;
  const incrementalKey = incremental ? `${incremental.receipt_id}:${incremental.serving_editorial_cut_digest}:${incremental.output_catalog_profile_id}:${incremental.mapping_digest}` : "";
  const run = status.active_run ?? status.latest_run;
  if (run?.status === "ready" && status.latest_complete?.execution_id === run.execution_id) {
    return `${status.workspace_id}:${status.request_scope}:complete:${run.execution_id}:${run.materialization_progress?.artifact_id ?? ""}:${run.materialization_progress?.mapping_digest ?? ""}${incrementalKey ? `:incremental:${incrementalKey}` : ""}`;
  }
  const progress = run?.materialization_progress;
  if (progress) return `${status.workspace_id}:${status.request_scope}:${progress.artifact_id}:${progress.mapping_digest}${incrementalKey ? `:incremental:${incrementalKey}` : ""}`;
  const complete = status.latest_complete ? `${status.workspace_id}:${status.request_scope}:complete:${status.latest_complete.execution_id}` : "";
  return incrementalKey ? `${status.workspace_id}:${status.request_scope}:incremental:${incrementalKey}:${complete}` : complete || null;
}

export function validWorkspaceAnalysisRun(value: unknown): value is WorkspaceAnalysisRun | null {
  return value === null || object(value) && uuid(value.execution_id)
    && ["queued", "running", "ready", "failed"].includes(String(value.status))
    && ["queued", "exporting", "fitting", "persisting", "interpreting", "materializing", "complete", "failed"].includes(String(value.phase))
    && integer(value.progress) && value.progress <= 100
    && ["expected_roots", "expected_chunks", "expected_guides", "processed_roots", "processed_chunks", "artifact_count",
      "expected_interpretation_units", "interpreted_units", "materialized_topics"].every((key) => integer(value[key]))
    && Number(value.processed_roots) <= Number(value.expected_roots) && Number(value.processed_chunks) <= Number(value.expected_chunks)
    && typeof value.fit_completed === "boolean" && Number(value.interpreted_units) <= Number(value.expected_interpretation_units)
    && typeof value.is_current === "boolean" && typeof value.retryable === "boolean" && typeof value.outcome_unknown === "boolean"
    && typeof value.transport_recovery_eligible === "boolean"
    && validWorkspaceAnalysisMaterialization(value.materialization_progress)
    && (!object(value.materialization_progress) || value.materialization_progress.expected_interpretation_unit_count === value.expected_interpretation_units
      && Number(value.materialization_progress.interpreted_unit_count) <= Number(value.interpreted_units))
    && (value.materialization_pending === undefined || typeof value.materialization_pending === "boolean")
    && (value.materialization_error_code === undefined || nullable(value.materialization_error_code, (code) => typeof code === "string"))
    && (value.materialization_retry_available === undefined || typeof value.materialization_retry_available === "boolean")
    && integer(value.claude_cap_micro_usd) && [null, "computational_grouping", "insufficient_population"].includes(value.result_kind as null | string)
    && nullable(value.error_code, (code) => typeof code === "string") && nullable(value.model_version_id, uuid)
    && object(value.claude_cost) && ["hard_cap_micro_usd", "settled_micro_usd", "reserved_micro_usd", "unknown_reserved_micro_usd", "terminal_reserved_micro_usd"]
      .every((key) => integer((value.claude_cost as Record<string, unknown>)[key]))
    && Number(value.claude_cost.terminal_reserved_micro_usd) <= Number(value.claude_cost.reserved_micro_usd);
}
export function workspaceAnalysisInterpretedComplete(run: WorkspaceAnalysisRun | null) {
  return Boolean(run?.status === "ready" && run.phase === "complete" && run.fit_completed
    && run.interpreted_units === run.expected_interpretation_units);
}
export function validWorkspaceAnalysisStatus(value: unknown): value is WorkspaceAnalysisStatus {
  if (!object(value) || value.contract_version !== "signal-workspace-analysis-v1" || typeof value.workspace_id !== "string"
    || typeof value.request_scope !== "string" || !value.request_scope || typeof value.can_execute !== "boolean"
    || typeof value.observed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value.observed_at)
    || !object(value.preflight) || !object(value.preflight.cost) || !object(value.preflight.cost.claude) || !object(value.preflight.cost.voyage)) return false;
  const preflight = value.preflight, claude = value.preflight.cost.claude, voyage = value.preflight.cost.voyage;
  return ["ready", "awaiting_import", "needs_preparation", "missing_embeddings", "missing_context"].includes(String(preflight.state))
    && nullable(preflight.embedding_run_id, uuid) && nullable(preflight.context_digest, digest) && nullable(preflight.catalog_digest, digest)
    && (preflight.state !== "ready" || uuid(preflight.embedding_run_id) && digest(preflight.context_digest) && digest(preflight.catalog_digest))
    && nullable(claude.estimated_upper_micro_usd, integer) && integer(claude.maximum_cap_micro_usd)
    && typeof claude.provider_available === "boolean" && integer(voyage.estimated_upper_micro_usd)
    && ["active_run", "latest_run", "latest_complete", "request_run"].every((key) => validWorkspaceAnalysisRun(value[key]))
    && (!value.active_run || ["queued", "running"].includes((value.active_run as WorkspaceAnalysisRun).status))
    && (!value.latest_complete || (value.latest_complete as WorkspaceAnalysisRun).status === "ready")
    && nullable(value.latest_complete_execution_id, uuid) && validWorkspaceAnalysisUpdate(value.update) && validWorkspaceNumericReadiness(value.numeric_readiness, value.workspace_id as string)
    && validWorkspaceInterpretationAdmission(value.admission, value.workspace_id)
    && validWorkspaceIncrementalEditorial(value.incremental_editorial, value.workspace_id);
}
export function latestWorkspaceAnalysis(current: WorkspaceAnalysisStatus | null, next: WorkspaceAnalysisStatus, workspaceId: string) {
  if (!validWorkspaceAnalysisStatus(next)) return current?.workspace_id === workspaceId ? current : null;
  return latestCorpusEmbeddingSnapshot(current?.request_scope === next.request_scope ? current : null, next, workspaceId);
}
export function workspaceAnalysisStorageKey(workspaceId: string, scope: string) {
  return `noisia:workspace-analysis:v1:${workspaceId}:${scope}`;
}
export function parsePendingWorkspaceAnalysis(value: unknown, workspaceId: string, scope: string): PendingWorkspaceAnalysis | null {
  if (!object(value) || Object.keys(value).sort().join(",") !== "body,key,request_scope,version,workspace_id"
    || value.version !== 1 || value.workspace_id !== workspaceId || value.request_scope !== scope
    || typeof value.key !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/u.test(value.key) || !object(value.body)) return null;
  const body = value.body;
  if (isWorkspaceIncrementalEditorialAction({ action: String(body.action) }))
    return validWorkspaceIncrementalEditorialRequest(body) ? value as PendingWorkspaceAnalysis : null;
  if (body.action === "authorize_interpretation" || body.action === "revoke_interpretation")
    return validWorkspaceAdmissionRequest(body) ? value as PendingWorkspaceAnalysis : null;
  if (body.action === "start" ? Object.keys(body).sort().join(",") !== "action,claude_cap_micro_usd,embedding_run_id,expected_catalog_digest,expected_context_digest"
    || !uuid(body.embedding_run_id) || !digest(body.expected_catalog_digest) || !digest(body.expected_context_digest) || !integer(body.claude_cap_micro_usd)
    : !["retry", "retry_progress", "retry_numeric", "retry_incremental_delivery"].includes(String(body.action)) || Object.keys(body).sort().join(",") !== "action,run_id" || !uuid(body.run_id)) return null;
  return value as PendingWorkspaceAnalysis;
}
export function workspaceAnalysisUnknown(status: WorkspaceAnalysisStatus | null) {
  return Boolean(status?.incremental_editorial?.execution?.has_unresolved_call) || [status?.active_run, status?.latest_run, status?.request_run].some((run) => run
    && (run.outcome_unknown || run.claude_cost.unknown_reserved_micro_usd > 0));
}
export function workspaceAnalysisDefaultCap(status: WorkspaceAnalysisStatus | null) {
  const cost = status?.preflight.cost.claude;
  return embeddingCapUsdInput(String(cost?.estimated_upper_micro_usd ?? cost?.maximum_cap_micro_usd ?? 0));
}
const recoveryFailureCodes = ["workspace_engine_interpretation_output_invalid", "workspace_engine_interpretation_repair_invalid",
  "workspace_engine_interpretation_transport_terminal_confirmed", "workspace_engine_interpretation_transport_retry_exhausted",
  "workspace_engine_interpretation_daily_authority_expired"];
export function workspaceAnalysisRecoveryFailure(status: WorkspaceAnalysisStatus | null) {
  return Boolean(status?.admission?.is_current && status.admission.requires_authorization)
    || [status?.latest_run, status?.request_run].some((run) => run?.status === "failed" && run.is_current
      && recoveryFailureCodes.includes(run.error_code ?? ""));
}
export function workspaceAnalysisCanReleaseChangedRequest(status: WorkspaceAnalysisStatus) {
  const run = status.request_run;
  return Boolean(run?.status === "failed" && !run.is_current && !workspaceAnalysisUnknown(status)
    && recoveryFailureCodes.includes(run.error_code ?? ""));
}
export function workspaceAnalysisUsesIncremental(status: WorkspaceAnalysisStatus | null) {
  return Boolean(status?.incremental_editorial?.preparation?.is_current || status?.incremental_editorial?.admission?.is_current
    || status?.incremental_editorial?.execution?.is_current);
}
export function workspaceAnalysisCanStart(status: WorkspaceAnalysisStatus | null, capInput: string) {
  const cap = parseEmbeddingCapMicroUsd(capInput);
  if (!status || !cap || !status.can_execute || status.active_run || status.update?.has_pending_work || workspaceIncrementalEditorialPending(status.incremental_editorial) || workspaceAnalysisUnknown(status)
    || workspaceAnalysisUsesIncremental(status) || workspaceAnalysisRecoveryFailure(status) || status.preflight.state !== "ready") return false;
  const cost = status.preflight.cost.claude;
  return cost.provider_available && cost.maximum_cap_micro_usd > 0 && BigInt(cap) > 0n
    && (cost.estimated_upper_micro_usd === null || BigInt(cap) >= BigInt(cost.estimated_upper_micro_usd))
    && BigInt(cap) <= BigInt(cost.maximum_cap_micro_usd);
}
export function workspaceAnalysisCanRetry(status: WorkspaceAnalysisStatus | null, run: WorkspaceAnalysisRun | null) {
  return Boolean(status?.can_execute && !status.active_run && !workspaceAnalysisUnknown(status)
    && !(status?.admission?.requires_authorization && status.admission.execution_id === run?.execution_id) && run?.status === "failed" && run.retryable && run.is_current && !run.outcome_unknown
    && run.error_code !== "workspace_engine_interpretation_transport_retry_exhausted"
    && run.error_code !== "workspace_engine_interpretation_daily_authority_expired"
    && (run.error_code !== "workspace_engine_interpretation_transport_terminal_confirmed" || run.transport_recovery_eligible));
}
/** Delivery of already paid results has its own server authority; it never resumes interpretation. */
export function workspaceAnalysisCanRetryProgress(status: WorkspaceAnalysisStatus | null, run: WorkspaceAnalysisRun | null) {
  return Boolean(status?.can_execute && run?.is_current && run.materialization_retry_available
    && !run.materialization_pending && status.latest_run?.execution_id === run.execution_id);
}
export function workspaceAnalysisProgressRequestConfirmed(status: WorkspaceAnalysisStatus, request: PendingWorkspaceAnalysis) {
  return request.body.action === "retry_progress" && status.workspace_id === request.workspace_id
    && status.request_scope === request.request_scope && status.request_run?.execution_id === request.body.run_id;
}
/** Numeric recovery never borrows editorial authorization or provider availability. */
export function workspaceAnalysisCanRetryNumeric(status: WorkspaceAnalysisStatus | null) {
  const numeric = status?.update?.numeric;
  return Boolean(status?.can_execute && numeric?.status === "failed" && numeric.is_current && numeric.retry_available === true);
}
const sameNumericExecution = (left: unknown, right: unknown) => uuid(left) && uuid(right)
  && left.toLowerCase() === right.toLowerCase();
export function workspaceAnalysisNumericRequestConfirmed(status: WorkspaceAnalysisStatus, request: PendingWorkspaceAnalysis) {
  const receipt = status.update?.request_numeric;
  return request.body.action === "retry_numeric" && status.workspace_id === request.workspace_id
    && status.request_scope === request.request_scope && receipt?.action === "retry_numeric"
    && sameNumericExecution(receipt.execution_id, request.body.run_id) && receipt.idempotency_key === request.key;
}
/** Delivery resumes stored associations only; editorial money/authority is a separate request. */
export function workspaceAnalysisCanRetryDelivery(status: WorkspaceAnalysisStatus | null) {
  const update = status?.update;
  return Boolean(status?.can_execute && update?.numeric.status === "ready" && update.numeric.is_current
    && !update.has_pending_work && update.delivery?.phase && update.delivery.retry_available === true);
}
export function workspaceAnalysisDeliveryRequestConfirmed(status: WorkspaceAnalysisStatus, request: PendingWorkspaceAnalysis) {
  const receipt = status.update?.request_delivery;
  return request.body.action === "retry_incremental_delivery" && status.workspace_id === request.workspace_id
    && status.request_scope === request.request_scope && receipt?.action === "retry_incremental_delivery"
    && sameNumericExecution(receipt.execution_id, request.body.run_id) && receipt.idempotency_key === request.key;
}
export function workspaceAnalysisCanReplay(status: WorkspaceAnalysisStatus, request: PendingWorkspaceAnalysis) {
  if (status.workspace_id !== request.workspace_id || status.request_scope !== request.request_scope
    || !status.can_execute) return false;
  // A scoped GET without a receipt permits only replay of the already confirmed
  // body. Expired deadlines or changed CAS must be rejected by the server, never
  // silently replaced with a new authorization or left impossible to resolve.
  if (isWorkspaceAdmissionAction(request.body)) return !status.admission?.request;
  if (isWorkspaceIncrementalEditorialAction(request.body)) return !workspaceIncrementalEditorialHasReceipt(status, request.body);
  if (request.body.action === "retry_incremental_delivery") return !status.update?.request_delivery
    && sameNumericExecution(status.update?.numeric.execution_id, request.body.run_id) && workspaceAnalysisCanRetryDelivery(status);
  if (request.body.action === "retry_numeric") return !status.update?.request_numeric
    && sameNumericExecution(status.update?.numeric.execution_id, request.body.run_id) && workspaceAnalysisCanRetryNumeric(status);
  if (status.request_run) return false;
  if (request.body.action === "retry_progress") return status.latest_run?.execution_id === request.body.run_id
    && workspaceAnalysisCanRetryProgress(status, status.latest_run);
  if (status.active_run || workspaceAnalysisUnknown(status)) return false;
  return request.body.action === "retry"
    ? status.latest_run?.execution_id === request.body.run_id && workspaceAnalysisCanRetry(status, status.latest_run)
    : status.preflight.embedding_run_id === request.body.embedding_run_id
      && status.preflight.context_digest === request.body.expected_context_digest && status.preflight.catalog_digest === request.body.expected_catalog_digest
      && workspaceAnalysisCanStart(status, embeddingCapUsdInput(String(request.body.claude_cap_micro_usd)));
}
export function workspaceAnalysisErrorKey(code: string) {
  if (["workspace_incremental_editorial_source_changed", "workspace_incremental_editorial_source_stale",
    "workspace_incremental_editorial_preparation_source_changed", "workspace_incremental_editorial_preparation_source_stale"].includes(code)) return "changed";
  if (code === "workspace_incremental_editorial_cap_or_deadline_invalid" || code === "workspace_incremental_editorial_admission_changed") return "admissionChanged";
  if (code === "workspace_incremental_editorial_evidence_required") return "incrementalEvidenceRequired";
  if (code.startsWith("workspace_incremental_editorial_preparation_")) return "incrementalPreparationFailed";
  if (code === "workspace_incremental_projection_delivery_unavailable") return "deliveryUnavailable";
  if (code === "workspace_engine_interpretation_admission_changed" || code === "workspace_engine_interpretation_admission_cap_or_deadline_invalid") return "admissionChanged";
  if (code === "workspace_engine_interpretation_admission_unavailable") return "admissionUnavailable";
  if (code === "workspace_engine_interpretation_daily_authority_expired") return "authorizationExpired";
  if (code === "workspace_engine_interpretation_transport_terminal_confirmed") return "transportTerminal";
  if (code === "workspace_engine_interpretation_transport_retry_exhausted") return "transportExhausted";
  if (code === "workspace_engine_interpretation_output_invalid") return "editorialInvalid";
  if (code === "workspace_engine_interpretation_repair_invalid") return "editorialRepairExhausted";
  if (["load", "request", "storage", "forbidden"].includes(code)) return code;
  if (/context|catalog|input|embedding.*changed|stale/u.test(code)) return "changed";
  return "failed";
}
