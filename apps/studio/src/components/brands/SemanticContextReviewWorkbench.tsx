"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleNotch,
  MagnifyingGlass,
  PencilSimple,
  Warning,
  X
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdminStatus, formatAdminDate } from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";

type Disposition = "pending" | "approved" | "rejected";

type ReviewElement = {
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
  applicability: {
    locale_state: "explicit" | "global_unassigned";
    locale: string | null;
    market_state: "global_unassigned";
    generation_locales: string[];
    generation_markets: string[];
  };
  evidence_summary: {
    count: number;
    distinct_sources: number;
    relations: { supports: number; limits: number; contradicts: number };
  };
  attention: {
    authoritative: false;
    needs_locale_review: boolean;
    locale_reasons: string[];
    needs_evidence_review: boolean;
    evidence_reasons: string[];
    duplicates: {
      authoritative: false;
      exact: boolean;
      exact_count: number;
      display: boolean;
      display_count: number;
    };
  };
};

type EvidenceSource = {
  relation: "supports" | "limits" | "contradicts";
  source_type: string;
  source_kind: string;
  source_title: string;
  section_label: string;
  source_context: {
    label: "context_supplied_to_model";
    preview: string | null;
    truncated: boolean;
    redacted: boolean;
    pinpoint_citation: false;
  };
  applicability: { locales: string[]; markets: string[]; state: "explicit" | "not_declared" };
  generation_state: "validated_at_generation";
  current_state: "current" | "inactive" | "unavailable";
};

type ReviewPage = {
  total: number;
  page_size: 20 | 40;
  next_cursor: string | null;
  elements: ReviewElement[];
  facets: {
    element_kinds: Record<string, number>;
    scopes: Record<string, number>;
    dispositions: Record<string, number>;
  };
};

type ReviewDetail = { element: ReviewElement; evidence: EvidenceSource[] };

type Filters = {
  disposition: Disposition | "all";
  kind: string;
  scope: string;
  locale: "all" | "explicit" | "unassigned" | "needs_review";
  evidence: "all" | "needs_review" | "one_source_only" | "supports_only" | "has_limits" | "has_contradictions";
  duplicate: "all" | "exact" | "display";
};

const initialFilters: Filters = {
  disposition: "all",
  kind: "all",
  scope: "all",
  locale: "all",
  evidence: "all",
  duplicate: "all"
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as ({ error?: string; message?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? "request_failed");
  return payload as T;
}

function idempotencyKey(action: string) {
  return `semantic-context:${action}:${crypto.randomUUID()}`;
}

export function SemanticContextReviewWorkbench({
  generationKey,
  onMutation,
  workspaceId
}: {
  generationKey: string;
  onMutation: () => Promise<void>;
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.brandOs.semanticContext");
  const locale = useLocale();
  const base = `/api/data-os/signal/${workspaceId}/semantic-context`;
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reviewOpenerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [debouncedQuery, filters]);

  const loadPage = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ page_size: "20" });
    if (debouncedQuery) params.set("search", debouncedQuery);
    if (filters.disposition !== "all") params.set("disposition", filters.disposition);
    if (filters.kind !== "all") params.set("element_kind", filters.kind);
    if (filters.scope !== "all") params.set("scope", filters.scope);
    if (filters.locale !== "all") params.set("locale", filters.locale);
    if (filters.evidence !== "all") params.set("evidence", filters.evidence);
    if (filters.duplicate !== "all") params.set("duplicate", filters.duplicate);
    if (cursor) params.set("cursor", cursor);
    setLoading(true);
    setError(null);
    try {
      setPage(await requestJson<ReviewPage>(`${base}/review?${params}`, { signal }));
    } catch (loadError) {
      if ((loadError as { name?: string }).name !== "AbortError") {
        setError(loadError instanceof Error ? loadError.message : t("reviewWorkbench.errors.load"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [base, cursor, debouncedQuery, filters, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  async function openDetail(elementKey: string, opener: HTMLButtonElement) {
    reviewOpenerRef.current = opener;
    setDetailKey(elementKey);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await requestJson<ReviewDetail>(`${base}/review/${encodeURIComponent(elementKey)}`));
    } catch (detailError) {
      setDetailError(detailError instanceof Error ? detailError.message : t("reviewWorkbench.errors.detail"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function decide(action: "approve" | "reject", elementKey: string) {
    setBusy(action);
    setError(null);
    try {
      await requestJson(`${base}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey(action) },
        body: JSON.stringify({ action, generation_key: generationKey, element_key: elementKey })
      });
      closeDetail();
      await Promise.all([loadPage(), onMutation()]);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : t("errors.decision"));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(formData: FormData) {
    if (!detail) return;
    setBusy("edit");
    setError(null);
    try {
      const relation = String(formData.get("relation_kind") ?? "").trim();
      const target = String(formData.get("relation_target_key") ?? "").trim();
      await requestJson(`${base}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("edit") },
        body: JSON.stringify({
          action: "edit",
          generation_key: generationKey,
          element_key: detail.element.element_key,
          edit: {
            canonical_key: String(formData.get("canonical_key") ?? "").trim(),
            display_text: String(formData.get("display_text") ?? "").trim(),
            locale: String(formData.get("locale") ?? "").trim() || null,
            relation_kind: relation || null,
            relation_target_key: target || null
          }
        })
      });
      closeDetail();
      await Promise.all([loadPage(), onMutation()]);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : t("errors.edit"));
    } finally {
      setBusy(null);
    }
  }

  function closeDetail() {
    setDetailKey(null);
    setDetail(null);
    setDetailError(null);
  }

  const resultStart = page && page.elements.length ? cursorHistory.length * page.page_size + 1 : 0;
  const resultEnd = page ? Math.min(resultStart + page.elements.length - 1, page.total) : 0;
  const filterOptions = useMemo(() => ({
    kinds: Object.keys(page?.facets.element_kinds ?? {}).sort(),
    scopes: Object.keys(page?.facets.scopes ?? {}).sort()
  }), [page]);

  return <div className="semantic-context-review" data-loading={loading || undefined}>
    <div className="semantic-context-review__header">
      <div>
        <strong>{t("reviewWorkbench.title")}</strong>
        <p>{t("reviewWorkbench.body")}</p>
      </div>
      <AdminStatus state="warning">{t("reviewWorkbench.nonAuthoritative")}</AdminStatus>
    </div>

    <div className="semantic-context-review__toolbar" role="search">
      <label className="semantic-context-review__search">
        <MagnifyingGlass aria-hidden size={15}/>
        <span className="sr-only">{t("filters.search")}</span>
        <input className="workspace-control" onChange={(event) => setQuery(event.target.value)}
          placeholder={t("reviewWorkbench.searchPlaceholder")} type="search" value={query}/>
      </label>
      <FilterSelect label={t("filters.status")} onChange={(value) => setFilters((current) => ({ ...current, disposition: value as Filters["disposition"] }))} value={filters.disposition}>
        <option value="all">{t("filters.allStatuses")}</option>
        <option value="pending">{t("states.pending")}</option>
        <option value="approved">{t("states.approved")}</option>
        <option value="rejected">{t("states.rejected")}</option>
      </FilterSelect>
      <FilterSelect label={t("filters.type")} onChange={(value) => setFilters((current) => ({ ...current, kind: value }))} value={filters.kind}>
        <option value="all">{t("filters.allTypes")}</option>
        {filterOptions.kinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind, t)}</option>)}
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.scope")} onChange={(value) => setFilters((current) => ({ ...current, scope: value }))} value={filters.scope}>
        <option value="all">{t("reviewWorkbench.filters.allScopes")}</option>
        {filterOptions.scopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.locale")} onChange={(value) => setFilters((current) => ({ ...current, locale: value as Filters["locale"] }))} value={filters.locale}>
        <option value="all">{t("reviewWorkbench.filters.allLocales")}</option>
        <option value="explicit">{t("reviewWorkbench.filters.explicitLocale")}</option>
        <option value="unassigned">{t("reviewWorkbench.filters.unassignedLocale")}</option>
        <option value="needs_review">{t("reviewWorkbench.filters.localeAttention")}</option>
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.evidence")} onChange={(value) => setFilters((current) => ({ ...current, evidence: value as Filters["evidence"] }))} value={filters.evidence}>
        <option value="all">{t("reviewWorkbench.filters.allEvidence")}</option>
        <option value="needs_review">{t("reviewWorkbench.filters.evidenceAttention")}</option>
        <option value="one_source_only">{t("reviewWorkbench.filters.oneSource")}</option>
        <option value="supports_only">{t("reviewWorkbench.filters.supportsOnly")}</option>
        <option value="has_limits">{t("reviewWorkbench.filters.hasLimits")}</option>
        <option value="has_contradictions">{t("reviewWorkbench.filters.hasContradictions")}</option>
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.duplicates")} onChange={(value) => setFilters((current) => ({ ...current, duplicate: value as Filters["duplicate"] }))} value={filters.duplicate}>
        <option value="all">{t("reviewWorkbench.filters.allDuplicates")}</option>
        <option value="exact">{t("reviewWorkbench.filters.exactDuplicate")}</option>
        <option value="display">{t("reviewWorkbench.filters.displayDuplicate")}</option>
      </FilterSelect>
    </div>

    {error ? <div className="semantic-context-review__feedback" role="alert"><Warning aria-hidden size={18}/><span>{error}</span><button className="admin-button admin-button--compact" onClick={() => void loadPage()} type="button">{t("actions.retry")}</button></div> : null}
    {loading ? <div aria-busy="true" aria-live="polite" className="semantic-context-review__loading" role="status"><CircleNotch aria-hidden className="icon--spin" size={18}/>{t("reviewWorkbench.loading")}</div> : null}

    {!loading && page ? <>
      <div aria-live="polite" className="semantic-context-review__count">
        {t("reviewWorkbench.resultRange", { start: resultStart, end: resultEnd, total: page.total })}
      </div>
      <div className="semantic-context-review__list">
        {page.elements.map((element) => <article className="semantic-context-review__row" key={element.element_key}>
          <button className="semantic-context-review__row-button" onClick={(event) => void openDetail(element.element_key, event.currentTarget)} type="button">
            <span className="semantic-context-review__row-main"><strong>{element.display_text}</strong><small>{element.canonical_key}</small></span>
            <span className="semantic-context-review__row-meta"><span>{kindLabel(element.element_kind, t)}</span><span>{element.scope ?? t("values.workspaceScope")}</span><span>{element.locale ?? t("values.noLocale")}</span></span>
            <span className="semantic-context-review__row-signals">
              <AdminStatus state={element.disposition === "approved" ? "good" : element.disposition === "rejected" ? "danger" : "warning"}>{t(`states.${element.disposition}`)}</AdminStatus>
              <span>{t("values.evidenceCount", { count: element.evidence_summary.count })}</span>
              {element.attention.needs_locale_review ? <AttentionChip>{t("reviewWorkbench.attention.locale")}</AttentionChip> : null}
              {element.attention.needs_evidence_review ? <AttentionChip>{t("reviewWorkbench.attention.evidence")}</AttentionChip> : null}
              {element.attention.duplicates.exact ? <AttentionChip>{t("reviewWorkbench.attention.exactDuplicate", { count: element.attention.duplicates.exact_count })}</AttentionChip> : null}
              {!element.attention.duplicates.exact && element.attention.duplicates.display ? <AttentionChip>{t("reviewWorkbench.attention.displayDuplicate", { count: element.attention.duplicates.display_count })}</AttentionChip> : null}
            </span>
          </button>
        </article>)}
        {page.elements.length === 0 ? <div className="admin-empty"><strong>{t("filters.emptyTitle")}</strong><p>{t("reviewWorkbench.emptyBody")}</p></div> : null}
      </div>
      <nav aria-label={t("reviewWorkbench.pagination.label")} className="semantic-context-review__pagination">
        <button className="admin-button" disabled={!cursorHistory.length} onClick={() => {
          setCursorHistory((history) => { const previous = history.slice(0, -1); setCursor(history.at(-1) ?? null); return previous; });
        }} type="button"><ArrowLeft aria-hidden size={15}/>{t("reviewWorkbench.pagination.previous")}</button>
        <span>{t("reviewWorkbench.pagination.page", { page: cursorHistory.length + 1 })}</span>
        <button className="admin-button" disabled={!page.next_cursor} onClick={() => {
          setCursorHistory((history) => [...history, cursor]); setCursor(page.next_cursor);
        }} type="button">{t("reviewWorkbench.pagination.next")}<ArrowRight aria-hidden size={15}/></button>
      </nav>
    </> : null}

    {detailKey ? <WorkspaceDrawer ariaLabel={t("review.aria", { name: detail?.element.display_text ?? t("reviewWorkbench.loadingDetail") })}
      closeLabel={t("actions.close")} eyebrow={detail ? `${kindLabel(detail.element.element_kind, t)} · ${t(`states.${detail.element.disposition}`)}` : t("reviewWorkbench.loadingDetail")}
      onClose={() => !busy && closeDetail()} returnFocusRef={reviewOpenerRef}
      title={detail?.element.display_text ?? t("reviewWorkbench.loadingDetail")}>
      {detailError ? <div className="semantic-context-review__feedback" role="alert"><Warning aria-hidden size={18}/><span>{detailError}</span><button className="admin-button admin-button--compact" onClick={() => {
        const opener = reviewOpenerRef.current;
        if (opener) void openDetail(detailKey, opener);
      }} type="button">{t("actions.retry")}</button></div>
        : detailLoading || !detail ? <div aria-busy="true" aria-live="polite" className="semantic-context-review__detail-loading" role="status"><CircleNotch aria-hidden className="icon--spin" size={18}/>{t("reviewWorkbench.loadingDetail")}</div>
        : <ElementReviewDetail busy={busy} detail={detail} generationVersion={undefined} locale={locale}
          onApprove={() => void decide("approve", detail.element.element_key)}
          onEdit={(form) => void saveEdit(form)} onReject={() => void decide("reject", detail.element.element_key)} t={t}/>}
    </WorkspaceDrawer> : null}
  </div>;
}

function FilterSelect({ children, label, onChange, value }: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <label><span>{label}</span><select className="workspace-control" onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}

function AttentionChip({ children }: { children: React.ReactNode }) {
  return <span className="semantic-context-review__attention"><Warning aria-hidden size={13}/>{children}</span>;
}

function ElementReviewDetail({ busy, detail, locale, onApprove, onEdit, onReject, t }: {
  busy: string | null;
  detail: ReviewDetail;
  generationVersion?: number;
  locale: string;
  onApprove: () => void;
  onEdit: (form: FormData) => void;
  onReject: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [editing, setEditing] = useState(false);
  const element = detail.element;
  return <div className="semantic-context-pack__review semantic-context-review__detail">
    <div className="semantic-context-pack__review-summary"><AdminStatus state={element.disposition === "approved" ? "good" : element.disposition === "rejected" ? "danger" : "warning"}>{t(`states.${element.disposition}`)}</AdminStatus><p>{t("review.proposedAt", { date: formatAdminDate(element.provenance.proposed_at, locale, { dateStyle: "medium", timeStyle: "short" }) })}</p></div>
    {editing ? <form className="admin-drawer-form" onSubmit={(event) => { event.preventDefault(); onEdit(new FormData(event.currentTarget)); }}>
      <label className="workspace-field"><span>{t("fields.displayText")}</span><input className="workspace-control" defaultValue={element.display_text} maxLength={500} name="display_text" required/></label>
      <label className="workspace-field"><span>{t("fields.canonicalKey")}</span><input className="workspace-control" defaultValue={element.canonical_key} name="canonical_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*" required/></label>
      <label className="workspace-field"><span>{t("fields.locale")}</span><input className="workspace-control" defaultValue={element.locale ?? ""} name="locale" placeholder="es-MX"/></label>
      <label className="workspace-field"><span>{t("fields.relation")}</span><select className="workspace-control" defaultValue={element.relation_kind ?? ""} name="relation_kind"><option value="">{t("values.noRelation")}</option>{["is_a", "part_of", "surface_of", "competes_with", "associated_with"].map((kind) => <option key={kind} value={kind}>{t(`relations.${kind}`)}</option>)}</select></label>
      <label className="workspace-field"><span>{t("fields.relationTarget")}</span><input className="workspace-control" defaultValue={element.relation_target_key ?? ""} name="relation_target_key"/></label>
      <div className="semantic-context-pack__drawer-actions"><button className="admin-button" disabled={Boolean(busy)} onClick={() => setEditing(false)} type="button">{t("actions.cancelEdit")}</button><button className="admin-button admin-button--primary" disabled={Boolean(busy)} type="submit"><PencilSimple aria-hidden size={14}/>{t("actions.saveCorrection")}</button></div>
    </form> : <>
      <dl className="semantic-context-pack__definition"><div><dt>{t("fields.canonicalKey")}</dt><dd>{element.canonical_key}</dd></div><div><dt>{t("fields.locale")}</dt><dd>{element.locale ?? t("values.noLocale")}</dd></div><div><dt>{t("fields.scope")}</dt><dd>{element.scope ?? t("values.workspaceScope")}</dd></div><div><dt>{t("fields.relation")}</dt><dd>{element.relation_kind ? `${t(`relations.${element.relation_kind}`)}${element.relation_target_key ? ` → ${element.relation_target_key}` : ""}` : t("values.noRelation")}</dd></div></dl>
      <div className="semantic-context-review__attention-summary"><strong>{t("reviewWorkbench.attention.title")}</strong><p>{t("reviewWorkbench.attention.body")}</p><div>{element.attention.locale_reasons.map((reason) => <AttentionChip key={reason}>{t(`reviewWorkbench.attention.reasons.${reason}`)}</AttentionChip>)}{element.attention.evidence_reasons.map((reason) => <AttentionChip key={reason}>{t(`reviewWorkbench.attention.reasons.${reason}`)}</AttentionChip>)}</div></div>
      <section className="semantic-context-review__evidence"><div><h3>{t("reviewWorkbench.evidence.title")}</h3><p>{t("reviewWorkbench.evidence.body")}</p></div>
        {detail.evidence.map((source, index) => <article className="semantic-context-review__source" key={`${source.source_type}-${source.section_label}-${index}`}>
          <header><div><span>{sourceKindLabel(source.source_type, t)}</span><strong>{source.source_title}</strong><small>{source.section_label}</small></div><AdminStatus state={source.current_state === "current" ? "good" : source.current_state === "inactive" ? "warning" : "not_available"}>{t(`reviewWorkbench.evidence.states.${source.current_state}`)}</AdminStatus></header>
          <div className="semantic-context-review__source-meta"><span>{t("reviewWorkbench.evidence.relation", { relation: t(`evidenceRelations.${source.relation}`) })}</span><span>{t("reviewWorkbench.evidence.generationValidated")}</span><span>{source.applicability.state === "explicit" ? t("reviewWorkbench.evidence.coverage", { locales: source.applicability.locales.join(", ") || "—", markets: source.applicability.markets.join(", ") || "—" }) : t("reviewWorkbench.evidence.coverageUnknown")}</span></div>
          <div className="semantic-context-review__source-context"><strong>{t("reviewWorkbench.evidence.contextLabel")}</strong><p>{source.source_context.preview ?? t("reviewWorkbench.evidence.contextUnavailable")}</p><small>{t("reviewWorkbench.evidence.notCitation")}</small></div>
        </article>)}
        {!detail.evidence.length ? <p>{t("review.noEvidence")}</p> : null}
      </section>
      {element.disposition === "pending" ? <div className="semantic-context-pack__drawer-actions"><button className="admin-button admin-button--danger" disabled={Boolean(busy)} onClick={onReject} type="button"><X aria-hidden size={14}/>{t("actions.reject")}</button><button className="admin-button" disabled={Boolean(busy)} onClick={() => setEditing(true)} type="button"><PencilSimple aria-hidden size={14}/>{t("actions.edit")}</button><button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={onApprove} type="button"><Check aria-hidden size={14}/>{t("actions.approve")}</button></div> : null}
    </>}
  </div>;
}

function kindLabel(kind: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["identity_term", "alias", "product", "feature", "surface", "category", "need", "benefit", "friction", "usage_occasion", "competitor_term", "locale_variant", "exclusion", "homonym", "ambiguous_term", "abstention_rule", "positive_anchor", "negative_anchor", "boundary_anchor", "typed_relation"]);
  return known.has(kind) ? t(`kinds.${kind}`) : t("kinds.other");
}

function sourceKindLabel(kind: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["brand_os_profile", "brand_os_product", "brand_os_competitor", "brand_os_seed_term", "knowledge_source", "knowledge_chunk", "knowledge_assertion"]);
  return known.has(kind) ? t(`sources.${kind}`) : t("sources.authority");
}
