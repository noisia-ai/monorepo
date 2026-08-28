"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowsMerge,
  Check,
  CircleNotch,
  Eye,
  MagnifyingGlass,
  NotePencil,
  PencilSimple,
  Plus,
  ShieldCheck,
  Warning,
  X
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdminStatus, formatAdminDate, formatAdminNumber } from
  "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import {
  SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_UI,
  SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_UI,
  createSignalSemanticContextMutationLockV1,
  handleSignalSemanticContextCreationKeyV1,
  handleSignalSemanticContextDecisionKeyV1,
  signalSemanticContextAnnotationResolutionsV1,
  signalSemanticContextBoundedPendingSelectionV1,
  signalSemanticContextReviewRangeV1,
  signalSemanticContextSelectionWithinVisiblePageV1,
  submitSignalSemanticContextBulkApprovalFormUiV2,
  submitSignalSemanticContextDeliberateApprovalFormUiV2,
  submitSignalSemanticContextAnnotationResolutionFormUiV1,
  submitSignalSemanticContextGuidedRejectUiV1,
  submitSignalSemanticContextLocaleAuthorityFormUiV1,
  submitSignalSemanticContextMergeUiV1,
  parseSignalSemanticContextOrdinaryEditFormV1,
  parseSignalSemanticContextCreateFormV1,
  signalSemanticContextCreationGuidanceUrlV1,
  submitSignalSemanticContextCreateUiV1,
  submitSignalSemanticContextOrdinaryCommandUiV1,
  type SignalSemanticContextAnnotationResolutionUi,
  type SignalSemanticContextAnnotationResolutionIntentUi,
  type SignalSemanticContextAnnotationTypeUi,
  type SignalSemanticContextReviewReasonUi
} from "@/lib/data-os/signal-semantic-context-review-ui";

type Disposition = "pending" | "approved" | "rejected" | "merged" | "archived";
type DetailMode = "view" | "approve" | "correct" | "reject" | "annotate" | "resolve_annotation" | "locale_authority";
type CreationGuidance={exact_collision:{element_key:string;display_text:string;element_kind:string;scope:string|null;locale:string|null;applicability_state:string}|null;
  suggestions:Array<{element_key:string;display_text:string;element_kind:string;scope:string|null;locale:string|null;applicability_state:string}>;
  writes_performed:false;provider_calls:0};

type ReviewElement = {
  element_key: string;
  element_version: number;
  state_token: string;
  lifecycle_state: "active" | "archived";
  undo_target_version: number | null;
  element_kind: string;
  canonical_key: string;
  display_text: string;
  scope: string | null;
  entity_type: string | null;
  locale: string | null;
  relation_kind: string | null;
  relation_target_key: string | null;
  disposition: Disposition;
  review_state: "ready" | "exception" | "resolved";
  automatic_policy: {
    contract_version: string;
    outcome: "ready" | "exception";
    reasons: string[];
    authority: "server_owned";
    provider_prose_used_as_evidence: false;
  } | null;
  origin: string;
  provenance: { proposed_at: string; decided_at: string | null };
  applicability: {
    contract_version: "signal-semantic-context-effective-applicability-v1";
    effective_state: "workspace_inherited" | "explicit_global" | "explicit_locale" | "unresolved";
    locale_state: "explicit" | "global_unassigned" | "global_resolved" | "workspace_inherited";
    locale: string | null;
    market_state: "sealed" | "global_unassigned";
    generation_locales: string[];
    generation_markets: string[];
    source: string | null;
  };
  locale_authority: {
    state: "global" | "locale_specific" | "sealed_existing_locale" | "workspace_inherited" | "unresolved";
    locale: string | null;
    lifecycle: "pending_reapproval" | "reviewed" | "not_decided";
    basis: { reason: SignalSemanticContextReviewReasonUi | null; rationale: string; reviewer: "authenticated_operator" } | null;
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
    label: "context_supplied_to_model" | "operator_authored_input";
    preview: string | null;
    truncated: boolean;
    redacted: boolean;
    pinpoint_citation: false;
  };
  applicability: { locales: string[]; markets: string[]; state: "explicit" | "not_declared" };
  generation_state: "validated_at_generation";
  current_state: "current" | "inactive" | "unavailable";
};

type ReviewAnnotation = {
  annotation_key: string;
  annotation_version: number;
  annotation_type: SignalSemanticContextAnnotationTypeUi;
  state: "open" | "resolved";
  resolution: SignalSemanticContextAnnotationResolutionUi | null;
  reason: SignalSemanticContextReviewReasonUi;
  rationale: string;
  resolution_basis: {
    state: "complete" | "missing_historical" | "not_applicable";
    reason: SignalSemanticContextReviewReasonUi | null;
    rationale: string | null;
    reviewer: "authenticated_operator" | null;
  };
  related_elements: Array<{ element_key: string; element_kind: string; display_text: string }>;
  created_at: string;
};

type AnnotationResolutionDraft = {
  annotation: ReviewAnnotation;
  resolution: SignalSemanticContextAnnotationResolutionUi;
  intent: SignalSemanticContextAnnotationResolutionIntentUi;
};

type ReviewDetail = {
  element: ReviewElement;
  evidence: EvidenceSource[];
  review_annotations: ReviewAnnotation[];
  merge_lineage: Array<{
    role: "source" | "target";
    source_element_key: string;
    target_element_key: string;
    reason: string;
    rationale: string;
    created_at: string;
  }>;
  decision_basis: {
    state: "complete" | "missing_historical" | "not_applicable";
    contract_version: string | null;
    reason: SignalSemanticContextReviewReasonUi | null;
    rationale: string | null;
    decided_at: string | null;
    reviewer: "authenticated_operator" | null;
  };
  lineage: { element_version: number; origin: string; append_only: true };
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
    review_states: { ready: number; exception: number; resolved: number };
  };
};

const EMPTY_REVIEW_STATE_COUNTS:ReviewPage["facets"]["review_states"]={ready:0,exception:0,resolved:0};

type PublicationPreflight = {
  generation_key: string;
  generation_version: number;
  counts: Record<string, number>;
  collisions: string[][];
  blockers: string[];
  publishable: boolean;
  digest_refs: { candidate: string; evidence: string; review: string; authority: string; pack: string };
  writes_performed: false;
  provider_calls: 0;
};

type Filters = {
  disposition: Disposition | "all";
  kind: string;
  scope: string;
  locale: "all" | "explicit" | "unassigned" | "global" | "needs_review";
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

function annotationKey(action: string) {
  return `${action}:${crypto.randomUUID()}`;
}

export function SemanticContextReviewWorkbench({
  generationKey,
  onMutation,
  reviewWritable,
  workspaceId
}: {
  generationKey: string;
  onMutation: () => Promise<void>;
  reviewWritable: boolean;
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.brandOs.semanticContext");
  const locale = useLocale();
  const base = `/api/data-os/signal/${workspaceId}/semantic-context`;
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>("view");
  const [creationOpen,setCreationOpen]=useState(false);
  const [creationGuidance,setCreationGuidance]=useState<CreationGuidance|null>(null);
  const [creationGuidanceLoading,setCreationGuidanceLoading]=useState(false);
  const [annotationResolutionDraft, setAnnotationResolutionDraft] =
    useState<AnnotationResolutionDraft | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [selected, setSelected] = useState<Map<string, ReviewElement>>(new Map());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [localeAuthorityOpen, setLocaleAuthorityOpen] = useState(false);
  const [preflight, setPreflight] = useState<PublicationPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRecovery, setErrorRecovery] = useState<"page" | "preflight" | "none">("none");
  const reviewOpenerRef = useRef<HTMLButtonElement | null>(null);
  const creationOpenerRef=useRef<HTMLButtonElement|null>(null);
  const activeFormRef = useRef<HTMLFormElement | null>(null);
  const mutationLockRef = useRef(createSignalSemanticContextMutationLockV1());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
    setSelected(new Map());
    setMergeOpen(false);
    setBulkApproveOpen(false);
    setLocaleAuthorityOpen(false);
  }, [debouncedQuery, filters]);

  useEffect(() => {
    setSelected(new Map());
    setMergeOpen(false);
    setBulkApproveOpen(false);
    setLocaleAuthorityOpen(false);
  }, [cursor]);

  function beginMutation(label: string) {
    if (!mutationLockRef.current.begin()) return false;
    setBusy(label);
    setError(null);
    setErrorRecovery("none");
    return true;
  }

  function endMutation() {
    mutationLockRef.current.end();
    setBusy(null);
  }

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
    setErrorRecovery("none");
    try {
      setPage(await requestJson<ReviewPage>(`${base}/review?${params}`, { signal }));
    } catch (loadError) {
      if ((loadError as { name?: string }).name !== "AbortError") {
        setError(loadError instanceof Error ? loadError.message : t("reviewWorkbench.errors.load"));
        setErrorRecovery("page");
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

  const loadDetail = useCallback(async (elementKey: string) =>
    requestJson<ReviewDetail>(`${base}/review/${encodeURIComponent(elementKey)}`), [base]);

  async function openDetail(elementKey: string, opener: HTMLButtonElement) {
    setCreationOpen(false);
    reviewOpenerRef.current = opener;
    setDetailKey(elementKey);
    setDetailMode("view");
    setAnnotationResolutionDraft(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await loadDetail(elementKey));
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : t("reviewWorkbench.errors.detail"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function retryDetail() {
    if (!detailKey) return;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(await loadDetail(detailKey));
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : t("reviewWorkbench.errors.detail"));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailKey(null);
    setDetail(null);
    setDetailError(null);
    setDetailMode("view");
    setAnnotationResolutionDraft(null);
  }

  function openCreation(opener:HTMLButtonElement){creationOpenerRef.current=opener;closeDetail();
    setCreationGuidance(null);setCreationOpen(true);setError(null);}
  function closeCreation(){setCreationOpen(false);setCreationGuidance(null);}
  async function previewCreation(form:FormData){
    const locales=page?.elements[0]?.applicability.generation_locales??[];
    const values=parseSignalSemanticContextCreateFormV1(form,locales);if(!values){setCreationGuidance(null);return;}
    setCreationGuidanceLoading(true);try{setCreationGuidance(await requestJson<CreationGuidance>(
      signalSemanticContextCreationGuidanceUrlV1({base,generationKey,values})));}
    catch(loadError){setError(loadError instanceof Error?loadError.message:t("reviewWorkbench.creation.invalid"));}
    finally{setCreationGuidanceLoading(false);}
  }
  async function createElement(form:FormData){
    const locales=page?.elements[0]?.applicability.generation_locales??[];
    const values=parseSignalSemanticContextCreateFormV1(form,locales);if(!values){setError(t("reviewWorkbench.creation.invalid"));return;}
    if(!beginMutation("create"))return;
    try{const result=await submitSignalSemanticContextCreateUiV1({request:requestJson,base,generationKey,values,
      idempotencyKey:idempotencyKey("create-element")}) as {collision?:boolean;element_key?:string};
      closeCreation();await Promise.all([loadPage(),onMutation()]);
      if(result.element_key&&result.collision){const button=creationOpenerRef.current;if(button)await openDetail(result.element_key,button);}}
    catch(mutationError){setError(mutationError instanceof Error?mutationError.message:t("reviewWorkbench.creation.invalid"));}
    finally{endMutation();}
  }

  async function refreshAfterMutation() {
    setPreflight(null);
    closeDetail();
    setSelected(new Map());
    setBulkApproveOpen(false);
    setLocaleAuthorityOpen(false);
    await Promise.all([loadPage(), onMutation()]);
  }

  async function approve(form: FormData) {
    if (!detail) return;
    const elementKey = detail.element.element_key;
    if (!beginMutation("approve")) return;
    try {
      const submitted = await submitSignalSemanticContextDeliberateApprovalFormUiV2({
        form, request: requestJson, base, generationKey, elementKey,
        idempotencyKey: idempotencyKey(`approve:${elementKey}`)
      });
      if (!submitted) { setError(t("errors.decision")); return; }
      await refreshAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("errors.decision"));
    } finally { endMutation(); }
  }

  async function bulkApprove(form: FormData) {
    const elements = page?.elements ?? [];
    const keys = [...selected.keys()];
    if (!signalSemanticContextBoundedPendingSelectionV1({ selectedKeys: keys, elements })) {
      setError(t("reviewWorkbench.bulk.invalid"));
      return;
    }
    if (form.get("confirmation") !== "apply_shared_decision_basis_to_all_selected_elements") {
      setError(t("reviewWorkbench.bulk.confirmationRequired"));
      return;
    }
    if (!beginMutation("bulk")) return;
    try {
      const submitted = await submitSignalSemanticContextBulkApprovalFormUiV2({
        form, request: requestJson, base, generationKey, elementKeys: keys,
        idempotencyKey: idempotencyKey("bulk-approve")
      });
      if (!submitted) { setError(t("reviewWorkbench.bulk.invalid")); return; }
      await refreshAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("errors.decision"));
    } finally { endMutation(); }
  }

  async function decideLocaleAuthority(form: FormData, elementKeys: string[], permittedLocales: string[]) {
    if (!beginMutation("locale-authority")) return;
    try {
      const submitted = await submitSignalSemanticContextLocaleAuthorityFormUiV1({
        form, request: requestJson, base, generationKey, elementKeys, permittedLocales,
        idempotencyKey: idempotencyKey("locale-authority")
      });
      if (!submitted) { setError(t("reviewWorkbench.localeAuthority.invalid")); return; }
      await refreshAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("reviewWorkbench.localeAuthority.invalid"));
    } finally { endMutation(); }
  }

  async function reject(form: FormData) {
    if (!detail) return;
    const reason = String(form.get("reason")) as SignalSemanticContextReviewReasonUi;
    const rationale = String(form.get("rationale") ?? "").trim();
    const elementKey = detail.element.element_key;
    if (!beginMutation("reject")) return;
    try {
      await submitSignalSemanticContextGuidedRejectUiV1({
        request: requestJson,
        base,
        generationKey,
        elementKey,
        reason,
        rationale,
        idempotencyKey: idempotencyKey(`reject:${elementKey}`)
      });
      await refreshAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("reviewWorkbench.errors.reject"));
    } finally { endMutation(); }
  }

  async function correct(form: FormData) {
    if (!detail) return;
    const values=parseSignalSemanticContextOrdinaryEditFormV1(form,detail.element.applicability.generation_locales);
    if(!values){setError(t("reviewWorkbench.errors.correct"));return;}
    if (!beginMutation("correct")) return;
    try {
      await submitSignalSemanticContextOrdinaryCommandUiV1({request:requestJson,base,generationKey,
        elementKey:detail.element.element_key,elementVersion:detail.element.element_version,
        stateToken:detail.element.state_token,action:"save",values,idempotencyKey:idempotencyKey("ordinary-save")});
      await refreshAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("reviewWorkbench.errors.correct"));
    } finally { endMutation(); }
  }
  async function ordinaryAction(action:"undo"|"archive"|"restore"){
    if(!detail||!beginMutation(action))return;
    try{await submitSignalSemanticContextOrdinaryCommandUiV1({request:requestJson,base,generationKey,
      elementKey:detail.element.element_key,elementVersion:detail.element.element_version,
      stateToken:detail.element.state_token,action,...(action==="undo"?{targetVersion:detail.element.undo_target_version??undefined}:{}),
      idempotencyKey:idempotencyKey(`ordinary-${action}`)});
      await refreshAfterMutation();}
    catch(mutationError){setError(mutationError instanceof Error?mutationError.message:t("reviewWorkbench.errors.correct"));}
    finally{endMutation();}
  }

  async function annotate(form: FormData) {
    if (!detail) return;
    const annotationType = String(form.get("annotation_type")) as SignalSemanticContextAnnotationTypeUi;
    const related = String(form.get("related_element_key") ?? "").trim();
    if (!beginMutation("annotate")) return;
    try {
      await requestJson(`${base}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("annotate") },
        body: JSON.stringify({
          generation_key: generationKey,
          element_key: detail.element.element_key,
          annotation_key: annotationKey("review"),
          annotation_type: annotationType,
          reason: String(form.get("reason")),
          rationale: String(form.get("rationale") ?? "").trim(),
          related_element_keys: related ? [related] : []
        })
      });
      setDetail(await loadDetail(detail.element.element_key));
      setDetailMode("view");
      setPreflight(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("reviewWorkbench.errors.annotate"));
    } finally { endMutation(); }
  }

  function beginAnnotationResolution(annotation: ReviewAnnotation,
    resolution: SignalSemanticContextAnnotationResolutionUi,
    intent: SignalSemanticContextAnnotationResolutionIntentUi) {
    setAnnotationResolutionDraft({ annotation, resolution, intent });
    setDetailMode("resolve_annotation");
  }

  async function resolveAnnotation(form: FormData) {
    if (!detail || !annotationResolutionDraft) return;
    const draft=annotationResolutionDraft;
    if (!beginMutation(`${draft.intent}:${draft.annotation.annotation_key}`)) return;
    try {
      const submitted=await submitSignalSemanticContextAnnotationResolutionFormUiV1({
        form,intent:draft.intent,request:requestJson,base,generationKey,
        elementKey:detail.element.element_key,annotationKey:draft.annotation.annotation_key,
        resolution:draft.resolution,idempotencyKey:idempotencyKey(`${draft.intent}-annotation`)
      });
      if(!submitted){setError(t("reviewWorkbench.annotations.deliberate.invalid"));return;}
      setDetail(await loadDetail(detail.element.element_key));
      setPreflight(null);
      setDetailMode("view");setAnnotationResolutionDraft(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("reviewWorkbench.errors.annotate"));
    } finally { endMutation(); }
  }

  async function merge(form: FormData) {
    const elements = [...selected.values()];
    const targetKey = String(form.get("target_element_key") ?? "");
    const target = selected.get(targetKey);
    const sources = elements.filter((element) => element.element_key !== targetKey);
    const visibleElementKeys=(page?.elements??[]).map((element)=>element.element_key);
    if (!signalSemanticContextSelectionWithinVisiblePageV1({selectedKeys:[...selected.keys()],visibleElementKeys})
      ||!target || !sources.length || elements.some((element) => element.element_kind !== target.element_kind)) {
      setError(t("reviewWorkbench.merge.sameKindRequired"));
      return;
    }
    if (!beginMutation("merge")) return;
    try {
      const sourceDetails = await Promise.all(sources.map((source) => loadDetail(source.element_key)));
      const missingAnnotationKeys: Record<string, string> = {};
      sourceDetails.forEach((sourceDetail) => {
        const matching = sourceDetail.review_annotations.some((annotation) =>
          annotation.state === "open" && annotation.annotation_type === "near_duplicate"
          && annotation.related_elements.some((related) => related.element_key === targetKey));
        if (!matching) missingAnnotationKeys[sourceDetail.element.element_key] = annotationKey("merge-candidate");
      });
      await submitSignalSemanticContextMergeUiV1({
        request: requestJson,
        base,
        generationKey,
        targetElementKey: targetKey,
        sourceElementKeys: sources.map((source) => source.element_key),
        missingAnnotationKeys,
        reason: String(form.get("reason")) as SignalSemanticContextReviewReasonUi,
        rationale: String(form.get("rationale") ?? "").trim(),
        targetCorrection: {
          canonical_key: String(form.get("canonical_key") ?? "").trim(),
          display_text: String(form.get("display_text") ?? "").trim(),
          scope: String(form.get("scope") ?? "").trim() || null,
          relation_kind: target.relation_kind,
          relation_target_key: target.relation_target_key
        },
        idempotencyKey: idempotencyKey("merge")
      });
      setMergeOpen(false);
      await refreshAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : t("reviewWorkbench.errors.merge"));
    } finally { endMutation(); }
  }

  async function loadPublicationPreflight() {
    setPreflightLoading(true); setError(null); setErrorRecovery("none");
    try {
      setPreflight(await requestJson<PublicationPreflight>(
        `${base}/publish/preflight?generation_key=${encodeURIComponent(generationKey)}`));
    } catch (preflightError) {
      setError(preflightError instanceof Error ? preflightError.message : t("reviewWorkbench.errors.preflight"));
      setErrorRecovery("preflight");
    } finally { setPreflightLoading(false); }
  }

  const range = signalSemanticContextReviewRangeV1({
    total: page?.total ?? 0,
    visible: page?.elements.length ?? 0,
    pageIndex: cursorHistory.length,
    pageSize: page?.page_size ?? 20
  });
  const filterOptions = useMemo(() => ({
    kinds: Object.keys(page?.facets.element_kinds ?? {}).sort(),
    scopes: Object.keys(page?.facets.scopes ?? {}).sort()
  }), [page]);
  const selectedElements = [...selected.values()];
  const selectedKinds = new Set(selectedElements.map((element) => element.element_kind));
  const selectedPending = signalSemanticContextBoundedPendingSelectionV1({
    selectedKeys: [...selected.keys()], elements: page?.elements ?? []
  });
  const selectedLocaleEligible = selectedElements.length >= 1 && selectedElements.length <= 15
    && selectedElements.every((element) => element.disposition === "approved"
      && element.locale === null && element.locale_authority.state === "unresolved");
  const selectedPermittedLocales = selectedElements[0]?.applicability.generation_locales ?? [];
  const reviewStateCounts=page?page.facets.review_states:EMPTY_REVIEW_STATE_COUNTS;

  return <div className="semantic-context-review" data-loading={loading || undefined}>
    <div className="semantic-context-review__header">
      <div><strong>{t("reviewWorkbench.title")}</strong><p>{t("reviewWorkbench.body")}</p></div>
      <div className="semantic-context-pack__drawer-actions"><AdminStatus state="good">
        {t("reviewWorkbench.readyCount", { count: reviewStateCounts.ready })}</AdminStatus>
        <AdminStatus state={reviewStateCounts.exception > 0 ? "warning" : "good"}>
          {t("reviewWorkbench.exceptionCount", { count: reviewStateCounts.exception })}</AdminStatus>
        <AdminStatus state="not_available">
          {t("reviewWorkbench.resolvedCount", { count: reviewStateCounts.resolved })}</AdminStatus>
        {reviewWritable?<button className="admin-button admin-button--primary" disabled={Boolean(busy)}
          onClick={(event)=>openCreation(event.currentTarget)} type="button"><Plus aria-hidden size={14}/>
          {t("reviewWorkbench.creation.action")}</button>:null}</div>
    </div>

    <div className="semantic-context-review__toolbar" role="search">
      <label className="semantic-context-review__search"><MagnifyingGlass aria-hidden size={15}/>
        <span className="sr-only">{t("filters.search")}</span><input className="workspace-control"
          onChange={(event) => setQuery(event.target.value)} placeholder={t("reviewWorkbench.searchPlaceholder")}
          type="search" value={query}/></label>
      <FilterSelect label={t("filters.status")} onChange={(value) => setFilters((current) => ({ ...current, disposition: value as Filters["disposition"] }))} value={filters.disposition}>
        <option value="all">{t("filters.allStatuses")}</option>{["pending", "approved", "rejected", "merged", "archived"].map((state) => <option key={state} value={state}>{t(`states.${state}`)}</option>)}
      </FilterSelect>
      <FilterSelect label={t("filters.type")} onChange={(value) => setFilters((current) => ({ ...current, kind: value }))} value={filters.kind}>
        <option value="all">{t("filters.allTypes")}</option>{filterOptions.kinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind, t)}</option>)}
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.scope")} onChange={(value) => setFilters((current) => ({ ...current, scope: value }))} value={filters.scope}>
        <option value="all">{t("reviewWorkbench.filters.allScopes")}</option>{filterOptions.scopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.locale")} onChange={(value) => setFilters((current) => ({ ...current, locale: value as Filters["locale"] }))} value={filters.locale}>
        <option value="all">{t("reviewWorkbench.filters.allLocales")}</option><option value="explicit">{t("reviewWorkbench.filters.explicitLocale")}</option><option value="global">{t("reviewWorkbench.filters.globalLocale")}</option><option value="unassigned">{t("reviewWorkbench.filters.unassignedLocale")}</option><option value="needs_review">{t("reviewWorkbench.filters.localeAttention")}</option>
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.evidence")} onChange={(value) => setFilters((current) => ({ ...current, evidence: value as Filters["evidence"] }))} value={filters.evidence}>
        <option value="all">{t("reviewWorkbench.filters.allEvidence")}</option><option value="needs_review">{t("reviewWorkbench.filters.evidenceAttention")}</option><option value="one_source_only">{t("reviewWorkbench.filters.oneSource")}</option><option value="supports_only">{t("reviewWorkbench.filters.supportsOnly")}</option><option value="has_limits">{t("reviewWorkbench.filters.hasLimits")}</option><option value="has_contradictions">{t("reviewWorkbench.filters.hasContradictions")}</option>
      </FilterSelect>
      <FilterSelect label={t("reviewWorkbench.filters.duplicates")} onChange={(value) => setFilters((current) => ({ ...current, duplicate: value as Filters["duplicate"] }))} value={filters.duplicate}>
        <option value="all">{t("reviewWorkbench.filters.allDuplicates")}</option><option value="exact">{t("reviewWorkbench.filters.exactDuplicate")}</option><option value="display">{t("reviewWorkbench.filters.displayDuplicate")}</option>
      </FilterSelect>
    </div>

    {error ? <Feedback message={error}
      onRetry={errorRecovery === "page" ? () => void loadPage()
        : errorRecovery === "preflight" ? () => void loadPublicationPreflight() : undefined}
      retryLabel={t("actions.retry")}/> : null}
    {loading ? <ReviewSkeleton label={t("reviewWorkbench.loading")}/> : null}

    {!loading && page ? <>
      <div className="semantic-context-review__count-row">
        <span aria-live="polite">{t("reviewWorkbench.resultRange", { start: range.start, end: range.end, total: page.total })}</span>
        {reviewWritable && page.elements.some((element) => element.disposition === "pending") ? <button className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={() => {
          const next = new Map<string,ReviewElement>(); page.elements.filter((element) => element.disposition === "pending").forEach((element) => next.set(element.element_key, element)); setSelected(next);
        }} type="button">{t("selection.allVisible")}</button> : null}
      </div>
      {selected.size ? <div className="semantic-context-review__selection" aria-live="polite">
        <strong>{t("selection.count", { count: selected.size })}</strong><span>{t("reviewWorkbench.bulk.explicitOnly")}</span>
        <div><button className="admin-button" disabled={Boolean(busy)} onClick={() => setSelected(new Map())} type="button">{t("selection.clear")}</button>
          <button className="admin-button" disabled={selected.size < 2 || Boolean(busy)} onClick={() => setMergeOpen(true)} type="button"><ArrowsMerge aria-hidden size={14}/>{t("reviewWorkbench.merge.action")}</button>
          <button className="admin-button" disabled={!selectedLocaleEligible || Boolean(busy)} onClick={() => setLocaleAuthorityOpen(true)} type="button"><ShieldCheck aria-hidden size={14}/>{t("reviewWorkbench.localeAuthority.action")}</button>
          <button className="admin-button admin-button--primary" disabled={!selectedPending || Boolean(busy)} onClick={() => setBulkApproveOpen(true)} type="button"><Check aria-hidden size={14}/>{t("selection.approve")}</button></div>
      </div> : null}
      {bulkApproveOpen ? <BulkApprovalPanel busy={busy} elements={selectedElements}
        onCancel={() => setBulkApproveOpen(false)} onSubmit={(form) => void bulkApprove(form)} t={t}/> : null}
      {localeAuthorityOpen ? <LocaleAuthorityPanel busy={busy} elements={selectedElements}
        permittedLocales={selectedPermittedLocales} onCancel={() => setLocaleAuthorityOpen(false)}
        onSubmit={(form) => void decideLocaleAuthority(form,[...selected.keys()],selectedPermittedLocales)} t={t}/> : null}
      {mergeOpen ? <MergePanel busy={busy} elements={selectedElements} onCancel={() => setMergeOpen(false)} onSubmit={(form) => void merge(form)} sameKind={selectedKinds.size === 1} t={t}/> : null}
      <div className="semantic-context-review__list">
        {page.elements.map((element) => <article className="semantic-context-review__row" key={element.element_key}>
          <label className="semantic-context-review__row-select"><input aria-label={t("selection.one", { name: element.display_text })} checked={selected.has(element.element_key)} disabled={!reviewWritable || element.disposition === "merged" || Boolean(busy)} onChange={(event) => {
            const next = new Map(selected); if (event.target.checked) next.set(element.element_key, element); else next.delete(element.element_key); setSelected(next);
          }} type="checkbox"/></label>
          <button className="semantic-context-review__row-button" onClick={(event) => void openDetail(element.element_key, event.currentTarget)} type="button">
            <span className="semantic-context-review__row-main"><strong>{element.display_text}</strong><small>{element.canonical_key}</small></span>
            <span className="semantic-context-review__row-meta"><span>{kindLabel(element.element_kind, t)}</span><span>{element.scope ?? t("values.workspaceScope")}</span><span>{applicabilityLabel(element, t)}</span></span>
            <span className="semantic-context-review__row-signals"><DispositionStatus element={element} t={t}/><span>{t("values.evidenceCount", { count: element.evidence_summary.count })}</span>{element.attention.needs_locale_review ? <AttentionChip>{t("reviewWorkbench.attention.locale")}</AttentionChip> : null}{element.attention.needs_evidence_review ? <AttentionChip>{t("reviewWorkbench.attention.evidence")}</AttentionChip> : null}</span>
          </button>
        </article>)}
        {!page.elements.length ? <div className="admin-empty"><strong>{t("filters.emptyTitle")}</strong><p>{t("reviewWorkbench.emptyBody")}</p></div> : null}
      </div>
      <nav aria-label={t("reviewWorkbench.pagination.label")} className="semantic-context-review__pagination">
        <button className="admin-button" disabled={!cursorHistory.length} onClick={() => { setSelected(new Map()); setCursorHistory((history) => { const previous = history.slice(0, -1); setCursor(history.at(-1) ?? null); return previous; }); }} type="button"><ArrowLeft aria-hidden size={15}/>{t("reviewWorkbench.pagination.previous")}</button>
        <span>{t("reviewWorkbench.pagination.page", { page: cursorHistory.length + 1 })}</span>
        <button className="admin-button" disabled={!page.next_cursor} onClick={() => { setSelected(new Map()); setCursorHistory((history) => [...history, cursor]); setCursor(page.next_cursor); }} type="button">{t("reviewWorkbench.pagination.next")}<ArrowRight aria-hidden size={15}/></button>
      </nav>
    </> : null}

    <PublicationBoundary loading={preflightLoading} locale={locale} onLoad={() => void loadPublicationPreflight()} preflight={preflight} t={t}/>

    {creationOpen?<WorkspaceDrawer ariaLabel={t("reviewWorkbench.creation.title")} closeLabel={t("actions.close")}
      eyebrow={t("reviewWorkbench.creation.eyebrow")} onClose={()=>!busy&&closeCreation()}
      returnFocusRef={creationOpenerRef} title={t("reviewWorkbench.creation.title")}>
      <CreateElementForm busy={busy} generationLocales={page?.elements[0]?.applicability.generation_locales??[]}
        generationMarkets={page?.elements[0]?.applicability.generation_markets??[]} guidance={creationGuidance}
        guidanceLoading={creationGuidanceLoading} onCancel={closeCreation} onOpenExisting={(key)=>{
          const opener=creationOpenerRef.current;closeCreation();if(opener)void openDetail(key,opener);}}
        onPreview={(form)=>void previewCreation(form)} onSubmit={(form)=>void createElement(form)} t={t}/>
    </WorkspaceDrawer>:null}

    {detailKey ? <WorkspaceDrawer ariaLabel={t("review.aria", { name: detail?.element.display_text ?? t("reviewWorkbench.loadingDetail") })}
      closeLabel={t("actions.close")} eyebrow={detail ? `${kindLabel(detail.element.element_kind, t)} · ${t(signalSemanticContextElementStateKeyV1(detail.element))}` : t("reviewWorkbench.loadingDetail")}
      onClose={() => !busy && closeDetail()} returnFocusRef={reviewOpenerRef} title={detail?.element.display_text ?? t("reviewWorkbench.loadingDetail")}>
      <div onKeyDown={(event) => {
        if (handleSignalSemanticContextDecisionKeyV1({key:event.key,busy:Boolean(busy),mode:detailMode,
          cancel:()=>{setDetailMode("view");setAnnotationResolutionDraft(null);}})) { event.preventDefault(); event.stopPropagation(); return; }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && activeFormRef.current) { event.preventDefault(); activeFormRef.current.requestSubmit(); }
      }}>
        {error ? <div className="semantic-context-review__feedback" role="alert"><Warning aria-hidden size={16}/><span>{error}</span></div> : null}
        {detailError ? <Feedback message={detailError} onRetry={() => void retryDetail()} retryLabel={t("actions.retry")}/>
          : detailLoading || !detail ? <ReviewSkeleton label={t("reviewWorkbench.loadingDetail")}/>
            : <ElementReviewDetail activeFormRef={activeFormRef} busy={busy} detail={detail} locale={locale} mode={detailMode}
              annotationResolutionDraft={annotationResolutionDraft}
              onAnnotate={(form) => void annotate(form)} onApprove={(form) => void approve(form)}
              onCorrect={(form) => void correct(form)} onOrdinaryAction={(action)=>void ordinaryAction(action)}
              onMode={setDetailMode} onReject={(form) => void reject(form)}
              onBeginResolution={beginAnnotationResolution} onCancelResolution={()=>{setDetailMode("view");setAnnotationResolutionDraft(null);}}
              onLocaleAuthority={(form) => void decideLocaleAuthority(form,[detail.element.element_key],
                detail.element.applicability.generation_locales)}
              onResolve={(form) => void resolveAnnotation(form)} reviewWritable={reviewWritable} t={t}/>}
      </div>
    </WorkspaceDrawer> : null}
  </div>;
}

function FilterSelect({ children, label, onChange, value }: { children: React.ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return <label><span>{label}</span><select className="workspace-control" onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}

function ReviewSkeleton({ label }: { label: string }) {
  return <div aria-busy="true" aria-live="polite" className="semantic-context-review__skeleton" role="status"><span className="sr-only">{label}</span><i/><i/><i/></div>;
}

function Feedback({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel: string }) {
  return <div className="semantic-context-review__feedback" role="alert"><Warning aria-hidden size={18}/><span>{message}</span>{onRetry ? <button className="admin-button admin-button--compact" onClick={onRetry} type="button">{retryLabel}</button> : null}</div>;
}

function AttentionChip({ children }: { children: React.ReactNode }) {
  return <span className="semantic-context-review__attention"><Warning aria-hidden size={13}/>{children}</span>;
}

function applicabilityLabel(element: ReviewElement, t: ReturnType<typeof useTranslations>) {
  if (element.applicability.effective_state === "workspace_inherited") {
    return t("values.inheritedWorkspace", { markets: element.applicability.generation_markets.join(" + ") });
  }
  if (element.applicability.effective_state === "explicit_global") {
    return t("reviewWorkbench.localeAuthority.dispositions.global");
  }
  return element.applicability.locale ?? element.locale ?? t("values.noLocale");
}

/** @internal Keeps lifecycle state authoritative over the semantic disposition in UI labels. */
export function signalSemanticContextElementStateKeyV1(
  element: Pick<ReviewElement, "disposition" | "lifecycle_state">
) {
  return element.lifecycle_state === "archived" ? "states.archived" : `states.${element.disposition}`;
}

function DispositionStatus({ element, t }: { element: ReviewElement; t: ReturnType<typeof useTranslations> }) {
  const disposition = element.disposition;
  if (element.lifecycle_state !== "archived" && element.automatic_policy?.outcome === "exception") {
    return <AdminStatus state="warning">{t("states.exception")}</AdminStatus>;
  }
  if (element.lifecycle_state !== "archived" && element.automatic_policy?.outcome === "ready") {
    return <AdminStatus state="good">{t("states.ready")}</AdminStatus>;
  }
  return <AdminStatus state={element.lifecycle_state === "archived" ? "not_available" : disposition === "approved" ? "good" : disposition === "rejected" ? "danger" : disposition === "merged" ? "not_available" : "warning"}>{t(signalSemanticContextElementStateKeyV1(element))}</AdminStatus>;
}

/** @internal Exported for the browser-representative deliberate-decision interaction contract test. */
export function ElementReviewDetail({ activeFormRef, annotationResolutionDraft, busy, detail, locale, mode,
  onAnnotate, onApprove, onBeginResolution, onCancelResolution, onCorrect,
  onOrdinaryAction=()=>undefined, onLocaleAuthority, onMode, onReject, onResolve,
  reviewWritable, t }: {
  activeFormRef: React.MutableRefObject<HTMLFormElement | null>;
  annotationResolutionDraft: AnnotationResolutionDraft | null;
  busy: string | null;
  detail: ReviewDetail;
  locale: string;
  mode: DetailMode;
  onAnnotate: (form: FormData) => void;
  onApprove: (form: FormData) => void;
  onBeginResolution: (annotation: ReviewAnnotation,resolution:SignalSemanticContextAnnotationResolutionUi,
    intent:SignalSemanticContextAnnotationResolutionIntentUi) => void;
  onCancelResolution: () => void;
  onCorrect: (form: FormData) => void;
  onOrdinaryAction?:(action:"undo"|"archive"|"restore")=>void;
  onLocaleAuthority: (form: FormData) => void;
  onMode: (mode: DetailMode) => void;
  onReject: (form: FormData) => void;
  onResolve: (form: FormData) => void;
  reviewWritable: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const element = detail.element;
  if (mode === "approve") return <MutationForm busy={busy} formRef={activeFormRef}
    onCancel={() => onMode("view")} onSubmit={onApprove} submitLabel={t("actions.approve")} t={t}
    title={t("reviewWorkbench.approve.title")}><p className="admin-drawer-form__intro">
      {t("reviewWorkbench.approve.body")}</p><input name="confirmation" type="hidden"
        value="approve_selected_semantic_context_element"/><ReasonFields autoFocusRationale t={t}/></MutationForm>;
  if (mode === "correct") return <MutationForm busy={busy} formRef={activeFormRef} onCancel={() => onMode("view")} onSubmit={onCorrect} submitLabel={t("actions.saveCorrection")} t={t} title={t("reviewWorkbench.correction.title")}>
    <CorrectionFields element={element} t={t}/>
  </MutationForm>;
  if (mode === "reject") return <MutationForm busy={busy} danger formRef={activeFormRef} onCancel={() => onMode("view")} onSubmit={onReject} submitLabel={t("actions.reject")} t={t} title={t("reviewWorkbench.reject.title")}><p className="admin-drawer-form__intro">{t("reviewWorkbench.reject.body")}</p><ReasonFields autoFocusRationale t={t}/></MutationForm>;
  if (mode === "annotate") return <MutationForm busy={busy} formRef={activeFormRef} onCancel={() => onMode("view")} onSubmit={onAnnotate} submitLabel={t("reviewWorkbench.annotations.save")} t={t} title={t("reviewWorkbench.annotations.title")}>
    <label className="workspace-field"><span>{t("reviewWorkbench.annotations.type")}</span><select className="workspace-control" name="annotation_type" required>{SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_UI.map((type) => <option key={type} value={type}>{t(`reviewWorkbench.annotations.types.${type}`)}</option>)}</select></label>
    <label className="workspace-field"><span>{t("reviewWorkbench.annotations.related")}</span><input className="workspace-control" name="related_element_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*"/><small>{t("reviewWorkbench.annotations.relatedHelp")}</small></label><ReasonFields autoFocusRationale t={t}/>
  </MutationForm>;
  if(mode==="resolve_annotation"&&annotationResolutionDraft){const repair=annotationResolutionDraft.intent==="repair";
    return <MutationForm busy={busy} danger={repair} formRef={activeFormRef} onCancel={onCancelResolution}
      onSubmit={onResolve} submitLabel={t(repair?"reviewWorkbench.annotations.deliberate.repairSubmit":
        "reviewWorkbench.annotations.deliberate.resolveSubmit")} t={t}
      title={t(repair?"reviewWorkbench.annotations.deliberate.repairTitle":
        "reviewWorkbench.annotations.deliberate.resolveTitle")}>
      <p className="admin-drawer-form__intro">{t(repair?"reviewWorkbench.annotations.deliberate.repairBody":
        "reviewWorkbench.annotations.deliberate.resolveBody")}</p>
      <dl className="semantic-context-pack__definition"><div><dt>{t("reviewWorkbench.annotations.deliberate.resolution")}</dt>
        <dd>{t(`reviewWorkbench.annotations.resolutions.${annotationResolutionDraft.resolution}`)}</dd></div></dl>
      <ReasonFields autoFocusRationale t={t}/>
      <label className="semantic-context-review__confirmation"><input name="confirmation" required type="checkbox"
        value={repair?"repair_semantic_context_annotation_resolution_basis":
          "resolve_semantic_context_annotation_with_deliberate_basis"}/>
        <span>{t(repair?"reviewWorkbench.annotations.deliberate.repairConfirmation":
          "reviewWorkbench.annotations.deliberate.resolveConfirmation")}</span></label>
    </MutationForm>;
  }
  if (mode === "locale_authority") return <MutationForm busy={busy} formRef={activeFormRef}
    onCancel={() => onMode("view")} onSubmit={onLocaleAuthority}
    submitLabel={t("reviewWorkbench.localeAuthority.confirm")} t={t}
    title={t("reviewWorkbench.localeAuthority.title")}>
    <LocaleAuthorityFields permittedLocales={element.applicability.generation_locales} t={t}/>
  </MutationForm>;

  return <div className="semantic-context-pack__review semantic-context-review__detail">
    <div className="semantic-context-pack__review-summary"><DispositionStatus element={element} t={t}/><p>{t("review.proposedAt", { date: formatAdminDate(element.provenance.proposed_at, locale, { dateStyle: "medium", timeStyle: "short" }) })}</p><small>{t("reviewWorkbench.lineage", { version: detail.lineage.element_version, origin: originLabel(detail.lineage.origin, t) })}</small></div>
    <dl className="semantic-context-pack__definition"><div><dt>{t("fields.canonicalKey")}</dt><dd>{element.canonical_key}</dd></div><div><dt>{t("fields.locale")}</dt><dd>{applicabilityLabel(element, t)}</dd></div><div><dt>{t("fields.scope")}</dt><dd>{element.scope ?? t("values.workspaceScope")}</dd></div><div><dt>{t("fields.relation")}</dt><dd>{element.relation_kind ? `${t(`relations.${element.relation_kind}`)}${element.relation_target_key ? ` → ${element.relation_target_key}` : ""}` : t("values.noRelation")}</dd></div></dl>
    {detail.decision_basis.state !== "not_applicable" ? <DecisionBasisHistory basis={detail.decision_basis}
      locale={locale} t={t}/> : null}
    {element.locale_authority.basis || element.locale_authority.state === "workspace_inherited" ? <section className="semantic-context-review__lineage">
      <h3>{t("reviewWorkbench.localeAuthority.history")}</h3><div><ShieldCheck aria-hidden size={14}/>
        <span>{t(`reviewWorkbench.localeAuthority.dispositions.${element.locale_authority.state}`)}</span>
        {element.locale_authority.basis ? <small>{element.locale_authority.basis.rationale}</small>
          : <small>{t("reviewWorkbench.localeAuthority.inheritedBody", { markets: element.applicability.generation_markets.join(" + ") })}</small>}</div></section> : null}
    {element.automatic_policy?.outcome === "exception" ? <section className="semantic-context-review__lineage">
      <h3>{t("reviewWorkbench.automaticReasons.title")}</h3>{element.automatic_policy.reasons.map((reason) =>
        <div key={reason}><Warning aria-hidden size={14}/><span>
          {t(`reviewWorkbench.automaticReasons.${knownAutomaticReason(reason)}`)}</span></div>)}</section> : null}
    <AnnotationsList busy={busy} items={detail.review_annotations} onBeginResolution={onBeginResolution} t={t}/>
    {detail.merge_lineage.length ? <section className="semantic-context-review__lineage"><h3>{t("reviewWorkbench.merge.lineage")}</h3>{detail.merge_lineage.map((entry) => <div key={`${entry.source_element_key}:${entry.target_element_key}`}><ArrowsMerge aria-hidden size={14}/><span>{entry.source_element_key} → {entry.target_element_key}</span><small>{entry.rationale}</small></div>)}</section> : null}
    <section className="semantic-context-review__evidence"><div><h3>{t("reviewWorkbench.evidence.title")}</h3><p>{t("reviewWorkbench.evidence.body")}</p></div>{detail.evidence.map((source, index) => <article className="semantic-context-review__source" key={`${source.source_type}-${source.section_label}-${index}`}><header><div><span>{sourceKindLabel(source.source_type, t)}</span><strong>{source.source_title}</strong><small>{source.section_label}</small></div><AdminStatus state={source.current_state === "current" ? "good" : source.current_state === "inactive" ? "warning" : "not_available"}>{t(`reviewWorkbench.evidence.states.${source.current_state}`)}</AdminStatus></header><div className="semantic-context-review__source-meta"><span>{t("reviewWorkbench.evidence.relation", { relation: t(`evidenceRelations.${source.relation}`) })}</span><span>{t("reviewWorkbench.evidence.generationValidated")}</span></div><div className="semantic-context-review__source-context"><strong>{t(source.source_context.label === "operator_authored_input" ? "reviewWorkbench.evidence.operatorContextLabel" : "reviewWorkbench.evidence.contextLabel")}</strong><p>{source.source_context.preview ?? t("reviewWorkbench.evidence.contextUnavailable")}</p><small>{t(source.source_context.label === "operator_authored_input" ? "reviewWorkbench.evidence.operatorNotCitation" : "reviewWorkbench.evidence.notCitation")}</small></div></article>)}{!detail.evidence.length ? <p>{t("review.noEvidence")}</p> : null}</section>
    {reviewWritable && element.disposition !== "merged" ? <div className="semantic-context-pack__drawer-actions">{element.disposition === "pending" ? <button className="admin-button" disabled={Boolean(busy)} onClick={() => onMode("annotate")} type="button"><NotePencil aria-hidden size={14}/>{t("reviewWorkbench.annotations.action")}</button> : null}{element.disposition === "approved" && element.locale === null && element.locale_authority.state === "unresolved" ? <button className="admin-button" disabled={Boolean(busy)} onClick={() => onMode("locale_authority")} type="button"><ShieldCheck aria-hidden size={14}/>{t("reviewWorkbench.localeAuthority.action")}</button> : null}{element.lifecycle_state==="active"&&element.disposition==="approved"?<><button className="admin-button" disabled={Boolean(busy)} onClick={() => onMode("correct")} type="button"><PencilSimple aria-hidden size={14}/>{t("actions.edit")}</button>{element.undo_target_version!==null?<button className="admin-button" disabled={Boolean(busy)} onClick={()=>onOrdinaryAction("undo")} type="button">{t("actions.undo")}</button>:null}<button className="admin-button" disabled={Boolean(busy)} onClick={()=>onOrdinaryAction("archive")} type="button">{t("actions.archive")}</button></>:element.lifecycle_state==="archived"?<button className="admin-button" disabled={Boolean(busy)} onClick={()=>onOrdinaryAction("restore")} type="button">{t("actions.restore")}</button>:null}{element.disposition === "pending" ? <><button className="admin-button admin-button--danger" disabled={Boolean(busy)} onClick={() => onMode("reject")} type="button"><X aria-hidden size={14}/>{t("actions.reject")}</button><button className="admin-button admin-button--primary" disabled={Boolean(busy)} onClick={() => onMode("approve")} type="button"><Check aria-hidden size={14}/>{t("actions.approve")}</button></> : null}</div> : null}
  </div>;
}

function DecisionBasisHistory({ basis, locale, t }: { basis: ReviewDetail["decision_basis"]; locale: string;
  t: ReturnType<typeof useTranslations> }) {
  return <section className="semantic-context-review__lineage"><h3>{t("reviewWorkbench.decisionBasis.title")}</h3>
    {basis.state === "complete" ? <div><ShieldCheck aria-hidden size={14}/><span>
      {basis.reason ? t(`reviewWorkbench.reasons.${basis.reason}`) : t("reviewWorkbench.decisionBasis.unavailable")}
    </span><small>{basis.rationale}</small>{basis.decided_at ? <small>
      {t("reviewWorkbench.decisionBasis.decidedAt", { date: formatAdminDate(basis.decided_at, locale) })}
    </small> : null}</div> : <div><Warning aria-hidden size={14}/><span>
      {t("reviewWorkbench.decisionBasis.historicalMissing")}</span></div>}
  </section>;
}

/** @internal Browser-representative simple creation surface. */
export function CreateElementForm({busy,generationLocales,generationMarkets,guidance,guidanceLoading,onCancel,
  onOpenExisting,onPreview,onSubmit,t}:{busy:string|null;generationLocales:string[];generationMarkets:string[];
  guidance:CreationGuidance|null;guidanceLoading:boolean;onCancel:()=>void;onOpenExisting:(key:string)=>void;
  onPreview:(form:FormData)=>void;onSubmit:(form:FormData)=>void;t:ReturnType<typeof useTranslations>}){
  const formRef=useRef<HTMLFormElement|null>(null);const timerRef=useRef<number|null>(null);
  function schedulePreview(){if(timerRef.current!==null)window.clearTimeout(timerRef.current);
    timerRef.current=window.setTimeout(()=>{if(formRef.current)onPreview(new FormData(formRef.current));},250);}
  useEffect(()=>()=>{if(timerRef.current!==null)window.clearTimeout(timerRef.current);},[]);
  const exact=guidance?.exact_collision??null;
  return <form aria-busy={Boolean(busy)||guidanceLoading} className="admin-drawer-form" onInput={schedulePreview}
    onKeyDown={(event)=>{if(handleSignalSemanticContextCreationKeyV1({key:event.key,busy:Boolean(busy),cancel:onCancel}))
      event.preventDefault();}}
    onSubmit={(event)=>{event.preventDefault();if(!busy&&!exact)onSubmit(new FormData(event.currentTarget));}} ref={formRef}>
    <p className="admin-drawer-form__intro">{t("reviewWorkbench.creation.body")}</p>
    <label className="workspace-field"><span>{t("filters.type")}</span><select autoFocus className="workspace-control"
      defaultValue="" name="element_kind" required><option disabled value="">{t("reviewWorkbench.creation.chooseType")}</option>
      {["identity_term","alias","product","feature","surface","category","need","benefit","friction",
        "usage_occasion","competitor_term","locale_variant","exclusion","homonym","ambiguous_term",
        "abstention_rule","positive_anchor","negative_anchor","boundary_anchor","typed_relation"].map((kind)=><option
          key={kind} value={kind}>{kindLabel(kind,t)}</option>)}</select></label>
    <label className="workspace-field"><span>{t("fields.displayText")}</span><input className="workspace-control"
      maxLength={500} name="display_text" required/></label>
    <label className="workspace-field"><span>{t("fields.canonicalKey")}</span><input className="workspace-control"
      maxLength={200} name="canonical_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*" required/></label>
    <label className="workspace-field"><span>{t("fields.scope")}</span><input className="workspace-control" maxLength={200}
      name="scope"/></label>
    <label className="workspace-field"><span>{t("fields.relation")}</span><select className="workspace-control"
      defaultValue="" name="relation_kind"><option value="">{t("values.noRelation")}</option>
      {["is_a","part_of","surface_of","competes_with","associated_with"].map((kind)=><option key={kind}
        value={kind}>{t(`relations.${kind}`)}</option>)}</select></label>
    <label className="workspace-field"><span>{t("fields.relationTarget")}</span><input className="workspace-control"
      name="relation_target_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*"/></label>
    <label className="workspace-field"><span>{t("reviewWorkbench.localeAuthority.disposition")}</span>
      <select className="workspace-control" defaultValue="workspace_inherited" name="applicability">
        <option value="workspace_inherited">{t("actions.inheritedApplicability",{markets:generationMarkets.join(" + ")})}</option>
        <option value="explicit_global">{t("actions.explicitGlobal")}</option>
        {generationLocales.map((locale)=><option key={locale} value={`locale:${locale}`}>{locale}</option>)}</select></label>
    {guidanceLoading?<div aria-live="polite" role="status"><CircleNotch aria-hidden className="icon--spin" size={14}/>
      {t("reviewWorkbench.creation.checking")}</div>:null}
    {exact?<div className="semantic-context-review__feedback" role="status"><Warning aria-hidden size={16}/><div>
      <strong>{t("reviewWorkbench.creation.exactTitle")}</strong><span>{exact.display_text} · {kindLabel(exact.element_kind,t)} · {
        exact.applicability_state==="explicit_global"?t("reviewWorkbench.localeAuthority.dispositions.global"):
          exact.locale??t("values.inheritedWorkspace",{markets:generationMarkets.join(" + ")})}</span>
      <button className="admin-button admin-button--compact" onClick={()=>onOpenExisting(exact.element_key)} type="button">
        {t("reviewWorkbench.creation.openExisting")}</button></div></div>:null}
    {guidance?.suggestions.length?<section className="semantic-context-review__lineage"><h3>
      {t("reviewWorkbench.creation.suggestionsTitle")}</h3>{guidance.suggestions.map((item)=><div key={item.element_key}>
        <span>{item.display_text} · {kindLabel(item.element_kind,t)} · {item.applicability_state==="explicit_global"
          ?t("reviewWorkbench.localeAuthority.dispositions.global"):item.locale??t("values.inheritedWorkspace",
            {markets:generationMarkets.join(" + ")})}</span><button className="admin-button admin-button--compact"
          onClick={()=>onOpenExisting(item.element_key)} type="button">{t("reviewWorkbench.creation.openExisting")}</button></div>)}</section>:null}
    <div className="semantic-context-pack__drawer-actions"><button className="admin-button" disabled={Boolean(busy)}
      onClick={onCancel} type="button">{t("actions.cancel")}</button><button className="admin-button admin-button--primary"
      disabled={Boolean(busy)||Boolean(exact)} type="submit">{t("actions.saveCorrection")}</button></div>
  </form>;
}

function MutationForm({ busy, children, danger, formRef, onCancel, onSubmit, submitLabel, t, title }: {
  busy: string | null;
  children: React.ReactNode;
  danger?: boolean;
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  onCancel: () => void;
  onSubmit: (form: FormData) => void;
  submitLabel: string;
  t: ReturnType<typeof useTranslations>;
  title: string;
}) {
  return <form aria-busy={Boolean(busy)} className="admin-drawer-form" onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(new FormData(event.currentTarget)); }} ref={formRef}>
    <div className="semantic-context-review__form-heading"><strong>{title}</strong><small>{t("reviewWorkbench.shortcuts")}</small></div>{children}<div className="semantic-context-pack__drawer-actions"><button className="admin-button" disabled={Boolean(busy)} onClick={onCancel} type="button">{t("actions.cancelEdit")}</button><button className={`admin-button ${danger ? "admin-button--danger" : "admin-button--primary"}`} disabled={Boolean(busy)} type="submit">{submitLabel}</button></div>
  </form>;
}

function CorrectionFields({ element, t }: { element: ReviewElement; t: ReturnType<typeof useTranslations> }) {
  return <><label className="workspace-field"><span>{t("fields.displayText")}</span><input autoFocus className="workspace-control" defaultValue={element.display_text} maxLength={500} name="display_text" required/></label><label className="workspace-field"><span>{t("fields.canonicalKey")}</span><input className="workspace-control" defaultValue={element.canonical_key} maxLength={200} name="canonical_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*" required/></label><label className="workspace-field"><span>{t("fields.scope")}</span><input className="workspace-control" defaultValue={element.scope ?? ""} maxLength={200} name="scope"/></label><label className="workspace-field"><span>{t("fields.relation")}</span><select className="workspace-control" defaultValue={element.relation_kind ?? ""} name="relation_kind"><option value="">{t("values.noRelation")}</option>{["is_a", "part_of", "surface_of", "competes_with", "associated_with"].map((kind) => <option key={kind} value={kind}>{t(`relations.${kind}`)}</option>)}</select></label><label className="workspace-field"><span>{t("fields.relationTarget")}</span><input className="workspace-control" defaultValue={element.relation_target_key ?? ""} name="relation_target_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*"/></label><label className="workspace-field"><span>{t("reviewWorkbench.localeAuthority.disposition")}</span><select className="workspace-control" defaultValue="preserve" name="applicability"><option value="preserve">{t("actions.preserveApplicability")}</option><option value="workspace_inherited">{t("actions.inheritedApplicability",{markets:element.applicability.generation_markets.join(" + ")})}</option><option value="explicit_global">{t("actions.explicitGlobal")}</option>{element.applicability.generation_locales.map((locale)=><option key={locale} value={`locale:${locale}`}>{locale}</option>)}</select></label></>;
}

function ReasonFields({ autoFocusRationale=false, t }: { autoFocusRationale?: boolean; t: ReturnType<typeof useTranslations> }) {
  return <><label className="workspace-field"><span>{t("reviewWorkbench.reason")}</span><select className="workspace-control" defaultValue="" name="reason" required><option disabled value="">{t("reviewWorkbench.reasonPlaceholder")}</option>{SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_UI.map((reason) => <option key={reason} value={reason}>{t(`reviewWorkbench.reasons.${reason}`)}</option>)}</select></label><label className="workspace-field"><span>{t("reviewWorkbench.rationale")}</span><textarea autoFocus={autoFocusRationale} className="workspace-control" maxLength={2000} minLength={1} name="rationale" onInput={(event) => event.currentTarget.setCustomValidity(
    [...event.currentTarget.value.trim().normalize("NFC")].length>1000?t("reviewWorkbench.rationaleLimit"):"")}
    required rows={4}/></label></>;
}

function LocaleAuthorityFields({ permittedLocales, t }: { permittedLocales: string[];
  t: ReturnType<typeof useTranslations> }) {
  return <>
    <p className="admin-drawer-form__intro">{t("reviewWorkbench.localeAuthority.body")}</p>
    <label className="workspace-field"><span>{t("reviewWorkbench.localeAuthority.disposition")}</span>
      <select autoFocus className="workspace-control" defaultValue="" name="disposition" required>
        <option disabled value="">{t("reviewWorkbench.localeAuthority.chooseDisposition")}</option>
        <option value="global">{t("reviewWorkbench.localeAuthority.dispositions.global")}</option>
        <option value="locale_specific">{t("reviewWorkbench.localeAuthority.dispositions.locale_specific")}</option>
      </select></label>
    <label className="workspace-field"><span>{t("reviewWorkbench.localeAuthority.locale")}</span>
      <select className="workspace-control" defaultValue="" name="locale">
        <option value="">{t("reviewWorkbench.localeAuthority.noLocale")}</option>
        {permittedLocales.map((value) => <option key={value} value={value}>{value}</option>)}
      </select><small>{t("reviewWorkbench.localeAuthority.localeHelp")}</small></label>
    <ReasonFields t={t}/>
    <label className="semantic-context-review__confirmation"><input name="confirmation" required
      type="checkbox" value="apply_semantic_context_locale_authority_decision"/>
      <span>{t("reviewWorkbench.localeAuthority.confirmation")}</span></label>
  </>;
}

/** @internal Exported for the governed batch interaction contract test. */
export function LocaleAuthorityPanel({ busy, elements, permittedLocales, onCancel, onSubmit, t }: {
  busy: string | null; elements: ReviewElement[]; permittedLocales: string[];
  onCancel: () => void; onSubmit: (form: FormData) => void; t: ReturnType<typeof useTranslations>;
}) {
  return <form aria-busy={Boolean(busy)} className="semantic-context-review__merge-panel"
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); if (!busy) onCancel(); } }}
    onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(new FormData(event.currentTarget)); }}>
    <div><strong>{t("reviewWorkbench.localeAuthority.batchTitle")}</strong>
      <p>{t("reviewWorkbench.localeAuthority.batchBody", { count: elements.length })}</p></div>
    <ul className="semantic-context-review__bulk-list">{elements.map((element) =>
      <li key={element.element_key}><strong>{element.display_text}</strong><span>{element.element_kind}</span></li>)}</ul>
    <LocaleAuthorityFields permittedLocales={permittedLocales} t={t}/>
    <div className="semantic-context-pack__drawer-actions"><button className="admin-button"
      disabled={Boolean(busy)} onClick={onCancel} type="button">{t("actions.cancel")}</button>
      <button className="admin-button admin-button--primary" disabled={Boolean(busy)} type="submit">
        <ShieldCheck aria-hidden size={14}/>{t("reviewWorkbench.localeAuthority.confirm")}</button></div>
  </form>;
}

function BulkApprovalPanel({ busy, elements, onCancel, onSubmit, t }: { busy: string | null;
  elements: ReviewElement[]; onCancel: () => void; onSubmit: (form: FormData) => void;
  t: ReturnType<typeof useTranslations> }) {
  return <form aria-busy={Boolean(busy)} className="semantic-context-review__merge-panel"
    onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(new FormData(event.currentTarget)); }}>
    <div><strong>{t("reviewWorkbench.bulk.title")}</strong><p>{t("reviewWorkbench.bulk.body", { count: elements.length })}</p></div>
    <ul className="semantic-context-review__bulk-list">{elements.map((element) =>
      <li key={element.element_key}><strong>{element.display_text}</strong><span>{element.element_kind}</span></li>)}</ul>
    <ReasonFields t={t}/>
    <label className="semantic-context-review__confirmation"><input name="confirmation" required
      type="checkbox" value="apply_shared_decision_basis_to_all_selected_elements"/>
      <span>{t("reviewWorkbench.bulk.confirmation", { count: elements.length })}</span></label>
    <div className="semantic-context-pack__drawer-actions"><button className="admin-button" disabled={Boolean(busy)}
      onClick={onCancel} type="button">{t("actions.cancel")}</button><button className="admin-button admin-button--primary"
      disabled={Boolean(busy)} type="submit"><Check aria-hidden size={14}/>{t("reviewWorkbench.bulk.confirm")}</button></div>
  </form>;
}

/** @internal Exported for the deliberate annotation-resolution interaction contract test. */
export function AnnotationsList({ busy, items, onBeginResolution, t }: { busy: string | null; items: ReviewAnnotation[];
  onBeginResolution:(annotation:ReviewAnnotation,resolution:SignalSemanticContextAnnotationResolutionUi,
    intent:SignalSemanticContextAnnotationResolutionIntentUi)=>void;t:ReturnType<typeof useTranslations> }) {
  if (!items.length) return null;
  return <section className="semantic-context-review__annotations"><h3>{t("reviewWorkbench.annotations.history")}</h3>{items.map((annotation) => <article key={annotation.annotation_key}><div><strong>{t(`reviewWorkbench.annotations.types.${annotation.annotation_type}`)}</strong><AdminStatus state={annotation.state === "resolved" ? "good" : "warning"}>{t(`reviewWorkbench.annotations.states.${annotation.state}`)}</AdminStatus></div><p>{annotation.rationale}</p>{annotation.related_elements.length ? <small>{annotation.related_elements.map((element) => element.display_text).join(", ")}</small> : null}{annotation.state === "open" ? <div>{signalSemanticContextAnnotationResolutionsV1(annotation.annotation_type).map((resolution) => <button className="admin-button admin-button--compact" disabled={Boolean(busy)} key={resolution} onClick={() => onBeginResolution(annotation,resolution,"resolve")} type="button">{t(`reviewWorkbench.annotations.resolutions.${resolution}`)}</button>)}</div> : <><small>{t(`reviewWorkbench.annotations.resolutions.${annotation.resolution}`)}</small>{annotation.resolution_basis.state==="missing_historical"&&annotation.resolution?<div className="semantic-context-review__feedback"><Warning aria-hidden size={14}/><span>{t("reviewWorkbench.annotations.deliberate.basisMissing")}</span><button className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={()=>onBeginResolution(annotation,annotation.resolution!,"repair")} type="button">{t("reviewWorkbench.annotations.deliberate.repairAction")}</button></div>:annotation.resolution_basis.state==="complete"?<small>{t("reviewWorkbench.annotations.deliberate.basisComplete")}</small>:null}</>}</article>)}</section>;
}

function MergePanel({ busy, elements, onCancel, onSubmit, sameKind, t }: { busy: string | null; elements: ReviewElement[]; onCancel: () => void; onSubmit: (form: FormData) => void; sameKind: boolean; t: ReturnType<typeof useTranslations> }) {
  const [targetKey, setTargetKey] = useState(elements[0]?.element_key ?? "");
  const target = elements.find((element) => element.element_key === targetKey) ?? elements[0];
  return <form className="semantic-context-review__merge" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); if (!busy) onCancel(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!busy) event.currentTarget.requestSubmit(); }
  }} onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(new FormData(event.currentTarget)); }}>
    <div className="semantic-context-review__merge-head"><div><strong>{t("reviewWorkbench.merge.title")}</strong><p>{t("reviewWorkbench.merge.body", { count: elements.length })}</p></div><button aria-label={t("actions.close")} className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={onCancel} type="button"><X aria-hidden size={14}/></button></div>
    {!sameKind ? <div className="semantic-context-review__feedback"><Warning aria-hidden size={16}/><span>{t("reviewWorkbench.merge.crossKind")}</span></div> : null}
    <div className="semantic-context-review__merge-grid"><label className="workspace-field"><span>{t("reviewWorkbench.merge.target")}</span><select autoFocus className="workspace-control" name="target_element_key" onChange={(event) => setTargetKey(event.target.value)} value={targetKey}>{elements.map((element) => <option key={element.element_key} value={element.element_key}>{element.display_text}</option>)}</select></label><div className="semantic-context-review__merge-consequences"><strong>{t("reviewWorkbench.merge.preview")}</strong><p>{t("reviewWorkbench.merge.targetConsequence", { name: target?.display_text ?? "—" })}</p><p>{t("reviewWorkbench.merge.sourceConsequence", { count: Math.max(0, elements.length - 1) })}</p></div></div>
    {target ? <div className="semantic-context-review__merge-correction" key={target.element_key}><label className="workspace-field"><span>{t("fields.displayText")}</span><input className="workspace-control" defaultValue={target.display_text} maxLength={500} name="display_text" required/></label><label className="workspace-field"><span>{t("fields.canonicalKey")}</span><input className="workspace-control" defaultValue={target.canonical_key} name="canonical_key" pattern="[a-z0-9]+(?:[._:-][a-z0-9]+)*" required/></label><label className="workspace-field"><span>{t("fields.scope")}</span><input className="workspace-control" defaultValue={target.scope ?? ""} maxLength={200} name="scope"/></label></div> : null}<ReasonFields t={t}/><div className="semantic-context-pack__drawer-actions"><button className="admin-button" disabled={Boolean(busy)} onClick={onCancel} type="button">{t("actions.cancel")}</button><button className="admin-button admin-button--primary" disabled={!sameKind || Boolean(busy)} type="submit"><ArrowsMerge aria-hidden size={14}/>{t("reviewWorkbench.merge.confirm")}</button></div>
  </form>;
}

function PublicationBoundary({ loading, locale, onLoad, preflight, t }: { loading: boolean; locale: string; onLoad: () => void; preflight: PublicationPreflight | null; t: ReturnType<typeof useTranslations> }) {
  const counts = preflight ? [
    ["pending", preflight.counts.pending ?? 0], ["approved", preflight.counts.approved ?? 0],
    ["rejected", preflight.counts.rejected ?? 0], ["merged", preflight.counts.merged ?? 0],
    ["open_annotations", preflight.counts.open_annotations ?? 0],
    ["canonical_collisions", preflight.counts.canonical_collisions ?? 0],
    ["locale_market_required_unresolved", preflight.counts.locale_market_required_unresolved ?? 0],
    ["blockers", preflight.blockers.length]
  ] as const : [];
  return <section className="semantic-context-review__publication"><div className="semantic-context-review__publication-head"><div><strong>{t("reviewWorkbench.publication.title")}</strong><p>{t("reviewWorkbench.publication.body")}</p></div><button className="admin-button" disabled={loading} onClick={onLoad} type="button">{loading ? <CircleNotch aria-hidden className="icon--spin" size={14}/> : <ShieldCheck aria-hidden size={14}/>} {t("reviewWorkbench.publication.preflight")}</button></div>{preflight ? <><div className="semantic-context-review__publication-counts">{counts.map(([key, value]) => <div key={key}><span>{t(`reviewWorkbench.publication.counts.${key}`)}</span><strong>{formatAdminNumber(value, locale)}</strong></div>)}</div><div className="semantic-context-review__publication-digests">{Object.entries(preflight.digest_refs).map(([key, value]) => <span key={key}>{key}: <code>{value}</code></span>)}</div>{preflight.blockers.length ? <div className="semantic-context-review__feedback"><Warning aria-hidden size={16}/><span>{preflight.blockers.map((blocker) => t(`reviewWorkbench.publication.blockers.${knownPublicationBlocker(blocker)}`)).join(" · ")}</span></div> : <div className="semantic-context-review__publication-ready"><Eye aria-hidden size={16}/><span>{t("reviewWorkbench.publication.confirmationBoundary")}</span></div>}</> : null}</section>;
}

function knownPublicationBlocker(blocker: string) {
  const known = new Set(["generation_not_effective_draft", "proposal_run_nonterminal", "executable_outbox", "reserved_budget", "pending_elements", "unresolved_correction", "zero_approved_elements", "decision_basis_missing", "annotation_resolution_basis_missing", "locale_market_required_unresolved", "open_uncertainty", "open_near_duplicate", "locale_unresolved", "competitive_unit_unresolved", "open_annotation", "canonical_collision", "invalid_current_evidence", "invalid_relation_target", "authority_drift", "provider_lineage_not_current"]);
  return known.has(blocker) ? blocker : "unknown";
}

function knownAutomaticReason(reason: string) {
  const known = new Set(["evidence_missing", "evidence_invalid", "evidence_limited",
    "evidence_contradictory", "semantic_collision", "relation_target_unresolved",
    "locale_required", "locale_not_in_parent_envelope", "locale_specific_requires_operator_review"]);
  return known.has(reason) ? reason : "unknown";
}

function kindLabel(kind: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["identity_term", "alias", "product", "feature", "surface", "category", "need", "benefit", "friction", "usage_occasion", "competitor_term", "locale_variant", "exclusion", "homonym", "ambiguous_term", "abstention_rule", "positive_anchor", "negative_anchor", "boundary_anchor", "typed_relation"]);
  return known.has(kind) ? t(`kinds.${kind}`) : t("kinds.other");
}

function sourceKindLabel(kind: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["brand_os_profile", "brand_os_product", "brand_os_competitor", "brand_os_seed_term", "knowledge_source", "knowledge_chunk", "knowledge_assertion", "semantic_context_operator_input"]);
  return known.has(kind) ? t(`sources.${kind}`) : t("sources.authority");
}

function originLabel(origin: string, t: ReturnType<typeof useTranslations>) {
  const known = new Set(["provider_proposal", "automatic_policy", "operator_correction", "operator_decision", "operator_merge", "operator_created"]);
  return known.has(origin) ? t(`origins.${origin}`) : t("origins.other");
}
