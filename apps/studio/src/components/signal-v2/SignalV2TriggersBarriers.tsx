"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CaretDown,
  Check,
  Funnel,
  Info,
  Quotes,
  Target
} from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { EChartsCoreOption } from "echarts/core";

import type { PublicTbFinding } from "@/lib/signal/contracts";
import type {
  SignalTriggersBarriersEvidencePageV2,
  SignalTriggersBarriersEvidenceRecordV2,
  SignalTriggersBarriersFindingDetailV2,
  SignalTriggersBarriersOverviewV2
} from "@/lib/data-os/signal-triggers-barriers-serving";
import { fetchSignalJsonWithRetry } from "@/lib/data-os/signal-client-fetch";
import { SignalDataScopeFilter } from "@/components/signal-v2/SignalDataScopeFilter";
import { SignalEChart } from "@/components/signal-v2/SignalEChart";
import {
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "@/components/signal-v2/SignalAnalyticsFilter";
import {
  SignalEvidenceDrawer,
  type SignalEvidenceDrawerRecord
} from "@/components/signal-v2/SignalEvidenceDrawer";
import { SignalV2ModuleHeader } from "@/components/signal-v2/SignalV2ModuleHeader";
import { SignalSourceIcon } from "@/components/signal-v2/SignalSourceIcon";
import {
  SignalMetricHelp,
  type SignalMetricHelpContent
} from "@/components/signal-v2/SignalMetricHelp";

type Mobility = NonNullable<PublicTbFinding["mobility"]>;
type Layer = PublicTbFinding["layer"];
type PolarityFilter = "all" | PublicTbFinding["polarity"];

const MOBILITIES: Mobility[] = ["movible_por_marca", "parcialmente_movible", "estructural"];
const LAYERS: Layer[] = ["personal", "psicologico", "social", "cultural"];
const POLARITY_FILTERS: PolarityFilter[] = ["all", "trigger", "barrier", "mixed"];
const MAX_MATRIX_FINDINGS = 6;
const POLARITY_COLORS = {
  trigger: "#008060",
  barrier: "#c4320a",
  mixed: "#7157d9"
} as const;

export function SignalV2TriggersBarriers({
  brandName,
  data,
  onOpenMentions,
  workspaceSlug
}: {
  brandName: string;
  data: SignalTriggersBarriersOverviewV2;
  onOpenMentions: () => void;
  workspaceSlug: string;
}) {
  const t = useTranslations("SignalV2.triggersBarriers");
  const router = useRouter();
  const [mentionNavigationPending, startMentionNavigation] = useTransition();
  const [filterNavigationPending, startFilterNavigation] = useTransition();
  const initialId = data.initial_finding?.finding_id
    ?? data.findings.find((finding) => finding.frequency_mentions > 0)?.finding_id
    ?? "";
  const [selectedId, setSelectedId] = useState(initialId);
  const [detail, setDetail] = useState(data.initial_finding);
  const [preview, setPreview] = useState(data.initial_evidence);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecords, setDrawerRecords] = useState<SignalTriggersBarriersEvidenceRecordV2[]>([]);
  const [drawerCursor, setDrawerCursor] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [openingMentionId, setOpeningMentionId] = useState<string | null>(null);
  const [polarityFilter, setPolarityFilter] = useState<PolarityFilter>("all");
  const [polarityFilterOpen, setPolarityFilterOpen] = useState(false);
  const detailCache = useRef(new Map<string, SignalTriggersBarriersFindingDetailV2>());
  const evidenceCache = useRef(new Map<string, SignalTriggersBarriersEvidencePageV2>());
  const selectionRequest = useRef<AbortController | null>(null);
  const drawerRequest = useRef<AbortController | null>(null);
  const polarityFilterRef = useRef<HTMLDivElement>(null);
  const selectionScope = `${data.cut.analysis_id}:${data.filter.date_range.start}:${data.filter.date_range.end}`;
  const previousSelectionScope = useRef(selectionScope);

  useEffect(() => {
    if (data.initial_finding) detailCache.current.set(`${selectionScope}:${data.initial_finding.finding_id}`, data.initial_finding);
    if (data.initial_evidence) evidenceCache.current.set(`${selectionScope}:${data.initial_evidence.finding_id}`, data.initial_evidence);
  }, [data.initial_evidence, data.initial_finding, selectionScope]);

  useEffect(() => {
    if (previousSelectionScope.current === selectionScope) return;
    previousSelectionScope.current = selectionScope;
    selectionRequest.current?.abort();
    drawerRequest.current?.abort();
    detailCache.current.clear();
    evidenceCache.current.clear();
    if (data.initial_finding) detailCache.current.set(`${selectionScope}:${data.initial_finding.finding_id}`, data.initial_finding);
    if (data.initial_evidence) evidenceCache.current.set(`${selectionScope}:${data.initial_evidence.finding_id}`, data.initial_evidence);
    const nextId = data.initial_finding?.finding_id
      ?? data.findings.find((finding) => finding.frequency_mentions > 0)?.finding_id
      ?? "";
    setSelectedId(nextId);
    setDetail(data.initial_finding);
    setPreview(data.initial_evidence);
    setSelectionLoading(false);
    setSelectionError(null);
    setDrawerOpen(false);
  }, [data.findings, data.initial_evidence, data.initial_finding, selectionScope]);

  useEffect(() => () => {
    selectionRequest.current?.abort();
    drawerRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (!polarityFilterOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !polarityFilterRef.current?.contains(target)) {
        setPolarityFilterOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPolarityFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [polarityFilterOpen]);

  const selectedFinding = data.findings.find((finding) => finding.finding_id === selectedId) ?? null;
  const readingFinding = data.findings.find((finding) => finding.finding_id === detail?.finding_id)
    ?? selectedFinding;
  const activeFindings = useMemo(
    () => data.findings.filter((finding) => finding.frequency_mentions > 0),
    [data.findings]
  );
  const filteredFindings = useMemo(
    () => polarityFilter === "all"
      ? activeFindings
      : activeFindings.filter((finding) => finding.polarity === polarityFilter),
    [activeFindings, polarityFilter]
  );
  const matrix = useMemo(
    () => buildMatrix(filteredFindings),
    [filteredFindings]
  );
  const ranked = useMemo(
    () => [...filteredFindings].sort((left, right) => (
      right.composite_score - left.composite_score
      || right.frequency_mentions - left.frequency_mentions
      || left.finding_id.localeCompare(right.finding_id)
    )),
    [filteredFindings]
  );
  const layerCounts = useMemo(() => new Map(LAYERS.map((layer) => [
    layer,
    filteredFindings.filter((finding) => finding.layer === layer).length
  ])), [filteredFindings]);
  const findingCounts = useMemo(() => ({
    active: activeFindings.length,
    barriers: activeFindings.filter((finding) => finding.polarity === "barrier").length,
    direct: activeFindings.filter((finding) => finding.mobility === "movible_por_marca").length,
    triggers: activeFindings.filter((finding) => finding.polarity === "trigger").length
  }), [activeFindings]);
  const selectedSeries = useMemo(
    () => data.finding_time_series
      .filter((record) => record.finding_id === (detail?.finding_id ?? selectedId))
      .sort((left, right) => left.month.localeCompare(right.month)),
    [data.finding_time_series, detail?.finding_id, selectedId]
  );
  const maxFrequency = Math.max(1, ...activeFindings.map((finding) => finding.frequency_mentions));

  const selectFinding = async (findingId: string) => {
    if (!findingId || findingId === selectedId) return;
    setSelectedId(findingId);
    setSelectionError(null);
    setDrawerOpen(false);
    selectionRequest.current?.abort();
    selectionRequest.current = null;
    setSelectionLoading(false);
    const cacheKey = `${selectionScope}:${findingId}`;
    const cachedDetail = detailCache.current.get(cacheKey);
    const cachedEvidence = evidenceCache.current.get(cacheKey);
    if (cachedDetail && cachedEvidence) {
      setDetail(cachedDetail);
      setPreview(cachedEvidence);
      return;
    }
    const controller = new AbortController();
    selectionRequest.current = controller;
    setSelectionLoading(true);
    try {
      const base = `/api/data-os/signal/${data.workspace_id}/triggers-barriers/findings/${encodeURIComponent(findingId)}`;
      const query = periodQuery(data);
      const [nextDetail, nextEvidence] = await Promise.all([
        cachedDetail ?? fetchSignalJsonWithRetry<SignalTriggersBarriersFindingDetailV2>(
          `${base}?${query}`,
          { fallbackMessage: t("errors.finding"), signal: controller.signal }
        ),
        cachedEvidence ?? fetchSignalJsonWithRetry<SignalTriggersBarriersEvidencePageV2>(
          `${base}/evidence?${query}&limit=5`,
          { fallbackMessage: t("errors.evidence"), signal: controller.signal }
        )
      ]);
      detailCache.current.set(cacheKey, nextDetail);
      evidenceCache.current.set(cacheKey, nextEvidence);
      setDetail(nextDetail);
      setPreview(nextEvidence);
    } catch (error) {
      if (controller.signal.aborted) return;
      setSelectionError(error instanceof Error ? error.message : t("errors.finding"));
      if (detail?.finding_id) setSelectedId(detail.finding_id);
    } finally {
      if (selectionRequest.current === controller) {
        selectionRequest.current = null;
        setSelectionLoading(false);
      }
    }
  };

  const applyDateFilter = async (selection: SignalAnalyticsFilterSelection) => {
    const query = new URLSearchParams(window.location.search);
    query.delete("study");
    query.set("start", selection.start);
    query.set("end", selection.end);
    query.set("timezone", data.filter.timezone);
    query.set("compare", "none");
    query.delete("granularity");
    query.delete("comparison_start");
    query.delete("comparison_end");
    startFilterNavigation(() => {
      router.replace(`${window.location.pathname}?${query}`, { scroll: false });
    });
    return true;
  };

  const selectPolarityFilter = (nextFilter: PolarityFilter) => {
    setPolarityFilter(nextFilter);
    setPolarityFilterOpen(false);
    if (nextFilter === "all" || selectedFinding?.polarity === nextFilter) return;
    const nextFinding = activeFindings
      .filter((finding) => finding.polarity === nextFilter)
      .sort((left, right) => (
        right.composite_score - left.composite_score
        || right.frequency_mentions - left.frequency_mentions
      ))[0];
    if (nextFinding) void selectFinding(nextFinding.finding_id);
  };

  const openEvidence = () => {
    setDrawerRecords(preview?.records ?? []);
    setDrawerCursor(preview?.page.next_cursor ?? null);
    setDrawerError(null);
    setDrawerOpen(true);
  };

  const openEnrichedMention = (mentionId: string) => {
    setOpeningMentionId(mentionId);
    startMentionNavigation(() => {
      router.push(tbMentionHref(workspaceSlug, mentionId, data), { scroll: false });
    });
  };

  const loadMoreEvidence = async () => {
    if (!drawerCursor || !readingFinding) return;
    drawerRequest.current?.abort();
    const controller = new AbortController();
    drawerRequest.current = controller;
    setDrawerLoading(true);
    setDrawerError(null);
    try {
      const base = `/api/data-os/signal/${data.workspace_id}/triggers-barriers/findings/${encodeURIComponent(readingFinding.finding_id)}/evidence`;
      const query = new URLSearchParams({
        start: data.filter.date_range.start,
        end: data.filter.date_range.end,
        limit: "20",
        cursor: drawerCursor
      });
      const next = await fetchSignalJsonWithRetry<SignalTriggersBarriersEvidencePageV2>(
        `${base}?${query}`,
        { fallbackMessage: t("errors.evidence"), signal: controller.signal }
      );
      setDrawerRecords((current) => uniqueMentions([...current, ...next.records]));
      setDrawerCursor(next.page.next_cursor);
    } catch (error) {
      if (controller.signal.aborted) return;
      setDrawerError(error instanceof Error ? error.message : t("errors.evidence"));
    } finally {
      if (drawerRequest.current === controller) {
        drawerRequest.current = null;
        setDrawerLoading(false);
      }
    }
  };

  const compactPresenceOption = useMemo<EChartsCoreOption | null>(() => {
    if (selectedSeries.length === 0 || !readingFinding) return null;
    return {
      animationDuration: 220,
      textStyle: { color: "#303030", fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      grid: { left: 5, right: 5, top: 8, bottom: 5 },
      tooltip: {
        confine: true,
        padding: [6, 8],
        trigger: "axis",
        textStyle: { fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
        formatter: (raw: unknown) => compactPresenceTooltip(raw, t)
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: selectedSeries.map((item) => item.month),
        show: false
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        show: false
      },
      series: [{
        type: "line",
        smooth: 0.26,
        showSymbol: selectedSeries.length <= 6,
        symbolSize: 5,
        data: selectedSeries.map((item) => item.mentions),
        lineStyle: { width: 2, color: POLARITY_COLORS[readingFinding.polarity] },
        itemStyle: { color: POLARITY_COLORS[readingFinding.polarity] },
        areaStyle: { color: `${POLARITY_COLORS[readingFinding.polarity]}14` }
      }]
    };
  }, [readingFinding, selectedSeries, t]);

  return (
    <section className="signal-v2-tb" aria-labelledby="signal-v2-tb-title">
      <SignalV2ModuleHeader
        controls={<>
          <SignalAnalyticsFilter
            boundedToCoverage
            comparison={data.comparison}
            coverage={data.coverage}
            filter={data.filter}
            loading={filterNavigationPending}
            onApply={applyDateFilter}
            showComparison={false}
          />
          <SignalDataScopeFilter
            brandName={brandName}
            copy={{
              body: t("dataScope.body"),
              coverage: t("dataScope.coverage"),
              eyebrow: t("dataScope.eyebrow"),
              mentions: t("dataScope.mentions"),
              open: t("dataScope.open")
            }}
            coverageFrom={data.coverage.date_from}
            coverageThrough={data.coverage.date_through}
            disabled={filterNavigationPending}
            mentionCount={data.metrics.coded_mentions_total}
            onOpenMentions={onOpenMentions}
          />
          <div className="signal-v2-filter-anchor" ref={polarityFilterRef}>
            <button
              aria-expanded={polarityFilterOpen}
              className={`signal-v2-filter${polarityFilterOpen ? " signal-v2-filter--active" : ""}`}
              disabled={filterNavigationPending}
              onClick={() => setPolarityFilterOpen((open) => !open)}
              type="button"
            >
              <Funnel size={15} />
              {t(`filters.polarity.${polarityFilter}`)}
              <CaretDown size={13} />
            </button>
            {polarityFilterOpen ? (
              <div aria-label={t("filters.polarityLabel")} className="signal-v2-tb-filter-popover" role="menu">
                {POLARITY_FILTERS.map((filter) => (
                  <button
                    aria-checked={polarityFilter === filter}
                    data-polarity={filter === "all" ? undefined : filter}
                    key={filter}
                    onClick={() => selectPolarityFilter(filter)}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{filter !== "all" ? <i /> : null}{t(`filters.polarity.${filter}`)}</span>
                    {polarityFilter === filter ? <Check size={14} weight="bold" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>}
        icon={<Target size={20} weight="fill" />}
        status={t("status")}
        subtitle={t("subtitle")}
        title={data.study.title}
        titleId="signal-v2-tb-title"
      />

      <div className="signal-v2-tb__kpis" aria-label={t("summary.label")}>
        <Metric help={translatedHelp(t, "helpers.activeFindings")} label={t("summary.findings")} value={findingCounts.active} />
        <Metric help={translatedHelp(t, "helpers.triggers")} label={t("summary.triggers")} value={findingCounts.triggers} />
        <Metric help={translatedHelp(t, "helpers.barriers")} label={t("summary.barriers")} value={findingCounts.barriers} />
        <Metric help={translatedHelp(t, "helpers.directAction")} label={t("summary.directAction")} value={findingCounts.direct} />
      </div>

      {activeFindings.length === 0 ? (
        <section className="signal-v2-tb-panel signal-v2-tb__empty-period">
          <EmptyFindings />
        </section>
      ) : <div className="signal-v2-tb__decision-layout">
        <div className="signal-v2-tb__decision-hero">
          <section className="signal-v2-tb-panel signal-v2-tb-matrix-panel">
            <PanelHead
              eyebrow={t("decision.eyebrow")}
              help={translatedHelp(t, "helpers.decisionField")}
              title={t("decision.title")}
            />
            <div className="signal-v2-tb-matrix" role="grid" aria-label={t("decision.matrixLabel")}>
              <div className="signal-v2-tb-matrix__corner" />
              {LAYERS.map((layer) => (
                <div className="signal-v2-tb-matrix__column" key={layer}>
                  <SignalMetricHelp content={translatedHelp(t, `helpers.layers.${layer}`)} label={t(`layers.${layer}`)} />
                  <small>{t("decision.layerCount", { count: layerCounts.get(layer) ?? 0 })}</small>
                </div>
              ))}
              {MOBILITIES.flatMap((mobility) => {
                const row = [
                  <div className="signal-v2-tb-matrix__row" key={`${mobility}:label`}>
                    <SignalMetricHelp
                      content={translatedHelp(t, `helpers.mobility.${mobility}`)}
                      label={t(`mobility.${mobility}.label`)}
                    />
                  </div>
                ];
                return row.concat(LAYERS.map((layer) => {
                  const cellFindings = matrix.get(`${mobility}:${layer}`) ?? [];
                  const visibleFindings = visibleMatrixFindings(cellFindings, selectedId);
                  const hiddenCount = Math.max(0, cellFindings.length - visibleFindings.length);
                  return (
                    <div className="signal-v2-tb-matrix__cell" key={`${mobility}:${layer}`} role="gridcell">
                      {visibleFindings.map((finding) => (
                        <FindingBubble
                          finding={finding}
                          key={finding.finding_id}
                          maxFrequency={maxFrequency}
                          onSelect={selectFinding}
                          selected={finding.finding_id === selectedId}
                          totalCodedMentions={data.metrics.coded_mentions_total}
                        />
                      ))}
                      {cellFindings.length === 0 ? <span className="signal-v2-tb-matrix__empty">{t("decision.emptyCell")}</span> : null}
                      {hiddenCount > 0 ? <span className="signal-v2-tb-matrix__more" title={t("decision.moreFindings", { count: hiddenCount })}>+{hiddenCount}</span> : null}
                    </div>
                  );
                }));
              })}
            </div>
            <div className="signal-v2-tb-legend">
              <span><i data-polarity="trigger" />{t("polarity.trigger")}</span>
              <span><i data-polarity="barrier" />{t("polarity.barrier")}</span>
              <span><i data-polarity="mixed" />{t("polarity.mixed")}</span>
              <SignalMetricHelp
                content={translatedHelp(t, "helpers.denominator", {
                  count: data.metrics.coded_mentions_total
                })}
                display={<Info aria-hidden size={15} />}
                label={t("decision.denominatorLabel")}
                variant="icon"
              />
            </div>
          </section>
          <FindingSnapshot
            chartOption={compactPresenceOption}
            detail={detail}
            error={selectionError}
            loading={selectionLoading || filterNavigationPending}
            selectedFinding={selectedFinding ?? readingFinding}
            selectedSeries={selectedSeries}
          />
        </div>

        <div className="signal-v2-tb__selection-layout">
          <aside className="signal-v2-tb-panel signal-v2-tb-ranking">
            <PanelHead eyebrow={t("ranking.eyebrow")} title={t("ranking.title")} />
            {ranked.length > 0 ? <ol>
              {ranked.map((finding, index) => (
                <li key={finding.finding_id}>
                  <button className="signal-v2-tb-ranking__row" aria-current={finding.finding_id === selectedId ? "true" : undefined} onClick={() => void selectFinding(finding.finding_id)} type="button">
                    <span className="signal-v2-tb-ranking__index">{String(index + 1).padStart(2, "0")}</span>
                    <div className="signal-v2-tb-ranking__content">
                      <strong>{finding.finding_name}</strong>
                      <span className="signal-v2-tb-ranking__meta">
                        <span className="signal-v2-tb-ranking__polarity" data-polarity={finding.polarity}>
                          {t(`polarity.${finding.polarity}`)}
                        </span>
                        <small>{t("ranking.priority", { score: finding.composite_score })}</small>
                        <small>{t("ranking.mentions", { count: finding.frequency_mentions })}</small>
                      </span>
                    </div>
                    <span aria-hidden="true" className="signal-v2-tb-ranking__arrow"><ArrowRight size={14} /></span>
                  </button>
                </li>
              ))}
            </ol> : <FilteredFindingsEmpty />}
          </aside>
          <FindingReading
            detail={detail}
            error={selectionError}
            hidePreview={drawerOpen}
            loading={selectionLoading || filterNavigationPending}
            onOpenEvidence={openEvidence}
            preview={preview}
            selectedFinding={selectedFinding ?? readingFinding}
          />
        </div>
      </div>}

      {drawerOpen && readingFinding && preview ? (
        <SignalEvidenceDrawer
          ariaLabel={t("drawer.label", { finding: readingFinding.finding_name })}
          closeLabel={t("drawer.close")}
          emptyLabel={t("drawer.empty")}
          errorMessage={drawerError}
          eyebrow={t("preview.eyebrow")}
          intro={t("drawer.body", { count: preview.page.total_count })}
          loadMoreLabel={drawerCursor ? t("drawer.more") : undefined}
          loading={drawerLoading}
          onClose={() => setDrawerOpen(false)}
          onLoadMore={drawerCursor ? () => void loadMoreEvidence() : undefined}
          onOpenEnriched={(record) => openEnrichedMention(record.id)}
          openOriginalLabel={t("preview.openOriginal")}
          openingEnrichedLabel={t("preview.openingMention")}
          openingRecordId={mentionNavigationPending ? openingMentionId : null}
          records={drawerRecords.map((record): SignalEvidenceDrawerRecord => ({
            body: record.text,
            id: record.mention_id,
            occurredAt: record.occurred_at,
            originalUrl: record.source_url,
            platform: record.platform
          }))}
          title={readingFinding.finding_name}
          viewEnrichedLabel={t("preview.viewMention")}
          loadingLabel={t("drawer.loading")}
        />
      ) : null}
    </section>
  );
}

function FindingSnapshot({
  chartOption,
  detail,
  error,
  loading,
  selectedFinding,
  selectedSeries
}: {
  chartOption: EChartsCoreOption | null;
  detail: SignalTriggersBarriersFindingDetailV2 | null;
  error: string | null;
  loading: boolean;
  selectedFinding: PublicTbFinding | null;
  selectedSeries: SignalTriggersBarriersOverviewV2["finding_time_series"];
}) {
  const t = useTranslations("SignalV2.triggersBarriers");
  const locale = useLocale();
  if (!selectedFinding) {
    return (
      <section className="signal-v2-tb-panel signal-v2-tb-snapshot">
        <PanelHead eyebrow={t("snapshot.eyebrow")} title={t("snapshot.title")} />
        <EmptyFindings compact />
      </section>
    );
  }
  if (!detail || loading) {
    return (
      <section aria-busy="true" className="signal-v2-tb-panel signal-v2-tb-snapshot signal-v2-tb-snapshot--loading">
        <PanelHead eyebrow={t("snapshot.eyebrow")} title={selectedFinding.finding_name || t("snapshot.title")} />
        <div className="signal-v2-tb-snapshot__skeleton" aria-hidden>
          <div><span /><span /><span /></div>
          <div><span /><span /><span /><span /><span /></div>
          <div><span /><span /><span /></div>
          <div />
        </div>
        {error ? <p className="signal-v2-tb-error" role="alert">{error}</p> : null}
      </section>
    );
  }
  return (
    <section aria-busy={loading} className="signal-v2-tb-panel signal-v2-tb-snapshot">
      <PanelHead eyebrow={t("snapshot.eyebrow")} title={selectedFinding.finding_name} />
      {error ? <p className="signal-v2-tb-error" role="alert">{error}</p> : null}
      <div className="signal-v2-tb-snapshot__body">
        <div className="signal-v2-tb-snapshot__chips">
          <span data-polarity={selectedFinding.polarity}><i />{t(`polarity.${selectedFinding.polarity}`)}</span>
          <span>{t(`layers.${selectedFinding.layer}`)}</span>
          <span>{t(`mobility.${selectedFinding.mobility ?? "estructural"}.label`)}</span>
        </div>
        <dl className="signal-v2-tb-snapshot__metrics">
          <div><dt><SignalMetricHelp content={translatedHelp(t, "helpers.frequency")} label={t("reading.frequency")} /></dt><dd>{formatNumber(detail.frequency_mentions, locale)}</dd></div>
          <div><dt><SignalMetricHelp content={translatedHelp(t, "helpers.findingEvidence")} label={t("reading.evidence")} /></dt><dd>{formatNumber(detail.evidence_count, locale)}</dd></div>
          <div className="signal-v2-tb-snapshot__priority"><dt><SignalMetricHelp content={translatedHelp(t, "helpers.priority")} label={t("reading.priority")} /></dt><dd>{formatDecimal(detail.composite_score, locale)} / 5</dd></div>
          <div><dt><SignalMetricHelp content={translatedHelp(t, "helpers.intensity")} label={t("reading.intensity")} /></dt><dd>{detail.intensity_score === null ? t("reading.notAvailable") : formatDecimal(detail.intensity_score, locale)}</dd></div>
          <div><dt><SignalMetricHelp content={translatedHelp(t, "helpers.confidence")} label={t("reading.confidence")} /></dt><dd>{t(`confidence.${detail.confidence}`)}</dd></div>
        </dl>
        <div className="signal-v2-tb-snapshot__platforms">
          <small>{t("snapshot.channels")}</small>
          <div>
            {detail.platforms.length > 0 ? detail.platforms.map((platform) => (
              <span className="signal-v2-tb-snapshot__platform" key={platform}>
                <span aria-hidden="true" className="signal-v2-tb-snapshot__platform-icon">
                  <SignalSourceIcon platform={platform} size={14} />
                </span>
                <span className="signal-v2-tb-snapshot__platform-label">{platformLabel(platform)}</span>
              </span>
            )) : <span>{t("snapshot.noChannels")}</span>}
          </div>
        </div>
        <div className="signal-v2-tb-snapshot__trend">
          <header><small>{t("snapshot.frequency")}</small><strong>{formatNumber(detail.frequency_mentions, locale)}</strong></header>
          {chartOption && selectedSeries.length > 0 ? (
            <SignalEChart
              ariaLabel={t("presence.chartLabel", { finding: selectedFinding.finding_name })}
              className="signal-v2-tb-snapshot__chart"
              option={chartOption}
            />
          ) : <span className="signal-v2-tb-snapshot__no-series">{t("snapshot.noSeries")}</span>}
        </div>
      </div>
    </section>
  );
}

function FindingReading({
  detail,
  error,
  hidePreview,
  loading,
  onOpenEvidence,
  preview,
  selectedFinding
}: {
  detail: SignalTriggersBarriersFindingDetailV2 | null;
  error: string | null;
  hidePreview: boolean;
  loading: boolean;
  onOpenEvidence: () => void;
  preview: SignalTriggersBarriersEvidencePageV2 | null;
  selectedFinding: PublicTbFinding | null;
}) {
  const t = useTranslations("SignalV2.triggersBarriers");
  if (!selectedFinding) return <EmptyFindings />;
  if (!detail || !preview || loading) {
    return (
      <section aria-busy="true" className="signal-v2-tb-panel signal-v2-tb-reading signal-v2-tb-reading--loading">
        <header className="signal-v2-tb-reading__head">
          <div>
            <small>{selectedFinding.finding_id}</small>
            <h2>{selectedFinding.finding_name}</h2>
          </div>
          <div className="signal-v2-tb-reading__chips">
            <span data-polarity={selectedFinding.polarity}>{t(`polarity.${selectedFinding.polarity}`)}</span>
            <span>{t(`layers.${selectedFinding.layer}`)}</span>
            <span>{t(`mobility.${selectedFinding.mobility ?? "estructural"}.label`)}</span>
          </div>
        </header>
        <div className="signal-v2-tb-reading__skeleton" aria-hidden>
          <div><span /><span /></div>
          <div><span /><span /><span /><span /></div>
          <div><span /><span /><span /></div>
        </div>
        {error ? <p className="signal-v2-tb-error" role="alert">{error}</p> : null}
      </section>
    );
  }
  const action = detail.actions[0] ?? null;
  const mobilityReason = detail.reading.mobility_reason?.trim();
  const showMobilityReason = mobilityReason
    && mobilityReason !== detail.reading.description.trim();
  return (
    <section aria-busy={loading} className="signal-v2-tb-panel signal-v2-tb-reading">
      {error ? <p className="signal-v2-tb-error" role="alert">{error}</p> : null}
      <header className="signal-v2-tb-reading__head">
        <div>
          <small>{selectedFinding.finding_id}</small>
          <h2>{detail.reading.title}</h2>
        </div>
        <div className="signal-v2-tb-reading__chips">
          <span data-polarity={selectedFinding.polarity}>{t(`polarity.${selectedFinding.polarity}`)}</span>
          <span>{t(`layers.${selectedFinding.layer}`)}</span>
          <span>{t(`mobility.${selectedFinding.mobility ?? "estructural"}.label`)}</span>
        </div>
      </header>
      <div className="signal-v2-tb-reading__body">
        <div className="signal-v2-tb-reading__summary">
          <p className="signal-v2-tb-reading__description">{detail.reading.description}</p>
          {showMobilityReason ? <div className="signal-v2-tb-reading__rationale"><strong>{t("reading.mobilityReason")}</strong><p>{mobilityReason}</p></div> : null}
        </div>
        {detail.public_quote && !hidePreview ? <blockquote><Quotes size={17} weight="fill" /><p>{detail.public_quote}</p></blockquote> : null}
        <div className="signal-v2-tb-reading__insights">
          {detail.reading.channel_insight ? <ReadingPoint label={t("reading.channel")} value={detail.reading.channel_insight} /> : null}
          {detail.reading.format_insight ? <ReadingPoint label={t("reading.format")} value={detail.reading.format_insight} /> : null}
          {detail.reading.period_insight ? <ReadingPoint label={t("reading.period")} value={detail.reading.period_insight} /> : null}
          {detail.reading.competitor_insight ? <ReadingPoint label={t("reading.competition")} value={detail.reading.competitor_insight} /> : null}
        </div>
        {action ? (
          <section className="signal-v2-tb-reading__action">
            <header><small>{t("brief.actionEyebrow")}</small><h3>{action.title}</h3></header>
            <p>{action.action_text}</p>
            <dl>
              <div><dt>{t("brief.owner")}</dt><dd>{t(`action.teams.${action.target_team}`)}</dd></div>
              <div><dt>{t("brief.effort")}</dt><dd>{t(`action.effort.${action.estimated_effort ?? "unknown"}`)}</dd></div>
              <div><dt>{t("brief.impact")}</dt><dd>{t(`action.impact.${action.estimated_impact ?? "unknown"}`)}</dd></div>
            </dl>
            {action.success_signal ? <div className="signal-v2-tb-reading__success"><strong>{t("brief.successSignal")}</strong><p>{action.success_signal}</p></div> : null}
            {detail.actions.length > 1 ? <span className="signal-v2-tb-reading__more-actions">{t("brief.moreActions", { count: detail.actions.length - 1 })}</span> : null}
          </section>
        ) : (
          <div className="signal-v2-tb-reading__no-action"><strong>{t("brief.noActionTitle")}</strong><p>{t("brief.noActionBody")}</p></div>
        )}
        {!hidePreview ? (
          <div className="signal-v2-tb-reading__evidence-action">
            <div>
              <small>{t("preview.eyebrow")}</small>
              <strong>{t("preview.count", { count: preview.page.total_count })}</strong>
            </div>
            <button className="signal-v2-tn__button" onClick={onOpenEvidence} type="button">{t("preview.open")}<ArrowRight size={14} /></button>
          </div>
        ) : null}
        {detail.reading.limitation ? <p className="signal-v2-tb-reading__limitation"><strong>{t("reading.limitations")}</strong>{detail.reading.limitation}</p> : null}
      </div>
    </section>
  );
}

function EmptyFindings({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("SignalV2.triggersBarriers");
  return (
    <div className={`signal-v2-tb-empty${compact ? " signal-v2-tb-empty--compact" : ""}`}>
      <strong>{t("empty.title")}</strong>
      <p>{t("empty.body")}</p>
    </div>
  );
}

function FilteredFindingsEmpty() {
  const t = useTranslations("SignalV2.triggersBarriers");
  return (
    <div className="signal-v2-tb-empty signal-v2-tb-empty--compact">
      <strong>{t("filters.empty.title")}</strong>
      <p>{t("filters.empty.body")}</p>
    </div>
  );
}

function FindingBubble({
  finding,
  maxFrequency,
  onSelect,
  selected,
  totalCodedMentions
}: {
  finding: PublicTbFinding;
  maxFrequency: number;
  onSelect: (findingId: string) => Promise<void>;
  selected: boolean;
  totalCodedMentions: number;
}) {
  const t = useTranslations("SignalV2.triggersBarriers");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const size = Math.max(10, Math.round(92 * Math.sqrt(finding.frequency_mentions / maxFrequency)));
  const updateTooltipPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(240, window.innerWidth - 24);
    const height = tooltipRef.current?.offsetHeight ?? 66;
    const above = rect.top >= height + 18;
    setTooltipStyle({
      left: Math.max(12, Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - 12
      )),
      top: above ? rect.top - height - 8 : rect.bottom + 8,
      width
    });
  }, []);

  useEffect(() => {
    if (!tooltipOpen) return;
    const frame = window.requestAnimationFrame(updateTooltipPosition);
    const onViewportChange = () => updateTooltipPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [tooltipOpen, updateTooltipPosition]);

  const tooltip = tooltipOpen && typeof document !== "undefined"
    ? createPortal(
        <span
          className="signal-v2-tb-bubble__tooltip"
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
          style={tooltipStyle}
        >
          <strong>{finding.finding_name}</strong>
          <small>{t("decision.tooltipFrequencyShort", { frequency: finding.frequency_mentions })}</small>
        </span>,
        document.body
      )
    : null;
  return (
    <>
      <button
        aria-describedby={tooltipOpen ? tooltipId : undefined}
        aria-label={t("decision.bubbleLabel", {
          name: finding.finding_name,
          polarity: t(`polarity.${finding.polarity}`),
          frequency: finding.frequency_mentions,
          total: totalCodedMentions
        })}
        aria-pressed={selected}
        className="signal-v2-tb-bubble"
        data-polarity={finding.polarity}
        onBlur={() => setTooltipOpen(false)}
        onClick={() => void onSelect(finding.finding_id)}
        onFocus={() => setTooltipOpen(true)}
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        ref={anchorRef}
        style={{ "--tb-bubble-size": `${size}px` } as React.CSSProperties}
        type="button"
      />
      {tooltip}
    </>
  );
}

function PanelHead({
  body,
  eyebrow,
  help,
  title
}: {
  body?: string;
  eyebrow: string;
  help?: SignalMetricHelpContent;
  title: string;
}) {
  return (
    <header className="signal-v2-tb-panel__head">
      <small>{eyebrow}</small>
      <h2>{help ? <SignalMetricHelp content={help} label={title} /> : title}</h2>
      {body ? <p>{body}</p> : null}
    </header>
  );
}

function Metric({
  help,
  label,
  suffix = "",
  value
}: {
  help: SignalMetricHelpContent;
  label: string;
  suffix?: string;
  value: number;
}) {
  const locale = useLocale();
  return <div><span><SignalMetricHelp content={help} label={label} /></span><strong>{formatNumber(value, locale)}{suffix}</strong></div>;
}

function ReadingPoint({ label, value }: { label: string; value: string }) {
  return <div><strong>{label}</strong><p>{value}</p></div>;
}

function buildMatrix(findings: PublicTbFinding[]) {
  const matrix = new Map<string, PublicTbFinding[]>();
  for (const finding of findings) {
    if (!finding.mobility) continue;
    const key = `${finding.mobility}:${finding.layer}`;
    matrix.set(key, [...(matrix.get(key) ?? []), finding]);
  }
  for (const [key, values] of matrix) {
    matrix.set(key, values.sort((left, right) => (
      right.frequency_mentions - left.frequency_mentions
      || right.composite_score - left.composite_score
      || left.finding_id.localeCompare(right.finding_id)
    )));
  }
  return matrix;
}

function visibleMatrixFindings(findings: PublicTbFinding[], selectedId: string) {
  if (findings.length <= MAX_MATRIX_FINDINGS) return findings;
  const visible = findings.slice(0, MAX_MATRIX_FINDINGS);
  const selected = findings.find((finding) => finding.finding_id === selectedId);
  if (selected && !visible.some((finding) => finding.finding_id === selectedId)) {
    return [...visible.slice(0, -1), selected];
  }
  return visible;
}

function compactPresenceTooltip(
  raw: unknown,
  t: ReturnType<typeof useTranslations>
) {
  const value = Array.isArray(raw) ? raw[0] as { axisValue?: string; value?: number } | undefined : undefined;
  return escapeHtml(t("presence.tooltipCount", { count: Number(value?.value ?? 0) }));
}

function platformLabel(platform: string) {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "x" || normalized === "twitter") return "X";
  if (normalized.includes("facebook")) return "Facebook";
  if (normalized.includes("instagram")) return "Instagram";
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("reddit")) return "Reddit";
  return platform
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function uniqueMentions(records: SignalTriggersBarriersEvidenceRecordV2[]) {
  return [...new Map(records.map((record) => [record.mention_id, record])).values()];
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function formatDecimal(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character] ?? character);
}

function periodQuery(data: SignalTriggersBarriersOverviewV2) {
  return new URLSearchParams({
    start: data.filter.date_range.start,
    end: data.filter.date_range.end
  }).toString();
}

function tbMentionHref(
  workspaceSlug: string,
  mentionId: string,
  data: SignalTriggersBarriersOverviewV2
) {
  const params = new URLSearchParams({
    start: data.filter.date_range.start,
    end: data.filter.date_range.end,
    timezone: data.filter.timezone,
    granularity: data.filter.granularity,
    compare: data.comparison.mode
  });
  if (data.comparison.mode !== "none" && data.comparison.date_range) {
    params.set("comparison_start", data.comparison.date_range.start);
    params.set("comparison_end", data.comparison.date_range.end);
  }
  for (const [dimension, values] of Object.entries(data.filter.dimensions)) {
    for (const value of values ?? []) params.append(`dimension.${dimension}`, value);
  }
  return `/signal/${encodeURIComponent(workspaceSlug)}/mentions?mention=${encodeURIComponent(mentionId)}&${params}`;
}

function translatedHelp(
  t: ReturnType<typeof useTranslations>,
  key: string,
  values?: Record<string, number | string>
): SignalMetricHelpContent {
  return {
    title: t(`${key}.title`, values),
    body: t(`${key}.body`, values),
    reading: t(`${key}.reading`, values)
  };
}
