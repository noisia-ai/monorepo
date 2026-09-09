"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceNumericAdmissionPoll } from "@/lib/data-os/signal-workspace-analysis-update-ui";
import { parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { latestWorkspaceAnalysis, parsePendingWorkspaceAnalysis, validWorkspaceAnalysisStatus,
  workspaceAnalysisCanReleaseChangedRequest, workspaceAnalysisCanReplay, workspaceAnalysisCanRetry, workspaceAnalysisCanRetryProgress, workspaceAnalysisProgressRequestConfirmed, workspaceAnalysisCanStart, workspaceAnalysisDefaultCap, workspaceAnalysisStorageKey,
  type PendingWorkspaceAnalysis, type WorkspaceAnalysisRequest, type WorkspaceAnalysisStatus } from "@/lib/data-os/signal-workspace-analysis-ui";

export function useWorkspaceAnalysis({ workspaceId, catalogVersion, disabled = false, initial = null }: {
  workspaceId: string; catalogVersion: string; disabled?: boolean; initial?: WorkspaceAnalysisStatus | null;
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceAnalysisStatus | null>(() => initial ? latestWorkspaceAnalysis(null, initial, workspaceId) : null);
  const data = snapshot?.workspace_id === workspaceId ? snapshot : null;
  const current = useRef(data); current.current = data;
  const [pending, setPending] = useState<PendingWorkspaceAnalysis | null>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [reading, setReading] = useState(!data), [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState(() => workspaceAnalysisDefaultCap(data));
  const capIdentity = useRef<string | null>(null);
  const version = useRef(catalogVersion); version.current = catalogVersion;
  const [verifiedVersion, setVerifiedVersion] = useState<string | null>(data ? catalogVersion : null);
  const epoch = useRef(0), rejectedKey = useRef<string | null>(null);
  const reader = useRef<AbortController | null>(null), writer = useRef<AbortController | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/analysis`;

  const forget = useCallback(() => {
    const old = pendingRef.current;
    if (old) try { sessionStorage.removeItem(workspaceAnalysisStorageKey(old.workspace_id, old.request_scope)); } catch { /* Read-only state remains available. */ }
    pendingRef.current = null; setPending(null); setCheckedKey(null); rejectedKey.current = null;
  }, []);
  const revoke = useCallback(() => {
    epoch.current++; reader.current?.abort(); writer.current?.abort();
    reader.current = null; writer.current = null;
    forget(); current.current = null; setSnapshot(null); setVerifiedVersion(null);
    setReading(false); setSubmitting(false); setError("forbidden");
  }, [forget]);
  const accept = useCallback((value: unknown, expectedVersion: string, confirmedKey?: string) => {
    if (!validWorkspaceAnalysisStatus(value) || value.workspace_id !== workspaceId) throw new Error("load");
    if (current.current && current.current.request_scope !== value.request_scope) {
      epoch.current++; writer.current?.abort(); writer.current = null; forget(); setSubmitting(false);
    }
    const next = latestWorkspaceAnalysis(current.current, value, workspaceId);
    if (!next || next !== value) return;
    current.current = next; setSnapshot(next); setVerifiedVersion(expectedVersion);
    const identity = JSON.stringify([next.preflight.embedding_run_id, next.preflight.context_digest, next.preflight.catalog_digest,
      next.preflight.cost.claude.estimated_upper_micro_usd, next.preflight.cost.claude.maximum_cap_micro_usd, next.request_scope]);
    if (capIdentity.current !== identity) {
      capIdentity.current = identity; setCap(workspaceAnalysisDefaultCap(next));
    }
    if (confirmedKey && confirmedKey === pendingRef.current?.key) {
      setCheckedKey(confirmedKey);
      if ((pendingRef.current.body.action === "retry_progress"
        ? workspaceAnalysisProgressRequestConfirmed(next, pendingRef.current)
        : next.request_run?.status === "ready" || workspaceAnalysisCanReleaseChangedRequest(next))
        || !next.request_run && rejectedKey.current === confirmedKey) forget();
    }
    if (!pendingRef.current) {
      try {
        const saved = sessionStorage.getItem(workspaceAnalysisStorageKey(workspaceId, next.request_scope));
        const restored = saved ? parsePendingWorkspaceAnalysis(JSON.parse(saved), workspaceId, next.request_scope) : null;
        if (restored) { pendingRef.current = restored; setPending(restored); setCheckedKey(null); }
      } catch { /* Never create a replacement request when storage cannot be read. */ }
    }
  }, [forget, workspaceId]);
  const read = useCallback(async () => {
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller;
    const ticket = epoch.current, expectedVersion = version.current;
    const request = pendingRef.current?.workspace_id === workspaceId ? pendingRef.current : null;
    setReading(true);
    try {
      const response = await fetch(endpoint + (request ? `?idempotency_key=${encodeURIComponent(request.key)}` : ""),
        { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) throw new Error("load");
      const value: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current || expectedVersion !== version.current) return;
      accept(value, expectedVersion, request?.key); setError(null);
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setError("load"); }
    finally { if (reader.current === controller) { reader.current = null; setReading(false); } }
  }, [accept, endpoint, revoke, workspaceId]);

  useEffect(() => {
    const lifecycleEpoch = epoch;
    epoch.current++; reader.current?.abort(); writer.current?.abort(); reader.current = null; writer.current = null;
    pendingRef.current = null; setPending(null); setCheckedKey(null); rejectedKey.current = null; capIdentity.current = null;
    current.current = null; setSnapshot(null); setVerifiedVersion(null); setSubmitting(false); setError(null);
    return () => { lifecycleEpoch.current++; reader.current?.abort(); writer.current?.abort(); };
  }, [workspaceId]);
  useEffect(() => { void read(); }, [read, catalogVersion]);
  useEffect(() => {
    if (pending && pending.key !== checkedKey && !reading && !submitting && error !== "load") void read();
  }, [pending, checkedKey, reading, submitting, error, read]);
  const active = data?.active_run?.execution_id
    ?? (data?.latest_run?.materialization_pending ? data.latest_run.execution_id : null)
    ?? (data?.update?.has_pending_work ? data.update.numeric.execution_id : null);
  const admission = workspaceNumericAdmissionPoll(data?.numeric_readiness);
  const admissionKey = admission?.key, admissionKind = admission?.kind;
  const admissionReads = useRef({ key: "", count: 0 });
  useEffect(() => {
    if (admissionReads.current.key !== admissionKey) admissionReads.current = { key: admissionKey ?? "", count: 0 };
    if ((!active && !admissionKey) || error || submitting) return;
    let stopped = false, inFlight = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        if (document.visibilityState === "visible") {
          if (!active && admissionKind === "bounded") {
            if (admissionReads.current.count >= 6) return;
            admissionReads.current.count++;
          }
          await read();
        }
      } finally { inFlight = false; if (!stopped && (active || admissionKind !== "bounded" || admissionReads.current.count < 6)) timer = setTimeout(() => void poll(), 4_000); }
    };
    const visible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void poll(); } };
    timer = setTimeout(() => void poll(), 4_000); document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [active, admissionKey, admissionKind, error, submitting, read]);

  const submit = useCallback(async (body: WorkspaceAnalysisRequest, replay?: PendingWorkspaceAnalysis) => {
    const status = current.current;
    if (!status || writer.current || disabled || version.current !== verifiedVersion || error === "load") return;
    const request: PendingWorkspaceAnalysis = replay ?? { version: 1, workspace_id: workspaceId,
      request_scope: status.request_scope, key: crypto.randomUUID(), body };
    try { sessionStorage.setItem(workspaceAnalysisStorageKey(workspaceId, status.request_scope), JSON.stringify(request)); }
    catch { setError("storage"); return; }
    pendingRef.current = request; setPending(request); setCheckedKey(null); rejectedKey.current = null;
    const controller = new AbortController(); writer.current = controller;
    const ticket = epoch.current, expectedVersion = version.current;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": request.key },
        body: JSON.stringify(request.body), signal: controller.signal });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      const value: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if (!response.ok) {
        if (response.status < 500) rejectedKey.current = request.key;
        setError(response.status >= 500 ? "request" : value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "request");
      } else if (expectedVersion === version.current) { accept(value, expectedVersion, request.key); }
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setError("request"); }
    finally {
      if (writer.current === controller) { writer.current = null; setSubmitting(false); }
      if (!controller.signal.aborted && ticket === epoch.current) void read();
    }
  }, [accept, disabled, endpoint, error, read, revoke, verifiedVersion, workspaceId]);

  const confirmed = pending && checkedKey === pending.key;
  const retryRun = confirmed ? data?.request_run ?? null : !pending ? data?.latest_run ?? null : null;
  const canRetry = !disabled && !submitting && !reading && error !== "load" && verifiedVersion === catalogVersion
    && workspaceAnalysisCanRetry(data, retryRun);
  const canRetryProgress = !disabled && !submitting && !reading && error !== "load" && verifiedVersion === catalogVersion
    && (!pending || Boolean(confirmed && data?.request_run))
    && workspaceAnalysisCanRetryProgress(data, data?.latest_run ?? null);
  const canStart = !disabled && !submitting && !reading && !pending && error !== "load" && verifiedVersion === catalogVersion
    && workspaceAnalysisCanStart(data, cap);
  const canReplay = !disabled && !submitting && !reading && Boolean(confirmed && data && pending && error !== "load"
    && verifiedVersion === catalogVersion && workspaceAnalysisCanReplay(data, pending));
  const start = useCallback(async () => {
    if (!canStart || !data) return;
    const amount = Number(parseEmbeddingCapMicroUsd(cap));
    await submit({ action: "start", embedding_run_id: data.preflight.embedding_run_id!,
      expected_context_digest: data.preflight.context_digest!, expected_catalog_digest: data.preflight.catalog_digest!, claude_cap_micro_usd: amount });
  }, [canStart, cap, data, submit]);
  const retry = useCallback(async () => {
    if (canRetry && retryRun) await submit({ action: "retry", run_id: retryRun.execution_id });
  }, [canRetry, retryRun, submit]);
  const retryProgress = useCallback(async () => {
    if (canRetryProgress && data?.latest_run) await submit({ action: "retry_progress", run_id: data.latest_run.execution_id });
  }, [canRetryProgress, data, submit]);
  const replay = useCallback(async () => {
    if (canReplay && pending) await submit(pending.body, pending);
  }, [canReplay, pending, submit]);
  return { data, pending, reading, submitting, error, cap, setCap, canStart, canRetry, canRetryProgress, canReplay,
    read, start, retry, retryProgress, replay, verified: verifiedVersion === catalogVersion };
}
