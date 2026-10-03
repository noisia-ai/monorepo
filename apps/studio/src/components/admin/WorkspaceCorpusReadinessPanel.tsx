"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowClockwise } from "@phosphor-icons/react";
import type { SignalWorkspaceCorpusReadinessV1 } from "@noisia/db";
import { AdminResourceSection, AdminStatus, formatAdminNumber } from "./AdminWorkspacePrimitives";
import { WorkspaceCorpusPreparationPanel } from "./WorkspaceCorpusPreparationPanel";

export function latestCorpusReadinessSnapshot(
  current: SignalWorkspaceCorpusReadinessV1 | null,
  incoming: SignalWorkspaceCorpusReadinessV1 | null,
  workspaceId: string
): SignalWorkspaceCorpusReadinessV1 | null {
  const previous = current?.workspace_id === workspaceId ? current : null;
  if (!incoming || incoming.workspace_id !== workspaceId) return previous;
  // Both transports use the database snapshot time: ISO UTC with six fractional digits.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(incoming.observed_at)) return previous;
  return previous && previous.observed_at > incoming.observed_at ? previous : incoming;
}

export function WorkspaceCorpusReadinessPanel({ initial, workspaceId, canProcess = true,
  showProcessingControls = true, onAccessDenied }: {
  initial: SignalWorkspaceCorpusReadinessV1 | null;
  workspaceId: string; canProcess?: boolean; showProcessingControls?: boolean; onAccessDenied?: () => void;
}) {
  const t = useTranslations("AdminWorkspace.data.corpusReadiness");
  const locale = useLocale();
  const [receipt, setData] = useState(() => latestCorpusReadinessSnapshot(null, initial, workspaceId));
  const data = receipt?.workspace_id === workspaceId ? receipt : null;
  const [loading, setLoading] = useState(data === null);
  const [error, setError] = useState<"load" | "forbidden" | null>(null);
  const request = useRef<AbortController | null>(null);
  const deniedCallback = useRef(onAccessDenied); deniedCallback.current = onAccessDenied;

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/corpus/readiness`, {
        cache: "no-store", signal: controller.signal
      });
      if ([401, 403, 404].includes(response.status)) {
        if (!controller.signal.aborted) { setData(null); setError("forbidden"); deniedCallback.current?.(); }
        return;
      }
      const next = await response.json() as SignalWorkspaceCorpusReadinessV1;
      if (!response.ok || next.contract_version !== "signal-workspace-corpus-readiness-v1" || !latestCorpusReadinessSnapshot(null, next, workspaceId)) throw new Error();
      if (!controller.signal.aborted) setData((current) => latestCorpusReadinessSnapshot(current, next, workspaceId));
    } catch {
      if (!controller.signal.aborted) setError("load");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    request.current?.abort();
    if (latestCorpusReadinessSnapshot(null, initial, workspaceId)) {
      setData((current) => latestCorpusReadinessSnapshot(current, initial, workspaceId));
      setLoading(false); setError(null);
    }
    else { void refresh(); }
    return () => { request.current?.abort(); };
  }, [initial, refresh, workspaceId]);

  const number = (value: number) => formatAdminNumber(value, locale);
  return <div id="corpus-readiness" aria-busy={loading}>
    <AdminResourceSection title={t("title")} subtitle={t("body")} actions={<>
      {data ? <AdminStatus state={data.state === "needs_attention" ? "warning" : "not_available"}>{t(`states.${data.state}`)}</AdminStatus> : null}
      <button className="admin-button admin-button--compact" disabled={loading} onClick={() => void refresh()} type="button">
        <ArrowClockwise aria-hidden size={15}/>{t(error ? "retry" : "refresh")}
      </button>
    </>}>
      {loading && !data ? <p className="admin-section__body" role="status">{t("loading")}</p> : null}
      {error ? <div className="admin-section__body"><p className="workspace-form__error" role="alert">{t(error === "forbidden" ? "errors.forbidden" : data ? "errors.refresh" : "errors.load")}</p></div> : null}
      {data ? <>
        <dl className="admin-summary-strip admin-summary-strip--compact">
          <div><dt>{t("counts.files")}</dt><dd>{number(data.accepted_files)}</dd></div>
          <div><dt>{t("counts.rows")}</dt><dd>{number(data.records_read)}</dd></div>
          <div><dt>{t("counts.unique")}</dt><dd>{number(data.projection.linked_roots)}</dd></div>
          <div><dt>{t("counts.text")}</dt><dd>{number(data.projection.roots_with_text)}</dd></div>
        </dl>
        <div className="admin-section__body admin-drawer-form">
        <p className="admin-drawer-form__hint">{t(data.state === "awaiting_import" ? "empty" : "countsHelp")}</p>
        {data.reconciliation_errors.length ? <p className="workspace-form__error" role="alert">{t("reconciliation")}</p> : null}
        {showProcessingControls ? <WorkspaceCorpusPreparationPanel canProcess={canProcess} onAccessDenied={onAccessDenied}
          workspaceId={workspaceId} hasReceivedFiles={data.accepted_files > 0} receiptObservedAt={data.observed_at} /> : null}
        <details>
          <summary>{t("details.title")}</summary>
          <dl className="admin-summary-strip admin-summary-strip--compact">
            <div><dt>{t("details.included")}</dt><dd>{number(data.dispositions.included)}</dd></div>
            <div><dt>{t("details.excluded")}</dt><dd>{number(data.dispositions.excluded)}</dd></div>
            <div><dt>{t("details.duplicates")}</dt><dd>{number(data.dispositions.duplicates)}</dd></div>
            <div><dt>{t("details.observations")}</dt><dd>{number(data.projection.observations)}</dd></div>
          </dl>
          <p className="admin-drawer-form__hint">{t("details.eligibilityHelp")}</p>
          <dl className="admin-summary-strip admin-summary-strip--compact">
            <div><dt>{t("details.rightsEligible")}</dt><dd>{number(data.eligibility.rights_eligible_roots)}</dd></div>
            <div><dt>{t("details.rightsBlocked")}</dt><dd>{number(data.eligibility.rights_blocked_roots)}</dd></div>
            <div><dt>{t("details.semanticEligible")}</dt><dd>{number(data.eligibility.semantic_eligible_roots)}</dd></div>
            <div><dt>{t("details.semanticPending")}</dt><dd>{number(data.eligibility.semantic_pending_roots)}</dd></div>
          </dl>
        </details>
        </div>
      </> : null}
    </AdminResourceSection>
  </div>;
}
