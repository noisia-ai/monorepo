"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { embeddingCapUsdInput, formatEmbeddingMicroUsd, parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { latestTopicPreparation, parsePendingTopicPreparation, topicPreparationCanExecute, topicPreparationCanReplay,
  topicPreparationStorageKey, topicPreparationUnknown, validTopicPreparationQuote, validTopicPreparationStatus,
  type PendingTopicPreparation, type TopicPreparationQuote, type TopicPreparationStatus } from "@/lib/data-os/signal-workspace-topic-preparation-ui";

export function TopicPreparationControls({ workspaceId, catalogVersion, disabled = false, onCompleted,
  initialStatus = null, initialQuote = null }: {
  workspaceId: string; catalogVersion: string; disabled?: boolean; onCompleted?: () => unknown;
  initialStatus?: TopicPreparationStatus | null; initialQuote?: TopicPreparationQuote | null;
}) {
  const t = useTranslations("AdminWorkspace.topics.preparation");
  const locale = useLocale();
  const [data, setData] = useState<TopicPreparationStatus | null>(initialStatus);
  const [quote, setQuote] = useState<TopicPreparationQuote | null>(initialQuote);
  const [cap, setCap] = useState(() => embeddingCapUsdInput(String(initialQuote?.required_cap_micro_usd ?? initialQuote?.estimated_upper_micro_usd ?? 0)));
  const [pending, setPending] = useState<PendingTopicPreparation | null>(null);
  const [reading, setReading] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedVersion, setVerifiedVersion] = useState(initialStatus ? catalogVersion : null);
  const current = useRef(data); current.current = data;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const quoteRef = useRef(quote); quoteRef.current = quote;
  const version = useRef(catalogVersion); version.current = catalogVersion;
  const callback = useRef(onCompleted); callback.current = onCompleted;
  const completed = useRef<string | null>(initialStatus?.latest_completed?.id ?? null);
  const checkedKey = useRef<string | null>(null);
  const rejectedKey = useRef<string | null>(null);
  const epoch = useRef(0);
  const reader = useRef<AbortController | null>(null);
  const quoter = useRef<AbortController | null>(null);
  const writer = useRef<AbortController | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/preparation`;
  const forget = useCallback(() => {
    const request = pendingRef.current;
    if (request) { try { sessionStorage.removeItem(topicPreparationStorageKey(request.workspace_id, request.request_scope)); } catch { /* No submission without durable storage. */ } }
    pendingRef.current = null; setPending(null); checkedKey.current = null; rejectedKey.current = null;
  }, []);
  const revoke = useCallback(() => {
    epoch.current++; reader.current?.abort(); quoter.current?.abort(); writer.current?.abort();
    reader.current = null; quoter.current = null; writer.current = null;
    forget(); current.current = null; setData(null); quoteRef.current = null; setQuote(null);
    setVerifiedVersion(null); setReading(false); setQuoting(false); setSubmitting(false); setError("forbidden");
  }, [forget]);
  const accept = useCallback((value: unknown, key?: string) => {
    if (!validTopicPreparationStatus(value) || value.workspace_id !== workspaceId) throw new Error("load");
    if (current.current && current.current.request_scope !== value.request_scope) {
      epoch.current++; writer.current?.abort(); quoter.current?.abort(); forget(); current.current = null;
      writer.current = null; quoter.current = null;
      setSubmitting(false); setQuoting(false); quoteRef.current = null; setQuote(null);
    }
    const next = latestTopicPreparation(current.current, value, workspaceId)!;
    if (next !== value) return false;
    if (quoteRef.current && (quoteRef.current.plan_digest !== next.current_plan_digest
      || quoteRef.current.request_scope !== next.request_scope)) { quoteRef.current = null; setQuote(null); }
    current.current = next; setData(next);
    if (key && pendingRef.current?.key === key) {
      checkedKey.current = key;
      if (next.request_run?.status === "completed") forget();
      else if (!next.request_run && rejectedKey.current === key) {
        // A definitive rejection alone cannot prove the original intent was never
        // accepted. The actor-scoped lookup must also confirm that no run exists.
        forget(); quoteRef.current = null; setQuote(null);
      }
    }
    if (!pendingRef.current) {
      try {
        const stored = sessionStorage.getItem(topicPreparationStorageKey(workspaceId, next.request_scope));
        const request = stored ? parsePendingTopicPreparation(JSON.parse(stored), workspaceId, next.request_scope) : null;
        if (request) { pendingRef.current = request; setPending(request); checkedKey.current = null; }
      } catch { /* Read-only receipts are still available. */ }
    }
    if (next.latest_completed && completed.current !== next.latest_completed.id) {
      completed.current = next.latest_completed.id; callback.current?.();
    }
    return true;
  }, [forget, workspaceId]);
  const read = useCallback(async () => {
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller;
    const ticket = epoch.current; const expectedVersion = version.current;
    const request = pendingRef.current?.workspace_id === workspaceId ? pendingRef.current : null;
    setReading(true);
    try {
      const response = await fetch(endpoint + (request ? `?idempotency_key=${encodeURIComponent(request.key)}` : ""), { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current || expectedVersion !== version.current) return;
      if (accept(value, request?.key)) { setVerifiedVersion(expectedVersion); setError(null); }
    } catch { if (!controller.signal.aborted && ticket === epoch.current) { setError("load"); setVerifiedVersion(null); } }
    finally { if (!controller.signal.aborted && reader.current === controller) setReading(false); }
  }, [accept, endpoint, revoke, workspaceId]);
  useEffect(() => {
    const fence = epoch; fence.current++;
    reader.current?.abort(); quoter.current?.abort(); writer.current?.abort();
    reader.current = null; quoter.current = null; writer.current = null;
    current.current = null; setData(null); quoteRef.current = null; setQuote(null);
    pendingRef.current = null; setPending(null); checkedKey.current = null; rejectedKey.current = null; completed.current = null;
    setError(null); setVerifiedVersion(null); setSubmitting(false); setQuoting(false); setReading(false);
    return () => { fence.current++; reader.current?.abort(); quoter.current?.abort(); writer.current?.abort(); };
  }, [workspaceId]);
  useEffect(() => { void read(); }, [catalogVersion, pending?.key, read]);
  const active = data?.active_run?.id;
  useEffect(() => {
    if (!active) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(async () => { await read(); if (!stopped) schedule(); }, 4_000); };
    schedule(); return () => { stopped = true; clearTimeout(timer); };
  }, [active, read]);
  const calculate = async (replaceClosedRequest = false) => {
    if (current.current?.availability === "context_required" || current.current?.availability === "context_stale") return;
    const closedRun = current.current?.request_run;
    if (replaceClosedRequest && closedRun && ["stale", "canceled"].includes(closedRun.status)
      && !topicPreparationUnknown(current.current, quoteRef.current)) forget();
    if (!current.current?.can_execute || disabled || quoter.current) return;
    const controller = new AbortController(); quoter.current = controller;
    const ticket = epoch.current; const scope = current.current.request_scope; const expectedVersion = version.current;
    setQuoting(true); setError(null);
    try {
      if (current.current.availability === "no_topics") {
        const initialized = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "initialize_context" }) });
        if (controller.signal.aborted || ticket !== epoch.current || expectedVersion !== version.current) return;
        if ([401, 403, 404].includes(initialized.status)) { revoke(); return; }
        if (!initialized.ok) throw new Error();
        const prepared: unknown = await initialized.json();
        if (controller.signal.aborted || ticket !== epoch.current || expectedVersion !== version.current) return;
        if (!validTopicPreparationStatus(prepared) || prepared.request_scope !== scope) throw new Error();
        if (!accept(prepared)) return;
        if (prepared.availability !== "available") return;
      }
      const response = await fetch(`${endpoint}/quote`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        if (controller.signal.aborted || ticket !== epoch.current || expectedVersion !== version.current) return;
        if (failure?.error === "brand_context_source_stale" || failure?.error === "brand_context_semantic_context_required") {
          setError(failure.error); await read(); return;
        }
        throw new Error();
      }
      const value: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current || expectedVersion !== version.current) return;
      if (!validTopicPreparationQuote(value) || value.workspace_id !== workspaceId || value.request_scope !== scope) throw new Error();
      // A quote can reveal a saved Brand OS change. Refresh status before allowing its request.
      quoteRef.current = value; setQuote(value);
      if (!pendingRef.current) setCap(embeddingCapUsdInput(String(value.required_cap_micro_usd ?? value.estimated_upper_micro_usd)));
      await read();
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setError("quote"); }
    finally { if (quoter.current === controller) quoter.current = null;
      if (!controller.signal.aborted && ticket === epoch.current) setQuoting(false); }
  };
  const start = async () => {
    const status = current.current;
    if (!status || writer.current || disabled || verifiedVersion !== catalogVersion || error === "load") return;
    let request = pendingRef.current;
    if (request ? checkedKey.current !== request.key || !topicPreparationCanReplay(status, request, quoteRef.current)
      : !topicPreparationCanExecute(status, quoteRef.current, cap)) return;
    if (!request) {
      request = { version: 1, workspace_id: workspaceId, request_scope: status.request_scope, key: crypto.randomUUID(),
        body: { plan_digest: quoteRef.current!.plan_digest, quote_digest: quoteRef.current!.quote_digest,
          hard_cap_micro_usd: Number(parseEmbeddingCapMicroUsd(cap)) } };
      try { sessionStorage.setItem(topicPreparationStorageKey(workspaceId, status.request_scope), JSON.stringify(request)); }
      catch { setError("storage"); return; }
      pendingRef.current = request; setPending(request);
    }
    checkedKey.current = null;
    const controller = new AbortController(); writer.current = controller; const ticket = epoch.current;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        if (controller.signal.aborted || ticket !== epoch.current) return;
        if (response.status < 500) rejectedKey.current = request.key;
        setError(response.status >= 500 ? "request" : failure?.error ?? "rejected"); return;
      }
      const value: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current) return;
      accept(value, request.key);
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setError("request"); }
    finally { if (writer.current === controller) writer.current = null;
      if (!controller.signal.aborted && ticket === epoch.current) { setSubmitting(false); void read(); } }
  };
  const status = data?.workspace_id === workspaceId ? data : null;
  const run = status?.active_run ?? status?.request_run ?? status?.latest_run;
  const unknown = topicPreparationUnknown(status, quote);
  const unusable = quote?.blocking_error_code === "workspace_embedding_prior_response_unusable";
  const unresolved = quote?.blocking_error_code === "workspace_embedding_prior_run_unresolved";
  const canStart = !disabled && !reading && !submitting && !quoting && verifiedVersion === catalogVersion && error !== "load"
    && (pending ? checkedKey.current === pending.key && topicPreparationCanReplay(status, pending, quote) : topicPreparationCanExecute(status, quote, cap));
  const money = (amount: number) => formatEmbeddingMicroUsd(String(amount), locale);
  const capValue = parseEmbeddingCapMicroUsd(cap);
  const validCap = capValue !== null && BigInt(capValue) <= BigInt(Number.MAX_SAFE_INTEGER);
  const quoteCompleted = Boolean(quote && status?.latest_completed?.plan_digest === quote.plan_digest);
  const closedRequest = pending && status?.request_run && ["stale", "canceled"].includes(status.request_run.status) && !unknown;
  const contextBlocked = status?.availability === "context_required" || status?.availability === "context_stale";

  return <div className="topics-manager__cost-notice" aria-label={t("label")}>
    <p>{t("body")}</p>
    {status?.availability === "no_topics" ? <p role="status">{t("noInputs")}</p> : null}
    {contextBlocked ? <p role="status">{t(status.availability === "context_required" ? "contextRequired" : "contextStale")}</p> : null}
    {status?.latest_completed ? <p role="status">{t(status.latest_completed.counts.total_topics === 0
      ? status.is_current && verifiedVersion === catalogVersion ? "currentContext" : "previousContext"
      : status.is_current && verifiedVersion === catalogVersion ? "current" : "previous", {
      count: status.latest_completed.counts.completed_topics })}</p> : null}
    {status?.active_run ? <div className="topics-manager__progress" role="status"><span>{t("progress", {
      done: status.active_run.counts.processed_unique_inputs, total: status.active_run.counts.total_unique_inputs })}</span>
      <progress value={status.active_run.counts.processed_unique_inputs} max={Math.max(1, status.active_run.counts.total_unique_inputs)} /></div> : null}
    {run ? <p>{t("receipt", { cap: money(run.hard_cap_micro_usd), settled: money(run.settled_micro_usd), reserved: money(run.reserved_micro_usd) })}
      {run.unknown_reserved_micro_usd > 0 ? <> {t("unknownAmount", { amount: money(run.unknown_reserved_micro_usd) })}</> : null}
      {run.observed_exception_micro_usd > 0 ? <> {t("exceptionAmount", { amount: money(run.observed_exception_micro_usd) })}</> : null}</p> : null}
    {unknown ? <p role="status">{t("unknown")}</p> : unusable ? <p role="status">{t("unusable")}</p>
      : unresolved ? <p role="status">{t("unresolved")}</p>
      : status?.blocking_run_kind === "corpus" || quote?.blocking_run_kind === "corpus" ? <p role="status">{t("corpusBusy")}</p>
        : run && ["failed", "stale", "canceled"].includes(run.status) ? <p role="status">{t(run.retryable ? "failedRetryable" : "failed")}</p> : null}
    {quote && !quoteCompleted ? <>
      <p>{t("estimate", { amount: money(quote.estimated_upper_micro_usd), cached: quote.cached_unique_inputs, total: quote.total_unique_inputs })}</p>
      {quote.recoverable_receipt_inputs > 0 ? <p>{t("recoverableInputs", { count: quote.recoverable_receipt_inputs })}</p> : null}
      {quote.requires_provider && (!quote.provider_available || !status?.provider_available) ? <p>{t("providerDisabled")}</p> : null}
      {quote.required_cap_micro_usd !== null ? <p>{t("sameCap", { amount: money(quote.required_cap_micro_usd) })}</p>
        : quote.requires_provider && !pending ? <details><summary>{t("changeCap")}</summary>
          <label className="workspace-form__field"><span>{t("cap", { amount: money(quote.max_run_cost_micro_usd) })}</span>
            <input inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value)} disabled={disabled || submitting} /></label>
        </details> : null}
    </> : null}
    {pending && !status?.request_run ? <p role="status">{t("pending")}</p> : null}
    {error ? <p className="team-msg team-msg--error" role="alert">{t(error === "brand_context_source_stale" ? "contextStale"
      : error === "brand_context_semantic_context_required" ? "contextRequired"
        : `errors.${["load", "quote", "storage", "request", "forbidden"].includes(error) ? error : "rejected"}`)}</p> : null}
    {disabled ? <p>{t("saveFirst")}</p> : null}
    <div className="admin-form-actions">
      {closedRequest ? <button className="admin-button" type="button" disabled={disabled || contextBlocked || !status?.can_execute || reading || quoting || submitting}
        onClick={() => void calculate(true)}>{t("newQuote")}</button> : null}
      {!closedRequest && !status?.is_current ? <button className="admin-button" type="button"
        disabled={disabled || contextBlocked || !status?.can_execute || Boolean(status.active_run) || reading || quoting || submitting}
        onClick={() => void calculate()}>{t(quoting ? "quoting" : "quote")}</button> : null}
      {(quote && !quoteCompleted) || pending ? <button className="admin-button admin-button--primary" type="button" disabled={!canStart} onClick={() => void start()}>
        {t(submitting ? "submitting" : pending ? "recover" : "prepare", { amount: money(pending?.body.hard_cap_micro_usd ?? (validCap ? Number(capValue) : 0)) })}</button> : null}
      <button className="admin-button" type="button" disabled={reading || submitting || quoting} onClick={() => void read()}>{t("refresh")}</button>
    </div>
  </div>;
}
