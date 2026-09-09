"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { formatEmbeddingMicroUsd, parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { workspaceAnalysisCatalogReceiptKey, workspaceAnalysisErrorKey, workspaceAnalysisRecoveryFailure, workspaceAnalysisInterpretedComplete, workspaceAnalysisUnknown, type WorkspaceAnalysisStatus } from "@/lib/data-os/signal-workspace-analysis-ui";
import { workspaceAnalysisAssociationReceipt, workspaceAnalysisUpdateState, workspaceNumericReadinessMessage } from "@/lib/data-os/signal-workspace-analysis-update-ui";
import { TopicPreparationControls } from "./TopicPreparationControls";
import { isWorkspaceAdmissionAction } from "@/lib/data-os/signal-workspace-interpretation-admission-ui";
import { WorkspaceInterpretationAdmissionControls } from "./WorkspaceInterpretationAdmissionControls";
import { useWorkspaceAnalysis } from "./useWorkspaceAnalysis";

export function WorkspaceAnalysisControls({ brandId, workspaceId, catalogVersion, disabled = false, initial = null, onCompleted, onCatalogAvailable, onContextPrepared, onAssociationsAvailable, signalHref }: {
  brandId: string; workspaceId: string; catalogVersion: string; disabled?: boolean;
  onAssociationsAvailable?: (receipt: string) => unknown; signalHref?: string;
  initial?: WorkspaceAnalysisStatus | null; onCompleted?: () => unknown; onCatalogAvailable?: (signal: AbortSignal) => Promise<unknown>; onContextPrepared?: () => unknown;
}) {
  const t = useTranslations("AdminWorkspace.topics.analysis"), locale = useLocale();
  const analysis = useWorkspaceAnalysis({ workspaceId, catalogVersion, disabled, initial });
  const status = analysis.data;
  const run = status?.request_run ?? status?.active_run ?? status?.latest_run ?? null;
  const complete = status?.latest_complete ?? null;
  // Deduplicate only identical receipts from the same execution; distinct or newer
  // admission amounts must stay visible alongside the historical run receipt.
  const admissionReceiptAlreadyVisible = Boolean(run && status?.admission
    && run.execution_id.toLowerCase() === status.admission.execution_id.toLowerCase()
    && run.claude_cost.settled_micro_usd === status.admission.confirmed_micro_usd
    && run.claude_cost.reserved_micro_usd === status.admission.reserved_micro_usd
    && run.claude_cost.terminal_reserved_micro_usd === status.admission.terminal_reserved_micro_usd
    && (run.claude_cost.hard_cap_micro_usd > 0 || run.claude_cost.settled_micro_usd > 0
      || run.claude_cost.reserved_micro_usd > 0 || run.claude_cost.unknown_reserved_micro_usd > 0));
  const update = status?.update;
  const admission = status?.numeric_readiness;
  const admissionMessage = admission ? workspaceNumericReadinessMessage(admission) : null;
  const deliveryReplay = Boolean(analysis.canReplay && analysis.pending?.body.action === "retry_incremental_delivery");
  const updateState = update ? analysis.error === "load" ? "unverified" : workspaceAnalysisUpdateState(update) : null;
  const associations = workspaceAnalysisAssociationReceipt(workspaceId, status?.request_scope ?? "", update);
  const onAssociations = useRef(onAssociationsAvailable); onAssociations.current = onAssociationsAvailable;
  const notifiedAssociations = useRef<string | null>(null);
  useEffect(() => {
    if (!associations || disabled || analysis.error || !analysis.verified || associations === notifiedAssociations.current) return;
    notifiedAssociations.current = associations;
    void onAssociations.current?.(associations);
  }, [associations, disabled, analysis.error, analysis.verified]);
  const interpretedComplete = workspaceAnalysisInterpretedComplete(complete);
  const noGroups = interpretedComplete && complete?.expected_interpretation_units === 0;
  const onComplete = useRef(onCompleted); onComplete.current = onCompleted;
  const onCatalog = useRef(onCatalogAvailable); onCatalog.current = onCatalogAvailable;
  const currentRun = status?.active_run ?? status?.latest_run;
  const materialization = currentRun?.status === "ready" ? null : currentRun?.materialization_progress;
  const currentComplete = currentRun?.status === "ready" && currentRun.execution_id === complete?.execution_id;
  const catalogCount = currentComplete && (currentRun.materialization_pending || currentRun.materialization_error_code) ? null
    : currentComplete && currentRun.materialization_progress?.interpretation_complete
      ? currentRun.materialization_progress.topic_count : complete?.materialized_topics ?? null;
  const catalogReceipt = workspaceAnalysisCatalogReceiptKey(status);
  const refreshingCatalog = useRef<{ key: string; controller: AbortController } | null>(null);
  useEffect(() => () => { refreshingCatalog.current?.controller.abort(); refreshingCatalog.current = null; }, [workspaceId, status?.request_scope]);
  const notified = useRef<string | null>(null);
  const money = (value: number) => formatEmbeddingMicroUsd(String(value), locale);
  const preflight = status?.preflight;
  const unknown = workspaceAnalysisUnknown(status);
  const recoveryFailure = workspaceAnalysisRecoveryFailure(status);
  const selectedCap = parseEmbeddingCapMicroUsd(analysis.cap);
  const capNumber = selectedCap !== null && BigInt(selectedCap) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(selectedCap) : null;
  useEffect(() => {
    if (!catalogReceipt || disabled || analysis.error || !analysis.verified
      || notified.current === catalogReceipt || refreshingCatalog.current?.key === catalogReceipt) return;
    const callback = onCatalog.current ?? (complete ? onComplete.current : undefined);
    if (!callback) return;
    refreshingCatalog.current?.controller.abort();
    const controller = new AbortController();
    refreshingCatalog.current = { key: catalogReceipt, controller };
    void Promise.resolve().then(() => callback(controller.signal)).then(() => {
      if (!controller.signal.aborted) notified.current = catalogReceipt;
    })
      .catch(() => { /* The catalog owner reports failures and keeps the last readable catalog. */ })
      .finally(() => { if (refreshingCatalog.current?.key === catalogReceipt) refreshingCatalog.current = null; });
  }, [catalogReceipt, complete, disabled, analysis.error, analysis.verified, status?.observed_at]);

  return <div className="admin-section" aria-label={t("title")}>
    <div className="admin-section__head"><div><h3>{t("title")}</h3><p>{t("body")}</p></div></div>
    <div className="admin-section__body admin-drawer-form">
      {!status && analysis.reading ? <p role="status">{t("loading")}</p> : null}
      {admission && admissionMessage ? <div role="status" data-numeric-readiness={admission.state}>
        <strong>{t("admission.title")}</strong>
        <p className="admin-drawer-form__hint">{analysis.error === "load" ? t("update.unverified") : t(`admission.${admissionMessage}`)}</p>
        {["prepareText", "prepareAnalysis", "waiting_preparation", "waiting_embeddings"].includes(admissionMessage) ?
          <Link href={`/studio/brands/${encodeURIComponent(brandId)}/data#corpus-readiness`} prefetch={false}>{t("openData")}</Link> : null}
        {["prepareText", "prepareAnalysis"].includes(admissionMessage) ? <p className="admin-drawer-form__hint">{t("admission.paidPreparation")}</p> : null}
      </div> : null}
      {update && updateState ? <div role="status" data-analysis-update={updateState}>
        <strong>{t(`update.${updateState}`)}</strong>
        {updateState === "numeric" ? <div className="topics-manager__progress">
          <progress aria-label={t("update.numeric")} max={100} value={update.numeric.progress} />
          <span>{update.numeric.progress}%</span>
        </div> : updateState === "projecting" && update.projection ? <p className="admin-drawer-form__hint">
          {t("update.rootProgress", { done: update.projection.processed_roots, total: update.projection.expected_roots })}
        </p> : null}
        {updateState === "failed" ? <p role="alert" className="team-msg team-msg--error">{t(update.numeric.status === "failed"
          ? "update.failureNumeric" : update.delivery?.phase === "derivation" ? "update.failureDerivation"
          : update.delivery?.phase === "projection" || update.projection?.status === "failed" ? "update.failureProjection" : "update.failureDerivation")}</p> : null}
        {analysis.canRetryDelivery || deliveryReplay ? <>
          <p className="admin-drawer-form__hint">{t("update.retryDeliveryBody")}</p>
          <button className="admin-button admin-button--primary" type="button"
            onClick={() => void (deliveryReplay ? analysis.replay() : analysis.retryDelivery())}>
            <ArrowClockwise aria-hidden size={15} />{t("update.retryDelivery")}</button>
        </> : null}
        {update.serving ? <>
          {updateState !== "ready" ? <p className="admin-drawer-form__hint">{t("update.previousServing")}</p> : null}
          {update.serving.interpretation_coverage ? <p className="admin-drawer-form__hint">{t("update.interpretation", {
            done: update.serving.interpretation_coverage.interpreted_unit_count,
            total: update.serving.interpretation_coverage.expected_unit_count
          })}</p> : null}
          {update.serving.discovery_coverage && update.serving.discovery_coverage.pending_roots > 0 ? <p className="admin-drawer-form__hint">
            {t("update.discoveryPending", { count: update.serving.discovery_coverage.pending_roots })}
          </p> : null}
          {signalHref ? <Link href={signalHref} prefetch={false}>{t("update.openSignal")}</Link> : null}
        </> : <p className="admin-drawer-form__hint">{t("update.noServing")}</p>}
      </div> : null}
      {preflight && preflight.state !== "ready" ? <p role="status" className="admin-drawer-form__hint">{update ? <>{t("update.newAnalysis")} </> : null}{t(preflight.state)}
        {preflight.state !== "missing_context" ? <> <Link href={`/studio/brands/${encodeURIComponent(brandId)}/data#corpus-readiness`} prefetch={false}>{t("openData")}</Link></> : null}
      </p> : null}
      {update && run ? <strong>{t("update.editorial")}</strong> : null}
      {status?.active_run ? <div className="topics-manager__progress" role="status">
        <span>{t(`phases.${status.active_run.phase}`)}</span>
        <progress aria-label={t(`phases.${status.active_run.phase}`)} max={100} value={status.active_run.progress} />
        <strong>{status.active_run.progress}%</strong>
      </div> : null}
      {run?.fit_completed && run.status !== "ready" ? <p role="status" className="admin-drawer-form__hint">
        {t(materialization ? "fitCompleteProgressSaved" : "fitCompletePending")}{!materialization && run.expected_interpretation_units > 0 ? <> {t("interpretationProgress", {
          done: run.interpreted_units, total: run.expected_interpretation_units
        })}</> : null}
      </p> : null}
      {materialization ? <div role="status">
        <strong>{t("partialCatalog", { count: materialization.topic_count })}</strong>
        <p>{t("materializedProgress", { done: materialization.interpreted_unit_count, total: materialization.expected_interpretation_unit_count })}</p>
        <p className="admin-drawer-form__hint">{!materialization.interpretation_complete ? t("partialCoverage") : t("classificationCoverage")}
          {disabled ? <> {t("catalogRefreshDeferred")}</> : null}</p>
      </div> : status?.latest_run?.materialization_pending ? <p role="status">{t("catalogUpdating")}</p> : null}
      {currentRun?.materialization_error_code ? <p role="alert" className="team-msg team-msg--error">{t("catalogSaveFailed")}</p> : null}
      {complete ? <p role="status"><strong>{t(complete.result_kind === "insufficient_population" ? "insufficient" : noGroups ? "noGroups" : interpretedComplete ? "completed" : "computed")}</strong>{" "}{t(complete.result_kind === "insufficient_population" ? "insufficientBody" : noGroups ? "noGroupsBody" : interpretedComplete ? "completedBody" : "computedBody")}
        {interpretedComplete && complete.result_kind !== "insufficient_population" && catalogCount !== null ? <> {t("catalogTopics", { count: catalogCount })}</> : null}
        {status?.active_run ? <> {t("previous")}</> : !complete.is_current ? <> {t("outdated")}</> : null}
      </p> : null}
      {analysis.error === "load" && status ? <p role="status">{t("unverified")}</p> : null}
      {run && (run.claude_cost.hard_cap_micro_usd > 0 || run.claude_cost.settled_micro_usd > 0 || run.claude_cost.reserved_micro_usd > 0 || run.claude_cost.unknown_reserved_micro_usd > 0) ? <div data-analysis-receipt>
        <dl className="admin-summary-strip admin-summary-strip--compact" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}>
          <div><dt>{t("receiptLabels.cap")}</dt><dd>{money(run.claude_cost.hard_cap_micro_usd)}</dd></div>
          <div><dt>{t("receiptLabels.confirmed")}</dt><dd>{money(run.claude_cost.settled_micro_usd)}</dd></div>
          <div><dt>{t("receiptLabels.reserved")}</dt><dd>{money(run.claude_cost.reserved_micro_usd)}</dd></div>
        </dl>
        {run.claude_cost.unknown_reserved_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("unknownAmount", { amount: money(run.claude_cost.unknown_reserved_micro_usd) })}</p> : null}
        {run.claude_cost.terminal_reserved_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("terminalAmount", { amount: money(run.claude_cost.terminal_reserved_micro_usd) })}</p> : null}
      </div> : null}
      {preflight?.state === "ready" && !analysis.pending && !status?.active_run && !unknown && !recoveryFailure && !update?.has_pending_work ? <>
        <p className="admin-drawer-form__hint">{preflight.cost.claude.estimated_upper_micro_usd === null
          ? <>{t("estimateUnknown")}{capNumber !== null && capNumber > 0 ? <> {t("spendingLimit", { amount: money(capNumber) })}</> : null}</>
          : t("estimate", { amount: money(preflight.cost.claude.estimated_upper_micro_usd) })}
          {!preflight.cost.claude.provider_available ? <> {t("noInterpretation")}</> : null}
        </p>
        {preflight.cost.voyage.estimated_upper_micro_usd > 0 ? <p className="admin-drawer-form__hint">{t("voyageEstimate", {
          amount: money(preflight.cost.voyage.estimated_upper_micro_usd)
        })}</p> : null}
        {preflight.cost.claude.provider_available ? <details><summary>{t("changeCap")}</summary>
          <label className="workspace-form__field"><span>{t("cap", { amount: money(preflight.cost.claude.maximum_cap_micro_usd) })}</span>
            <input inputMode="decimal" value={analysis.cap} disabled={disabled || analysis.submitting}
              onChange={(event) => analysis.setCap(event.target.value)} /></label>
        </details> : null}
      </> : null}
      {unknown ? <p role="status">{t("unknown")}</p> : run?.status === "failed" ? <p role="alert" className="team-msg team-msg--error">{t(`errors.${workspaceAnalysisErrorKey(run.error_code ?? "failed")}`)}</p> : null}

      {analysis.pending && (isWorkspaceAdmissionAction(analysis.pending.body) ? !status?.admission?.request : analysis.pending.body.action === "retry_incremental_delivery" ? !status?.update?.request_delivery : analysis.pending.body.action === "retry_numeric" ? !status?.update?.request_numeric : !status?.request_run) ? <p role="status">{t("pending")}</p> : null}
      {analysis.error ? <p role="alert" className="team-msg team-msg--error">{t(`errors.${workspaceAnalysisErrorKey(analysis.error)}`)}</p> : null}
      {disabled ? <p>{t("saveFirst")}</p> : status && !status.can_execute ? <p>{t("readOnly")}</p> : null}
      {analysis.canRetry && run?.transport_recovery_eligible ? <p className="admin-drawer-form__hint">{t("transportRetry")}</p> : null}
      {analysis.canRetryNumeric || analysis.canReplay && analysis.pending?.body.action === "retry_numeric" ? <p className="admin-drawer-form__hint">{t("update.retryBody")}</p> : null}
      <div className="admin-form-actions">
        {analysis.canRetryNumeric ? <button className="admin-button admin-button--primary" type="button" onClick={() => void analysis.retryNumeric()}>
          <ArrowClockwise aria-hidden size={15} />{t("update.retry")}</button> : null}
        {analysis.canRetryProgress ? <button className="admin-button" type="button" onClick={() => void analysis.retryProgress()}>
          <ArrowClockwise aria-hidden size={15} />{t("retryCatalogSave")}</button> : null}
        {analysis.canRetry ? <button className="admin-button admin-button--primary" type="button" onClick={() => void analysis.retry()}>
          <ArrowClockwise aria-hidden size={15} />{t("retry")}</button>
          : analysis.canReplay && !deliveryReplay ? <button className="admin-button admin-button--primary" type="button" onClick={() => void analysis.replay()}>
            <ArrowClockwise aria-hidden size={15} />{t(analysis.pending && isWorkspaceAdmissionAction(analysis.pending.body) ? "admissionGrant.replay" : analysis.pending?.body.action === "retry_incremental_delivery" ? "update.retryDelivery" : analysis.pending?.body.action === "retry_numeric" ? "update.retry" : analysis.pending?.body.action === "retry_progress" ? "retryCatalogSave" : "resend")}</button>
            : <button className="admin-button admin-button--primary" type="button" disabled={!analysis.canStart} onClick={() => void analysis.start()}>
              <MagnifyingGlass aria-hidden size={15} />{analysis.submitting ? t("submitting")
                : !unknown && !recoveryFailure && preflight?.state === "ready" && capNumber !== null && capNumber > 0 ? t("startWithCap", { amount: money(capNumber) }) : t("start")}</button>}
        <button className="admin-button" type="button" disabled={analysis.reading || analysis.submitting} onClick={() => void analysis.read()}>
          <ArrowClockwise aria-hidden size={15} />{t(analysis.pending ? "recover" : "refresh")}</button>
      </div>
      {status?.admission ? <WorkspaceInterpretationAdmissionControls status={status} canAuthorize={analysis.canAuthorizeAdmission}
        canRevoke={analysis.canRevokeAdmission} submitting={analysis.submitting} receiptsAlreadyVisible={admissionReceiptAlreadyVisible}
        pendingRequest={analysis.pending && isWorkspaceAdmissionAction(analysis.pending.body) ? analysis.pending.body : null} onSubmit={analysis.submitAdmission} /> : null}
      {status ? <details open={!update && preflight?.state === "missing_context"}>
        <summary>{t("prepareContext")}</summary>
        <TopicPreparationControls workspaceId={workspaceId} catalogVersion={catalogVersion}
          disabled={disabled} onCompleted={() => { void analysis.read(); void onContextPrepared?.(); }} />
      </details> : null}
    </div>
  </div>;
}
