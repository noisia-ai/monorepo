"use client";

import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  ChatTeardropText,
  Copy,
  DownloadSimple,
  Funnel,
  GridFour,
  ListBullets,
  MagnifyingGlass,
  SpinnerGap
} from "@phosphor-icons/react";
import type {
  SignalComparisonV1,
  SignalFilterV1
} from "@noisia/query-engine";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import type {
  SignalMentionRecordV1,
  SignalMentionsPayloadV1
} from "@/lib/data-os/signal-workspace-serving";
import {
  AttributionBadge,
  formatCount,
  MentionContext,
  MentionResourceColumns,
  MentionResourcePagination,
  MentionResourceSearch,
  MentionResourceSort,
  MentionResourceTable,
  MentionSelectionBar,
  MentionSentiment,
  MentionsTableSkeleton,
  pretty,
  primaryAttribution,
  type MentionColumn,
  type MentionColumnState
} from "@/components/mentions/MentionResourcePrimitives";

import {
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "./SignalAnalyticsFilter";
import { SignalMetricHelp } from "./SignalMetricHelp";
import { SignalSourceIcon } from "./SignalSourceIcon";
import { SignalV2ModuleHeader } from "./SignalV2ModuleHeader";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";

export type SignalMentionsViewData = SignalMentionsPayloadV1 & {
  filter: SignalFilterV1;
  comparison: SignalComparisonV1;
};

const DEFAULT_COLUMNS: MentionColumnState[] = [
  { key: "mention", visible: true, locked: true },
  { key: "scope", visible: true },
  { key: "platform", visible: true },
  { key: "role", visible: true },
  { key: "published", visible: true },
  { key: "sentiment", visible: true },
  { key: "engagement", visible: true },
  { key: "context", visible: true }
];

type MentionsLayout = "table" | "cards";
type MentionSortKey =
  | "publishedDesc"
  | "publishedAsc"
  | "platformAsc"
  | "platformDesc"
  | "roleAsc"
  | "roleDesc"
  | "engagementDesc"
  | "engagementAsc";

const MENTION_SORT_KEYS: MentionSortKey[] = [
  "publishedDesc",
  "publishedAsc",
  "platformAsc",
  "platformDesc",
  "roleAsc",
  "roleDesc",
  "engagementDesc",
  "engagementAsc"
];

type MentionTbCoding = NonNullable<SignalMentionRecordV1["tb_classification"]>["codings"][number];

export function SignalV2Mentions({
  brandName,
  coverage,
  data,
  initialMention,
  loading,
  onApplyFilter,
  onDataChange,
  onOpenControls,
  workspaceId
}: {
  brandName: string;
  coverage: { date_from: string | null; date_through: string | null };
  data: SignalMentionsViewData;
  initialMention: SignalMentionRecordV1 | null;
  loading: boolean;
  onApplyFilter: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onDataChange: (data: SignalMentionsViewData) => void;
  onOpenControls: () => void;
  workspaceId: string;
}) {
  const t = useTranslations("SignalV2");
  const [search, setSearch] = useState(data.filter.search_query ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeRecord, setActiveRecord] = useState<SignalMentionRecordV1 | null>(initialMention);
  const [columns, setColumns] = useState<MentionColumnState[]>(DEFAULT_COLUMNS);
  const [layout, setLayout] = useState<MentionsLayout>("table");
  const [sortKey, setSortKey] = useState<MentionSortKey>("publishedDesc");
  const [pageLoading, setPageLoading] = useState(false);
  const [showEmptyLoadingState, setShowEmptyLoadingState] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const pageRequestRef = useRef<AbortController | null>(null);
  const previousFiltersHashRef = useRef(data.filters_hash);

  useEffect(() => {
    const filterChanged = previousFiltersHashRef.current !== data.filters_hash;
    previousFiltersHashRef.current = data.filters_hash;
    setSearch(data.filter.search_query ?? "");
    setSelectedIds([]);
    if (filterChanged) setActiveRecord(null);
    setSortKey("publishedDesc");
    setPageError(null);
  }, [data.filters_hash, data.filter.search_query]);

  useEffect(() => {
    if (initialMention) setActiveRecord(initialMention);
  }, [initialMention]);

  useEffect(() => () => {
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
    pageRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if ((!loading && !pageLoading) || data.records.length > 0) {
      setShowEmptyLoadingState(false);
      return;
    }
    const timer = window.setTimeout(() => setShowEmptyLoadingState(true), 220);
    return () => window.clearTimeout(timer);
  }, [data.records.length, loading, pageLoading]);

  const selectedRecords = useMemo(
    () => data.records.filter((record) => selectedIds.includes(record.subject_id)),
    [data.records, selectedIds]
  );
  const visibleColumns = columns.filter((column) => column.visible).map((column) => column.key);
  const activeFilterCount = Object.values(data.filter.dimensions)
    .reduce((total, values) => total + (values?.length ?? 0), 0)
    + Number(Boolean(data.filter.search_query));
  const pageStart = data.total_count === 0 ? 0 : data.page.offset + 1;
  const pageEnd = data.total_count === 0
    ? 0
    : Math.min(pageStart + data.records.length - 1, data.total_count);

  const activateRecord = (record: SignalMentionRecordV1) => {
    setActiveRecord(record);
    const next = new URL(window.location.href);
    next.searchParams.set("mention", record.subject_id);
    window.history.replaceState(null, "", next);
  };

  const closeActiveRecord = () => {
    setActiveRecord(null);
    const next = new URL(window.location.href);
    next.searchParams.delete("mention");
    window.history.replaceState(null, "", next);
  };

  const applySearch = async () => {
    await onApplyFilter(selectionFromData(data, search));
  };

  const loadPage = async ({
    limit = data.page.limit,
    offset,
    sort = sortKey
  }: {
    limit?: number;
    offset: number;
    sort?: MentionSortKey;
  }) => {
    pageRequestRef.current?.abort();
    const controller = new AbortController();
    pageRequestRef.current = controller;
    setPageLoading(true);
    setPageError(null);
    try {
      const params = mentionQueryParams(data);
      const parsedSort = mentionSortParams(sort);
      params.set("offset", String(offset));
      params.set("limit", String(limit));
      params.set("sort", parsedSort.field);
      params.set("direction", parsedSort.direction);
      const response = await fetch(`/api/data-os/signal/${workspaceId}/mentions?${params}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const payload = await response.json() as SignalMentionsViewData & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("mentions.errors.load"));
      onDataChange(payload);
      setSelectedIds([]);
      setActiveRecord(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPageError(error instanceof Error ? error.message : t("mentions.errors.load"));
    } finally {
      if (pageRequestRef.current === controller) {
        pageRequestRef.current = null;
        setPageLoading(false);
      }
    }
  };

  const goBack = () => {
    void loadPage({
      offset: Math.max(0, data.page.offset - data.page.limit)
    });
  };

  const exportSelection = () => {
    const rows = selectedRecords.length > 0 ? selectedRecords : data.records;
    const csv = [
      [
        t("mentions.table.mention"),
        t("mentions.table.platform"),
        t("mentions.table.scope"),
        t("mentions.table.role"),
        t("mentions.table.published"),
        t("mentions.table.sentiment"),
        t("mentions.table.engagement"),
        t("mentions.table.context")
      ],
      ...rows.map((record) => [
        record.title || record.text_snippet,
        record.platform ?? "",
        t(`mentions.scope.${primaryAttribution(record).scope}`),
        record.conversation_role,
        record.occurred_at,
        record.sentiment ?? "",
        String(record.interaction_count),
        record.tags.map((tag) => tag.label).join(" | ")
      ])
    ].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `signal-mentions-${data.filter.date_range.start}-${data.filter.date_range.end}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copySelectedLinks = async () => {
    const links = selectedRecords.flatMap((record) => record.url ? [record.url] : []);
    if (links.length > 0) await navigator.clipboard.writeText(links.join("\n"));
  };

  return (
    <section className="signal-v2-mentions-page">
      <SignalV2ModuleHeader
        controls={<>
          <SignalAnalyticsFilter
            comparison={data.comparison}
            coverage={coverage}
            filter={data.filter}
            loading={loading}
            onApply={onApplyFilter}
          />
          <button className="signal-v2-filter-button" onClick={onOpenControls} type="button">
            <Funnel size={15} />
            {t("filters.more")}
            {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
          </button>
        </>}
        icon={<ChatTeardropText size={20} weight="fill" />}
        status={t("mentions.status")}
        subtitle={t("mentions.subtitle", { brand: brandName })}
        title={t("mentions.title")}
      />

      <article
        aria-busy={loading || pageLoading}
        className={`signal-v2-mentions-index${loading || pageLoading ? " is-loading" : ""}`}
      >
        <header className="signal-v2-mentions-index__head">
          <div className="signal-v2-mentions-tabs" role="tablist">
            <button aria-selected="true" role="tab" type="button">
              {t("mentions.views.all")}
              <span>{formatCount(data.total_count)}</span>
            </button>
          </div>
          <div className="signal-v2-mentions-index__summary">
            <span>{t("mentions.summary", { count: data.total_count })}</span>
          </div>
        </header>

        <div className="signal-v2-mentions-toolbar">
          {selectedIds.length > 0 ? (
            <MentionSelectionBar
              clearLabel={t("mentions.actions.clearSelection")}
              label={t("mentions.selection", { count: selectedIds.length })}
              onClear={() => setSelectedIds([])}
            >
              <button onClick={() => void copySelectedLinks()} type="button">
                <Copy size={14} />{t("mentions.actions.copyLinks")}
              </button>
              <button onClick={exportSelection} type="button">
                <DownloadSimple size={14} />{t("mentions.actions.export")}
              </button>
            </MentionSelectionBar>
          ) : (
            <>
              <MentionResourceSearch
                ariaLabel={t("mentions.search.label")}
                clearLabel={t("mentions.search.clear")}
                onChange={(nextSearch) => {
                  setSearch(nextSearch);
                  if (searchTimeoutRef.current != null) {
                    window.clearTimeout(searchTimeoutRef.current);
                  }
                  searchTimeoutRef.current = window.setTimeout(() => {
                    searchTimeoutRef.current = null;
                    void onApplyFilter(selectionFromData(data, nextSearch));
                  }, 500);
                }}
                onClear={() => {
                  if (searchTimeoutRef.current != null) {
                    window.clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = null;
                  }
                  setSearch("");
                  void onApplyFilter(selectionFromData(data, ""));
                }}
                onSubmit={() => {
                  if (searchTimeoutRef.current != null) {
                    window.clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = null;
                  }
                  void applySearch();
                }}
                placeholder={t("mentions.search.placeholder")}
                value={search}
              />
              <div
                aria-label={t("mentions.layout.label")}
                className="signal-v2-mentions-layout"
                role="group"
              >
                <button
                  aria-label={t("mentions.layout.table")}
                  aria-pressed={layout === "table"}
                  onClick={() => setLayout("table")}
                  type="button"
                >
                  <ListBullets size={15} />
                </button>
                <button
                  aria-label={t("mentions.layout.cards")}
                  aria-pressed={layout === "cards"}
                  onClick={() => setLayout("cards")}
                  type="button"
                >
                  <GridFour size={15} />
                </button>
              </div>
              <MentionResourceSort
                ariaLabel={t("mentions.sort.ariaLabel")}
                disabled={pageLoading}
                label={t("mentions.sort.label")}
                onChange={(key) => {
                  setSortKey(key);
                  void loadPage({ offset: 0, sort: key });
                }}
                options={MENTION_SORT_KEYS.map((key, index) => ({
                  groupStart: index > 1 && index % 2 === 0,
                  key,
                  label: t(`mentions.sort.${key}`)
                }))}
                value={sortKey}
              />
              <MentionResourceColumns
                columns={columns}
                getLabel={(key) => t(`mentions.table.${key}`)}
                labels={{
                  action: t("mentions.actions.columns"),
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
              <button className="signal-v2-mentions-export" onClick={exportSelection} type="button">
                <DownloadSimple size={15} />{t("mentions.actions.export")}
              </button>
            </>
          )}
          {loading || pageLoading ? (
            <span aria-live="polite" className="signal-v2-local-update" role="status">
              <SpinnerGap aria-hidden size={13} />
              {t("actions.loading")}
            </span>
          ) : null}
        </div>

        {pageError ? <p className="signal-v2-mentions-error">{pageError}</p> : null}

        <div className={`signal-v2-mentions-table-wrap signal-v2-mentions-table-wrap--${layout}`}>
          {layout === "table" ? (
            <MentionResourceTable
              columnLabel={(column) => t(`mentions.table.${column}`)}
              columns={visibleColumns}
              onActivate={activateRecord}
              onTogglePage={() => {
                const pageIds = data.records.map((record) => record.subject_id);
                const pageSelected = pageIds.length > 0
                  && pageIds.every((id) => selectedIds.includes(id));
                setSelectedIds(pageSelected
                  ? selectedIds.filter((id) => !pageIds.includes(id))
                  : Array.from(new Set([...selectedIds, ...pageIds])));
              }}
              onToggleSelected={(record) => {
                const selected = selectedIds.includes(record.subject_id);
                setSelectedIds((current) => selected
                  ? current.filter((id) => id !== record.subject_id)
                  : [...current, record.subject_id]);
              }}
              records={data.records}
              selectedIds={selectedIds}
              selectionLabels={{
                add: t("mentions.selectionAdd"),
                clearPage: t("mentions.selectionClearAll"),
                remove: t("mentions.selectionRemove"),
                selectPage: t("mentions.selectionAll")
              }}
            />
          ) : (
            <MentionCards
              activeRecord={activeRecord}
              columns={visibleColumns}
              onActivate={activateRecord}
              onSelect={(record) => {
                const selected = selectedIds.includes(record.subject_id);
                setSelectedIds((current) => selected
                  ? current.filter((id) => id !== record.subject_id)
                  : [...current, record.subject_id]);
              }}
              records={data.records}
              selectedIds={selectedIds}
            />
          )}
          {data.records.length === 0 ? (
            <div className="signal-v2-mentions-empty">
              <MagnifyingGlass size={22} />
              <strong>{t("mentions.empty.title")}</strong>
              <p>{t("mentions.empty.body")}</p>
            </div>
          ) : null}
          {showEmptyLoadingState
            ? layout === "table"
              ? <MentionsTableSkeleton columns={visibleColumns.length + 1} />
              : <MentionsCardSkeleton />
            : null}
        </div>

        <MentionResourcePagination
          disabled={pageLoading}
          labels={{
            next: t("mentions.pagination.next"),
            perPage: t("mentions.pagination.perPage"),
            previous: t("mentions.pagination.previous")
          }}
          nextDisabled={data.page.next_offset == null}
          onNext={() => data.page.next_offset != null && void loadPage({
            offset: data.page.next_offset
          })}
          onPageSize={(size) => void loadPage({ limit: size, offset: 0 })}
          onPrevious={goBack}
          pageSize={data.page.limit}
          previousDisabled={data.page.offset === 0}
          rangeLabel={t("mentions.pagination.range", {
            start: pageStart,
            end: pageEnd,
            total: data.total_count
          })}
        />
      </article>

      {activeRecord ? (
        <SignalMentionDetailDrawer
          onClose={closeActiveRecord}
          record={activeRecord}
        />
      ) : null}
    </section>
  );
}

function MentionCards({
  activeRecord,
  columns,
  onActivate,
  onSelect,
  records,
  selectedIds
}: {
  activeRecord: SignalMentionRecordV1 | null;
  columns: MentionColumn[];
  onActivate: (record: SignalMentionRecordV1) => void;
  onSelect: (record: SignalMentionRecordV1) => void;
  records: SignalMentionRecordV1[];
  selectedIds: string[];
}) {
  const t = useTranslations("SignalV2");
  return (
    <div className="signal-v2-mention-cards">
      {records.map((record) => {
        const selected = selectedIds.includes(record.subject_id);
        return (
          <article
            aria-current={activeRecord?.subject_id === record.subject_id ? "true" : undefined}
            className="signal-v2-mention-card"
            key={record.subject_id}
            onClick={() => onActivate(record)}
          >
            <header>
              <span className="signal-v2-source-label">
                <SignalSourceIcon platform={record.platform} size={15} />
                {columns.includes("platform") ? pretty(record.platform) : t("mentions.card.mention")}
              </span>
              <button
                aria-label={selected ? t("mentions.selectionRemove") : t("mentions.selectionAdd")}
                className="signal-v2-mention-card__select"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(record);
                }}
                type="button"
              >
                {selected ? <Check size={12} weight="bold" /> : null}
              </button>
            </header>
            <div className="signal-v2-mention-card__body">
              {record.title ? <strong>{record.title}</strong> : null}
              <p>{record.text_snippet || t("mentions.detail.noText")}</p>
            </div>
            <div className="signal-v2-mention-card__meta">
              {columns.includes("scope") ? <AttributionBadge record={record} /> : null}
              {columns.includes("role")
                ? <span className="signal-v2-neutral-chip">{t(`mentions.roles.${record.conversation_role}`)}</span>
                : null}
              {columns.includes("sentiment") ? <MentionSentiment value={record.sentiment} /> : null}
              {columns.includes("published") ? <time>{formatDate(record.occurred_at)}</time> : null}
            </div>
            {columns.includes("context") ? <MentionContext record={record} /> : null}
            {columns.includes("engagement") ? (
              <footer>
                <span>{t("mentions.table.engagement")}</span>
                <strong>{formatCount(record.interaction_count)}</strong>
              </footer>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function SignalMentionDetailDrawer({
  footer,
  onClose,
  operatorAction,
  operatorContent,
  record,
  technicalContent,
  variant = "signal"
}: {
  footer?: ReactNode;
  onClose: () => void;
  operatorAction?: {
    label: string;
    onClick: () => void;
  };
  operatorContent?: ReactNode;
  record: SignalMentionRecordV1;
  technicalContent?: ReactNode;
  variant?: "operator" | "signal";
}) {
  const t = useTranslations("SignalV2");
  const engagement = Object.entries(record.engagement)
    .flatMap(([key, value]) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? [{ key, value: numeric }] : [];
    })
    .sort((left, right) => right.value - left.value);
  const groupedTags = groupTags(record.tags);
  const visibleFeatures = record.features.filter(isPublicMentionFeature);
  const performanceSection = (
    <DetailSection key="performance" title={t("mentions.detail.performance")}>
      <dl className="signal-v2-mention-drawer__metrics">
        <div><dt>{t("mentions.table.engagement")}</dt><dd>{formatCount(record.interaction_count)}</dd></div>
        {engagement.map((item) => (
          <div key={item.key}><dt>{pretty(item.key)}</dt><dd>{formatCount(item.value)}</dd></div>
        ))}
      </dl>
    </DetailSection>
  );
  const scopeSection = (
    <DetailSection
      help={{
        body: t("mentions.helpers.scope.body"),
        process: t("mentions.helpers.scope.process"),
        title: t("mentions.helpers.scope.title")
      }}
      key="scope"
      title={t("mentions.detail.scope")}
    >
      <div className="signal-v2-mention-drawer__scope">
        <AttributionBadge record={record} />
        {record.attribution.length > 1 ? (
          <small>{t("mentions.scope.multiple", {
            scopes: record.attribution
              .map((item) => t(`mentions.scope.${item.scope}`))
              .filter((item, index, values) => values.indexOf(item) === index)
              .join(", ")
          })}</small>
        ) : null}
      </div>
    </DetailSection>
  );
  const tbSection = record.tb_classification ? (
    <DetailSection
      help={{
        body: t("mentions.helpers.tb.body"),
        process: t("mentions.helpers.tb.process"),
        title: t("mentions.helpers.tb.title")
      }}
      key="tb"
      title={t("mentions.detail.tbEnrichment")}
    >
      <div className="signal-v2-mention-drawer__tb">
        <div className="signal-v2-mention-drawer__tb-head">
          <strong>{t("mentions.tb.title")}</strong>
          <span>{t("mentions.tb.analysisApproved")}</span>
        </div>
        {record.tb_classification.codings.map((coding, index) => (
          <div className="signal-v2-mention-drawer__tb-coding" key={`${coding.finding_id ?? "coding"}:${index}`}>
            <div>
              <TbBadge coding={coding} />
              {coding.layer ? <span>{t(`mentions.tb.layer.${coding.layer}`)}</span> : null}
              {coding.ambiguous ? <span>{t("mentions.tb.ambiguous")}</span> : null}
            </div>
            {coding.emergent_tags.length > 0 ? (
              <div className="signal-v2-mention-drawer__tb-signals">
                <small>
                  <SignalMetricHelp
                    content={{
                      body: t("mentions.helpers.observedSignals.body"),
                      formula: t("mentions.helpers.observedSignals.process"),
                      title: t("mentions.helpers.observedSignals.title")
                    }}
                    label={t("mentions.tb.observedSignals")}
                  />
                </small>
                <ul>{coding.emergent_tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </DetailSection>
  ) : null;
  const enrichmentSection = (
    <DetailSection
      help={{
        body: t("mentions.helpers.enrichment.body"),
        process: t("mentions.helpers.enrichment.process"),
        title: t("mentions.helpers.enrichment.title")
      }}
      key="enrichment"
      title={t("mentions.detail.enrichment")}
    >
      {groupedTags.length > 0 ? groupedTags.map(([taxonomy, tags]) => (
        <div className="signal-v2-mention-drawer__tag-group" key={taxonomy}>
          <strong>{pretty(taxonomy)}</strong>
          <div>{tags.map((tag) => <span key={tag.term_key}>{tag.label}</span>)}</div>
        </div>
      )) : <p className="signal-v2-mention-drawer__empty">{t("mentions.detail.noEnrichment")}</p>}
    </DetailSection>
  );
  const attributesSection = visibleFeatures.length > 0 ? (
    <DetailSection
      help={{
        body: t("mentions.helpers.attributes.body"),
        process: t("mentions.helpers.attributes.process"),
        title: t("mentions.helpers.attributes.title")
      }}
      key="attributes"
      title={t("mentions.detail.attributes")}
    >
      <div className="signal-v2-mention-drawer__features">
        {visibleFeatures.map((feature, index) => (
          <span key={`${feature.key}:${index}`}>
            <strong>{pretty(feature.key)}</strong>
            <small>{formatFeatureValue(feature.value, t("mentions.detail.present"))}</small>
          </span>
        ))}
      </div>
    </DetailSection>
  ) : null;
  const entitiesSection = record.entities.length > 0 ? (
    <DetailSection key="entities" title={t("mentions.detail.entities")}>
      <div className="signal-v2-mention-drawer__entities">
        {record.entities.map((entity) => (
          <span key={`${entity.type}:${entity.name}`}>
            <strong>{entity.name}</strong>
            <small>{pretty(entity.type)}</small>
          </span>
        ))}
      </div>
    </DetailSection>
  ) : null;
  const metadataSection = (
    <DetailSection key="metadata" title={t("mentions.detail.metadata")}>
      <dl className="signal-v2-mention-drawer__metadata">
        <div><dt>{t("mentions.table.platform")}</dt><dd>{pretty(record.platform)}</dd></div>
        <div><dt>{t("mentions.table.role")}</dt><dd>{t(`mentions.roles.${record.conversation_role}`)}</dd></div>
        <div><dt>{t("mentions.detail.language")}</dt><dd>{record.language?.toUpperCase() || "—"}</dd></div>
        <div><dt>{t("mentions.detail.country")}</dt><dd>{record.country || "—"}</dd></div>
      </dl>
    </DetailSection>
  );
  const signalSections = [performanceSection, scopeSection, tbSection, enrichmentSection, attributesSection, entitiesSection, metadataSection];
  const operatorSections = [tbSection, scopeSection, enrichmentSection, attributesSection, metadataSection, performanceSection, entitiesSection];

  return (
    <WorkspaceDrawer
      ariaLabel={t("mentions.detail.title")}
      bodyClassName="signal-v2-mention-drawer__content"
      closeLabel={t("mentions.detail.close")}
      eyebrow={(
        <span className="signal-v2-source-label">
          <SignalSourceIcon platform={record.platform} size={15} />
          {pretty(record.platform)}
        </span>
      )}
      layerClassName="signal-v2-mention-drawer-layer"
      onClose={onClose}
      panelClassName="signal-v2-mention-drawer"
      scrimClassName="signal-v2-mention-drawer-scrim"
      title={t("mentions.detail.title")}
      footer={footer}
    >
          <section className="signal-v2-mention-drawer__verbatim">
            <div>
              <span className="signal-v2-neutral-chip">{t(`mentions.roles.${record.conversation_role}`)}</span>
              <MentionSentiment value={record.sentiment} />
            </div>
            {record.title ? <h2>{record.title}</h2> : null}
            <p>{record.text_snippet || t("mentions.detail.noText")}</p>
            <small>{formatDateTime(record.occurred_at)}</small>
            {record.url || operatorAction ? (
              <div className="signal-v2-mention-drawer__verbatim-actions">
                {record.url ? (
                  <a href={record.url} rel="noreferrer" target="_blank">
                    {t("mentions.detail.openOriginal")}<ArrowSquareOut size={14} />
                  </a>
                ) : null}
                {operatorAction ? (
                  <button onClick={operatorAction.onClick} type="button">
                    {operatorAction.label}<ArrowRight size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {operatorContent}
          {(variant === "operator" ? operatorSections : signalSections).filter(Boolean)}
          {technicalContent}
    </WorkspaceDrawer>
  );
}

function DetailSection({
  children,
  help,
  title
}: {
  children: ReactNode;
  help?: { body: string; process: string; title: string };
  title: string;
}) {
  return (
    <section className="signal-v2-mention-drawer__section">
      <div className="signal-v2-mention-drawer__section-title">
        <h3>
          {help ? (
            <SignalMetricHelp
              content={{
                body: help.body,
                formula: help.process,
                title: help.title
              }}
              label={title}
            />
          ) : title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function TbBadge({ coding }: { coding: MentionTbCoding }) {
  const t = useTranslations("SignalV2");
  const polarity = coding.polarity ?? "mixed";
  return (
    <span className={`signal-v2-tb-badge signal-v2-tb-badge--${polarity}`}>
      {t(`mentions.tb.polarity.${polarity}`)}
    </span>
  );
}

function MentionsCardSkeleton() {
  return (
    <div className="signal-v2-mention-cards-skeleton" role="status">
      {Array.from({ length: 10 }, (_, index) => (
        <article key={index}>
          <header><span /><i /></header>
          <strong />
          <div><i /><i /><i /></div>
          <small />
          <footer><i /><span /></footer>
        </article>
      ))}
    </div>
  );
}

function selectionFromData(data: SignalMentionsViewData, searchQuery: string): SignalAnalyticsFilterSelection {
  return {
    start: data.filter.date_range.start,
    end: data.filter.date_range.end,
    comparisonMode: data.comparison.mode,
    ...(data.comparison.mode === "custom" && data.comparison.date_range
      ? {
          comparisonStart: data.comparison.date_range.start,
          comparisonEnd: data.comparison.date_range.end
        }
      : {}),
    dimensions: data.filter.dimensions,
    searchQuery
  };
}

function mentionQueryParams(data: SignalMentionsViewData) {
  const params = new URLSearchParams({
    start: data.filter.date_range.start,
    end: data.filter.date_range.end,
    timezone: data.filter.timezone,
    granularity: data.filter.granularity,
    compare: data.comparison.mode
  });
  if (data.filter.search_query) params.set("q", data.filter.search_query);
  if (data.comparison.mode === "custom" && data.comparison.date_range) {
    params.set("compareStart", data.comparison.date_range.start);
    params.set("compareEnd", data.comparison.date_range.end);
  }
  for (const [dimension, values] of Object.entries(data.filter.dimensions)) {
    for (const value of values ?? []) params.append(`dimension.${dimension}`, value);
  }
  return params;
}

function mentionSortParams(sort: MentionSortKey): {
  field: "published" | "platform" | "conversation_role" | "engagement";
  direction: "asc" | "desc";
} {
  if (sort === "publishedAsc") return { field: "published", direction: "asc" };
  if (sort === "platformAsc") return { field: "platform", direction: "asc" };
  if (sort === "platformDesc") return { field: "platform", direction: "desc" };
  if (sort === "roleAsc") return { field: "conversation_role", direction: "asc" };
  if (sort === "roleDesc") return { field: "conversation_role", direction: "desc" };
  if (sort === "engagementAsc") return { field: "engagement", direction: "asc" };
  if (sort === "engagementDesc") return { field: "engagement", direction: "desc" };
  return { field: "published", direction: "desc" };
}

function groupTags(tags: SignalMentionRecordV1["tags"]) {
  const groups = new Map<string, SignalMentionRecordV1["tags"]>();
  for (const tag of tags) {
    const values = groups.get(tag.taxonomy_name) ?? [];
    values.push(tag);
    groups.set(tag.taxonomy_name, values);
  }
  return [...groups.entries()];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date(value));
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatFeatureValue(value: unknown, fallback: string) {
  if (value == null || value === true) return fallback;
  if (typeof value === "number") {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return fallback;
}

function isPublicMentionFeature(feature: SignalMentionRecordV1["features"][number]) {
  const key = feature.key.toLowerCase();
  return key !== "mention_operational_context"
    && key !== "tb_coding"
    && !key.startsWith("signal_taxonomy_classification");
}
