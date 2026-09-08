"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  latestWorkspaceTopicComputation, parsePendingWorkspaceTopicComputation,
  validWorkspaceTopicComputationResults, validWorkspaceTopicComputationStatus,
  workspaceTopicRequestStorageKey, workspaceTopicSearchCanStart,
  type PendingWorkspaceTopicComputation, type WorkspaceTopicComputationResults,
  type WorkspaceTopicComputationStatus
} from "@/lib/data-os/signal-workspace-topic-computation-ui";

export function useWorkspaceTopicComputation({ workspaceId, termKey, catalogVersion, initial = null }: {
  workspaceId: string; termKey: string | null; catalogVersion: string;
  initial?: WorkspaceTopicComputationStatus | null;
}) {
  const [snapshot, setSnapshot] = useState(() => initial ? latestWorkspaceTopicComputation(null, initial, workspaceId) : null);
  const [reading, setReading] = useState(!snapshot);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingWorkspaceTopicComputation | null>(null);
  const [resultSnapshot, setResultSnapshot] = useState<{ termKey: string; data: WorkspaceTopicComputationResults } | null>(null);
  const [resultsStatus, setResultsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [resultsErrorCode, setResultsErrorCode] = useState<string | null>(null);
  const data = snapshot?.workspace_id === workspaceId ? snapshot : null;
  const current = useRef(data); current.current = data;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const epoch = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const resultsController = useRef<AbortController | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/computation`;

  const forgetRequest = useCallback(() => {
    const request = pendingRef.current;
    if (request) { try { sessionStorage.removeItem(workspaceTopicRequestStorageKey(request.workspace_id, request.request_scope)); } catch { /* No new request is submitted here. */ } }
    pendingRef.current = null; setPending(null);
  }, []);
  const revoke = useCallback(() => {
    epoch.current++; readController.current?.abort(); writeController.current?.abort(); resultsController.current?.abort();
    forgetRequest(); current.current = null; setSnapshot(null); setResultSnapshot(null); setResultsStatus("idle");
    setReading(false); setSubmitting(false); setError("forbidden");
  }, [forgetRequest]);
  const accept = useCallback((value: unknown, confirmedKey?: string) => {
    if (!validWorkspaceTopicComputationStatus(value) || value.workspace_id !== workspaceId) throw new Error("load");
    if (current.current && current.current.request_scope !== value.request_scope) {
      epoch.current++; writeController.current?.abort(); resultsController.current?.abort();
      forgetRequest(); setResultSnapshot(null); setResultsStatus("idle"); setSubmitting(false); setReading(false);
    }
    const next = latestWorkspaceTopicComputation(current.current, value, workspaceId)!;
    current.current = next; setSnapshot(next);
    // A failed acknowledged run must keep its original key so the backend can resume its
    // checkpoint. Reading queued/running/failed status never creates a replacement request.
    if (value.request_run?.status === "ready" && confirmedKey && pendingRef.current?.key === confirmedKey) forgetRequest();
    if (!pendingRef.current) {
      try {
        const stored = sessionStorage.getItem(workspaceTopicRequestStorageKey(workspaceId, next.request_scope));
        if (stored) { const restored = parsePendingWorkspaceTopicComputation(JSON.parse(stored), workspaceId, next.request_scope);
          if (restored) { pendingRef.current = restored; setPending(restored); } }
      } catch { /* Read-only state remains usable when browser storage is unavailable. */ }
    }
    return next;
  }, [forgetRequest, workspaceId]);
  const read = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const ticket = epoch.current;
    const request = pendingRef.current;
    const lookup = request?.workspace_id === workspaceId ? `?idempotency_key=${encodeURIComponent(request.key)}` : "";
    setReading(true);
    try {
      const response = await fetch(endpoint + lookup, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) throw new Error();
      const next: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current) return;
      accept(next, request?.key); setError((previous) => pendingRef.current ? previous : null);
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setError("load"); }
    finally { if (!controller.signal.aborted && ticket === epoch.current) setReading(false); }
  }, [accept, endpoint, revoke, workspaceId]);

  useEffect(() => {
    const fence = epoch;
    fence.current++; current.current = null; setSnapshot(null); pendingRef.current = null; setPending(null);
    setResultSnapshot(null); setResultsStatus("idle"); setError(null); setSubmitting(false);
    return () => { fence.current++; readController.current?.abort(); writeController.current?.abort(); resultsController.current?.abort(); };
  }, [workspaceId]);
  useEffect(() => { if (initial) accept(initial); }, [accept, initial]);
  useEffect(() => { void read(); }, [catalogVersion, read, pending?.key]);
  const active = data?.active_run?.id;
  useEffect(() => {
    if (!active) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(async () => { await read(); if (!stopped) schedule(); }, 4_000); };
    schedule(); return () => { stopped = true; clearTimeout(timer); };
  }, [active, read]);

  const start = useCallback(async () => {
    const next = current.current;
    if (writeController.current || !next?.can_execute || next.mode !== "workspace" || next.active_run
      || next.request_run?.status === "queued" || next.request_run?.status === "running"
      || (!pendingRef.current && (!workspaceTopicSearchCanStart(next) || error === "load"))) return;
    let request = pendingRef.current;
    if (!request) {
      request = { workspace_id: workspaceId, request_scope: next.request_scope, key: crypto.randomUUID(),
        body: { embedding_run_id: next.preflight.embedding_run_id! } };
      try { sessionStorage.setItem(workspaceTopicRequestStorageKey(workspaceId, next.request_scope), JSON.stringify(request)); }
      catch { setError("storage"); return; }
      pendingRef.current = request; setPending(request);
    }
    const controller = new AbortController(); writeController.current = controller;
    const ticket = epoch.current;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (controller.signal.aborted || ticket !== epoch.current) return;
        if (response.status < 500) forgetRequest();
        setError(response.status >= 500 ? "request" : payload?.error ?? "requestRejected"); return;
      }
      const payload: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current) return;
      accept(payload, request.key);
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setError("request"); }
    finally { if (writeController.current === controller) writeController.current = null;
      if (!controller.signal.aborted && ticket === epoch.current) setSubmitting(false); }
  }, [accept, endpoint, error, forgetRequest, revoke, workspaceId]);

  const executionId = data?.mode === "workspace" ? data.latest_ready?.id ?? null : null;
  const readResults = useCallback(async (cursor: string | null = null) => {
    if (!executionId || !termKey) return;
    resultsController.current?.abort(); const controller = new AbortController(); resultsController.current = controller;
    const ticket = epoch.current;
    setResultsStatus("loading");
    const query = new URLSearchParams({ execution_id: executionId, term_key: termKey });
    if (cursor) query.set("cursor", cursor);
    try {
      const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { revoke(); return; }
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        if (controller.signal.aborted || ticket !== epoch.current) return;
        if (response.status === 409 && failure?.error === "workspace_topic_evidence_stale") {
          setResultSnapshot(null); setResultsErrorCode("stale"); setResultsStatus("error"); return;
        }
        throw new Error();
      }
      const payload: unknown = await response.json();
      if (controller.signal.aborted || ticket !== epoch.current) return;
      if (!validWorkspaceTopicComputationResults(payload, executionId)) throw new Error();
      setResultSnapshot((previous) => ({ termKey, data: cursor && previous?.termKey === termKey && previous.data.execution_id === executionId
        ? { ...payload, items: [...previous.data.items, ...payload.items.filter((item) => !previous.data.items.some((old) => old.root_id === item.root_id))] } : payload }));
      setResultsErrorCode(null); setResultsStatus("ready");
    } catch { if (!controller.signal.aborted && ticket === epoch.current) setResultsStatus("error"); }
  }, [endpoint, executionId, revoke, termKey]);
  useEffect(() => {
    setResultSnapshot(null); setResultsStatus("idle"); setResultsErrorCode(null); void readResults();
    return () => resultsController.current?.abort();
  }, [readResults]);

  const results = resultSnapshot?.termKey === termKey && resultSnapshot?.data.execution_id === executionId ? resultSnapshot.data : null;
  return { data, reading, submitting, error, pending, results, resultsStatus, resultsErrorCode, read, start, readResults,
    canStart: error !== "load" && workspaceTopicSearchCanStart(data) || Boolean(pending && data?.can_execute && data.mode === "workspace"
      && !data.active_run && data.request_run?.status !== "queued" && data.request_run?.status !== "running") };
}
