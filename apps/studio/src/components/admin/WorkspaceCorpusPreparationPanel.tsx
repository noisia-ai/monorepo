"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowClockwise } from "@phosphor-icons/react";
import type { SignalWorkspaceCorpusPreparationStatusV1 } from "@noisia/db";
import { AdminStatus, formatAdminNumber } from "./AdminWorkspacePrimitives";
import { WorkspaceCorpusEmbeddingsControls } from "./WorkspaceCorpusEmbeddingsControls";

export type CorpusPreparationView = SignalWorkspaceCorpusPreparationStatusV1 & { can_prepare: boolean };
type PendingPreparationRequest = { workspaceId: string; key: string; previousRunId: string | null; previousRunUpdatedAt: string | null };

export function latestCorpusPreparationSnapshot(current: CorpusPreparationView | null, next: CorpusPreparationView, workspaceId: string) {
  const previous = current?.workspace_id === workspaceId ? current : null;
  if (next.workspace_id !== workspaceId || next.contract_version !== "signal-workspace-corpus-preparation-v1"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(next.observed_at)) return previous;
  return previous && previous.observed_at > next.observed_at ? previous : next;
}

export function preparationRequestWasObserved(data: CorpusPreparationView, request: Pick<PendingPreparationRequest, "workspaceId" | "previousRunId" | "previousRunUpdatedAt">) {
  if (data.workspace_id !== request.workspaceId) return false;
  return Boolean(data.active_run || data.is_current || (data.latest_run &&
    (data.latest_run.id !== request.previousRunId || data.latest_run.updated_at !== request.previousRunUpdatedAt)));
}

export function preparationFailureReason(code: string | null) {
  if (code === "corpus_preparation_forbidden") return "permissions";
  if (code === "corpus_preparation_import_required") return "import";
  if (code === "corpus_preparation_idempotency_conflict") return "conflict";
  if (code && ["corpus_preparation_asset_hash_mismatch", "corpus_preparation_checkpoint_invalid",
    "corpus_preparation_checkpoint_conflict", "corpus_preparation_chunk_integrity_failed"].includes(code)) return "integrity";
  return null;
}

export function corpusPreparationAction(data: CorpusPreparationView | null, hasReceivedFiles: boolean) {
  if (!data?.can_prepare || !hasReceivedFiles || ["queued", "running"].includes(data.active_run?.status ?? "")) return null;
  const failed = data.latest_run?.status === "failed" ? data.latest_run : null;
  if (!data.needs_preparation && !failed) return null;
  if (failed && !failed.retryable) return failed.error_code === "corpus_preparation_forbidden"
    || (failed.input_revision !== null && data.input_revision > failed.input_revision) ? "restart" : null;
  if (failed) return "resume";
  return data.latest_completed ? "update" : "prepare";
}

export function WorkspaceCorpusPreparationPanel({ workspaceId, hasReceivedFiles, receiptObservedAt, initial = null }: {
  workspaceId: string; hasReceivedFiles: boolean; receiptObservedAt: string;
  initial?: CorpusPreparationView | null;
}) {
  const t = useTranslations("AdminWorkspace.data.corpusPreparation");
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState(initial);
  const data = snapshot?.workspace_id === workspaceId ? snapshot : null;
  const [reading, setReading] = useState(!initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<"load" | "request" | "forbidden" | null>(null);
  const [requestFailure, setRequestFailure] = useState<string | null>(null);
  const scope = useRef(0);
  const reader = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const requestKey = useRef<PendingPreparationRequest | null>(null);
  const active = data?.active_run;
  const isActive = active?.status === "queued" || active?.status === "running";
  const run = active ?? data?.latest_run;
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/corpus/preparation`;

  const clearAccess = useCallback(() => {
    // A late POST response cannot restore a snapshot after a newer access denial.
    scope.current += 1;
    reader.current?.abort(); mutation.current?.abort(); mutation.current = null;
    setSnapshot(null); setReading(false); setSubmitting(false); setError("forbidden");
  }, []);

  const accept = useCallback((next: CorpusPreparationView) => {
    if (!latestCorpusPreparationSnapshot(null, next, workspaceId)) throw new Error("invalid_preparation_snapshot");
    setSnapshot((previous) => latestCorpusPreparationSnapshot(previous, next, workspaceId));
  }, [workspaceId]);

  const read = useCallback(async () => {
    reader.current?.abort();
    const controller = new AbortController(); reader.current = controller;
    const currentScope = scope.current;
    setReading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      if (!response.ok) throw new Error();
      const next = await response.json() as CorpusPreparationView;
      if (controller.signal.aborted || currentScope !== scope.current) return;
      accept(next);
      if (requestKey.current && preparationRequestWasObserved(next, requestKey.current)) requestKey.current = null;
      setError((previous) => previous === "request" && requestKey.current ? previous : null);
      if (!requestKey.current) setRequestFailure(null);
    } catch {
      if (!controller.signal.aborted && currentScope === scope.current) setError("load");
    } finally {
      if (!controller.signal.aborted && currentScope === scope.current) setReading(false);
    }
  }, [endpoint, accept, clearAccess]);

  useEffect(() => {
    scope.current += 1;
    setError(null); setRequestFailure(null); setSubmitting(false);
    return () => { scope.current += 1; reader.current?.abort(); mutation.current?.abort(); mutation.current = null; };
  }, [workspaceId]);

  // A new receipt from upload/router.refresh rereads status without starting a job.
  useEffect(() => { void read(); }, [read, receiptObservedAt]);
  useEffect(() => {
    if (!isActive) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => { timer = setTimeout(async () => { await read(); if (!canceled) next(); }, 4_000); };
    next();
    return () => { canceled = true; clearTimeout(timer); };
  }, [isActive, read]);

  async function prepare() {
    if (mutation.current || !data || !corpusPreparationAction(data, hasReceivedFiles)) return;
    const controller = new AbortController(); mutation.current = controller;
    const currentScope = scope.current;
    if (requestKey.current?.workspaceId !== workspaceId) requestKey.current = { workspaceId, key: crypto.randomUUID(),
      previousRunId: data.latest_run?.id ?? null, previousRunUpdatedAt: data.latest_run?.updated_at ?? null };
    setSubmitting(true); setError(null); setRequestFailure(null);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current.key }, body: "{}" });
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if ([401, 403, 404].includes(response.status)) { requestKey.current = null; clearAccess(); return; }
      if (!response.ok) {
        if (response.status < 500) {
          requestKey.current = null;
          const failure = await response.json().catch(() => null) as { error?: string } | null;
          if (!controller.signal.aborted && currentScope === scope.current) setRequestFailure(failure?.error ?? null);
        }
        throw new Error();
      }
      const next = await response.json() as CorpusPreparationView;
      if (controller.signal.aborted || currentScope !== scope.current) return;
      accept(next); requestKey.current = null;
    } catch {
      if (!controller.signal.aborted && currentScope === scope.current) setError("request");
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted && currentScope === scope.current) setSubmitting(false);
    }
  }

  const failed = run?.status === "failed";
  const failureReason = preparationFailureReason(run?.error_code ?? null);
  const requestReason = preparationFailureReason(requestFailure);
  const state = !hasReceivedFiles ? "awaiting_import" : isActive ? active.status
    : data?.is_current ? "completed" : failed ? "failed" : data?.latest_completed ? "outdated" : "pending";
  const number = (value: number) => formatAdminNumber(value, locale);
  const action = corpusPreparationAction(data, hasReceivedFiles);

  return <section className="workspace-form__nested" aria-busy={reading || submitting} aria-label={t("title")}>
    <div className="workspace-form__nested-head"><strong>{t("title")}</strong>
      {data ? <AdminStatus state={failed || error ? "warning" : "not_available"}>{t(error ? "lastKnown" : `states.${state}`)}</AdminStatus> : null}
    </div>
    {!data && reading ? <p className="admin-drawer-form__intro" role="status">{t("loading")}</p> : null}
    {error ? <p className="workspace-form__error" role="alert">{t(error === "request" && requestReason
      ? `failures.${requestReason}` : `errors.${error === "load" && data ? "refresh" : error}`)}</p> : null}
    {data ? <>
      <p className="admin-drawer-form__intro">{t(error === "load" ? "body.lastKnown" : failed && !run.retryable
        ? failureReason ? `failures.${failureReason}` : "body.blocked" : `body.${state}`)}</p>
      {isActive && run ? <div className="admin-report-run-progress" role="status">
        <span>{t(`phases.${run.phase}`)}</span>
        {run.counts.total_roots > 0 ? <>
          <progress aria-label={t("progressLabel")} max={run.counts.total_roots} value={run.counts.processed_roots} />
          <span>{t("progress", { processed: number(run.counts.processed_roots), total: number(run.counts.total_roots) })}</span>
        </> : <span>{t("counting")}</span>}
      </div> : null}
      {data.latest_completed ? <p className="admin-drawer-form__intro">{t("lastCompleted", {
        prepared: number(data.latest_completed.counts.eligible_roots), excluded: number(data.latest_completed.counts.excluded_roots)
      })}</p> : null}
      {data.latest_completed && (data.latest_completed.counts.rights_blocked_roots > 0 || data.latest_completed.counts.missing_text_roots > 0
        || data.latest_completed.counts.inclusion_pending_roots > 0)
        ? <p className="admin-drawer-form__intro">{t("unprepared", { rights: number(data.latest_completed.counts.rights_blocked_roots),
          missing: number(data.latest_completed.counts.missing_text_roots) })}
          {data.latest_completed.counts.inclusion_pending_roots > 0 ? ` ${t("inclusionPending", {
            count: number(data.latest_completed.counts.inclusion_pending_roots) })}` : null}</p> : null}
      {isActive && active.input_revision !== null && active.input_revision < data.input_revision
        ? <p className="admin-drawer-form__intro">{t("newInputs")}</p> : null}
      {failed && run ? <p className="admin-drawer-form__intro">{t("preserved", { count: number(run.counts.processed_roots) })}</p> : null}
      {action ? <p className="admin-drawer-form__intro">{t("cost")}</p> : null}
      {!data.can_prepare && hasReceivedFiles && data.needs_preparation ? <p className="admin-drawer-form__intro">{t("readOnly")}</p> : null}
    </> : null}
    <div className="admin-form-actions">
      {action ? <button className="admin-button admin-button--primary" disabled={submitting} onClick={() => void prepare()} type="button">
        {t(submitting ? "actions.requesting" : error === "request" ? "actions.confirm" : `actions.${action}`)}
      </button> : null}
      <button className="admin-button admin-button--compact" disabled={reading || submitting} onClick={() => void read()} type="button">
        <ArrowClockwise aria-hidden size={15} />{t("actions.refresh")}
      </button>
    </div>
    {data?.latest_completed ? <WorkspaceCorpusEmbeddingsControls workspaceId={workspaceId}
      preparationRunId={data.is_current ? data.latest_completed.id : null} /> : null}
  </section>;
}
