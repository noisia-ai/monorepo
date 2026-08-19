"use client";

import {
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowRight,
  ChartLine,
  ChatCircleDots,
  Gauge,
  Megaphone,
  Sparkle
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { EChartsCoreOption } from "echarts/core";

import { SignalEChart } from "@/components/signal-v2/SignalEChart";
import type {
  BrandMonitoringMonthlyInsightChart,
  BrandMonitoringMonthlyInsights
} from "@/lib/signal-v2/brand-monitoring";

const AUTO_ADVANCE_MS = 50_000;
const BLUE = "#1689f5";
const BLUE_SOFT = "#8fcef9";
const PURPLE = "#7157d9";
const MUTED = "#737373";
const GRID = "#ebebeb";

export type SignalInsightCarouselItem = {
  id: string;
  kind: string;
  tone: "positive" | "negative" | "neutral" | "attention";
  rank: number;
  metric: {
    current: number;
    previous: number | null;
    delta: number | null;
    delta_ratio: number | null;
    unit: "count" | "ratio";
  };
  chart: BrandMonitoringMonthlyInsightChart;
  evidence: {
    mention_ids: string[];
    evidence_count: number;
  };
  editorial: {
    state: "deterministic" | "claude" | "needs_review";
    short_title: string | null;
    headline: string | null;
    explanation: string | null;
    why_it_matters: string | null;
    confidence: "high" | "medium" | "low" | null;
    limitations: string[];
    chart_aria?: string | null;
  };
};

export type SignalInsightCarouselData = Pick<
  BrandMonitoringMonthlyInsights,
  "window" | "calculated_through"
> & {
  identity?: string | null;
  items: SignalInsightCarouselItem[];
};

export function MonthlyInsightCarousel({
  insights,
  labels,
  onOpenEvidence,
  secondaryMeta
}: {
  insights: SignalInsightCarouselData;
  labels?: {
    aria?: string;
    useful?: string;
    fixedWindow?: string;
    why?: string;
    whyItMatters?: string;
    limitations?: string;
    openEvidence?: string;
  };
  onOpenEvidence: (insight: SignalInsightCarouselItem) => void;
  secondaryMeta?: string | null;
}) {
  const t = useTranslations("SignalV2.monthlyInsights");
  const locale = useLocale();
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [reasonOpen, setReasonOpen] = useState(false);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reasonButtonRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLDivElement | null>(null);
  const items = insights.items;
  const active = items[Math.min(activeIndex, Math.max(items.length - 1, 0))] ?? null;

  useEffect(() => {
    setActiveIndex(0);
    setAutoAdvance(true);
    setReasonOpen(false);
  }, [insights.calculated_through, insights.identity]);

  useEffect(() => {
    if (!autoAdvance || items.length <= 1 || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((index) => (index + 1) % items.length);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, autoAdvance, items.length]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (!reasonOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (reasonRef.current?.contains(target) || reasonButtonRef.current?.contains(target)) return;
      setReasonOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setReasonOpen(false);
      reasonButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [reasonOpen]);

  if (!active || !insights.window) return null;

  const stopAutoAdvance = () => setAutoAdvance(false);
  const select = (index: number) => {
    stopAutoAdvance();
    setReasonOpen(false);
    setActiveIndex(index);
  };
  const detail = insightCopy(active, t, locale);
  const chartOption = buildInsightChartOption(active.chart, t, locale);
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    stopAutoAdvance();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (activeIndex + 1) % items.length
          : (activeIndex - 1 + items.length) % items.length;
    setActiveIndex(nextIndex);
    itemRefs.current[nextIndex]?.focus();
  };

  return (
    <section
      aria-label={labels?.aria ?? t("aria")}
      className="signal-v2-monthly-insights"
      onKeyDown={stopAutoAdvance}
      onPointerDown={stopAutoAdvance}
      onWheel={stopAutoAdvance}
    >
      <div
        aria-orientation="vertical"
        className="signal-v2-monthly-insights__list"
        onKeyDown={onListKeyDown}
        role="tablist"
      >
        {items.map((item, index) => {
          const copy = insightCopy(item, t, locale);
          const selected = index === activeIndex;
          return (
            <button
              aria-controls={`monthly-insight-panel-${item.id}`}
              aria-selected={selected}
              className={`signal-v2-monthly-insights__item${selected ? " is-active" : ""}`}
              id={`monthly-insight-tab-${item.id}`}
              key={item.id}
              onClick={() => select(index)}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <InsightIcon insight={item} />
              <span>{copy.shortTitle}</span>
              {selected && autoAdvance && items.length > 1 ? (
                <i
                  aria-hidden="true"
                  className="signal-v2-monthly-insights__progress"
                  key={`${item.id}-${activeIndex}`}
                  style={{ "--signal-insight-duration": `${AUTO_ADVANCE_MS}ms` } as CSSProperties}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <article
        aria-labelledby={`monthly-insight-heading-${active.id}`}
        className="signal-v2-monthly-insights__detail"
        id={`monthly-insight-panel-${active.id}`}
        role="tabpanel"
        tabIndex={0}
      >
        <div className="signal-v2-monthly-insights__copy">
          <small>
            {labels?.useful ?? t("useful")} · {formatLongDate(insights.calculated_through, locale)}
          </small>
          <div className={`signal-v2-monthly-insights__headline signal-v2-monthly-insights__headline--${active.tone}`}>
            <InsightIcon insight={active} />
            <h2 id={`monthly-insight-heading-${active.id}`}>{detail.headline}</h2>
          </div>
          <p>{detail.explanation}</p>
          <div className="signal-v2-monthly-insights__meta">
            {t("window", {
              start: formatShortDate(insights.window.start, locale),
              end: formatShortDate(insights.window.end, locale)
            })}
            <span aria-hidden="true">·</span>
            {labels?.fixedWindow ?? t("fixedWindow")}
            {secondaryMeta ? (
              <>
                <span aria-hidden="true">·</span>
                {secondaryMeta}
              </>
            ) : null}
          </div>
          <button
            aria-expanded={reasonOpen}
            onClick={() => {
              stopAutoAdvance();
              setReasonOpen((open) => !open);
            }}
            ref={reasonButtonRef}
            type="button"
          >
            {labels?.why ?? t("why")}
            <ArrowRight size={13} />
          </button>
          {reasonOpen ? (
            <div
              aria-label={labels?.whyItMatters ?? t("whyItMatters")}
              className="signal-v2-monthly-insights__reason"
              ref={reasonRef}
              role="dialog"
            >
              <strong>{labels?.whyItMatters ?? t("whyItMatters")}</strong>
              <p>{active.editorial.why_it_matters ?? detail.explanation}</p>
              {active.editorial.limitations.length > 0 ? (
                <>
                  <strong>{labels?.limitations ?? t("limitations")}</strong>
                  <ul>
                    {active.editorial.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <button onClick={() => onOpenEvidence(active)} type="button">
                {labels?.openEvidence ?? t("openEvidence")}
                <ArrowRight size={13} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="signal-v2-monthly-insights__visual">
          <SignalEChart
            ariaLabel={detail.chartAria}
            onActivate={() => onOpenEvidence(active)}
            option={chartOption}
          />
        </div>
      </article>
    </section>
  );
}

function InsightIcon({ insight }: { insight: SignalInsightCarouselItem }) {
  const icon: ReactNode = insight.kind === "conversation_concentration"
    ? <ChatCircleDots weight="bold" />
    : insight.kind === "conversation_depth"
      ? <Megaphone weight="bold" />
      : insight.kind === "sentiment_balance"
        ? <Gauge weight="bold" />
        : insight.kind === "platform_concentration"
          ? <Sparkle weight="bold" />
          : insight.tone === "negative"
            ? <ArrowCircleDown weight="bold" />
            : insight.tone === "positive"
              ? <ArrowCircleUp weight="bold" />
              : <ChartLine weight="bold" />;
  return <span className={`signal-v2-monthly-insights__icon is-${insight.tone}`}>{icon}</span>;
}

function insightCopy(
  insight: SignalInsightCarouselItem,
  t: ReturnType<typeof useTranslations>,
  locale: string
) {
  const direction = insight.metric.delta_ratio == null
    ? "steady"
    : insight.metric.delta_ratio > 0
      ? "up"
      : insight.metric.delta_ratio < 0
        ? "down"
        : "steady";
  const percent = formatPercent(Math.abs(insight.metric.delta_ratio ?? 0), locale);
  const signedPercent = formatSignedPercent(insight.metric.delta_ratio, locale);

  if (insight.kind === "volume_momentum") {
    return applyEditorial(insight, {
      shortTitle: t(`items.volume.${direction}.short`),
      headline: t(`items.volume.${direction}.headline`, {
        count: formatNumber(insight.metric.current, locale),
        delta: percent
      }),
      explanation: insight.metric.previous == null
        ? t("items.volume.noComparison", { count: formatNumber(insight.metric.current, locale) })
        : t(`items.volume.${direction}.explanation`, {
            current: formatNumber(insight.metric.current, locale),
            previous: formatNumber(insight.metric.previous, locale),
            delta: signedPercent
          }),
      chartAria: t("items.volume.chartAria")
    });
  }

  if (insight.kind === "conversation_concentration") {
    return applyEditorial(insight, {
      shortTitle: t("items.concentration.short"),
      headline: t("items.concentration.headline", {
        share: formatPercent(insight.metric.current, locale)
      }),
      explanation: t("items.concentration.explanation", {
        share: formatPercent(insight.metric.current, locale),
        count: formatNumber(insight.evidence.evidence_count, locale)
      }),
      chartAria: t("items.concentration.chartAria")
    });
  }

  if (insight.kind === "conversation_depth") {
    const depthDirection = insight.metric.previous == null
      ? "steady"
      : insight.metric.current > insight.metric.previous
        ? "up"
        : insight.metric.current < insight.metric.previous
          ? "down"
          : "steady";
    return applyEditorial(insight, {
      shortTitle: t(`items.depth.${depthDirection}.short`),
      headline: t(`items.depth.${depthDirection}.headline`, {
        share: formatPercent(insight.metric.current, locale)
      }),
      explanation: t(`items.depth.${depthDirection}.explanation`, {
        share: formatPercent(insight.metric.current, locale)
      }),
      chartAria: t("items.depth.chartAria")
    });
  }

  if (insight.kind === "sentiment_balance") {
    const tone = insight.metric.current > 0.1
      ? "positive"
      : insight.metric.current < -0.1
        ? "negative"
        : "balanced";
    return applyEditorial(insight, {
      shortTitle: t(`items.sentiment.${tone}.short`),
      headline: t(`items.sentiment.${tone}.headline`, {
        balance: formatSignedPoints(insight.metric.current, locale)
      }),
      explanation: t(`items.sentiment.${tone}.explanation`, {
        count: formatNumber(insight.evidence.evidence_count, locale)
      }),
      chartAria: t("items.sentiment.chartAria")
    });
  }

  if (insight.kind === "platform_concentration") {
    const leader = insight.chart.type === "bar" ? prettify(insight.chart.items[0]?.key ?? "") : "";
    return applyEditorial(insight, {
      shortTitle: t("items.platform.short", { platform: leader }),
      headline: t("items.platform.headline", {
        platform: leader,
        share: formatPercent(insight.metric.current, locale)
      }),
      explanation: t("items.platform.explanation", {
        platform: leader,
        count: formatNumber(insight.evidence.evidence_count, locale)
      }),
      chartAria: t("items.platform.chartAria")
    });
  }

  return applyEditorial(insight, {
    shortTitle: t(`items.attention.${direction}.short`),
    headline: t(`items.attention.${direction}.headline`, {
      count: formatNumber(insight.metric.current, locale),
      delta: percent
    }),
    explanation: insight.metric.previous == null
      ? t("items.attention.noComparison", { count: formatNumber(insight.metric.current, locale) })
      : t(`items.attention.${direction}.explanation`, {
          current: formatNumber(insight.metric.current, locale),
          previous: formatNumber(insight.metric.previous, locale),
          delta: signedPercent
        }),
    chartAria: t("items.attention.chartAria")
  });
}

function buildInsightChartOption(
  chart: BrandMonitoringMonthlyInsightChart,
  t: ReturnType<typeof useTranslations>,
  locale: string
): EChartsCoreOption {
  const base = {
    animationDuration: 260,
    textStyle: { fontFamily: "Product Sans, Google Sans, sans-serif" },
    tooltip: {
      trigger: "axis",
      appendToBody: true,
      confine: false,
      backgroundColor: "#ffffff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      padding: [7, 9],
      textStyle: { color: "#303030", fontFamily: "Product Sans", fontSize: 11, lineHeight: 16 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    }
  };

  if (chart.type === "line") {
    return {
      ...base,
      color: [BLUE, BLUE_SOFT],
      grid: { top: 10, right: 8, bottom: 24, left: 8, containLabel: false },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: chart.current.map((point) => formatAxisDate(point.period_start, locale)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: MUTED,
          fontSize: 10,
          interval: Math.max(Math.ceil(chart.current.length / 2) - 1, 0),
          showMinLabel: true,
          showMaxLabel: true
        }
      },
      yAxis: { type: "value", show: false, min: 0 },
      series: [
        {
          name: t("chart.current"),
          type: "line",
          smooth: 0.3,
          symbol: "none",
          lineStyle: { color: BLUE, width: 1.7 },
          data: chart.current.map((point) => point.value)
        },
        ...(chart.previous.length > 0 ? [{
          name: t("chart.previous"),
          type: "line" as const,
          smooth: 0.3,
          symbol: "none",
          lineStyle: { color: BLUE, width: 1.4, type: "dotted" as const },
          data: alignValues(chart.previous.map((point) => point.value), chart.current.length)
        }] : [])
      ]
    };
  }

  if (chart.type === "donut") {
    const total = chart.items.reduce((sum, item) => sum + item.value, 0);
    const previousTotal = chart.previous_items.reduce((sum, item) => sum + item.value, 0);
    const categories = chart.items.map((item) => t(`chart.sentiment.${item.key}`));
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: "axis",
        valueFormatter: (value: unknown) => formatPercent(Number(value), locale)
      },
      color: [BLUE, BLUE_SOFT],
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        icon: "circle",
        textStyle: { color: MUTED, fontSize: 10 }
      },
      grid: { top: 8, right: 12, bottom: 30, left: 62 },
      xAxis: {
        type: "value",
        min: 0,
        max: 1,
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { formatter: (value: number) => formatPercent(value, locale), color: MUTED, fontSize: 9 },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#303030", fontSize: 10 }
      },
      series: [
        {
          name: t("chart.current"),
          type: "bar",
          barMaxWidth: 12,
          itemStyle: { color: BLUE, borderRadius: [0, 3, 3, 0] },
          data: chart.items.map((item) => total > 0 ? item.value / total : 0)
        },
        ...(previousTotal > 0 ? [{
          name: t("chart.previous"),
          type: "bar" as const,
          barMaxWidth: 12,
          itemStyle: { color: BLUE_SOFT, borderRadius: [0, 3, 3, 0] },
          data: chart.items.map((item) => {
            const previous = chart.previous_items.find((candidate) => candidate.key === item.key);
            return previous ? previous.value / previousTotal : 0;
          })
        }] : [])
      ]
    };
  }

  if (chart.type === "comparison") {
    const normalized = chart.items.map((item) => {
      const maximum = Math.max(
        Math.abs(item.current),
        Math.abs(item.previous ?? 0),
        Number.EPSILON
      );
      return {
        ...item,
        current_index: item.current / maximum,
        previous_index: item.previous == null ? null : item.previous / maximum
      };
    });
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: "axis",
        formatter: (params: unknown) => comparisonTooltip(params, chart.items, t, locale)
      },
      color: [BLUE, BLUE_SOFT],
      grid: { top: 10, right: 8, bottom: 22, left: 26 },
      xAxis: {
        type: "category",
        data: chart.items.map((item) => metricLabel(item.key, t)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: MUTED,
          fontSize: 10,
          interval: 0,
          overflow: "truncate",
          width: 78
        }
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 1,
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { show: false }
      },
      series: [
        {
          name: t("chart.current"),
          type: "bar",
          barMaxWidth: 34,
          itemStyle: { color: BLUE, borderRadius: [3, 3, 0, 0] },
          data: normalized.map((item) => item.current_index)
        },
        ...(chart.items.some((item) => item.previous != null) ? [{
          name: t("chart.previous"),
          type: "bar" as const,
          barMaxWidth: 34,
          itemStyle: { color: BLUE_SOFT, borderRadius: [3, 3, 0, 0] },
          data: normalized.map((item) => item.previous_index)
        }] : [])
      ]
    };
  }

  const items = chart.items.slice(0, 5).reverse();
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: "item",
      formatter: (params: unknown) => driverTooltip(params, items, t, locale)
    },
    grid: { top: 7, right: 12, bottom: 8, left: 98 },
    xAxis: {
      type: "value",
      min: 0,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { show: false }
    },
    yAxis: {
      type: "category",
      data: items.map((item) => item.key),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "#303030",
        fontSize: 10,
        overflow: "truncate",
        width: 90
      }
    },
    series: [{
      type: "bar",
      barWidth: 9,
      itemStyle: { color: chart.items[0]?.secondary_value == null ? BLUE : PURPLE, borderRadius: [0, 4, 4, 0] },
      data: items.map((item) => item.value)
    }]
  };
}

function comparisonTooltip(
  params: unknown,
  items: Array<{ key: string; current: number; previous: number | null }>,
  t: ReturnType<typeof useTranslations>,
  locale: string
) {
  const rows = Array.isArray(params) ? params : [params];
  const first = asTooltipEntry(rows[0]);
  const item = items[first.dataIndex] ?? items[0];
  if (!item) return "";
  const lines = [
    `<strong>${escapeHtml(metricLabel(item.key, t))}</strong>`,
    `${escapeHtml(t("chart.current"))}: <b>${escapeHtml(formatMetricValue(item.key, item.current, locale))}</b>`
  ];
  if (item.previous != null) {
    lines.push(
      `${escapeHtml(t("chart.previous"))}: <b>${escapeHtml(formatMetricValue(item.key, item.previous, locale))}</b>`
    );
  }
  return lines.join("<br/>");
}

function driverTooltip(
  params: unknown,
  items: Array<{ key: string; value: number; secondary_value?: number }>,
  t: ReturnType<typeof useTranslations>,
  locale: string
) {
  const entry = asTooltipEntry(params);
  const item = items[entry.dataIndex] ?? items[0];
  if (!item) return "";
  const lines = [
    `<strong>${escapeHtml(item.key)}</strong>`,
    `${escapeHtml(t("chart.mentions"))}: <b>${escapeHtml(formatNumber(item.value, locale))}</b>`
  ];
  if (item.secondary_value != null) {
    lines.push(
      `${escapeHtml(t("chart.metrics.comments"))}: <b>${escapeHtml(formatNumber(item.secondary_value, locale))}</b>`
    );
  }
  return lines.join("<br/>");
}

function asTooltipEntry(value: unknown) {
  if (!value || typeof value !== "object") return { dataIndex: 0 };
  const dataIndex = Number((value as { dataIndex?: unknown }).dataIndex);
  return { dataIndex: Number.isInteger(dataIndex) ? dataIndex : 0 };
}

function metricLabel(key: string, t: ReturnType<typeof useTranslations>) {
  switch (key) {
    case "root_posts": return t("chart.metrics.root_posts");
    case "comments": return t("chart.metrics.comments");
    case "active_share": return t("chart.metrics.active_share");
    case "interactions_per_active_post": return t("chart.metrics.interactions_per_active_post");
    case "total_interactions": return t("chart.metrics.total_interactions");
    case "p90_interactions": return t("chart.metrics.p90_interactions");
    case "active_root_posts": return t("chart.metrics.active_root_posts");
    default: return prettify(key);
  }
}

function formatMetricValue(key: string, value: number, locale: string) {
  if (key === "active_share" || ![
    "root_posts",
    "comments",
    "interactions_per_active_post",
    "total_interactions",
    "p90_interactions",
    "active_root_posts"
  ].includes(key)) {
    return formatPercent(value, locale);
  }
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: key === "interactions_per_active_post" ? 1 : 0
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function alignValues(values: number[], targetLength: number) {
  if (values.length === targetLength) return values;
  if (values.length > targetLength) return values.slice(values.length - targetLength);
  return [...Array.from({ length: targetLength - values.length }, () => null), ...values];
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyEditorial(
  insight: SignalInsightCarouselItem,
  fallback: {
    shortTitle: string;
    headline: string;
    explanation: string;
    chartAria: string;
  }
) {
  if (
    insight.editorial.state !== "claude"
    || !insight.editorial.short_title
    || !insight.editorial.explanation
  ) {
    return fallback;
  }
  return {
    ...fallback,
    shortTitle: insight.editorial.short_title,
    headline: insight.editorial.headline ?? fallback.headline,
    explanation: insight.editorial.explanation,
    chartAria: insight.editorial.chart_aria ?? fallback.chartAria
  };
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0
  }).format(value);
}

function formatSignedPercent(value: number | null, locale: string) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatPercent(value, locale)}`;
}

function formatSignedPoints(value: number, locale: string) {
  const points = value * 100;
  return `${points > 0 ? "+" : ""}${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1
  }).format(points)}`;
}

function formatShortDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" })
    .format(new Date(`${value}T12:00:00Z`));
}

function formatLongDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatAxisDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" })
    .format(new Date(`${value}T12:00:00Z`));
}

function prettify(value: string) {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}
