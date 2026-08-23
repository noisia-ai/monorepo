"use client";

import {
  ArrowClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Funnel,
  MagicWand,
  PencilSimple,
  TreeStructure,
  Warning,
  X
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminFeedbackState,
  AdminResourceSection,
  AdminStatus,
  AdminSummaryStrip,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceConfirmDialog, WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";

type Counts = { pending: number; approved: number; rejected: number };
type Lifecycle = "draft" | "published";
type Disposition = "pending" | "approved" | "rejected";

type ContextElement = {
  element_key: string;
  element_version: number;
  element_kind: string;
  canonical_key: string;
  display_text: string;
  scope: string | null;
  entity_type: string | null;
  locale: string | null;
  relation_kind: string | null;
  relation_target_key: string | null;
  disposition: Disposition;
  origin: string;
  provenance: { proposed_at: string; decided_at: string | null };
  source_refs: Array<{ source_type: string; relation_type: string }>;
  source_ref_count: number;
};

type Generation = {
  generation_key: string;
  generation_version: number;
  lifecycle_state: Lifecycle;
  semantic_context_pack_digest: string | null;
  counts: Counts;
  primary_locale: string;
  locale_variants: string[];
  markets: string[];
  timezone: string;
  created_at: string;
  published_at: string | null;
};

type Readiness = {
  lifecycle_state: Lifecycle | "missing";
  generation: Generation | null;
  open_draft: Generation | null;
  counts: Counts;
  locale_coverage: { primary_locale: string | null; locale_variants: string[]; markets: string[] };
  drift_state: "current" | "stale" | "missing";
  drift_reasons: string[];
  ready_for_context_aware_discovery: boolean;
  limitations: string[];
};

type GenerationResponse = {
  generation: Generation | null;
  elements: ContextElement[];
  source_authority: unknown;
};

type Preflight = {
  generation_key: string;
  provider: { key: string; model: string; model_version: string; pricing_version: string };
  maximum_provider_calls: 1;
  maximum_proposals: number;
  estimated_input_tokens_upper_bound: number;
  max_output_tokens: number;
  estimated_max_cost_micro_usd: string;
  platform_hard_cap_micro_usd: string;
  runtime: { queue_configured: boolean; worker_alive: boolean; recovery_alive: boolean };
  drift: { state?: string; reasons?: string[] };
  readiness: "ready" | "blocked";
  blockers: string[];
  writes_performed: false;
  provider_calls: 0;
  preflight_digest: string;
};

type ProposalRun = {
  run_key: string;
  status: "queued" | "processing" | "validating" | "completed" | "failed" | "stale" | "dead_letter";
  progress: number | null;
  generation_ref: string;
  provider: { key: string; model: string; model_version: string; pricing_version: string };
  budget: { hard_cap_micro_usd: string; reservation_micro_usd: string; settled_micro_usd: string | null };
  provider_call_count: number;
  proposal_count: number;
  error: { code: string; message: string } | null;
};

type DrawerState = { mode: "generate" } | { mode: "element"; elementKey: string } | null;

const terminalRunStates = new Set<ProposalRun["status"]>(["completed", "failed", "stale", "dead_letter"]);

function idempotencyKey(action: string) {
  return `semantic-context:${action}:${crypto.randomUUID()}`;
}

function microUsd(value: string | null | undefined) {
  if (!value || !/^\d+$/u.test(value)) return "USD —";
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const decimal = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `USD ${whole.toString()}${decimal ? `.${decimal}` : ""}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as ({ error?: string; message?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? "request_failed");
  return payload as T;
}

export function SemanticContextPackManager({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("AdminWorkspace.brandOs.semanticContext");
  const common = useTranslations("Common");
  const locale = useLocale();
  const base = `/api/data-os/signal/${workspaceId}/semantic-context`;
  const runStorageKey = `noisia:semantic-context-run:${workspaceId}`;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [elements, setElements] = useState<ContextElement[]>([]);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [run, setRun] = useState<ProposalRun | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [budgetConfirmed, setBudgetConfirmed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Disposition | "all">("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const nextReadiness = await requestJson<Readiness>(`${base}/readiness`);
      setReadiness(nextReadiness);
      const key = nextReadiness.open_draft?.generation_key ?? nextReadiness.generation?.generation_key;
      if (!key) {
        setGeneration(null);
        setElements([]);
        return;
      }
      const detail = await requestJson<GenerationResponse>(`${base}?generation_key=${encodeURIComponent(key)}`);
      setGeneration(detail.generation);
      setElements(detail.elements ?? []);
      setSelected((current) => current.filter((item) => detail.elements?.some((element) => element.element_key === item && element.disposition === "pending")));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setInitialLoading(false);
    }
  }, [base, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(runStorageKey);
    if (!saved) return;
    void requestJson<ProposalRun>(`${base}/proposals/${encodeURIComponent(saved)}`)
      .then(setRun)
      .catch(() => window.sessionStorage.removeItem(runStorageKey));
  }, [base, runStorageKey]);

  useEffect(() => {
    if (!run || terminalRunStates.has(run.status)) {
      if (run?.status === "completed") {
        window.sessionStorage.removeItem(runStorageKey);
        void load();
      }
      return;
    }
    const timer = window.setTimeout(() => {
      void requestJson<ProposalRun>(`${base}/proposals/${encodeURIComponent(run.run_key)}`)
        .then(setRun)
        .catch((runError) => setError(runError instanceof Error ? runError.message : t("errors.run")));
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [base, load, run, runStorageKey, t]);

  const kinds = useMemo(() => Array.from(new Set(elements.map((element) => element.element_kind))).sort(), [elements]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return elements.filter((element) => {
      if (statusFilter !== "all" && element.disposition !== statusFilter) return false;
      if (kindFilter !== "all" && element.element_kind !== kindFilter) return false;
      return !normalized || `${element.display_text} ${element.canonical_key}`.toLocaleLowerCase(locale).includes(normalized);
    });
  }, [elements, kindFilter, locale, query, statusFilter]);
  const activeElement = drawer?.mode === "element" ? elements.find((element) => element.element_key === drawer.elementKey) ?? null : null;
  const pendingVisible = filtered.filter((element) => element.disposition === "pending");
  const allVisibleSelected = pendingVisible.length > 0 && pendingVisible.every((element) => selected.includes(element.element_key));
  const counts = generation?.counts ?? { pending: 0, approved: 0, rejected: 0 };
  const canPublish = generation?.lifecycle_state === "draft" && counts.pending === 0 && counts.approved > 0 && readiness?.drift_state === "current";

  async function createDraft() {
    setBusy("draft"); setError(null);
    try {
      await requestJson(base, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("draft") }, body: JSON.stringify({ action: "create_draft" }) });
      await load();
    } catch (draftError) { setError(draftError instanceof Error ? draftError.message : t("errors.draft")); }
    finally { setBusy(null); }
  }

  async function reconcileContext() {
    const driftReason = readiness?.drift_reasons.find((reason) =>
      ["brand_os_drift", "knowledge_drift", "locale_market_drift"].includes(reason));
    const reason = driftReason
      ?? (preflight?.blockers.includes("provider_lineage_required") ? "provider_lineage_missing"
        : preflight?.blockers.includes("provider_lineage_drift") ? "provider_lineage_changed"
          : "operator_requested_reconciliation");
    setBusy("reconcile"); setError(null);
    try {
      await requestJson(`${base}/reconcile`, { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("reconcile")
      }, body: JSON.stringify({ reason }) });
      setDrawer(null); setPreflight(null); await load();
    } catch (reconcileError) {
      setError(reconcileError instanceof Error ? reconcileError.message : t("errors.reconcile"));
    } finally { setBusy(null); }
  }

  async function loadPreflight() {
    setBusy("preflight"); setError(null); setBudgetConfirmed(false);
    try { setPreflight(await requestJson<Preflight>(`${base}/preflight`)); setDrawer({ mode: "generate" }); }
    catch (preflightError) { setError(preflightError instanceof Error ? preflightError.message : t("errors.preflight")); }
    finally { setBusy(null); }
  }

  async function startProposalRun() {
    if (!preflight || !generation) return;
    setBusy("generate"); setError(null);
    try {
      const nextRun = await requestJson<ProposalRun>(`${base}/proposals`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("generate") }, body: JSON.stringify({ generation_key: generation.generation_key, preflight_digest: preflight.preflight_digest, confirmation: "GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS", hard_cap_micro_usd: preflight.estimated_max_cost_micro_usd }) });
      setRun(nextRun); window.sessionStorage.setItem(runStorageKey, nextRun.run_key); setDrawer(null);
    } catch (runError) { setError(runError instanceof Error ? runError.message : t("errors.generate")); }
    finally { setBusy(null); }
  }

  async function retryProposalRun() {
    if (!run || run.status !== "failed") return;
    setBusy("retry-run"); setError(null);
    try {
      const nextRun = await requestJson<ProposalRun>(`${base}/proposals/${encodeURIComponent(run.run_key)}/retry`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("retry-run") }, body: "{}" });
      setRun(nextRun); window.sessionStorage.setItem(runStorageKey, nextRun.run_key);
    } catch (retryError) { setError(retryError instanceof Error ? retryError.message : t("errors.run")); }
    finally { setBusy(null); }
  }

  async function decide(action: "approve" | "reject", elementKey: string) {
    if (!generation) return;
    setBusy(`${action}:${elementKey}`); setError(null);
    try {
      await requestJson(`${base}/decisions`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey(action) }, body: JSON.stringify({ action, generation_key: generation.generation_key, element_key: elementKey }) });
      setDrawer(null); await load();
    } catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : t("errors.decision")); }
    finally { setBusy(null); }
  }

  async function saveEdit(formData: FormData) {
    if (!generation || !activeElement) return;
    setBusy(`edit:${activeElement.element_key}`); setError(null);
    try {
      const relation = String(formData.get("relation_kind") ?? "").trim();
      const target = String(formData.get("relation_target_key") ?? "").trim();
      await requestJson(`${base}/decisions`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("edit") }, body: JSON.stringify({ action: "edit", generation_key: generation.generation_key, element_key: activeElement.element_key, edit: { canonical_key: String(formData.get("canonical_key") ?? "").trim(), display_text: String(formData.get("display_text") ?? "").trim(), locale: String(formData.get("locale") ?? "").trim() || null, relation_kind: relation || null, relation_target_key: target || null } }) });
      setDrawer(null); await load();
    } catch (editError) { setError(editError instanceof Error ? editError.message : t("errors.edit")); }
    finally { setBusy(null); }
  }

  async function bulkApprove() {
    if (!generation || selected.length === 0) return;
    setBusy("bulk"); setError(null);
    try {
      await requestJson(`${base}/decisions`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("bulk") }, body: JSON.stringify({ action: "bulk_approve", generation_key: generation.generation_key, element_keys: selected.slice(0, 100) }) });
      setSelected([]); await load();
    } catch (bulkError) { setError(bulkError instanceof Error ? bulkError.message : t("errors.decision")); }
    finally { setBusy(null); }
  }

  async function publish() {
    if (!generation) return;
    setBusy("publish"); setError(null);
    try {
      await requestJson(`${base}/publish`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("publish") }, body: JSON.stringify({ generation_key: generation.generation_key, confirmation: "publish_reviewed_semantic_context" }) });
      setPublishOpen(false); await load();
    } catch (publishError) { setError(publishError instanceof Error ? publishError.message : t("errors.publish")); }
    finally { setBusy(null); }
  }

  function toggleVisible() {
    const keys = pendingVisible.slice(0, 100).map((element) => element.element_key);
    setSelected(allVisibleSelected ? selected.filter((key) => !keys.includes(key)) : Array.from(new Set([...selected, ...keys])).slice(0, 100));
  }

  const sectionActions = <>
    <button className="admin-button" disabled={Boolean(busy)} onClick={() => void load()} type="button"><ArrowClockwise aria-hidden size={14}/>{t("actions.refresh")}</button>
    {generation?.lifecycle_state === "draft" && elements.length === 0 ? <button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={() => void loadPreflight()} type="button"><MagicWand aria-hidden size={15}/>{t("actions.generate")}</button> : null}
  </>;

  return <>
    <AdminResourceSection actions={sectionActions} className="semantic-context-pack" subtitle={t("subtitle")} title={t("title")}>
      {initialLoading ? <ContextSkeleton/> : null}
      {!initialLoading && error && !generation ? <AdminFeedbackState actions={<button className="admin-button" onClick={() => void load()} type="button">{t("actions.retry")}</button>} body={error} icon={<Warning size={20}/>} title={t("errors.title")} tone="danger"/> : null}
      {!initialLoading && !error && !generation ? <AdminFeedbackState actions={<button className="admin-button admin-button--primary" disabled={busy === "draft"} onClick={() => void createDraft()} type="button">{busy === "draft" ? t("actions.preparing") : t("actions.prepare")}</button>} body={t("empty.body")} icon={<TreeStructure size={21}/>} title={t("empty.title")}/> : null}
      {!initialLoading && generation ? <>
        <AdminSummaryStrip density="compact" items={[
          { label: t("summary.state"), value: t(`states.${generation.lifecycle_state}`), hint: t("summary.version", { version: generation.generation_version }) },
          { label: t("summary.pending"), value: formatAdminNumber(counts.pending, locale), hint: t("summary.pendingHint") },
          { label: t("summary.approved"), value: formatAdminNumber(counts.approved, locale), hint: t("summary.approvedHint") },
          { label: t("summary.coverage"), value: generation.primary_locale, hint: t("summary.markets", { count: generation.markets.length }) }
        ]}/>
        {readiness?.drift_state === "stale" ? <div className="semantic-context-pack__notice" data-tone="warning"><Warning aria-hidden size={18}/><div><strong>{t("drift.title")}</strong><p>{t("drift.body")}</p><button className="admin-button" disabled={Boolean(busy)} onClick={() => void reconcileContext()} type="button">{busy === "reconcile" ? t("actions.reconciling") : t("actions.reconcile")}</button></div></div> : null}
        {error ? <div className="semantic-context-pack__notice" data-tone="danger" role="alert"><Warning aria-hidden size={18}/><div><strong>{t("errors.title")}</strong><p>{error}</p></div></div> : null}
        {run ? <RunBanner busy={busy === "retry-run"} onRetry={() => void retryProposalRun()} run={run} t={t}/>:null}
        {generation.lifecycle_state === "draft" && elements.length === 0 && !run ? <div className="semantic-context-pack__empty"><MagicWand aria-hidden size={24}/><div><strong>{t("draftEmpty.title")}</strong><p>{t("draftEmpty.body")}</p></div><button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={() => void loadPreflight()} type="button">{t("actions.calculate")}</button></div> : null}
        {elements.length > 0 ? <div className="semantic-context-pack__workspace">
          <div className="semantic-context-pack__toolbar">
            <label className="semantic-context-pack__search"><span className="sr-only">{t("filters.search")}</span><input className="workspace-control" onChange={(event) => setQuery(event.target.value)} placeholder={t("filters.searchPlaceholder")} type="search" value={query}/></label>
            <label><span className="sr-only">{t("filters.status")}</span><select className="workspace-control" onChange={(event) => setStatusFilter(event.target.value as Disposition | "all")} value={statusFilter}><option value="all">{t("filters.allStatuses")}</option><option value="pending">{t("states.pending")}</option><option value="approved">{t("states.approved")}</option><option value="rejected">{t("states.rejected")}</option></select></label>
            <label><span className="sr-only">{t("filters.type")}</span><select className="workspace-control" onChange={(event) => setKindFilter(event.target.value)} value={kindFilter}><option value="all">{t("filters.allTypes")}</option>{kinds.map((kind) => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}</select></label>
            <span className="semantic-context-pack__result-count"><Funnel aria-hidden size={14}/>{t("filters.results", { count: filtered.length })}</span>
          </div>
          {selected.length ? <div className="semantic-context-pack__selection"><strong>{t("selection.count", { count: selected.length })}</strong><button className="admin-button admin-button--primary" disabled={busy === "bulk"} onClick={() => void bulkApprove()} type="button"><Check aria-hidden size={14}/>{t("selection.approve")}</button><button className="admin-button admin-button--plain" onClick={() => setSelected([])} type="button">{t("selection.clear")}</button></div> : null}
          <div className="admin-table-wrap semantic-context-pack__table-wrap"><table className="admin-table semantic-context-pack__table"><thead><tr><th className="semantic-context-pack__check"><input aria-label={t("selection.allVisible")} checked={allVisibleSelected} disabled={pendingVisible.length === 0} onChange={toggleVisible} type="checkbox"/></th><th>{t("columns.element")}</th><th>{t("columns.type")}</th><th>{t("columns.context")}</th><th>{t("columns.evidence")}</th><th>{t("columns.status")}</th><th><span className="sr-only">{t("columns.actions")}</span></th></tr></thead><tbody>{filtered.map((element) => <tr key={element.element_key}><td className="semantic-context-pack__check"><input aria-label={t("selection.one", { name: element.display_text })} checked={selected.includes(element.element_key)} disabled={element.disposition !== "pending"} onChange={() => setSelected((current) => current.includes(element.element_key) ? current.filter((key) => key !== element.element_key) : [...current, element.element_key].slice(0, 100))} type="checkbox"/></td><td><button className="semantic-context-pack__element-button" onClick={() => setDrawer({ mode: "element", elementKey: element.element_key })} type="button"><strong>{element.display_text}</strong><small>{element.canonical_key}</small></button></td><td>{t(`kinds.${element.element_kind}`)}</td><td><div className="admin-table__primary"><strong>{element.locale ?? t("values.noLocale")}</strong><small>{element.scope ?? t("values.workspaceScope")}</small></div></td><td>{t("values.evidenceCount", { count: element.source_ref_count })}</td><td><AdminStatus state={element.disposition === "approved" ? "good" : element.disposition === "rejected" ? "danger" : "warning"}>{t(`states.${element.disposition}`)}</AdminStatus></td><td><button className="admin-button admin-button--plain" onClick={() => setDrawer({ mode: "element", elementKey: element.element_key })} type="button">{t("actions.review")}</button></td></tr>)}{filtered.length === 0 ? <tr><td colSpan={7}><div className="admin-empty"><strong>{t("filters.emptyTitle")}</strong><p>{t("filters.emptyBody")}</p></div></td></tr> : null}</tbody></table></div>
          <div className="semantic-context-pack__footer"><p>{generation.lifecycle_state === "draft" ? t("publish.explainer") : t("publish.publishedAt", { date: formatAdminDate(generation.published_at, locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>{generation.lifecycle_state === "draft" ? <button className="admin-button admin-button--primary" disabled={!canPublish || Boolean(busy)} onClick={() => setPublishOpen(true)} type="button"><CheckCircle aria-hidden size={15}/>{t("actions.publish")}</button> : <AdminStatus state="good">{t("states.published")}</AdminStatus>}</div>
        </div> : null}
      </> : null}
    </AdminResourceSection>

    {drawer?.mode === "generate" && preflight ? <WorkspaceDrawer ariaLabel={t("generation.title")} closeLabel={common("actions.close")} eyebrow={t("eyebrow")} onClose={() => !busy && setDrawer(null)} title={t("generation.title")}><div className="admin-drawer-form"><p className="admin-drawer-form__intro">{t("generation.body")}</p><div className="semantic-context-pack__preflight"><PreflightRow label={t("generation.model")} value={preflight.provider.model}/><PreflightRow label={t("generation.calls")} value={String(preflight.maximum_provider_calls)}/><PreflightRow label={t("generation.proposalLimit")} value={String(preflight.maximum_proposals)}/><PreflightRow label={t("generation.estimate")} value={microUsd(preflight.estimated_max_cost_micro_usd)}/><PreflightRow label={t("generation.platformCap")} value={microUsd(preflight.platform_hard_cap_micro_usd)}/><PreflightRow label={t("generation.runtime")} value={preflight.runtime.queue_configured && preflight.runtime.worker_alive && preflight.runtime.recovery_alive ? t("generation.runtimeReady") : t("generation.runtimeBlocked")}/></div>{preflight.blockers.length ? <div className="semantic-context-pack__notice" data-tone="warning"><Warning aria-hidden size={18}/><div><strong>{t("generation.blocked")}</strong>{preflight.blockers.map((blocker) => <p key={blocker}>{blockerLabel(blocker, t)}</p>)}{preflight.blockers.some((blocker) => ["provider_lineage_required", "provider_lineage_drift", "semantic_context_draft_stale"].includes(blocker)) ? <button className="admin-button" disabled={Boolean(busy)} onClick={() => void reconcileContext()} type="button">{busy === "reconcile" ? t("actions.reconciling") : t("actions.reconcile")}</button> : null}</div></div> : null}<label className="semantic-context-pack__confirmation"><input checked={budgetConfirmed} onChange={(event) => setBudgetConfirmed(event.target.checked)} type="checkbox"/><span>{t("generation.confirmation", { estimate: microUsd(preflight.estimated_max_cost_micro_usd) })}</span></label>{error ? <p className="workspace-form__error" role="alert">{error}</p> : null}<button className="admin-button admin-button--primary" disabled={preflight.readiness !== "ready" || !budgetConfirmed || busy === "generate"} onClick={() => void startProposalRun()} type="button">{busy === "generate" ? <CircleNotch aria-hidden className="workspace-shell__nav-pending" size={15}/> : <MagicWand aria-hidden size={15}/>} {t("actions.confirmGenerate")}</button></div></WorkspaceDrawer> : null}

    {drawer?.mode === "element" && activeElement ? <WorkspaceDrawer ariaLabel={t("review.aria", { name: activeElement.display_text })} closeLabel={common("actions.close")} eyebrow={`${t(`kinds.${activeElement.element_kind}`)} · ${t(`states.${activeElement.disposition}`)}`} onClose={() => !busy && setDrawer(null)} title={activeElement.display_text}><ElementReview element={activeElement} generation={generation} busy={busy} onApprove={() => void decide("approve", activeElement.element_key)} onEdit={(form) => void saveEdit(form)} onReject={() => void decide("reject", activeElement.element_key)} t={t}/></WorkspaceDrawer> : null}

    <WorkspaceConfirmDialog busy={busy === "publish"} cancelLabel={common("actions.cancel")} confirmDisabled={!canPublish} confirmLabel={t("publish.confirm")} message={t("publish.message", { approved: counts.approved })} onClose={() => setPublishOpen(false)} onConfirm={publish} open={publishOpen} title={t("publish.title")}><div className="semantic-context-pack__publish-summary"><CheckCircle aria-hidden size={20}/><p>{t("publish.body")}</p></div></WorkspaceConfirmDialog>
  </>;
}

function ContextSkeleton() { return <div aria-hidden className="semantic-context-pack__skeleton"><span/><span/><span/><div><span/><span/><span/></div></div>; }

function PreflightRow({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function RunBanner({ busy, onRetry, run, t }: { busy: boolean; onRetry: () => void; run: ProposalRun; t: ReturnType<typeof useTranslations> }) {
  const tone = run.status === "completed" ? "good" : run.status === "failed" || run.status === "dead_letter" ? "danger" : run.status === "stale" ? "warning" : "not_available";
  const retryAllowed = run.status === "failed" && run.provider_call_count === 0;
  const detail = terminalRunStates.has(run.status)
    ? run.status === "completed"
      ? t("run.completedDetail")
      : run.status === "stale"
        ? t("run.staleDetail")
        : run.status === "dead_letter"
          ? t("run.deadLetterDetail")
          : run.provider_call_count > 0
            ? run.error?.code === "semantic_context_provider_response_truncated"
              ? t("run.truncatedDetail")
              : t("run.validationFailedDetail")
            : t("run.retryableFailedDetail")
    : t("run.progress", { progress: run.progress ?? 0 });
  return <div className="semantic-context-pack__run" role={run.status === "failed" || run.status === "dead_letter" ? "alert" : "status"}><div className="semantic-context-pack__run-copy"><span className="semantic-context-pack__run-icon">{terminalRunStates.has(run.status) ? run.status === "completed" ? <Check aria-hidden size={16}/> : <Warning aria-hidden size={16}/> : <CircleNotch aria-hidden className="icon--spin" size={16}/>}</span><div><strong>{t(`run.${run.status}`)}</strong><p>{detail}</p></div></div><div className="semantic-context-pack__run-actions"><AdminStatus state={tone}>{run.status === "completed" ? t("run.proposals", { count: run.proposal_count }) : t(`run.badges.${run.status}`)}</AdminStatus>{retryAllowed ? <button className="admin-button admin-button--compact" disabled={busy} onClick={onRetry} type="button"><ArrowClockwise aria-hidden size={14}/>{t("actions.retrySafe")}</button> : null}</div></div>;
}

function ElementReview({ element, generation, busy, onApprove, onEdit, onReject, t }: { element: ContextElement; generation: Generation | null; busy: string | null; onApprove: () => void; onEdit: (form: FormData) => void; onReject: () => void; t: ReturnType<typeof useTranslations> }) {
  const [editing, setEditing] = useState(false);
  return <div className="semantic-context-pack__review"><div className="semantic-context-pack__review-summary"><AdminStatus state={element.disposition === "approved" ? "good" : element.disposition === "rejected" ? "danger" : "warning"}>{t(`states.${element.disposition}`)}</AdminStatus><p>{t("review.proposedAt", { date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(element.provenance.proposed_at)) })}</p></div>{editing ? <form className="admin-drawer-form" onSubmit={(event) => { event.preventDefault(); onEdit(new FormData(event.currentTarget)); }}><label className="workspace-field"><span>{t("fields.displayText")}</span><input className="workspace-control" defaultValue={element.display_text} maxLength={500} name="display_text" required/></label><label className="workspace-field"><span>{t("fields.canonicalKey")}</span><input className="workspace-control" defaultValue={element.canonical_key} name="canonical_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*" required/></label><label className="workspace-field"><span>{t("fields.locale")}</span><input className="workspace-control" defaultValue={element.locale ?? ""} name="locale" placeholder="es-MX"/></label><label className="workspace-field"><span>{t("fields.relation")}</span><select className="workspace-control" defaultValue={element.relation_kind ?? ""} name="relation_kind"><option value="">{t("values.noRelation")}</option>{["is_a", "part_of", "surface_of", "competes_with", "associated_with"].map((kind) => <option key={kind} value={kind}>{t(`relations.${kind}`)}</option>)}</select></label><label className="workspace-field"><span>{t("fields.relationTarget")}</span><input className="workspace-control" defaultValue={element.relation_target_key ?? ""} name="relation_target_key"/></label><div className="semantic-context-pack__drawer-actions"><button className="admin-button" disabled={Boolean(busy)} onClick={() => setEditing(false)} type="button">{t("actions.cancelEdit")}</button><button className="admin-button admin-button--primary" disabled={Boolean(busy)} type="submit"><PencilSimple aria-hidden size={14}/>{t("actions.saveCorrection")}</button></div></form> : <><dl className="semantic-context-pack__definition"><div><dt>{t("fields.canonicalKey")}</dt><dd>{element.canonical_key}</dd></div><div><dt>{t("fields.locale")}</dt><dd>{element.locale ?? t("values.noLocale")}</dd></div><div><dt>{t("fields.scope")}</dt><dd>{element.scope ?? t("values.workspaceScope")}</dd></div><div><dt>{t("fields.relation")}</dt><dd>{element.relation_kind ? `${t(`relations.${element.relation_kind}`)}${element.relation_target_key ? ` → ${element.relation_target_key}` : ""}` : t("values.noRelation")}</dd></div><div><dt>{t("fields.origin")}</dt><dd>{originLabel(element.origin, t)}</dd></div><div><dt>{t("fields.generation")}</dt><dd>{generation ? t("summary.version", { version: generation.generation_version }) : "—"}</dd></div></dl><section className="semantic-context-pack__evidence"><h3>{t("review.evidenceTitle")}</h3><p>{t("review.evidenceBody")}</p>{element.source_refs.length ? <ul>{element.source_refs.map((ref, index) => <li key={`${ref.source_type}-${ref.relation_type}-${index}`}><strong>{sourceLabel(ref.source_type, t)}</strong><span>{evidenceRelationLabel(ref.relation_type, t)}</span></li>)}</ul> : <p>{t("review.noEvidence")}</p>}</section>{element.disposition === "pending" ? <div className="semantic-context-pack__drawer-actions"><button className="admin-button admin-button--danger" disabled={Boolean(busy)} onClick={onReject} type="button"><X aria-hidden size={14}/>{t("actions.reject")}</button><button className="admin-button" disabled={Boolean(busy)} onClick={() => setEditing(true)} type="button"><PencilSimple aria-hidden size={14}/>{t("actions.edit")}</button><button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={onApprove} type="button"><Check aria-hidden size={14}/>{t("actions.approve")}</button></div> : null}</>}</div>;
}

function blockerLabel(value: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["semantic_context_draft_required", "provider_lineage_required", "provider_lineage_drift", "semantic_context_draft_stale", "provider_configuration_unavailable", "proposal_queue_unavailable", "proposal_worker_unavailable", "proposal_recovery_unavailable", "semantic_context_input_token_budget_exceeded", "platform_hard_cap_insufficient", "hard_cap_insufficient"]);
  return known.has(value) ? t(`blockers.${value}`) : t("blockers.unknown");
}
function originLabel(value: string, t: ReturnType<typeof useTranslations>) {
  if (value === "provider_proposal") return t("origins.provider_proposal");
  if (value === "operator_correction") return t("origins.operator_correction");
  if (value === "operator_decision") return t("origins.operator_decision");
  return t("origins.other");
}
function sourceLabel(value: string, t: ReturnType<typeof useTranslations>) {
  if (value === "brand_os_profile") return t("sources.brand_os_profile");
  if (value === "brand_os_product") return t("sources.brand_os_product");
  if (value === "brand_os_competitor") return t("sources.brand_os_competitor");
  if (value === "brand_os_seed_term") return t("sources.brand_os_seed_term");
  if (value === "knowledge_source") return t("sources.knowledge_source");
  if (value === "knowledge_chunk") return t("sources.knowledge_chunk");
  if (value === "knowledge_assertion") return t("sources.knowledge_assertion");
  return t("sources.authority");
}
function evidenceRelationLabel(value: string, t: ReturnType<typeof useTranslations>) {
  if (value === "supports") return t("evidenceRelations.supports");
  if (value === "limits") return t("evidenceRelations.limits");
  if (value === "contradicts") return t("evidenceRelations.contradicts");
  return t("evidenceRelations.supports");
}
