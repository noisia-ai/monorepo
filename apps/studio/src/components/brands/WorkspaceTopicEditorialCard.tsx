"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { validWorkspaceTopicEditorialViewV1, workspaceTopicEditorialIntentV1, submitWorkspaceTopicEditorialIntentV1,
  WorkspaceTopicEditorialRequestError, type WorkspaceTopicEditorialIntentV1, type WorkspaceTopicEditorialViewV1 } from "@/lib/data-os/workspace-topic-editorial-contract";
import { WorkspaceTopicEditorialOutcomes } from "./WorkspaceTopicEditorialOutcomes";

export function WorkspaceTopicEditorialCard({ value, workspaceId, numericExecutionId, busy = false, stale = false, pending = false,
  retryReady = true, onStart, onRetry, onComplete, onReplay, onRefresh }: {
  value: WorkspaceTopicEditorialViewV1; workspaceId?: string; numericExecutionId?: string; busy?: boolean; stale?: boolean; pending?: boolean;
  retryReady?: boolean;
  onStart?: () => void; onRetry?: () => void; onComplete?: () => void; onReplay?: () => void; onRefresh?: () => void;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.editorial"), locale = useLocale();
  const money = (v: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(v) / 1_000_000);
  const state = value.status;
  const execution = value.execution;
  return <section className="admin-section topics-manager__editorial" data-topic-editorial-state={state} data-serving-activation="not-activated">
    <div className="admin-section__head"><div><h3>{t("title")}</h3><p>{t("body")}</p></div></div>
    <div className="admin-section__body admin-drawer-form">
      <p role="status">{t(`states.${state}`)}</p>
      {value.replaces_failed_v1 ? <p role="status">{t("legacySuccessor")}</p> : null}
      {execution ? <>
        <p>{t("progress", { done: execution.completed_screening_count, total: execution.expected_screening_count })}</p>
        {value.batch_progress ? <>
          <dl className="admin-summary-strip admin-summary-strip--compact" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
            <div><dt>{t("outcomes.topics")}</dt><dd>{value.batch_progress.topics}</dd></div>
            <div><dt>{t("outcomes.narratives")}</dt><dd>{value.batch_progress.narratives}</dd></div>
            <div><dt>{t("outcomes.noise")}</dt><dd>{value.batch_progress.noise}</dd></div>
            <div><dt>{t("outcomes.insufficient")}</dt><dd>{value.batch_progress.insufficient_evidence}</dd></div>
            <div><dt>{t("outcomes.errors")}</dt><dd>{value.batch_progress.technical_errors}</dd></div>
            <div><dt>{t("outcomes.pending")}</dt><dd>{value.batch_progress.pending}</dd></div>
          </dl>
          {value.batch_progress.technical_errors > 0 ? <div role="alert" className="team-msg team-msg--error">
            <p>{t("outcomes.errorPreserved")}</p>
            {value.batch_progress.error_codes.length ? <p>{t("outcomes.errorCodes", { codes: value.batch_progress.error_codes.join(", ") })}</p> : null}
          </div> : null}
          {value.batch_progress.pending > 0 ? <p role="status">{t("outcomes.resume")}</p> : null}
        </> : null}
        {value.batch_progress && execution && workspaceId && numericExecutionId
          ? <WorkspaceTopicEditorialOutcomes workspaceId={workspaceId} numericExecutionId={numericExecutionId} executionId={execution.execution_id} /> : null}
        {!stale ? <dl className="admin-summary-strip admin-summary-strip--compact" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}>
          <div><dt>{t("maximum")}</dt><dd>{money(execution.maximum_micro_usd)}</dd></div>
          <div><dt>{t("confirmed")}</dt><dd>{money(execution.confirmed_micro_usd)}</dd></div>
          <div><dt>{t("reserved")}</dt><dd>{money(execution.reserved_micro_usd)}</dd></div>
          <div><dt>{t("ambiguous")}</dt><dd>{money(execution.ambiguous_micro_usd)}</dd></div>
        </dl> : null}
      </> : null}
      <p className="admin-drawer-form__hint">{t("preserves")}</p>
      {value.status === "failed" && !value.can_retry && retryReady ? <p>{t("retryBlocked")}</p> : null}
      <div className="admin-form-actions">
        {pending ? <button type="button" className="admin-button admin-button--primary" disabled={busy || !onReplay} onClick={onReplay}>{t("replay")}</button>
          : value.can_quote && !stale ? <button type="button" className="admin-button admin-button--primary" disabled={busy || !onStart} onClick={onStart}>{t("start")}</button>
          : value.can_complete && !stale ? <button type="button" className="admin-button admin-button--primary" disabled={busy || !onComplete} onClick={onComplete}>{t("complete")}</button>
          : value.can_retry && retryReady && !stale ? <button type="button" className="admin-button admin-button--primary" disabled={busy || !onRetry} onClick={onRetry}>{t("retry")}</button> : null}
        <button type="button" className="admin-button" disabled={busy || !onRefresh} onClick={onRefresh}>{t("refresh")}</button>
      </div>
    </div>
  </section>;
}

/** Parent keys this component by workspace and immutable numeric control ID. */
export function WorkspaceTopicEditorialControls({ workspaceId, numericExecutionId, disabled = false, onCatalogAvailable }: {
  workspaceId: string; numericExecutionId: string; disabled?: boolean; onCatalogAvailable?: (signal: AbortSignal) => Promise<unknown>;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.editorial"), locale = useLocale();
  const [value, setValue] = useState<WorkspaceTopicEditorialViewV1 | null>(null);
  const [busy, setBusy] = useState(false), [loadError, setLoadError] = useState(false), [requestError, setRequestError] = useState(false);
  const [pending, setPending] = useState(false), [now, setNow] = useState(Date.now);
  const [renewal, setRenewal] = useState<{ status: string; quote_reference?: string; quote_expires_at?: string;
    grant_cap_micro_usd?: string; remaining_micro_usd?: string } | null>(null);
  const [renewalConfirmed, setRenewalConfirmed] = useState(false), [renewalBusy, setRenewalBusy] = useState(false);
  const [renewalError, setRenewalError] = useState(false);
  const renewalIntent = useRef<{ key: string; quote: string; cap: string } | null>(null);
  const readController = useRef<AbortController | null>(null), submitController = useRef<AbortController | null>(null);
  const intent = useRef<WorkspaceTopicEditorialIntentV1 | null>(null);
  const delivered = useRef<string | null>(null);
  const current = useRef(`${workspaceId}:${numericExecutionId}`); current.current = `${workspaceId}:${numericExecutionId}`;
  const scope = `${workspaceId}:${numericExecutionId}`;
  const read = useCallback(async () => {
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/editorial?numeric_execution_id=${encodeURIComponent(numericExecutionId)}`,
        { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (controller.signal.aborted || current.current !== scope) return;
      if ([401, 403, 404].includes(response.status)) setValue(null);
      if (!response.ok || !validWorkspaceTopicEditorialViewV1(body, workspaceId, numericExecutionId)) throw new Error("status");
      setValue(body); setLoadError(false); setNow(Date.now());
    } catch { if (!controller.signal.aborted && current.current === scope) setLoadError(true); }
    finally { if (readController.current === controller && !controller.signal.aborted && current.current === scope) readController.current = null; }
  }, [workspaceId, numericExecutionId, scope]);
  useEffect(() => {
    setValue(null); setBusy(false); setPending(false); setRequestError(false); setLoadError(false); intent.current = null; void read();
    return () => { readController.current?.abort(); submitController.current?.abort(); };
  }, [read]);
  const renewalExecution = value?.status === "failed" ? value.execution?.execution_id : null;
  const readRenewal = useCallback(async () => {
    if (!renewalExecution) return;
    setRenewalError(false);
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/editorial/renewal?execution_id=${encodeURIComponent(renewalExecution)}`,
        { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || Array.isArray(body) || typeof (body as { status?: unknown }).status !== "string")
        throw new Error("renewal_quote_unavailable");
      if (current.current !== scope) return;
      setRenewal(body as typeof renewal); setRenewalConfirmed(false);
    } catch { if (current.current === scope) { setRenewal(null); setRenewalError(true); } }
  }, [renewalExecution, workspaceId, scope]);
  useEffect(() => {
    setRenewal(null); setRenewalConfirmed(false); renewalIntent.current = null;
    if (renewalExecution) void readRenewal();
  }, [renewalExecution, readRenewal]);
  useEffect(() => {
    if (!renewal?.quote_expires_at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer);
  }, [renewal?.quote_expires_at]);
  const submitRenewal = async () => {
    if (!renewalExecution || renewalBusy || !renewalConfirmed || renewal?.status !== "ready_to_authorize"
      || !renewal.quote_reference || !renewal.grant_cap_micro_usd || !renewal.quote_expires_at
      || Date.parse(renewal.quote_expires_at) <= Date.now()) return;
    const previous = renewalIntent.current;
    const next = previous?.quote === renewal.quote_reference && previous.cap === renewal.grant_cap_micro_usd
      ? previous : { key: crypto.randomUUID(), quote: renewal.quote_reference, cap: renewal.grant_cap_micro_usd };
    renewalIntent.current = next; setRenewalBusy(true); setRenewalError(false);
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/editorial/renewal`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": next.key },
        body: JSON.stringify({ execution_id: renewalExecution, quote_reference: next.quote, confirmed_cap_micro_usd: next.cap })
      });
      const receipt: unknown = await response.json();
      if (!response.ok || !receipt || typeof receipt !== "object" || Array.isArray(receipt)
        || (receipt as { execution_id?: unknown }).execution_id !== renewalExecution) throw new Error("renewal_unconfirmed");
      if (current.current !== scope) return;
      renewalIntent.current = null; setRenewalConfirmed(false);
      await Promise.all([read(), readRenewal()]);
    } catch { if (current.current === scope) setRenewalError(true); }
    finally { if (current.current === scope) setRenewalBusy(false); }
  };
  useEffect(() => {
    if (!value?.execution || !["queued", "running", "review_ready"].includes(value.status)) return;
    const timer = window.setInterval(() => { if (!readController.current && !submitController.current) void read(); }, 5000);
    return () => window.clearInterval(timer);
  }, [value, read]);
  useEffect(() => {
    const id = value?.status === "completed" ? value.execution?.execution_id : null;
    if (!id || disabled || !onCatalogAvailable || delivered.current === id) return;
    const controller = new AbortController();
    void onCatalogAvailable(controller.signal).then(() => { if (!controller.signal.aborted) delivered.current = id; }).catch(() => undefined);
    return () => controller.abort();
  }, [value, disabled, onCatalogAvailable]);
  const submit = async (replay = false) => {
    if (disabled || submitController.current || busy || !value || current.current !== scope) return;
    let next = intent.current;
    if (!replay) {
      const body = value.can_complete && value.execution ? { action: "complete_catalog" as const, numeric_execution_id: numericExecutionId, execution_id: value.execution.execution_id }
        : value.can_retry && value.execution ? { action: "retry_editorial" as const, numeric_execution_id: numericExecutionId, execution_id: value.execution.execution_id }
        : value.can_quote ? { action: "start_editorial" as const, numeric_execution_id: numericExecutionId } : null;
      if (!body || loadError) return;
      next = workspaceTopicEditorialIntentV1(workspaceId, body, intent.current, () => crypto.randomUUID());
    }
    if (!next || next.workspace_id !== workspaceId || next.body.numeric_execution_id !== numericExecutionId) return;
    intent.current = next; setPending(true); setBusy(true); setRequestError(false);
    readController.current?.abort();
    const controller = new AbortController(); submitController.current = controller;
    try {
      await submitWorkspaceTopicEditorialIntentV1(next, fetch, controller.signal);
      if (controller.signal.aborted || current.current !== scope) return;
      intent.current = null; setPending(false); await read();
    } catch (error) {
      if (!controller.signal.aborted && current.current === scope) {
        if (error instanceof WorkspaceTopicEditorialRequestError && error.quoteRejected) { intent.current = null; setPending(false); }
        setRequestError(true); await read();
      }
    } finally { if (submitController.current === controller) submitController.current = null;
      if (!controller.signal.aborted && current.current === scope) setBusy(false); }
  };
  if (!value || value.workspace_id !== workspaceId || value.numeric_execution_id !== numericExecutionId)
    return loadError ? <p role="alert" className="team-msg team-msg--error">{t("loadError")} <button type="button" className="admin-button" onClick={() => void read()}>{t("refresh")}</button></p> : null;
  return <>
    <WorkspaceTopicEditorialCard value={value} workspaceId={workspaceId} numericExecutionId={numericExecutionId} busy={disabled || busy} stale={loadError} pending={pending}
      retryReady={value.status !== "failed" || renewal?.status === "admission_not_expired"
        || !!value.execution && value.execution.completed_screening_count === value.execution.expected_screening_count}
      onStart={() => void submit()} onRetry={() => void submit()}
      onComplete={() => void submit()} onReplay={() => void submit(true)} onRefresh={() => void read()} />
    {renewalExecution ? <section className="admin-section" aria-label={t("renewal.title")}>
      <div className="admin-section__head"><div><h3>{t("renewal.title")}</h3><p>{t("renewal.body")}</p></div></div>
      <div className="admin-section__body admin-drawer-form">
        {renewal?.status === "ready_to_authorize" && renewal.grant_cap_micro_usd && renewal.remaining_micro_usd && renewal.quote_expires_at ? <>
          <p role="status">{t("renewal.available", {
            maximum: new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(Number(renewal.grant_cap_micro_usd) / 1_000_000),
            remaining: new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(Number(renewal.remaining_micro_usd) / 1_000_000)
          })}</p>
          <label className="admin-checkbox"><input type="checkbox" checked={renewalConfirmed} disabled={renewalBusy || disabled}
            onChange={event => setRenewalConfirmed(event.target.checked)} />{t("renewal.confirmation")}</label>
          <button type="button" className="admin-button admin-button--primary" disabled={!renewalConfirmed || renewalBusy || disabled
            || Date.parse(renewal.quote_expires_at) <= now} onClick={() => void submitRenewal()}>{t("renewal.authorize")}</button>
        </> : <p role="status">{t(`renewal.states.${renewal?.status === "admission_not_expired" ? "active" :
          renewal?.status === "budget_unavailable" ? "budget" : renewal?.status === "renewal_already_used_today" ? "already" :
          renewal?.status === "policy_required" || renewal?.status === "policy_action_required" ? "policy" : "unavailable"}`)}</p>}
        {renewalError ? <p role="alert" className="team-msg team-msg--error">{t("renewal.error")}</p> : null}
        <button type="button" className="admin-button" disabled={renewalBusy || disabled} onClick={() => void readRenewal()}>{t("refresh")}</button>
      </div>
    </section> : null}
    {loadError ? <p className="team-msg team-msg--error" role="alert">{t("loadError")}</p> : null}
    {requestError ? <p className="team-msg team-msg--error" role="alert">{t("requestError")}</p> : null}
  </>;
}
