"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { embeddingCapUsdInput, formatEmbeddingMicroUsd, parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { formatWorkspaceAdmissionExpiry } from "@/lib/data-os/signal-workspace-interpretation-admission-ui";
import { workspaceIncrementalEditorialCanSubmit, type WorkspaceIncrementalEditorialRequest } from "@/lib/data-os/signal-workspace-incremental-editorial-ui";
import type { WorkspaceAnalysisStatus } from "@/lib/data-os/signal-workspace-analysis-ui";

/** Uses the analysis request ledger; preparing evidence never authorizes a call. */
export function WorkspaceIncrementalEditorialControls({ status, canSubmit, canRevoke, submitting, pendingRequest = null, canReplay, onReplay, onSubmit }: {
  status: WorkspaceAnalysisStatus; canSubmit: boolean; canRevoke: boolean; submitting: boolean;
  pendingRequest?: WorkspaceIncrementalEditorialRequest | null; canReplay: boolean; onReplay: () => Promise<unknown>;
  onSubmit: (body: WorkspaceIncrementalEditorialRequest) => Promise<unknown>;
}) {
  const t = useTranslations("AdminWorkspace.topics.analysis.incrementalEditorial"), locale = useLocale();
  const [edited, setEdited] = useState<{ identity: string; value: string } | null>(null);
  const state = status.incremental_editorial;
  if (!state) return null;
  const prep = state.preparation, admission = state.admission, operation = admission?.operation, execution = state.execution;
  const catalog = status.update?.catalog_receipt;
  const hasDetails = Boolean(operation || execution || admission && (admission.can_authorize || admission.legacy_units > 0 || admission.claimed_units > 0));
  const identity = JSON.stringify([status.workspace_id, status.request_scope, admission?.numeric_execution_id,
    admission?.evidence_plan_artifact_id, admission?.history_cut_digest, admission?.target_unit_digest,
    admission?.maximum_grant_micro_usd, admission?.maximum_admission_not_after]);
  const cap = edited?.identity === identity ? edited.value : embeddingCapUsdInput(String(admission?.maximum_grant_micro_usd ?? 0));
  const parsed = parseEmbeddingCapMicroUsd(cap), amount = parsed !== null && BigInt(parsed) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
  const money = (value: number) => formatEmbeddingMicroUsd(String(value), locale);
  const expiry = (value: string, zone: string) => formatWorkspaceAdmissionExpiry(value, zone, locale);
  const begin: WorkspaceIncrementalEditorialRequest | null = admission?.evidence_plan_artifact_id && admission.target_unit_digest && amount !== null ? {
    action: "begin_incremental_editorial", run_id: admission.numeric_execution_id,
    expected_evidence_plan_artifact_id: admission.evidence_plan_artifact_id, expected_numeric_checkpoint_digest: admission.numeric_checkpoint_digest,
    expected_target_unit_digest: admission.target_unit_digest, expected_history_cut_digest: admission.history_cut_digest,
    cap_micro_usd: amount, admission_not_after: admission.maximum_admission_not_after
  } : null;
  const preparationRequest: WorkspaceIncrementalEditorialRequest | null = prep ? {
    action: "prepare_incremental_editorial", run_id: prep.numeric_execution_id, expected_source_digest: prep.source_digest
  } : null;
  const retry: WorkspaceIncrementalEditorialRequest | null = execution?.dispatch ? {
    action: "retry_incremental_editorial", run_id: execution.execution_id, expected_worker_job_id: execution.dispatch.worker_job_id
  } : null;
  const blocked = admission?.blocked_reason?.includes("forbidden") ? "permission" : admission?.blocked_reason?.includes("stale") || admission?.blocked_reason?.includes("changed") ? "changed"
    : admission?.blocked_reason?.includes("budget") || admission?.blocked_reason?.includes("cap") ? "budgetUnavailable" : "unavailable";
  return <div className="admin-drawer-form" data-incremental-editorial style={{ borderTop: "1px solid var(--workspace-border)", paddingTop: 16 }}>
    <strong>{t("title")}</strong>
    {!operation && !execution ? <p className="admin-drawer-form__hint">{t("body")}</p> : null}
    {prep?.preparation && (prep.preparation.status !== "ready" || !operation && !execution) ? <p role="status">{t(`preparation.${prep.preparation.status}`)}</p> : null}
    {prep && !prep.is_current ? <p role="status">{t("changed")}</p> : null}
    {preparationRequest && prep?.can_prepare && !pendingRequest ? <>
      <p className="admin-drawer-form__hint">{t("prepareFree")}</p>
      <div className="admin-form-actions"><button type="button" className="admin-button" disabled={!canSubmit || submitting || !workspaceIncrementalEditorialCanSubmit(status, preparationRequest)}
        onClick={() => void onSubmit(preparationRequest)}>{t(prep.preparation?.status === "failed" ? "retryPreparation" : "prepare")}</button></div>
    </> : !prep?.preparation && prep?.blocked_reason === "forbidden" ? <p role="status">{t("permission")}</p> : null}
    {admission ? <>
      {!execution ? <p className="admin-drawer-form__hint">{t("targetUnits", { count: admission.target_units })}</p> : null}
      {operation?.requires_authorization && !execution ? <p role="status">{t("stopped")}</p> : null}
      {admission.can_authorize && !pendingRequest ? <>
        <p>{t("confirmBody", { count: admission.target_units, model: "Claude Sonnet 4.6" })}</p>
        <label className="admin-field" style={{ maxWidth: 360 }}><span>{t("cap", { amount: money(admission.maximum_grant_micro_usd) })}</span>
          <input inputMode="decimal" value={cap} disabled={!canSubmit || submitting} onChange={event => setEdited({ identity, value: event.target.value })} /></label>
        <p>{t("expiry", { expiry: expiry(admission.maximum_admission_not_after, admission.budget_timezone), zone: admission.budget_timezone })}</p>
        {!admission.provider_available || !admission.adapter_available ? <p role="status">{t("providerUnavailable")}</p> : null}
        {amount === null || amount <= 0 || amount > admission.maximum_grant_micro_usd ? <p role="alert" className="workspace-form__error">{t("invalidCap")}</p> : null}
        <div className="admin-form-actions"><button type="button" className="admin-button admin-button--primary"
          disabled={!canSubmit || submitting || !begin || !workspaceIncrementalEditorialCanSubmit(status, begin)}
          onClick={() => { if (begin) void onSubmit(begin); }}>{t("authorize")}</button></div>
      </> : !pendingRequest && !operation && !execution && prep?.preparation?.status === "ready" ? <p role="status">{t(admission.target_units === 0 ? "noTargets" : blocked)}</p> : null}
    </> : null}
    {execution ? <div className="admin-drawer-form" data-incremental-editorial-execution>
      <p role="status">{t(["queued", "running"].includes(execution.status) && !execution.has_pending_work ? "noDispatch" : `operation.${execution.status}`)}</p>
      <p>{t("executionProgress", { interpreted: execution.interpreted_units, expected: execution.expected_units })}</p>
      {!execution.is_current ? <p role="status">{t("changed")}</p> : null}
      {execution.has_unresolved_call ? <p role="alert">{t("unknown")}</p> : execution.requires_authorization ? <p role="status">{t("stopped")}</p> : null}
      {execution.status === "failed" && !execution.can_retry && !execution.has_unresolved_call && !execution.recorded_recovery_available && admission?.provider_available === false ? <p role="status">{t("providerUnavailable")}</p> : null}
      {["workspace_engine_interpretation_output_invalid", "workspace_engine_interpretation_repair_invalid"].includes(execution.error_code ?? "") ? <p role="alert">{t("invalidResult")}</p> : null}
      {retry && execution.can_retry && !pendingRequest ? <>
        <p className="admin-drawer-form__hint">{t(execution.recorded_recovery_available ? "recoverSaved" : "retryEffect")}</p>
        <button className="admin-button" type="button" disabled={!canSubmit || submitting || !workspaceIncrementalEditorialCanSubmit(status, retry)}
          onClick={() => void onSubmit(retry)}>{t(execution.recorded_recovery_available ? "recover" : "retry")}</button>
      </> : null}
    </div> : null}
      {operation?.can_revoke && operation.receipt.action === "authorize_interpretation" ? <>
        <p className="admin-drawer-form__hint">{t("stopEffect")}</p>
        <button type="button" className="admin-button" disabled={!canRevoke || submitting} onClick={() => void onSubmit({ action: "revoke_incremental_editorial",
          run_id: operation.execution_id, expected_admission_operation_id: operation.receipt.operation_id })}>{t("revoke")}</button>
      </> : null}
    {catalog ? <p role="status">{t("catalogSaved", { count: catalog.topic_count })}</p> : null}
    {pendingRequest ? <p role="status">{pendingRequest.action === "begin_incremental_editorial" ? t("pendingGrant", { amount: money(pendingRequest.cap_micro_usd),
      expiry: expiry(pendingRequest.admission_not_after, admission?.budget_timezone ?? "UTC"), zone: admission?.budget_timezone ?? "UTC" })
      : t(pendingRequest.action === "revoke_incremental_editorial" ? "pendingRevoke" : pendingRequest.action === "retry_incremental_editorial" ? "pendingRetry" : "pendingPreparation")}</p> : null}
    {canReplay && pendingRequest ? <button type="button" className="admin-button" onClick={() => void onReplay()}>{t("replay")}</button> : null}
    {hasDetails ? <details className="admin-topic-analysis__complete" data-incremental-editorial-details>
      <summary>{t("details")}</summary>
      <div className="admin-drawer-form">
        {prep?.preparation?.status === "ready" && (operation || execution) ? <p className="admin-drawer-form__hint">{t("evidenceSaved")}</p> : null}
        {admission ? <>
      {admission.legacy_units > 0 ? <p className="admin-drawer-form__hint">{t("legacyUnits", { count: admission.legacy_units })}</p> : null}
      {admission.claimed_units > 0 ? <p className="admin-drawer-form__hint">{t("claimedUnits", { count: admission.claimed_units })}</p> : null}
          {admission.can_authorize ? <>
        <p className="admin-drawer-form__hint">{t("budget", { confirmed: money(admission.confirmed_micro_usd), reserved: money(admission.reserved_micro_usd), daily: money(admission.daily_cap_micro_usd), date: admission.budget_date, zone: admission.budget_timezone })}</p>
        {admission.terminal_reserved_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("terminal", { amount: money(admission.terminal_reserved_micro_usd) })}</p> : null}
          </> : null}
        </> : null}
      {operation?.receipt ? <p className="admin-drawer-form__hint">{t(operation.receipt.action === "revoke_interpretation" ? "revoked" : "grantReceipt", {
        amount: money(operation.receipt.grant_cap_micro_usd), expiry: expiry(operation.receipt.admission_not_after, operation.receipt.budget_timezone), zone: operation.receipt.budget_timezone
      })}</p> : null}
        {execution ? <>
      <p className="admin-drawer-form__hint">{t("executionCost", { confirmed: money(execution.costs.confirmed_micro_usd), reserved: money(execution.costs.reserved_micro_usd) })}</p>
      {execution.costs.terminal_reserved_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("terminal", { amount: money(execution.costs.terminal_reserved_micro_usd) })}</p> : null}
        </> : null}
      </div>
    </details> : null}
  </div>;
}
