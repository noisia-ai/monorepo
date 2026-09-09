"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { acceptTopicSignalSelectionV1, canSelectTopicSignalV1, parseTopicSignalSelectionIntentV1, parseTopicSignalSelectionV1,
  topicSignalSelectionStorageKeyV1, shouldPollTopicSignalV1, type TopicSignalSelectionV1, type TopicSignalSelectionIntentV1
} from "@/lib/data-os/signal-topic-selection-ui";

export function TopicSignalControls({ workspaceId, termKey, definitionRevision, definitionDigest, dirty, disabled = false }: {
  workspaceId: string; termKey: string; definitionRevision: number; definitionDigest: string; dirty: boolean; disabled?: boolean;
}) {
  const t = useTranslations("AdminWorkspace.topics.signalSelection");
  const [data, setData] = useState<TopicSignalSelectionV1 | null>(null);
  const [pending, setPending] = useState<TopicSignalSelectionIntentV1 | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const current = useRef<TopicSignalSelectionV1 | null>(null), intent = useRef<TopicSignalSelectionIntentV1 | null>(null);
  const alive = useRef(false), epoch = useRef(0), request = useRef<AbortController | null>(null), sending = useRef(false);
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/${encodeURIComponent(termKey)}/commands`;
  const clearIntent = useCallback(() => {
    const value = intent.current;
    if (value) { try { sessionStorage.removeItem(topicSignalSelectionStorageKeyV1(value.workspace_id, value.term_key, value.request_scope)); } catch { /* memory recovery remains possible */ } }
    intent.current = null; setPending(null);
  }, []);
  const apply = useCallback((next: TopicSignalSelectionV1) => {
    if (next.workspace_id !== workspaceId || next.term_key !== termKey) throw new Error("load");
    if (current.current && current.current.request_scope !== next.request_scope) clearIntent();
    const accepted = acceptTopicSignalSelectionV1(current.current, next, workspaceId, termKey);
    current.current = accepted; setData(accepted);
    if (intent.current && next.request_receipt?.idempotency_key === intent.current.key) clearIntent();
    return next;
  }, [clearIntent, termKey, workspaceId]);
  const read = useCallback(async (restore = false, rejected = false) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const run = ++epoch.current; setBusy(true); setError(null);
    try {
      const key = intent.current?.key;
      const response = await fetch(`${endpoint}${key ? `?idempotency_key=${encodeURIComponent(key)}` : ""}`,
        { cache: "no-store", signal: controller.signal });
      if (!alive.current || run !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) {
        clearIntent(); current.current = null; setData(null); throw new Error("forbidden");
      }
      if (!response.ok) throw new Error("load");
      const body = await response.json();
      if (!alive.current || run !== epoch.current) return;
      const next = apply(parseTopicSignalSelectionV1(body));
      if (!alive.current || run !== epoch.current) return;
      if (rejected && key && !next.request_receipt && intent.current?.key === key) clearIntent();
      if (restore && !intent.current) {
        let restored: TopicSignalSelectionIntentV1 | null = null;
        try { restored = parseTopicSignalSelectionIntentV1(sessionStorage.getItem(topicSignalSelectionStorageKeyV1(workspaceId, termKey, next.request_scope)), next); } catch { /* storage unavailable */ }
        if (restored) {
          intent.current = restored; setPending(restored);
          const recovery = await fetch(`${endpoint}?idempotency_key=${encodeURIComponent(restored.key)}`, { cache: "no-store", signal: controller.signal });
          if (!alive.current || run !== epoch.current) return;
          if ([401, 403, 404].includes(recovery.status)) { clearIntent(); current.current = null; setData(null); throw new Error("forbidden"); }
          if (!recovery.ok) throw new Error("load");
          const recovered = await recovery.json();
          if (!alive.current || run !== epoch.current) return;
          apply(parseTopicSignalSelectionV1(recovered));
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current && run === epoch.current) setError(cause instanceof Error ? cause.message : "load");
    } finally { if (alive.current && run === epoch.current) setBusy(false); }
  }, [apply, clearIntent, endpoint, termKey, workspaceId]);
  useEffect(() => {
    const fence = epoch;
    alive.current = true; current.current = null; intent.current = null; setData(null); setPending(null);
    void read(true);
    return () => { alive.current = false; fence.current++; request.current?.abort(); sending.current = false; };
  }, [read, definitionRevision, definitionDigest]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (shouldPollTopicSignalV1(data, dirty || disabled || busy || Boolean(pending) || Boolean(error), document.visibilityState === "visible")) {
        timer = setTimeout(() => { if (document.visibilityState === "visible") void read(); }, 10_000);
      }
    };
    schedule(); document.addEventListener("visibilitychange", schedule);
    return () => { if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [data, dirty, disabled, busy, pending, error, read]);

  const send = async () => {
    const state = current.current;
    if (sending.current || busy || disabled || dirty || !state?.can_select || error ||
      state.definition_revision !== definitionRevision || state.definition_digest !== definitionDigest) return;
    let value = intent.current;
    if (!value) {
      if (!canSelectTopicSignalV1(state, dirty, false)) return;
      const key = crypto.randomUUID();
      value = { key, workspace_id: workspaceId, term_key: termKey, request_scope: state.request_scope,
        body: { action: "select_signal", selected: !state.selected, expected_definition_revision: state.definition_revision,
          expected_definition_digest: state.definition_digest, expected_selection_revision: state.selection_revision,
          generation_id: state.generation_id, idempotency_key: key } };
      try { sessionStorage.setItem(topicSignalSelectionStorageKeyV1(workspaceId, termKey, state.request_scope), JSON.stringify(value)); }
      catch { /* keep exact intent in memory; never auto-resend */ }
      intent.current = value; setPending(value);
    }
    sending.current = true; setBusy(true); setError(null); const run = ++epoch.current;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    let rejected = false;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": value.key },
        body: JSON.stringify(value.body), signal: controller.signal });
      if (!alive.current || run !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { clearIntent(); current.current = null; setData(null); throw new Error("forbidden"); }
      if (!response.ok) { rejected = response.status < 500; throw new Error(response.status === 409 ? "conflict" : "save"); }
      const body = await response.json();
      if (!alive.current || run !== epoch.current) return;
      apply(parseTopicSignalSelectionV1(body));
    } catch (cause) {
      if (alive.current && run === epoch.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "save");
        if (rejected) await read(false, true);
      }
    } finally { sending.current = false; if (alive.current && run === epoch.current) setBusy(false); }
  };
  const state = data?.workspace_id === workspaceId && data.term_key === termKey ? data : null;
  const matches = state?.definition_revision === definitionRevision && state.definition_digest === definitionDigest;
  return <div className="topics-manager__cost-notice" aria-busy={busy}>
    <div className="admin-form-actions">
      <button className="admin-button" type="button" onClick={() => void send()}
        disabled={busy || disabled || dirty || !matches || Boolean(error) || (!pending && !canSelectTopicSignalV1(state, dirty, false)) || !state?.can_select}>
        {busy ? t("saving") : pending ? t("resend") : state?.selected ? t("remove") : t("show")}
      </button>
      <button className="admin-button" type="button" disabled={busy} onClick={() => void read()}>{t(pending ? "recover" : "refresh")}</button>
    </div>
    <p>{t("basis")}</p>
    {state?.selected ? <p role="status">{t("selected")}{!state.is_current ? ` ${t("stale")}` : ""}</p> : null}
    {state && !state.selected && !state.is_current ? <p role={state.is_processing ? "status" : undefined}>{t(state.is_processing ? "processing" : "prepare")}</p> : null}
    {state && !state.selected && state.is_current && state.mention_count === 0 ? <p>{t("noMemberships")}</p> : null}
    {dirty ? <p>{t("saveFirst")}</p> : null}
    {pending ? <p role="status">{t("pending")}</p> : null}
    {error ? <p role="alert">{t(["forbidden", "conflict", "load", "save"].includes(error) ? error : "load")}</p> : null}
  </div>;
}
