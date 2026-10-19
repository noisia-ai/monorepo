"use client";

import type {
  SignalSemanticCurrentAssertionV1,
  SignalSemanticReviewQueueItemV1
} from "@noisia/db";
import type {
  SignalSemanticConfidenceBandV1,
  SignalSemanticQueueStateV1,
  SignalSemanticScopeV1
} from "@noisia/query-engine";
import {
  ArrowRight,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Database,
  Funnel,
  MagicWand,
  SlidersHorizontal,
  SpinnerGap,
  Stack,
  WarningCircle,
  X as XIcon
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WorkspaceSelect,
  WorkspaceSelectField,
  type WorkspaceSelectOption
} from "@/components/admin/WorkspaceSelect";
import { SignalMetricHelp } from "@/components/signal-v2/SignalMetricHelp";
import { SignalMentionDetailDrawer } from "@/components/signal-v2/SignalV2Mentions";
import { SignalSourceIcon } from "@/components/signal-v2/SignalSourceIcon";
import {
  WorkspaceControlsPanel,
  WorkspaceDrawer,
  WorkspaceStatus
} from "@/components/workspace/WorkspaceShell";
import type { AdminWorkspaceSource } from "@/lib/data/admin-workspace";
import { fetchSharedSignalJson } from "@/lib/data-os/signal-client-fetch";
import type { SignalMentionRecordV1 } from "@/lib/data-os/signal-workspace-serving";

type ReviewQueueResponse = {
  contract_version: string;
  workspace_id: string;
  governed_entities: Array<{
    scope: Exclude<SignalSemanticScopeV1, "unattributed">;
    entity_type: string;
    entity_id: string | null;
    entity_label: string;
  }>;
  reconciliation: {
    included_root_count: number;
    state_counts: Record<SignalSemanticQueueStateV1, number>;
    candidate_assertion_count: number;
    candidate_counts_by_scope: Record<SignalSemanticScopeV1, number>;
    candidate_counts_by_confidence: Record<SignalSemanticConfidenceBandV1, number>;
    reconciled: true;
  };
  page: {
    limit: number;
    returned: number;
    total_filtered: number;
    next_cursor: string | null;
    queue_digest: string;
  };
  records: SignalSemanticReviewQueueItemV1[];
};

type HistoryResponse = {
  assertion_id: string;
  events: Array<{
    id: string;
    action: "approved" | "rejected" | "superseded";
    previous_review_status: string;
    next_review_status: string;
    previous_eligibility_status: string;
    next_eligibility_status: string;
    reviewer_user_id: string;
    review_policy_key: string;
    review_policy_version: string;
    rationale_hash: string;
    created_at: string;
  }>;
};

type Filters = {
  state: SignalSemanticQueueStateV1;
  scope: "all" | SignalSemanticScopeV1;
  confidence: "all" | SignalSemanticConfidenceBandV1;
  platform: string;
  source: string;
  start: string;
  end: string;
};

type ActionMode =
  | { kind: "approve" | "reject"; assertion: SignalSemanticCurrentAssertionV1 }
  | { kind: "correct"; assertion: SignalSemanticCurrentAssertionV1 }
  | { kind: "create" };

type SemanticReviewQueueProps = {
  sources: AdminWorkspaceSource[];
  workspaceId: string;
};

type FocusedMentionResponse = {
  record: SignalMentionRecordV1;
};

type ResolutionPreflightResponse = {
  contract_version: "signal-semantic-resolution-preflight-v2";
  read_only: true;
  writes_performed: false;
  jobs_enqueued: 0;
  provider_calls: 0;
  spend_usd: "0.000000";
  population: {
    generation: number;
    snapshot_digest: string;
    population_digest: string;
    reconciled_at: string;
  };
  counts: {
    accepted_roots: number;
    quality_excluded: number;
    quality_unknown: number;
    incomplete_provenance: number;
    retention_blocked: number;
    retention_expired: number;
    retention_unknown: number;
    licensing_unknown: number;
    licensing_denied: number;
    licensing_expired: number;
    llm_processing_eligible: number;
    already_resolved: number;
    unresolved: number;
    deterministic: number;
    ambiguous: number;
    needs_context: number;
  };
  provider: {
    provider: "anthropic";
    model: string;
    pricing_version: string;
    input_usd_per_million_tokens: string;
    output_usd_per_million_tokens: string;
  };
  estimate: {
    mention_count: number;
    provider_batch_count: number;
    provider_batch_item_limit: number;
    estimated_input_tokens: number;
    estimated_output_tokens: number;
    estimated_cost_micro_usd: string;
    estimated_cost_usd: string;
    hard_cap_micro_usd: string;
    hard_cap_usd: string;
    confirmation_required: boolean;
    confirmation_threshold_usd: number;
    within_hard_cap: boolean;
  };
  runtime: {
    queue_configured: boolean;
    worker_alive: boolean;
    recovery_ready: boolean;
    active_outbox_count: number;
    dead_letter_count: number;
  };
  confirmation: {
    required: boolean;
    threshold_usd: number;
    hard_cap_operator_supplied: true;
  };
  blocking_reasons: string[];
  ready: boolean;
  preflight_digest: string;
};

type ResolutionRunResponse = {
  run_id:string;status:"queued"|"running"|"applying"|"completed"|"partial"|"failed"|"canceling"|"canceled";
  model_version:string;pricing_version:string|null;total_items:number;completed_items:number;failed_items:number;
  child_batch_count:number;completed_child_batch_count:number;failed_child_batch_count:number;
  canceled_child_batch_count:number;estimated_cost_usd:string;actual_cost_usd:string;hard_cap_usd:string;
  hard_cap_headroom_micro_usd:string;provider_succeeded_items:number;provider_errored_items:number;
  provider_canceled_items:number;provider_expired_items:number;active_outbox_count:number;dead_letter_count:number;
  error_code:string|null;children:Array<{ordinal:number;status:string;item_count:number;completed_items:number;
    failed_items:number;provider_status:string;estimated_cost_usd:string;reserved_cost_usd:string;
    actual_cost_usd:string;error_code:string|null}>;
};

type ResolutionStartResponse = {
  state: "prepared" | "already_prepared" | "confirmation_required";
  run?: {
    run_id?: string;
    id?: string;
    status: string;
    total_items?: number;
    child_batch_count: number;
  };
  preflight: ResolutionPreflightResponse;
};

const DEFAULT_FILTERS: Filters = {
  state: "candidate_pending",
  scope: "all",
  confidence: "all",
  platform: "all",
  source: "all",
  start: "",
  end: ""
};

const PAGE_LIMIT = 30;

export function SemanticReviewQueue({ sources, workspaceId }: SemanticReviewQueueProps) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const requestedMentionId = searchParams.get("mention");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filterDraft, setFilterDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [payload, setPayload] = useState<ReviewQueueResponse | null>(null);
  const [records, setRecords] = useState<SignalSemanticReviewQueueItemV1[]>([]);
  const [selectedMentionId, setSelectedMentionId] = useState<string | null>(null);
  const [focusedMentionId, setFocusedMentionId] = useState<string | null>(requestedMentionId);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [historyAssertion, setHistoryAssertion] = useState<SignalSemanticCurrentAssertionV1 | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [resolutionRun, setResolutionRun] = useState<ResolutionRunResponse | null>(null);
  const [resolutionAvailable, setResolutionAvailable] = useState<boolean | null>(null);
  const [resolutionNotice, setResolutionNotice] = useState<"nothing" | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionFeedbackDismissed, setResolutionFeedbackDismissed] = useState(false);
  const [isResolutionStarting, setIsResolutionStarting] = useState(false);
  const [isResolutionMutating,setIsResolutionMutating]=useState(false);
  const [resolutionFlightOpen, setResolutionFlightOpen] = useState(false);
  const [hardCapUsd, setHardCapUsd] = useState("");
  const [resolutionPreflight, setResolutionPreflight] = useState<ResolutionPreflightResponse | null>(null);
  const [isPreflightLoading, setIsPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [resolutionConfirmed, setResolutionConfirmed] = useState(false);
  const [previewMention, setPreviewMention] = useState<SignalMentionRecordV1 | null>(null);
  const [openingMentionId, setOpeningMentionId] = useState<string | null>(null);
  const [mentionPreviewError, setMentionPreviewError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const hasLoadedQueue = useRef(false);
  const refreshedResolutionRun = useRef<string | null>(null);

  const selectedRecord = useMemo(
    () => records.find((record) => record.mention_id === selectedMentionId) ?? records[0] ?? null,
    [records, selectedMentionId]
  );

  const loadQueue = useCallback(async ({ append = false, cursor = null }: {
    append?: boolean;
    cursor?: string | null;
  } = {}) => {
    const requestId = ++requestSequence.current;
    if (append) setIsLoadingMore(true);
    else if (hasLoadedQueue.current) setIsRefreshing(true);
    else setIsInitialLoading(true);
    setLoadError(null);

    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (focusedMentionId) {
      params.set("mention", focusedMentionId);
    } else {
      params.set("state", filters.state);
      if (filters.scope !== "all") params.set("proposed_scope", filters.scope);
      if (filters.confidence !== "all") params.set("confidence_band", filters.confidence);
      if (filters.platform !== "all") params.set("platform", filters.platform);
      if (filters.source !== "all") params.set("data_source_id", filters.source);
      if (filters.start) params.set("start", filters.start);
      if (filters.end) params.set("end", filters.end);
    }
    if (cursor) params.set("cursor", cursor);

    try {
      const url = `/api/data-os/signal/${workspaceId}/semantic-review?${params}`;
      const { body, ok } = await fetchSharedSignalJson<ReviewQueueResponse | { message?: string }>(url);
      if (!ok || !body || !("records" in body)) {
        throw new Error(body && "message" in body && body.message ? body.message : t("errors.load"));
      }
      if (requestId !== requestSequence.current) return;
      hasLoadedQueue.current = true;
      setPayload(body);
      setRecords((current) => append ? dedupeRecords([...current, ...body.records]) : body.records);
      setSelectedMentionId((current) => {
        if (append && current) return current;
        if (focusedMentionId && body.records.some((record) => record.mention_id === focusedMentionId)) {
          return focusedMentionId;
        }
        return body.records.some((record) => record.mention_id === current)
          ? current
          : body.records[0]?.mention_id ?? null;
      });
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setLoadError(error instanceof Error ? error.message : t("errors.load"));
    } finally {
      if (requestId === requestSequence.current) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [filters, focusedMentionId, t, workspaceId]);

  const loadResolution = useCallback(async () => {
    try {
      const { body, ok } = await fetchSharedSignalJson<{
        available?: boolean;
        run?: ResolutionRunResponse | null;
        message?: string;
      }>(`/api/data-os/signal/${workspaceId}/semantic-review/resolve`);
      if (!ok || !body || !("run" in body)) {
        throw new Error(body?.message ?? t("resolver.error"));
      }
      setResolutionAvailable(body.available !== false);
      setResolutionRun(body.run ?? null);
      if (body.run) setResolutionNotice(null);
      setResolutionError(null);
    } catch (error) {
      setResolutionAvailable(false);
      setResolutionError(error instanceof Error ? error.message : t("resolver.error"));
    }
  }, [t, workspaceId]);

  const loadResolutionPreflight = useCallback(async () => {
    if (!/^\d+(?:\.\d{1,6})?$/.test(hardCapUsd.trim())) {
      setPreflightError(t("resolver.hardCapInvalid"));
      return;
    }
    setIsPreflightLoading(true);
    setPreflightError(null);
    setResolutionPreflight(null);
    setResolutionConfirmed(false);
    try {
      const params = new URLSearchParams({ hard_cap_usd: hardCapUsd.trim() });
      const { body, ok } = await fetchSharedSignalJson<ResolutionPreflightResponse | { message?: string }>(
        `/api/data-os/signal/${workspaceId}/semantic-review/resolve/preflight?${params}`
      );
      if (!ok || !body || !("preflight_digest" in body)) {
        throw new Error(body && "message" in body && body.message ? body.message : t("resolver.preflightError"));
      }
      setResolutionPreflight(body);
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : t("resolver.preflightError"));
    } finally {
      setIsPreflightLoading(false);
    }
  }, [hardCapUsd, t, workspaceId]);

  const startResolution = useCallback(async () => {
    if (!resolutionPreflight?.ready || !resolutionConfirmed) return;
    setIsResolutionStarting(true);
    setResolutionFeedbackDismissed(false);
    setResolutionError(null);
    setResolutionNotice(null);
    try {
      const response = await fetch(
        `/api/data-os/signal/${workspaceId}/semantic-review/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID()
          },
          body: JSON.stringify({
            hard_cap_usd: resolutionPreflight.estimate.hard_cap_usd,
            preflight_digest: resolutionPreflight.preflight_digest,
            confirmation_accepted: true
          })
        }
      );
      const body = await response.json().catch(() => null) as
        | ResolutionStartResponse
        | { message?: string }
        | null;
      if (!response.ok || !body || !("state" in body)) {
        throw new Error(body && "message" in body && body.message ? body.message : t("resolver.error"));
      }
      if (body.state === "confirmation_required") throw new Error(t("resolver.confirmationRequired"));
      setResolutionFlightOpen(false);
      setResolutionPreflight(null);
      setResolutionConfirmed(false);
      await loadResolution();
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : t("resolver.error"));
    } finally {
      setIsResolutionStarting(false);
    }
  }, [loadResolution, resolutionConfirmed, resolutionPreflight, t, workspaceId]);

  const cancelResolution=useCallback(async()=>{
    if(!resolutionRun)return;
    setIsResolutionMutating(true);setResolutionError(null);
    try{
      const response=await fetch(`/api/data-os/signal/${workspaceId}/semantic-review/resolve`,{
        method:"DELETE",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
        body:JSON.stringify({run_id:resolutionRun.run_id})
      });
      if(!response.ok)throw new Error(t("resolver.cancelError"));
      await loadResolution();
    }catch(error){setResolutionError(error instanceof Error?error.message:t("resolver.cancelError"));}
    finally{setIsResolutionMutating(false);}
  },[loadResolution,resolutionRun,t,workspaceId]);

  const resumeResolution=useCallback(async(childOrdinal:number)=>{
    if(!resolutionRun)return;
    setIsResolutionMutating(true);setResolutionError(null);
    try{
      const response=await fetch(`/api/data-os/signal/${workspaceId}/semantic-review/resolve/resume`,{
        method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
        body:JSON.stringify({run_id:resolutionRun.run_id,child_ordinal:childOrdinal})
      });
      if(!response.ok)throw new Error(t("resolver.resumeError"));
      await loadResolution();
    }catch(error){setResolutionError(error instanceof Error?error.message:t("resolver.resumeError"));}
    finally{setIsResolutionMutating(false);}
  },[loadResolution,resolutionRun,t,workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQueue(), 120);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  useEffect(() => {
    setFocusedMentionId(requestedMentionId);
  }, [requestedMentionId]);

  useEffect(() => {
    void loadResolution();
  }, [loadResolution]);

  useEffect(() => {
    if (resolutionRun?.status !== "queued" && resolutionRun?.status !== "running") return;
    const timer = window.setInterval(() => void loadResolution(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadResolution, resolutionRun?.status]);

  useEffect(() => {
    if (!resolutionRun || !["completed", "partial", "failed"].includes(resolutionRun.status)) return;
    if (refreshedResolutionRun.current === resolutionRun.run_id) return;
    refreshedResolutionRun.current = resolutionRun.run_id;
    void loadQueue();
  }, [loadQueue, resolutionRun]);

  useEffect(() => {
    setActionMode(null);
    setActionError(null);
  }, [selectedMentionId]);

  const updateFilter = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const updateFilterDraft = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    setFilterDraft((current) => ({ ...current, [key]: value }));
  };

  const openFilters = () => {
    setFilterDraft(filters);
    setFiltersOpen(true);
  };

  const clearFilterDraft = () => {
    setFilterDraft((current) => ({ ...DEFAULT_FILTERS, state: current.state }));
  };

  const applyFilterDraft = () => {
    setFocusedMentionId(null);
    setFilters(filterDraft);
    setFiltersOpen(false);
  };

  const openHistory = async (assertion: SignalSemanticCurrentAssertionV1) => {
    setHistoryAssertion(assertion);
    setHistory(null);
    setHistoryError(null);
    setIsHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/data-os/signal/${workspaceId}/semantic-review/assertions/${assertion.id}/history`,
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => null) as HistoryResponse | { message?: string } | null;
      if (!response.ok || !body || !("events" in body)) {
        throw new Error(body && "message" in body && body.message ? body.message : t("errors.history"));
      }
      setHistory(body);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : t("errors.history"));
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const submitAction = async (input: {
    scope?: SignalSemanticScopeV1;
    entityId?: string | null;
    confidence?: number;
    rationale: string;
  }) => {
    if (!selectedRecord || !actionMode) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      let url = `/api/data-os/signal/${workspaceId}/semantic-review/assertions`;
      let body: Record<string, unknown>;
      if (actionMode.kind === "approve" || actionMode.kind === "reject") {
        url += `/${actionMode.assertion.id}/review`;
        body = { decision: actionMode.kind, rationale: input.rationale };
      } else if (actionMode.kind === "correct") {
        url += `/${actionMode.assertion.id}/supersede`;
        body = {
          scope: input.scope,
          entity_id: input.entityId ?? null,
          confidence: input.confidence,
          rationale: input.rationale
        };
      } else {
        body = {
          mention_id: selectedRecord.mention_id,
          scope: input.scope,
          entity_id: input.entityId ?? null,
          confidence: input.confidence,
          rationale: input.rationale
        };
      }
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? t("errors.action"));
      setActionMode(null);
      await loadQueue();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("errors.action"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMentionPreview = async (mentionId: string, publishedAt: string) => {
    setOpeningMentionId(mentionId);
    setMentionPreviewError(null);
    try {
      const publishedDate = new Date(publishedAt);
      const start = new Date(publishedDate);
      const end = new Date(publishedDate);
      start.setUTCDate(start.getUTCDate() - 1);
      end.setUTCDate(end.getUTCDate() + 1);
      const params = new URLSearchParams({
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        granularity: "day",
        compare: "none",
        mention: mentionId
      });
      const url = `/api/data-os/signal/${workspaceId}/admin-mentions?${params}`;
      const { body, ok } = await fetchSharedSignalJson<FocusedMentionResponse | { message?: string }>(url);
      if (!ok || !body || !("record" in body)) {
        throw new Error(body && "message" in body && body.message ? body.message : t("errors.mentionPreview"));
      }
      setPreviewMention(body.record);
    } catch (error) {
      setMentionPreviewError(error instanceof Error ? error.message : t("errors.mentionPreview"));
    } finally {
      setOpeningMentionId(null);
    }
  };

  const stateTabs: Array<{ state: SignalSemanticQueueStateV1; label: string }> = [
    { state: "candidate_pending", label: t("states.candidates") },
    { state: "unresolved", label: t("states.unresolved") },
    { state: "needs_context", label: t("states.needsContext") },
    { state: "current_approved", label: t("states.approved") },
    { state: "current_rejected", label: t("states.rejected") }
  ];

  const sourceOptions: WorkspaceSelectOption[] = [
    { value: "all", label: t("filters.allSources") },
    ...sources.map((source) => ({ value: source.id, label: source.name, description: source.provider }))
  ];
  const resolutionActive=Boolean(resolutionRun
    && ["queued","running","applying","canceling"].includes(resolutionRun.status));
  const activeFilterCount = countActiveFilters(filters);
  const draftFilterCount = countActiveFilters(filterDraft);
  const visibleState = focusedMentionId && selectedRecord ? selectedRecord.state : filters.state;

  return (
    <section className="admin-section admin-resource-section semantic-review" aria-busy={isRefreshing} id="semantic-review">
      <header className="admin-section__head">
        <div>
          <h2>{t("queueTitle")}</h2>
          <p>{t("queueSubtitle")}</p>
        </div>
        <div className="semantic-review__head-actions">
          {payload ? (
            <WorkspaceStatus tone="neutral">
              {t("queueCount", { count: payload.page.total_filtered })}
            </WorkspaceStatus>
          ) : null}
          <button
            aria-expanded={filtersOpen}
            className="admin-button semantic-review__filter-trigger"
            onClick={openFilters}
            type="button"
          >
            <Funnel aria-hidden size={15} />
            {t("filters.action")}
            {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
          </button>
          <button
            aria-busy={isResolutionStarting || resolutionActive}
            aria-describedby={resolutionAvailable === false || loadError ? "semantic-review-resolver-unavailable" : undefined}
            className="admin-button admin-button--primary semantic-review__resolve"
            disabled={resolutionAvailable !== true || !payload || Boolean(loadError) || isResolutionStarting || resolutionActive}
            onClick={() => setResolutionFlightOpen(true)}
            title={resolutionAvailable === false || loadError ? t("resolver.unavailable") : undefined}
            type="button"
          >
            <MagicWand aria-hidden size={15} />
            {t("resolver.action")}
          </button>
          {resolutionAvailable === false || loadError ? (
            <span className="sr-only" id="semantic-review-resolver-unavailable">
              {t("resolver.unavailable")}
            </span>
          ) : null}
        </div>
      </header>

      {!resolutionFeedbackDismissed && (resolutionRun || resolutionNotice || resolutionError) ? (
        <ResolutionFeedback
          error={resolutionError}
          locale={locale}
          notice={resolutionNotice}
          isMutating={isResolutionMutating}
          onCancel={()=>void cancelResolution()}
          onDismiss={() => setResolutionFeedbackDismissed(true)}
          onResume={(ordinal)=>void resumeResolution(ordinal)}
          run={resolutionRun}
        />
      ) : null}

      <div className="semantic-review__tabs-row">
        <div aria-label={t("states.label")} className="admin-tabs" role="tablist">
          {stateTabs.map((tab) => (
            <button
              aria-selected={visibleState === tab.state}
              className="admin-tabs__item"
              data-active={visibleState === tab.state}
              key={tab.state}
              onClick={() => {
                setFocusedMentionId(null);
                updateFilter("state", tab.state);
              }}
              role="tab"
              type="button"
            >
              {tab.label}
              {payload?.reconciliation.state_counts ? (
                <span>{payload.reconciliation.state_counts[tab.state] ?? 0}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {loadError && records.length > 0 ? (
        <div className="semantic-review__refresh-error" role="status">
          <WarningCircle aria-hidden size={15} />
          <span>{loadError}</span>
          <button onClick={() => void loadQueue()} type="button">{t("actions.retry")}</button>
        </div>
      ) : null}

      <div className="semantic-review__body">
        <div className="semantic-review__queue" aria-label={t("queueLabel")}>
          {isInitialLoading ? <SemanticQueueSkeleton /> : null}
          {!isInitialLoading && loadError && records.length === 0 ? (
            <div className="semantic-review__empty" role="alert">
              <WarningCircle aria-hidden size={22} />
              <strong>{t("errors.loadTitle")}</strong>
              <p>{loadError}</p>
              <button className="admin-button" onClick={() => void loadQueue()} type="button">{t("actions.retry")}</button>
            </div>
          ) : null}
          {!isInitialLoading && !loadError && records.length === 0 ? (
            <div className="semantic-review__empty">
              <Check aria-hidden size={22} />
              <strong>{t(`empty.${filters.state}.title`)}</strong>
              <p>{t(`empty.${filters.state}.body`)}</p>
            </div>
          ) : null}
          {records.map((record) => (
            <SemanticQueueRow
              isSelected={record.mention_id === selectedRecord?.mention_id}
              key={record.mention_id}
              locale={locale}
              onSelect={() => setSelectedMentionId(record.mention_id)}
              record={record}
            />
          ))}
          {payload?.page.next_cursor ? (
            <div className="semantic-review__load-more">
              <button
                className="admin-button"
                disabled={isLoadingMore}
                onClick={() => void loadQueue({ append: true, cursor: payload.page.next_cursor })}
                type="button"
              >
                {isLoadingMore ? t("actions.loadingMore") : t("actions.loadMore")}
              </button>
              <span>{t("pageProgress", { shown: records.length, total: payload.page.total_filtered })}</span>
            </div>
          ) : null}
        </div>

        <div className="semantic-review__detail">
          {isInitialLoading ? <SemanticDetailSkeleton /> : null}
          {!isInitialLoading && selectedRecord ? (
            <SemanticReviewDetail
              actionError={actionError}
              actionMode={actionMode}
              entities={payload?.governed_entities ?? []}
              isSubmitting={isSubmitting}
              locale={locale}
              onAction={setActionMode}
              onCancelAction={() => setActionMode(null)}
              onHistory={(assertion) => void openHistory(assertion)}
              onOpenMention={(mentionId, publishedAt) => void openMentionPreview(mentionId, publishedAt)}
              onSubmit={(input) => void submitAction(input)}
              openingMentionId={openingMentionId}
              mentionPreviewError={mentionPreviewError}
              record={selectedRecord}
            />
          ) : null}
          {!isInitialLoading && !selectedRecord ? (
            <div className="semantic-review__detail-empty">
              <Database aria-hidden size={22} />
              <strong>{t("detail.emptyTitle")}</strong>
              <p>{t("detail.emptyBody")}</p>
            </div>
          ) : null}
        </div>
      </div>

      {isRefreshing ? <div aria-label={t("refreshing")} className="semantic-review__progress" role="progressbar" /> : null}

      {filtersOpen ? (
        <WorkspaceControlsPanel
          ariaLabel={t("filters.label")}
          bodyClassName="semantic-review-controls__body"
          bodyOpenClassName="semantic-review-controls-open"
          closeLabel={t("actions.close")}
          count={draftFilterCount}
          footer={(
            <>
              <div>
                <strong>{t("filters.summary", { count: draftFilterCount })}</strong>
                <button disabled={draftFilterCount === 0} onClick={clearFilterDraft} type="button">{t("filters.clear")}</button>
              </div>
              <button onClick={applyFilterDraft} type="button">
                {t("filters.apply")}
                <ArrowRight aria-hidden size={13} />
              </button>
            </>
          )}
          icon={<SlidersHorizontal aria-hidden size={16} weight="bold" />}
          label={t("filters.tabLabel")}
          onClose={() => setFiltersOpen(false)}
          panelClassName="semantic-review-controls"
          portal
          scrimClassName="semantic-review-controls-scrim"
          tabIcon={<Funnel aria-hidden size={14} weight="fill" />}
          title={t("filters.controlsTitle")}
        >
          <section className="semantic-review-controls__group">
            <header>{t("filters.attributesGroup")}</header>
            <div>
              <WorkspaceSelectField
                ariaLabel={t("filters.scope")}
                label={t("filters.scope")}
                name="semantic-scope"
                onChange={(value) => updateFilterDraft("scope", value as Filters["scope"])}
                options={scopeOptions(t)}
                value={filterDraft.scope}
              />
              <WorkspaceSelectField
                ariaLabel={t("filters.confidence")}
                label={t("filters.confidence")}
                name="semantic-confidence"
                onChange={(value) => updateFilterDraft("confidence", value as Filters["confidence"])}
                options={confidenceOptions(t)}
                value={filterDraft.confidence}
              />
              <WorkspaceSelectField
                ariaLabel={t("filters.platform")}
                label={t("filters.platform")}
                name="semantic-platform"
                onChange={(value) => updateFilterDraft("platform", value)}
                options={platformOptions(t)}
                value={filterDraft.platform}
              />
              <WorkspaceSelectField
                ariaLabel={t("filters.source")}
                label={t("filters.source")}
                name="semantic-source"
                onChange={(value) => updateFilterDraft("source", value)}
                options={sourceOptions}
                value={filterDraft.source}
              />
            </div>
          </section>
          <section className="semantic-review-controls__group">
            <header>{t("filters.periodGroup")}</header>
            <div>
              <label className="workspace-field semantic-review-controls__date">
                <span>{t("filters.from")}</span>
                <input
                  className="workspace-control"
                  max={filterDraft.end || undefined}
                  onChange={(event) => updateFilterDraft("start", event.target.value)}
                  type="date"
                  value={filterDraft.start}
                />
              </label>
              <label className="workspace-field semantic-review-controls__date">
                <span>{t("filters.to")}</span>
                <input
                  className="workspace-control"
                  min={filterDraft.start || undefined}
                  onChange={(event) => updateFilterDraft("end", event.target.value)}
                  type="date"
                  value={filterDraft.end}
                />
              </label>
            </div>
          </section>
        </WorkspaceControlsPanel>
      ) : null}

      {historyAssertion ? (
        <WorkspaceDrawer
          ariaLabel={t("history.ariaLabel")}
          closeLabel={t("actions.close")}
          eyebrow={t("history.eyebrow")}
          onClose={() => setHistoryAssertion(null)}
          title={t("history.title")}
        >
          <div className="semantic-review-history">
            <div className="semantic-review-history__assertion">
              <ScopeBadge scope={historyAssertion.scope} />
              <strong>{historyAssertion.entity_label ?? scopeLabel(t, historyAssertion.scope)}</strong>
              <small>{t("history.version", { version: historyAssertion.assertion_version })}</small>
            </div>
            {isHistoryLoading ? <HistorySkeleton /> : null}
            {historyError ? <p className="semantic-review__inline-error" role="alert">{historyError}</p> : null}
            {history && history.events.length === 0 ? <p>{t("history.empty")}</p> : null}
            {history?.events.map((event) => (
              <div className="semantic-review-history__event" key={event.id}>
                <span aria-hidden />
                <div>
                  <strong>{t(`history.actions.${event.action}`)}</strong>
                  <p>{t("history.transition", {
                    from: reviewStatusLabel(t, event.previous_review_status),
                    to: reviewStatusLabel(t, event.next_review_status)
                  })}</p>
                  <small>{formatDate(event.created_at, locale)} · {t("history.policy", { version: event.review_policy_version })}</small>
                </div>
              </div>
            ))}
          </div>
        </WorkspaceDrawer>
      ) : null}

      {previewMention ? (
        <SignalMentionDetailDrawer
          onClose={() => setPreviewMention(null)}
          record={previewMention}
        />
      ) : null}

      {resolutionFlightOpen ? (
        <WorkspaceDrawer
          ariaLabel={t("resolver.flightAria")}
          bodyClassName="semantic-resolution-flight__body"
          closeLabel={t("actions.close")}
          eyebrow={t("resolver.flightEyebrow")}
          footer={(
            <div className="semantic-resolution-flight__footer">
              <button
                className="admin-button"
                disabled={isResolutionStarting}
                onClick={() => setResolutionFlightOpen(false)}
                type="button"
              >
                {t("resolver.confirmationCancel")}
              </button>
              <button
                className="admin-button admin-button--primary"
                disabled={!resolutionPreflight?.ready || !resolutionConfirmed || isResolutionStarting}
                onClick={() => void startResolution()}
                type="button"
              >
                {isResolutionStarting ? t("resolver.starting") : t("resolver.launch")}
              </button>
            </div>
          )}
          onClose={() => setResolutionFlightOpen(false)}
          panelClassName="semantic-resolution-flight"
          title={t("resolver.flightTitle")}
        >
          <p className="semantic-resolution-flight__intro">{t("resolver.flightBody")}</p>
          <div className="semantic-resolution-flight__cap">
            <label className="workspace-field">
              <span>{t("resolver.hardCap")}</span>
              <input
                className="workspace-control"
                inputMode="decimal"
                maxLength={24}
                onChange={(event) => {
                  setHardCapUsd(event.target.value);
                  setResolutionPreflight(null);
                  setPreflightError(null);
                  setResolutionConfirmed(false);
                }}
                placeholder={t("resolver.hardCapPlaceholder")}
                value={hardCapUsd}
              />
            </label>
            <button
              className="admin-button"
              disabled={isPreflightLoading || !hardCapUsd.trim()}
              onClick={() => void loadResolutionPreflight()}
              type="button"
            >
              {isPreflightLoading ? t("resolver.calculating") : t("resolver.calculate")}
            </button>
          </div>
          {preflightError ? <p className="semantic-review__inline-error" role="alert">{preflightError}</p> : null}
          {resolutionPreflight ? (
            <ResolutionFlightCard
              confirmed={resolutionConfirmed}
              locale={locale}
              onConfirmedChange={setResolutionConfirmed}
              preflight={resolutionPreflight}
            />
          ) : (
            <div className="semantic-resolution-flight__empty">
              <MagicWand aria-hidden size={20} />
              <strong>{t("resolver.flightEmptyTitle")}</strong>
              <p>{t("resolver.flightEmptyBody")}</p>
            </div>
          )}
        </WorkspaceDrawer>
      ) : null}
    </section>
  );
}

function ResolutionFlightCard({ confirmed, locale, onConfirmedChange, preflight }: {
  confirmed: boolean;
  locale: string;
  onConfirmedChange: (value: boolean) => void;
  preflight: ResolutionPreflightResponse;
}) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const excluded = preflight.counts.quality_excluded
    + preflight.counts.quality_unknown
    + preflight.counts.incomplete_provenance
    + preflight.counts.retention_blocked
    + preflight.counts.retention_expired
    + preflight.counts.retention_unknown
    + preflight.counts.licensing_unknown
    + preflight.counts.licensing_denied
    + preflight.counts.licensing_expired;
  return (
    <div className="semantic-resolution-flight__card">
      <div className="semantic-resolution-flight__status">
        <WorkspaceStatus tone={preflight.ready ? "success" : "danger"}>
          {preflight.ready ? t("resolver.ready") : t("resolver.blocked")}
        </WorkspaceStatus>
        <span>{t("resolver.freePreflightProof")}</span>
      </div>
      <dl className="semantic-resolution-flight__metrics">
        <div><dt>{t("resolver.population")}</dt><dd>{formatInteger(preflight.counts.accepted_roots, locale)}</dd></div>
        <div><dt>{t("resolver.eligible")}</dt><dd>{formatInteger(preflight.counts.llm_processing_eligible, locale)}</dd></div>
        <div><dt>{t("resolver.selected")}</dt><dd>{formatInteger(preflight.estimate.mention_count, locale)}</dd></div>
        <div><dt>{t("resolver.excluded")}</dt><dd>{formatInteger(excluded, locale)}</dd></div>
        <div><dt>{t("resolver.batches")}</dt><dd>{formatInteger(preflight.estimate.provider_batch_count, locale)}</dd></div>
        <div><dt>{t("resolver.estimate")}</dt><dd>{formatCurrencyString(preflight.estimate.estimated_cost_usd, locale)}</dd></div>
        <div><dt>{t("resolver.hardCap")}</dt><dd>{formatCurrencyString(preflight.estimate.hard_cap_usd, locale)}</dd></div>
        <div><dt>{t("resolver.unresolved")}</dt><dd>{formatInteger(preflight.counts.unresolved, locale)}</dd></div>
      </dl>
      <div className="semantic-resolution-flight__authority">
        <div><span>{t("resolver.model")}</span><strong>{preflight.provider.model}</strong></div>
        <div><span>{t("resolver.pricing")}</span><strong>{preflight.provider.pricing_version}</strong></div>
        <div><span>{t("resolver.worker")}</span><strong>{preflight.runtime.worker_alive ? t("resolver.available") : t("resolver.notAvailable")}</strong></div>
        <div><span>{t("resolver.recovery")}</span><strong>{preflight.runtime.recovery_ready ? t("resolver.available") : t("resolver.notAvailable")}</strong></div>
      </div>
      {preflight.blocking_reasons.length > 0 ? (
        <div className="semantic-resolution-flight__blockers" role="alert">
          <WarningCircle aria-hidden size={17} />
          <div>
            <strong>{t("resolver.blockersTitle")}</strong>
            <ul>{preflight.blocking_reasons.map((reason) => <li key={reason}>{t(`resolver.blockers.${reason}`)}</li>)}</ul>
          </div>
        </div>
      ) : null}
      {preflight.ready ? (
        <label className="semantic-resolution-flight__confirmation">
          <input
            checked={confirmed}
            onChange={(event) => onConfirmedChange(event.target.checked)}
            type="checkbox"
          />
          <span>{t("resolver.confirmationExplicit", {
            count: formatInteger(preflight.estimate.mention_count, locale),
            batches: formatInteger(preflight.estimate.provider_batch_count, locale),
            cap: formatCurrencyString(preflight.estimate.hard_cap_usd, locale)
          })}</span>
        </label>
      ) : null}
    </div>
  );
}

function ResolutionFeedback({ error,isMutating, locale, notice,onCancel, onDismiss,onResume, run }: {
  error: string | null;
  isMutating:boolean;
  locale: string;
  notice: "nothing" | null;
  onCancel:()=>void;
  onDismiss: () => void;
  onResume:(ordinal:number)=>void;
  run: ResolutionRunResponse | null;
}) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  if (error) {
    return <div className="semantic-review-resolution semantic-review-resolution--danger" role="alert"><WarningCircle aria-hidden size={16} /><div><strong>{error}</strong></div><DismissResolutionFeedback label={t("resolver.dismiss")} onDismiss={onDismiss} /></div>;
  }
  if (notice === "nothing") {
    return <div className="semantic-review-resolution semantic-review-resolution--success" role="status"><Check aria-hidden size={16} /><div><strong>{t("resolver.nothing")}</strong></div><DismissResolutionFeedback label={t("resolver.dismiss")} onDismiss={onDismiss} /></div>;
  }
  if (!run) return null;
  const active = ["queued","running","applying","canceling"].includes(run.status);
  const providerFinished = run.provider_succeeded_items
    + run.provider_errored_items
    + run.provider_canceled_items
    + run.provider_expired_items;
  const appliedItems = run.completed_items + run.failed_items;
  const processedItems = Math.max(providerFinished,appliedItems);
  const progress = run.total_items > 0
    ? Math.min(100, Math.round((processedItems / run.total_items) * 100))
    : 100;
  const message = run.status === "queued"
    ? t("resolver.queued", { count: run.total_items })
    : run.status === "running"
      ? t("resolver.processing", { completed: providerFinished, total: run.total_items })
      : run.status === "applying"
        ? t("resolver.applying", { completed: appliedItems, total: run.total_items })
        : run.status === "canceling"
          ? t("resolver.canceling", { completed: appliedItems, total: run.total_items })
      : run.status === "completed"
        ? t("resolver.completed", { count: run.completed_items })
        : run.status === "partial"
          ? t("resolver.partial", { completed: run.completed_items, total: run.total_items, failed: run.failed_items })
          : run.status === "canceled" ? t("resolver.canceled") : t("resolver.failed");
  const tone = run.status === "completed"
    ? "success"
    : run.status === "failed"
      ? "danger"
    : run.status === "partial" || run.status === "canceled"
        ? "warning"
        : "active";
  return (
    <div className={`semantic-review-resolution semantic-review-resolution--${tone}`} role="status">
      {active ? <MagicWand aria-hidden size={16} /> : run.status === "completed" ? <Check aria-hidden size={16} /> : <WarningCircle aria-hidden size={16} />}
      <div>
        <strong>{message}</strong>
        <span>{Number(run.actual_cost_usd) > 0
          ? t("resolver.cost", { cost: formatCurrency(Number(run.actual_cost_usd), locale) })
          : t("resolver.estimatedCost", { cost: formatCurrency(Number(run.estimated_cost_usd), locale) })}</span>
        <small>{t("resolver.batchProgress",{completed:run.completed_child_batch_count,
          total:run.child_batch_count,failed:run.failed_child_batch_count})}</small>
        <ul className="semantic-review-resolution__batches">
          {run.children.map((child)=>(
            <li key={child.ordinal}>
              <span>{t("resolver.batchStatus",{ordinal:child.ordinal,
                status:t(`resolver.batchStates.${child.status}`)})}</span>
              <span>{t("resolver.batchItems",{completed:child.completed_items,
                total:child.item_count,failed:child.failed_items})}</span>
            </li>
          ))}
        </ul>
        {run.children.filter((child)=>["partial","failed"].includes(child.status)).map((child)=>(
          <button disabled={isMutating} key={child.ordinal}
            onClick={()=>onResume(child.ordinal)} type="button">
            {t("resolver.resumeBatch",{ordinal:child.ordinal,failed:child.failed_items})}
          </button>
        ))}
        {active && run.status!=="canceling" ? <button disabled={isMutating}
          onClick={onCancel} type="button">{t("resolver.cancel")}</button>:null}
      </div>
      <div
        aria-label={message}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="semantic-review-resolution__progress"
        role="progressbar"
      >
        <i style={{ width: `${progress}%` }} />
      </div>
      {!active ? <DismissResolutionFeedback label={t("resolver.dismiss")} onDismiss={onDismiss} /> : null}
    </div>
  );
}

function DismissResolutionFeedback({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button aria-label={label} className="semantic-review-resolution__dismiss" onClick={onDismiss} type="button">
      <XIcon aria-hidden size={14} />
    </button>
  );
}

function SemanticQueueRow({ isSelected, locale, onSelect, record }: {
  isSelected: boolean;
  locale: string;
  onSelect: () => void;
  record: SignalSemanticReviewQueueItemV1;
}) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const primaryAssertion = record.current_assertions.find((assertion) => assertion.review_status === "pending")
    ?? record.current_assertions.find((assertion) => assertion.review_status === "approved")
    ?? record.current_assertions[0]
    ?? record.proposed_assertions[0]
    ?? null;
  const entityCount = semanticEntityCount(record);
  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      className="semantic-review-row"
      data-selected={isSelected}
      onClick={onSelect}
      type="button"
    >
      <SignalSourceIcon platform={record.platform} size={18} />
      <span className="semantic-review-row__copy">
        <strong>{record.title || record.excerpt}</strong>
        <span>{record.excerpt}</span>
        <small>
          {formatDate(record.published_at, locale)}
          {record.account?.display_name || record.account?.handle ? ` · ${record.account.display_name ?? record.account.handle}` : ""}
        </small>
      </span>
      <span className="semantic-review-row__meta">
        {primaryAssertion ? <ScopeBadge scope={primaryAssertion.scope} /> : <StateBadge state={record.state} />}
        {entityCount > 1 ? <span className="semantic-review-row__multi"><Stack aria-hidden size={12} />{t("multiEntity.short", { count: entityCount })}</span> : null}
      </span>
      <CaretRight aria-hidden className="semantic-review-row__chevron" size={15} />
    </button>
  );
}

function SemanticReviewDetail({
  actionError,
  actionMode,
  entities,
  isSubmitting,
  locale,
  onAction,
  onCancelAction,
  onHistory,
  onOpenMention,
  onSubmit,
  openingMentionId,
  mentionPreviewError,
  record
}: {
  actionError: string | null;
  actionMode: ActionMode | null;
  entities: ReviewQueueResponse["governed_entities"];
  isSubmitting: boolean;
  locale: string;
  onAction: (mode: ActionMode) => void;
  onCancelAction: () => void;
  onHistory: (assertion: SignalSemanticCurrentAssertionV1) => void;
  onOpenMention: (mentionId: string, publishedAt: string) => void;
  onSubmit: (input: { scope?: SignalSemanticScopeV1; entityId?: string | null; confidence?: number; rationale: string }) => void;
  openingMentionId: string | null;
  mentionPreviewError: string | null;
  record: SignalSemanticReviewQueueItemV1;
}) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const entityCount = semanticEntityCount(record);
  return (
    <article className="semantic-review-detail">
      <header className="semantic-review-detail__head">
        <div className="semantic-review-detail__source">
          <SignalSourceIcon platform={record.platform} size={19} />
          <div><strong>{platformLabel(record.platform)}</strong><small>{formatDate(record.published_at, locale)}</small></div>
        </div>
        <StateBadge state={record.state} />
      </header>

      <div className="semantic-review-detail__mention">
        <h3>{record.title || t("detail.mentionTitle")}</h3>
        <p>{record.excerpt}</p>
        <div className="semantic-review-detail__mention-meta">
          {record.account?.display_name || record.account?.handle ? <span>{record.account.display_name ?? record.account.handle}</span> : null}
          {record.url_host ? <span>{record.url_host}</span> : null}
          <button
            aria-busy={openingMentionId === record.mention_id}
            disabled={openingMentionId != null}
            onClick={() => onOpenMention(record.mention_id, record.published_at)}
            type="button"
          >
            {openingMentionId === record.mention_id ? (
              <>{t("actions.openingMention")}<SpinnerGap aria-hidden className="signal-v2-spin" size={14} /></>
            ) : (
              <>{t("actions.viewMention")}<ArrowRight aria-hidden size={14} /></>
            )}
          </button>
        </div>
        {mentionPreviewError ? <p className="semantic-review__inline-error" role="alert">{mentionPreviewError}</p> : null}
      </div>

      {entityCount > 1 ? (
        <div className="semantic-review-detail__multi">
          <Stack aria-hidden size={17} />
          <div><strong>{t("multiEntity.title", { count: entityCount })}</strong><p>{t("multiEntity.body")}</p></div>
        </div>
      ) : null}

      <section className="semantic-review-detail__section">
        <div className="semantic-review-detail__section-head">
          <div>
            <h4>
              <SignalMetricHelp
                content={{
                  title: t("helper.title"),
                  body: t("helper.body"),
                  reading: t("helper.reading")
                }}
                display={t("assertions.title")}
                label={t("assertions.title")}
              />
            </h4>
          </div>
          <button className="admin-button" onClick={() => onAction({ kind: "create" })} type="button">{t("actions.createAssertion")}</button>
        </div>
        <div className="semantic-review-assertions">
          {record.current_assertions.map((assertion) => (
            <AssertionCard assertion={assertion} key={assertion.id} onAction={onAction} onHistory={onHistory} />
          ))}
          {record.current_assertions.length === 0 && record.proposed_assertions.map((assertion) => (
            <div className="semantic-review-assertion semantic-review-assertion--proposal" key={assertion.idempotency_key}>
              <div className="semantic-review-assertion__head">
                <div><ScopeBadge scope={assertion.scope} />{visibleEntityLabel(t, assertion.scope, assertion.entity_label) ? <strong>{visibleEntityLabel(t, assertion.scope, assertion.entity_label)}</strong> : null}</div>
                <WorkspaceStatus tone="neutral">{t("assertions.proposed")}</WorkspaceStatus>
              </div>
              <dl>
                <div><dt>{t("assertions.confidence")}</dt><dd>{formatPercent(assertion.confidence, locale)}</dd></div>
                <div><dt>{t("assertions.evidence")}</dt><dd>{evidenceLabel(t, assertion.evidence_kind)}</dd></div>
              </dl>
            </div>
          ))}
          {record.current_assertions.length === 0 && record.proposed_assertions.length === 0 ? (
            <div className="semantic-review-assertions__empty"><p>{t(`assertions.empty.${record.state}`)}</p></div>
          ) : null}
        </div>
      </section>

      <section className="semantic-review-detail__section semantic-review-detail__provenance">
        <div className="semantic-review-detail__section-head"><div><h4>{t("provenance.title")}</h4><p>{t("provenance.subtitle")}</p></div></div>
        {record.source_intent.map((intent) => (
          <div className="semantic-review-provenance" key={intent.attribution_id}>
            <Database aria-hidden size={16} />
            <div><strong>{intent.source_name}</strong><small>{scopeLabel(t, intent.scope)} · {t("provenance.policy", { version: intent.policy_version })}</small></div>
            <WorkspaceStatus tone="neutral">{t("provenance.sourceIntent")}</WorkspaceStatus>
          </div>
        ))}
      </section>

      {actionMode ? (
        <SemanticActionForm
          entities={entities}
          error={actionError}
          isSubmitting={isSubmitting}
          key={`${actionMode.kind}-${"assertion" in actionMode ? actionMode.assertion.id : record.mention_id}`}
          mode={actionMode}
          onCancel={onCancelAction}
          onSubmit={onSubmit}
          proposals={record.proposed_assertions}
        />
      ) : null}
    </article>
  );
}

function AssertionCard({ assertion, onAction, onHistory }: {
  assertion: SignalSemanticCurrentAssertionV1;
  onAction: (mode: ActionMode) => void;
  onHistory: (assertion: SignalSemanticCurrentAssertionV1) => void;
}) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const locale = useLocale();
  return (
    <div className="semantic-review-assertion">
      <div className="semantic-review-assertion__head">
        <div><ScopeBadge scope={assertion.scope} />{visibleEntityLabel(t, assertion.scope, assertion.entity_label) ? <strong>{visibleEntityLabel(t, assertion.scope, assertion.entity_label)}</strong> : null}</div>
        <AssertionStatus assertion={assertion} />
      </div>
      <dl>
        <div><dt>{t("assertions.confidence")}</dt><dd>{assertion.confidence == null ? "—" : formatPercent(assertion.confidence, locale)}</dd></div>
        <div><dt>{t("assertions.evidence")}</dt><dd>{assertion.evidence_kind ? evidenceLabel(t, assertion.evidence_kind) : "—"}</dd></div>
        <div><dt>{t("assertions.version")}</dt><dd>v{assertion.assertion_version}</dd></div>
      </dl>
      <div className="semantic-review-assertion__actions">
        {assertion.review_status === "pending" ? (
          <>
            <button className="admin-button admin-button--primary" onClick={() => onAction({ kind: "approve", assertion })} type="button"><Check aria-hidden size={14} />{t("actions.approve")}</button>
            <button className="admin-button" onClick={() => onAction({ kind: "reject", assertion })} type="button"><XIcon aria-hidden size={14} />{t("actions.reject")}</button>
          </>
        ) : null}
        <button className="admin-button" onClick={() => onAction({ kind: "correct", assertion })} type="button">{t("actions.correct")}</button>
        <button className="admin-button admin-button--quiet" onClick={() => onHistory(assertion)} type="button"><ClockCounterClockwise aria-hidden size={14} />{t("actions.history")}</button>
      </div>
    </div>
  );
}

function SemanticActionForm({ entities, error, isSubmitting, mode, onCancel, onSubmit, proposals }: {
  entities: ReviewQueueResponse["governed_entities"];
  error: string | null;
  isSubmitting: boolean;
  mode: ActionMode;
  onCancel: () => void;
  onSubmit: (input: { scope?: SignalSemanticScopeV1; entityId?: string | null; confidence?: number; rationale: string }) => void;
  proposals: SignalSemanticReviewQueueItemV1["proposed_assertions"];
}) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const initialProposal = proposals[0];
  const initialScope = mode.kind === "correct"
    ? mode.assertion.scope
    : initialProposal?.scope ?? "primary_brand";
  const [scope, setScope] = useState<SignalSemanticScopeV1>(initialScope);
  const matchingEntities = entities.filter((entity) => entity.scope === scope);
  const originalEntityId = mode.kind === "correct" ? mode.assertion.entity_id : initialProposal?.entity_id;
  const [entityId, setEntityId] = useState<string>(
    originalEntityId ?? matchingEntities[0]?.entity_id ?? ""
  );
  const [confidence, setConfidence] = useState(
    mode.kind === "correct"
      ? mode.assertion.confidence ?? 0.8
      : initialProposal?.confidence ?? 0.8
  );
  const [rationale, setRationale] = useState("");
  const needsClassification = mode.kind === "create" || mode.kind === "correct";
  const entityOptions: WorkspaceSelectOption[] = matchingEntities.map((entity) => ({
    value: entity.entity_id ?? "",
    label: entity.entity_label,
    description: scopeLabel(t, entity.scope)
  }));

  const changeScope = (value: string) => {
    const next = value as SignalSemanticScopeV1;
    setScope(next);
    const nextEntity = entities.find((entity) => entity.scope === next);
    setEntityId(nextEntity?.entity_id ?? "");
  };

  const canSubmit = rationale.trim().length >= 3
    && (!needsClassification || scope === "unattributed" || Boolean(entityId));

  return (
    <section className="semantic-review-action" aria-label={t(`form.${mode.kind}.title`)}>
      <div className="semantic-review-action__head">
        <div><strong>{t(`form.${mode.kind}.title`)}</strong><p>{t(`form.${mode.kind}.body`)}</p></div>
        <button aria-label={t("actions.close")} onClick={onCancel} type="button"><XIcon aria-hidden size={16} /></button>
      </div>
      {needsClassification ? (
        <div className="semantic-review-action__fields">
          <label><span>{t("form.scope")}</span><WorkspaceSelect ariaLabel={t("form.scope")} name="action-scope" onChange={changeScope} options={scopeOptions(t).filter((option) => option.value !== "all")} value={scope} /></label>
          <label><span>{t("form.entity")}</span><WorkspaceSelect ariaLabel={t("form.entity")} disabled={scope === "unattributed" || entityOptions.length === 0} name="action-entity" onChange={setEntityId} options={entityOptions.length ? entityOptions : [{ value: "", label: scope === "unattributed" ? t("form.noEntityNeeded") : t("form.noEntity") }]} value={entityId} /></label>
          <label className="semantic-review-action__confidence"><span>{t("form.confidence")}</span><input max="1" min="0" onChange={(event) => setConfidence(Number(event.target.value))} step="0.05" type="number" value={confidence} /></label>
        </div>
      ) : null}
      <label className="semantic-review-action__rationale">
        <span>{t("form.rationale")}</span>
        <textarea maxLength={2000} onChange={(event) => setRationale(event.target.value)} placeholder={t(`form.${mode.kind}.placeholder`)} value={rationale} />
      </label>
      {error ? <p className="semantic-review__inline-error" role="alert">{error}</p> : null}
      <div className="semantic-review-action__buttons">
        <button className="admin-button" disabled={isSubmitting} onClick={onCancel} type="button">{t("actions.cancel")}</button>
        <button className="admin-button admin-button--primary" disabled={!canSubmit || isSubmitting} onClick={() => onSubmit({ scope, entityId: entityId || null, confidence, rationale: rationale.trim() })} type="button">
          {isSubmitting ? t("actions.saving") : t(`form.${mode.kind}.submit`)}
        </button>
      </div>
    </section>
  );
}

function AssertionStatus({ assertion }: { assertion: SignalSemanticCurrentAssertionV1 }) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  if (assertion.review_status === "approved" && assertion.eligibility_status === "eligible") {
    return <WorkspaceStatus tone="success">{t("assertions.approved")}</WorkspaceStatus>;
  }
  if (assertion.review_status === "approved") {
    return <WorkspaceStatus tone="neutral">{t("assertions.approvedExcluded")}</WorkspaceStatus>;
  }
  if (assertion.review_status === "rejected") {
    return <WorkspaceStatus tone="danger">{t("assertions.rejected")}</WorkspaceStatus>;
  }
  return <WorkspaceStatus tone="warning">{t("assertions.pending")}</WorkspaceStatus>;
}

function ScopeBadge({ scope }: { scope: SignalSemanticScopeV1 }) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  return <span className="semantic-review__scope" data-scope={scope}>{scopeLabel(t, scope)}</span>;
}

function StateBadge({ state }: { state: SignalSemanticQueueStateV1 }) {
  const t = useTranslations("AdminWorkspace.data.semanticReview");
  const tone = state === "current_approved" ? "success" : state === "current_rejected" ? "danger" : state === "candidate_pending" ? "warning" : "neutral";
  return <WorkspaceStatus tone={tone}>{t(`states.${state}`)}</WorkspaceStatus>;
}

function SemanticQueueSkeleton() {
  return <div aria-hidden className="semantic-review-skeleton semantic-review-skeleton--queue">{Array.from({ length: 6 }, (_, index) => <div key={index}><i /><span><b /><b /></span><em /></div>)}</div>;
}

function SemanticDetailSkeleton() {
  return <div aria-hidden className="semantic-review-skeleton semantic-review-skeleton--detail"><div className="semantic-review-skeleton__head"><i /><span /></div><b /><b /><section /><section /></div>;
}

function HistorySkeleton() {
  return <div aria-hidden className="semantic-review-skeleton semantic-review-skeleton--history"><b /><b /><b /></div>;
}

function scopeOptions(t: ReturnType<typeof useTranslations>): WorkspaceSelectOption[] {
  return [
    { value: "all", label: t("filters.allScopes") },
    { value: "primary_brand", label: t("scopes.primary_brand") },
    { value: "competitor", label: t("scopes.competitor") },
    { value: "category", label: t("scopes.category") },
    { value: "reference", label: t("scopes.reference") },
    { value: "unattributed", label: t("scopes.unattributed") }
  ];
}

function confidenceOptions(t: ReturnType<typeof useTranslations>): WorkspaceSelectOption[] {
  return [
    { value: "all", label: t("filters.allConfidence") },
    { value: "high", label: t("confidence.high") },
    { value: "medium", label: t("confidence.medium") },
    { value: "low", label: t("confidence.low") }
  ];
}

function platformOptions(t: ReturnType<typeof useTranslations>): WorkspaceSelectOption[] {
  return [
    { value: "all", label: t("filters.allPlatforms") },
    ...["facebook", "instagram", "tiktok", "reddit", "youtube", "x", "google", "web"].map((platform) => ({
      value: platform,
      label: platformLabel(platform)
    }))
  ];
}

function scopeLabel(t: ReturnType<typeof useTranslations>, scope: SignalSemanticScopeV1) {
  return t(`scopes.${scope}`);
}

function visibleEntityLabel(
  t: ReturnType<typeof useTranslations>,
  scope: SignalSemanticScopeV1,
  entityLabel: string | null | undefined
) {
  const normalizedLabel = entityLabel?.trim() ?? "";
  if (!normalizedLabel) return null;
  const normalizedScope = scopeLabel(t, scope).trim();
  return normalizedLabel.localeCompare(normalizedScope, undefined, { sensitivity: "accent" }) === 0
    ? null
    : normalizedLabel;
}

function evidenceLabel(t: ReturnType<typeof useTranslations>, evidence: string) {
  const known = new Set(["explicit_primary_brand", "explicit_competitor_with_resolved_identity", "explicit_category", "multi_entity", "human_reviewed_context", "model_reviewed_context", "governed_rule"]);
  return known.has(evidence) ? t(`evidence.${evidence}`) : evidence.replaceAll("_", " ");
}

function platformLabel(platform: string) {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "x" || normalized === "twitter") return "X";
  if (normalized === "tiktok") return "TikTok";
  if (normalized === "youtube") return "YouTube";
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Web";
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatCurrencyString(value: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(Number(value));
}

function formatInteger(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function reviewStatusLabel(t: ReturnType<typeof useTranslations>, status: string) {
  const known = new Set(["pending", "approved", "rejected", "superseded"]);
  return known.has(status) ? t(`assertions.${status}`) : status.replaceAll("_", " ");
}

function semanticEntityCount(record: SignalSemanticReviewQueueItemV1) {
  return new Set(
    [...record.current_assertions, ...record.proposed_assertions].map((assertion) =>
      `${assertion.scope}:${assertion.entity_id ?? "unattributed"}`
    )
  ).size;
}

function countActiveFilters(filters: Filters) {
  return [
    filters.scope !== "all",
    filters.confidence !== "all",
    filters.platform !== "all",
    filters.source !== "all",
    Boolean(filters.start),
    Boolean(filters.end)
  ].filter(Boolean).length;
}

function dedupeRecords(records: SignalSemanticReviewQueueItemV1[]) {
  return [...new Map(records.map((record) => [record.mention_id, record])).values()];
}
