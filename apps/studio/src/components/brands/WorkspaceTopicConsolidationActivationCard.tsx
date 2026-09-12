"use client";

import { CheckCircle, CircleNotch, RocketLaunch } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import {
  parseWorkspaceTopicConsolidationActivationStatusV1,
  submitWorkspaceTopicConsolidationActivationIntentV1,
  workspaceTopicConsolidationSelectedConceptKeysV1,
  workspaceTopicConsolidationActivationIntentV1,
  WorkspaceTopicConsolidationActivationRequestError,
  type WorkspaceTopicConsolidationActivationIntentV1,
  type WorkspaceTopicConsolidationActivationStatusV1
} from "@/lib/data-os/workspace-topic-consolidation-activation";

export function WorkspaceTopicConsolidationActivationCard({ value, selectedConceptKeys, signalHref,
  loading = false, busy = false, pending = false, loadError = false, requestError = false,
  accessDenied = false, onToggle, onToggleAll, onPrepare, onActivate, onReplay, onRefresh }: {
  value: WorkspaceTopicConsolidationActivationStatusV1 | null;
  selectedConceptKeys: string[];
  signalHref: string;
  loading?: boolean;
  busy?: boolean;
  pending?: boolean;
  loadError?: boolean;
  requestError?: boolean;
  accessDenied?: boolean;
  onToggle?: (conceptKey: string) => void;
  onToggleAll?: (selected: boolean) => void;
  onPrepare?: () => void;
  onActivate?: () => void;
  onReplay?: () => void;
  onRefresh?: () => void;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation.activation");
  const locale = useLocale();
  const latest = value?.revisions[0] ?? null;
  const catalog = latest?.catalog ?? [];
  const selected = new Set(selectedConceptKeys);
  const topicCount = catalog.filter(item => item.kind === "topic").length;
  const narrativeCount = catalog.filter(item => item.kind === "narrative").length;
  const active = Boolean(latest?.snapshot_id && latest.snapshot_id === value?.binding.snapshot_id);
  const sourceStale = latest?.source_valid === false;
  const canMutate = Boolean(value?.can_activate && !sourceStale && !loadError && !requestError && !accessDenied);
  const state = loading && !value ? "loading" : accessDenied ? "access_required" : loadError || requestError ? "error"
    : sourceStale ? "stale" : active ? "active" : latest?.snapshot_id ? "ready" : latest ? "prepare" : "waiting";
  const tone = state === "active" ? "good" : ["access_required", "error", "stale"].includes(state) ? "warning" : "not_available";
  const validatedAt = latest ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(latest.validated_at)) : null;

  return <section className="admin-section topics-manager__activation" data-topic-activation-state={state}>
    <div className="admin-section__head topics-manager__activation-head">
      <div><h3>{t("title")}</h3><p>{t("body")}</p></div>
      <AdminStatus state={tone}>{t(`states.${state}`)}</AdminStatus>
    </div>
    <div className="admin-section__body topics-manager__activation-body">
      {loading && !value ? <p role="status" className="topics-manager__activation-message"><CircleNotch aria-hidden
        className="workspace-shell__nav-pending" size={16} />{t("loading")}</p> : null}
      {accessDenied ? <p role="alert" className="team-msg team-msg--error">{t("access")}</p> : null}
      {!loading && !accessDenied && !latest ? <p role="status" className="topics-manager__activation-message">{t("waiting")}</p> : null}

      {latest ? <>
        <div className="topics-manager__activation-version">
          <span>{t("version", { revision: latest.revision })}</span>
          <time dateTime={latest.validated_at}>{validatedAt}</time>
          {value?.active_revision && !active ? <small>{t("currentVersion", { revision: value.active_revision })}</small> : null}
        </div>
        {latest.snapshot_id && catalog.length > 0 ? <>
          <dl className="admin-summary-strip admin-summary-strip--compact topics-manager__activation-summary">
            <div><dt>{t("topics")}</dt><dd>{topicCount.toLocaleString(locale)}</dd></div>
            <div><dt>{t("narratives")}</dt><dd>{narrativeCount.toLocaleString(locale)}</dd></div>
            <div><dt>{t("selected")}</dt><dd>{selected.size.toLocaleString(locale)}</dd></div>
          </dl>
          {!active ? <>
            <div className="topics-manager__activation-select-all">
              <label><input type="checkbox" checked={selected.size === catalog.length} disabled={!canMutate || busy || pending}
                onChange={event => onToggleAll?.(event.target.checked)} />
                <span>{t("selectAll")}</span></label>
              <small>{t("selectionHint")}</small>
            </div>
            <ul className="topics-manager__activation-list">
              {catalog.map(concept => <li key={concept.concept_key}>
                <label>
                  <input type="checkbox" checked={selected.has(concept.concept_key)} disabled={!canMutate || busy || pending}
                    onChange={() => onToggle?.(concept.concept_key)} />
                  <span><strong>{concept.label}</strong><small>{t(`kinds.${concept.kind}`)}</small></span>
                </label>
              </li>)}
            </ul>
          </> : <p className="topics-manager__activation-message topics-manager__activation-message--success">
            <CheckCircle aria-hidden size={18} />{t("activeBody", { count: selected.size, revision: latest.revision })}</p>}
        </> : null}
        {sourceStale ? <p role="alert" className="team-msg team-msg--error">{t("stale")}</p> : null}
        {!value?.can_activate && !active && !sourceStale ? <p role="status" className="topics-manager__activation-message">{t("readOnly")}</p> : null}
        {!latest.snapshot_id && canMutate ? <p className="topics-manager__activation-message">{t("prepareHint")}</p> : null}
      </> : null}

      {loadError ? <p role="alert" className="team-msg team-msg--error">{t("loadError")}</p> : null}
      {requestError ? <p role="alert" className="team-msg team-msg--error">{t("requestError")}</p> : null}
      <div className="admin-form-actions topics-manager__activation-actions">
        {pending ? <button className="admin-button admin-button--primary" disabled={busy || !onReplay}
          onClick={onReplay} type="button">{busy ? <CircleNotch aria-hidden className="workspace-shell__nav-pending" size={15} /> : null}{t("replay")}</button>
          : latest && !latest.snapshot_id && canMutate ? <button className="admin-button admin-button--primary" disabled={busy || !onPrepare}
            onClick={onPrepare} type="button">{busy ? <CircleNotch aria-hidden className="workspace-shell__nav-pending" size={15} /> : <RocketLaunch aria-hidden size={15} />}{t("prepare")}</button>
            : latest?.snapshot_id && !active && canMutate ? <button className="admin-button admin-button--primary"
              disabled={busy || selected.size === 0 || !onActivate} onClick={onActivate} type="button">
              {busy ? <CircleNotch aria-hidden className="workspace-shell__nav-pending" size={15} /> : <RocketLaunch aria-hidden size={15} />}
              {t("publish", { count: selected.size })}</button> : null}
        {active ? <Link className="admin-button admin-button--primary" href={signalHref} prefetch={false}>{t("openSignal")}</Link> : null}
        {(loadError || sourceStale || requestError) && !pending ? <button className="admin-button" disabled={busy || !onRefresh}
          onClick={onRefresh} type="button">{t("refresh")}</button> : null}
      </div>
    </div>
  </section>;
}

export function WorkspaceTopicConsolidationActivationControls({ workspaceId, signalHref, disabled = false }: {
  workspaceId: string;
  signalHref: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<WorkspaceTopicConsolidationActivationStatusV1 | null>(null);
  const [selectedConceptKeys, setSelectedConceptKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const readController = useRef<AbortController | null>(null);
  const submitController = useRef<AbortController | null>(null);
  const intent = useRef<WorkspaceTopicConsolidationActivationIntentV1 | null>(null);
  const selectionSnapshot = useRef<string | null>(null);
  const mounted = useRef(true);
  const scope = useRef(workspaceId);
  scope.current = workspaceId;

  const read = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation/activation`,
        { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || !mounted.current || scope.current !== workspaceId) return;
      if ([401, 403, 404].includes(response.status)) {
        setValue(null); setSelectedConceptKeys([]); setAccessDenied(true); setLoadError(false); return;
      }
      const parsed = response.ok ? parseWorkspaceTopicConsolidationActivationStatusV1(body, workspaceId) : null;
      if (!parsed) throw new Error("topic_consolidation_activation_status_invalid");
      setValue(parsed); setAccessDenied(false); setLoadError(false);
      const latest = parsed.revisions[0] ?? null;
      const snapshotKey = latest?.snapshot_id ?? null;
      if (latest && snapshotKey && (selectionSnapshot.current !== snapshotKey || snapshotKey === parsed.binding.snapshot_id)) {
        selectionSnapshot.current = snapshotKey;
        setSelectedConceptKeys(workspaceTopicConsolidationSelectedConceptKeysV1(parsed, latest));
      }
      const pendingIntent = intent.current;
      let observed = false;
      if (pendingIntent?.body.action === "prepare") {
        const revisionId = pendingIntent.body.revision_id;
        observed = parsed.revisions.some(revision => revision.revision_id === revisionId && revision.snapshot_id !== null);
      }
      else if (pendingIntent?.body.action === "activate") observed = parsed.binding.snapshot_id === pendingIntent.body.snapshot_id;
      if (observed) { intent.current = null; setPending(false); setRequestError(false); }
    } catch {
      if (!controller.signal.aborted && mounted.current && scope.current === workspaceId) setLoadError(true);
    } finally {
      if (readController.current === controller) readController.current = null;
      if (!controller.signal.aborted && mounted.current && scope.current === workspaceId) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    mounted.current = true; intent.current = null; selectionSnapshot.current = null;
    setValue(null); setSelectedConceptKeys([]); setLoading(true); setBusy(false); setPending(false);
    setLoadError(false); setRequestError(false); setAccessDenied(false); void read();
    return () => { mounted.current = false; readController.current?.abort(); submitController.current?.abort(); };
  }, [read]);

  const submit = async (replay = false) => {
    if (disabled || busy || submitController.current || !value || accessDenied) return;
    const latest = value.revisions[0];
    if (!latest) return;
    let next = intent.current;
    if (!replay) {
      const body = !latest.snapshot_id ? { action: "prepare" as const, revision_id: latest.revision_id,
        revision_digest: latest.revision_digest }
        : latest.source_valid && selectedConceptKeys.length > 0 ? { action: "activate" as const,
          snapshot_id: latest.snapshot_id, snapshot_digest: latest.snapshot_digest!, revision_digest: latest.revision_digest,
          selected_concept_keys: selectedConceptKeys, expected_binding_revision: value.binding.binding_revision,
          expected_selection_revision: value.binding.selection_revision, expected_snapshot_id: value.binding.snapshot_id,
          expected_legacy_generation_id: value.binding.legacy_generation_id } : null;
      if (!body) return;
      next = workspaceTopicConsolidationActivationIntentV1({ workspace_id: workspaceId, body,
        previous: intent.current, createKey: () => crypto.randomUUID() });
    }
    if (!next || next.workspace_id !== workspaceId) return;
    intent.current = next; setBusy(true); setRequestError(false);
    readController.current?.abort();
    const controller = new AbortController(); submitController.current = controller;
    try {
      await submitWorkspaceTopicConsolidationActivationIntentV1(next, fetch, controller.signal);
      if (controller.signal.aborted || !mounted.current || scope.current !== workspaceId) return;
      intent.current = null; setPending(false); await read();
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && scope.current === workspaceId) {
        if (error instanceof WorkspaceTopicConsolidationActivationRequestError) {
          if (error.accessDenied) { setAccessDenied(true); setValue(null); setSelectedConceptKeys([]); intent.current = null; setPending(false); }
          else if (error.stale) { intent.current = null; setPending(false); setRequestError(true); await read(); }
          else { setPending(error.ambiguous); setRequestError(true); if (!error.ambiguous) { intent.current = null; await read(); } }
        } else { setPending(true); setRequestError(true); }
      }
    } finally {
      if (submitController.current === controller) submitController.current = null;
      if (!controller.signal.aborted && mounted.current && scope.current === workspaceId) setBusy(false);
    }
  };

  const allKeys = useMemo(() => value?.revisions[0]?.catalog?.map(item => item.concept_key) ?? [], [value]);
  return <WorkspaceTopicConsolidationActivationCard value={value} selectedConceptKeys={selectedConceptKeys}
    signalHref={signalHref} loading={loading} busy={disabled || busy} pending={pending} loadError={loadError}
    requestError={requestError} accessDenied={accessDenied}
    onToggle={conceptKey => setSelectedConceptKeys(current => current.includes(conceptKey)
      ? current.filter(key => key !== conceptKey) : allKeys.filter(key => current.includes(key) || key === conceptKey))}
    onToggleAll={checked => setSelectedConceptKeys(checked ? allKeys : [])}
    onPrepare={() => void submit()} onActivate={() => void submit()} onReplay={() => void submit(true)} onRefresh={() => {
      intent.current = null; setPending(false); setRequestError(false); void read();
    }} />;
}
