"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { embeddingCapUsdInput, formatEmbeddingMicroUsd, parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { formatWorkspaceAdmissionExpiry, workspaceAdmissionCanSubmit,
  type WorkspaceInterpretationAdmissionRequest } from "@/lib/data-os/signal-workspace-interpretation-admission-ui";
import type { WorkspaceAnalysisStatus } from "@/lib/data-os/signal-workspace-analysis-ui";

export function WorkspaceInterpretationAdmissionControls({ status, canAuthorize, canRevoke, submitting, pendingRequest = null, receiptsAlreadyVisible = false, onSubmit }: {
  status: WorkspaceAnalysisStatus; canAuthorize: boolean; canRevoke: boolean; submitting: boolean;
  pendingRequest?: WorkspaceInterpretationAdmissionRequest | null; receiptsAlreadyVisible?: boolean;
  onSubmit: (body: WorkspaceInterpretationAdmissionRequest) => Promise<unknown>;
}) {
  const t = useTranslations("AdminWorkspace.topics.analysis.admissionGrant"), locale = useLocale();
  const admission = status.admission;
  const [edited, setEdited] = useState<{ identity: string; value: string } | null>(null);
  if (!admission || !admission.requires_authorization && !admission.current && !admission.request) return null;
  const identity = JSON.stringify([status.workspace_id, status.request_scope, admission.execution_id,
    admission.current?.operation_id, admission.maximum_grant_micro_usd, admission.maximum_admission_not_after]);
  const cap = edited?.identity === identity ? edited.value : embeddingCapUsdInput(String(admission.maximum_grant_micro_usd));
  const amount = parseEmbeddingCapMicroUsd(cap), numeric = amount !== null && BigInt(amount) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
  const money = (value: number) => formatEmbeddingMicroUsd(String(value), locale);
  const deadline = formatWorkspaceAdmissionExpiry(admission.maximum_admission_not_after, admission.budget_timezone, locale);
  const body: WorkspaceInterpretationAdmissionRequest | null = numeric === null ? null : { action: "authorize_interpretation",
    run_id: admission.execution_id, expected_admission_operation_id: admission.current?.operation_id ?? null,
    grant_cap_micro_usd: numeric, admission_not_after: admission.maximum_admission_not_after };
  const blocked = admission.blocked_reason === "workspace_engine_interpretation_admission_forbidden" ? "permissionRequired"
    : admission.blocked_reason === "workspace_engine_inputs_stale" ? "inputsChanged"
      : admission.blocked_reason === "workspace_engine_interpretation_admission_cap_exceeded" ? "budgetUnavailable" : "unavailable";
  const enabled = Boolean(canAuthorize && body && workspaceAdmissionCanSubmit(status, body));
  return <div className="admin-drawer-form" style={{ borderTop: "1px solid var(--workspace-border)", paddingTop: 16 }} data-interpretation-admission={admission.current?.action ?? "none"}>
    <strong>{t("title")}</strong>
    {!receiptsAlreadyVisible ? <p className="admin-drawer-form__hint">{t("receipts", { confirmed: money(admission.confirmed_micro_usd), reserved: money(admission.reserved_micro_usd) })}
      {admission.terminal_reserved_micro_usd > 0 ? <> {t("terminal", { amount: money(admission.terminal_reserved_micro_usd) })}</> : null}</p> : null}
    {admission.current ? <p className="admin-drawer-form__hint">{t(admission.current.action === "revoke_interpretation" ? "revoked" : "recorded", {
      amount: money(admission.current.grant_cap_micro_usd), expiry: formatWorkspaceAdmissionExpiry(admission.current.admission_not_after, admission.current.budget_timezone, locale), zone: admission.current.budget_timezone
    })}</p> : null}
    {pendingRequest?.action === "authorize_interpretation" ? <p role="status">{t("pendingGrant", {
      amount: money(pendingRequest.grant_cap_micro_usd), expiry: formatWorkspaceAdmissionExpiry(pendingRequest.admission_not_after,
        pendingRequest.run_id.toLowerCase() === admission.execution_id.toLowerCase() ? admission.budget_timezone : "UTC", locale),
      zone: pendingRequest.run_id.toLowerCase() === admission.execution_id.toLowerCase() ? admission.budget_timezone : "UTC"
    })}</p> : pendingRequest?.action === "revoke_interpretation" ? <p role="status">{t("pendingStop")}</p> : null}
    {admission.can_authorize && !pendingRequest ? <>
      <p className="admin-drawer-form__hint">{t("sameRun")}</p>
      <label className="admin-field" style={{ maxWidth: 360 }}><span>{t("cap", { amount: money(admission.maximum_grant_micro_usd) })}</span>
        <input inputMode="decimal" value={cap} disabled={!canAuthorize || submitting} onChange={event => setEdited({ identity, value: event.target.value })} /></label>
      <p>{t("expires", { expiry: deadline, zone: admission.budget_timezone })}</p>
      <p className="admin-drawer-form__hint">{t("limits", { run: money(admission.run_cap_micro_usd), daily: money(admission.daily_cap_micro_usd) })}{" "}{t("partial")}</p>
      {!admission.provider_available ? <p role="status">{t("providerDisabled")}</p> : null}
      {numeric === null || numeric <= 0 || numeric > admission.maximum_grant_micro_usd ? <p className="workspace-form__error" role="alert">{t("invalidCap")}</p> : null}
      <div className="admin-form-actions"><button type="button" className="admin-button admin-button--primary" disabled={!enabled || submitting}
        onClick={() => { if (body && enabled) void onSubmit(body); }}>{t("authorize")}</button></div>
    </> : admission.requires_authorization && !pendingRequest ? <p className="admin-drawer-form__hint" role="status">{t(blocked)}</p> : null}
    {admission.can_revoke && admission.current?.action === "authorize_interpretation" ? <>
      <p className="admin-drawer-form__hint">{t("stopEffect")}</p>
      <button type="button" className="admin-button" disabled={!canRevoke || submitting} onClick={() => { if (admission.current && canRevoke) void onSubmit({
        action: "revoke_interpretation", run_id: admission.execution_id, expected_admission_operation_id: admission.current.operation_id
      }); }}>{t("revoke")}</button>
    </> : null}
  </div>;
}
