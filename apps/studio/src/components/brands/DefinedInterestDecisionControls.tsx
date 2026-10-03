"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type DefinedInterestDecisionStatusV1 = {
  owner_id?: string; status: "not_started" | "open" | "ready" | "completed" | "blocked";
  expected_roots: number; manifest_roots: number; accepted_roots: number;
  unknown_batches: number; unsettled_calls: number; manifest_complete?: boolean;
  terminal_failed_roots?: number;
  technical_error_code?: "interest_decision_attempts_exhausted" | null;
  classification_status?: string | null; classification_processed_roots?: number;
  classification_total_roots?: number; classification_error_code?: string | null;
  generation_status?: string | null;
};
type Intent = { key: string; owner_id?: string; rejected_before_admission?: boolean };
const storageKey = (actorId: string, workspaceId: string, termKey: string) =>
  `noisia:interest-decision:${actorId}:${workspaceId}:${termKey}`;
const requestKey = /^[A-Za-z0-9._:-]{8,200}$/u;
const active = (status: DefinedInterestDecisionStatusV1) =>
  status.status === "open" || status.status === "ready";

export function definedInterestDecisionViewV1(status: DefinedInterestDecisionStatusV1 | null,
  dirty: boolean, disabled: boolean, intent: Intent | null) {
  const started = status?.status !== "not_started" && status !== null;
  const classificationReady = status?.classification_status === "ready" && status.generation_status === "ready";
  const materializationFailed = status?.classification_status === "failed";
  const terminalFailed = Boolean(status?.status === "ready" && status.manifest_complete
    && (status.terminal_failed_roots ?? 0) > 0
    && status.accepted_roots + (status.terminal_failed_roots ?? 0) >= status.expected_roots
    && status.unknown_batches === 0 && status.unsettled_calls === 0);
  const phase = status?.status === "completed" ? classificationReady ? "complete"
    : materializationFailed ? "materializationFailed" : "materializing"
    : terminalFailed ? "technicalFailed" : status?.status ?? "not_started";
  return {
    canStart: !disabled && !dirty && !intent && status?.status === "not_started",
    canReplaceRejected: !disabled && !dirty && status?.status === "not_started"
      && intent?.rejected_before_admission === true,
    shouldPoll: Boolean(status && !terminalFailed && (active(status) || status.status === "completed"
      && !classificationReady && !materializationFailed) && status.unknown_batches === 0),
    showProgress: Boolean(started),
    attention: Boolean(status && (status.unknown_batches > 0 || status.unsettled_calls > 0
      || (status.terminal_failed_roots ?? 0) > 0)),
    phase,
  };
}

export function validDefinedInterestDecisionStatusV1(value: unknown): value is DefinedInterestDecisionStatusV1 {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["not_started", "open", "ready", "completed", "blocked"].includes(String(row.status))
    && [row.expected_roots, row.manifest_roots, row.accepted_roots,
      row.unknown_batches, row.unsettled_calls].every(count => Number.isSafeInteger(count) && (count as number) >= 0)
    && [row.classification_processed_roots, row.classification_total_roots].every(count => count === undefined
      || Number.isSafeInteger(count) && (count as number) >= 0)
    && (row.terminal_failed_roots === undefined
      || Number.isSafeInteger(row.terminal_failed_roots) && (row.terminal_failed_roots as number) >= 0)
    && (row.terminal_failed_roots === undefined
      || (row.accepted_roots as number) + (row.terminal_failed_roots as number) <= (row.expected_roots as number))
    && (row.technical_error_code === undefined || row.technical_error_code === null
      || row.technical_error_code === "interest_decision_attempts_exhausted")
    && ((row.terminal_failed_roots ?? 0) === 0
      || row.technical_error_code === "interest_decision_attempts_exhausted")
    && [row.classification_status, row.classification_error_code, row.generation_status]
      .every(value => value === undefined || value === null || typeof value === "string")
    && (row.owner_id === undefined || typeof row.owner_id === "string");
}

export function definedInterestDecisionReceiptMatchesV1(intent: Intent | null,
  status: DefinedInterestDecisionStatusV1): boolean {
  return Boolean(intent?.owner_id && status.owner_id === intent.owner_id);
}

function errorCode(value: unknown): string {
  if (!value || typeof value !== "object") return "request";
  const code = (value as { error?: unknown }).error;
  return typeof code === "string" ? code : "request";
}

export function DefinedInterestDecisionControls({ actorId, workspaceId, termKey, dirty,
  disabled = false, onAccessDenied }: { actorId: string; workspaceId: string; termKey: string;
  dirty: boolean; disabled?: boolean; onAccessDenied?: () => void }) {
  const t = useTranslations("AdminWorkspace.topics.definedInterestDecision");
  const [status, setStatus] = useState<DefinedInterestDecisionStatusV1 | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  const request = useRef<AbortController | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/${encodeURIComponent(termKey)}/decision`;
  const clearIntent = useCallback(() => {
    try { sessionStorage.removeItem(storageKey(actorId, workspaceId, termKey)); } catch { /* optional storage */ }
    setIntent(null);
  }, [actorId, workspaceId, termKey]);
  const saveIntent = useCallback((next: Intent) => {
    try { sessionStorage.setItem(storageKey(actorId, workspaceId, termKey), JSON.stringify(next)); }
    catch { setError("storage"); return false; }
    setIntent(next);
    return true;
  }, [actorId, workspaceId, termKey]);
  const read = useCallback(async (pending?: Intent | null) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!live.current || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) {
        setStatus(null); clearIntent(); onAccessDenied?.(); throw new Error("forbidden");
      }
      if (!response.ok) throw new Error("load");
      const body: unknown = await response.json();
      if (!validDefinedInterestDecisionStatusV1(body)) throw new Error("load");
      if (!live.current || controller.signal.aborted) return;
      setStatus(body);
      if (definedInterestDecisionReceiptMatchesV1(pending ?? null, body)) clearIntent();
      setError(null);
    } catch (cause) {
      if (live.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "load");
    }
  }, [endpoint, clearIntent, onAccessDenied]);
  useEffect(() => {
    live.current = true; setStatus(null); setIntent(null); setError(null);
    let restored: Intent | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey(actorId, workspaceId, termKey));
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && requestKey.test(String((parsed as Intent).key))
          && (!("owner_id" in parsed) || typeof (parsed as Intent).owner_id === "string")
          && (!("rejected_before_admission" in parsed)
            || typeof (parsed as Intent).rejected_before_admission === "boolean")) restored = parsed as Intent;
      }
    } catch { /* no recoverable browser storage */ }
    setIntent(restored); void read(restored);
    return () => { live.current = false; request.current?.abort(); };
  }, [actorId, workspaceId, termKey, read]);
  const view = definedInterestDecisionViewV1(status, dirty, disabled, intent);
  useEffect(() => {
    if (!view.shouldPoll) return;
    const timer = window.setInterval(() => { if (!busy) void read(intent); }, 5_000);
    return () => window.clearInterval(timer);
  }, [view.shouldPoll, busy, intent, read]);
  const send = async () => {
    if (busy || disabled || dirty || !status || (!view.canStart && !intent)) return;
    const pending = intent ?? { key: crypto.randomUUID() };
    if (!intent && !saveIntent(pending)) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": pending.key },
        body: JSON.stringify({ action: "classify_interest" }), signal: controller.signal });
      if (!live.current || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) {
        setStatus(null); clearIntent(); onAccessDenied?.(); throw new Error("forbidden");
      }
      const receipt = await response.json() as { owner_id?: unknown; error?: unknown };
      if (!response.ok) {
        const code = errorCode(receipt);
        if (response.status >= 400 && response.status < 500 && code !== "request") {
          const rejected = { ...pending, rejected_before_admission: true };
          saveIntent(rejected);
          setStatus(null);
          await read(rejected);
        }
        throw new Error(code === "request" && response.status < 500 ? "rejected" : code);
      }
      if (typeof receipt.owner_id !== "string") throw new Error("request");
      const confirmed = { ...pending, owner_id: receipt.owner_id };
      saveIntent(confirmed);
      await read(confirmed);
    } catch (cause) {
      if (live.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "request");
    } finally { if (live.current) setBusy(false); }
  };
  const knownError = error === "forbidden" ? "forbidden"
    : error === "interest_decision_analysis_required" ? "analysisRequired"
      : error === "interest_decision_model_authority_required" ? "authorityRequired"
        : error === "interest_decision_platform_benchmark_required" ? "benchmarkRequired"
        : error === "interest_decision_model_authority_stale" ? "authorityStale"
          : error === "interest_decision_policy_required" ? "policyRequired"
            : error === "interest_decision_cap_exhausted" ? "capExhausted"
              : error === "interest_decision_source_stale" ? "sourceStale"
                : error === "load" ? "load" : error === "storage" ? "storage"
                  : error === "rejected" ? "rejected" : "request";
  return <section className="topics-manager__cost-notice" aria-busy={busy}>
    <strong>{t("title")}</strong>
    <p>{t("body")}</p>
    {status ? <p role="status">{t(`states.${view.phase}`)}</p> : null}
    {view.showProgress && status ? <>
      <p>{t("manifest", { done: status.manifest_roots, total: status.expected_roots })}</p>
      <p>{t("accepted", { count: status.accepted_roots })}</p>
      {status.status === "completed" && view.phase !== "complete" ? <p>{t("materialization", {
        done: status.classification_processed_roots ?? 0, total: status.classification_total_roots ?? status.expected_roots
      })}</p> : null}
      {status.unknown_batches > 0 ? <p role="alert">{t("unknown", { count: status.unknown_batches })}</p> : null}
      {status.unsettled_calls > 0 ? <p role="status">{t("unsettled", { count: status.unsettled_calls })}</p> : null}
      {(status.terminal_failed_roots ?? 0) > 0 ? <p role="alert">{t("terminalFailed", {
        count: status.terminal_failed_roots ?? 0
      })}</p> : null}
    </> : null}
    <div className="admin-form-actions">
      {view.canStart ? <button type="button" className="admin-button admin-button--primary"
        disabled={busy} onClick={() => void send()}>{t("start")}</button> : null}
      {intent ? <button type="button" className="admin-button" disabled={busy || disabled || dirty}
        onClick={() => void send()}>{t("retrySame")}</button> : null}
      {view.canReplaceRejected ? <button type="button" className="admin-button"
        disabled={busy} onClick={() => { clearIntent(); setError(null); }}>
        {t("newAttempt")}</button> : null}
      <button type="button" className="admin-button" disabled={busy} onClick={() => void read(intent)}>
        {t("refresh")}</button>
    </div>
    {dirty ? <p>{t("saveFirst")}</p> : null}
    {intent ? <p role="status">{t("pending")}</p> : null}
    {view.canReplaceRejected ? <p>{t("newAttemptExplanation")}</p> : null}
    {error ? <p role="alert">{t(`errors.${knownError}`)}</p> : null}
  </section>;
}
