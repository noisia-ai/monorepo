import type { SignalWorkspaceInterpretationAdmissionStatusV1, SignalWorkspaceInterpretationAdmissionV1 } from "@noisia/db";

export type WorkspaceInterpretationAdmission = SignalWorkspaceInterpretationAdmissionStatusV1 & { provider_available: boolean };
export type WorkspaceInterpretationAdmissionRequest =
  | { action: "authorize_interpretation"; run_id: string; expected_admission_operation_id: string | null;
    grant_cap_micro_usd: number; admission_not_after: string }
  | { action: "revoke_interpretation"; run_id: string; expected_admission_operation_id: string };
type Scope = { workspace_id: string; request_scope: string; observed_at: string; admission?: WorkspaceInterpretationAdmission | null };
type Intent = { workspace_id: string; request_scope: string; key: string; body: WorkspaceInterpretationAdmissionRequest };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const sameId = (left: unknown, right: unknown) => left === null && right === null || uuid(left) && uuid(right) && left.toLowerCase() === right.toLowerCase();
const amount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === `${value.slice(0, 23)}Z`;
const digest = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const key = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{8,200}$/u.test(value);
const timezone = (value: unknown) => { try { return typeof value === "string" && Boolean(new Intl.DateTimeFormat("en", { timeZone: value })); } catch { return false; } };

export function isWorkspaceAdmissionAction(value: { action: string }): value is WorkspaceInterpretationAdmissionRequest {
  return value.action === "authorize_interpretation" || value.action === "revoke_interpretation";
}
export function validWorkspaceAdmissionRequest(value: unknown): value is WorkspaceInterpretationAdmissionRequest {
  if (!object(value) || !uuid(value.run_id)) return false;
  if (value.action === "revoke_interpretation") return Object.keys(value).sort().join(",") === "action,expected_admission_operation_id,run_id" && uuid(value.expected_admission_operation_id);
  return value.action === "authorize_interpretation" && Object.keys(value).sort().join(",") === "action,admission_not_after,expected_admission_operation_id,grant_cap_micro_usd,run_id"
    && (value.expected_admission_operation_id === null || uuid(value.expected_admission_operation_id))
    && amount(value.grant_cap_micro_usd) && value.grant_cap_micro_usd > 0 && timestamp(value.admission_not_after) && value.admission_not_after.length === 24;
}
function validReceipt(value: unknown, workspaceId: string): value is SignalWorkspaceInterpretationAdmissionV1 {
  return object(value) && value.contract_version === "workspace-interpretation-admission-v1" && value.workspace_id === workspaceId
    && ["authorize_interpretation", "revoke_interpretation"].includes(String(value.action))
    && ["operation_id", "execution_id", "authorized_by_user_id", "budget_actor_user_id"].every(field => uuid(value[field]))
    && (value.prior_admission_operation_id === null || uuid(value.prior_admission_operation_id))
    && ["grant_digest", "input_digest", "fit_checkpoint_digest", "configuration_digest"].every(field => digest(value[field]))
    && (value.interpretation_revision_digest === null || digest(value.interpretation_revision_digest))
    && typeof value.budget_date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.budget_date) && timezone(value.budget_timezone)
    && timestamp(value.authorized_at) && timestamp(value.admission_not_after)
    && ["grant_cap_micro_usd", "run_cap_micro_usd", "daily_cap_micro_usd"].every(field => amount(value[field]));
}
export function validWorkspaceInterpretationAdmission(value: unknown, workspaceId: string): value is WorkspaceInterpretationAdmission | null | undefined {
  return value === null || value === undefined || object(value) && uuid(value.execution_id)
    && ["is_current", "can_authorize", "can_revoke", "requires_authorization", "provider_available"].every(field => typeof value[field] === "boolean")
    && (value.blocked_reason === null || typeof value.blocked_reason === "string") && [null, "claude-sonnet-4-6"].includes(value.model as null | string)
    && typeof value.budget_date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.budget_date) && timezone(value.budget_timezone)
    && timestamp(value.maximum_admission_not_after)
    && ["confirmed_micro_usd", "reserved_micro_usd", "terminal_reserved_micro_usd", "run_cap_micro_usd", "daily_cap_micro_usd", "maximum_grant_micro_usd"].every(field => amount(value[field]))
    && Number(value.terminal_reserved_micro_usd) <= Number(value.reserved_micro_usd)
    && (value.current === null || validReceipt(value.current, workspaceId) && sameId(value.current.execution_id, value.execution_id))
    && (value.request === null || object(value.request) && key(value.request.idempotency_key) && validReceipt(value.request.receipt, workspaceId));
}
export function workspaceAdmissionRequestConfirmed(status: Scope, request: Intent) {
  const accepted = status.admission?.request;
  if (status.workspace_id !== request.workspace_id || status.request_scope !== request.request_scope
    || !accepted || accepted.idempotency_key !== request.key) return false;
  const receipt = accepted.receipt;
  return receipt.action === request.body.action && sameId(receipt.execution_id, request.body.run_id)
    && sameId(receipt.prior_admission_operation_id, request.body.expected_admission_operation_id)
    && (request.body.action !== "authorize_interpretation" || receipt.grant_cap_micro_usd === request.body.grant_cap_micro_usd
      && Date.parse(receipt.admission_not_after) === Date.parse(request.body.admission_not_after));
}
export function workspaceAdmissionCanSubmit(status: Scope, body: WorkspaceInterpretationAdmissionRequest) {
  const admission = status.admission;
  if (!admission || !validWorkspaceAdmissionRequest(body) || !sameId(admission.execution_id, body.run_id)
    || !sameId(admission.current?.operation_id ?? null, body.expected_admission_operation_id)) return false;
  if (body.action === "revoke_interpretation") return admission.can_revoke && admission.current?.action === "authorize_interpretation";
  return admission.can_authorize && admission.is_current && admission.provider_available && admission.model === "claude-sonnet-4-6"
    && body.grant_cap_micro_usd <= admission.maximum_grant_micro_usd
    && Date.parse(body.admission_not_after) <= Date.parse(admission.maximum_admission_not_after)
    && Date.parse(body.admission_not_after) > Date.parse(status.observed_at);
}
export function formatWorkspaceAdmissionExpiry(value: string, zone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(value));
}
