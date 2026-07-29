"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsDownUp,
  CaretDown,
  Check,
  CheckSquare,
  ChatTeardropText,
  Columns,
  Copy,
  DownloadSimple,
  DotsSixVertical,
  Eye,
  EyeSlash,
  Funnel,
  GridFour,
  ListBullets,
  LockSimple,
  MagnifyingGlass,
  X
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
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "./SignalAnalyticsFilter";
import { SignalMetricHelp } from "./SignalMetricHelp";
import { SignalSourceIcon } from "./SignalSourceIcon";

export type SignalMentionsViewData = SignalMentionsPayloadV1 & {
  filter: SignalFilterV1;
  comparison: SignalComparisonV1;
};

type MentionColumn =
  | "mention"
  | "platform"
  | "scope"
  | "role"
  | "published"
  | "sentiment"
  | "engagement"
  | "context";

type MentionColumnState = {
  key: MentionColumn;
  visible: boolean;
  locked?: boolean;
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
  loading,
  onApplyFilter,
  onDataChange,
  onOpenControls,
  outputId
}: {
  brandName: string;
  coverage: { date_from: string | null; date_through: string | null };
  data: SignalMentionsViewData;
  loading: boolean;
  onApplyFilter: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onDataChange: (data: SignalMentionsViewData) => void;
  onOpenControls: () => void;
  outputId: string | null;
}) {
  const t = useTranslations("SignalV2");
  const [search, setSearch] = useState(data.filter.search_query ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeRecord, setActiveRecord] = useState<SignalMentionRecordV1 | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columns, setColumns] = useState<MentionColumnState[]>(DEFAULT_COLUMNS);
  const [layout, setLayout] = useState<MentionsLayout>("table");
  const [draggedColumn, setDraggedColumn] = useState<MentionColumn | null>(null);
  const [sortKey, setSortKey] = useState<MentionSortKey>("publishedDesc");
  const [sortOpen, setSortOpen] = useState(false);
  const [pageSizeOpen, setPageSizeOpen] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const pageRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSearch(data.filter.search_query ?? "");
    setSelectedIds([]);
    setActiveRecord(null);
    setSortKey("publishedDesc");
    setPageError(null);
  }, [data.filters_hash, data.filter.search_query]);

  useEffect(() => {
    if (!columnsOpen) return;
    const close = (event: PointerEvent) => {
      if (!columnsRef.current?.contains(event.target as Node)) setColumnsOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [columnsOpen]);

  useEffect(() => {
    if (!sortOpen && !pageSizeOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (sortRef.current?.contains(target) || pageSizeRef.current?.contains(target)) return;
      setSortOpen(false);
      setPageSizeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSortOpen(false);
      setPageSizeOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [pageSizeOpen, sortOpen]);

  useEffect(() => () => {
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
    pageRequestRef.current?.abort();
  }, []);

  const selectedRecords = useMemo(
    () => data.records.filter((record) => selectedIds.includes(record.subject_id)),
    [data.records, selectedIds]
  );
  const allSelected = data.records.length > 0 && selectedIds.length === data.records.length;
  const visibleColumns = columns.filter((column) => column.visible).map((column) => column.key);
  const activeFilterCount = Object.values(data.filter.dimensions)
    .reduce((total, values) => total + (values?.length ?? 0), 0)
    + Number(Boolean(data.filter.search_query));
  const pageStart = data.total_count === 0 ? 0 : data.page.offset + 1;
  const pageEnd = data.total_count === 0
    ? 0
    : Math.min(pageStart + data.records.length - 1, data.total_count);

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
    if (!outputId) return;
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
      const response = await fetch(`/api/signal-v2/${outputId}/mentions?${params}`, {
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

  const updateColumns = (next: MentionColumnState[]) => {
    const documentWithTransitions = document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    };
    if (documentWithTransitions.startViewTransition) {
      documentWithTransitions.startViewTransition(() => setColumns(next));
      return;
    }
    setColumns(next);
  };

  const toggleColumn = (key: MentionColumn) => {
    const column = columns.find((item) => item.key === key);
    if (!column || column.locked) return;
    updateColumns(columns.map((item) => (
      item.key === key ? { ...item, visible: !item.visible } : item
    )));
  };

  const moveColumn = (from: MentionColumn, to: MentionColumn) => {
    if (from === to) return;
    const next = [...columns];
    const fromIndex = next.findIndex((item) => item.key === from);
    const toIndex = next.findIndex((item) => item.key === to);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    updateColumns(next);
  };

  return (
    <section className="signal-v2-mentions-page">
      <div className="signal-v2-page-head">
        <div>
          <div className="signal-v2-title-line">
            <ChatTeardropText size={20} weight="fill" />
            <h1>{t("mentions.title")}</h1>
            <span>{t("mentions.status")}</span>
          </div>
          <p>{t("mentions.subtitle", { brand: brandName })}</p>
        </div>
      </div>

      <div className="signal-v2-filterbar">
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
      </div>

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
            <div className="signal-v2-mentions-selection">
              <strong>{t("mentions.selection", { count: selectedIds.length })}</strong>
              <button onClick={() => void copySelectedLinks()} type="button">
                <Copy size={14} />{t("mentions.actions.copyLinks")}
              </button>
              <button onClick={exportSelection} type="button">
                <DownloadSimple size={14} />{t("mentions.actions.export")}
              </button>
              <button aria-label={t("mentions.actions.clearSelection")} onClick={() => setSelectedIds([])} type="button">
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <form
                className="signal-v2-mentions-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (searchTimeoutRef.current != null) {
                    window.clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = null;
                  }
                  void applySearch();
                }}
              >
                <MagnifyingGlass size={15} />
                <input
                  aria-label={t("mentions.search.label")}
                  onChange={(event) => {
                    const nextSearch = event.target.value;
                    setSearch(nextSearch);
                    if (searchTimeoutRef.current != null) {
                      window.clearTimeout(searchTimeoutRef.current);
                    }
                    searchTimeoutRef.current = window.setTimeout(() => {
                      searchTimeoutRef.current = null;
                      void onApplyFilter(selectionFromData(data, nextSearch));
                    }, 500);
                  }}
                  placeholder={t("mentions.search.placeholder")}
                  value={search}
                />
                {search ? (
                  <button
                    aria-label={t("mentions.search.clear")}
                    onClick={() => {
                      if (searchTimeoutRef.current != null) {
                        window.clearTimeout(searchTimeoutRef.current);
                        searchTimeoutRef.current = null;
                      }
                      setSearch("");
                      void onApplyFilter(selectionFromData(data, ""));
                    }}
                    type="button"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </form>
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
              <div className="signal-v2-mentions-sort" ref={sortRef}>
                <button
                  aria-expanded={sortOpen}
                  aria-haspopup="menu"
                  disabled={pageLoading}
                  onClick={() => {
                    setSortOpen((open) => !open);
                    setPageSizeOpen(false);
                  }}
                  type="button"
                >
                  <ArrowsDownUp size={15} />
                  <span>{t("mentions.sort.label")}</span>
                  <strong>{t(`mentions.sort.${sortKey}`)}</strong>
                  <CaretDown size={12} />
                </button>
                {sortOpen ? (
                  <div className="signal-v2-mentions-sort__menu" role="menu">
                    {MENTION_SORT_KEYS.map((key, index) => (
                      <button
                        aria-checked={sortKey === key}
                        className={index > 1 && index % 2 === 0 ? "is-group-start" : undefined}
                        key={key}
                        onClick={() => {
                          setSortKey(key);
                          setSortOpen(false);
                          void loadPage({ offset: 0, sort: key });
                        }}
                        role="menuitemradio"
                        type="button"
                      >
                        <span>{sortKey === key ? <Check size={14} weight="bold" /> : null}</span>
                        {t(`mentions.sort.${key}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="signal-v2-mentions-columns" ref={columnsRef}>
                <button
                  aria-expanded={columnsOpen}
                  aria-haspopup="menu"
                  onClick={() => setColumnsOpen((open) => !open)}
                  type="button"
                >
                  <Columns size={15} />{t("mentions.actions.columns")}<CaretDown size={12} />
                </button>
                {columnsOpen ? (
                  <div className="signal-v2-mentions-columns__menu" role="menu">
                    <div className="signal-v2-mentions-columns__sort">
                      <ArrowsDownUp size={15} />
                      <span>{t("mentions.columns.order")}</span>
                      <strong>{t("mentions.columns.manual")}</strong>
                    </div>
                    <div className="signal-v2-mentions-columns__heading">
                      <strong>{t("mentions.columns.title")}</strong>
                      <small>{t("mentions.columns.drag")}</small>
                    </div>
                    <div className="signal-v2-mentions-columns__list">
                      {columns.map((column) => (
                        <div
                          className={draggedColumn === column.key ? "is-dragging" : undefined}
                          draggable={!column.locked}
                          key={column.key}
                          onDragEnd={() => setDraggedColumn(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDragStart={() => setDraggedColumn(column.key)}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (draggedColumn) moveColumn(draggedColumn, column.key);
                            setDraggedColumn(null);
                          }}
                          role="menuitem"
                        >
                          <span
                            aria-hidden="true"
                            className="signal-v2-mentions-columns__handle"
                          >
                            {column.locked
                              ? <LockSimple size={13} />
                              : <DotsSixVertical size={15} weight="bold" />}
                          </span>
                          <span>{t(`mentions.table.${column.key}`)}</span>
                          <button
                            aria-label={column.locked
                              ? t("mentions.columns.required")
                              : column.visible
                                ? t("mentions.columns.hide", { column: t(`mentions.table.${column.key}`) })
                                : t("mentions.columns.show", { column: t(`mentions.table.${column.key}`) })}
                            disabled={column.locked}
                            onClick={() => toggleColumn(column.key)}
                            title={column.locked ? t("mentions.columns.required") : undefined}
                            type="button"
                          >
                            {column.locked
                              ? <LockSimple size={14} />
                              : column.visible
                                ? <Eye size={15} />
                                : <EyeSlash size={15} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <button className="signal-v2-mentions-export" onClick={exportSelection} type="button">
                <DownloadSimple size={15} />{t("mentions.actions.export")}
              </button>
            </>
          )}
        </div>

        {pageError ? <p className="signal-v2-mentions-error">{pageError}</p> : null}

        <div className={`signal-v2-mentions-table-wrap signal-v2-mentions-table-wrap--${layout}`}>
          {layout === "table" ? (
          <table
            className={`signal-v2-mentions-table${visibleColumns.length <= 2 ? " is-compact" : ""}`}
            key={visibleColumns.join(":")}
          >
            <thead>
              <tr>
                <th className="signal-v2-mentions-table__check">
                  <button
                    aria-label={allSelected ? t("mentions.selectionClearAll") : t("mentions.selectionAll")}
                    onClick={() => setSelectedIds(allSelected ? [] : data.records.map((record) => record.subject_id))}
                    type="button"
                  >
                    {allSelected ? <CheckSquare size={16} weight="fill" /> : <span />}
                  </button>
                </th>
                {visibleColumns.map((column) => (
                  <th
                    className={`signal-v2-mentions-table__${column}`}
                    key={column}
                  >
                    {column === "scope" ? (
                      <SignalMetricHelp
                        content={{
                          body: t("mentions.helpers.scope.body"),
                          formula: t("mentions.helpers.scope.process"),
                          title: t("mentions.helpers.scope.title")
                        }}
                        label={t(`mentions.table.${column}`)}
                      />
                    ) : column === "context" ? (
                      <SignalMetricHelp
                        content={{
                          body: t("mentions.helpers.tb.body"),
                          formula: t("mentions.helpers.tb.process"),
                          title: t("mentions.helpers.tb.title")
                        }}
                        label={t(`mentions.table.${column}`)}
                      />
                    ) : <span>{t(`mentions.table.${column}`)}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.records.map((record) => {
                const selected = selectedIds.includes(record.subject_id);
                return (
                  <tr
                    aria-selected={selected}
                    key={record.subject_id}
                    onClick={() => setActiveRecord(record)}
                  >
                    <td className="signal-v2-mentions-table__check">
                      <button
                        aria-label={selected
                          ? t("mentions.selectionRemove")
                          : t("mentions.selectionAdd")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedIds((current) => selected
                            ? current.filter((id) => id !== record.subject_id)
                            : [...current, record.subject_id]);
                        }}
                        type="button"
                      >
                        {selected ? <Check size={12} weight="bold" /> : <span />}
                      </button>
                    </td>
                    {visibleColumns.map((column) => (
                      <MentionTableCell column={column} key={column} record={record} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          ) : (
            <MentionCards
              activeRecord={activeRecord}
              columns={visibleColumns}
              onActivate={setActiveRecord}
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
          {loading || pageLoading
            ? layout === "table"
              ? <MentionsTableSkeleton columns={visibleColumns.length + 1} />
              : <MentionsCardSkeleton />
            : null}
        </div>

        <footer className="signal-v2-mentions-pagination">
          <span>{t("mentions.pagination.range", {
            start: pageStart,
            end: pageEnd,
            total: data.total_count
          })}</span>
          <div className="signal-v2-mentions-page-size" ref={pageSizeRef}>
            <span>{t("mentions.pagination.perPage")}</span>
            <button
              aria-expanded={pageSizeOpen}
              aria-haspopup="menu"
              disabled={pageLoading}
              onClick={() => {
                setPageSizeOpen((open) => !open);
                setSortOpen(false);
              }}
              type="button"
            >
              <strong>{data.page.limit}</strong>
              <CaretDown size={12} />
            </button>
            {pageSizeOpen ? (
              <div className="signal-v2-mentions-page-size__menu" role="menu">
                {[25, 50, 100].map((size) => (
                  <button
                    aria-checked={data.page.limit === size}
                    key={size}
                    onClick={() => {
                      setPageSizeOpen(false);
                      void loadPage({ limit: size, offset: 0 });
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{data.page.limit === size ? <Check size={14} weight="bold" /> : null}</span>
                    {size}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <button disabled={data.page.offset === 0 || pageLoading} onClick={goBack} type="button">
              <ArrowLeft size={14} />{t("mentions.pagination.previous")}
            </button>
            <button
              disabled={data.page.next_offset == null || pageLoading}
              onClick={() => data.page.next_offset != null && void loadPage({
                offset: data.page.next_offset
              })}
              type="button"
            >
              {t("mentions.pagination.next")}<ArrowRight size={14} />
            </button>
          </div>
        </footer>
      </article>

      {activeRecord ? (
        <MentionDetailDrawer
          onClose={() => setActiveRecord(null)}
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
              {columns.includes("sentiment") ? <Sentiment value={record.sentiment} /> : null}
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

function MentionTableCell({
  column,
  record
}: {
  column: MentionColumn;
  record: SignalMentionRecordV1;
}) {
  const t = useTranslations("SignalV2");
  switch (column) {
    case "mention":
      return (
        <td className="signal-v2-mentions-table__mention">
          <div>
            <SignalSourceIcon platform={record.platform} size={14} />
            <span>
              <strong>{record.title || truncate(record.text_snippet, 92)}</strong>
              {record.title ? <small>{truncate(record.text_snippet, 116)}</small> : null}
            </span>
          </div>
        </td>
      );
    case "platform":
      return (
        <td className="signal-v2-mentions-table__platform">
          <span className="signal-v2-source-label">
            <SignalSourceIcon platform={record.platform} size={13} />
            {pretty(record.platform)}
          </span>
        </td>
      );
    case "scope":
      return <td className="signal-v2-mentions-table__scope"><AttributionBadge record={record} /></td>;
    case "role":
      return (
        <td className="signal-v2-mentions-table__role">
          <span className="signal-v2-neutral-chip">
            {t(`mentions.roles.${record.conversation_role}`)}
          </span>
        </td>
      );
    case "published":
      return <td className="signal-v2-mentions-table__published">{formatDate(record.occurred_at)}</td>;
    case "sentiment":
      return <td className="signal-v2-mentions-table__sentiment"><Sentiment value={record.sentiment} /></td>;
    case "engagement":
      return <td className="signal-v2-mentions-table__engagement">{formatCount(record.interaction_count)}</td>;
    case "context":
      return <td className="signal-v2-mentions-table__context"><MentionContext record={record} /></td>;
  }
}

function AttributionBadge({ record }: { record: SignalMentionRecordV1 }) {
  const t = useTranslations("SignalV2");
  const primary = primaryAttribution(record);
  return (
    <span className={`signal-v2-mention-scope signal-v2-mention-scope--${primary.scope}`}>
      <i />
      {t(`mentions.scope.${primary.scope}`)}
    </span>
  );
}

function MentionContext({ record }: { record: SignalMentionRecordV1 }) {
  const t = useTranslations("SignalV2");
  const coding = primaryTbCoding(record);
  const reservedTbTags = new Set(["trigger", "barrier", "mixed", "irrelevant"]);
  const classification = [
    ...(coding?.polarity ? [t(`mentions.tb.polarity.${coding.polarity}`)] : []),
    ...(coding?.layer ? [t(`mentions.tb.layer.${coding.layer}`)] : [])
  ].join(" · ");
  const observedSignal = coding?.emergent_tags.find((tag) => (
    !reservedTbTags.has(tag.toLocaleLowerCase())
  )) ?? null;
  const contextTitle = [
    classification ? `${t("mentions.tb.compactClassification")}: ${classification}.` : null,
    observedSignal ? `${t("mentions.tb.compactSignal")}: ${observedSignal}.` : null
  ].filter(Boolean).join(" ");

  return (
    <div className="signal-v2-mention-context" title={contextTitle || undefined}>
      {classification ? (
        <span
          className={`signal-v2-mention-context__classification signal-v2-mention-context__classification--${coding?.polarity ?? "mixed"}${observedSignal ? "" : " signal-v2-mention-context__classification--only"}`}
        >
          <small>{t("mentions.tb.compactClassification")}</small>
          <strong>{classification}</strong>
        </span>
      ) : null}
      {observedSignal ? (
        <span className="signal-v2-mention-context__signal">
          <small>{t("mentions.tb.compactSignal")}</small>
          <strong>{observedSignal}</strong>
        </span>
      ) : null}
      {!classification && !observedSignal ? <small>—</small> : null}
    </div>
  );
}

function MentionDetailDrawer({
  onClose,
  record
}: {
  onClose: () => void;
  record: SignalMentionRecordV1;
}) {
  const t = useTranslations("SignalV2");
  const engagement = Object.entries(record.engagement)
    .flatMap(([key, value]) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? [{ key, value: numeric }] : [];
    })
    .sort((left, right) => right.value - left.value);
  const groupedTags = groupTags(record.tags);

  return (
    <>
      <button aria-label={t("mentions.detail.close")} className="signal-v2-mention-drawer-scrim" onClick={onClose} type="button" />
      <aside aria-label={t("mentions.detail.title")} className="signal-v2-mention-drawer">
        <header>
          <div>
            <span className="signal-v2-source-label">
              <SignalSourceIcon platform={record.platform} size={15} />
              {pretty(record.platform)}
            </span>
            <strong>{t("mentions.detail.title")}</strong>
          </div>
          <button aria-label={t("mentions.detail.close")} onClick={onClose} type="button"><X size={16} /></button>
        </header>
        <div className="signal-v2-mention-drawer__content">
          <section className="signal-v2-mention-drawer__verbatim">
            <div>
              <span className="signal-v2-neutral-chip">{t(`mentions.roles.${record.conversation_role}`)}</span>
              <Sentiment value={record.sentiment} />
            </div>
            {record.title ? <h2>{record.title}</h2> : null}
            <p>{record.text_snippet || t("mentions.detail.noText")}</p>
            <small>{formatDateTime(record.occurred_at)}</small>
            {record.url ? (
              <a href={record.url} rel="noreferrer" target="_blank">
                {t("mentions.detail.openOriginal")}<ArrowSquareOut size={14} />
              </a>
            ) : null}
          </section>

          <DetailSection title={t("mentions.detail.performance")}>
            <dl className="signal-v2-mention-drawer__metrics">
              <div><dt>{t("mentions.table.engagement")}</dt><dd>{formatCount(record.interaction_count)}</dd></div>
              {engagement.map((item) => (
                <div key={item.key}><dt>{pretty(item.key)}</dt><dd>{formatCount(item.value)}</dd></div>
              ))}
            </dl>
          </DetailSection>

          <DetailSection
            help={{
              body: t("mentions.helpers.scope.body"),
              process: t("mentions.helpers.scope.process"),
              title: t("mentions.helpers.scope.title")
            }}
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

          {record.tb_classification ? (
            <DetailSection
              help={{
                body: t("mentions.helpers.tb.body"),
                process: t("mentions.helpers.tb.process"),
                title: t("mentions.helpers.tb.title")
              }}
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
                        <ul>
                          {coding.emergent_tags.map((tag) => <li key={tag}>{tag}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection
            help={{
              body: t("mentions.helpers.enrichment.body"),
              process: t("mentions.helpers.enrichment.process"),
              title: t("mentions.helpers.enrichment.title")
            }}
            title={t("mentions.detail.enrichment")}
          >
            {groupedTags.length > 0 ? groupedTags.map(([taxonomy, tags]) => (
              <div className="signal-v2-mention-drawer__tag-group" key={taxonomy}>
                <strong>{pretty(taxonomy)}</strong>
                <div>{tags.map((tag) => <span key={tag.term_key}>{tag.label}</span>)}</div>
              </div>
            )) : <p className="signal-v2-mention-drawer__empty">{t("mentions.detail.noEnrichment")}</p>}
          </DetailSection>

          {record.features.some((feature) => feature.key !== "tb_coding") ? (
            <DetailSection
              help={{
                body: t("mentions.helpers.attributes.body"),
                process: t("mentions.helpers.attributes.process"),
                title: t("mentions.helpers.attributes.title")
              }}
              title={t("mentions.detail.attributes")}
            >
              <div className="signal-v2-mention-drawer__features">
                {record.features.filter((feature) => feature.key !== "tb_coding").map((feature, index) => (
                  <span key={`${feature.key}:${index}`}>
                    <strong>{pretty(feature.key)}</strong>
                    <small>{formatFeatureValue(feature.value, t("mentions.detail.present"))}</small>
                  </span>
                ))}
              </div>
            </DetailSection>
          ) : null}

          {record.entities.length > 0 ? (
            <DetailSection title={t("mentions.detail.entities")}>
              <div className="signal-v2-mention-drawer__entities">
                {record.entities.map((entity) => (
                  <span key={`${entity.type}:${entity.name}`}>
                    <strong>{entity.name}</strong>
                    <small>{pretty(entity.type)}</small>
                  </span>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title={t("mentions.detail.metadata")}>
            <dl className="signal-v2-mention-drawer__metadata">
              <div><dt>{t("mentions.table.platform")}</dt><dd>{pretty(record.platform)}</dd></div>
              <div><dt>{t("mentions.table.role")}</dt><dd>{t(`mentions.roles.${record.conversation_role}`)}</dd></div>
              <div><dt>{t("mentions.detail.language")}</dt><dd>{record.language?.toUpperCase() || "—"}</dd></div>
              <div><dt>{t("mentions.detail.country")}</dt><dd>{record.country || "—"}</dd></div>
            </dl>
          </DetailSection>
        </div>
      </aside>
    </>
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

function Sentiment({ value }: { value: SignalMentionRecordV1["sentiment"] }) {
  const t = useTranslations("SignalV2");
  const key = value ?? "unclassified";
  return (
    <span className={`signal-v2-mention-sentiment signal-v2-mention-sentiment--${key}`}>
      <i />
      {t(`mentions.sentiment.${key}`)}
    </span>
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

function MentionsTableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="signal-v2-mentions-table-skeleton" role="status">
      {Array.from({ length: 8 }, (_, row) => (
        <div key={row} style={{ gridTemplateColumns: `34px minmax(280px, 2fr) repeat(${Math.max(1, columns - 2)}, minmax(86px, 1fr))` }}>
          <span />
          <div>
            <strong />
            <small />
          </div>
          {Array.from({ length: Math.max(1, columns - 2) }, (__, cell) => <i key={cell} />)}
        </div>
      ))}
    </div>
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

function primaryAttribution(record: SignalMentionRecordV1) {
  return record.attribution.find((item) => item.scope === "brand")
    ?? record.attribution.find((item) => item.scope === "competitor")
    ?? record.attribution.find((item) => item.scope === "category")
    ?? record.attribution[0]
    ?? { scope: "unknown" as const, label: "Unattributed" };
}

function primaryTbCoding(record: SignalMentionRecordV1) {
  return record.tb_classification?.codings.find((coding) => coding.polarity !== "irrelevant")
    ?? record.tb_classification?.codings[0]
    ?? null;
}

function pretty(value: string | null) {
  if (!value) return "Web";
  return value.replaceAll("_", " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
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
