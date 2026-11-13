"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SignalConversationSegmentV1, SignalWorkspaceMonitoringInsightsViewV1,
  SignalWorkspaceMonitoringInsightsQuoteV1 } from "@noisia/query-engine";

export type NativeMonitoringInsightsView = SignalWorkspaceMonitoringInsightsViewV1;
export type NativeMonitoringInsightsQuote = SignalWorkspaceMonitoringInsightsQuoteV1;
const CAP_MICRO_USD = 2_000_000;

/** Reads never grant spending authority. Only the explicit quote confirmation posts
 * an intent; its identity survives an uncertain response and is never auto-replayed. */
export function useNativeMonitoringInsights(workspaceId: string | null, active: boolean, fallbackMessage: string,
  segment: SignalConversationSegmentV1 = "conversation", locale: "es-MX" | "en-US" = "es-MX") {
  const [view, setView] = useState<NativeMonitoringInsightsView | null>(null);
  const [quote, setQuote] = useState<NativeMonitoringInsightsQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const intentRef = useRef<{ quote: NativeMonitoringInsightsQuote; key: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const endpoint = workspaceId ? `/api/data-os/signal/${workspaceId}/monitoring/monthly-insights?conversation_segment=${segment}&locale=${locale}` : null;

  const applyView = useCallback((payload: NativeMonitoringInsightsView) => {
    if (payload.contract_version !== "signal-workspace-monitoring-insights-view-v1" || payload.workspace_id !== workspaceId
      || payload.monthly_insights.scope_segment !== segment || payload.monthly_insights.editorial_locale !== locale) {
      throw new Error(fallbackMessage);
    }
    setView(payload);
    if (payload.run) { intentRef.current = null; setQuote(null); }
  }, [workspaceId, segment, locale, fallbackMessage]);

  const perform = useCallback(async (kind: "read" | "quote" | "confirm") => {
    if (!endpoint) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const ticket = ++sequenceRef.current;
    setBusy(true); setError(null);
    try {
      if (kind === "quote") {
        if (!view?.authorization.can_request || !view.authorization.provider_available || view.run?.status === "outcome_unknown") return;
        const quoteUrl = endpoint.replace("?conversation_segment=", "/quote?conversation_segment=");
        const payload = await requestJson<NativeMonitoringInsightsQuote>(quoteUrl, controller.signal, fallbackMessage);
        if (controller.signal.aborted || sequenceRef.current !== ticket) return;
        if (payload.contract_version !== "signal-workspace-monitoring-insights-quote-v1" || payload.workspace_id !== workspaceId
          || payload.request_scope !== view.request_scope
          || payload.budget_cap_micro_usd !== CAP_MICRO_USD || payload.reserved_micro_usd > CAP_MICRO_USD
          || !Number.isFinite(payload.reserved_micro_usd) || payload.reserved_micro_usd < 0 || !payload.quote_digest
          || payload.monthly_insights?.contract_version !== "signal-monthly-insights-v1"
          || payload.monthly_insights.candidate_hash !== payload.packet_digest
          || payload.monthly_insights.scope_segment !== segment || payload.monthly_insights.editorial_locale !== locale
          || !Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()) throw new Error(fallbackMessage);
        setView(current => current?.request_scope === payload.request_scope
          ? { ...current, monthly_insights: payload.monthly_insights } : current);
        setSubmitted(false);
        intentRef.current = { quote: payload, key: crypto.randomUUID() }; setQuote(payload);
      } else {
        const intent = intentRef.current;
        if (kind === "confirm" && !intent) return;
        if (kind === "confirm") setSubmitted(true);
        const payload = await requestJson<NativeMonitoringInsightsView>(endpoint, controller.signal, fallbackMessage, kind === "confirm" ? {
          method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": intent!.key },
          body: JSON.stringify({ quote_digest: intent!.quote.quote_digest, budget_cap_micro_usd: CAP_MICRO_USD })
        } : undefined);
        if (!controller.signal.aborted && sequenceRef.current === ticket) applyView(payload);
      }
    } catch (reason) {
      if (!controller.signal.aborted && sequenceRef.current === ticket) {
        if (reason && typeof reason === "object" && "status" in reason) {
          const status = Number(reason.status);
          if ([400, 422].includes(status)) { setQuote(null); setSubmitted(false); intentRef.current = null; }
          if ([401, 403, 404, 409].includes(status)) { setView(null); setQuote(null); intentRef.current = null; }
        }
        setError(reason instanceof Error ? reason.message : fallbackMessage);
      }
    } finally {
      if (!controller.signal.aborted && sequenceRef.current === ticket) setBusy(false);
    }
  }, [endpoint, workspaceId, segment, locale, fallbackMessage, applyView, view]);
  const performRef = useRef(perform); performRef.current = perform;
  useEffect(() => {
    setView(null); setQuote(null); setError(null); setBusy(false); setSubmitted(false); intentRef.current = null;
    if (!endpoint || !active) return;
    void performRef.current("read");
    return () => { sequenceRef.current++; requestRef.current?.abort(); };
  }, [endpoint, active]);
  useEffect(() => {
    if (!endpoint || !active || !view?.run || !["queued", "running"].includes(view.run.status)) return;
    const timer = window.setTimeout(() => { void performRef.current("read"); }, 3_000);
    return () => window.clearTimeout(timer);
  }, [endpoint, active, view]);
  const cancelQuote = () => { if (!busy && !submitted) { intentRef.current = null; setQuote(null); } };
  return { view, quote, busy, error, submitted, preview: () => perform("quote"), confirm: () => perform("confirm"),
    refresh: () => perform("read"), cancelQuote };
}

async function requestJson<T>(url: string, signal: AbortSignal, fallback: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new Error(fallback)); };
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => { controller.abort(); reject(new Error(fallback)); }, 60_000);
  });
  try {
    if (signal.aborted) throw new Error(fallback);
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      const payload = await response.json() as T & { message?: string };
      if (!response.ok) throw Object.assign(new Error(payload.message ?? fallback), { status: response.status });
      return payload;
    })()]);
  } finally { clearTimeout(timeout!); signal.removeEventListener("abort", onAbort!); }
}
