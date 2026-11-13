"use client";

import { Sparkle, SpinnerGap } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import type { useNativeMonitoringInsights } from "./useNativeMonitoringInsights";

export function NativeMonitoringInsightControls({ insights, mode = "all" }: {
  insights: ReturnType<typeof useNativeMonitoringInsights>; mode?: "action" | "feedback" | "all"
}) {
  const t = useTranslations("SignalV2.monthlyInsights.native");
  const { view, quote, busy, error, submitted } = insights;
  const running = view?.run && ["queued", "running"].includes(view.run.status);
  const unknown = view?.run?.status === "outcome_unknown";
  const canRequest = view?.authorization.can_request && view.authorization.provider_available
    && view.authorization.max_budget_micro_usd === 2_000_000;
  return <>
    {mode !== "feedback" && (canRequest || running || unknown) ? <button className="signal-v2-filter signal-v2-filter--insights"
      disabled={busy || Boolean(running) || unknown || Boolean(quote)} onClick={() => void insights.preview()} type="button">
      {busy || running ? <SpinnerGap className="signal-v2-spin" size={15} /> : <Sparkle size={15} />}
      {unknown ? t("reconciliation") : running ? t("running") : t("action")}
    </button> : null}
    {mode !== "action" && quote ? <div className="signal-v2-card signal-v2-insight-quote" role="group" aria-label={t("quoteLabel")}>
      <span>{t("quote", { amount: (quote.reserved_micro_usd / 1_000_000).toFixed(2), cap: (quote.budget_cap_micro_usd / 1_000_000).toFixed(2) })}</span>
      <button className="signal-v2-filter" disabled={busy || unknown || !canRequest} onClick={() => void insights.confirm()} type="button">
        {submitted ? t("retrySame") : t("confirm")}
      </button>
      {!submitted ? <button className="signal-v2-filter" disabled={busy} onClick={insights.cancelQuote} type="button">{t("cancel")}</button> : null}
    </div> : null}
    {mode !== "action" && (error || unknown) ? <span className="signal-v2-error" role="alert">{error ?? t("reconciliation")}
      <button disabled={busy} onClick={() => void insights.refresh()} type="button">{t("checkStatus")}</button>
    </span> : null}
  </>;
}
