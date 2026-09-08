"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SignalTopicsManagementProductV1 } from "@/lib/data-os/signal-topics-management";
import { ArrowClockwise, Archive, Check, FloppyDisk, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";

import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import { TopicCandidateEvidence } from "@/components/brands/TopicCandidateEvidence";

type Management = SignalTopicsManagementProductV1;
type Topic = Management["topics"][number];
type Candidate = Management["discovered"]["items"][number];
type ResultItem = { canonical_root_id: string; text: string; platform: string; published_at: string;
  term_key: string; term_label: string; disposition: "relevant" | "doubt" | "excluded";
  method: string; semantic_score: number | null; correction: "belongs" | "excluded" | null;
  correction_updated_at: string | null; definition_revision: number };
type Editor = { label: string; definition: string; scope: Topic["scope"];
  inclusion: string; exclusion: string; positive_examples: string; negative_examples: string };
const EDIT_RECLASSIFICATION_CAP_MICRO_USD = 5_000;

export function TopicsManager({ brandId, initial, workspaceId }: {
  brandId: string; initial: Management; workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.topics");
  const tEvidence = useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicCandidates");
  const locale = useLocale();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"topics" | "discovered" | "archived">("topics");
  const [query, setQuery] = useState("");
  const [candidateScopes, setCandidateScopes] = useState<Record<string, Topic["scope"]>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(initial.topics.find((item) => item.lifecycle !== "archived")?.term_key ?? null);
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<Editor>(() => {
    const topic = initial.topics.find((item) => item.lifecycle !== "archived");
    return topic ? editorFromTopic(topic) : emptyEditor();
  });
  const [results, setResults] = useState<ResultItem[]>([]);
  const [resultsStatus, setResultsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [resultState, setResultState] = useState<"relevant" | "doubt" | "excluded">("relevant");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const selected = data.topics.find((item) => item.term_key === selectedKey) ?? null;
  const editorDirty = selected ? stableClientJson(editorPayload(editor)) !== stableClientJson(topicPayload(selected)) : creating && stableClientJson(editorPayload(editor)) !== stableClientJson(editorPayload(emptyEditor()));
  const semanticDirty = selected ? stableClientJson(semanticEditorPayload(editor))
    !== stableClientJson(semanticTopicPayload(selected)) : false;
  const visibleTopics = useMemo(() => data.topics.filter((item) => {
    if (tab === "archived" ? item.lifecycle !== "archived" : item.lifecycle === "archived") return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${item.label} ${item.definition}`.toLocaleLowerCase().includes(needle);
  }), [data.topics, query, tab]);
  const canEdit = data.capabilities.can_edit;
  const canExecute = data.capabilities.can_execute;
  const canSearch = canExecute && data.readiness.state === "ready";
  const awaitingImport = data.readiness.state === "awaiting_import";
  const running = data.execution && ["queued", "running"].includes(data.execution.status);
  const hasUnsupportedSignalScope = data.topics.some((item) => item.lifecycle !== "archived"
    && item.scope !== "primary_brand");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/data-os/signal/${workspaceId}/topics`, { cache: "no-store" });
    if (!response.ok) throw new Error(t("errors.load"));
    const next = await response.json() as Management;
    setData(next);
    if (selectedKey && !next.topics.some((item) => item.term_key === selectedKey)) setSelectedKey(next.topics[0]?.term_key ?? null);
    return next;
  }, [selectedKey, t, workspaceId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [refresh, running]);

  useEffect(() => {
    if (!selected || !data.search_execution_id) { setResults([]); setResultsStatus("idle"); return; }
    const controller = new AbortController();
    setResultsStatus("loading");
    const params = new URLSearchParams({ term_key: selected.term_key, state: resultState, limit: "60" });
    fetch(`/api/data-os/signal/${workspaceId}/topics/executions/${data.search_execution_id}/results?${params}`,
      { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = await response.json() as { items: ResultItem[] };
        if (!controller.signal.aborted) { setResults(payload.items); setResultsStatus("ready"); }
      }).catch(() => { if (!controller.signal.aborted) { setResults([]); setResultsStatus("error"); } });
    return () => controller.abort();
  }, [data.search_execution_id, resultState, selected, workspaceId]);

  useEffect(() => {
    if (!editorDirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || event.metaKey || event.ctrlKey
        || event.shiftKey || event.altKey || new URL(link.href).href === window.location.href) return;
      if (!window.confirm(t("unsaved.confirm"))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [editorDirty, t]);

  function canLeaveEditor() { return busy === null && (!editorDirty || window.confirm(t("unsaved.confirm"))); }

  function editTopic(topic: Topic) {
    setCreating(false); setSelectedKey(topic.term_key);
    setEditor({ label: topic.label, definition: topic.definition, scope: topic.scope,
      inclusion: topic.inclusion.join("\n"), exclusion: topic.exclusion.join("\n"),
      positive_examples: topic.positive_examples.join("\n"), negative_examples: topic.negative_examples.join("\n") });
  }

  async function createTopic() {
    await act("create", async () => {
      const body = { action: "create", input: editorPayload(editor) };
      const idempotency = await deterministicKey("create", { workspaceId, profile: data.profile?.id ?? null,
        topic_count: data.topics.length, body });
      await jsonRequest(`/api/data-os/signal/${workspaceId}/topics`, "POST", body, idempotency);
      const next = await refresh();
      const newest = next.topics.at(-1);
      setCreating(false); setSelectedKey(newest?.term_key ?? null);
      if (newest) editTopic(newest);
    }, t("feedback.created"));
  }

  async function saveTopic() {
    if (!selected) return;
    await act("save", async () => {
      const body = { ...editorPayload(editor), expected_definition_revision: selected.definition_revision };
      const idempotency = await deterministicKey("save", { workspaceId, term_key: selected.term_key,
        updated_at: selected.updated_at, body });
      const hadResult = selected.status === "ready" || selected.status === "in_signal";
      await jsonRequest(`/api/data-os/signal/${workspaceId}/topics/${selected.term_key}`,
        "POST", body, idempotency, semanticDirty && hadResult
          ? { "X-Noisia-Embedding-Cost-Cap-Micro-Usd": String(EDIT_RECLASSIFICATION_CAP_MICRO_USD) }
          : undefined);
      await refresh();
    }, t("feedback.saved"));
  }

  async function adoptCandidate(candidate: Candidate) {
    if (!data.discovered.run_key || (!candidate.scope && !candidateScopes[candidate.candidate_key]) || !canLeaveEditor()) return;
    await act(`adopt:${candidate.candidate_key}`, async () => {
      const body = {
        action: "adopt", input: { run_key: data.discovered.run_key,
          candidate_key: candidate.candidate_key,
          ...(candidate.scope ? {} : { scope: candidateScopes[candidate.candidate_key] }) }
      };
      const idempotency = await deterministicKey("adopt", { workspaceId, profile: data.profile?.id ?? null, body });
      await jsonRequest(`/api/data-os/signal/${workspaceId}/topics`, "POST", body, idempotency);
      const next = await refresh();
      const adopted = next.topics.find((item) => item.source?.candidate_key === candidate.candidate_key);
      setTab("topics"); setSelectedKey(adopted?.term_key ?? null);
      if (adopted) editTopic(adopted);
    }, t("feedback.adopted"));
  }

  async function command(action: "search" | "follow" | "archive" | "restore" | "retry") {
    if (!selected) return;
    await act(action, async () => {
      const startsSearch = action === "search" || (action === "retry" && data.execution?.intent !== "publish");
      const embeddingCostCapMicroUsd = startsSearch && data.embedding_preflight.requires_paid_call
        ? data.embedding_preflight.estimated_micro_usd : undefined;
      const idempotency = await deterministicKey(`command-${action}`, { workspaceId,
        profile: data.profile?.id ?? null, execution: data.execution?.id ?? null,
        execution_status: data.execution?.status ?? null, term_key: selected.term_key,
        revision: selected.definition_revision,
        embedding_cost_cap_micro_usd: embeddingCostCapMicroUsd ?? null });
      await jsonRequest(`/api/data-os/signal/${workspaceId}/topics/${selected.term_key}/commands`, "POST",
        { action, idempotency_key: idempotency,
          ...(embeddingCostCapMicroUsd ? { embedding_cost_cap_micro_usd: embeddingCostCapMicroUsd } : {}) }, null);
      await refresh();
    }, action === "follow" ? t("feedback.following") : action === "archive"
      ? t("feedback.archiveUpdating") : action === "restore" ? t("feedback.restored") : t("feedback.searching"));
  }

  async function correct(item: ResultItem, disposition: "belongs" | "excluded") {
    if (!data.search_execution_id) return;
    await act(`correct:${item.canonical_root_id}:${disposition}`, async () => {
      const body = { disposition, expected_definition_revision: item.definition_revision };
      const idempotency = await deterministicKey("correct", { workspaceId,
        execution_id: data.search_execution_id, term_key: item.term_key,
        root_id: item.canonical_root_id, correction_updated_at: item.correction_updated_at, body });
      await jsonRequest(`/api/data-os/signal/${workspaceId}/topics/executions/${data.search_execution_id}/results/${item.canonical_root_id}?term_key=${encodeURIComponent(item.term_key)}`,
        "POST", body, idempotency);
      await refresh();
    }, disposition === "belongs" ? t("feedback.belongs") : t("feedback.excluded"));
  }

  async function act(name: string, action: () => Promise<void>, success: string) {
    setBusy(name); setFeedback(null);
    try { await action(); setFeedback({ tone: "ok", text: success }); }
    catch (error) { setFeedback({ tone: "error", text: requestErrorMessage(t, error) }); }
    finally { setBusy(null); }
  }

  return <div className="topics-manager">
    {data.readiness.state !== "ready" ? <section className="topics-manager__preparation">
      <div><strong>{t(`readiness.${data.readiness.state}.title`)}</strong><p>{t(`readiness.${data.readiness.state}.body`)}</p></div>
      {data.readiness.next_action === "import_mentions" || data.readiness.next_action === "prepare_mentions"
        ? <Link className="admin-button" href={`/studio/brands/${encodeURIComponent(brandId)}/data`} prefetch={false}>{t("actions.import")}</Link> : null}
    </section> : null}
    {!canEdit ? <p role="status" className="topics-manager__cost-notice">{t("permissions.readOnly")}</p> : null}
    <section className="admin-section topics-manager__toolbar">
      <div className="topics-manager__tabs" role="tablist" aria-label={t("tabs.label")}>
        {(["topics", "discovered", "archived"] as const).map((item) => <button
          aria-selected={tab === item} className={tab === item ? "is-active" : ""} key={item}
          onKeyDown={(event) => {
            const tabs = ["topics", "discovered", "archived"] as const;
            const index = tabs.indexOf(item);
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
              : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next !== null) { event.preventDefault(); setTab(tabs[next]!);
              (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next])?.focus(); }
          }}
          onClick={() => setTab(item)} role="tab" tabIndex={tab === item ? 0 : -1} type="button">{t(`tabs.${item}`)}</button>)}
      </div>
      <label className="topics-manager__search"><MagnifyingGlass aria-hidden size={16} />
        <span className="sr-only">{t("search")}</span>
        <input onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} value={query} />
      </label>
      <button className="admin-button admin-button--primary" disabled={!canEdit || busy !== null} onClick={() => {
        if (!canLeaveEditor()) return;
        setCreating(true); setSelectedKey(null); setEditor(emptyEditor()); setTab("topics");
      }} type="button"><Plus aria-hidden size={15} />{t("actions.create")}</button>
    </section>

    {running ? <div className="topics-manager__progress" role="status">
      <span>{data.execution?.intent === "publish" ? t("progress.publishing") : t("progress.searching")}</span>
      <progress max="100" value={data.execution?.progress ?? 0} />
      <strong>{data.execution?.progress ?? 0}%</strong>
    </div> : null}
    {data.execution?.status === "failed" ? <div className="topics-manager__error" role="alert">
      <strong>{t("errors.execution")}</strong><span>{executionErrorMessage(t, data.execution.error_code)}</span>
    </div> : null}
    {feedback ? <p className={`team-msg team-msg--${feedback.tone === "ok" ? "ok" : "error"}`} role="status">{feedback.text}</p> : null}

    {tab === "discovered" ? <section className="admin-section topics-manager__discovered">
      <header><div><h2>{t("discovered.title")}</h2><p>{t("discovered.body")}</p></div>
        <span>{data.discovered.items.length}</span></header>
      {data.discovered.items.length ? <div className="topics-manager__candidate-grid">
        {data.discovered.items.filter((item) => !query || `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
          .map((candidate) => <article key={candidate.candidate_key}>
            <div><small>{t(`origin.${candidate.origin}`)} · {t("discovered.evidence", { count: candidate.evidence_count })}</small>
              <h3>{candidate.title}</h3><p>{candidate.description}</p>
              {candidate.evidence_source === "v2" && data.discovered.run_key ? <details>
                <summary>{t("discovered.openEvidence")}</summary>
                <TopicCandidateEvidence endpoint={`/api/data-os/signal/${workspaceId}/topic-evaluation/full-evidence/candidates`}
                  runKey={data.discovered.run_key} candidateKey={candidate.candidate_key}
                  collection="candidate" t={tEvidence} />
              </details> : <CandidateRules candidate={candidate} t={t} />}</div>
            {candidate.scope ? <p>{t("fields.scope")}: {t(`scopes.${candidate.scope}`)}</p>
              : <label className="topics-manager__candidate-scope">{t("discovered.chooseScope")}<select
                disabled={!data.capabilities.can_adopt || candidate.used_as_topic || busy !== null}
                onChange={(event) => setCandidateScopes({ ...candidateScopes, [candidate.candidate_key]: event.target.value as Topic["scope"] })}
                value={candidateScopes[candidate.candidate_key] ?? ""}>
                <option value="" disabled>{t("discovered.scopePlaceholder")}</option>
                {(["primary_brand", "competitor", "category"] as const).map((scope) => <option key={scope} value={scope}>{t(`scopes.${scope}`)}</option>)}
              </select></label>}
            <button className="admin-button" disabled={!data.capabilities.can_adopt || candidate.used_as_topic || busy !== null || (!candidate.scope && !candidateScopes[candidate.candidate_key])}
              onClick={() => void adoptCandidate(candidate)} type="button">
              {candidate.used_as_topic ? <Check aria-hidden size={15} /> : <Plus aria-hidden size={15} />}
              {candidate.used_as_topic ? t("discovered.used") : t("discovered.use")}
            </button>
          </article>)}
      </div> : <div className="admin-empty"><strong>{t("discovered.empty")}</strong><p>{t("discovered.emptyBody")}</p></div>}
    </section> : <div className="topics-manager__layout">
      <aside className="admin-section topics-manager__list">
        <header><div><h2>{tab === "archived" ? t("archived.title") : t("list.title")}</h2>
          <p>{t("list.body")}</p></div><span>{visibleTopics.length}</span></header>
        {visibleTopics.length ? visibleTopics.map((topic) => <button className={selectedKey === topic.term_key ? "is-active" : ""}
          key={topic.term_key} disabled={busy !== null} onClick={() => { if (topic.term_key !== selectedKey && canLeaveEditor()) editTopic(topic); }} type="button">
          <span><strong>{topic.label}</strong><small>{topic.definition}</small>
            <time dateTime={topic.updated_at}>{t("list.updated", {
              date: new Date(topic.updated_at).toLocaleDateString(locale)
            })}</time></span>
          <span><AdminStatus state={statusTone(topic.status)}>{t(`states.${topic.status}`)}</AdminStatus>
            {topic.status === "searching" || topic.status === "updating" ? <small>…</small>
              : topic.status === "draft" ? <small>{t("list.notSearched")}</small>
                : <small>{t("list.mentions", { count: topic.counts.relevant })}</small>}</span>
        </button>) : <div className="admin-empty admin-empty--compact"><strong>{t(tab === "archived" ? "archived.empty" : "list.empty")}</strong></div>}
      </aside>

      <main className="admin-section topics-manager__detail">
        {creating || selected ? <>
          <header><div><small>{creating ? t("editor.newEyebrow") : t(`origin.${selected?.origin ?? "manual"}`)}</small>
            <h2>{creating ? t("editor.newTitle") : selected?.label}</h2>
            {!creating && selected?.source ? <p>{t("editor.source", { candidate: selected.source.candidate_key })}</p> : null}</div>
            {!creating && selected ? <AdminStatus state={statusTone(selected.status)}>{t(`states.${selected.status}`)}</AdminStatus> : null}
          </header>
          <fieldset className="topics-manager__form" disabled={!canEdit || busy !== null}>
            <label>{t("fields.name")}<input maxLength={160} onChange={(event) => setEditor({ ...editor, label: event.target.value })} value={editor.label} /></label>
            <label>{t("fields.definition")}<textarea maxLength={1500} onChange={(event) => setEditor({ ...editor, definition: event.target.value })} rows={4} value={editor.definition} /></label>
            <label>{t("fields.scope")}<select onChange={(event) => setEditor({ ...editor, scope: event.target.value as Topic["scope"] })} value={editor.scope}>
              <option value="primary_brand">{t("scopes.primary_brand")}</option><option value="competitor">{t("scopes.competitor")}</option>
              <option value="category">{t("scopes.category")}</option></select></label>
            <details><summary>{t("advanced.title")}</summary><div className="topics-manager__advanced">
              <LineField label={t("fields.inclusion")} onChange={(value) => setEditor({ ...editor, inclusion: value })} value={editor.inclusion} />
              <LineField label={t("fields.exclusion")} onChange={(value) => setEditor({ ...editor, exclusion: value })} value={editor.exclusion} />
              <LineField label={t("fields.positive")} onChange={(value) => setEditor({ ...editor, positive_examples: value })} value={editor.positive_examples} />
              <LineField label={t("fields.negative")} onChange={(value) => setEditor({ ...editor, negative_examples: value })} value={editor.negative_examples} />
            </div></details>
          </fieldset>
          {editorDirty ? <p className="topics-manager__unsaved" role="status">{t("unsaved.notice")}</p> : null}
          <div className="topics-manager__actions">
            {creating ? <><button className="admin-button admin-button--primary" disabled={!canEdit || !editor.label.trim() || !editor.definition.trim() || busy !== null}
              onClick={() => void createTopic()} type="button"><Plus aria-hidden size={15} />{t("actions.saveDraft")}</button>
              <button className="admin-button" disabled={busy !== null} onClick={() => { if (canLeaveEditor()) setCreating(false); }} type="button"><X aria-hidden size={15} />{t("actions.cancel")}</button></>
              : selected ? <><button className="admin-button" disabled={!canEdit || busy !== null || !editorDirty || !editor.label.trim() || !editor.definition.trim()} onClick={() => void saveTopic()} type="button">
                <FloppyDisk aria-hidden size={15} />{t("actions.save")}</button>
                {selected.lifecycle === "archived" ? <>
                  {selected.status === "failed" ? <button className="admin-button admin-button--primary"
                    disabled={!canEdit || busy !== null || Boolean(running) || editorDirty} onClick={() => { if (canExecute) void command("retry"); }} type="button">
                    <ArrowClockwise aria-hidden size={15} />{t("actions.retry")}</button> : null}
                  <button className="admin-button" disabled={!canEdit || busy !== null || Boolean(running) || editorDirty}
                    onClick={() => void command("restore")} type="button">
                    <ArrowClockwise aria-hidden size={15} />{t("actions.restore")}</button></> : <>
                  {selected.status !== "updating" && (selected.status !== "in_signal" || !data.search_is_current) ? <button className="admin-button admin-button--primary" disabled={!canSearch || busy !== null || Boolean(running) || editorDirty} onClick={() => void command(data.execution?.status === "failed" ? "retry" : "search")} type="button">
                    <MagnifyingGlass aria-hidden size={15} />{data.execution?.status === "failed" ? t("actions.retry") : t("actions.search")}</button> : null}
                  {selected.status === "ready" && data.search_is_current ? <button className="admin-button"
                    disabled={!canExecute || busy !== null || Boolean(running) || !data.search_execution_id || editorDirty
                      || hasUnsupportedSignalScope} onClick={() => void command("follow")} type="button">
                    <Check aria-hidden size={15} />{t("actions.follow")}</button> : null}
                  <button className="admin-button admin-button--danger" disabled={!canEdit || busy !== null || editorDirty} onClick={() => void command("archive")} type="button">
                    <Archive aria-hidden size={15} />{t("actions.archive")}</button></>}</> : null}
          </div>
          {!creating && selected && semanticDirty
            && (selected.status === "ready" || selected.status === "in_signal")
            ? <p className="topics-manager__cost-notice">{t("cost.editNotice", {
              amount: formatMicroUsd(EDIT_RECLASSIFICATION_CAP_MICRO_USD, locale)
            })}</p> : null}
          {!creating && selected && selected.status === "ready" && hasUnsupportedSignalScope
            ? <p className="topics-manager__cost-notice">{t("scopeNotice")}</p> : null}
          {!creating && selected && selected.lifecycle !== "archived"
            && selected.status !== "updating" && (selected.status !== "in_signal" || !data.search_is_current)
            && data.embedding_preflight.requires_paid_call ? <p className="topics-manager__cost-notice">
              {t("cost.notice", { amount: formatMicroUsd(data.embedding_preflight.estimated_micro_usd, locale),
                count: data.embedding_preflight.missing_inputs })}
            </p> : null}
          {!creating && selected && data.search_execution_id ? <section className="topics-manager__results">
            <header><div><small>{t("results.eyebrow")}</small><h3>{t("results.title")}</h3><p>{t("results.body")}</p></div>
              <nav aria-label={t("results.filters")}>
                {(["relevant", "doubt", "excluded"] as const).map((state) => <button className={resultState === state ? "is-active" : ""}
                  key={state} onClick={() => setResultState(state)} type="button">{t(`results.${state}`)} <span>{selected.counts[state]}</span></button>)}
              </nav></header>
            <div className="topics-manager__result-list">{resultsStatus === "loading"
              ? <div className="admin-empty admin-empty--compact" role="status"><strong>{t("results.loading")}</strong></div>
              : resultsStatus === "error" ? <div className="topics-manager__error" role="alert"><strong>{t("results.error")}</strong></div>
              : results.length ? results.map((item) => <article key={`${item.term_key}:${item.canonical_root_id}`}>
              <div><div className="topics-manager__result-meta"><span>{item.platform}</span><time>{new Date(item.published_at).toLocaleDateString(locale)}</time>
                {item.semantic_score !== null ? <span>{Math.round(item.semantic_score * 100)}%</span> : null}</div>
                <p>{item.text}</p><small>{t(`methods.${item.method}`)}</small></div>
              <div><button className={item.correction === "belongs" ? "is-active" : ""} disabled={!canEdit || busy !== null}
                onClick={() => void correct(item, "belongs")} type="button"><Check aria-hidden size={14} />{t("results.belongs")}</button>
                <button className={item.correction === "excluded" ? "is-active is-excluded" : ""} disabled={!canEdit || busy !== null}
                  onClick={() => void correct(item, "excluded")} type="button"><X aria-hidden size={14} />{t("results.notBelongs")}</button></div>
            </article>) : <div className="admin-empty admin-empty--compact"><strong>{t("results.empty")}</strong></div>}</div>
          </section> : !creating && selected ? <div className="topics-manager__start"><MagnifyingGlass aria-hidden size={22} />
            <div><strong>{t(awaitingImport ? "readiness.awaiting_import.title" : "start.title")}</strong><p>{t(awaitingImport ? "readiness.awaiting_import.body" : "start.body")}</p></div></div> : null}
        </> : <div className="admin-empty"><strong>{t("editor.select")}</strong></div>}
      </main>
    </div>}
  </div>;
}

function LineField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <label>{label}<textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} /></label>;
}
function CandidateRules({ candidate, t }: { candidate: Candidate; t: ReturnType<typeof useTranslations> }) {
  if (!candidate.inclusion.length && !candidate.exclusion.length) return <p>{t("discovered.legacyEvidenceUnavailable")}</p>;
  return <details><summary>{t("discovered.openEvidence")}</summary>
    {candidate.inclusion.length ? <><strong>{t("discovered.legacyExamples")}</strong><ul>
      {candidate.inclusion.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
    {candidate.exclusion.length ? <><strong>{t("discovered.legacyExclusions")}</strong><ul>
      {candidate.exclusion.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
  </details>;
}
function emptyEditor(): Editor { return { label: "", definition: "", scope: "primary_brand",
  inclusion: "", exclusion: "", positive_examples: "", negative_examples: "" }; }
function editorFromTopic(topic: Topic): Editor { return { label: topic.label, definition: topic.definition,
  scope: topic.scope, inclusion: topic.inclusion.join("\n"), exclusion: topic.exclusion.join("\n"),
  positive_examples: topic.positive_examples.join("\n"), negative_examples: topic.negative_examples.join("\n") }; }
function editorPayload(editor: Editor) { const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return { label: editor.label.trim(), definition: editor.definition.trim(), scope: editor.scope,
    inclusion: lines(editor.inclusion), exclusion: lines(editor.exclusion),
    positive_examples: lines(editor.positive_examples), negative_examples: lines(editor.negative_examples) }; }
function topicPayload(topic: Topic) { return { label: topic.label, definition: topic.definition,
  scope: topic.scope, inclusion: topic.inclusion, exclusion: topic.exclusion,
  positive_examples: topic.positive_examples, negative_examples: topic.negative_examples }; }
function semanticEditorPayload(editor: Editor) { const payload = editorPayload(editor); return {
  definition: payload.definition, scope: payload.scope, inclusion: payload.inclusion,
  exclusion: payload.exclusion, positive_examples: payload.positive_examples,
  negative_examples: payload.negative_examples
}; }
function semanticTopicPayload(topic: Topic) { return { definition: topic.definition, scope: topic.scope,
  inclusion: topic.inclusion, exclusion: topic.exclusion, positive_examples: topic.positive_examples,
  negative_examples: topic.negative_examples }; }
async function deterministicKey(prefix: string, value: unknown) {
  const bytes = new TextEncoder().encode(`${prefix}:${stableClientJson(value)}`);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((item) => item.toString(16).padStart(2, "0")).join("");
  return `topic-ui:${prefix}:${digest}`;
}
function stableClientJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableClientJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, item]) => `${JSON.stringify(name)}:${stableClientJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function formatMicroUsd(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD",
    minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(value / 1_000_000);
}
async function jsonRequest(url: string, method: string, body: unknown, idempotency: string | null,
  extraHeaders: Record<string, string> = {}) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json",
    ...(idempotency ? { "Idempotency-Key": idempotency } : {}), ...extraHeaders }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) throw new TopicRequestError(payload.error ?? "unknown");
  return payload;
}
class TopicRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}
function requestErrorMessage(t: ReturnType<typeof useTranslations>, error: unknown) {
  if (!(error instanceof TopicRequestError)) return t("errors.command");
  const known: Record<string, string> = {
    topic_catalog_busy: "busy",
    topic_population_not_available: "population",
    topic_population_watermark_missing: "population",
    topic_search_result_not_ready: "searchNotReady",
    topic_revision_conflict: "revision",
    topic_queue_unavailable: "queue",
    topic_catalog_forbidden: "forbidden",
    forbidden: "forbidden",
    topic_not_found: "notFound",
    topic_candidate_definition_invalid: "invalidCandidate",
    topic_embedding_cost_confirmation_required: "costConfirmation",
    topic_embedding_hard_cap_exceeded: "costExceeded",
    topic_signal_scope_unsupported: "scopeUnsupported",
    topic_embedding_preflight_failed: "preflight"
  };
  return t(`requestErrors.${known[error.code] ?? "unknown"}`);
}
function statusTone(status: Topic["status"]): "good" | "warning" | "danger" | "not_available" {
  if (status === "in_signal" || status === "ready") return "good";
  if (status === "failed") return "danger";
  if (status === "searching" || status === "updating") return "warning";
  return "not_available";
}
function executionErrorMessage(t: ReturnType<typeof useTranslations>, code: string | null) {
  if (code === "topic_mention_embeddings_incomplete" || code === "topic_definition_embedding_unavailable"
    || code === "topic_embedding_hard_cap_missing" || code === "topic_embedding_hard_cap_invalid"
    || code === "topic_embedding_outcome_unknown" || code === "topic_embedding_cost_confirmation_required"
    || code === "topic_embedding_hard_cap_exceeded" || code === "topic_embedding_pricing_changed"
    || code === "topic_embedding_estimate_changed" || code === "topic_definition_changed"
    || code === "topic_corrections_changed" || code === "topic_population_changed"
    || code === "topic_publication_source_is_incomplete"
    || code === "topic_signal_scope_unsupported"
    || code === "topic_queue_unavailable") {
    return t(`executionErrors.${code}`);
  }
  return t("executionErrors.unknown");
}
