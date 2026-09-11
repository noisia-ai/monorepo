"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";

import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import {
  clientBrandContextProcessingQuoteForWorkspaceV1,
  validClientBrandContextProcessingQuoteViewV1,
  type ClientBrandContextProcessingQuoteViewV1
} from "@/lib/data-os/client-brand-context-processing-quote";
import { formatClientProcessingMicroUsdV1 } from "@/lib/data-os/signal-processing-policy-ui";

type ErrorState = "load" | "forbidden" | null;

export function ClientBrandContextProcessingQuote({ workspaceId, variant = "full", refreshSignal,
  initial = null, onAccessDenied }: {
  workspaceId: string;
  variant?: "full" | "compact";
  refreshSignal?: string;
  initial?: ClientBrandContextProcessingQuoteViewV1 | null;
  onAccessDenied?: () => void;
}) {
  const t = useTranslations("ClientBrandContextProcessing");
  const locale = useLocale();
  const initialView = clientBrandContextProcessingQuoteForWorkspaceV1(initial, workspaceId);
  const [view, setView] = useState<ClientBrandContextProcessingQuoteViewV1 | null>(initialView);
  const [loading, setLoading] = useState(initialView === null);
  const [error, setError] = useState<ErrorState>(null);
  const [expired, setExpired] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scope = useRef(0);
  const denied = useRef(onAccessDenied); denied.current = onAccessDenied;
  const previousWorkspace = useRef<string | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/brand-context/processing-quote`;

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
      if (!response.ok || !validClientBrandContextProcessingQuoteViewV1(body)
        || body.workspace_id !== workspaceId) throw new Error();
      setView(body); setExpired(false);
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
      setView(clientBrandContextProcessingQuoteForWorkspaceV1(initial, workspaceId));
      setExpired(false); setError(null);
    }
    void read();
    return () => { scope.current += 1; request.current?.abort(); };
  }, [initial, read, refreshSignal, workspaceId]);

  const current = clientBrandContextProcessingQuoteForWorkspaceV1(view, workspaceId);
  useEffect(() => {
    if (!current?.quote_expires_at) return;
    const remaining = Date.parse(current.quote_expires_at) - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), remaining + 25);
    return () => clearTimeout(timer);
  }, [current?.observed_at, current?.quote_expires_at]);

  const status = expired ? "temporarily_unavailable" : current?.status;
  const statusState = status === "temporarily_unavailable" ? "not_available" : "warning";
  const showAmounts = current?.status === "quote_available" && !expired;
  const money = (value: string) => formatClientProcessingMicroUsdV1(value, locale);
  const expiry = current?.quote_expires_at ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short"
  }).format(new Date(current.quote_expires_at)) : null;
  const content = <>
    {loading && !current ? <p role="status">{t("loading")}</p> : null}
    {error ? <p className="workspace-form__error" role="alert">{t(error === "forbidden" ? "forbidden" : current
      ? "refreshError" : "loadError")}</p> : null}
    {current ? <>
      <p className="admin-drawer-form__hint" role="status">{t(`help.${status}`)}</p>
      {showAmounts && (current.maximum_micro_usd !== null || current.available_today_micro_usd !== null) ?
        <dl className="client-brand-context-quote__amounts">
          {current.maximum_micro_usd !== null ? <div><dt>{t("maximum")}</dt><dd>{money(current.maximum_micro_usd)}</dd></div> : null}
          {current.available_today_micro_usd !== null ? <div><dt>{t("availableToday")}</dt><dd>{money(current.available_today_micro_usd)}</dd></div> : null}
        </dl> : null}
      {expiry && !expired ? <p className="admin-drawer-form__hint">{t("expires", { time: expiry })}</p> : null}
      <p className="admin-drawer-form__hint">{t("informational")}</p>
    </> : null}
  </>;

  if (variant === "compact") return <div className="client-brand-context-quote client-brand-context-quote--compact"
    data-client-brand-context-quote data-quote-can-start="false" aria-busy={loading}>
    <div className="client-brand-context-quote__head"><div><strong>{t("title")}</strong><p>{t("compactBody")}</p></div>
      {status ? <AdminStatus state={statusState}>{t(`states.${status}`)}</AdminStatus> : null}</div>
    {content}
  </div>;

  return <section className="admin-section client-brand-context-quote" data-client-brand-context-quote
    data-quote-can-start="false" aria-busy={loading}>
    <header className="admin-section__head"><div><h2>{t("title")}</h2><p>{t("body")}</p></div>
      <div className="admin-section__actions">
        {status ? <AdminStatus state={statusState}>{t(`states.${status}`)}</AdminStatus> : null}
        <button className="admin-button admin-button--compact" disabled={loading} onClick={() => void read()} type="button">
          <ArrowClockwise aria-hidden size={15}/>{t("refresh")}
        </button>
      </div>
    </header>
    <div className="admin-section__body admin-drawer-form">{content}</div>
  </section>;
}
