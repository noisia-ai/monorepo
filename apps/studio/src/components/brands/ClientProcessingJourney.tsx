"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import { ClientCorpusPreparationStep, type ClientCorpusPreparationViewV1 } from "./ClientCorpusPreparationStep";
import { clientProcessingPolicyForWorkspaceV1, clientProcessingRouteMaximumMicroUsdV1, clientProcessingStageStateV1,
  formatClientProcessingMicroUsdV1, validClientProcessingPolicyViewV1,
  type ClientProcessingPolicyViewV1, type ClientProcessingStageV1
} from "@/lib/data-os/signal-processing-policy-ui";

const paidStages: ClientProcessingStageV1[] = ["vectors", "analyze"];

export function ClientProcessingJourney({ workspaceId, initial = null, initialPreparation = null, onAccessDenied }: {
  workspaceId: string;
  initial?: ClientProcessingPolicyViewV1 | null;
  initialPreparation?: ClientCorpusPreparationViewV1 | null;
  onAccessDenied?: () => void;
}) {
  const t = useTranslations("ClientProcessing");
  const locale = useLocale();
  const [view, setView] = useState(() => initial?.workspace_id === workspaceId ? initial : null);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const denied = useRef(onAccessDenied); denied.current = onAccessDenied;
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/processing-policy`;

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(false);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) {
        setView(null); setError(true); denied.current?.(); return;
      }
      const body: unknown = await response.json();
      if (!response.ok || !validClientProcessingPolicyViewV1(body) || body.workspace_id !== workspaceId) throw new Error();
      setView(body);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [endpoint, workspaceId]);

  useEffect(() => {
    if (initial?.workspace_id === workspaceId) {
      setView(initial); setLoading(false); setError(false);
    } else void refresh();
    return () => request.current?.abort();
  }, [initial, refresh, workspaceId]);

  const currentView = clientProcessingPolicyForWorkspaceV1(view, workspaceId);
  const money = (value: string) => formatClientProcessingMicroUsdV1(value, locale);
  const status = currentView?.status ?? null;
  const canRequest = currentView?.can_request_processing === true;
  const routeMaximum = currentView ? clientProcessingRouteMaximumMicroUsdV1(currentView) : "0";
  return <section className="admin-section client-processing-journey" data-client-processing-policy
    aria-busy={loading} aria-label={t("title")}>
    <div className="admin-section__head"><div><h3>{t("title")}</h3><p>{t("body")}</p></div>
      <div className="admin-section__actions">
        {status ? <AdminStatus state={status === "ready" ? "good" : "warning"}>{t(`states.${status}`)}</AdminStatus> : null}
        <button className="admin-button admin-button--compact" disabled={loading} onClick={() => void refresh()} type="button">
          <ArrowClockwise aria-hidden size={15}/>{t("refresh")}
        </button>
      </div>
    </div>
    <div className="admin-section__body admin-drawer-form">
      {loading && !currentView ? <p role="status">{t("loading")}</p> : null}
      {error ? <p role="alert" className="workspace-form__error">{t(currentView ? "refreshError" : "loadError")}</p> : null}
      {currentView ? <>
        {!canRequest ? <p role="status">{t("readOnly")}</p> : <>
          <p role="status" className="admin-drawer-form__hint">{t(`stateHelp.${currentView.status}`)}</p>
          {currentView.policy ? <dl className="admin-summary-strip admin-summary-strip--compact">
            <div><dt>{t("budget.routeMaximum")}</dt><dd>{money(routeMaximum)}</dd></div>
            <div><dt>{t("budget.availableToday")}</dt><dd>{money(currentView.remaining_micro_usd)}</dd></div>
            <div><dt>{t("budget.usedToday")}</dt><dd>{money(currentView.exposure.total_micro_usd)}</dd></div>
            <div><dt>{t("budget.dailyMaximum")}</dt><dd>{money(currentView.policy.daily_cap_micro_usd)}</dd></div>
          </dl> : null}
          {currentView.policy ? <p className="admin-drawer-form__hint">{t("budget.period", {
            date: currentView.budget_date ?? "—", timezone: currentView.policy.budget_timezone
          })}</p> : null}
        </>}
        {canRequest ? <p className="admin-drawer-form__hint">{t("quoteNotice")}</p> : null}
      </> : null}
      <ol className="client-processing-journey__steps">
        <ClientCorpusPreparationStep workspaceId={workspaceId} index={0} initial={initialPreparation}
          onAccessDenied={onAccessDenied}/>
        {paidStages.map((stage, index) => {
          const stageState = currentView ? clientProcessingStageStateV1(currentView, stage) : "unavailable";
          return <li key={stage} data-processing-stage={stage} data-processing-stage-state={stageState}>
            <span className="client-processing-journey__number" aria-hidden>{index + 2}</span>
            <div><strong>{t(`stages.${stage}.title`)}</strong><p>{t(`stages.${stage}.body`)}</p></div>
            <AdminStatus state={stageState === "ready" ? "good" : stageState === "blocked" ? "warning" : "not_available"}>
              {t(`stageStates.${stageState}`)}
            </AdminStatus>
          </li>;
        })}
      </ol>
    </div>
  </section>;
}
