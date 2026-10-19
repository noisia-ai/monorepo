"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalWorkspaceCorpusPreparationRunV1,
  SignalWorkspaceCorpusPreparationStatusV1 } from "@noisia/db";
import { AdminStatus, formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";

export type ClientCorpusPreparationViewV1 = SignalWorkspaceCorpusPreparationStatusV1 & { can_prepare: boolean };
type PendingRequest = { workspaceId: string; key: string; previousRunId: string | null; previousRunUpdatedAt: string | null };
type Action = "prepare" | "update" | "resume" | "restart";
const statuses = new Set(["queued", "running", "completed", "failed", "canceled", "superseded"]);
const phases = new Set(["queued", "snapshotting", "chunking", "complete"]);
const countKeys = ["total_roots", "processed_roots", "eligible_roots", "excluded_roots", "rights_blocked_roots",
  "inclusion_pending_roots", "missing_text_roots", "reused_roots", "new_roots", "changed_roots", "removed_roots", "chunk_count"] as const;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value
  && typeof value === "object" && !Array.isArray(value));
const timestamp = (value: unknown) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function validRun(value: unknown): value is SignalWorkspaceCorpusPreparationRunV1 {
  if (!object(value) || typeof value.id !== "string" || !statuses.has(String(value.status))
    || !phases.has(String(value.phase)) || !(value.input_revision === null || count(value.input_revision))
    || !object(value.counts) || !countKeys.every(key => count((value.counts as Record<string, unknown>)[key]))
    || !(value.error_code === null || typeof value.error_code === "string") || typeof value.retryable !== "boolean"
    || !timestamp(value.created_at) || !timestamp(value.updated_at)
    || !(value.completed_at === null || timestamp(value.completed_at))) return false;
  const counts = value.counts as Record<(typeof countKeys)[number], number>;
  return counts.processed_roots <= counts.total_roots && counts.eligible_roots <= counts.total_roots;
}

export function validClientCorpusPreparationViewV1(value: unknown): value is ClientCorpusPreparationViewV1 {
  return object(value) && value.contract_version === "signal-workspace-corpus-preparation-v1"
    && typeof value.workspace_id === "string" && value.workspace_id.length > 0 && timestamp(value.observed_at)
    && count(value.input_revision) && typeof value.can_prepare === "boolean"
    && (value.active_run === null || validRun(value.active_run))
    && (value.latest_run === null || validRun(value.latest_run))
    && (value.latest_completed === null || validRun(value.latest_completed))
    && typeof value.is_current === "boolean" && typeof value.needs_preparation === "boolean"
    && value.is_current !== value.needs_preparation
    && (value.active_run === null || ["queued", "running"].includes(value.active_run.status));
}

export function latestClientCorpusPreparationSnapshotV1(current: ClientCorpusPreparationViewV1 | null,
  next: ClientCorpusPreparationViewV1, workspaceId: string) {
  const previous = current?.workspace_id === workspaceId ? current : null;
  if (next.workspace_id !== workspaceId || !validClientCorpusPreparationViewV1(next)) return previous;
  return previous && previous.observed_at > next.observed_at ? previous : next;
}

export function clientCorpusPreparationRequestWasObservedV1(data: ClientCorpusPreparationViewV1,
  request: Pick<PendingRequest, "workspaceId" | "previousRunId" | "previousRunUpdatedAt">) {
  return data.workspace_id === request.workspaceId && Boolean(data.active_run || data.is_current || (data.latest_run
    && (data.latest_run.id !== request.previousRunId || data.latest_run.updated_at !== request.previousRunUpdatedAt)));
}

export function clientCorpusPreparationRequestV1(current: PendingRequest | null, workspaceId: string,
  data: Pick<ClientCorpusPreparationViewV1, "latest_run">, createKey: () => string): PendingRequest {
  return current?.workspaceId === workspaceId ? current : { workspaceId, key: createKey(),
    previousRunId: data.latest_run?.id ?? null, previousRunUpdatedAt: data.latest_run?.updated_at ?? null };
}

export function clientCorpusPreparationRejectionIsDefinitiveV1(status: number) {
  return Number.isInteger(status) && status >= 400 && status < 500;
}

export function clientCorpusPreparationPollDelayV1(data: ClientCorpusPreparationViewV1 | null) {
  return data?.active_run ? 4_000 : null;
}

export function clientCorpusPreparationFailureReasonV1(code: string | null) {
  if (code === "corpus_preparation_forbidden") return "permissions";
  if (code === "corpus_preparation_import_required") return "import";
  if (code === "corpus_preparation_idempotency_conflict") return "conflict";
  if (code && ["corpus_preparation_asset_hash_mismatch", "corpus_preparation_checkpoint_invalid",
    "corpus_preparation_checkpoint_conflict", "corpus_preparation_chunk_integrity_failed"].includes(code)) return "integrity";
  return null;
}

export function clientCorpusPreparationActionV1(data: ClientCorpusPreparationViewV1 | null): Action | null {
  if (!data?.can_prepare || data.input_revision === 0 || data.active_run) return null;
  const failed = data.latest_run?.status === "failed" ? data.latest_run : null;
  if (!data.needs_preparation && !failed) return null;
  if (failed && !failed.retryable) return failed.error_code === "corpus_preparation_forbidden"
    || (failed.input_revision !== null && data.input_revision > failed.input_revision) ? "restart" : null;
  if (failed) return "resume";
  return data.latest_completed ? "update" : "prepare";
}

export function clientCorpusPreparationStageStateV1(data: ClientCorpusPreparationViewV1 | null) {
  if (data?.is_current) return "ready" as const;
  return data && (data.active_run || clientCorpusPreparationActionV1(data)) ? "blocked" as const : "unavailable" as const;
}

function stateKey(data: ClientCorpusPreparationViewV1 | null) {
  if (!data) return "loading";
  if (data.is_current) return "completed";
  if (data.active_run) return data.active_run.status;
  if (data.input_revision === 0) return "awaiting_import";
  if (data.latest_run?.status === "failed") return "failed";
  if (data.latest_completed) return "outdated";
  return data.can_prepare ? "pending" : "read_only";
}

export function clientCorpusPreparationInitialSnapshotV1(initial: ClientCorpusPreparationViewV1 | null, workspaceId: string) {
  return initial?.workspace_id === workspaceId && validClientCorpusPreparationViewV1(initial) ? initial : null;
}

export function ClientCorpusPreparationStep({ workspaceId, index, initial = null, onAccessDenied }: {
  workspaceId: string; index: number; initial?: ClientCorpusPreparationViewV1 | null; onAccessDenied?: () => void;
}) {
  const t = useTranslations("ClientProcessing.stages.prepare");
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState(() => clientCorpusPreparationInitialSnapshotV1(initial, workspaceId));
  const [reading, setReading] = useState(clientCorpusPreparationInitialSnapshotV1(initial, workspaceId) === null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<"load" | "request" | "forbidden" | null>(null);
  const [requestFailure, setRequestFailure] = useState<string | null>(null);
  const scope = useRef(0);
  const denied = useRef(onAccessDenied); denied.current = onAccessDenied;
  const reader = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const requestKey = useRef<PendingRequest | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/corpus/preparation`;
  const data = snapshot?.workspace_id === workspaceId ? snapshot : null;
  const active = data?.active_run;
  const action = clientCorpusPreparationActionV1(data);
  const stageState = clientCorpusPreparationStageStateV1(data);
  const state = stateKey(data);

  const clearAccess = useCallback(() => {
    scope.current += 1; reader.current?.abort(); mutation.current?.abort(); mutation.current = null;
    setSnapshot(null); setReading(false); setSubmitting(false); setError("forbidden"); requestKey.current = null;
    denied.current?.();
  }, []);
  const accept = useCallback((next: unknown) => {
    if (!validClientCorpusPreparationViewV1(next) || next.workspace_id !== workspaceId) throw new Error();
    setSnapshot(previous => latestClientCorpusPreparationSnapshotV1(previous, next, workspaceId));
    if (requestKey.current && clientCorpusPreparationRequestWasObservedV1(next, requestKey.current)) requestKey.current = null;
    if (!requestKey.current) setRequestFailure(null);
  }, [workspaceId]);
  const read = useCallback(async () => {
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller;
    const currentScope = scope.current; setReading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      if (!response.ok) throw new Error();
      const next: unknown = await response.json();
      if (controller.signal.aborted || currentScope !== scope.current) return;
      accept(next); setError(previous => previous === "request" && requestKey.current ? previous : null);
    } catch { if (!controller.signal.aborted && currentScope === scope.current) setError("load"); }
    finally { if (!controller.signal.aborted && currentScope === scope.current) setReading(false); }
  }, [accept, clearAccess, endpoint]);

  useEffect(() => {
    scope.current += 1; setError(null); setRequestFailure(null); setSubmitting(false);
    requestKey.current = null;
    const nextInitial = clientCorpusPreparationInitialSnapshotV1(initial, workspaceId);
    if (nextInitial) { setSnapshot(previous => latestClientCorpusPreparationSnapshotV1(previous, nextInitial, workspaceId));
      setReading(false); }
    else { setSnapshot(null); void read(); }
    return () => { scope.current += 1; reader.current?.abort(); mutation.current?.abort(); mutation.current = null;
      requestKey.current = null; };
  }, [initial, read, workspaceId]);
  useEffect(() => {
    const pollDelay = clientCorpusPreparationPollDelayV1(data);
    if (pollDelay === null) return;
    let canceled = false; let timer: ReturnType<typeof setTimeout>;
    const next = () => { timer = setTimeout(async () => { await read(); if (!canceled) next(); }, pollDelay); };
    next(); return () => { canceled = true; clearTimeout(timer); };
  }, [data, read]);

  async function prepare() {
    if (mutation.current || !data || !clientCorpusPreparationActionV1(data)) return;
    const controller = new AbortController(); mutation.current = controller; const currentScope = scope.current;
    requestKey.current = clientCorpusPreparationRequestV1(requestKey.current, workspaceId, data, () => crypto.randomUUID());
    setSubmitting(true); setError(null); setRequestFailure(null);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current.key }, body: "{}" });
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if ([401, 403, 404].includes(response.status)) { requestKey.current = null; clearAccess(); return; }
      if (!response.ok) {
        if (clientCorpusPreparationRejectionIsDefinitiveV1(response.status)) { requestKey.current = null;
          const failure = await response.json().catch(() => null) as { error?: string } | null; setRequestFailure(failure?.error ?? null); }
        throw new Error();
      }
      const next: unknown = await response.json();
      if (controller.signal.aborted || currentScope !== scope.current) return;
      accept(next); requestKey.current = null;
    } catch { if (!controller.signal.aborted && currentScope === scope.current) setError("request"); }
    finally { if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted && currentScope === scope.current) setSubmitting(false); }
  }

  const failure = clientCorpusPreparationFailureReasonV1(requestFailure ?? data?.latest_run?.error_code ?? null);
  const run = active ?? data?.latest_run;
  const number = (value: number) => formatAdminNumber(value, locale);
  return <li data-processing-stage="prepare" data-processing-stage-state={stageState}>
    <span className="client-processing-journey__number" aria-hidden>{index + 1}</span>
    <div><strong>{t("title")}</strong><p>{t("body")}</p></div>
    <AdminStatus state={stageState === "ready" ? "good" : stageState === "blocked" ? "warning" : "not_available"}>
      {t(`states.${error === "load" && data ? "last_known" : state}`)}
    </AdminStatus>
    <div className="client-processing-journey__stage-detail" aria-busy={reading || submitting}>
      {reading && !data ? <p role="status">{t("loading")}</p> : null}
      {error ? <p role="alert" className="workspace-form__error">{t(failure ? `failures.${failure}`
        : `errors.${error === "load" && data ? "refresh" : error}`)}</p> : null}
      {data ? <>
        <p>{t(`help.${state}`)}</p>
        {active?.counts.total_roots ? <div className="admin-report-run-progress" role="status">
          <progress aria-label={t("progressLabel")} max={active.counts.total_roots} value={active.counts.processed_roots}/>
          <span>{t("progress", { processed: number(active.counts.processed_roots), total: number(active.counts.total_roots) })}</span>
        </div> : null}
        {data.latest_completed ? <p>{t("lastCompleted", { prepared: number(data.latest_completed.counts.eligible_roots),
          excluded: number(data.latest_completed.counts.excluded_roots) })}</p> : null}
        {run?.status === "failed" ? <p>{t("preserved", { count: number(run.counts.processed_roots) })}</p> : null}
        {action ? <p>{t("free")}</p> : null}
      </> : null}
      <div className="admin-form-actions">
        {action ? <button className="admin-button admin-button--primary" disabled={submitting} onClick={() => void prepare()} type="button">
          {t(submitting ? "actions.requesting" : error === "request" && requestKey.current
            ? "actions.confirm" : `actions.${action}`)}
        </button> : null}
        <button className="admin-button admin-button--compact" disabled={reading || submitting} onClick={() => void read()} type="button">
          <ArrowClockwise aria-hidden size={15}/>{t("actions.refresh")}
        </button>
      </div>
    </div>
  </li>;
}
