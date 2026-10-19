"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { DefinedInterestSelectionCandidateV1 } from "@/lib/data-os/signal-defined-interest-selection";

type Receipt = { selected: boolean; selection_revision: number; snapshot_id: string | null;
  generation_id: string; taxonomy_term_id: string; definition_digest: string; definition_revision: number };
type State = { workspace_id: string; term_key: string; selection: Receipt | null; servable: boolean;
  ready: boolean; can_select: boolean; candidate: DefinedInterestSelectionCandidateV1 | null;
  selection_snapshot_digest?: string | null;
  latest_run: { status: string; complete: boolean; is_current: boolean } | null;
  request_receipt: { selection: Receipt } | null };
type Command = { term_key: string; selected: boolean; snapshot_id: string | null; expected_snapshot_digest: string | null;
  generation_id: string; taxonomy_term_id: string; definition_digest: string; definition_revision: number;
  expected_selection_revision: number };
type Intent = { key: string; command: Command };
const storageKey = (actorId: string, workspaceId: string, termKey: string) =>
  `noisia:defined-interest-selection:${actorId}:${workspaceId}:${termKey}`;
export function definedInterestSelectionCommandV1(state: State, dirty: boolean): Command | null {
  if (dirty) return null;
  const previous = state.selection;
  if (previous?.selected) {
    if (previous.snapshot_id !== null && !state.selection_snapshot_digest) return null;
    return { term_key: state.term_key, selected: false, snapshot_id: previous.snapshot_id,
      expected_snapshot_digest: previous.snapshot_id ? state.selection_snapshot_digest ?? null : null,
      generation_id: previous.generation_id, taxonomy_term_id: previous.taxonomy_term_id,
      definition_digest: previous.definition_digest, definition_revision: previous.definition_revision,
      expected_selection_revision: previous.selection_revision };
  }
  const candidate = state.candidate;
  if (!state.can_select || !state.ready || !candidate) return null;
  return { term_key: state.term_key, selected: true, snapshot_id: null, expected_snapshot_digest: null,
    generation_id: candidate.generation_id, taxonomy_term_id: candidate.taxonomy_term_id,
    definition_digest: candidate.definition_digest, definition_revision: candidate.definition_revision,
    expected_selection_revision: previous?.selection_revision ?? 0 };
}

export function DefinedInterestControlBoundaryV1({ interestGeneration, defined, legacy }: {
  interestGeneration: boolean; defined: ReactNode; legacy: ReactNode
}) { return interestGeneration ? defined : legacy; }

export function DefinedInterestSignalControls({ actorId, workspaceId, termKey, definitionDigest, dirty, disabled = false,
  signalHref, legacyControl = null, onAccessDenied }: { actorId: string; workspaceId: string; termKey: string; definitionDigest: string;
  dirty: boolean; disabled?: boolean; signalHref: string; legacyControl?: ReactNode; onAccessDenied?: () => void }) {
  const t = useTranslations("AdminWorkspace.topics.definedInterestSelection");
  const [state, setState] = useState<State | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const live = useRef(false), request = useRef<AbortController | null>(null);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/${encodeURIComponent(termKey)}/defined-interest-selection`;
  const clearIntent = useCallback(() => {
    try { sessionStorage.removeItem(storageKey(actorId, workspaceId, termKey)); } catch { /* storage optional */ }
    setIntent(null);
  }, [actorId, workspaceId, termKey]);
  const read = useCallback(async (key?: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${endpoint}${key ? `?idempotency_key=${encodeURIComponent(key)}` : ""}`,
        { cache: "no-store", signal: controller.signal });
      if (!live.current || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) { setState(null); clearIntent(); onAccessDenied?.(); throw new Error("forbidden"); }
      if (!response.ok) throw new Error("load");
      const next = await response.json() as State;
      if (!live.current || controller.signal.aborted) return;
      if (next.workspace_id !== workspaceId || next.term_key !== termKey) throw new Error("load");
      setState(next);
      if (key && next.request_receipt) clearIntent();
    } catch (cause) {
      if (live.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "load");
    } finally { if (live.current && !controller.signal.aborted) setBusy(false); }
  }, [endpoint, workspaceId, termKey, clearIntent, onAccessDenied]);
  useEffect(() => {
    live.current = true; setState(null); setIntent(null); setError(null);
    let restored: Intent | null = null;
    try { const raw = sessionStorage.getItem(storageKey(actorId, workspaceId, termKey));
      if (raw) { const parsed = JSON.parse(raw) as Intent;
        if (parsed.command?.term_key === termKey && typeof parsed.key === "string") restored = parsed; }
    } catch { /* missing or invalid storage */ }
    setIntent(restored); void read(restored?.key);
    return () => { live.current = false; request.current?.abort(); };
  }, [actorId, workspaceId, termKey, read]);
  const send = async () => {
    if (!state || state.workspace_id !== workspaceId || state.term_key !== termKey || busy || disabled) return;
    let pending = intent;
    if (!pending) {
      const command = definedInterestSelectionCommandV1(state, dirty || state.selection?.selected === false
        && state.candidate?.definition_digest !== definitionDigest);
      if (!command) return;
      pending = { key: crypto.randomUUID(), command }; setIntent(pending);
      try { sessionStorage.setItem(storageKey(actorId, workspaceId, termKey), JSON.stringify(pending)); } catch { /* memory remains */ }
    }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json",
        "Idempotency-Key": pending.key }, body: JSON.stringify(pending.command), signal: controller.signal });
      if (!live.current || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) { setState(null); clearIntent(); onAccessDenied?.(); throw new Error("forbidden"); }
      if (!response.ok) { if (response.status < 500) clearIntent(); throw new Error(response.status === 409 ? "conflict" : "save"); }
      await read(pending.key);
    } catch (cause) { if (live.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "save"); }
    finally { if (live.current && !controller.signal.aborted) setBusy(false); }
  };
  const scopedState = state?.workspace_id === workspaceId && state.term_key === termKey ? state : null;
  const selected = scopedState?.selection?.selected === true;
  const command = scopedState && definedInterestSelectionCommandV1(scopedState,
    dirty || (!selected && scopedState.candidate?.definition_digest !== definitionDigest));
  const interestGeneration = Boolean(scopedState?.latest_run || scopedState?.selection);
  if (legacyControl && !busy && !interestGeneration) return <DefinedInterestControlBoundaryV1
    interestGeneration={false} defined={null} legacy={legacyControl} />;
  return <div className="topics-manager__cost-notice" aria-busy={busy}>
    <strong>{t("title")}</strong>
    <p role="status">{selected ? t(scopedState?.servable ? "selected" : "selectedStale")
      : scopedState?.ready ? t("ready", { count: scopedState.candidate?.approved_memberships ?? 0 })
        : scopedState?.latest_run?.status === "running" ? t("processing") : t("notReady")}</p>
    <div className="admin-form-actions">
      <button type="button" className="admin-button" disabled={!command || disabled || busy || Boolean(intent)} onClick={() => void send()}>
        {busy ? t("saving") : selected ? t("remove") : t("show")}</button>
      <button type="button" className="admin-button" disabled={busy} onClick={() => void read(intent?.key)}>
        {intent ? t("recover") : t("refresh")}</button>
      {intent && !busy ? <button type="button" className="admin-button" onClick={() => void send()}>{t("retry")}</button> : null}
    </div>
    {selected && scopedState?.servable ? <Link href={signalHref} className="admin-button" prefetch={false}>{t("openSignal")}</Link> : null}
    {dirty ? <p>{t("saveFirst")}</p> : null}
    {intent ? <p role="status">{t("pending")}</p> : null}
    {error ? <p role="alert">{t(["forbidden", "conflict", "save"].includes(error) ? error : "load")}</p> : null}
  </div>;
}
