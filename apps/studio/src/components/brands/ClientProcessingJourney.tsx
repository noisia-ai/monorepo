"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import { clientProcessingRouteMaximumMicroUsdV1, clientProcessingStageStateV1,
  formatClientProcessingMicroUsdV1, validClientProcessingPolicyViewV1,
  type ClientProcessingPolicyViewV1, type ClientProcessingStageV1
} from "@/lib/data-os/signal-processing-policy-ui";

const stages: ClientProcessingStageV1[] = ["prepare", "vectors", "analyze"];

export function ClientProcessingJourney({ workspaceId, initial = null, onAccessDenied }: {
  workspaceId: string;
  initial?: ClientProcessingPolicyViewV1 | null;
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

  const money = (value: string) => formatClientProcessingMicroUsdV1(value, locale);
  const status = view?.status ?? null;
  const canRequest = view?.can_request_processing === true;
  const routeMaximum = view ? clientProcessingRouteMaximumMicroUsdV1(view) : "0";
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
      {loading && !view ? <p role="status">{t("loading")}</p> : null}
      {error ? <p role="alert" className="workspace-form__error">{t(view ? "refreshError" : "loadError")}</p> : null}
      {view ? <>
        {!canRequest ? <p role="status">{t("readOnly")}</p> : <>
          <p role="status" className="admin-drawer-form__hint">{t(`stateHelp.${view.status}`)}</p>
          {view.policy ? <dl className="admin-summary-strip admin-summary-strip--compact">
            <div><dt>{t("budget.routeMaximum")}</dt><dd>{money(routeMaximum)}</dd></div>
            <div><dt>{t("budget.availableToday")}</dt><dd>{money(view.remaining_micro_usd)}</dd></div>
            <div><dt>{t("budget.usedToday")}</dt><dd>{money(view.exposure.total_micro_usd)}</dd></div>
            <div><dt>{t("budget.dailyMaximum")}</dt><dd>{money(view.policy.daily_cap_micro_usd)}</dd></div>
          </dl> : null}
          {view.policy ? <p className="admin-drawer-form__hint">{t("budget.period", {
            date: view.budget_date ?? "—", timezone: view.policy.budget_timezone
          })}</p> : null}
        </>}
        <ol className="client-processing-journey__steps">
          {stages.map((stage, index) => {
            const stageState = clientProcessingStageStateV1(view, stage);
            return <li key={stage} data-processing-stage={stage} data-processing-stage-state={stageState}>
              <span className="client-processing-journey__number" aria-hidden>{index + 1}</span>
              <div><strong>{t(`stages.${stage}.title`)}</strong><p>{t(`stages.${stage}.body`)}</p></div>
              <AdminStatus state={stageState === "ready" ? "good" : stageState === "blocked" ? "warning" : "not_available"}>
                {t(`stageStates.${stageState}`)}
              </AdminStatus>
            </li>;
          })}
        </ol>
        {canRequest ? <p className="admin-drawer-form__hint">{t("quoteNotice")}</p> : null}
      </> : null}
    </div>
  </section>;
}
