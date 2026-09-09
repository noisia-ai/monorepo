"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { formatEmbeddingMicroUsd, parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { workspaceAnalysisErrorKey, workspaceAnalysisEditorialFailure, workspaceAnalysisInterpretedComplete, workspaceAnalysisUnknown, type WorkspaceAnalysisStatus } from "@/lib/data-os/signal-workspace-analysis-ui";
import { TopicPreparationControls } from "./TopicPreparationControls";
import { useWorkspaceAnalysis } from "./useWorkspaceAnalysis";

export function WorkspaceAnalysisControls({ brandId, workspaceId, catalogVersion, disabled = false, initial = null, onCompleted, onContextPrepared }: {
  brandId: string; workspaceId: string; catalogVersion: string; disabled?: boolean;
  initial?: WorkspaceAnalysisStatus | null; onCompleted?: () => unknown; onContextPrepared?: () => unknown;
}) {
  const t = useTranslations("AdminWorkspace.topics.analysis"), locale = useLocale();
  const analysis = useWorkspaceAnalysis({ workspaceId, catalogVersion, disabled, initial });
  const status = analysis.data;
  const run = status?.request_run ?? status?.active_run ?? status?.latest_run ?? null;
  const complete = status?.latest_complete ?? null;
  const interpretedComplete = workspaceAnalysisInterpretedComplete(complete);
  const noGroups = interpretedComplete && complete?.expected_interpretation_units === 0;
  const onComplete = useRef(onCompleted); onComplete.current = onCompleted;
  const notified = useRef<string | null>(null);
  const money = (value: number) => formatEmbeddingMicroUsd(String(value), locale);
  const preflight = status?.preflight;
  const unknown = workspaceAnalysisUnknown(status);
  const editorialFailure = workspaceAnalysisEditorialFailure(status);
  const selectedCap = parseEmbeddingCapMicroUsd(analysis.cap);
  const capNumber = selectedCap !== null && BigInt(selectedCap) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(selectedCap) : null;
  useEffect(() => {
    if (!complete || notified.current === `${workspaceId}:${complete.execution_id}`) return;
    notified.current = `${workspaceId}:${complete.execution_id}`;
    void onComplete.current?.();
  }, [complete, workspaceId]);

  return <div className="admin-section" aria-label={t("title")}>
    <div className="admin-section__body admin-drawer-form">
      <div><strong>{t("title")}</strong><p className="admin-drawer-form__hint">{t("body")}</p></div>
      {!status && analysis.reading ? <p role="status">{t("loading")}</p> : null}
      {preflight && preflight.state !== "ready" ? <p role="status" className="admin-drawer-form__hint">{t(preflight.state)}
        {preflight.state !== "missing_context" ? <> <Link href={`/studio/brands/${encodeURIComponent(brandId)}/data#corpus-readiness`} prefetch={false}>{t("openData")}</Link></> : null}
      </p> : null}
      {status?.active_run ? <div className="topics-manager__progress" role="status">
        <span>{t(`phases.${status.active_run.phase}`)}</span>
        <progress aria-label={t(`phases.${status.active_run.phase}`)} max={100} value={status.active_run.progress} />
        <strong>{status.active_run.progress}%</strong>
      </div> : null}
      {run?.fit_completed && run.status !== "ready" ? <p role="status" className="admin-drawer-form__hint">
        {t("fitCompletePending")}{run.expected_interpretation_units > 0 ? <> {t("interpretationProgress", {
          done: run.interpreted_units, total: run.expected_interpretation_units
        })}</> : null}
      </p> : null}
      {complete ? <p role="status"><strong>{t(complete.result_kind === "insufficient_population" ? "insufficient" : noGroups ? "noGroups" : interpretedComplete ? "completed" : "computed")}</strong>{" "}{t(complete.result_kind === "insufficient_population" ? "insufficientBody" : noGroups ? "noGroupsBody" : interpretedComplete ? "completedBody" : "computedBody")}
        {interpretedComplete && complete.result_kind !== "insufficient_population" ? <> {t("catalogTopics", { count: complete.materialized_topics })}</> : null}
        {status?.active_run ? <> {t("previous")}</> : !complete.is_current ? <> {t("outdated")}</> : null}
      </p> : null}
      {analysis.error === "load" && status ? <p role="status">{t("unverified")}</p> : null}
      {run && (run.claude_cost.hard_cap_micro_usd > 0 || run.claude_cost.settled_micro_usd > 0 || run.claude_cost.reserved_micro_usd > 0 || run.claude_cost.unknown_reserved_micro_usd > 0) ? <p>
        {t("cost", { amount: money(run.claude_cost.hard_cap_micro_usd) })} {t("receipt", {
          settled: money(run.claude_cost.settled_micro_usd), reserved: money(run.claude_cost.reserved_micro_usd)
        })}
        {run.claude_cost.unknown_reserved_micro_usd > 0 ? <> {t("unknownAmount", { amount: money(run.claude_cost.unknown_reserved_micro_usd) })}</> : null}
      </p> : null}
      {preflight?.state === "ready" && !analysis.pending && !status?.active_run && !unknown && !editorialFailure ? <>
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
      {analysis.pending && !status?.request_run ? <p role="status">{t("pending")}</p> : null}
      {analysis.error ? <p role="alert" className="team-msg team-msg--error">{t(`errors.${workspaceAnalysisErrorKey(analysis.error)}`)}</p> : null}
      {disabled ? <p>{t("saveFirst")}</p> : status && !status.can_execute ? <p>{t("readOnly")}</p> : null}
      <div className="admin-form-actions">
        {analysis.canRetry ? <button className="admin-button admin-button--primary" type="button" onClick={() => void analysis.retry()}>
          <ArrowClockwise aria-hidden size={15} />{t("retry")}</button>
          : analysis.canReplay ? <button className="admin-button admin-button--primary" type="button" onClick={() => void analysis.replay()}>
            <ArrowClockwise aria-hidden size={15} />{t("resend")}</button>
            : <button className="admin-button admin-button--primary" type="button" disabled={!analysis.canStart} onClick={() => void analysis.start()}>
              <MagnifyingGlass aria-hidden size={15} />{analysis.submitting ? t("submitting")
                : !unknown && !editorialFailure && preflight?.state === "ready" && capNumber !== null && capNumber > 0 ? t("startWithCap", { amount: money(capNumber) }) : t("start")}</button>}
        <button className="admin-button" type="button" disabled={analysis.reading || analysis.submitting} onClick={() => void analysis.read()}>
          <ArrowClockwise aria-hidden size={15} />{t(analysis.pending ? "recover" : "refresh")}</button>
      </div>
      {status ? <details open={preflight?.state === "missing_context"}>
        <summary>{t("prepareContext")}</summary>
        <TopicPreparationControls workspaceId={workspaceId} catalogVersion={catalogVersion}
          disabled={disabled} onCompleted={() => { void analysis.read(); void onContextPrepared?.(); }} />
      </details> : null}
    </div>
  </div>;
}
