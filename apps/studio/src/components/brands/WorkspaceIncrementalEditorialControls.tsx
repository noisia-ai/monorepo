"use client";

import { useEffect, useRef, useState } from "react";
import type { IncrementalEditorialQuote } from "@/lib/data-os/incremental-editorial-quote";
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
  const [quoted, setQuoted] = useState<{ identity: string; quote: IncrementalEditorialQuote } | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false), [quoteError, setQuoteError] = useState(false);
  const quoteSequence = useRef(0);
  const quoteController = useRef<AbortController | null>(null);
  useEffect(() => () => { quoteController.current?.abort(); }, []);
  useEffect(() => {
    if (!quoted) return;
    const timer = setTimeout(() => { setQuoted(null); setConfirmed(null); }, Math.max(0, Date.parse(quoted.quote.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [quoted]);
  const state = status.incremental_editorial;
  if (!state) return null;
  const prep = state.preparation, admission = state.admission, operation = admission?.operation, execution = state.execution;
  const catalog = status.update?.catalog_receipt;
  const renewal = execution?.renewal?.can_renew && !execution.recorded_recovery_available ? execution.renewal : null;
  const authorization = execution?.recorded_recovery_available ? null : renewal ?? (admission?.can_authorize ? admission : null);
  const remaining = execution ? execution.expected_units - execution.interpreted_units : 0;
  const hasDetails = Boolean(operation || execution || admission && (admission.can_authorize || admission.legacy_units > 0 || admission.claimed_units > 0));
  const identity = JSON.stringify([status.workspace_id, status.request_scope, admission?.numeric_execution_id,
    admission?.evidence_plan_artifact_id, admission?.history_cut_digest, admission?.target_unit_digest,
    authorization?.maximum_grant_micro_usd, authorization?.maximum_admission_not_after,
    renewal?.execution_id, renewal?.expected_admission_operation_id]);
  const cap = edited?.identity === identity ? edited.value : (authorization?.maximum_grant_micro_usd===null?"":embeddingCapUsdInput(String(authorization?.maximum_grant_micro_usd ?? 0)));
  const parsed = parseEmbeddingCapMicroUsd(cap), amount = parsed !== null && BigInt(parsed) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
  const optionalCap=authorization?.maximum_grant_micro_usd===null && cap.trim()==="";
  const validCap=optionalCap || amount!==null && amount>0 && (authorization?.maximum_grant_micro_usd==null || amount<=authorization.maximum_grant_micro_usd);
  const money = (value: number|null) => value===null?t("uncapped"):formatEmbeddingMicroUsd(String(value), locale);
  const expiry = (value: string, zone: string) => value.startsWith("9999-")?t("noDeadline"):formatWorkspaceAdmissionExpiry(value, zone, locale);
  const begin: WorkspaceIncrementalEditorialRequest | null = admission?.evidence_plan_artifact_id && admission.target_unit_digest && validCap ? {
    action: "begin_incremental_editorial", run_id: admission.numeric_execution_id,
    expected_evidence_plan_artifact_id: admission.evidence_plan_artifact_id, expected_numeric_checkpoint_digest: admission.numeric_checkpoint_digest,
    expected_target_unit_digest: admission.target_unit_digest, expected_history_cut_digest: admission.history_cut_digest,
    cap_micro_usd: amount, admission_not_after: admission.maximum_admission_not_after
  } : null;
  const confirmation: WorkspaceIncrementalEditorialRequest | null = renewal && validCap ? {
    action: "renew_incremental_editorial", run_id: renewal.execution_id,
    expected_admission_operation_id: renewal.expected_admission_operation_id, grant_cap_micro_usd: amount,
    admission_not_after: renewal.maximum_admission_not_after
  } : begin;
  const quoteIdentity = `${identity}:${cap}`;
  const quote = quoted?.identity === quoteIdentity && Date.parse(quoted.quote.expires_at) > Date.now() ? quoted.quote : null;
  const paidConfirmed = Boolean(quote && confirmed === quoteIdentity);
  const requestQuote = async () => {
    if (!confirmation || !authorization) return;
    quoteController.current?.abort();
    const controller = new AbortController(); quoteController.current = controller;
    const sequence = ++quoteSequence.current;
    setQuoting(true); setQuoteError(false); setQuoted(null); setConfirmed(null);
    try {
      const params = new URLSearchParams({ action: confirmation.action, run_id: confirmation.run_id });
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(status.workspace_id)}/topics/analysis/incremental-quote?${params}`, { cache: "no-store", signal: controller.signal });
      const value: unknown = await response.json();
      if (!response.ok || !value || typeof value !== "object") throw new Error("quote_unavailable");
      const result = value as IncrementalEditorialQuote;
      if (!/^iq1\.[0-9]{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/u.test(result.reference) || result.model !== "claude-sonnet-4-6"
        || !Number.isSafeInteger(result.estimated_micro_usd) || result.estimated_micro_usd < 0 || result.target_units !== (renewal ? remaining : admission?.target_units)
        || !Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now()) throw new Error("quote_invalid");
      if (!controller.signal.aborted && sequence === quoteSequence.current) setQuoted({ identity: quoteIdentity, quote: result });
    } catch { if (!controller.signal.aborted && sequence === quoteSequence.current) setQuoteError(true); }
    finally { if (!controller.signal.aborted && sequence === quoteSequence.current) setQuoting(false); }
  };
  const preparationRequest: WorkspaceIncrementalEditorialRequest | null = prep ? {
    action: "prepare_incremental_editorial", run_id: prep.numeric_execution_id, expected_source_digest: prep.source_digest
  } : null;
  const retry: WorkspaceIncrementalEditorialRequest | null = execution?.dispatch ? {
    action: "retry_incremental_editorial", run_id: execution.execution_id, expected_worker_job_id: execution.dispatch.worker_job_id
  } : null;
  const blocked = admission?.blocked_reason?.includes("forbidden") ? "permission" : admission?.blocked_reason?.includes("stale") || admission?.blocked_reason?.includes("changed") ? "changed"
    : admission?.blocked_reason?.includes("budget") || admission?.blocked_reason?.includes("cap") ? "budgetUnavailable" : "unavailable";
  const renewalBlocked = execution?.status === "failed" && execution.renewal && !execution.renewal.can_renew
    && !execution.recorded_recovery_available && !execution.has_unresolved_call ? ({
      workspace_incremental_editorial_cap_exceeded: "budgetUnavailable",
      workspace_incremental_editorial_forbidden: "permission",
      workspace_incremental_editorial_source_stale: execution.is_current ? "changed" : null
    } as Record<string, "budgetUnavailable" | "permission" | "changed" | null>)[execution.renewal.blocked_reason ?? ""] : null;
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
      {!authorization && !pendingRequest && !operation && !execution && prep?.preparation?.status === "ready" ? <p role="status">{t(admission.target_units === 0 ? "noTargets" : blocked)}</p> : null}
    </> : null}
    {execution ? <div className="admin-drawer-form" data-incremental-editorial-execution>
      <p role="status">{t(["queued", "running"].includes(execution.status) && !execution.has_pending_work ? "noDispatch" : `operation.${execution.status}`)}</p>
      <p>{t("executionProgress", { interpreted: execution.interpreted_units, expected: execution.expected_units })}</p>
      {!execution.is_current ? <p role="status">{t("changed")}</p> : null}
      {execution.has_unresolved_call ? <p role="alert">{t("unknown")}</p> : execution.requires_authorization && !execution.recorded_recovery_available ? <p role="status">{t("stopped")}</p> : null}
      {execution.status === "failed" && !authorization && !execution.can_retry && !execution.has_unresolved_call && !execution.recorded_recovery_available && admission?.provider_available === false ? <p role="status">{t("providerUnavailable")}</p> : null}
      {renewalBlocked ? <p role="status">{t(renewalBlocked)}</p> : null}
      {["workspace_engine_interpretation_output_invalid", "workspace_engine_interpretation_repair_invalid"].includes(execution.error_code ?? "") ? <p role="alert">{t("invalidResult")}</p> : null}
      {retry && execution.can_retry && !pendingRequest ? <>
        <p className="admin-drawer-form__hint">{t(execution.recorded_recovery_available ? "recoverSaved" : "retryEffect")}</p>
        <button className="admin-button" type="button" disabled={!canSubmit || submitting || !workspaceIncrementalEditorialCanSubmit(status, retry)}
          onClick={() => void onSubmit(retry)}>{t(execution.recorded_recovery_available ? "recover" : "retry")}</button>
      </> : null}
    </div> : null}
      {authorization && !pendingRequest ? <>
        <p>{t(renewal ? "renewBody" : "confirmBody", { count: renewal ? remaining : admission?.target_units ?? 0, model: "Claude Sonnet 4.6" })}</p>
        <label className="admin-field" style={{ maxWidth: 360 }}><span>{t(authorization.maximum_grant_micro_usd===null?"optionalCap":renewal ? "renewCap" : "cap", { amount: money(authorization.maximum_grant_micro_usd) })}</span>
          <input inputMode="decimal" value={cap} disabled={!canSubmit || submitting} onChange={event => setEdited({ identity, value: event.target.value })} /></label>
        <p>{t("expiry", { expiry: expiry(authorization.maximum_admission_not_after, authorization.budget_timezone), zone: authorization.budget_timezone })}</p>
        <button type="button" className="admin-button" disabled={!canSubmit || submitting || quoting || !validCap} onClick={() => void requestQuote()}>{t(quoting ? "quoting" : "quote")}</button>
        {quoteError ? <p role="alert">{t("quoteError")}</p> : null}
        {quote ? <>
          <p>{t("quoteEstimate", { amount: money(quote.estimated_micro_usd), count: quote.target_units, model: "Claude Sonnet 4.6" })}</p>
          <p className="admin-drawer-form__hint">{t("quoteHelp", { expiry: formatWorkspaceAdmissionExpiry(quote.expires_at, authorization.budget_timezone, locale) })}</p>
          <label className="admin-field"><span><input type="checkbox" checked={confirmed === quoteIdentity} disabled={submitting}
            onChange={event => setConfirmed(event.target.checked ? quoteIdentity : null)} /> {t("quoteConfirm")}</span></label>
        </> : null}
        {!admission?.provider_available || !admission.adapter_available ? <p role="status">{t("providerUnavailable")}</p> : null}
        {!validCap ? <p role="alert" className="workspace-form__error">{t("invalidCap")}</p> : null}
        <div className="admin-form-actions"><button type="button" className="admin-button admin-button--primary"
          disabled={!canSubmit || submitting || !confirmation || !paidConfirmed || !workspaceIncrementalEditorialCanSubmit(status, confirmation)}
          onClick={() => { if (confirmation && quote && paidConfirmed) void onSubmit({ ...confirmation, quote_reference: quote.reference, confirmed: true }); }}>{t(renewal ? "renew" : "authorize")}</button></div>
      </> : null}
      {operation?.can_revoke && operation.receipt.action === "authorize_interpretation" ? <>
        <p className="admin-drawer-form__hint">{t("stopEffect")}</p>
        <button type="button" className="admin-button" disabled={!canRevoke || submitting} onClick={() => void onSubmit({ action: "revoke_incremental_editorial",
          run_id: operation.execution_id, expected_admission_operation_id: operation.receipt.operation_id })}>{t("revoke")}</button>
      </> : null}
    {catalog ? <p role="status">{t("catalogSaved", { count: catalog.topic_count })}</p> : null}
    {pendingRequest ? <p role="status">{(pendingRequest.action === "begin_incremental_editorial" || pendingRequest.action === "renew_incremental_editorial") ? t(pendingRequest.action === "renew_incremental_editorial" ? "pendingRenew" : "pendingGrant", { amount: money(pendingRequest.action === "renew_incremental_editorial" ? pendingRequest.grant_cap_micro_usd : pendingRequest.cap_micro_usd),
      expiry: expiry(pendingRequest.admission_not_after, execution?.renewal?.budget_timezone ?? admission?.budget_timezone ?? "UTC"), zone: execution?.renewal?.budget_timezone ?? admission?.budget_timezone ?? "UTC" })
      : t(pendingRequest.action === "revoke_incremental_editorial" ? "pendingRevoke" : pendingRequest.action === "retry_incremental_editorial" ? "pendingRetry" : "pendingPreparation")}</p> : null}
    {canReplay && pendingRequest ? <button type="button" className="admin-button" onClick={() => void onReplay()}>{t("replay")}</button> : null}
    {hasDetails ? <details className="admin-topic-analysis__complete" data-incremental-editorial-details>
      <summary>{t("details")}</summary>
      <div className="admin-drawer-form">
        {prep?.preparation?.status === "ready" && (operation || execution) ? <p className="admin-drawer-form__hint">{t("evidenceSaved")}</p> : null}
        {admission ? <>
      {admission.legacy_units > 0 ? <p className="admin-drawer-form__hint">{t("legacyUnits", { count: admission.legacy_units })}</p> : null}
      {admission.claimed_units > 0 ? <p className="admin-drawer-form__hint">{t("claimedUnits", { count: admission.claimed_units })}</p> : null}
          {admission.can_authorize && !renewal ? <>
        <p className="admin-drawer-form__hint">{t("budget", { confirmed: money(admission.confirmed_micro_usd), reserved: money(admission.reserved_micro_usd), daily: money(admission.daily_cap_micro_usd), date: admission.budget_date, zone: admission.budget_timezone })}</p>
        {admission.terminal_reserved_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("terminal", { amount: money(admission.terminal_reserved_micro_usd) })}</p> : null}
          </> : null}
        </> : null}
      {operation?.receipt ? <p className="admin-drawer-form__hint">{t(operation.receipt.action === "revoke_interpretation" ? "revoked" : "grantReceipt", {
        amount: money(operation.receipt.grant_cap_micro_usd), expiry: expiry(operation.receipt.admission_not_after, operation.receipt.budget_timezone), zone: operation.receipt.budget_timezone
      })}</p> : null}
        {execution?.renewal ? <p className="admin-drawer-form__hint">{t("renewLimits", { run: money(execution.renewal.run_cap_micro_usd),
          daily: money(execution.renewal.daily_cap_micro_usd), date: execution.renewal.budget_date, zone: execution.renewal.budget_timezone })}</p> : null}
        {execution ? <>
      <p className="admin-drawer-form__hint">{t("executionCost", { confirmed: money(execution.costs.confirmed_micro_usd), reserved: money(execution.costs.reserved_micro_usd) })}</p>
      {execution.costs.terminal_reserved_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("terminal", { amount: money(execution.costs.terminal_reserved_micro_usd) })}</p> : null}
        </> : null}
      </div>
    </details> : null}
  </div>;
}
