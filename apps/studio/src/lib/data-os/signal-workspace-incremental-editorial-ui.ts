import type { SignalWorkspaceIncrementalEditorialAdmissionV1, SignalWorkspaceIncrementalEditorialPreparationV1, SignalWorkspaceIncrementalEditorialStatusV1 } from "@noisia/db";

/** Free evidence, paid interpretation and catalog delivery are separate receipts. */
export type WorkspaceIncrementalEditorial = {
  preparation: SignalWorkspaceIncrementalEditorialPreparationV1 | null;
  admission: (Omit<SignalWorkspaceIncrementalEditorialAdmissionV1, "adapter_available"> & {
    adapter_available: boolean; provider_available: boolean;
  }) | null;
  execution?: SignalWorkspaceIncrementalEditorialStatusV1 | null;
};
export type WorkspaceIncrementalEditorialRequest =
  | { action: "prepare_incremental_editorial"; run_id: string; expected_source_digest: string }
  | { action: "begin_incremental_editorial"; run_id: string; expected_evidence_plan_artifact_id: string;
    expected_numeric_checkpoint_digest: string; expected_target_unit_digest: string; expected_history_cut_digest: string;
    cap_micro_usd: number; admission_not_after: string }
  | { action: "revoke_incremental_editorial"; run_id: string; expected_admission_operation_id: string }
  | { action: "retry_incremental_editorial"; run_id: string; expected_worker_job_id: string };
type Scope = { workspace_id: string; request_scope: string; observed_at: string; can_execute: boolean;
  incremental_editorial?: WorkspaceIncrementalEditorial | null };
type Intent = { workspace_id: string; request_scope: string; key: string; body: WorkspaceIncrementalEditorialRequest };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);
const sameId = (a: unknown, b: unknown) => uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
const digest = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/u.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullable = (v: unknown, valid: (value: unknown) => boolean) => v === null || valid(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/u.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === `${v.slice(0, 23)}Z`;
const key = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9._:-]{8,200}$/u.test(v);
const workerJob = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 160;
const timezone = (v: unknown) => { try { return typeof v === "string" && Boolean(new Intl.DateTimeFormat("en", { timeZone: v })); } catch { return false; } };

export function isWorkspaceIncrementalEditorialAction(value: { action: string }): value is WorkspaceIncrementalEditorialRequest {
  return ["prepare_incremental_editorial", "begin_incremental_editorial", "revoke_incremental_editorial", "retry_incremental_editorial"].includes(value.action);
}
export function validWorkspaceIncrementalEditorialRequest(value: unknown): value is WorkspaceIncrementalEditorialRequest {
  if (!object(value) || !uuid(value.run_id)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (value.action === "prepare_incremental_editorial") return keys === "action,expected_source_digest,run_id" && digest(value.expected_source_digest);
  if (value.action === "revoke_incremental_editorial") return keys === "action,expected_admission_operation_id,run_id" && uuid(value.expected_admission_operation_id);
  if (value.action === "retry_incremental_editorial") return keys === "action,expected_worker_job_id,run_id" && workerJob(value.expected_worker_job_id);
  return value.action === "begin_incremental_editorial"
    && keys === "action,admission_not_after,cap_micro_usd,expected_evidence_plan_artifact_id,expected_history_cut_digest,expected_numeric_checkpoint_digest,expected_target_unit_digest,run_id"
    && uuid(value.expected_evidence_plan_artifact_id)
    && ["expected_history_cut_digest", "expected_numeric_checkpoint_digest", "expected_target_unit_digest"].every(field => digest(value[field]))
    && integer(value.cap_micro_usd) && value.cap_micro_usd > 0 && timestamp(value.admission_not_after) && value.admission_not_after.length === 24;
}
function validAdmissionReceipt(value: unknown, workspaceId: string) {
  return object(value) && value.contract_version === "workspace-incremental-editorial-admission-v1" && value.workspace_id === workspaceId
    && ["authorize_interpretation", "revoke_interpretation"].includes(String(value.action))
    && ["operation_id", "execution_id", "numeric_execution_id", "evidence_plan_artifact_id", "authorized_by_user_id", "budget_actor_user_id"].every(field => uuid(value[field]))
    && nullable(value.prior_admission_operation_id, uuid)
    && ["grant_digest", "input_digest", "numeric_checkpoint_digest", "target_unit_digest", "target_binding_digest", "configuration_digest"].every(field => digest(value[field]))
    && ["grant_cap_micro_usd", "run_cap_micro_usd", "daily_cap_micro_usd"].every(field => integer(value[field]))
    && timestamp(value.authorized_at) && timestamp(value.admission_not_after) && timezone(value.budget_timezone)
    && typeof value.budget_date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.budget_date);
}
export function validWorkspaceIncrementalEditorial(value: unknown, workspaceId: string): value is WorkspaceIncrementalEditorial | null | undefined {
  if (value === null || value === undefined) return true;
  if (!object(value) || !validWorkspaceIncrementalEditorialExecution(value.execution, workspaceId)) return false;
  const prep = value.preparation, admission = value.admission;
  if (!(prep === null || object(prep) && uuid(prep.numeric_execution_id) && digest(prep.numeric_checkpoint_digest) && digest(prep.source_digest)
    && ["is_current", "can_prepare", "has_pending_work"].every(field => typeof prep[field] === "boolean") && nullable(prep.blocked_reason, v => typeof v === "string")
    && (prep.preparation === null || object(prep.preparation) && ["pending", "running", "ready", "failed"].includes(String(prep.preparation.status))
      && integer(prep.preparation.attempt_count) && nullable(prep.preparation.error_code, v => typeof v === "string") && nullable(prep.preparation.plan_artifact_id, uuid))
    && (prep.request === null || object(prep.request) && key(prep.request.idempotency_key) && object(prep.request.receipt)
      && prep.request.receipt.contract_version === "workspace-incremental-editorial-preparation-request-v1"
      && prep.request.receipt.workspace_id === workspaceId && uuid(prep.request.receipt.operation_id) && uuid(prep.request.receipt.actor_user_id)
      && uuid(prep.request.receipt.numeric_execution_id) && digest(prep.request.receipt.source_digest) && prep.request.receipt.charge_micro_usd === 0
      && timestamp(prep.request.receipt.requested_at)))) return false;
  return admission === null || object(admission) && uuid(admission.numeric_execution_id)
    && ["numeric_checkpoint_digest", "history_cut_digest"].every(field => digest(admission[field]))
    && ["target_unit_digest", "target_binding_digest"].every(field => nullable(admission[field], digest)) && nullable(admission.evidence_plan_artifact_id, uuid)
    && ["is_current", "can_authorize", "adapter_available", "provider_available"].every(field => typeof admission[field] === "boolean")
    && nullable(admission.blocked_reason, v => typeof v === "string") && admission.model === "claude-sonnet-4-6" && uuid(admission.budget_actor_user_id)
    && timezone(admission.budget_timezone) && timestamp(admission.maximum_admission_not_after)
    && typeof admission.budget_date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(admission.budget_date)
    && ["expected_units", "target_units", "legacy_units", "claimed_units", "daily_cap_micro_usd", "confirmed_micro_usd", "reserved_micro_usd", "terminal_reserved_micro_usd", "maximum_grant_micro_usd"].every(field => integer(admission[field]))
    && Number(admission.target_units) <= Number(admission.expected_units) && Number(admission.terminal_reserved_micro_usd) <= Number(admission.reserved_micro_usd)
    && (admission.operation === null || object(admission.operation) && uuid(admission.operation.execution_id)
      && ["queued", "running", "ready", "failed"].includes(String(admission.operation.status))
      && ["is_current", "can_revoke", "requires_authorization"].every(field => typeof (admission.operation as Record<string, unknown>)[field] === "boolean")
      && validAdmissionReceipt(admission.operation.receipt, workspaceId) && object(admission.operation.receipt)
      && sameId(admission.operation.execution_id, admission.operation.receipt.execution_id))
    && (admission.request === null || object(admission.request) && key(admission.request.idempotency_key) && validAdmissionReceipt(admission.request.receipt, workspaceId));
}
export function validWorkspaceIncrementalEditorialExecution(value: unknown, workspaceId: string): boolean {
  return value === null || value === undefined || object(value) && uuid(value.execution_id)
    && ["queued", "running", "ready", "failed"].includes(String(value.status)) && nullable(value.error_code, v => typeof v === "string")
    && ["is_current", "has_pending_work", "has_unresolved_call", "can_retry", "requires_authorization", "recorded_recovery_available"].every(field => typeof value[field] === "boolean")
    && integer(value.expected_units) && integer(value.interpreted_units) && value.interpreted_units <= value.expected_units
    && (value.dispatch === null || object(value.dispatch) && workerJob(value.dispatch.worker_job_id) && typeof value.dispatch.status === "string")
    && object(value.costs) && ["confirmed_micro_usd", "reserved_micro_usd", "terminal_reserved_micro_usd"].every(field => integer((value.costs as Record<string, unknown>)[field]))
    && Number(value.costs.terminal_reserved_micro_usd) <= Number(value.costs.reserved_micro_usd)
    && (value.request === null || object(value.request) && key(value.request.idempotency_key) && object(value.request.receipt)
      && value.request.receipt.contract_version === "workspace-incremental-editorial-retry-v1" && value.request.receipt.workspace_id === workspaceId
      && sameId(value.request.receipt.execution_id, value.execution_id) && uuid(value.request.receipt.actor_user_id)
      && workerJob(value.request.receipt.worker_job_id) && digest(value.request.receipt.request_digest) && timestamp(value.request.receipt.accepted_at)
      && integer(value.request.receipt.retry_count));
}
export function workspaceIncrementalEditorialRequestConfirmed(status: Scope, intent: Intent) {
  if (status.workspace_id !== intent.workspace_id || status.request_scope !== intent.request_scope) return false;
  const { body } = intent, state = status.incremental_editorial;
  if (body.action === "retry_incremental_editorial") {
    const accepted = state?.execution?.request;
    return accepted?.idempotency_key === intent.key && sameId(accepted.receipt.execution_id, body.run_id)
      && accepted.receipt.worker_job_id === body.expected_worker_job_id;
  }
  if (body.action === "prepare_incremental_editorial") {
    const accepted = state?.preparation?.request;
    return accepted?.idempotency_key === intent.key && sameId(accepted.receipt.numeric_execution_id, body.run_id)
      && accepted.receipt.source_digest === body.expected_source_digest;
  }
  const accepted = state?.admission?.request;
  if (!accepted || accepted.idempotency_key !== intent.key) return false;
  const receipt = accepted.receipt;
  return body.action === "revoke_incremental_editorial"
    ? receipt.action === "revoke_interpretation" && sameId(receipt.execution_id, body.run_id)
      && sameId(receipt.prior_admission_operation_id, body.expected_admission_operation_id)
    : receipt.action === "authorize_interpretation" && sameId(receipt.numeric_execution_id, body.run_id)
      && sameId(receipt.evidence_plan_artifact_id, body.expected_evidence_plan_artifact_id)
      && receipt.numeric_checkpoint_digest === body.expected_numeric_checkpoint_digest && receipt.target_unit_digest === body.expected_target_unit_digest
      && receipt.grant_cap_micro_usd === body.cap_micro_usd && Date.parse(receipt.admission_not_after) === Date.parse(body.admission_not_after);
}
export function workspaceIncrementalEditorialHasReceipt(status: Scope, body: WorkspaceIncrementalEditorialRequest) {
  return Boolean(body.action === "retry_incremental_editorial" ? status.incremental_editorial?.execution?.request
    : body.action === "prepare_incremental_editorial" ? status.incremental_editorial?.preparation?.request : status.incremental_editorial?.admission?.request);
}
export function workspaceIncrementalEditorialCanSubmit(status: Scope, body: WorkspaceIncrementalEditorialRequest) {
  if (!status.can_execute || !validWorkspaceIncrementalEditorialRequest(body)) return false;
  const state = status.incremental_editorial, prep = state?.preparation, admission = state?.admission;
  if (body.action === "retry_incremental_editorial") {
    const run = state?.execution;
    return Boolean(run?.can_retry && run.is_current && run.status === "failed" && !run.has_pending_work && !run.has_unresolved_call
      && sameId(run.execution_id, body.run_id) && run.dispatch?.worker_job_id === body.expected_worker_job_id);
  }
  if (body.action === "prepare_incremental_editorial") return Boolean(prep?.can_prepare && prep.is_current && !prep.has_pending_work
    && sameId(prep.numeric_execution_id, body.run_id) && prep.source_digest === body.expected_source_digest);
  if (!admission) return false;
  if (body.action === "revoke_incremental_editorial") return Boolean(admission.operation?.can_revoke
    && sameId(admission.operation.execution_id, body.run_id) && admission.operation.receipt.action === "authorize_interpretation"
    && sameId(admission.operation.receipt.operation_id, body.expected_admission_operation_id));
  return admission.can_authorize && admission.is_current && admission.provider_available && admission.adapter_available
    && admission.model === "claude-sonnet-4-6" && sameId(admission.numeric_execution_id, body.run_id)
    && sameId(admission.evidence_plan_artifact_id, body.expected_evidence_plan_artifact_id)
    && admission.numeric_checkpoint_digest === body.expected_numeric_checkpoint_digest && admission.history_cut_digest === body.expected_history_cut_digest
    && admission.target_unit_digest === body.expected_target_unit_digest && admission.target_units > 0
    && body.cap_micro_usd <= admission.maximum_grant_micro_usd && Date.parse(body.admission_not_after) > Date.parse(status.observed_at)
    && Date.parse(body.admission_not_after) <= Date.parse(admission.maximum_admission_not_after);
}
/** Only durable work is polled. A prepared plan never authorizes or sends Claude. */
export function workspaceIncrementalEditorialPending(value: WorkspaceIncrementalEditorial | null | undefined) {
  return value?.preparation?.has_pending_work ? value.preparation.numeric_execution_id
    : value?.execution?.has_pending_work ? value.execution.execution_id : null;
}
