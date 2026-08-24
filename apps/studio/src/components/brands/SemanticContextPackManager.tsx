"use client";

import {
  ArrowClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  MagicWand,
  TreeStructure,
  Warning
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AdminFeedbackState,
  AdminResourceSection,
  AdminStatus,
  AdminSummaryStrip,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceConfirmDialog, WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import { SemanticContextReviewWorkbench } from "@/components/brands/SemanticContextReviewWorkbench";
import {
  canPrepareSignalSemanticContextTerminalSuccessorV1,
  canStartSignalSemanticContextProposalGenerationV1,
  isSignalSemanticContextRunSessionCurrentV1,
  parseSignalSemanticContextRunSessionReferenceV1,
  signalSemanticContextRejectedRevalidationCountValuesV1,
  serializeSignalSemanticContextRunSessionReferenceV1
} from "@/lib/data-os/signal-semantic-context-run-session";

type Counts = { pending: number; approved: number; rejected: number };
type Lifecycle = "draft" | "published";

type Generation = {
  generation_key: string;
  generation_version: number;
  lifecycle_state: Lifecycle;
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
  open_draft: { generation_key: string; generation_version: number; counts: Counts } | null;
  counts: Counts;
  locale_coverage: { primary_locale: string | null; locale_variants: string[]; markets: string[] };
  drift_state: "current" | "stale" | "missing";
  drift_reasons: string[];
  ready_for_context_aware_discovery: boolean;
  limitations: string[];
};

type ReviewSummaryResponse = {
  readiness: Readiness;
  generation: Generation | null;
  latest_proposal_run: ProposalRun | null;
};

type Preflight = {
  generation_key: string;
  provider: {
    key: string;
    model: string;
    model_version: string;
    pricing_version: string;
    pricing_unit: "usd_per_million_tokens";
    input_usd_per_million_tokens: string;
    output_usd_per_million_tokens: string;
  };
  maximum_provider_calls: 1;
  maximum_proposals: number;
  capacity: {
    minimum_useful_proposals: number;
    target_proposals: number;
    maximum_proposals: number;
    output_token_budget: number;
    counts: {
      aliases: number;
      products: number;
      competitors: number;
      locale_variants: number;
      markets: number;
      structured_terms: number;
      knowledge_blocks: number;
      evidence_source_kinds: number;
    };
  } | null;
  estimated_input_tokens_upper_bound: number | null;
  max_output_tokens: number | null;
  estimated_max_cost_micro_usd: string;
  recommended_hard_cap_micro_usd: string;
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
  provider: { key: string; model: string; model_version: string; pricing_version: string };
  budget: { hard_cap_micro_usd: string; reservation_micro_usd: string; settled_micro_usd: string | null };
  provider_call_count: number;
  proposal_count: number;
  error: { code: string; message: string } | null;
  paid_response_revalidation: {
    status: "completed" | "rejected";
    proposal_count_before: number;
    normalized_proposal_count: number;
    proposals_appended: number;
    proposals_pending: number;
    proposals_approved: 0;
    provider_calls_added: 0;
    additional_cost_micro_usd: "0";
    error: { code: string; message: string } | null;
    recorded_at: string;
  } | null;
};

type GenerationBoundRun = {
  generationKey: string;
  value: ProposalRun;
};

type DrawerState = { mode: "generate" } | null;

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

export function formatSignalSemanticContextUsdPerMillionTokensV1(value: string, locale: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "USD —";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(amount);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as ({ error?: string; message?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? "request_failed");
  return payload as T;
}

export function SemanticContextPackManager({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("AdminWorkspace.brandOs.semanticContext");
  const locale = useLocale();
  const base = `/api/data-os/signal/${workspaceId}/semantic-context`;
  const runStorageKey = `noisia:semantic-context-run:${workspaceId}`;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [boundRun, setBoundRun] = useState<GenerationBoundRun | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [terminalSuccessorOpen, setTerminalSuccessorOpen] = useState(false);
  const [budgetConfirmed, setBudgetConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const preflightOpenerRef = useRef<HTMLButtonElement | null>(null);
  const activeGenerationKey = generation?.generation_key ?? null;
  const run = boundRun?.generationKey === activeGenerationKey ? boundRun.value : null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const summary = await requestJson<ReviewSummaryResponse>(`${base}/review/summary`);
      const nextReadiness = summary.readiness;
      setReadiness(nextReadiness);
      const key = summary.generation?.generation_key;
      if (!key) {
        setGeneration(null);
        setBoundRun(null);
        return;
      }
      setGeneration(summary.generation);
      setBoundRun(summary.latest_proposal_run
        ? { generationKey: key, value: summary.latest_proposal_run }
        : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setInitialLoading(false);
    }
  }, [base, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (initialLoading) return;
    const saved = parseSignalSemanticContextRunSessionReferenceV1(
      window.sessionStorage.getItem(runStorageKey)
    );
    if (!activeGenerationKey || !saved
      || !isSignalSemanticContextRunSessionCurrentV1(saved, activeGenerationKey)) {
      window.sessionStorage.removeItem(runStorageKey);
      return;
    }
    if (!run || terminalRunStates.has(run.status) || saved.run_key !== run.run_key) {
      window.sessionStorage.removeItem(runStorageKey);
    }
  }, [activeGenerationKey, initialLoading, run, runStorageKey]);

  useEffect(() => {
    if (!run || terminalRunStates.has(run.status)) {
      if (run) window.sessionStorage.removeItem(runStorageKey);
      return;
    }
    const timer = window.setTimeout(() => {
      void requestJson<ProposalRun>(`${base}/proposals/${encodeURIComponent(run.run_key)}`)
        .then((nextRun) => {
          if (activeGenerationKey) {
            setBoundRun({ generationKey: activeGenerationKey, value: nextRun });
            if (nextRun.status === "completed") void load();
          }
        })
        .catch((runError) => setError(runError instanceof Error ? runError.message : t("errors.run")));
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [activeGenerationKey, base, load, run, runStorageKey, t]);

  const counts = generation?.counts ?? { pending: 0, approved: 0, rejected: 0 };
  const elementCount = counts.pending + counts.approved + counts.rejected;
  const canPublish = generation?.lifecycle_state === "draft" && counts.pending === 0 && counts.approved > 0 && readiness?.drift_state === "current";
  const canStartProposalGeneration = canStartSignalSemanticContextProposalGenerationV1({
    lifecycleState: generation?.lifecycle_state ?? null,
    elementCount,
    hasServerDiscoveredRun: run !== null
  });
  const canPrepareTerminalSuccessor = canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: generation?.lifecycle_state ?? null,
    elementCount,
    runStatus: run?.status ?? null,
    providerCallCount: run?.provider_call_count ?? 0
  });

  async function createDraft() {
    setBusy("draft"); setError(null);
    try {
      await requestJson(base, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("draft") }, body: JSON.stringify({ action: "create_draft" }) });
      await load();
    } catch (draftError) { setError(draftError instanceof Error ? draftError.message : t("errors.draft")); }
    finally { setBusy(null); }
  }

  async function reconcileContext(reasonOverride?: "terminal_provider_run") {
    const driftReason = readiness?.drift_reasons.find((reason) =>
      ["brand_os_drift", "knowledge_drift", "locale_market_drift"].includes(reason));
    const reason = reasonOverride ?? driftReason
      ?? (preflight?.blockers.includes("provider_lineage_required") ? "provider_lineage_missing"
        : preflight?.blockers.includes("provider_lineage_drift") ? "provider_lineage_changed"
          : "operator_requested_reconciliation");
    const busyKey = reasonOverride ? "terminal-successor" : "reconcile";
    setBusy(busyKey); setError(null);
    try {
      await requestJson(`${base}/reconcile`, { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": idempotencyKey(
          reasonOverride ? "terminal-successor" : "reconcile")
      }, body: JSON.stringify({ reason }) });
      window.sessionStorage.removeItem(runStorageKey);
      setBoundRun(null); setDrawer(null); setPreflight(null); setBudgetConfirmed(false);
      setTerminalSuccessorOpen(false); await load();
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
      const nextRun = await requestJson<ProposalRun>(`${base}/proposals`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("generate") }, body: JSON.stringify({ generation_key: generation.generation_key, preflight_digest: preflight.preflight_digest, confirmation: "GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS", hard_cap_micro_usd: preflight.recommended_hard_cap_micro_usd }) });
      setBoundRun({ generationKey: generation.generation_key, value: nextRun });
      window.sessionStorage.setItem(runStorageKey,
        serializeSignalSemanticContextRunSessionReferenceV1(generation.generation_key, nextRun.run_key));
      setDrawer(null);
    } catch (runError) { setError(runError instanceof Error ? runError.message : t("errors.generate")); }
    finally { setBusy(null); }
  }

  async function retryProposalRun() {
    if (!run || run.status !== "failed" || !generation) return;
    setBusy("retry-run"); setError(null);
    try {
      const nextRun = await requestJson<ProposalRun>(`${base}/proposals/${encodeURIComponent(run.run_key)}/retry`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("retry-run") }, body: "{}" });
      setBoundRun({ generationKey: generation.generation_key, value: nextRun });
      window.sessionStorage.setItem(runStorageKey,
        serializeSignalSemanticContextRunSessionReferenceV1(generation.generation_key, nextRun.run_key));
    } catch (retryError) { setError(retryError instanceof Error ? retryError.message : t("errors.run")); }
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

  const sectionActions = <>
    <button className="admin-button" disabled={Boolean(busy)} onClick={() => void load()} type="button"><ArrowClockwise aria-hidden size={14}/>{t("actions.refresh")}</button>
    {canPrepareTerminalSuccessor ? <button className="admin-button" disabled={Boolean(busy)} onClick={() => setTerminalSuccessorOpen(true)} type="button"><TreeStructure aria-hidden size={15}/>{t("actions.prepareSuccessor")}</button> : null}
    {canStartProposalGeneration ? <button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={(event) => { preflightOpenerRef.current = event.currentTarget; void loadPreflight(); }} type="button"><MagicWand aria-hidden size={15}/>{t("actions.generate")}</button> : null}
  </>;

  return <>
    <AdminResourceSection actions={sectionActions} className="semantic-context-pack" subtitle={t("subtitle")} title={t("title")}>
      {initialLoading ? <ContextSkeleton/> : null}
      {busy === "preflight" ? <div aria-busy="true" aria-live="polite" className="semantic-context-pack__preflight-loading" role="status"><CircleNotch aria-hidden className="icon--spin" size={18}/><span>{t("generation.loadingPreflight")}</span></div> : null}
      {!initialLoading && error && !generation ? <AdminFeedbackState actions={<button className="admin-button" onClick={() => void load()} type="button">{t("actions.retry")}</button>} body={error} icon={<Warning size={20}/>} title={t("errors.title")} tone="danger"/> : null}
      {!initialLoading && !error && !generation ? <AdminFeedbackState actions={<button className="admin-button admin-button--primary" disabled={busy === "draft"} onClick={() => void createDraft()} type="button">{busy === "draft" ? t("actions.preparing") : t("actions.prepare")}</button>} body={t("empty.body")} icon={<TreeStructure size={21}/>} title={t("empty.title")}/> : null}
      {!initialLoading && generation ? <>
        <AdminSummaryStrip density="compact" items={[
          { label: t("summary.state"), value: t(`states.${generation.lifecycle_state}`), hint: t("summary.version", { version: generation.generation_version }) },
          { label: t("summary.pending"), value: formatAdminNumber(counts.pending, locale), hint: t("summary.pendingHint") },
          { label: t("summary.approved"), value: formatAdminNumber(counts.approved, locale), hint: t("summary.approvedHint") },
          { label: t("summary.coverage"), value: generation.primary_locale, hint: t("summary.markets", { count: generation.markets.length }) }
        ]}/>
        {readiness?.drift_state === "stale" ? <div className="semantic-context-pack__notice" data-tone="warning"><Warning aria-hidden size={18}/><div><strong>{t("drift.title")}</strong><p>{t("drift.body")}</p>{!run ? <button className="admin-button" disabled={Boolean(busy)} onClick={() => void reconcileContext()} type="button">{busy === "reconcile" ? t("actions.reconciling") : t("actions.reconcile")}</button> : null}</div></div> : null}
        {error ? <div className="semantic-context-pack__notice" data-tone="danger" role="alert"><Warning aria-hidden size={18}/><div><strong>{t("errors.title")}</strong><p>{error}</p></div></div> : null}
        {run ? <RunBanner busy={busy === "retry-run"} onRetry={() => void retryProposalRun()} run={run} t={t}/>:null}
        {canStartProposalGeneration ? <div className="semantic-context-pack__empty"><MagicWand aria-hidden size={24}/><div><strong>{t("draftEmpty.title")}</strong><p>{t("draftEmpty.body")}</p></div><button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={(event) => { preflightOpenerRef.current = event.currentTarget; void loadPreflight(); }} type="button">{t("actions.calculate")}</button></div> : null}
          {elementCount > 0 ? <div className="semantic-context-pack__workspace">
            <SemanticContextReviewWorkbench generationKey={generation.generation_key} key={generation.generation_key}
              onMutation={load} workspaceId={workspaceId}/>
          <div className="semantic-context-pack__footer"><p>{generation.lifecycle_state === "draft" ? t("publish.explainer") : t("publish.publishedAt", { date: formatAdminDate(generation.published_at, locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>{generation.lifecycle_state === "draft" ? <button className="admin-button admin-button--primary" disabled={!canPublish || Boolean(busy)} onClick={() => setPublishOpen(true)} type="button"><CheckCircle aria-hidden size={15}/>{t("actions.publish")}</button> : <AdminStatus state="good">{t("states.published")}</AdminStatus>}</div>
        </div> : null}
      </> : null}
    </AdminResourceSection>

    {drawer?.mode === "generate" && preflight ? <WorkspaceDrawer ariaLabel={t("generation.title")} closeLabel={t("actions.close")} eyebrow={t("eyebrow")} onClose={() => { if (!busy) { setBudgetConfirmed(false); setDrawer(null); } }} returnFocusRef={preflightOpenerRef} title={t("generation.title")}><div className="admin-drawer-form"><p className="admin-drawer-form__intro">{t("generation.body")}</p><div className="semantic-context-pack__preflight"><PreflightRow label={t("generation.model")} value={preflight.provider.model}/><PreflightRow label={t("generation.calls")} value={String(preflight.maximum_provider_calls)}/>{preflight.capacity ? <><PreflightRow label={t("generation.minimumUseful")} value={formatAdminNumber(preflight.capacity.minimum_useful_proposals, locale)}/><PreflightRow label={t("generation.targetProposals")} value={formatAdminNumber(preflight.capacity.target_proposals, locale)}/><PreflightRow label={t("generation.maximumProposals")} value={formatAdminNumber(preflight.capacity.maximum_proposals, locale)}/><PreflightRow label={t("generation.outputTokenBudget")} value={formatAdminNumber(preflight.capacity.output_token_budget, locale)}/></> : null}<PreflightRow label={t("generation.pricingVersion")} value={preflight.provider.pricing_version}/><PreflightRow label={t("generation.inputRate")} value={t("generation.perMillionTokens", { rate: formatSignalSemanticContextUsdPerMillionTokensV1(preflight.provider.input_usd_per_million_tokens, locale) })}/><PreflightRow label={t("generation.outputRate")} value={t("generation.perMillionTokens", { rate: formatSignalSemanticContextUsdPerMillionTokensV1(preflight.provider.output_usd_per_million_tokens, locale) })}/><PreflightRow label={t("generation.estimate")} value={microUsd(preflight.estimated_max_cost_micro_usd)}/><PreflightRow label={t("generation.hardCap")} value={microUsd(preflight.recommended_hard_cap_micro_usd)}/><PreflightRow label={t("generation.runtime")} value={preflight.runtime.queue_configured && preflight.runtime.worker_alive && preflight.runtime.recovery_alive ? t("generation.runtimeReady") : t("generation.runtimeBlocked")}/></div>{preflight.capacity ? <p className="admin-drawer-form__hint">{t("generation.capacityExplanation", { aliases: preflight.capacity.counts.aliases, products: preflight.capacity.counts.products, competitors: preflight.capacity.counts.competitors, locales: preflight.capacity.counts.locale_variants, markets: preflight.capacity.counts.markets, structured: preflight.capacity.counts.structured_terms, knowledge: preflight.capacity.counts.knowledge_blocks })}</p> : null}{preflight.blockers.length ? <div className="semantic-context-pack__notice" data-tone="warning"><Warning aria-hidden size={18}/><div><strong>{t("generation.blocked")}</strong>{preflight.blockers.map((blocker) => <p key={blocker}>{blockerLabel(blocker, t)}</p>)}{preflight.blockers.some((blocker) => ["provider_lineage_required", "provider_lineage_drift", "semantic_context_draft_stale"].includes(blocker)) ? <button className="admin-button" disabled={Boolean(busy)} onClick={() => void reconcileContext()} type="button">{busy === "reconcile" ? t("actions.reconciling") : t("actions.reconcile")}</button> : null}</div></div> : null}<label className="semantic-context-pack__confirmation"><input checked={budgetConfirmed} onChange={(event) => setBudgetConfirmed(event.target.checked)} type="checkbox"/><span>{t("generation.confirmation", { estimate: microUsd(preflight.estimated_max_cost_micro_usd), hardCap: microUsd(preflight.recommended_hard_cap_micro_usd) })}</span></label>{error ? <p className="workspace-form__error" role="alert">{error}</p> : null}<button className="admin-button admin-button--primary" disabled={preflight.readiness !== "ready" || !budgetConfirmed || busy === "generate"} onClick={() => void startProposalRun()} type="button">{busy === "generate" ? <CircleNotch aria-hidden className="workspace-shell__nav-pending" size={15}/> : <MagicWand aria-hidden size={15}/>} {t("actions.confirmGenerate")}</button></div></WorkspaceDrawer> : null}

    <WorkspaceConfirmDialog busy={busy === "publish"} cancelLabel={t("actions.cancel")} confirmDisabled={!canPublish} confirmLabel={t("publish.confirm")} message={t("publish.message", { approved: counts.approved })} onClose={() => setPublishOpen(false)} onConfirm={publish} open={publishOpen} title={t("publish.title")}><div className="semantic-context-pack__publish-summary"><CheckCircle aria-hidden size={20}/><p>{t("publish.body")}</p></div></WorkspaceConfirmDialog>
    <WorkspaceConfirmDialog busy={busy === "terminal-successor"} cancelLabel={t("actions.cancel")} confirmDisabled={!canPrepareTerminalSuccessor} confirmLabel={t("terminalSuccessor.confirm")} message={t("terminalSuccessor.message")} onClose={() => setTerminalSuccessorOpen(false)} onConfirm={() => void reconcileContext("terminal_provider_run")} open={terminalSuccessorOpen} title={t("terminalSuccessor.title")}><div className="semantic-context-pack__publish-summary"><TreeStructure aria-hidden size={20}/><p>{t("terminalSuccessor.body")}</p></div></WorkspaceConfirmDialog>
  </>;
}

function ContextSkeleton() { return <div aria-hidden className="semantic-context-pack__skeleton"><span/><span/><span/><div><span/><span/><span/></div></div>; }

function PreflightRow({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function RunBanner({ busy, onRetry, run, t }: { busy: boolean; onRetry: () => void; run: ProposalRun; t: ReturnType<typeof useTranslations> }) {
  const tone = run.status === "completed" ? "good" : run.status === "failed" || run.status === "dead_letter" ? "danger" : run.status === "stale" ? "warning" : "not_available";
  const retryAllowed = run.status === "failed" && run.provider_call_count === 0;
  const revalidation = run.paid_response_revalidation;
  const rejectedRevalidationCounts = revalidation?.status === "rejected"
    ? signalSemanticContextRejectedRevalidationCountValuesV1(revalidation)
    : null;
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
  return <div className="semantic-context-pack__run" role={run.status === "failed" || run.status === "dead_letter" ? "alert" : "status"}><div className="semantic-context-pack__run-copy"><span className="semantic-context-pack__run-icon">{terminalRunStates.has(run.status) ? run.status === "completed" ? <Check aria-hidden size={16}/> : <Warning aria-hidden size={16}/> : <CircleNotch aria-hidden className="icon--spin" size={16}/>}</span><div><strong>{t(`run.${run.status}`)}</strong><p>{detail}</p>{revalidation ? <p className="semantic-context-pack__run-revalidation">{revalidation.status === "completed" ? t("run.revalidationCompletedDetail", { count: revalidation.proposals_pending }) : t("run.revalidationRejectedDetail", rejectedRevalidationCounts!)}</p> : null}</div></div><div className="semantic-context-pack__run-actions">{revalidation ? <AdminStatus state={revalidation.status === "completed" ? "good" : "warning"}>{revalidation.status === "completed" ? t("run.revalidationCompleted") : t("run.revalidationRejected")}</AdminStatus> : null}<AdminStatus state={tone}>{run.status === "completed" ? t("run.proposals", { count: run.proposal_count }) : t(`run.badges.${run.status}`)}</AdminStatus>{retryAllowed ? <button className="admin-button admin-button--compact" disabled={busy} onClick={onRetry} type="button"><ArrowClockwise aria-hidden size={14}/>{t("actions.retrySafe")}</button> : null}</div></div>;
}

function blockerLabel(value: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["semantic_context_draft_required", "semantic_context_generation_run_exists", "provider_lineage_required", "provider_lineage_drift", "semantic_context_draft_stale", "provider_configuration_unavailable", "proposal_queue_unavailable", "proposal_worker_unavailable", "proposal_recovery_unavailable", "semantic_context_input_token_budget_exceeded", "semantic_context_capacity_contract_insufficient", "semantic_context_model_output_capacity_unsupported", "semantic_context_configured_output_capacity_insufficient", "platform_hard_cap_insufficient", "hard_cap_insufficient"]);
  return known.has(value) ? t(`blockers.${value}`) : t("blockers.unknown");
}
