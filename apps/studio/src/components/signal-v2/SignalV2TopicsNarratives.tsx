"use client";

import {
  ArrowRight,
  CaretRight,
  Database,
  Funnel,
  Quotes,
  X
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";

import type {
  SignalComparisonV1,
  SignalFilterV1,
  SignalTaxonomyEvidencePageV1,
  SignalTaxonomyKindV1,
  SignalTaxonomyLineageV1,
  SignalTaxonomyTermDetailV1,
  SignalTaxonomyTermMetricV1,
  SignalTopicsNarrativesOverviewV1
} from "@noisia/query-engine";
import {
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "@/components/signal-v2/SignalAnalyticsFilter";
import { SignalEChart } from "@/components/signal-v2/SignalEChart";
import { SignalMetricHelp } from "@/components/signal-v2/SignalMetricHelp";

const BLUE = "#1689f5";
const BLUE_SOFT = "#8fcef9";
const GRID = "#ebebeb";
const TEXT = "#303030";
const MUTED = "#737373";

export function SignalV2TopicsNarratives({
  brandName,
  comparison,
  coverage,
  data,
  filter,
  loading,
  onApplyFilter,
  onOpenControls
}: {
  brandName: string;
  comparison: SignalComparisonV1;
  coverage: { date_from: string | null; date_through: string | null };
  data: SignalTopicsNarrativesOverviewV1;
  filter: SignalFilterV1;
  loading: boolean;
  onApplyFilter: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onOpenControls: () => void;
}) {
  const t = useTranslations("SignalV2.topicsNarratives");
  const common = useTranslations("SignalV2");
  const locale = useLocale();
  const [kind, setKind] = useState<SignalTaxonomyKindV1>("topic");
  const section = kind === "topic" ? data.topics : data.narratives;
  const otherSection = kind === "topic" ? data.narratives : data.topics;
  const [selectedTermKey, setSelectedTermKey] = useState<string | null>(
    section.terms[0]?.term_key ?? null
  );
  const [detail, setDetail] = useState<SignalTaxonomyTermDetailV1 | null>(null);
  const [lineage, setLineage] = useState<SignalTaxonomyLineageV1 | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<SignalTaxonomyEvidencePageV1 | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);

  useEffect(() => {
    const nextSection = kind === "topic" ? data.topics : data.narratives;
    if (!nextSection.terms.some((term) => term.term_key === selectedTermKey)) {
      setSelectedTermKey(nextSection.terms[0]?.term_key ?? null);
    }
  }, [data.narratives, data.topics, kind, selectedTermKey]);

  useEffect(() => {
    if (!selectedTermKey) {
      setDetail(null);
      setLineage(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const params = taxonomyQuery(filter, comparison);
        const base = `/api/data-os/signal/${data.workspace_id}/topics-narratives/${kind}/${encodeURIComponent(selectedTermKey)}`;
        const [detailResponse, lineageResponse] = await Promise.all([
          fetch(`${base}?${params}`, { cache: "no-store" }),
          fetch(`${base}/lineage?${params}`, { cache: "no-store" })
        ]);
        const detailPayload = await detailResponse.json() as SignalTaxonomyTermDetailV1 & { message?: string };
        if (!detailResponse.ok) throw new Error(detailPayload.message ?? t("errors.detail"));
        const lineagePayload = lineageResponse.ok
          ? await lineageResponse.json() as SignalTaxonomyLineageV1
          : null;
        if (!cancelled) {
          setDetail(detailPayload);
          setLineage(lineagePayload);
        }
      } catch (error) {
        if (!cancelled) {
          setDetail(null);
          setLineage(null);
          setDetailError(error instanceof Error ? error.message : t("errors.detail"));
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [comparison, data.workspace_id, filter, kind, selectedTermKey, t]);

  const selectedMetric = section.terms.find((term) => term.term_key === selectedTermKey)
    ?? section.terms[0]
    ?? null;
  const coveragePercent = section.coverage.coverage == null
    ? null
    : Math.round(section.coverage.coverage * 100);
  const maxCount = Math.max(1, ...section.terms.map((term) => term.mention_count));
  const trendOption = useMemo(
    () => buildTrendOption(detail, locale, t("charts.currentPeriod")),
    [detail, locale, t]
  );

  const openEvidence = async () => {
    if (!selectedTermKey) return;
    setEvidenceOpen(true);
    setEvidenceLoading(true);
    setEvidenceError(false);
    try {
      const params = taxonomyQuery(filter, comparison);
      params.set("limit", "25");
      const response = await fetch(
        `/api/data-os/signal/${data.workspace_id}/topics-narratives/${kind}/${encodeURIComponent(selectedTermKey)}/evidence?${params}`,
        { cache: "no-store" }
      );
      const payload = await response.json() as SignalTaxonomyEvidencePageV1 & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("errors.evidence"));
      setEvidence(payload);
    } catch {
      setEvidence(null);
      setEvidenceError(true);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const loadMoreEvidence = async () => {
    if (!selectedTermKey || !evidence?.page.next_cursor) return;
    setEvidenceLoading(true);
    try {
      const params = taxonomyQuery(filter, comparison);
      params.set("limit", "25");
      params.set("cursor", evidence.page.next_cursor);
      const response = await fetch(
        `/api/data-os/signal/${data.workspace_id}/topics-narratives/${kind}/${encodeURIComponent(selectedTermKey)}/evidence?${params}`,
        { cache: "no-store" }
      );
      if (!response.ok) return;
      const next = await response.json() as SignalTaxonomyEvidencePageV1;
      setEvidence((current) => current
        ? { ...next, records: [...current.records, ...next.records] }
        : next);
    } finally {
      setEvidenceLoading(false);
    }
  };

  return (
    <>
      <div className="signal-v2-page-head signal-v2-tn__head">
        <div>
          <div className="signal-v2-title-line">
            <Quotes size={20} weight="fill" />
            <h1>{t("title")}</h1>
            <span>{t("status")}</span>
          </div>
          <p>{t("subtitle")}</p>
        </div>
        <span className={`signal-v2-tn__state signal-v2-tn__state--${data.state}`}>
          {t(`states.${data.state}`)}
        </span>
      </div>

      <div className="signal-v2-filterbar">
        <SignalAnalyticsFilter
          comparison={comparison}
          coverage={coverage}
          filter={filter}
          loading={loading}
          onApply={onApplyFilter}
        />
        <button className="signal-v2-filter" type="button">
          <Database size={15} />
          {common("filters.dataScope", { brand: brandName })}
        </button>
        <button className="signal-v2-filter" onClick={onOpenControls} type="button">
          <Funnel size={15} />
          {common("filters.more")}
        </button>
      </div>

      {data.state === "partial" || section.coverage.quality_state === "partial" ? (
        <section className="signal-v2-tn__coverage-note" role="status">
          <span aria-hidden />
          <div>
            <strong>{t("partial.title")}</strong>
            <p>{t("partial.body", {
              classified: section.coverage.classified_mentions,
              included: section.coverage.included_mentions,
              pending: section.coverage.pending_mentions
            })}</p>
          </div>
        </section>
      ) : null}

      <section className="signal-v2-tn__kpis">
        <TnKpi
          help={{
            title: t("helpers.coverage.title"),
            body: t("helpers.coverage.body"),
            reading: t("helpers.coverage.reading")
          }}
          label={t("kpis.coverage")}
          secondary={t("kpis.coverageSecondary", {
            classified: section.coverage.classified_mentions,
            included: section.coverage.included_mentions
          })}
          value={coveragePercent == null ? "—" : `${coveragePercent}%`}
        />
        <TnKpi
          help={{
            title: t("helpers.terms.title"),
            body: t("helpers.terms.body"),
            reading: t("helpers.terms.reading")
          }}
          label={t("kpis.activeTerms")}
          secondary={t("kpis.profileVersion", {
            version: data.profiles.find((profile) => profile.kind === kind)?.version ?? 1
          })}
          value={section.terms.length}
        />
        <TnKpi
          help={{
            title: t("helpers.assertions.title"),
            body: t("helpers.assertions.body"),
            reading: t("helpers.assertions.reading")
          }}
          label={t("kpis.assertions")}
          secondary={t("kpis.assertionsSecondary")}
          value={section.coverage.tag_assertions}
        />
        <TnKpi
          help={{
            title: t("helpers.pending.title"),
            body: t("helpers.pending.body"),
            reading: t("helpers.pending.reading")
          }}
          label={t("kpis.pending")}
          secondary={t("kpis.pendingSecondary")}
          tone={section.coverage.pending_mentions > 0 ? "warning" : "positive"}
          value={section.coverage.pending_mentions}
        />
      </section>

      <div className="signal-v2-tn__switch" role="tablist">
        <button
          aria-selected={kind === "topic"}
          onClick={() => setKind("topic")}
          role="tab"
          type="button"
        >
          {t("tabs.topics")}
          <span>{data.topics.terms.length}</span>
        </button>
        <button
          aria-selected={kind === "narrative"}
          onClick={() => setKind("narrative")}
          role="tab"
          type="button"
        >
          {t("tabs.narratives")}
          <span>{data.narratives.terms.length}</span>
        </button>
      </div>

      {section.state === "not_available" || section.terms.length === 0 ? (
        <section className="signal-v2-tn__empty">
          <Quotes size={24} />
          <strong>{t("empty.title")}</strong>
          <p>{t("empty.body")}</p>
        </section>
      ) : (
        <div className="signal-v2-tn__grid">
          <section className="signal-v2-card signal-v2-tn__ranking">
            <header className="signal-v2-card__heading">
              <div>
                <small>{t("ranking.eyebrow")}</small>
                <h2>
                  <SignalMetricHelp
                    content={{
                      title: t(`helpers.${kind}.title`),
                      body: t(`helpers.${kind}.body`),
                      reading: t(`helpers.${kind}.reading`)
                    }}
                    label={kind === "topic" ? t("ranking.topics") : t("ranking.narratives")}
                  />
                </h2>
              </div>
              <span>{t("ranking.unit")}</span>
            </header>
            <div className="signal-v2-tn__rank-head">
              <span>{t("ranking.term")}</span>
              <span>{t("ranking.volume")}</span>
              <span>{t("ranking.share")}</span>
              <span>{t("ranking.change")}</span>
            </div>
            <div className="signal-v2-tn__rank-list">
              {section.terms.map((term) => (
                <button
                  aria-pressed={term.term_key === selectedTermKey}
                  key={term.term_key}
                  onClick={() => setSelectedTermKey(term.term_key)}
                  type="button"
                >
                  <span className="signal-v2-tn__term">
                    <strong>{displayTermLabel(term.label)}</strong>
                    <i><b style={{ width: `${Math.max(3, term.mention_count / maxCount * 100)}%` }} /></i>
                  </span>
                  <b>{formatNumber(term.mention_count, locale)}</b>
                  <span>{formatShare(term.share_of_included, locale)}</span>
                  <ShareDelta value={term.share_delta} locale={locale} />
                  <CaretRight size={14} />
                </button>
              ))}
            </div>
          </section>

          <section className="signal-v2-card signal-v2-tn__detail">
            <header className="signal-v2-card__heading">
              <div>
                <small>{t("detail.eyebrow")}</small>
                <h2>
                  <SignalMetricHelp
                    content={{
                      title: t("helpers.trend.title"),
                      body: t("helpers.trend.body"),
                      reading: t("helpers.trend.reading")
                    }}
                    label={selectedMetric ? displayTermLabel(selectedMetric.label) : t("detail.title")}
                  />
                </h2>
              </div>
              {selectedMetric ? (
                <ShareDelta value={selectedMetric.share_delta} locale={locale} />
              ) : null}
            </header>
            {detailLoading ? (
              <div className="signal-v2-tn__detail-loading" aria-label={common("actions.loading")} />
            ) : detailError ? (
              <p className="signal-v2-tn__unavailable">{t("detail.notAvailable")}</p>
            ) : detail ? (
              <>
                <div className="signal-v2-tn__definition">
                  <strong>{detail.term.definition ?? displayTermLabel(detail.term.label)}</strong>
                  {detail.term.statement ? <p>{detail.term.statement}</p> : null}
                </div>
                <SignalEChart
                  ariaLabel={t("charts.termTrend", { term: displayTermLabel(detail.term.label) })}
                  className="signal-v2-tn__trend"
                  option={trendOption}
                />
                <div className="signal-v2-tn__detail-actions">
                  <button className="signal-v2-tn__button" onClick={() => void openEvidence()} type="button">
                    {t("detail.openEvidence")}
                    <ArrowRight size={14} />
                  </button>
                  <span>{t("detail.sourceSummary", {
                    mentions: lineage?.source_summary.mention_count ?? detail.term.mention_count,
                    batches: lineage?.source_summary.import_batch_count ?? 0
                  })}</span>
                </div>
              </>
            ) : null}
          </section>

          <section className="signal-v2-card signal-v2-tn__cooccurrence">
            <header className="signal-v2-card__heading">
              <div>
                <small>{t("cooccurrence.eyebrow")}</small>
                <h2>
                  <SignalMetricHelp
                    content={{
                      title: t("helpers.cooccurrence.title"),
                      body: t("helpers.cooccurrence.body"),
                      reading: t("helpers.cooccurrence.reading")
                    }}
                    label={t("cooccurrence.title")}
                  />
                </h2>
              </div>
            </header>
            <div className="signal-v2-tn__co-list">
              {section.cooccurrences.slice(0, 8).map((pair) => (
                <div key={`${pair.left_term_key}:${pair.right_term_key}`}>
                  <span>{displayTermLabel(labelFor(section.terms, pair.left_term_key))}</span>
                  <i />
                  <span>{displayTermLabel(labelFor(section.terms, pair.right_term_key))}</span>
                  <b>{pair.mention_count}</b>
                </div>
              ))}
              {section.cooccurrences.length === 0 ? <p>{t("cooccurrence.empty")}</p> : null}
            </div>
          </section>

          <section className="signal-v2-card signal-v2-tn__companion">
            <header className="signal-v2-card__heading">
              <div>
                <small>{t("companion.eyebrow")}</small>
                <h2>{kind === "topic" ? t("companion.narratives") : t("companion.topics")}</h2>
              </div>
            </header>
            <div className="signal-v2-tn__companion-list">
              {otherSection.terms.slice(0, 6).map((term) => (
                <div key={term.term_key}>
                  <span>{displayTermLabel(term.label)}</span>
                  <strong>{formatNumber(term.mention_count, locale)}</strong>
                  <small>{formatShare(term.share_of_included, locale)}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {evidenceOpen ? (
        <div className="signal-v2-tn__evidence-layer">
          <button
            aria-label={t("evidence.close")}
            className="signal-v2-tn__scrim"
            onClick={() => setEvidenceOpen(false)}
            type="button"
          />
          <aside aria-label={t("evidence.title")} className="signal-v2-tn__evidence">
            <header>
              <div>
                <small>{kind === "topic" ? t("tabs.topics") : t("tabs.narratives")}</small>
                <h2>{selectedMetric ? displayTermLabel(selectedMetric.label) : t("evidence.title")}</h2>
              </div>
              <button aria-label={t("evidence.close")} onClick={() => setEvidenceOpen(false)} type="button">
                <X size={17} />
              </button>
            </header>
            <p className="signal-v2-tn__evidence-intro">{t("evidence.body")}</p>
            <div className="signal-v2-tn__evidence-list">
              {evidenceLoading && !evidence ? (
                Array.from({ length: 5 }, (_, index) => <i key={index} />)
              ) : evidenceError ? (
                <p className="signal-v2-tn__inline-error">{t("errors.evidence")}</p>
              ) : evidence?.records.map((record) => (
                <article key={record.mention_id}>
                  <div>
                    <strong>{record.platform ?? t("evidence.unknownSource")}</strong>
                    <time>{formatDate(record.occurred_at, locale)}</time>
                  </div>
                  <p>{record.text_snippet ?? record.title ?? t("evidence.noText")}</p>
                  {record.evidence_quotes[0]?.quote ? (
                    <blockquote>{record.evidence_quotes[0].quote}</blockquote>
                  ) : null}
                  {record.url ? (
                    <a href={record.url} rel="noreferrer" target="_blank">
                      {t("evidence.openOriginal")} <ArrowRight size={13} />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
            {evidence?.page.next_cursor ? (
              <button
                className="signal-v2-tn__button signal-v2-tn__load-more"
                disabled={evidenceLoading}
                onClick={() => void loadMoreEvidence()}
                type="button"
              >
                {evidenceLoading ? common("actions.loading") : t("evidence.loadMore")}
              </button>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}

function TnKpi({
  help,
  label,
  secondary,
  tone,
  value
}: {
  help: { title: string; body: string; reading: string };
  label: string;
  secondary: string;
  tone?: "positive" | "warning";
  value: number | string;
}) {
  return (
    <article className={tone ? `signal-v2-tn__kpi signal-v2-tn__kpi--${tone}` : "signal-v2-tn__kpi"}>
      <SignalMetricHelp content={help} label={label} />
      <strong>{value}</strong>
      <small>{secondary}</small>
    </article>
  );
}

function ShareDelta({ locale, value }: { locale: string; value: number | null }) {
  if (value == null) return <span className="signal-v2-tn__delta">—</span>;
  return (
    <span className={`signal-v2-tn__delta signal-v2-tn__delta--${value > 0 ? "up" : value < 0 ? "down" : "flat"}`}>
      {value > 0 ? "↑ " : value < 0 ? "↓ " : ""}
      {new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
        signDisplay: "never"
      }).format(Math.abs(value * 100))} pp
    </span>
  );
}

function taxonomyQuery(filter: SignalFilterV1, comparison: SignalComparisonV1) {
  const params = new URLSearchParams({
    start: filter.date_range.start,
    end: filter.date_range.end,
    timezone: filter.timezone,
    granularity: filter.granularity,
    compare: comparison.mode
  });
  if (filter.search_query) params.set("q", filter.search_query);
  for (const [dimension, values] of Object.entries(filter.dimensions)) {
    for (const value of values ?? []) params.append(`dimension.${dimension}`, value);
  }
  if (comparison.date_range) {
    params.set("comparison_start", comparison.date_range.start);
    params.set("comparison_end", comparison.date_range.end);
  }
  return params;
}

function buildTrendOption(
  detail: SignalTaxonomyTermDetailV1 | null,
  locale: string,
  seriesName: string
): EChartsCoreOption {
  const points = detail?.series ?? [];
  return {
    animation: true,
    grid: { top: 16, right: 8, bottom: 36, left: 40 },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#fff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      textStyle: { color: TEXT, fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => formatDate(point.period_start, locale, true)),
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 10, hideOverlap: true }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: MUTED, fontSize: 10 },
      splitLine: { lineStyle: { color: GRID } }
    },
    series: [{
      name: seriesName,
      type: "line",
      smooth: 0.28,
      showSymbol: false,
      lineStyle: { color: BLUE, width: 2 },
      itemStyle: { color: BLUE },
      areaStyle: { color: BLUE_SOFT, opacity: 0.18 },
      data: points.map((point) => point.mention_count)
    }]
  };
}

function labelFor(terms: SignalTaxonomyTermMetricV1[], key: string) {
  return terms.find((term) => term.term_key === key)?.label ?? key;
}

function displayTermLabel(value: string) {
  if (!value.includes("_")) return value;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatShare(value: number | null, locale: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDate(value: string, locale: string, compact = false) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, compact
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}
