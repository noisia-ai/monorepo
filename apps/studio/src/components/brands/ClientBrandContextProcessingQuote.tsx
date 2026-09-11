"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";

import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import {
  clientBrandContextProcessingCanConfirmV1,
  clientBrandContextProcessingConfirmationV1,
  clientBrandContextProcessingPollDelayV1,
  clientBrandContextProcessingRequestV1,
  clientBrandContextProcessingViewForWorkspaceV1,
  clientBrandContextProcessingViewFromQuoteV1,
  latestClientBrandContextProcessingViewV1,
  validClientBrandContextProcessingQuoteViewV1,
  validClientBrandContextProcessingViewV1,
  type ClientBrandContextProcessingConfirmationV1,
  type ClientBrandContextProcessingPendingRequestV1,
  type ClientBrandContextProcessingQuoteViewV1,
  type ClientBrandContextProcessingViewV1
} from "@/lib/data-os/client-brand-context-processing-quote";
import { formatClientProcessingMicroUsdV1 } from "@/lib/data-os/signal-processing-policy-ui";

type ErrorState = "load" | "request" | "forbidden" | null;
type Authorization = (request: { idempotencyKey: string; body: ClientBrandContextProcessingConfirmationV1 }) => Promise<unknown>;

function initialProcessingView(value: ClientBrandContextProcessingViewV1 | ClientBrandContextProcessingQuoteViewV1 | null,
  workspaceId: string) {
  if (validClientBrandContextProcessingViewV1(value)) return clientBrandContextProcessingViewForWorkspaceV1(value, workspaceId);
  if (validClientBrandContextProcessingQuoteViewV1(value) && value.workspace_id === workspaceId)
    return clientBrandContextProcessingViewFromQuoteV1(value);
  return null;
}

export function ClientBrandContextProcessingQuote({ workspaceId, variant = "full", refreshSignal,
  initial = null, authorize, authorizeFromEndpoint = false, onAccessDenied }: {
  workspaceId: string;
  variant?: "full" | "compact";
  refreshSignal?: string;
  initial?: ClientBrandContextProcessingViewV1 | ClientBrandContextProcessingQuoteViewV1 | null;
  /** Dependency injection remains available for isolated UI tests. */
  authorize?: Authorization;
  authorizeFromEndpoint?: boolean;
  onAccessDenied?: () => void;
}) {
  const t = useTranslations("ClientBrandContextProcessing");
  const locale = useLocale();
  const initialView = initialProcessingView(initial, workspaceId);
  const [view, setView] = useState<ClientBrandContextProcessingViewV1 | null>(initialView);
  const [loading, setLoading] = useState(initialView === null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const [expired, setExpired] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scope = useRef(0);
  const submission = useRef(false);
  const requestKey = useRef<ClientBrandContextProcessingPendingRequestV1 | null>(null);
  const denied = useRef(onAccessDenied); denied.current = onAccessDenied;
  const previousWorkspace = useRef<string | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/brand-context/processing-quote`;
  const submitAuthorization: Authorization | undefined = authorize ?? (authorizeFromEndpoint
    ? async ({ idempotencyKey, body }) => {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body) });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error("brand_context_processing_request_failed");
      return result;
    } : undefined);

  const read = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const currentScope = ++scope.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if ([401, 403, 404].includes(response.status)) {
        setView(null); setExpired(false); setError("forbidden"); denied.current?.(); return;
      }
      const body: unknown = await response.json();
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if (!response.ok) throw new Error();
      const next = validClientBrandContextProcessingViewV1(body) ? body
        : validClientBrandContextProcessingQuoteViewV1(body) ? clientBrandContextProcessingViewFromQuoteV1(body) : null;
      if (!next || next.workspace_id !== workspaceId) throw new Error();
      setView(previous => latestClientBrandContextProcessingViewV1(previous, next, workspaceId));
      if (next.operation?.request_observed) requestKey.current = null;
      setExpired(false);
    } catch {
      if (!controller.signal.aborted && currentScope === scope.current) setError("load");
    } finally {
      if (!controller.signal.aborted && currentScope === scope.current) setLoading(false);
    }
  }, [endpoint, workspaceId]);

  useEffect(() => {
    const workspaceChanged = previousWorkspace.current !== workspaceId;
    previousWorkspace.current = workspaceId;
    scope.current += 1; request.current?.abort();
    if (workspaceChanged) {
      setView(initialProcessingView(initial, workspaceId));
      setExpired(false); setError(null); setSubmitting(false); submission.current = false; requestKey.current = null;
    }
    void read();
    return () => { scope.current += 1; request.current?.abort(); };
  }, [initial, read, refreshSignal, workspaceId]);

  const current = clientBrandContextProcessingViewForWorkspaceV1(view, workspaceId);
  useEffect(() => {
    const delay = clientBrandContextProcessingPollDelayV1(current);
    if (delay === null) return;
    const timer = setTimeout(() => void read(), delay);
    return () => clearTimeout(timer);
  }, [current, read]);
  useEffect(() => {
    if (!current?.quote || current.operation
      && !["awaiting_authorization", "stale", "failed"].includes(current.operation.state)) return;
    const remaining = Date.parse(current.quote.expires_at) - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), remaining + 25);
    return () => clearTimeout(timer);
  }, [current]);

  async function confirm() {
    if (!submitAuthorization || submission.current || !current || !clientBrandContextProcessingCanConfirmV1(current)) return;
    const pending = clientBrandContextProcessingRequestV1(requestKey.current, current, () => crypto.randomUUID());
    requestKey.current = pending; submission.current = true; setSubmitting(true); setError(null);
    const currentScope = scope.current;
    try {
      const result = await submitAuthorization({ idempotencyKey: pending.key,
        body: clientBrandContextProcessingConfirmationV1(pending) });
      if (currentScope !== scope.current) return;
      if (!validClientBrandContextProcessingViewV1(result) || result.workspace_id !== workspaceId) throw new Error();
      setView(previous => latestClientBrandContextProcessingViewV1(previous, result, workspaceId));
      if (result.operation?.request_observed) requestKey.current = null;
    } catch { if (currentScope === scope.current) setError("request"); }
    finally { submission.current = false; if (currentScope === scope.current) setSubmitting(false); }
  }

  const displayState = expired ? "temporarily_unavailable" : current?.operation?.state ?? current?.status;
  const statusState = displayState === "completed" ? "good"
    : displayState === "temporarily_unavailable" || displayState === "failed" ? "not_available" : "warning";
  const showAmounts = Boolean(current?.quote && (!expired || current.operation));
  const showConfirmation = variant === "full" && Boolean(submitAuthorization
    && clientBrandContextProcessingCanConfirmV1(current));
  const canConfirm = Boolean(submitAuthorization && clientBrandContextProcessingCanConfirmV1(current, submitting));
  const money = (value: string) => formatClientProcessingMicroUsdV1(value, locale);
  const expiry = current?.quote?.expires_at ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short"
  }).format(new Date(current.quote.expires_at)) : null;
  const content = <>
    {loading && !current ? <p role="status">{t("loading")}</p> : null}
    {error ? <p className="workspace-form__error" role="alert">{t(error === "forbidden" ? "forbidden"
      : error === "request" ? "requestError" : current ? "refreshError" : "loadError")}</p> : null}
    {current ? <>
      <p className="admin-drawer-form__hint" role="status">{t(`help.${displayState}`)}</p>
      {current.operation?.phase ? <p className="client-brand-context-quote__phase">{t(`phases.${current.operation.phase}`)}</p> : null}
      {showAmounts && current.quote ?
        <dl className="client-brand-context-quote__amounts">
          <div><dt>{t("maximum")}</dt><dd>{money(current.quote.maximum_micro_usd)}</dd></div>
          <div><dt>{t("availableToday")}</dt><dd>{money(current.quote.available_today_micro_usd)}</dd></div>
        </dl> : null}
      {expiry && !expired && (!current.operation || showConfirmation) ?
        <p className="admin-drawer-form__hint">{t("expires", { time: expiry })}</p> : null}
      {!current.operation && !showConfirmation ? <p className="admin-drawer-form__hint">{t("informational")}</p> : null}
      {showConfirmation ? <div className="client-brand-context-quote__confirmation">
        {current.quote ? <p id="client-brand-context-confirmation-help">{t(current.operation?.state
          === "awaiting_authorization" ? "authorizationPrototypes" : "authorization", {
          maximum: money(current.quote.maximum_micro_usd), available: money(current.quote.available_today_micro_usd)
        })}</p> : null}
        <button className="admin-button admin-button--primary" disabled={!canConfirm} onClick={() => void confirm()} type="button"
          aria-describedby="client-brand-context-confirmation-help">
          {t(submitting ? "confirming" : "confirm")}
        </button>
      </div> : null}
    </> : null}
  </>;

  if (variant === "compact") return <div className="client-brand-context-quote client-brand-context-quote--compact"
    data-client-brand-context-quote data-quote-can-start={current?.can_start ? "true" : "false"}
    data-processing-state={displayState} aria-busy={loading || submitting}>
    <div className="client-brand-context-quote__head"><div><strong>{t("title")}</strong><p>{t("compactBody")}</p></div>
      {displayState ? <AdminStatus state={statusState}>{t(`states.${displayState}`)}</AdminStatus> : null}</div>
    {content}
  </div>;

  return <section className="admin-section client-brand-context-quote" data-client-brand-context-quote
    data-quote-can-start={current?.can_start ? "true" : "false"} data-processing-state={displayState}
    aria-busy={loading || submitting}>
    <header className="admin-section__head"><div><h2>{t("title")}</h2><p>{t("body")}</p></div>
      <div className="admin-section__actions">
        {displayState ? <AdminStatus state={statusState}>{t(`states.${displayState}`)}</AdminStatus> : null}
        <button className="admin-button admin-button--compact" disabled={loading} onClick={() => void read()} type="button">
          <ArrowClockwise aria-hidden size={15}/>{t("refresh")}
        </button>
      </div>
    </header>
    <div className="admin-section__body admin-drawer-form">{content}</div>
  </section>;
}
