"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Binoculars,
  CheckCircle,
  DownloadSimple,
  FunnelSimple,
  MagnifyingGlass,
  WarningCircle,
  Waveform
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminFeedbackState,
  AdminResourceSection,
  AdminStatus,
  AdminSummaryStrip,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceConfirmDialog, WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";

type ReviewDecision = {
  internal_coherence: number | null;
  neighbor_distinction: number | null;
  human_nameability: number | null;
  strategic_utility: number | null;
  merge_needed: boolean | null;
  split_needed: boolean | null;
  convert_to_topic_contract_candidate: boolean | null;
  none_acceptable: boolean | null;
  notes: string | null;
  saved_at?: string;
};

type OutlierDecision = {
  study_boundary_thresholds: boolean | null;
  study_missing_topic_families: boolean | null;
  study_later_recovery: boolean | null;
  notes: string | null;
  saved_at?: string;
};

type Run = {
  key: string;
  proposal_count: number;
  evidence_count: number;
  outlier_evidence_count: number;
  modeling_denominator: number;
  reference_seed: number;
  review_scope: string;
  holdout_opened: false;
  modeling_adopted: false;
};

type Overview = {
  runs: Run[];
  summary: {
    run: Run;
    review: {
      key: string;
      revision: number;
      state: "open" | "finalized";
      outcome: string | null;
      reviewed: number;
      pending: number;
      progress: number;
      decisions: { candidate: number; merge: number; split: number; none_acceptable: number };
      outliers_reviewed: boolean;
      operator_review_complete: boolean;
    };
    diagnostic: {
      modeling_denominator: number;
      assigned_count: number;
      assigned_coverage: number;
      outlier_count: number;
      outlier_rate: number;
      reference_seed: number;
      status: "diagnostic_not_adoption";
      holdout_opened: false;
      ten_c3b_authorized: false;
      ten_d_ready: false;
    };
  };
};

type Proposal = {
  key: string;
  label: string;
  position: number;
  size: number;
  coverage: number;
  scopes: string[];
  stability: number;
  review_status: "pending" | "reviewed";
  decisions: {
    merge_needed: boolean | null;
    split_needed: boolean | null;
    topic_contract_candidate: boolean | null;
    none_acceptable: boolean | null;
  };
};

type ProposalPage = {
  records: Proposal[];
  next_cursor: string | null;
  filters_digest: string;
};

type Evidence = {
  role: string;
  excerpt: string;
  evidence_ref: string;
  selection_reason: string;
  language: string;
  scope: string;
  platform: string;
  period: string;
};

type ProposalDetail = {
  proposal: {
    key: string;
    label: string;
    position: number;
    cluster_member_count: number;
    population_denominator: number;
    coverage: number;
    local_terms: string[];
    local_phrases: string[];
    distributions: Record<string, unknown>;
    neighboring_clusters: unknown[];
    stability: unknown;
    limitations: string[];
    technical: { role: string; holdout_opened: false; candidate_label: string; lineage_ref: string };
  };
  evidence: Evidence[];
  draft: ReviewDecision | null;
  review_state: "open" | "finalized";
};

type OutlierReview = {
  explanation: string;
  evidence: Omit<Evidence, "role">[];
  draft: OutlierDecision | null;
  review_state: "open" | "finalized";
};

type Filters = {
  status: string;
  decision: string;
  scope: string;
  search: string;
  size: string;
  stability: string;
};

const EMPTY_FILTERS: Filters = { status: "", decision: "", scope: "", search: "", size: "", stability: "" };
const EMPTY_DECISION: ReviewDecision = {
  internal_coherence: null,
  neighbor_distinction: null,
  human_nameability: null,
  strategic_utility: null,
  merge_needed: null,
  split_needed: null,
  convert_to_topic_contract_candidate: null,
  none_acceptable: null,
  notes: null
};
const EMPTY_OUTLIER: OutlierDecision = {
  study_boundary_thresholds: null,
  study_missing_topic_families: null,
  study_later_recovery: null,
  notes: null
};

export function TopicDiscoveryReviewWorkbench({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("AdminWorkspace.data.discoveryReview");
  const base = `/api/data-os/signal/${workspaceId}/topic-discovery-review`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [draft, setDraft] = useState<ReviewDecision>(EMPTY_DECISION);
  const [outliers, setOutliers] = useState<OutlierReview | null>(null);
  const [outlierDraft, setOutlierDraft] = useState<OutlierDecision>(EMPTY_OUTLIER);
  const [outlierOpen, setOutlierOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState("candidate_preferred");
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(body.message ?? t("errors.request"));
    return body as T;
  }, [t]);

  const loadOverview = useCallback(async () => {
    const value = await fetchJson<Overview>(base);
    setOverview(value);
    return value;
  }, [base, fetchJson]);

  const loadProposals = useCallback(async (append = false, cursor?: string | null) => {
    setListLoading(true);
    try {
      const query = new URLSearchParams({ limit: "25" });
      Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
      if (cursor) query.set("cursor", cursor);
      const value = await fetchJson<ProposalPage>(`${base}/proposals?${query.toString()}`);
      setProposals((current) => append ? [...current, ...value.records] : value.records);
      setNextCursor(value.next_cursor);
    } finally {
      setListLoading(false);
    }
  }, [base, fetchJson, filters]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadOverview(), loadProposals(false)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.request"));
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadProposals, t]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    if (loading) return;
    const id = window.setTimeout(() => { void loadProposals(false).catch((cause) => setError(String(cause))); }, 180);
    return () => window.clearTimeout(id);
  }, [filters, loadProposals, loading]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const openProposal = useCallback(async (proposalKey: string) => {
    if (dirty && !window.confirm(t("unsaved.confirm"))) return;
    setSelected(proposalKey);
    setDetail(null);
    setDetailLoading(true);
    setDirty(false);
    try {
      const value = await fetchJson<ProposalDetail>(`${base}/proposals/${proposalKey}`);
      setDetail(value);
      setDraft(value.draft ?? EMPTY_DECISION);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.request"));
    } finally {
      setDetailLoading(false);
    }
  }, [base, dirty, fetchJson, t]);

  const saveDraft = useCallback(async () => {
    if (!selected || !detail || detail.review_state !== "open") return;
    setBusy("draft");
    setError(null);
    try {
      await fetchJson(`${base}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ proposal_key: selected, ...draft })
      });
      setDirty(false);
      await Promise.all([loadOverview(), loadProposals(false), openProposal(selected)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.request"));
    } finally {
      setBusy(null);
    }
  }, [base, detail, draft, fetchJson, loadOverview, loadProposals, openProposal, selected, t]);

  const openOutliers = useCallback(async () => {
    setOutlierOpen(true);
    setBusy("outliers-load");
    try {
      const value = await fetchJson<OutlierReview>(`${base}/outliers`);
      setOutliers(value);
      setOutlierDraft(value.draft ?? EMPTY_OUTLIER);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.request"));
    } finally {
      setBusy(null);
    }
  }, [base, fetchJson, t]);

  const saveOutliers = useCallback(async () => {
    setBusy("outliers-save");
    try {
      await fetchJson(`${base}/outliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(outlierDraft)
      });
      await Promise.all([loadOverview(), openOutliers()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.request"));
    } finally {
      setBusy(null);
    }
  }, [base, fetchJson, loadOverview, openOutliers, outlierDraft, t]);

  const finalize = useCallback(async () => {
    setBusy("finalize");
    try {
      await fetchJson(`${base}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ outcome, confirmed: true })
      });
      setConfirmOpen(false);
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.request"));
    } finally {
      setBusy(null);
    }
  }, [base, fetchJson, loadAll, outcome, t]);

  const selectedIndex = useMemo(() => proposals.findIndex((proposal) => proposal.key === selected), [proposals, selected]);
  const navigate = useCallback((delta: number) => {
    const candidate = proposals[selectedIndex + delta];
    if (candidate) void openProposal(candidate.key);
  }, [openProposal, proposals, selectedIndex]);

  useEffect(() => {
    if (!selected) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDraft();
      } else if (target?.matches("input,textarea,select,button")) return;
      else if (event.key === "ArrowRight") navigate(1);
      else if (event.key === "ArrowLeft") navigate(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, saveDraft, selected]);

  if (loading) return <WorkbenchSkeleton />;
  if (error && !overview) return <AdminFeedbackState actions={<button className="admin-button" onClick={() => void loadAll()} type="button">{t("actions.retry")}</button>} body={error} icon={<WarningCircle size={22} />} title={t("errors.title")} tone="danger" />;
  if (!overview) return null;

  const { summary } = overview;
  const reviewOpen = summary.review.state === "open";
  const canFinalize = reviewOpen && summary.review.pending === 0 && summary.review.outliers_reviewed;
  const percent = Math.round(summary.review.progress * 100);

  return (
    <div className="topic-review">
      <AdminSummaryStrip items={[
        { label: t("summary.proposals"), value: formatAdminNumber(summary.run.proposal_count, "es-MX"), hint: t("summary.proposalsHint", { reviewed: summary.review.reviewed }) },
        { label: t("summary.denominator"), value: formatAdminNumber(summary.diagnostic.modeling_denominator, "es-MX"), hint: t("summary.denominatorHint") },
        { label: t("summary.coverage"), value: `${(summary.diagnostic.assigned_coverage * 100).toFixed(1)}%`, hint: t("summary.coverageHint", { assigned: summary.diagnostic.assigned_count }) },
        { label: t("summary.outliers"), value: `${(summary.diagnostic.outlier_rate * 100).toFixed(1)}%`, hint: t("summary.outliersHint", { count: summary.diagnostic.outlier_count }), tone: "warning" }
      ]} />

      <section className="topic-review__notice" role="status">
        <Binoculars aria-hidden size={22} />
        <div><strong>{t("notice.title")}</strong><p>{t("notice.body")}</p></div>
        <AdminStatus state="warning">{t("notice.badge")}</AdminStatus>
      </section>

      <AdminResourceSection
        actions={<div className="topic-review__actions"><button className="admin-button" onClick={() => void openOutliers()} type="button"><Waveform aria-hidden size={15} />{t("actions.reviewOutliers")}</button><button className="admin-button admin-button--primary" disabled={!canFinalize} onClick={() => setConfirmOpen(true)} type="button"><CheckCircle aria-hidden size={15} />{t("actions.finish")}</button></div>}
        subtitle={t("list.subtitle", { reviewed: summary.review.reviewed, total: summary.run.proposal_count, percent })}
        title={t("list.title")}
      >
        <div className="topic-review__progress" aria-label={t("progress.label", { percent })}><span style={{ width: `${percent}%` }} /></div>
        <div className="topic-review__filters" aria-label={t("filters.label")}>
          <label className="topic-review__search"><MagnifyingGlass aria-hidden size={16} /><input aria-label={t("filters.search")} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={t("filters.searchPlaceholder")} value={filters.search} /></label>
          <FilterSelect label={t("filters.status")} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} options={["pending", "reviewed"]} t={t} value={filters.status} />
          <FilterSelect label={t("filters.decision")} onChange={(value) => setFilters((current) => ({ ...current, decision: value }))} options={["topic_contract_candidate", "merge", "split", "none_acceptable"]} t={t} value={filters.decision} />
          <FilterSelect label={t("filters.scope")} onChange={(value) => setFilters((current) => ({ ...current, scope: value }))} options={["primary_brand", "category", "competitor"]} t={t} value={filters.scope} />
          <FilterSelect label={t("filters.size")} onChange={(value) => setFilters((current) => ({ ...current, size: value }))} options={["small", "medium", "large"]} t={t} value={filters.size} />
          <FilterSelect label={t("filters.stability")} onChange={(value) => setFilters((current) => ({ ...current, stability: value }))} options={["low", "medium", "high"]} t={t} value={filters.stability} />
          {Object.values(filters).some(Boolean) ? <button className="admin-button admin-button--plain" onClick={() => setFilters(EMPTY_FILTERS)} type="button">{t("filters.clear")}</button> : null}
        </div>

        {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
        {proposals.length ? (
          <div className="topic-review__table-wrap">
            <table className="topic-review__table">
              <thead><tr><th>{t("columns.proposal")}</th><th>{t("columns.size")}</th><th>{t("columns.scopes")}</th><th>{t("columns.stability")}</th><th>{t("columns.review")}</th></tr></thead>
              <tbody>{proposals.map((proposal) => <ProposalRow key={proposal.key} onOpen={() => void openProposal(proposal.key)} proposal={proposal} t={t} />)}</tbody>
            </table>
          </div>
        ) : listLoading ? <ListSkeleton /> : <div className="admin-empty"><FunnelSimple aria-hidden size={22} /><strong>{t("empty.title")}</strong><p>{t("empty.body")}</p></div>}
        {nextCursor ? <div className="topic-review__load-more"><button className="admin-button" disabled={listLoading} onClick={() => void loadProposals(true, nextCursor)} type="button">{listLoading ? t("actions.loading") : t("actions.loadMore")}<ArrowDown aria-hidden size={14} /></button></div> : null}
      </AdminResourceSection>

      {selected ? (
        <WorkspaceDrawer ariaLabel={t("detail.aria")} closeLabel={t("actions.close")} eyebrow={detail ? `${t("detail.proposal")} ${detail.proposal.position}` : t("actions.loading")} onClose={() => { if (!dirty || window.confirm(t("unsaved.confirm"))) { setSelected(null); setDetail(null); setDirty(false); } }} title={detail?.proposal.label ?? t("actions.loading")}>
          {detailLoading || !detail ? <DetailSkeleton /> : <ProposalReviewDetail detail={detail} draft={draft} onChange={(value) => { setDraft(value); setDirty(true); }} onNavigate={navigate} onSave={() => void saveDraft()} saving={busy === "draft"} t={t} />}
        </WorkspaceDrawer>
      ) : null}

      {outlierOpen ? (
        <WorkspaceDrawer ariaLabel={t("outliers.title")} closeLabel={t("actions.close")} eyebrow={t("outliers.eyebrow")} onClose={() => setOutlierOpen(false)} title={t("outliers.title")}>
          {!outliers || busy === "outliers-load" ? <DetailSkeleton /> : <OutlierForm decision={outlierDraft} onChange={setOutlierDraft} onSave={() => void saveOutliers()} review={outliers} saving={busy === "outliers-save"} t={t} />}
        </WorkspaceDrawer>
      ) : null}

      <WorkspaceConfirmDialog busy={busy === "finalize"} cancelLabel={t("actions.cancel")} confirmDisabled={!canFinalize} confirmLabel={t("finish.confirm")} message={t("finish.body")} onClose={() => setConfirmOpen(false)} onConfirm={finalize} open={confirmOpen} title={t("finish.title")}>
        <label className="workspace-field"><span>{t("finish.outcome")}</span><select className="workspace-control" onChange={(event) => setOutcome(event.target.value)} value={outcome}><option value="candidate_preferred">{t("outcomes.candidate_preferred")}</option><option value="none_acceptable">{t("outcomes.none_acceptable")}</option><option value="rerun_requested">{t("outcomes.rerun_requested")}</option></select><small>{t("finish.warning")}</small></label>
      </WorkspaceConfirmDialog>

      {summary.review.operator_review_complete ? <div className="topic-review__exports"><a className="admin-button" href={`${base}/exports/score-sheet`}><DownloadSimple size={15} />{t("actions.scoreSheet")}</a><a className="admin-button" href={`${base}/exports/decision-sheet`}><DownloadSimple size={15} />{t("actions.decisionSheet")}</a></div> : null}
    </div>
  );
}

function ProposalRow({ proposal, onOpen, t }: { proposal: Proposal; onOpen: () => void; t: ReturnType<typeof useTranslations> }) {
  const badges = [proposal.decisions.topic_contract_candidate && "candidate", proposal.decisions.merge_needed && "merge", proposal.decisions.split_needed && "split", proposal.decisions.none_acceptable && "none"].filter(Boolean) as string[];
  return <tr><td><button className="topic-review__proposal-link" onClick={onOpen} type="button"><strong>{proposal.label}</strong><small>{proposal.key}</small></button></td><td>{formatAdminNumber(proposal.size, "es-MX")}<small>{(proposal.coverage * 100).toFixed(2)}%</small></td><td><div className="topic-review__chips">{proposal.scopes.map((scope) => <span key={scope}>{t(`values.${scope}`)}</span>)}</div></td><td>{proposal.stability ? proposal.stability.toFixed(2) : t("values.not_available")}</td><td><AdminStatus state={proposal.review_status === "reviewed" ? "good" : "warning"}>{t(`values.${proposal.review_status}`)}</AdminStatus>{badges.length ? <small>{badges.map((badge) => t(`values.${badge}`)).join(" · ")}</small> : null}</td></tr>;
}

function ProposalReviewDetail({ detail, draft, onChange, onNavigate, onSave, saving, t }: { detail: ProposalDetail; draft: ReviewDecision; onChange: (value: ReviewDecision) => void; onNavigate: (delta: number) => void; onSave: () => void; saving: boolean; t: ReturnType<typeof useTranslations> }) {
  const locked = detail.review_state !== "open";
  const update = <K extends keyof ReviewDecision>(key: K, value: ReviewDecision[K]) => onChange({ ...draft, [key]: value });
  return <div className="topic-review-detail">
    <div className="topic-review-detail__navigation"><button className="admin-button admin-button--compact" onClick={() => onNavigate(-1)} type="button"><ArrowLeft size={14} />{t("actions.previous")}</button><button className="admin-button admin-button--compact" onClick={() => onNavigate(1)} type="button">{t("actions.next")}<ArrowRight size={14} /></button></div>
    <dl className="topic-review-detail__metrics"><div><dt>{t("detail.size")}</dt><dd>{formatAdminNumber(detail.proposal.cluster_member_count, "es-MX")}</dd></div><div><dt>{t("detail.coverage")}</dt><dd>{(detail.proposal.coverage * 100).toFixed(2)}%</dd></div><div><dt>{t("detail.role")}</dt><dd>{t("detail.pendingProposal")}</dd></div></dl>
    <section><h3>{t("detail.terms")}</h3><div className="topic-review__chips">{[...detail.proposal.local_terms, ...detail.proposal.local_phrases].slice(0, 24).map((term) => <span key={term}>{term}</span>)}</div></section>
    <DistributionGrid distributions={detail.proposal.distributions} t={t} />
    <section><h3>{t("detail.evidence")}</h3><div className="topic-review-evidence">{detail.evidence.map((evidence, index) => <article key={`${evidence.evidence_ref}-${index}`}><header><AdminStatus state="not_available">{t(`roles.${evidence.role}`, { fallback: evidence.role })}</AdminStatus><small>{evidence.scope} · {evidence.language} · {evidence.platform} · {evidence.period}</small></header><blockquote>{evidence.excerpt}</blockquote><footer>{evidence.evidence_ref}</footer></article>)}</div></section>
    {detail.proposal.limitations.length ? <section className="topic-review-detail__limitations"><h3>{t("detail.limitations")}</h3><ul>{detail.proposal.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></section> : null}
    <details className="topic-review-detail__technical"><summary>{t("detail.technical")}</summary><dl><div><dt>{t("detail.lineage")}</dt><dd>{detail.proposal.technical.lineage_ref}</dd></div><div><dt>{t("detail.holdout")}</dt><dd>{t("detail.sealed")}</dd></div></dl></details>
    <section className="topic-review-rubric"><header><h3>{t("rubric.title")}</h3><p>{t("rubric.body")}</p></header>{(["internal_coherence", "neighbor_distinction", "human_nameability", "strategic_utility"] as const).map((field) => <RatingField disabled={locked} key={field} label={t(`rubric.${field}`)} onChange={(value) => update(field, value)} value={draft[field]} />)}<div className="topic-review-rubric__checks">{(["merge_needed", "split_needed", "convert_to_topic_contract_candidate", "none_acceptable"] as const).map((field) => <TriState disabled={locked || (field === "convert_to_topic_contract_candidate" && draft.none_acceptable === true) || (field === "none_acceptable" && draft.convert_to_topic_contract_candidate === true)} key={field} label={t(`rubric.${field}`)} onChange={(value) => update(field, value)} value={draft[field]} />)}</div><label className="workspace-field"><span>{t("rubric.notes")}</span><textarea className="workspace-control" disabled={locked} maxLength={2000} onChange={(event) => update("notes", event.target.value || null)} rows={5} value={draft.notes ?? ""} /></label><button className="admin-button admin-button--primary" disabled={locked || saving} onClick={onSave} type="button">{saving ? t("actions.saving") : t("actions.saveDraft")}</button><small>{t("rubric.shortcut")}</small></section>
  </div>;
}

function OutlierForm({ decision, onChange, onSave, review, saving, t }: { decision: OutlierDecision; onChange: (value: OutlierDecision) => void; onSave: () => void; review: OutlierReview; saving: boolean; t: ReturnType<typeof useTranslations> }) {
  const locked = review.review_state !== "open";
  return <div className="topic-review-detail"><p className="admin-drawer-form__intro">{review.explanation}</p><section><h3>{t("outliers.samples")}</h3><div className="topic-review-evidence">{review.evidence.map((evidence, index) => <article key={`${evidence.evidence_ref}-${index}`}><header><small>{evidence.scope} · {evidence.language} · {evidence.platform} · {evidence.period}</small></header><blockquote>{evidence.excerpt}</blockquote></article>)}</div></section><section className="topic-review-rubric"><h3>{t("outliers.decision")}</h3>{(["study_boundary_thresholds", "study_missing_topic_families", "study_later_recovery"] as const).map((field) => <TriState disabled={locked} key={field} label={t(`outliers.${field}`)} onChange={(value) => onChange({ ...decision, [field]: value })} value={decision[field]} />)}<label className="workspace-field"><span>{t("rubric.notes")}</span><textarea className="workspace-control" disabled={locked} maxLength={2000} onChange={(event) => onChange({ ...decision, notes: event.target.value || null })} rows={5} value={decision.notes ?? ""} /></label><button className="admin-button admin-button--primary" disabled={locked || saving} onClick={onSave} type="button">{saving ? t("actions.saving") : t("actions.saveDraft")}</button></section></div>;
}

function RatingField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: number | null) => void; value: number | null }) {
  return <fieldset className="topic-review-rating" disabled={disabled}><legend>{label}</legend><div>{[1, 2, 3, 4, 5].map((score) => <label key={score}><input checked={value === score} name={label} onChange={() => onChange(score)} type="radio" /><span>{score}</span></label>)}<button className="admin-button admin-button--plain" disabled={disabled || value === null} onClick={() => onChange(null)} type="button">—</button></div></fieldset>;
}

function TriState({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: boolean | null) => void; value: boolean | null }) {
  return <label className="topic-review-tristate"><span>{label}</span><select className="workspace-control" disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "true")} value={value === null ? "" : String(value)}><option value="">—</option><option value="true">Sí</option><option value="false">No</option></select></label>;
}

function FilterSelect({ label, onChange, options, t, value }: { label: string; onChange: (value: string) => void; options: string[]; t: ReturnType<typeof useTranslations>; value: string }) {
  return <label><span className="sr-only">{label}</span><select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}><option value="">{label}</option>{options.map((option) => <option key={option} value={option}>{t(`values.${option}`)}</option>)}</select></label>;
}

function DistributionGrid({ distributions, t }: { distributions: Record<string, unknown>; t: ReturnType<typeof useTranslations> }) {
  return <section><h3>{t("detail.distributions")}</h3><div className="topic-review-distributions">{Object.entries(distributions).slice(0, 8).map(([key, value]) => <article key={key}><strong>{t(`distribution.${key}`, { fallback: key })}</strong><ul>{Object.entries(typeof value === "object" && value !== null ? value as Record<string, unknown> : {}).slice(0, 8).map(([label, count]) => <li key={label}><span>{label}</span><b>{String(count)}</b></li>)}</ul></article>)}</div></section>;
}

function WorkbenchSkeleton() { return <div className="topic-review" aria-busy="true"><div className="admin-summary-strip topic-review__skeleton"><div /><div /><div /><div /></div><section className="admin-section"><ListSkeleton /></section></div>; }
function ListSkeleton() { return <div className="topic-review__skeleton-list" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div>; }
function DetailSkeleton() { return <div className="topic-review__skeleton-list" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>; }
