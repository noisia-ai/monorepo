"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalWorkspaceEmbeddingsQuoteV1, SignalWorkspaceEmbeddingsStatusV1 } from "@noisia/db";
import { AdminStatus, formatAdminNumber } from "./AdminWorkspacePrimitives";
import { embeddingCapUsdInput, embeddingRequestStorageKey, formatEmbeddingMicroUsd, latestCorpusEmbeddingSnapshot,
  parseEmbeddingCapMicroUsd, parsePendingCorpusEmbeddingRequest, type PendingCorpusEmbeddingRequest } from "../../lib/data-os/workspace-corpus-embeddings-ui";

type Access = { can_execute: boolean; provider_available: boolean; max_run_cost_micro_usd: number; request_scope: string };
export type CorpusEmbeddingsStatus = SignalWorkspaceEmbeddingsStatusV1 & Access;
export type CorpusEmbeddingsQuote = SignalWorkspaceEmbeddingsQuoteV1 & Access;
type ErrorKey = "load" | "quote" | "forbidden" | "storage" | "cap" | "stale" | "failed" | "rejected" | "permissions" | "provider";

export function embeddingQuoteCanExecute(quote: CorpusEmbeddingsQuote | null, status: CorpusEmbeddingsStatus | null,
  preparationRunId: string | null, capUsd: string) {
  const cap = parseEmbeddingCapMicroUsd(capUsd);
  const provider = Boolean(quote?.provider_available && status?.provider_available);
  const reuse = Boolean(quote && embeddingQuoteIsCacheOnly(quote) && cap === "0"
    && !status?.latest_run?.reserved_micro_usd && !status?.latest_run?.observed_exception_micro_usd);
  return Boolean(quote && validCorpusEmbeddingQuote(quote) && status && quote.can_execute && status.can_execute && (provider || reuse)
    && quote.request_scope === status.request_scope && quote.preparation_run_id === preparationRunId
    && !status.active_run && status.latest_run?.status !== "outcome_unknown" && !status.latest_run?.unknown_reserved_micro_usd
    && !(status.latest_run?.status === "failed" && !status.latest_run.retryable && status.latest_run.preparation_run_id === preparationRunId)
    && cap !== null && BigInt(cap) >= BigInt(quote.estimated_upper_micro_usd)
    && (quote.required_cap_micro_usd === null || BigInt(cap) === BigInt(quote.required_cap_micro_usd))
    && BigInt(cap) <= BigInt(Math.min(quote.max_run_cost_micro_usd, status.max_run_cost_micro_usd)));
}

export function embeddingQuoteIsCacheOnly(quote: CorpusEmbeddingsQuote) {
  return validCorpusEmbeddingQuote(quote) && quote.total_asset_chunks > 0
    && quote.missing_asset_chunks === 0 && quote.cached_asset_chunks === quote.total_asset_chunks
    && quote.full_text_bytes === 0 && quote.tokens_upper === 0 && quote.estimated_upper_micro_usd === 0
    && (quote.required_cap_micro_usd === null || quote.required_cap_micro_usd === 0);
}

function validAccess(value: Access) {
  return typeof value.request_scope === "string" && value.request_scope.length > 0
    && typeof value.can_execute === "boolean" && typeof value.provider_available === "boolean"
    && Number.isSafeInteger(value.max_run_cost_micro_usd) && value.max_run_cost_micro_usd >= 0;
}

const safeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function validCorpusEmbeddingQuote(value: unknown): value is CorpusEmbeddingsQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const quote = value as CorpusEmbeddingsQuote;
  return quote.contract_version === "signal-workspace-embeddings-quote-v1" && validAccess(quote)
    && typeof quote.preparation_run_id === "string" && uuid.test(quote.preparation_run_id)
    && typeof quote.quote_digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(quote.quote_digest)
    && [quote.estimated_upper_micro_usd, quote.eligible_roots, quote.total_chunk_references,
      quote.total_asset_chunks, quote.cached_asset_chunks, quote.missing_asset_chunks, quote.full_text_bytes, quote.tokens_upper].every(safeCount)
    && quote.cached_asset_chunks + quote.missing_asset_chunks === quote.total_asset_chunks
    && (quote.required_cap_micro_usd === null || safeCount(quote.required_cap_micro_usd))
    && (quote.resume_run_id === null || typeof quote.resume_run_id === "string" && uuid.test(quote.resume_run_id))
    && (quote.resume_run_id === null) === (quote.required_cap_micro_usd === null);
}

function validStatus(value: unknown): value is CorpusEmbeddingsStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as CorpusEmbeddingsStatus;
  return status.contract_version === "signal-workspace-embeddings-v1" && validAccess(status)
    && typeof status.is_current === "boolean"
    && [status.active_run, status.latest_run, status.latest_completed, status.request_run].every((run) => run === null
      || Boolean(run && typeof run.id === "string" && typeof run.preparation_run_id === "string" && run.counts
        && ["queued", "running", "completed", "failed", "stale", "outcome_unknown", "canceled"].includes(run.status)
        && typeof run.retryable === "boolean" && [run.counts.eligible_roots, run.counts.completed_roots, run.counts.partial_roots,
          run.counts.pending_roots, run.counts.total_chunk_references, run.counts.processed_chunk_references,
          run.counts.total_asset_chunks, run.counts.processed_asset_chunks, run.counts.cache_hits, run.counts.embedded_unique_chunks].every(safeCount)
        && [run.hard_cap_micro_usd, run.estimated_upper_micro_usd, run.reserved_micro_usd, run.settled_micro_usd,
          run.unknown_reserved_micro_usd, run.observed_exception_micro_usd].every(safeCount)));
}

export function WorkspaceCorpusEmbeddingsControls({ workspaceId, preparationRunId, initialStatus = null, initialQuote = null }: {
  workspaceId: string; preparationRunId: string | null;
  initialStatus?: CorpusEmbeddingsStatus | null; initialQuote?: CorpusEmbeddingsQuote | null;
}) {
  const t = useTranslations("AdminWorkspace.data.corpusEmbeddings");
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState(initialStatus);
  const data = snapshot?.workspace_id === workspaceId ? snapshot : null;
  const [quoteSnapshot, setQuote] = useState(initialQuote);
  const quote = quoteSnapshot?.workspace_id === workspaceId && quoteSnapshot.request_scope === data?.request_scope
    && quoteSnapshot.preparation_run_id === preparationRunId ? quoteSnapshot : null;
  const [cap, setCap] = useState(initialQuote ? embeddingCapUsdInput(String(initialQuote.required_cap_micro_usd ?? initialQuote.estimated_upper_micro_usd)) : "");
  const [pendingSnapshot, setPending] = useState<PendingCorpusEmbeddingRequest | null>(null);
  const pending = pendingSnapshot?.workspace_id === workspaceId && pendingSnapshot.request_scope === data?.request_scope ? pendingSnapshot : null;
  const [reading, setReading] = useState(!initialStatus);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const generation = useRef(0);
  const requestScope = useRef<string | null>(initialStatus?.request_scope ?? null);
  const pendingRef = useRef<PendingCorpusEmbeddingRequest | null>(null);
  const reader = useRef<AbortController | null>(null);
  const quoter = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const pendingChecked = useRef(false);
  const currentPreparation = useRef(preparationRunId);
  currentPreparation.current = preparationRunId;
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/corpus/embeddings`;

  const forgetPending = useCallback(() => {
    const retained = pendingRef.current;
    if (retained) {
      try { sessionStorage.removeItem(embeddingRequestStorageKey(retained.workspace_id, retained.request_scope)); }
      catch { /* The accepted request remains durable in the server. */ }
    }
    pendingRef.current = null; pendingChecked.current = false; setPending(null);
  }, []);

  const clearAccess = useCallback(() => {
    generation.current += 1; reader.current?.abort(); quoter.current?.abort(); mutation.current?.abort();
    mutation.current = null; forgetPending(); requestScope.current = null;
    setSnapshot(null); setQuote(null); setCap(""); setReading(false); setQuoting(false); setSubmitting(false); setError("forbidden");
  }, [forgetPending]);

  const accept = useCallback((next: CorpusEmbeddingsStatus) => {
    if (!validStatus(next)
      || !latestCorpusEmbeddingSnapshot(null, next, workspaceId)) throw new Error("embedding_status_invalid");
    if (requestScope.current && requestScope.current !== next.request_scope) {
      generation.current += 1; mutation.current?.abort(); mutation.current = null; quoter.current?.abort();
      forgetPending(); setQuote(null); setCap(""); setSubmitting(false); setQuoting(false);
      setSnapshot(next);
    } else setSnapshot((previous) => latestCorpusEmbeddingSnapshot(previous, next, workspaceId));
    requestScope.current = next.request_scope;
  }, [workspaceId, forgetPending]);

  const read = useCallback(async function readStatus() {
    reader.current?.abort();
    const controller = new AbortController(); reader.current = controller;
    const started = generation.current;
    const retained = pendingRef.current;
    setReading(true);
    try {
      const params = retained ? `?${new URLSearchParams({ idempotency_key: retained.key })}` : "";
      const response = await fetch(`${endpoint}${params}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || started !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      if (!response.ok) throw new Error();
      const next = await response.json() as CorpusEmbeddingsStatus;
      if (controller.signal.aborted || started !== generation.current) return;
      accept(next);
      if (retained && retained.request_scope === next.request_scope) {
        pendingChecked.current = true;
        if (next.request_run) forgetPending();
      }
      // First obtain the current actor/workspace scope, then recover only its exact key.
      if (!retained && !pendingRef.current) {
        try {
          const raw = sessionStorage.getItem(embeddingRequestStorageKey(workspaceId, next.request_scope));
          if (raw) {
            pendingRef.current = parsePendingCorpusEmbeddingRequest(JSON.parse(raw), workspaceId, next.request_scope);
            setPending(pendingRef.current); pendingChecked.current = false;
            await readStatus(); return;
          }
        } catch { setError("storage"); return; }
      }
      setError(null);
    } catch {
      if (!controller.signal.aborted && started === generation.current) { pendingChecked.current = false; setError("load"); }
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }, [endpoint, workspaceId, accept, clearAccess, forgetPending]);

  useEffect(() => {
    generation.current += 1; requestScope.current = null; pendingRef.current = null; pendingChecked.current = false;
    setPending(null); setError(null); setSubmitting(false);
    return () => { generation.current += 1; reader.current?.abort(); quoter.current?.abort(); mutation.current?.abort(); mutation.current = null; };
  }, [workspaceId]);

  useEffect(() => { void read(); }, [read, preparationRunId]);
  useEffect(() => {
    if (quoteSnapshot && (quoteSnapshot.workspace_id !== workspaceId || quoteSnapshot.preparation_run_id !== preparationRunId)) { setQuote(null); setCap(""); }
  }, [preparationRunId, quoteSnapshot, workspaceId]);
  const active = data?.active_run && ["queued", "running"].includes(data.active_run.status) ? data.active_run : null;
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => { timer = setTimeout(async () => { await read(); if (!canceled) next(); }, 4_000); };
    next();
    return () => { canceled = true; clearTimeout(timer); };
  }, [activeId, read]);

  async function calculateQuote() {
    if (!preparationRunId || !data || pendingRef.current || quoter.current || mutation.current || active) return;
    const controller = new AbortController(); quoter.current = controller;
    const started = generation.current; const expectedScope = data.request_scope; const expectedPreparation = preparationRunId;
    setQuoting(true); setQuote(null); setError(null);
    try {
      const response = await fetch(`${endpoint}/quote`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || started !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      if (!response.ok) { if (response.status === 409) setError("stale"); else setError("quote"); return; }
      const next = await response.json() as CorpusEmbeddingsQuote;
      if (controller.signal.aborted || started !== generation.current) return;
      if (!validCorpusEmbeddingQuote(next)
        || next.workspace_id !== workspaceId || next.request_scope !== expectedScope
        || next.preparation_run_id !== expectedPreparation || currentPreparation.current !== expectedPreparation) {
        setError("stale"); return;
      }
      setQuote(next); setCap(embeddingCapUsdInput(String(next.required_cap_micro_usd ?? next.estimated_upper_micro_usd)));
    } catch { if (!controller.signal.aborted && started === generation.current) setError("quote"); }
    finally { if (quoter.current === controller) quoter.current = null; if (!controller.signal.aborted) setQuoting(false); }
  }

  async function start(recover = false) {
    if (mutation.current || !data || !data.can_execute || active
      || data.latest_run?.status === "outcome_unknown" || data.latest_run?.unknown_reserved_micro_usd) return;
    let retained = pendingRef.current;
    if (recover) { if (!retained || !pendingChecked.current || retained.request_scope !== data.request_scope
      || !data.provider_available && (retained.body.hard_cap_micro_usd !== 0
        || data.latest_run?.reserved_micro_usd || data.latest_run?.observed_exception_micro_usd)) return; }
    else {
      if (retained || !quote) return;
      if (!embeddingQuoteCanExecute(quote, data, preparationRunId, cap)) { setError("cap"); return; }
      retained = { version: 1, workspace_id: workspaceId, request_scope: data.request_scope, key: crypto.randomUUID(),
        body: { preparation_run_id: quote.preparation_run_id, quote_digest: quote.quote_digest,
          hard_cap_micro_usd: Number(parseEmbeddingCapMicroUsd(cap)) } };
    }
    if (!retained) return;
    try {
      parsePendingCorpusEmbeddingRequest(retained, workspaceId, data.request_scope);
      sessionStorage.setItem(embeddingRequestStorageKey(workspaceId, data.request_scope), JSON.stringify(retained));
    } catch { setError("storage"); return; }
    pendingRef.current = retained; setPending(retained); pendingChecked.current = false;
    const controller = new AbortController(); mutation.current = controller;
    const started = generation.current;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": retained.key }, body: JSON.stringify(retained.body) });
      if (controller.signal.aborted || started !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        if (controller.signal.aborted || started !== generation.current) return;
        if (failure?.error === "workspace_embedding_provider_unavailable") {
          if (!recover) forgetPending();
          setQuote(null); setCap(""); setError("provider");
        } else if (response.status < 500) {
          forgetPending(); setQuote(null); setCap(""); setError(response.status === 409 ? "stale" : "rejected");
        }
        return;
      }
      const next = await response.json() as CorpusEmbeddingsStatus;
      if (controller.signal.aborted || started !== generation.current) return;
      if (next.request_scope !== retained.request_scope) { clearAccess(); return; }
      accept(next);
      // Only a response tied to this idempotency key establishes acceptance.
      if (next.request_run) { forgetPending(); setQuote(null); setCap(""); }
    } catch { /* Keep the exact persisted request; a lost response is not a rejected run. */ }
    finally {
      if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted && started === generation.current) { setSubmitting(false); void read(); }
    }
  }

  const run = active ?? data?.latest_run;
  const unknown = run?.status === "outcome_unknown" || Boolean(run?.unknown_reserved_micro_usd);
  const blockedFailure = run?.status === "failed" && !run.retryable && run.preparation_run_id === preparationRunId;
  const counts = run?.counts;
  const current = Boolean(data?.is_current && run?.status === "completed" && run.preparation_run_id === preparationRunId);
  const money = (value: number) => formatEmbeddingMicroUsd(String(value), locale);
  const number = (value: number) => formatAdminNumber(value, locale);
  const capMicro = parseEmbeddingCapMicroUsd(cap);
  const availableCap = quote ? Math.min(quote.max_run_cost_micro_usd, data?.max_run_cost_micro_usd ?? quote.max_run_cost_micro_usd) : 0;
  const quoteExceedsLimit = Boolean(quote && (quote.required_cap_micro_usd ?? quote.estimated_upper_micro_usd) > availableCap);
  const canStart = !reading && !quoting && !submitting && !pending && !error && !unknown
    && embeddingQuoteCanExecute(quote, data, preparationRunId, cap);
  const displayState = run?.status === "completed" && !current ? "stale" : run?.status;

  return <div aria-busy={reading || quoting || submitting}>
    <p className="admin-drawer-form__intro"><strong>{t("title")}</strong>{displayState ? <> · <AdminStatus state={current && !error ? "good" : "not_available"}>
      {t(error === "load" ? "lastKnown" : `states.${displayState}`)}</AdminStatus></> : null}</p>
    <p className="admin-drawer-form__hint">{t("body")}</p>
    {!data && reading ? <p className="admin-drawer-form__hint" role="status">{t("loading")}</p> : null}
    {error ? <p className="workspace-form__error" role="alert">{t(`errors.${error === "load" && data ? "refresh" : error}`)}</p> : null}
    {counts ? <>
      <p className="admin-drawer-form__intro">{t("coverage", { completed: number(counts.completed_roots), total: number(counts.eligible_roots),
        partial: number(counts.partial_roots), pending: number(counts.pending_roots) })}</p>
      {active && counts.eligible_roots > 0 ? <progress aria-label={t("progressLabel")} max={counts.eligible_roots} value={counts.completed_roots} /> : null}
      <p className="admin-drawer-form__hint">{t("chunks", { processed: number(counts.processed_chunk_references), total: number(counts.total_chunk_references) })}</p>
    </> : null}
    {current ? <p className="admin-drawer-form__intro">{t("complete")}</p> : null}
    {run && run.preparation_run_id !== preparationRunId ? <p className="admin-drawer-form__hint">{t("outdated")}</p> : null}
    {data?.latest_completed && data.latest_completed.id !== run?.id ? <p className="admin-drawer-form__hint">{t("previous", { count: number(data.latest_completed.counts.completed_roots) })}</p> : null}
    {run ? <p className="admin-drawer-form__hint">{t("settled", { amount: money(run.settled_micro_usd) })} · {t("reserved", { amount: money(run.reserved_micro_usd) })}
      {run.unknown_reserved_micro_usd > 0 ? <> {t("unknownCost", { amount: money(run.unknown_reserved_micro_usd) })}</> : null}</p> : null}
    {run?.observed_exception_micro_usd ? <p className="workspace-form__error" role="alert">{t("costException", { amount: money(run.observed_exception_micro_usd) })}</p> : null}
    {unknown ? <p className="workspace-form__error" role="alert">{t("unknown")}</p> : null}
    {run?.status === "failed" && !unknown ? <p className="workspace-form__error" role="alert">{t(run.error_code?.includes("forbidden") ? "errors.permissions" : "errors.failed")}</p> : null}
    {pending && !submitting ? <p className="workspace-form__error" role="alert">{t("requestUnknown")}</p> : null}
    {data && !data.provider_available ? <p className="admin-drawer-form__hint">{t(quote && embeddingQuoteIsCacheOnly(quote) ? "cacheOnly" : "disabled")}</p> : null}
    {data && !data.can_execute ? <p className="admin-drawer-form__hint">{t("readOnly")}</p> : null}
    {quote && !pending ? <>
      <p className="admin-drawer-form__intro">{t("quoteCoverage", { roots: number(quote.eligible_roots), chunks: number(quote.total_chunk_references) })}</p>
      <p className="admin-drawer-form__hint">{t("cache", { cached: number(quote.cached_asset_chunks), missing: number(quote.missing_asset_chunks) })}</p>
      <p className="admin-drawer-form__intro"><strong>{t("estimate", { amount: money(quote.estimated_upper_micro_usd) })}</strong>
        {capMicro !== null && BigInt(capMicro) <= BigInt(Number.MAX_SAFE_INTEGER) ? <> · {t("cap", { amount: money(Number(capMicro)) })}</> : null}</p>
      {quoteExceedsLimit ? <p className="admin-drawer-form__hint" role="status">{t("quoteExceedsLimit", { amount: money(availableCap) })}</p> : null}
      {quote.required_cap_micro_usd !== null ? <p className="admin-drawer-form__hint">{t("resumeBudget")}</p> : <details><summary>{t("changeCap")}</summary>
        <label className="workspace-form__field"><span>{t("capLabel")}</span>
          <input inputMode="decimal" value={cap} onChange={(event) => { setCap(event.target.value); setError((previous) => previous === "cap" ? null : previous); }} disabled={submitting} />
        </label>
        <p className="admin-drawer-form__hint">{t("capHelp", { amount: money(Math.min(quote.max_run_cost_micro_usd, data?.max_run_cost_micro_usd ?? quote.max_run_cost_micro_usd)) })}</p>
      </details>}
      {!quoteExceedsLimit && (capMicro === null || BigInt(capMicro) < BigInt(quote.estimated_upper_micro_usd) || BigInt(capMicro) > BigInt(availableCap))
        ? <p className="workspace-form__error" role="alert">{t("errors.cap")}</p> : null}
    </> : null}
    <div className="admin-form-actions">
      {preparationRunId && data && !active && !pending && !current && !unknown && !blockedFailure ? <button className="admin-button" type="button" disabled={reading || quoting || submitting}
        onClick={() => void calculateQuote()}>{t(quoting ? "actions.quoting" : "actions.quote")}</button> : null}
      {quote && !pending ? <button className="admin-button admin-button--primary" type="button" disabled={!canStart} onClick={() => void start()}>
        {t(submitting ? "actions.requesting" : quote.resume_run_id ? "actions.resume" : quote.missing_asset_chunks === 0 && quote.estimated_upper_micro_usd === 0 ? "actions.reuse" : "actions.prepare", { amount: money(capMicro !== null && BigInt(capMicro) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(capMicro) : quote.estimated_upper_micro_usd) })}</button> : null}
      {pending ? <button className="admin-button" type="button" disabled={reading || submitting || !pendingChecked.current || !data?.can_execute
        || !data?.provider_available && (pending.body.hard_cap_micro_usd !== 0
          || Boolean(data?.latest_run?.reserved_micro_usd) || Boolean(data?.latest_run?.observed_exception_micro_usd)) || Boolean(active) || unknown}
        onClick={() => void start(true)}>{t(submitting ? "actions.requesting" : "actions.confirm")}</button> : null}
      <button className="admin-button admin-button--compact" type="button" disabled={reading || submitting} onClick={() => void read()}>{t("actions.refresh")}</button>
    </div>
    {preparationRunId && !active && !current ? <p className="admin-drawer-form__hint">{t("freeQuote")}</p> : null}
  </div>;
}
