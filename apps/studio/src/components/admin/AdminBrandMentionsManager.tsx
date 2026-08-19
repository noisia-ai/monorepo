"use client";

import {
  DownloadSimple,
  Funnel,
  SpinnerGap,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import type {
  SignalComparisonV1,
  SignalDimensionV1,
  SignalDimensionValuesV1,
  SignalFilterV1
} from "@noisia/query-engine";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  AdminMentionInclusionCell,
  AdminMentionOperatorPrimaryPanel,
  AdminMentionOperatorTechnicalPanel,
  AdminMentionSemanticStateCell,
  type AdminMentionOperatorSummaryV1,
  type SignalAdminMentionOperatorV1
} from "@/components/admin/AdminMentionOperatorPanel";
import {
  formatCount,
  MentionResourceColumns,
  MentionResourcePagination,
  MentionResourceSearch,
  MentionResourceSort,
  MentionResourceTable,
  MentionSelectionBar,
  MentionsTableSkeleton,
  primaryAttribution,
  type MentionColumnState
} from "@/components/mentions/MentionResourcePrimitives";
import { SignalMentionDetailDrawer } from "@/components/signal-v2/SignalV2Mentions";
import {
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "@/components/signal-v2/SignalAnalyticsFilter";
import {
  SignalFilterControls,
  type SignalFilterDefinition,
  type SignalFilterFacetValue
} from "@/components/signal-v2/SignalFilterControls";
import { WorkspaceConfirmDialog } from "@/components/workspace/WorkspaceShell";
import type {
  SignalMentionRecordV1,
  SignalMentionsPayloadV1
} from "@/lib/data-os/signal-workspace-serving";
import { fetchSharedSignalJson } from "@/lib/data-os/signal-client-fetch";

type AdminMentionListRecord = SignalMentionRecordV1 & {
  operator_summary: AdminMentionOperatorSummaryV1;
};

type AdminMentionOperatorFacet = {
  dimension: string;
  key: string;
  label: string;
  count: number;
};

type AdminMentionOperatorFacetsV1 = {
  contract_version: "signal-admin-mention-facets-v1";
  scope: "all_workspace_canonical_roots";
  facets: Record<string, AdminMentionOperatorFacet[]>;
};

type MentionListResponse = Omit<SignalMentionsPayloadV1, "records"> & {
  comparison: unknown;
  filter: unknown;
  operator_facets: AdminMentionOperatorFacetsV1;
  operator_filters: Record<string, string | number | null>;
  records: AdminMentionListRecord[];
};

type FocusedMentionResponse = {
  comparison: unknown;
  filter: unknown;
  operator: SignalAdminMentionOperatorV1;
  record: SignalMentionRecordV1;
};

type MentionSortKey =
  | "publishedDesc"
  | "publishedAsc"
  | "platformAsc"
  | "platformDesc"
  | "roleAsc"
  | "roleDesc"
  | "engagementDesc"
  | "engagementAsc";

type MentionFilters = {
  dimensions: SignalDimensionValuesV1;
  end: string;
  operatorFilters: Record<string, string[]>;
  query: string;
  sortKey: MentionSortKey;
  start: string;
};

type GovernanceAction = "include" | "exclude" | "revert" | "send_to_review";

type GovernanceIntent = {
  action: GovernanceAction;
  mentionIds: string[];
  openReviewAfter?: boolean;
};

type AdminBrandMentionsManagerProps = {
  coverageFrom: string | null;
  coverageThrough: string | null;
  reviewHref: string;
  workspaceId: string;
};

const SORT_KEYS: MentionSortKey[] = [
  "publishedDesc",
  "publishedAsc",
  "platformAsc",
  "platformDesc",
  "roleAsc",
  "roleDesc",
  "engagementDesc",
  "engagementAsc"
];

const ADMIN_SIGNAL_FILTER_DEFINITIONS: SignalFilterDefinition[] = [
  { dimension: "platform", translationKey: "platform" },
  { dimension: "corpus_scope", translationKey: "corpusScope" },
  { dimension: "sentiment_polarity", translationKey: "sentiment" },
  { dimension: "content_format", translationKey: "contentFormat" },
  { dimension: "conversation_role", translationKey: "conversationRole" },
  { dimension: "tb_polarity", translationKey: "tbPolarity" },
  { dimension: "tb_layer", translationKey: "tbLayer" }
];

const ADMIN_OPERATOR_FILTER_DEFINITIONS: SignalFilterDefinition[] = [
  { dimension: "inclusion_status", filterKind: "custom", multiple: false },
  { dimension: "resolution_state", filterKind: "custom", multiple: false },
  { dimension: "review_status", filterKind: "custom", multiple: false },
  { dimension: "eligibility_status", filterKind: "custom", multiple: false },
  { dimension: "minimum_quality_score", filterKind: "custom", multiple: false },
  { dimension: "quality_flag", filterKind: "custom", multiple: false },
  { dimension: "latest_governance_action", filterKind: "custom", multiple: false },
  { dimension: "provenance_source_id", filterKind: "custom", multiple: false }
];

const ADMIN_FILTER_DEFINITIONS: SignalFilterDefinition[] = [
  ...ADMIN_SIGNAL_FILTER_DEFINITIONS,
  ...ADMIN_OPERATOR_FILTER_DEFINITIONS
];

const ADMIN_FILTER_FACETS: Partial<Record<SignalDimensionV1, SignalFilterFacetValue[]>> = {
  platform: facetValues(["facebook", "instagram", "reddit", "tiktok", "x", "youtube", "news", "web"]),
  corpus_scope: facetValues(["brand", "competitor", "category", "unknown"]),
  sentiment_polarity: facetValues(["positive", "neutral", "negative"]),
  content_format: facetValues(["root_post", "comment", "post", "image", "video", "article"]),
  conversation_role: facetValues(["root_post", "comment"]),
  tb_polarity: facetValues(["trigger", "barrier", "mixed", "irrelevant"]),
  tb_layer: facetValues(["personal", "psicologico", "social", "cultural"])
};

const ADMIN_QUALITY_FILTER_FACETS: SignalFilterFacetValue[] = [
  { key: "5", count: null },
  { key: "7", count: null },
  { key: "9", count: null }
];

const ADMIN_FILTER_VALUE_KEYS: Partial<Record<SignalDimensionV1, Record<string, string>>> = {
  corpus_scope: {
    brand: "brand",
    competitor: "competitor",
    category: "category",
    unknown: "unknown"
  },
  sentiment_polarity: { positive: "positive", neutral: "neutral", negative: "negative" },
  content_format: {
    root_post: "rootPost",
    comment: "comment",
    post: "post",
    image: "image",
    video: "video",
    article: "article"
  },
  conversation_role: { root_post: "rootPost", comment: "comment" },
  tb_polarity: { trigger: "trigger", barrier: "barrier", mixed: "mixed", irrelevant: "irrelevant" },
  tb_layer: {
    personal: "personal",
    psicologico: "psychological",
    social: "social",
    cultural: "cultural"
  }
};

const OPERATOR_FILTER_VALUE_KEYS: Record<string, Record<string, string>> = {
  inclusion_status: { pending: "pending", included: "included", excluded: "excluded" },
  resolution_state: {
    unresolved: "unresolved",
    pending: "pending",
    approved_by_model: "approvedByModel",
    approved_by_human: "approvedByHuman",
    approved_by_policy: "approvedByPolicy",
    rejected: "rejected",
    superseded: "superseded"
  },
  review_status: {
    unresolved: "unresolved",
    pending: "pending",
    approved: "approved",
    rejected: "rejected"
  },
  eligibility_status: {
    unresolved: "unresolved",
    not_eligible: "notEligible",
    candidate: "candidate",
    eligible: "eligible"
  },
  latest_governance_action: {
    include: "include",
    exclude: "exclude",
    revert: "revert",
    send_to_review: "sendToReview"
  }
};

const DEFAULT_COLUMNS: MentionColumnState[] = [
  { key: "mention", visible: true, locked: true },
  { key: "inclusion", visible: true },
  { key: "operator", visible: true },
  { key: "scope", visible: true },
  { key: "platform", visible: true },
  { key: "role", visible: true },
  { key: "published", visible: true },
  { key: "sentiment", visible: true },
  { key: "engagement", visible: true },
  { key: "topics", visible: true },
  { key: "context", visible: true },
  { key: "multiEntity", visible: false }
];

export function AdminBrandMentionsManager({
  coverageFrom,
  coverageThrough,
  reviewHref,
  workspaceId
}: AdminBrandMentionsManagerProps) {
  const t = useTranslations("AdminWorkspace.data");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const defaults = useMemo<MentionFilters>(() => ({
    dimensions: {},
    end: dateOnly(coverageThrough) ?? dateOnly(new Date().toISOString()) ?? "2100-01-01",
    operatorFilters: {},
    query: "",
    sortKey: "publishedDesc",
    start: dateOnly(coverageFrom) ?? "2000-01-01"
  }), [coverageFrom, coverageThrough]);

  const [filters, setFilters] = useState<MentionFilters>(() => filtersFromParams(searchParams, defaults));
  const [filterDraft, setFilterDraft] = useState(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState(filters.query);
  const [columns, setColumns] = useState<MentionColumnState[]>(DEFAULT_COLUMNS);
  const [limit, setLimit] = useState(() => pageSizeFromParam(searchParams.get("limit")));
  const [offset, setOffset] = useState(() => offsetFromParam(searchParams.get("offset")));
  const [records, setRecords] = useState<AdminMentionListRecord[]>([]);
  const [operatorFacets, setOperatorFacets] = useState<AdminMentionOperatorFacetsV1 | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<Map<string, AdminMentionListRecord>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [showEmptyLoadingState, setShowEmptyLoadingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<SignalMentionRecordV1 | null>(null);
  const [activeOperator, setActiveOperator] = useState<SignalAdminMentionOperatorV1 | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [governanceIntent, setGovernanceIntent] = useState<GovernanceIntent | null>(null);
  const [governanceReason, setGovernanceReason] = useState("");
  const [governanceBusy, setGovernanceBusy] = useState(false);
  const [governanceNotice, setGovernanceNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const listRequestRef = useRef<AbortController | null>(null);
  const focusRequestRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const requestSequence = useRef(0);
  const initialRequestedMention = useRef(searchParams.get("mention"));

  const visibleColumns = columns
    .filter((column) => column.visible)
    .map((column) => column.key);
  const selectedIds = [...selectedRecords.keys()];
  const activeFilterCount = countAdvancedFilters(filters);
  const pageStart = totalCount === 0 ? 0 : offset + 1;
  const pageEnd = totalCount === 0 ? 0 : Math.min(offset + records.length, totalCount);
  const analyticsFilter = useMemo<SignalFilterV1>(() => ({
    contract_version: "signal-backend-v1",
    date_range: { start: filters.start, end: filters.end },
    timezone,
    granularity: "day",
    dimensions: filters.dimensions,
    ...(filters.query.trim() ? { search_query: filters.query.trim() } : {})
  }), [filters.dimensions, filters.end, filters.query, filters.start, timezone]);
  const draftAnalyticsFilter = useMemo<SignalFilterV1>(() => ({
    ...analyticsFilter,
    date_range: { start: filterDraft.start, end: filterDraft.end },
    dimensions: filterDraft.dimensions,
    ...(filterDraft.query.trim() ? { search_query: filterDraft.query.trim() } : { search_query: undefined })
  }), [analyticsFilter, filterDraft.dimensions, filterDraft.end, filterDraft.query, filterDraft.start]);
  const noComparison = useMemo<SignalComparisonV1>(() => ({ mode: "none", date_range: null }), []);
  const adminFilterFacets = useMemo(
    () => mergeAdminFilterFacets(operatorFacets),
    [operatorFacets]
  );
  const adminFilterLabels = useMemo(
    () => buildAdminFilterLabels(t),
    [t]
  );
  const operatorFacetLabels = useMemo(
    () => buildOperatorFacetLabels(operatorFacets),
    [operatorFacets]
  );

  const buildParams = useCallback((activeFilters = filters, activeOffset = offset, activeLimit = limit) => {
    const sort = sortParams(activeFilters.sortKey);
    const params = new URLSearchParams({
      start: activeFilters.start,
      end: activeFilters.end,
      timezone,
      granularity: "day",
      compare: "none",
      limit: String(activeLimit),
      offset: String(activeOffset),
      sort: sort.field,
      direction: sort.direction
    });
    if (activeFilters.query.trim()) params.set("q", activeFilters.query.trim());
    for (const [dimension, values] of Object.entries(activeFilters.dimensions)) {
      if (values?.length) params.set(`dimension.${dimension}`, values.join(","));
    }
    for (const [key, values] of Object.entries(activeFilters.operatorFilters)) {
      if (values?.[0]) params.set(key, values[0]);
    }
    return params;
  }, [filters, limit, offset, timezone]);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    next.set("start", filters.start);
    next.set("end", filters.end);
    next.set("sort", filters.sortKey);
    next.set("limit", String(limit));
    next.set("offset", String(offset));
    setOrDelete(next, "q", filters.query.trim());
    next.delete("platform");
    next.delete("role");
    for (const key of [...next.keys()]) {
      if (key.startsWith("dimension.")) next.delete(key);
    }
    for (const definition of ADMIN_OPERATOR_FILTER_DEFINITIONS) next.delete(definition.dimension);
    for (const [dimension, values] of Object.entries(filters.dimensions)) {
      if (values?.length) next.set(`dimension.${dimension}`, values.join(","));
    }
    for (const [key, values] of Object.entries(filters.operatorFilters)) {
      if (values?.[0]) next.set(key, values[0]);
    }
    window.history.replaceState(null, "", `${pathname}?${next.toString()}`);
  }, [filters, limit, offset, pathname]);

  useEffect(() => {
    listRequestRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestSequence.current;
    listRequestRef.current = controller;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const url = `/api/data-os/signal/${workspaceId}/admin-mentions?${buildParams()}`;
        const { body, ok } = await fetchSharedSignalJson<MentionListResponse | { message?: string }>(url);
        if (controller.signal.aborted) return;
        if (!ok || !body || !("records" in body)) {
          throw new Error(body && "message" in body && body.message ? body.message : t("mentions.loadError"));
        }
        if (requestId !== requestSequence.current) return;
        setRecords(body.records);
        setOperatorFacets(body.operator_facets);
        setTotalCount(body.total_count);
        setNextOffset(body.page.next_offset);
      } catch (loadError) {
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        setError(loadError instanceof Error ? loadError.message : t("mentions.loadError"));
      } finally {
        if (requestId === requestSequence.current) {
          listRequestRef.current = null;
          setIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [buildParams, refreshKey, t, workspaceId]);

  useEffect(() => {
    if (!isLoading || records.length > 0) {
      setShowEmptyLoadingState(false);
      return;
    }
    const timer = window.setTimeout(() => setShowEmptyLoadingState(true), 220);
    return () => window.clearTimeout(timer);
  }, [isLoading, records.length]);

  useEffect(() => () => {
    listRequestRef.current?.abort();
    focusRequestRef.current?.abort();
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
  }, []);

  const replaceMentionParam = useCallback((mentionId: string | null) => {
    const next = new URLSearchParams(window.location.search);
    setOrDelete(next, "mention", mentionId ?? "");
    window.history.replaceState(null, "", `${pathname}?${next.toString()}`);
  }, [pathname]);

  const openMention = useCallback(async (mentionId: string, updateLocation = true) => {
    setFiltersOpen(false);
    if (updateLocation) replaceMentionParam(mentionId);
    const localRecord = records.find((record) => record.subject_id === mentionId)
      ?? selectedRecords.get(mentionId);
    if (localRecord) setActiveRecord(localRecord);
    setActiveOperator(null);
    setDetailError(null);
    setDetailLoading(true);

    focusRequestRef.current?.abort();
    const controller = new AbortController();
    focusRequestRef.current = controller;
    try {
      const params = buildParams(defaults, 0, limit);
      params.delete("limit");
      params.delete("offset");
      params.delete("sort");
      params.delete("direction");
      params.set("mention", mentionId);
      const url = `/api/data-os/signal/${workspaceId}/admin-mentions?${params}`;
      const { body, ok } = await fetchSharedSignalJson<FocusedMentionResponse | { message?: string }>(url);
      if (controller.signal.aborted) return;
      if (!ok || !body || !("record" in body)) {
        throw new Error(body && "message" in body && body.message ? body.message : t("mentions.loadError"));
      }
      setActiveRecord(body.record);
      setActiveOperator(body.operator);
    } catch {
      if (controller.signal.aborted) return;
      setDetailError(t("mentions.operator.unavailable"));
      if (!localRecord) replaceMentionParam(null);
    } finally {
      if (focusRequestRef.current === controller) focusRequestRef.current = null;
      setDetailLoading(false);
    }
  }, [buildParams, defaults, limit, records, replaceMentionParam, selectedRecords, t, workspaceId]);

  useEffect(() => {
    const mentionId = initialRequestedMention.current;
    if (!mentionId || activeRecord?.subject_id === mentionId) return;
    initialRequestedMention.current = null;
    void openMention(mentionId, false);
  }, [activeRecord?.subject_id, openMention]);

  const applyFilterUpdate = (update: Partial<MentionFilters>) => {
    setFilters((current) => ({ ...current, ...update }));
    setOffset(0);
    setSelectedRecords(new Map());
  };

  const applySearch = (nextSearch = search) => {
    if (searchTimeoutRef.current != null) {
      window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    applyFilterUpdate({ query: nextSearch });
  };

  const exportMentions = () => {
    const rows = selectedRecords.size > 0 ? [...selectedRecords.values()] : records;
    const csv = [
      [
        t("mentions.table.mention"),
        t("mentions.table.inclusion"),
        t("mentions.table.operator"),
        t("mentions.filters.operatorDimensions.minimum_quality_score"),
        t("mentions.filters.operatorDimensions.provenance_source_id"),
        t("mentions.table.platform"),
        t("mentions.table.scope"),
        t("mentions.table.role"),
        t("mentions.table.published"),
        t("mentions.table.sentiment"),
        t("mentions.table.engagement"),
        t("mentions.table.topics"),
        t("mentions.table.multiEntity")
      ],
      ...rows.map((record) => [
        record.title || record.text_snippet,
        record.operator_summary.inclusion_status,
        record.operator_summary.resolution_state,
        record.operator_summary.quality_score == null ? "" : String(record.operator_summary.quality_score),
        record.operator_summary.provenance.source_names.join(" | "),
        record.platform ?? "",
        primaryAttribution(record).scope,
        record.conversation_role,
        record.occurred_at,
        record.sentiment ?? "",
        String(record.interaction_count),
        record.tags.map((tag) => tag.label).join(" | "),
        isMultiEntity(record) ? "true" : "false"
      ])
    ].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `admin-mentions-${filters.start}-${filters.end}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const retry = () => {
    requestSequence.current += 1;
    setFilters((current) => ({ ...current }));
  };

  const applyAnalyticsFilter = async (selection: SignalAnalyticsFilterSelection) => {
    applyFilterUpdate({
      start: selection.start,
      end: selection.end,
      dimensions: selection.dimensions ?? filters.dimensions,
      query: selection.searchQuery ?? filters.query
    });
    setSearch(selection.searchQuery ?? filters.query);
    return true;
  };

  const openAdvancedFilters = () => {
    if (activeRecord) {
      setActiveRecord(null);
      setActiveOperator(null);
      setDetailError(null);
      replaceMentionParam(null);
    }
    setFilterDraft(filters);
    setFiltersOpen(true);
  };

  const beginGovernance = (intent: GovernanceIntent) => {
    setGovernanceNotice(null);
    setGovernanceReason("");
    setGovernanceIntent(intent);
  };

  const submitGovernance = async () => {
    if (!governanceIntent || governanceReason.trim().length < 3) return;
    setGovernanceBusy(true);
    setGovernanceNotice(null);
    const results: Array<{ mentionId: string; ok: boolean; message?: string }> = [];
    try {
      for (let index = 0; index < governanceIntent.mentionIds.length; index += 4) {
        const batch = governanceIntent.mentionIds.slice(index, index + 4);
        const settled = await Promise.all(batch.map(async (mentionId) => {
          const response = await fetch(
            `/api/data-os/signal/${workspaceId}/admin-mentions/${mentionId}/governance`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": crypto.randomUUID()
              },
              body: JSON.stringify({
                action: governanceIntent.action,
                reason: governanceReason.trim()
              })
            }
          );
          const body = await response.json().catch(() => null) as { message?: string } | null;
          return {
            mentionId,
            ok: response.ok,
            message: response.ok ? undefined : body?.message ?? t("mentions.governance.error")
          };
        }));
        results.push(...settled);
      }

      const succeeded = results.filter((result) => result.ok).map((result) => result.mentionId);
      const failed = results.filter((result) => !result.ok);
      if (succeeded.length > 0) {
        setSelectedRecords((current) => {
          const next = new Map(current);
          for (const mentionId of succeeded) next.delete(mentionId);
          return next;
        });
        setRefreshKey((current) => current + 1);
        if (activeRecord && succeeded.includes(activeRecord.subject_id)) {
          await openMention(activeRecord.subject_id, false);
        }
      }

      if (failed.length > 0) {
        setGovernanceNotice({
          tone: "error",
          message: t("mentions.governance.partial", {
            failed: failed.length,
            total: results.length,
            reason: failed[0]?.message ?? t("mentions.governance.error")
          })
        });
      } else {
        setGovernanceNotice({
          tone: "success",
          message: t("mentions.governance.success", { count: succeeded.length })
        });
      }

      const openReviewAfter = governanceIntent.openReviewAfter && failed.length === 0;
      const reviewMentionId = succeeded[0] ?? governanceIntent.mentionIds[0];
      setGovernanceIntent(null);
      setGovernanceReason("");
      if (openReviewAfter && reviewMentionId) {
        const reviewUrl = new URL(reviewHref, window.location.origin);
        reviewUrl.searchParams.set("mention", reviewMentionId);
        window.location.assign(`${reviewUrl.pathname}${reviewUrl.search}`);
      }
    } catch (mutationError) {
      setGovernanceNotice({
        tone: "error",
        message: mutationError instanceof Error ? mutationError.message : t("mentions.governance.error")
      });
    } finally {
      setGovernanceBusy(false);
    }
  };

  return (
    <>
      <section className="admin-mentions">
        <article
          aria-busy={isLoading}
          className={`signal-v2-mentions-index admin-mentions__index${isLoading ? " is-loading" : ""}`}
        >
          <header className="signal-v2-mentions-index__head">
            <div className="signal-v2-mentions-tabs" role="tablist">
              <button aria-selected="true" role="tab" type="button">
                {t("mentions.views.all")}
                <span>{formatCount(totalCount)}</span>
              </button>
            </div>
            <div className="signal-v2-mentions-index__summary">
              <span>{t("mentions.showing", { shown: records.length, total: totalCount })}</span>
            </div>
          </header>

          <div className="admin-mentions__period-row">
            <SignalAnalyticsFilter
              boundedToCoverage
              comparison={noComparison}
              coverage={{ date_from: coverageFrom, date_through: coverageThrough }}
              filter={analyticsFilter}
              loading={isLoading}
              onApply={applyAnalyticsFilter}
              showComparison={false}
            />
            {isLoading ? <span aria-live="polite" className="signal-v2-local-update" role="status"><SpinnerGap aria-hidden size={13} />{t("mentions.updating")}</span> : null}
          </div>

          <div className="signal-v2-mentions-toolbar admin-mentions__toolbar">
            {selectedRecords.size > 0 ? (
              <MentionSelectionBar
                clearLabel={t("mentions.selection.clear")}
                label={t("mentions.selection.count", { count: selectedRecords.size })}
                onClear={() => setSelectedRecords(new Map())}
              >
                <button onClick={() => beginGovernance({ action: "include", mentionIds: selectedIds })} type="button">
                  {t("mentions.selection.include")}
                </button>
                <button onClick={() => beginGovernance({ action: "exclude", mentionIds: selectedIds })} type="button">
                  {t("mentions.selection.exclude")}
                </button>
                <button onClick={() => beginGovernance({ action: "send_to_review", mentionIds: selectedIds, openReviewAfter: true })} type="button">
                  {t("mentions.selection.reclassify")}
                </button>
                <button onClick={() => beginGovernance({ action: "send_to_review", mentionIds: selectedIds })} type="button">
                  {t("mentions.selection.sendReview")}
                </button>
                <button onClick={exportMentions} type="button">
                  <DownloadSimple aria-hidden size={14} />{t("mentions.selection.export")}
                </button>
              </MentionSelectionBar>
            ) : (
              <>
                <MentionResourceSearch
                  ariaLabel={t("mentions.search.label")}
                  clearLabel={t("mentions.search.clear")}
                  onChange={(nextSearch) => {
                    setSearch(nextSearch);
                    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = window.setTimeout(() => {
                      searchTimeoutRef.current = null;
                      applyFilterUpdate({ query: nextSearch });
                    }, 500);
                  }}
                  onClear={() => {
                    setSearch("");
                    applySearch("");
                  }}
                  onSubmit={() => applySearch()}
                  placeholder={t("mentions.search.placeholder")}
                  value={search}
                />
                <MentionResourceSort
                  ariaLabel={t("mentions.sort.ariaLabel")}
                  disabled={isLoading}
                  label={t("mentions.sort.label")}
                  onChange={(sortKey) => applyFilterUpdate({ sortKey })}
                  options={SORT_KEYS.map((key, index) => ({
                    groupStart: index > 1 && index % 2 === 0,
                    key,
                    label: t(`mentions.sort.${key}`)
                  }))}
                  value={filters.sortKey}
                />
                <MentionResourceColumns
                  columns={columns}
                  getLabel={(column) => t(`mentions.table.${column}`)}
                  labels={{
                    action: t("mentions.columns.action"),
                    drag: t("mentions.columns.drag"),
                    hide: (column) => t("mentions.columns.hide", { column }),
                    manual: t("mentions.columns.manual"),
                    order: t("mentions.columns.order"),
                    required: t("mentions.columns.required"),
                    show: (column) => t("mentions.columns.show", { column }),
                    title: t("mentions.columns.title")
                  }}
                  onChange={setColumns}
                />
                <button
                  className="signal-v2-filter-button"
                  onClick={openAdvancedFilters}
                  type="button"
                >
                  <Funnel aria-hidden size={15} />
                  {t("mentions.filters.action")}
                  {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
                </button>
                <button className="signal-v2-mentions-export" onClick={exportMentions} type="button">
                  <DownloadSimple aria-hidden size={15} />{t("mentions.selection.export")}
                </button>
              </>
            )}
          </div>

          {activeFilterCount > 0 ? (
            <div className="admin-mentions__active-filters">
              <span>{t("mentions.filters.active")}</span>
              {Object.entries(filters.dimensions).flatMap(([dimension, values]) => (
                (values ?? []).map((value) => (
                  <button
                    key={`${dimension}:${value}`}
                    onClick={() => applyFilterUpdate({ dimensions: withoutDimensionValue(filters.dimensions, dimension as SignalDimensionV1, value) })}
                    type="button"
                  >
                    {adminFilterLabels[dimension] ?? dimension}: {adminFilterValue(dimension, value, t, operatorFacetLabels)} ×
                  </button>
                ))
              ))}
              {Object.entries(filters.operatorFilters).flatMap(([dimension, values]) => (
                (values ?? []).map((value) => (
                  <button
                    key={`${dimension}:${value}`}
                    onClick={() => applyFilterUpdate({ operatorFilters: withoutFilterValue(filters.operatorFilters, dimension, value) })}
                    type="button"
                  >
                    {adminFilterLabels[dimension] ?? dimension}: {adminFilterValue(dimension, value, t, operatorFacetLabels)} ×
                  </button>
                ))
              ))}
              <button onClick={() => applyFilterUpdate({ dimensions: {}, operatorFilters: {} })} type="button">
                {t("mentions.filters.clear")}
              </button>
            </div>
          ) : null}

          {governanceNotice ? (
            <div
              className={`admin-mentions__governance-notice admin-mentions__governance-notice--${governanceNotice.tone}`}
              role={governanceNotice.tone === "error" ? "alert" : "status"}
            >
              {governanceNotice.tone === "error" ? <WarningCircle aria-hidden size={16} /> : null}
              <span>{governanceNotice.message}</span>
              <button aria-label={t("mentions.governance.dismiss")} onClick={() => setGovernanceNotice(null)} type="button"><X aria-hidden size={14} /></button>
            </div>
          ) : null}

          {error ? (
            <div className="admin-mentions__error" role="alert">
              <WarningCircle aria-hidden size={17} />
              <span>{error}</span>
              <button className="admin-button" onClick={retry} type="button">{t("mentions.retry")}</button>
            </div>
          ) : null}

          <div className="signal-v2-mentions-table-wrap signal-v2-mentions-table-wrap--table">
            {records.length > 0 ? (
              <MentionResourceTable
                columnLabel={(column) => t(`mentions.table.${column}`)}
                columns={visibleColumns}
                onActivate={(record) => void openMention(record.subject_id)}
                onTogglePage={() => {
                  const allPageSelected = records.length > 0
                    && records.every((record) => selectedRecords.has(record.subject_id));
                  setSelectedRecords((current) => {
                    const next = new Map(current);
                    for (const record of records) {
                      if (allPageSelected) next.delete(record.subject_id);
                      else next.set(record.subject_id, record);
                    }
                    return next;
                  });
                }}
                onToggleSelected={(record) => {
                  setSelectedRecords((current) => {
                    const next = new Map(current);
                    if (next.has(record.subject_id)) next.delete(record.subject_id);
                    else next.set(record.subject_id, record as AdminMentionListRecord);
                    return next;
                  });
                }}
                records={records}
                renderCell={(column, record) => {
                  const summary = (record as AdminMentionListRecord).operator_summary;
                  if (column === "inclusion") return <AdminMentionInclusionCell summary={summary} />;
                  if (column === "operator") return <AdminMentionSemanticStateCell summary={summary} />;
                  return undefined;
                }}
                selectedIds={selectedIds}
                selectionLabels={{
                  add: t("mentions.selection.add"),
                  clearPage: t("mentions.selection.clearPage"),
                  remove: t("mentions.selection.remove"),
                  selectPage: t("mentions.selection.selectPage")
                }}
              />
            ) : null}
            {!isLoading && !error && records.length === 0 ? (
              <div className="signal-v2-mentions-empty">
                <strong>{t("mentions.empty")}</strong>
                <p>{t("mentions.emptyHelp")}</p>
              </div>
            ) : null}
            {showEmptyLoadingState ? <MentionsTableSkeleton columns={visibleColumns.length + 1} /> : null}
          </div>

          <MentionResourcePagination
            disabled={isLoading}
            labels={{
              next: t("mentions.pagination.next"),
              perPage: t("mentions.pagination.perPage"),
              previous: t("mentions.pagination.previous")
            }}
            nextDisabled={nextOffset == null}
            onNext={() => nextOffset != null && setOffset(nextOffset)}
            onPageSize={(nextLimit) => {
              setLimit(nextLimit);
              setOffset(0);
              setSelectedRecords(new Map());
            }}
            onPrevious={() => setOffset(Math.max(0, offset - limit))}
            pageSize={limit}
            previousDisabled={offset === 0}
            rangeLabel={t("mentions.pagination.range", {
              start: pageStart,
              end: pageEnd,
              total: totalCount
            })}
          />
        </article>
      </section>

      {filtersOpen ? (
        <SignalFilterControls
          bodyOpenClassName="semantic-review-controls-open"
          comparison={noComparison}
          customValues={filterDraft.operatorFilters}
          definitions={ADMIN_FILTER_DEFINITIONS}
          dimensionLabels={adminFilterLabels}
          facetsOverride={adminFilterFacets}
          filter={draftAnalyticsFilter}
          formatValue={(dimension, value) => adminFilterValue(dimension, value, t, operatorFacetLabels)}
          loading={isLoading}
          onApply={async (selection) => {
            applyFilterUpdate({
              dimensions: selection.dimensions ?? {},
              operatorFilters: selection.customFilters ?? {}
            });
            setFiltersOpen(false);
            return true;
          }}
          onClose={() => setFiltersOpen(false)}
          open
          panelClassName="semantic-review-controls"
          pickerClassName="admin-mentions-filter-picker"
          portal
          scrimClassName="semantic-review-controls-scrim"
          showSearch={false}
          workspaceId={workspaceId}
        />
      ) : null}

      {activeRecord ? (
        <SignalMentionDetailDrawer
          footer={(
            <div className="admin-mention-operator__actions">
              {activeOperator?.inclusion.status !== "included" ? (
                <button className="admin-button admin-button--primary" onClick={() => beginGovernance({ action: "include", mentionIds: [activeRecord.subject_id] })} type="button">
                  {t("mentions.selection.include")}
                </button>
              ) : (
                <button className="admin-button admin-button--danger" onClick={() => beginGovernance({ action: "exclude", mentionIds: [activeRecord.subject_id] })} type="button">
                  {t("mentions.selection.exclude")}
                </button>
              )}
              {activeOperator && activeOperator.governance.history.length > 0 ? (
                <button className="admin-button" onClick={() => beginGovernance({ action: "revert", mentionIds: [activeRecord.subject_id] })} type="button">
                  {t("mentions.governance.revert")}
                </button>
              ) : null}
              <button className="admin-button" onClick={() => beginGovernance({ action: "send_to_review", mentionIds: [activeRecord.subject_id], openReviewAfter: true })} type="button">
                {t("mentions.governance.openReview")}
              </button>
            </div>
          )}
          onClose={() => {
            setActiveRecord(null);
            setActiveOperator(null);
            setDetailError(null);
            replaceMentionParam(null);
          }}
          operatorContent={(
            <AdminMentionOperatorPrimaryPanel
              error={detailError}
              loading={detailLoading}
              operator={activeOperator}
            />
          )}
          record={activeRecord}
          technicalContent={<AdminMentionOperatorTechnicalPanel operator={activeOperator} />}
          variant="operator"
        />
      ) : null}

      <WorkspaceConfirmDialog
        busy={governanceBusy}
        cancelLabel={t("mentions.governance.cancel")}
        confirmDisabled={governanceReason.trim().length < 3}
        confirmLabel={governanceIntent ? governanceConfirmLabel(governanceIntent.action, t) : t("mentions.governance.confirm")}
        message={governanceIntent ? t("mentions.governance.message", { count: governanceIntent.mentionIds.length }) : ""}
        onClose={() => {
          if (governanceBusy) return;
          setGovernanceIntent(null);
          setGovernanceReason("");
        }}
        onConfirm={submitGovernance}
        open={Boolean(governanceIntent)}
        title={governanceIntent ? governanceTitle(governanceIntent.action, t) : t("mentions.governance.title")}
        tone={governanceIntent?.action === "exclude" ? "danger" : "default"}
      >
        <label className="admin-mentions__governance-reason">
          <span>{t("mentions.governance.reason")}</span>
          <textarea
            autoFocus
            disabled={governanceBusy}
            maxLength={1000}
            onChange={(event) => setGovernanceReason(event.target.value)}
            placeholder={t("mentions.governance.reasonPlaceholder")}
            value={governanceReason}
          />
          <small>{t("mentions.governance.reasonHelp")}</small>
        </label>
      </WorkspaceConfirmDialog>
    </>
  );
}

function filtersFromParams(searchParams: URLSearchParams | Readonly<URLSearchParams>, defaults: MentionFilters): MentionFilters {
  const sortParam = searchParams.get("sort") as MentionSortKey | null;
  const dimensions: SignalDimensionValuesV1 = {};
  for (const definition of ADMIN_SIGNAL_FILTER_DEFINITIONS) {
    const values = searchParams.getAll(`dimension.${definition.dimension}`)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLocaleLowerCase("en-US"))
      .filter(Boolean);
    if (values.length > 0) dimensions[definition.dimension as SignalDimensionV1] = Array.from(new Set(values));
  }
  const legacyPlatform = searchParams.get("platform")?.trim();
  const legacyRole = searchParams.get("role")?.trim();
  if (legacyPlatform && legacyPlatform !== "all") dimensions.platform = [legacyPlatform];
  if (legacyRole && legacyRole !== "all") dimensions.conversation_role = [legacyRole];
  const operatorFilters: Record<string, string[]> = {};
  for (const definition of ADMIN_OPERATOR_FILTER_DEFINITIONS) {
    const value = searchParams.get(definition.dimension)?.trim();
    if (value) operatorFilters[definition.dimension] = [value];
  }
  return {
    dimensions,
    end: dateOnly(searchParams.get("end")) ?? defaults.end,
    operatorFilters,
    query: searchParams.get("q") ?? defaults.query,
    sortKey: sortParam && SORT_KEYS.includes(sortParam) ? sortParam : defaults.sortKey,
    start: dateOnly(searchParams.get("start")) ?? defaults.start
  };
}

function sortParams(sortKey: MentionSortKey): {
  field: "published" | "platform" | "conversation_role" | "engagement";
  direction: "asc" | "desc";
} {
  if (sortKey === "publishedAsc") return { field: "published", direction: "asc" };
  if (sortKey === "platformAsc") return { field: "platform", direction: "asc" };
  if (sortKey === "platformDesc") return { field: "platform", direction: "desc" };
  if (sortKey === "roleAsc") return { field: "conversation_role", direction: "asc" };
  if (sortKey === "roleDesc") return { field: "conversation_role", direction: "desc" };
  if (sortKey === "engagementAsc") return { field: "engagement", direction: "asc" };
  if (sortKey === "engagementDesc") return { field: "engagement", direction: "desc" };
  return { field: "published", direction: "desc" };
}

function countAdvancedFilters(filters: MentionFilters) {
  return [filters.dimensions, filters.operatorFilters].reduce(
    (total, group) => total + Object.values(group).reduce(
      (groupTotal, values) => groupTotal + (values?.length ?? 0),
      0
    ),
    0
  );
}

function pageSizeFromParam(value: string | null) {
  const parsed = Number(value);
  return [25, 50, 100].includes(parsed) ? parsed : 50;
}

function offsetFromParam(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : 0;
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function dateOnly(value: string | null) {
  const candidate = value?.slice(0, 10) ?? null;
  return candidate && /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : null;
}

function isMultiEntity(record: SignalMentionRecordV1) {
  const identities = new Set(record.attribution.map((item) => `${item.scope}:${item.label}`));
  return identities.size > 1 || record.entities.length > 1;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function prettyPlatform(platform: string | null) {
  const normalized = platform?.trim().toLowerCase() ?? "";
  if (normalized === "x" || normalized === "twitter") return "X";
  if (normalized === "tiktok") return "TikTok";
  if (normalized === "youtube") return "YouTube";
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Web";
}

function facetValues(values: string[]): SignalFilterFacetValue[] {
  return values.map((key) => ({ key, count: null }));
}

function mergeAdminFilterFacets(operatorFacets: AdminMentionOperatorFacetsV1 | null) {
  const facets: Partial<Record<string, SignalFilterFacetValue[]>> = {
    ...ADMIN_FILTER_FACETS,
    minimum_quality_score: ADMIN_QUALITY_FILTER_FACETS
  };
  if (!operatorFacets) return facets;
  for (const [dimension, values] of Object.entries(operatorFacets.facets)) {
    const targetDimension = dimension === "provenance_source" ? "provenance_source_id" : dimension;
    facets[targetDimension] = values.map((value) => ({ key: value.key, count: value.count }));
  }
  return facets;
}

function buildOperatorFacetLabels(operatorFacets: AdminMentionOperatorFacetsV1 | null) {
  const labels: Record<string, Record<string, string>> = {};
  if (!operatorFacets) return labels;
  for (const [dimension, values] of Object.entries(operatorFacets.facets)) {
    const targetDimension = dimension === "provenance_source" ? "provenance_source_id" : dimension;
    labels[targetDimension] = Object.fromEntries(values.map((value) => [value.key, value.label]));
  }
  return labels;
}

function buildAdminFilterLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    platform: t("mentions.filters.dimensions.platform"),
    corpus_scope: t("mentions.filters.dimensions.corpus_scope"),
    sentiment_polarity: t("mentions.filters.dimensions.sentiment_polarity"),
    content_format: t("mentions.filters.dimensions.content_format"),
    conversation_role: t("mentions.filters.dimensions.conversation_role"),
    tb_polarity: t("mentions.filters.dimensions.tb_polarity"),
    tb_layer: t("mentions.filters.dimensions.tb_layer"),
    inclusion_status: t("mentions.filters.operatorDimensions.inclusion_status"),
    resolution_state: t("mentions.filters.operatorDimensions.resolution_state"),
    review_status: t("mentions.filters.operatorDimensions.review_status"),
    eligibility_status: t("mentions.filters.operatorDimensions.eligibility_status"),
    minimum_quality_score: t("mentions.filters.operatorDimensions.minimum_quality_score"),
    quality_flag: t("mentions.filters.operatorDimensions.quality_flag"),
    latest_governance_action: t("mentions.filters.operatorDimensions.latest_governance_action"),
    provenance_source_id: t("mentions.filters.operatorDimensions.provenance_source_id")
  };
}

function adminFilterValue(
  dimension: string,
  value: string,
  t: ReturnType<typeof useTranslations>,
  operatorLabels: Record<string, Record<string, string>>
) {
  const translationKey = ADMIN_FILTER_VALUE_KEYS[dimension as SignalDimensionV1]?.[value];
  const operatorTranslationKey = OPERATOR_FILTER_VALUE_KEYS[dimension]?.[value];
  if (operatorTranslationKey) return t(`mentions.filters.operatorValues.${operatorTranslationKey}`);
  const operatorLabel = operatorLabels[dimension]?.[value];
  if (operatorLabel) return operatorLabel;
  if (dimension === "minimum_quality_score") return `≥ ${value}`;
  if (translationKey) return t(`mentions.filters.values.${translationKey}`);
  if (dimension === "platform") return prettyPlatform(value);
  return value.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase());
}

function withoutDimensionValue(
  dimensions: SignalDimensionValuesV1,
  dimension: SignalDimensionV1,
  value: string
) {
  const next = { ...dimensions };
  const values = (next[dimension] ?? []).filter((item) => item !== value);
  if (values.length > 0) next[dimension] = values;
  else delete next[dimension];
  return next;
}

function withoutFilterValue(
  filters: Record<string, string[]>,
  dimension: string,
  value: string
) {
  const next = { ...filters };
  const values = (next[dimension] ?? []).filter((item) => item !== value);
  if (values.length > 0) next[dimension] = values;
  else delete next[dimension];
  return next;
}

function governanceTitle(action: GovernanceAction, t: ReturnType<typeof useTranslations>) {
  return t(`mentions.governance.actions.${action}.title`);
}

function governanceConfirmLabel(action: GovernanceAction, t: ReturnType<typeof useTranslations>) {
  return t(`mentions.governance.actions.${action}.confirm`);
}
