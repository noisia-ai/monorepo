"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CaretDown,
  ClockCounterClockwise,
  Database,
  DotsThree,
  FileText,
  Funnel,
  Gauge,
  List,
  ListMagnifyingGlass,
  MagnifyingGlass,
  Megaphone,
  Pulse,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  Target,
  Warning,
  X
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";

import type {
  BrandMonitoringBreakdown,
  BrandMonitoringHighlight,
  BrandMonitoringThreadDriver,
  SignalBrandMonitoringV1
} from "@/lib/signal-v2/brand-monitoring";
import type { SignalWorkspaceOption } from "@/lib/data-os/signal-workspace";
import type { SignalStrategicStudyNavigationItem } from "@/lib/signal-v2/workspace-navigation";
import {
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "@/components/signal-v2/SignalAnalyticsFilter";
import { SignalEChart } from "@/components/signal-v2/SignalEChart";
import { SignalFilterControls } from "@/components/signal-v2/SignalFilterControls";
import {
  SignalMetricHelp as MetricHelp,
  type SignalMetricHelpContent as MetricHelpContent
} from "@/components/signal-v2/SignalMetricHelp";
import {
  SignalV2Mentions,
  type SignalMentionsViewData
} from "@/components/signal-v2/SignalV2Mentions";
import { SignalV2ModuleSkeleton } from "@/components/signal-v2/SignalV2RouteSkeleton";
import { MonthlyInsightCarousel } from "@/components/signal-v2/MonthlyInsightCarousel";

const CHART_BLUE = "#1689f5";
const CHART_BLUE_SOFT = "#8fcef9";
const GRID = "#ebebeb";
const TEXT = "#303030";
const MUTED = "#737373";
const CHART_PURPLE = "#7157d9";
const CHART_TEAL = "#008060";

type ConversationMetric = "mentions" | "conversations" | "root_posts" | "comments";
const CHART_TOOLTIP_STYLE = {
  appendToBody: true,
  confine: false,
  transitionDuration: 0,
  backgroundColor: "#ffffff",
  borderColor: "#d3d3d3",
  borderWidth: 1,
  padding: [9, 10],
  textStyle: {
    color: TEXT,
    fontFamily: "Product Sans, Google Sans, sans-serif",
    fontSize: 12,
    lineHeight: 17
  },
  extraCssText: [
    "border-radius:8px",
    "box-shadow:0 7px 22px rgba(0,0,0,.16)",
    "max-width:290px",
    "white-space:normal"
  ].join(";")
} as const;

export function SignalV2BrandMonitoring({
  activeModule,
  activeStudy,
  brandName,
  canRefreshInsights,
  initialData,
  initialMentions,
  legacyOutputId,
  strategicStudies,
  userName,
  workspaceOptions
}: {
  activeModule: "monitoring" | "mentions";
  activeStudy: SignalStrategicStudyNavigationItem | null;
  brandName: string;
  canRefreshInsights: boolean;
  initialData: SignalBrandMonitoringV1;
  initialMentions: SignalMentionsViewData | null;
  legacyOutputId: string | null;
  strategicStudies: SignalStrategicStudyNavigationItem[];
  userName: string;
  workspaceOptions: SignalWorkspaceOption[];
}) {
  const t = useTranslations("SignalV2");
  const [data, setData] = useState(initialData);
  const [mentionsData, setMentionsData] = useState(initialMentions);
  const [currentModule, setCurrentModule] = useState<"monitoring" | "mentions">(activeModule);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingModule, setPendingModule] = useState<"monitoring" | "mentions" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationMetric, setConversationMetric] = useState<ConversationMetric>("mentions");
  const [insightRunState, setInsightRunState] = useState<
    "idle" | "queued" | "running" | "completed" | "failed"
  >("idle");
  const [insightRunError, setInsightRunError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSidebarOpen(false);
        setWorkspaceMenuOpen(false);
        setControlsOpen(false);
        setScopeOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [searchOpen]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [workspaceMenuOpen]);

  useEffect(() => {
    if (!scopeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!scopeRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [scopeOpen]);

  useEffect(() => {
    setCurrentModule(activeModule);
    setPendingModule(null);
  }, [activeModule, activeStudy]);

  const loadFilter = useCallback(async (selection: SignalAnalyticsFilterSelection) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start: selection.start,
        end: selection.end,
        timezone: data.workspace.timezone,
        granularity: preferredGranularity(selection.start, selection.end),
        compare: selection.comparisonMode
      });
      if (selection.comparisonMode === "custom") {
        if (selection.comparisonStart) params.set("compareStart", selection.comparisonStart);
        if (selection.comparisonEnd) params.set("compareEnd", selection.comparisonEnd);
      }
      const dimensions = selection.dimensions ?? data.filter.dimensions;
      const searchQuery = selection.searchQuery === undefined
        ? data.filter.search_query
        : selection.searchQuery.trim();
      if (searchQuery) params.set("q", searchQuery);
      for (const [dimension, values] of Object.entries(dimensions)) {
        for (const value of values ?? []) params.append(`dimension.${dimension}`, value);
      }
      if (!legacyOutputId) throw new Error(t("errors.noOperationalOutput"));
      const endpoint = currentModule === "mentions" ? "mentions" : "brand-monitoring";
      const response = await fetch(`/api/signal-v2/${legacyOutputId}/${endpoint}?${params}`, {
        cache: "no-store"
      });
      const payload = await response.json() as (
        SignalBrandMonitoringV1 | SignalMentionsViewData
      ) & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("errors.load"));
      if (currentModule === "mentions") {
        const mentions = payload as SignalMentionsViewData;
        setMentionsData(mentions);
        setData((current) => ({
          ...current,
          filter: mentions.filter,
          comparison: mentions.comparison
        }));
      } else {
        setData(payload as SignalBrandMonitoringV1);
      }
      const next = new URL(window.location.href);
      next.search = params.toString();
      window.history.replaceState(null, "", next);
      return true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [currentModule, data.filter.dimensions, data.filter.search_query, data.workspace.timezone, legacyOutputId, t]);

  const navigateToModule = useCallback(async (
    target: "monitoring" | "mentions",
    historyMode: "push" | "none" = "push"
  ) => {
    if (target === currentModule || pendingModule || activeStudy) return;
    setPendingModule(target);
    setSidebarOpen(false);
    setError(null);

    try {
      if (!legacyOutputId) throw new Error(t("errors.noOperationalOutput"));
      const query = new URLSearchParams(window.location.search);
      query.delete("study");
      if (!query.has("start")) query.set("start", data.filter.date_range.start);
      if (!query.has("end")) query.set("end", data.filter.date_range.end);
      if (!query.has("timezone")) query.set("timezone", data.workspace.timezone);
      if (!query.has("granularity")) query.set("granularity", data.filter.granularity);
      if (!query.has("compare")) query.set("compare", data.comparison.mode);
      if (!query.has("q") && data.filter.search_query) {
        query.set("q", data.filter.search_query);
      }
      for (const [dimension, values] of Object.entries(data.filter.dimensions)) {
        if (query.has(`dimension.${dimension}`)) continue;
        for (const value of values ?? []) query.append(`dimension.${dimension}`, value);
      }

      const endpoint = target === "mentions" ? "mentions" : "brand-monitoring";
      const response = await fetch(`/api/signal-v2/${legacyOutputId}/${endpoint}?${query}`, {
        cache: "no-store"
      });
      const payload = await response.json() as (
        SignalBrandMonitoringV1 | SignalMentionsViewData
      ) & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("errors.load"));

      if (target === "mentions") {
        const mentions = payload as SignalMentionsViewData;
        setMentionsData(mentions);
        setData((current) => ({
          ...current,
          filter: mentions.filter,
          comparison: mentions.comparison
        }));
      } else {
        setData(payload as SignalBrandMonitoringV1);
      }

      setCurrentModule(target);
      if (historyMode === "push") {
        const pathname = target === "mentions"
          ? `/signal/${data.workspace.slug}/mentions`
          : `/signal/${data.workspace.slug}`;
        window.history.pushState(null, "", `${pathname}?${query}`);
      }
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : t("errors.load"));
    } finally {
      setPendingModule(null);
    }
  }, [
    activeStudy,
    currentModule,
    data.comparison.mode,
    data.filter,
    data.workspace.slug,
    data.workspace.timezone,
    legacyOutputId,
    pendingModule,
    t
  ]);

  useEffect(() => {
    const onPopState = () => {
      const target = window.location.pathname.endsWith("/mentions")
        ? "mentions"
        : "monitoring";
      void navigateToModule(target, "none");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigateToModule]);

  const goToCorpus = useCallback(() => {
    void navigateToModule("mentions");
  }, [navigateToModule]);

  const reloadCurrentData = useCallback(async () => {
    const query = new URLSearchParams(window.location.search);
    if (!query.has("start")) query.set("start", data.filter.date_range.start);
    if (!query.has("end")) query.set("end", data.filter.date_range.end);
    if (!query.has("timezone")) query.set("timezone", data.workspace.timezone);
    if (!query.has("granularity")) query.set("granularity", data.filter.granularity);
    if (!query.has("compare")) query.set("compare", data.comparison.mode);
    if (!query.has("q") && data.filter.search_query) query.set("q", data.filter.search_query);
    if (data.comparison.mode === "custom" && data.comparison.date_range) {
      if (!query.has("compareStart")) query.set("compareStart", data.comparison.date_range.start);
      if (!query.has("compareEnd")) query.set("compareEnd", data.comparison.date_range.end);
    }
    for (const [dimension, values] of Object.entries(data.filter.dimensions)) {
      if (query.has(`dimension.${dimension}`)) continue;
      for (const value of values ?? []) query.append(`dimension.${dimension}`, value);
    }
    if (!legacyOutputId) throw new Error(t("errors.noOperationalOutput"));
    const response = await fetch(`/api/signal-v2/${legacyOutputId}/brand-monitoring?${query}`, {
      cache: "no-store"
    });
    const payload = await response.json() as SignalBrandMonitoringV1 & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? t("errors.load"));
    setData(payload);
  }, [data.comparison, data.filter, data.workspace.timezone, legacyOutputId, t]);

  const refreshMonthlyInsights = useCallback(async () => {
    setInsightRunError(null);
    setInsightRunState("queued");
    try {
      if (!legacyOutputId) throw new Error(t("errors.noOperationalOutput"));
      const response = await fetch(`/api/signal-v2/${legacyOutputId}/monthly-insights`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget_cap_usd: 2 })
      });
      const payload = await response.json() as {
        message?: string;
        reused?: boolean;
        run?: { status?: string };
      };
      if (!response.ok) throw new Error(payload.message ?? t("monthlyInsights.refresh.error"));
      if (payload.reused || payload.run?.status === "completed") {
        await reloadCurrentData();
        setInsightRunState("completed");
        return;
      }
      setInsightRunState("running");
    } catch (runError) {
      setInsightRunError(
        runError instanceof Error ? runError.message : t("monthlyInsights.refresh.error")
      );
      setInsightRunState("failed");
    }
  }, [legacyOutputId, reloadCurrentData, t]);

  useEffect(() => {
    if (insightRunState !== "queued" && insightRunState !== "running") return;
    const poll = window.setInterval(async () => {
      try {
        if (!legacyOutputId) throw new Error(t("errors.noOperationalOutput"));
        const response = await fetch(`/api/signal-v2/${legacyOutputId}/monthly-insights`, {
          cache: "no-store"
        });
        const payload = await response.json() as {
          run?: { status?: string; error_summary?: { message?: string } };
        };
        const status = payload.run?.status;
        if (status === "completed") {
          window.clearInterval(poll);
          await reloadCurrentData();
          setInsightRunState("completed");
        } else if (status === "failed" || status === "dead_letter") {
          window.clearInterval(poll);
          setInsightRunError(
            payload.run?.error_summary?.message ?? t("monthlyInsights.refresh.error")
          );
          setInsightRunState("failed");
        } else if (status === "running") {
          setInsightRunState("running");
        }
      } catch {
        // A transient polling error should not discard a running worker job.
      }
    }, 2_000);
    return () => window.clearInterval(poll);
  }, [insightRunState, legacyOutputId, reloadCurrentData, t]);

  const comparisonFilter = data.comparison_filter;
  const hasComparison = comparisonFilter != null;
  const currentStructure = data.conversation_structure.summary;
  const previousStructure = data.conversation_structure.previous_summary;
  const currentConversationValue = currentStructure[conversationMetric];
  const previousConversationValue = previousStructure?.[conversationMetric] ?? null;
  const conversationTrend = previousConversationValue == null
    ? null
    : comparisonDelta(currentConversationValue, previousConversationValue);

  const volumeOption = useMemo<EChartsCoreOption>(() => ({
    color: [CHART_BLUE, CHART_BLUE_SOFT],
    tooltip: {
      ...CHART_TOOLTIP_STYLE,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "#b8b8b8", width: 1 } }
    },
    legend: {
      bottom: 2,
      itemGap: 16,
      itemWidth: 8,
      itemHeight: 8,
      icon: "circle",
      textStyle: { color: MUTED, fontFamily: "Product Sans", fontSize: 11 }
    },
    grid: { top: 8, right: 10, bottom: 48, left: 38 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.conversation_structure.points.map((point) => shortDate(point.period_start)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11, hideOverlap: true }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: t("charts.current"),
        type: "line",
        smooth: 0.28,
        showSymbol: false,
        lineStyle: { width: 2, color: CHART_BLUE },
        emphasis: { disabled: true },
        data: data.conversation_structure.points.map((point) => point[conversationMetric])
      },
      ...(hasComparison ? [{
        name: t("charts.previous"),
        type: "line",
        smooth: 0.28,
        showSymbol: false,
        lineStyle: { width: 2, type: "dotted", color: CHART_BLUE_SOFT },
        emphasis: { disabled: true },
        data: alignStructuredPrevious(
          data.conversation_structure.previous_points,
          data.conversation_structure.points.length,
          conversationMetric
        )
      }] : [])
    ]
  }), [
    conversationMetric,
    data.conversation_structure.points,
    data.conversation_structure.previous_points,
    hasComparison,
    t
  ]);

  const platformOption = useMemo<EChartsCoreOption>(() => {
    const allBuckets = [...data.platforms.buckets].sort(
      (a, b) => b.sample_size - a.sample_size
    );
    const total = allBuckets.reduce((sum, bucket) => sum + bucket.sample_size, 0);
    const buckets = allBuckets.slice(0, 7).reverse();
    return {
      color: [CHART_BLUE],
      tooltip: {
        ...CHART_TOOLTIP_STYLE,
        trigger: "item",
        formatter: (params: unknown) => platformTooltip(params, buckets, total, t)
      },
      grid: { top: 6, right: 20, bottom: 8, left: 82 },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      yAxis: {
        type: "category",
        data: buckets.map((bucket) => prettify(bucket.label)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: TEXT, fontFamily: "Product Sans", fontSize: 12, width: 72, overflow: "truncate" }
      },
      series: [{
        type: "bar",
        barWidth: 10,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: buckets.map((bucket) => bucket.sample_size)
      }]
    };
  }, [data.platforms.buckets, t]);

  const compositionOption = useMemo<EChartsCoreOption>(() => ({
    color: [CHART_PURPLE, CHART_BLUE_SOFT],
    tooltip: {
      ...CHART_TOOLTIP_STYLE,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "#b8b8b8", width: 1 } }
    },
    legend: {
      bottom: 2,
      itemGap: 16,
      itemWidth: 8,
      itemHeight: 8,
      icon: "circle",
      textStyle: { color: MUTED, fontFamily: "Product Sans", fontSize: 11 }
    },
    grid: { top: 12, right: 10, bottom: 48, left: 38 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.conversation_structure.points.map((point) => shortDate(point.period_start)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11, hideOverlap: true }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: t("cards.composition.roots"),
        type: "line",
        stack: "conversation",
        smooth: 0.18,
        showSymbol: false,
        lineStyle: { width: 1.5, color: CHART_PURPLE },
        areaStyle: { color: CHART_PURPLE, opacity: 0.74 },
        emphasis: { disabled: true },
        data: data.conversation_structure.points.map((point) => point.root_posts)
      },
      {
        name: t("cards.composition.comments"),
        type: "line",
        stack: "conversation",
        smooth: 0.18,
        showSymbol: false,
        lineStyle: { width: 1.5, color: CHART_BLUE_SOFT },
        areaStyle: { color: CHART_BLUE_SOFT, opacity: 0.72 },
        emphasis: { disabled: true },
        data: data.conversation_structure.points.map((point) => point.comments)
      }
    ]
  }), [data.conversation_structure.points, t]);

  const sentimentTrendOption = useMemo<EChartsCoreOption>(() => ({
    color: [CHART_TEAL],
    tooltip: {
      ...CHART_TOOLTIP_STYLE,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "#b8b8b8", width: 1 } },
      valueFormatter: (value: unknown) => `${formatNumber(Number(value))} pp`
    },
    grid: { top: 12, right: 12, bottom: 30, left: 42 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.conversation_structure.points.map((point) => shortDate(point.period_start)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11, hideOverlap: true }
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans",
        fontSize: 11,
        formatter: (value: number) => `${value}%`
      },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      name: t("cards.sentimentTrend.net"),
      type: "line",
      smooth: 0.22,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2, color: CHART_TEAL },
      areaStyle: { color: CHART_TEAL, opacity: 0.08 },
      data: data.conversation_structure.points.map((point) => {
        if (point.sentiment.classified === 0) return null;
        return Math.round(
          ((point.sentiment.positive - point.sentiment.negative) / point.sentiment.classified) * 1000
        ) / 10;
      })
    }]
  }), [data.conversation_structure.points, t]);

  const driverOption = useMemo<EChartsCoreOption>(() => {
    const items = [...data.conversation_drivers.items].slice(0, 5).reverse();
    return {
      color: [CHART_BLUE],
      tooltip: {
        ...CHART_TOOLTIP_STYLE,
        trigger: "item",
        formatter: (params: unknown) => driverTooltip(params, items, t)
      },
      grid: { top: 6, right: 24, bottom: 10, left: 108 },
      xAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { color: MUTED, fontFamily: "Product Sans", fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      yAxis: {
        type: "category",
        data: items.map((item) => driverLabel(item)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: TEXT,
          fontFamily: "Product Sans",
          fontSize: 11,
          width: 98,
          overflow: "truncate"
        }
      },
      series: [{
        type: "bar",
        barWidth: 12,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          color: MUTED,
          fontFamily: "Product Sans",
          fontSize: 11
        },
        data: items.map((item) => item.mention_count)
      }]
    };
  }, [data.conversation_drivers.items, t]);

  const canonicalHome = `/signal/${data.workspace.slug}`;
  const canonicalMentions = `${canonicalHome}/mentions`;
  const legacyReport = legacyOutputId ? `/signal/${legacyOutputId}` : canonicalHome;
  const firstStrategicStudy = strategicStudies[0] ?? null;
  const activeGlobalFilterCount = Object.values(data.filter.dimensions)
    .reduce((total, values) => total + (values?.length ?? 0), 0)
    + Number(Boolean(data.filter.search_query));

  return (
    <div className={[
      "signal-v2-shell",
      sidebarOpen ? "signal-v2-shell--nav-open" : "",
      controlsOpen ? "signal-v2-shell--controls-open" : ""
    ].filter(Boolean).join(" ")}>
      <a className="signal-v2-skip" href="#signal-v2-content">{t("a11y.skip")}</a>

      <header className="signal-v2-topbar">
        <button
          aria-controls="signal-v2-sidebar"
          aria-expanded={sidebarOpen}
          aria-label={t("nav.open")}
          className="signal-v2-topbar__mobile-menu"
          onClick={() => setSidebarOpen((open) => !open)}
          type="button"
        >
          <List size={19} weight="bold" />
        </button>
        <Link className="signal-v2-brand" href={canonicalHome} prefetch={false}>
          <Image alt="Noisia" height={23} priority src="/assets/logos/logo_black.svg" width={79} />
          <span>Signal</span>
        </Link>
        <button
          className="signal-v2-search-trigger"
          onClick={() => setSearchOpen(true)}
          type="button"
        >
          <MagnifyingGlass size={16} />
          <span>{t("search.placeholder")}</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="signal-v2-topbar__actions">
          <button aria-label={t("actions.notifications")} className="signal-v2-icon-button" type="button">
            <Bell size={17} />
          </button>
          <div className="signal-v2-account">
            <span>{initials(userName)}</span>
            <strong>{brandName}</strong>
          </div>
        </div>
      </header>

      <aside className="signal-v2-sidebar" aria-label={t("nav.label")} id="signal-v2-sidebar">
        <div className="signal-v2-workspace-picker" ref={workspaceMenuRef}>
          <button
            aria-expanded={workspaceMenuOpen}
            aria-haspopup="menu"
            className="signal-v2-sidebar__workspace"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            type="button"
          >
            <span>{initials(brandName)}</span>
            <div>
              <strong>{brandName}</strong>
              <small>{t("nav.workspace")}</small>
            </div>
            <CaretDown className={workspaceMenuOpen ? "signal-v2-caret--open" : ""} size={14} />
          </button>
          {workspaceMenuOpen ? (
            <div className="signal-v2-workspace-menu" role="menu">
              <small>{t("workspaceSwitcher.title")}</small>
              {workspaceOptions.map((workspace) => (
                <Link
                  aria-current={workspace.id === data.workspace.id ? "page" : undefined}
                  href={`/signal/${workspace.slug}`}
                  key={workspace.id}
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    setSidebarOpen(false);
                  }}
                  prefetch={false}
                  role="menuitem"
                >
                  <span>{initials(workspace.name)}</span>
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.subjectType === "brand"
                      ? t("workspaceSwitcher.brand")
                      : t("workspaceSwitcher.theme")}</small>
                  </span>
                  {workspace.id === data.workspace.id ? <span>✓</span> : null}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <nav className="signal-v2-nav">
          <NavLink
            active={(pendingModule ?? currentModule) === "monitoring" && !activeStudy}
            href={canonicalHome}
            icon={<Gauge />}
            label={t("nav.monitoring")}
            onNavigate={() => void navigateToModule("monitoring")}
          />
          <NavLink
            active={(pendingModule ?? currentModule) === "mentions"}
            href={canonicalMentions}
            icon={<ListMagnifyingGlass />}
            label={t("nav.mentions")}
            onNavigate={() => void navigateToModule("mentions")}
          />
          <NavLink href={`${legacyReport}#emerging-patterns`} icon={<Pulse />} label={t("nav.topics")} />
          <NavLink
            active={Boolean(activeStudy)}
            href={firstStrategicStudy?.href ?? `${legacyReport}#tb-decision-field`}
            icon={<Target />}
            label={t("nav.tb")}
          />
          {strategicStudies.length > 0 ? (
            <div aria-label={t("nav.tbStudies")} className="signal-v2-nav__studies">
              {strategicStudies.map((study) => (
                <Link
                  aria-current={activeStudy?.id === study.id ? "page" : undefined}
                  className={activeStudy?.id === study.id ? "signal-v2-nav__study--active" : undefined}
                  href={study.href}
                  key={study.id}
                  prefetch={false}
                  title={study.title}
                >
                  <span />
                  {study.title}
                </Link>
              ))}
            </div>
          ) : null}
          <NavLink href={`${legacyReport}#opportunities`} icon={<Sparkle />} label={t("nav.opportunities")} />
          <NavLink href={`${legacyReport}#evidence`} icon={<Database />} label={t("nav.evidence")} />
          <div className="signal-v2-nav__section">{t("nav.reports")}</div>
          <NavLink href={firstStrategicStudy?.href ?? legacyReport} icon={<FileText />} label={t("nav.strategic")} />
          <NavLink href={`${legacyReport}#historical-overview`} icon={<ClockCounterClockwise />} label={t("nav.history")} />
        </nav>
        <div className="signal-v2-sidebar__footer">
          <NavLink href={`${legacyReport}#settings`} icon={<SlidersHorizontal />} label={t("nav.settings")} />
        </div>
      </aside>
      <button
        aria-hidden={!sidebarOpen}
        aria-label={t("nav.close")}
        className="signal-v2-nav-scrim"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen ? 0 : -1}
        type="button"
      />

      <main
        aria-busy={loading}
        className={`signal-v2-main${loading ? " signal-v2-main--loading" : ""}`}
        id="signal-v2-content"
      >
        {pendingModule ? (
          <SignalV2ModuleSkeleton variant={pendingModule} />
        ) : activeStudy ? (
          <StrategicStudyContent canonicalHome={canonicalHome} study={activeStudy} />
        ) : currentModule === "mentions" && mentionsData ? (
          <SignalV2Mentions
            brandName={brandName}
            coverage={data.coverage}
            data={mentionsData}
            loading={loading}
            onApplyFilter={loadFilter}
            onDataChange={setMentionsData}
            onOpenControls={() => setControlsOpen(true)}
            outputId={legacyOutputId}
          />
        ) : (
          <>
        <div className="signal-v2-page-head">
          <div>
            <div className="signal-v2-title-line">
              <Megaphone size={20} weight="fill" />
              <h1>{t("title")}</h1>
              <span>{t("status.beta")}</span>
            </div>
            <p>{t("subtitle")}</p>
          </div>
          <button className="signal-v2-tertiary-button" type="button">
            <DotsThree size={18} weight="bold" />
          </button>
        </div>

        <div className="signal-v2-filterbar">
          <SignalAnalyticsFilter
            comparison={data.comparison}
            coverage={data.coverage}
            filter={data.filter}
            loading={loading}
            onApply={loadFilter}
          />

          <div className="signal-v2-filter-anchor" ref={scopeRef}>
            <button
              aria-expanded={scopeOpen}
              className={`signal-v2-filter${scopeOpen ? " signal-v2-filter--active" : ""}`}
              onClick={() => setScopeOpen((open) => !open)}
              type="button"
            >
              <Database size={15} />
              {t("filters.dataScope", { brand: brandName })}
              <CaretDown size={13} />
            </button>
            {scopeOpen ? (
              <div className="signal-v2-scope-popover" role="dialog">
                <small>{t("dataScope.eyebrow")}</small>
                <strong>{brandName}</strong>
                <p>{t("dataScope.body")}</p>
                <dl>
                  <div>
                    <dt>{t("dataScope.mentions")}</dt>
                    <dd>{formatNumber(data.coverage.mentions)}</dd>
                  </div>
                  <div>
                    <dt>{t("dataScope.coverage")}</dt>
                    <dd>{formatDate(data.coverage.date_from)} – {formatDate(data.coverage.date_through)}</dd>
                  </div>
                </dl>
                <button onClick={goToCorpus} type="button">
                  {t("dataScope.open")}
                  <ArrowRight size={14} />
                </button>
              </div>
            ) : null}
          </div>
          <button
            aria-expanded={controlsOpen}
            className={`signal-v2-filter${controlsOpen ? " signal-v2-filter--active" : ""}`}
            onClick={() => setControlsOpen((open) => !open)}
            type="button"
          >
            <Funnel size={15} />
            {t("filters.more")}
            {activeGlobalFilterCount > 0 ? (
              <span className="signal-v2-filter__count">{activeGlobalFilterCount}</span>
            ) : null}
          </button>
          {canRefreshInsights ? (
            <button
              className="signal-v2-filter signal-v2-filter--insights"
              disabled={insightRunState === "queued" || insightRunState === "running"}
              onClick={refreshMonthlyInsights}
              title={t("monthlyInsights.refresh.help")}
              type="button"
            >
              {insightRunState === "queued" || insightRunState === "running"
                ? <SpinnerGap className="signal-v2-spin" size={15} />
                : <Sparkle size={15} weight="fill" />}
              {insightRunState === "queued"
                ? t("monthlyInsights.refresh.queued")
                : insightRunState === "running"
                  ? t("monthlyInsights.refresh.running")
                  : insightRunState === "completed"
                    ? t("monthlyInsights.refresh.updated")
                    : t("monthlyInsights.refresh.action")}
            </button>
          ) : null}
          <span className={`signal-v2-freshness signal-v2-freshness--${data.freshness.state}`}>
            <span />
            {freshnessLabel(data.freshness.state, t)}
          </span>
        </div>

        {error ? (
          <div className="signal-v2-error" role="alert">
            <Warning size={18} />
            <span>{error}</span>
            <button onClick={() => setError(null)} type="button"><X size={15} /></button>
          </div>
        ) : null}
        {insightRunError ? (
          <div className="signal-v2-error" role="alert">
            <Warning size={18} />
            <span>{insightRunError}</span>
            <button onClick={() => setInsightRunError(null)} type="button"><X size={15} /></button>
          </div>
        ) : null}

        <MonthlyInsightCarousel
          insights={data.monthly_insights}
          onOpenEvidence={goToCorpus}
        />

        <div
          aria-busy={loading}
          className={`signal-v2-dashboard-stage${loading ? " signal-v2-dashboard-stage--loading" : ""}`}
        >
          {loading ? <DashboardLoadingState label={t("actions.loading")} /> : null}

          <ConversationKpis
            current={data.conversation_structure.summary}
            hasComparison={hasComparison}
            previous={data.conversation_structure.previous_summary}
          />

          <section className="signal-v2-grid" aria-label={t("sections.metrics")}>
          <MetricCard
            className="signal-v2-card--wide"
            dataState={data.conversation_structure.state}
            eyebrow={t("cards.volume.eyebrow")}
            headingAction={(
              <ConversationMetricSwitch
                onChange={setConversationMetric}
                value={conversationMetric}
              />
            )}
            help={translatedHelp(t, "cards.volume.help")}
            metric={currentConversationValue}
            title={t("cards.volume.titleByUnit", {
              unit: t(`cards.volume.units.${conversationMetric}`)
            })}
            trend={conversationTrend}
          >
            {data.conversation_structure.points.length > 0 ? (
              <SignalEChart
                ariaLabel={hasComparison
                  ? t("cards.volume.aria")
                  : t("cards.volume.ariaNoComparison")}
                onActivate={goToCorpus}
                option={volumeOption}
              />
            ) : (
              <EmptyMetric message={metricEmptyMessage(data.volume.state, t)} />
            )}
          </MetricCard>

            <MetricCard
              dataState={data.sentiment.state}
              eyebrow={t("cards.sentiment.eyebrow")}
              help={translatedHelp(t, "cards.sentiment.help")}
              title={t("cards.sentiment.title")}
            >
              {data.sentiment.buckets.length > 0 ? (
                <SentimentDonut
                  buckets={data.sentiment.buckets}
                  hasComparison={hasComparison}
                  previousBuckets={data.sentiment.previous_buckets}
                />
              ) : (
                <EmptyMetric message={metricEmptyMessage(data.sentiment.state, t)} />
              )}
              <p className="signal-v2-card__coverage-note">
                {t("cards.sentiment.coverage", {
                  classified: formatNumber(data.conversation_structure.summary.classified_sentiment),
                  total: formatNumber(data.conversation_structure.summary.mentions)
                })}
              </p>
            </MetricCard>

          <MetricCard
            className="signal-v2-card--wide"
            dataState={data.conversation_structure.state}
            eyebrow={t("cards.composition.eyebrow")}
            help={translatedHelp(t, "cards.composition.help")}
            title={t("cards.composition.title")}
          >
            {data.conversation_structure.points.length > 0 ? (
              <SignalEChart
                ariaLabel={t("cards.composition.aria")}
                onActivate={goToCorpus}
                option={compositionOption}
              />
            ) : (
              <EmptyMetric message={metricEmptyMessage(data.conversation_structure.state, t)} />
            )}
          </MetricCard>

          <MetricCard
            dataState={data.conversation_structure.state}
            eyebrow={t("cards.sentimentTrend.eyebrow")}
            help={{
              ...translatedHelp(t, "cards.sentimentTrend.help"),
              formula: t("cards.sentimentTrend.help.formula")
            }}
            title={t("cards.sentimentTrend.title")}
          >
            {data.conversation_structure.points.some((point) => point.sentiment.classified > 0) ? (
              <SignalEChart
                ariaLabel={t("cards.sentimentTrend.aria")}
                onActivate={goToCorpus}
                option={sentimentTrendOption}
              />
            ) : (
              <EmptyMetric message={metricEmptyMessage(data.conversation_structure.state, t)} />
            )}
          </MetricCard>

          <MetricCard
            dataState={data.platforms.state}
            eyebrow={t("cards.platforms.eyebrow")}
            help={translatedHelp(t, "cards.platforms.help")}
            title={t("cards.platforms.title")}
          >
            {data.platforms.buckets.length > 0 ? (
              <SignalEChart
                ariaLabel={t("cards.platforms.aria")}
                onActivate={goToCorpus}
                option={platformOption}
              />
            ) : (
              <EmptyMetric message={metricEmptyMessage(data.platforms.state, t)} />
            )}
          </MetricCard>

          <article className="signal-v2-card signal-v2-engagement-card">
            <CardHeading
              dataState={data.attention.state}
              eyebrow={t("cards.attention.eyebrow")}
              help={translatedHelp(t, "cards.attention.help")}
              title={t("cards.attention.title")}
            />
            <div className="signal-v2-attention-metrics">
              <div>
                <small>{t("cards.attention.totalInteractions")}</small>
                <strong>{formatCompact(data.attention.total_interactions)}</strong>
                <AttentionComparison
                  current={data.attention.total_interactions}
                  hasComparison={hasComparison}
                  previous={data.attention.previous?.total_interactions ?? null}
                />
              </div>
              <div>
                <small>{t("cards.attention.median")}</small>
                <strong>{formatCompact(data.attention.median_interactions)}</strong>
                <AttentionComparison
                  current={data.attention.median_interactions}
                  hasComparison={hasComparison}
                  previous={data.attention.previous?.median_interactions ?? null}
                />
              </div>
              <div>
                <small>{t("cards.attention.p90")}</small>
                <strong>{formatCompact(data.attention.p90_interactions)}</strong>
                <AttentionComparison
                  current={data.attention.p90_interactions}
                  hasComparison={hasComparison}
                  previous={data.attention.previous?.p90_interactions ?? null}
                />
              </div>
              <div>
                <small>{t("cards.attention.active")}</small>
                <strong>{formatPercent(data.attention.active_ratio)}</strong>
                <AttentionComparison
                  current={data.attention.active_ratio}
                  hasComparison={hasComparison}
                  mode="points"
                  previous={data.attention.previous?.active_ratio ?? null}
                />
              </div>
              <div>
                <small>{t("cards.attention.views")}</small>
                <strong>{formatCompact(data.attention.total_views)}</strong>
                <AttentionComparison
                  current={data.attention.total_views}
                  hasComparison={hasComparison}
                  previous={data.attention.previous?.total_views ?? null}
                />
              </div>
              <div>
                <small>{t("cards.attention.viewedPosts")}</small>
                <strong>
                  {formatNumber(data.attention.viewed_root_posts)}
                  <span> / {formatNumber(data.attention.root_posts)}</span>
                </strong>
                <CoverageIndicator
                  measured={data.attention.viewed_root_posts}
                  total={data.attention.root_posts}
                />
              </div>
            </div>
            <p>{t("cards.attention.note", { count: formatNumber(data.attention.root_posts) })}</p>
            <button onClick={goToCorpus} type="button">{t("actions.openMentions")}<ArrowRight size={14} /></button>
          </article>

          {data.emotions.buckets.length > 0 ? <article className="signal-v2-card">
            <CardHeading
              dataState={data.emotions.state}
              eyebrow={t("cards.emotions.eyebrow")}
              help={translatedHelp(t, "cards.emotions.help")}
              title={t("cards.emotions.title")}
            />
            {data.emotions.buckets.length > 0 ? (
              <DistributionBars buckets={data.emotions} />
            ) : (
              <EmptyMetric message={metricEmptyMessage(data.emotions.state, t)} />
            )}
          </article> : null}

          {mergeTopicBuckets(data.topics, data.narratives).length > 0 ? (
          <article className="signal-v2-card signal-v2-card--wide signal-v2-topics-card">
            <CardHeading
              dataState={worstBreakdownState(data.topics.state, data.narratives.state)}
              eyebrow={t("cards.topics.eyebrow")}
              help={translatedHelp(t, "cards.topics.help")}
              title={t("cards.topics.title")}
            />
            <TopicTable topics={mergeTopicBuckets(data.topics, data.narratives)} />
          </article>
          ) : null}

          <MetricCard
            className="signal-v2-drivers-card"
            dataState={data.conversation_drivers.state}
            eyebrow={t("cards.drivers.eyebrow")}
            help={translatedHelp(t, "cards.drivers.help")}
            title={t("cards.drivers.title")}
          >
            {data.conversation_drivers.items.length > 0 ? (
              <SignalEChart
                ariaLabel={t("cards.drivers.aria")}
                onActivate={goToCorpus}
                option={driverOption}
              />
            ) : (
              <EmptyMetric message={metricEmptyMessage(data.conversation_drivers.state, t)} />
            )}
          </MetricCard>

          <article className="signal-v2-card signal-v2-card--full signal-v2-conversations">
            <CardHeading
              dataState="fresh"
              eyebrow={t("cards.conversations.eyebrow")}
              help={translatedHelp(t, "cards.conversations.help")}
              title={t("cards.conversations.title")}
            />
            <div className="signal-v2-conversation-columns">
              <ConversationColumn
                empty={t("cards.conversations.emptyPositive")}
                items={data.highlights.positive}
                label={t("cards.conversations.positive")}
                tone="positive"
              />
              <ConversationColumn
                empty={t("cards.conversations.emptyNegative")}
                items={data.highlights.negative}
                label={t("cards.conversations.negative")}
                tone="negative"
              />
            </div>
          </article>
          </section>

          <footer className="signal-v2-data-footer">
            <Database size={17} />
            <p>
              <strong>{t("coverage.title")}</strong>
              {t("coverage.body", {
                count: formatNumber(data.coverage.mentions),
                start: formatDate(data.coverage.date_from),
                end: formatDate(data.coverage.date_through)
              })}
            </p>
            <button onClick={goToCorpus} type="button">{t("coverage.open")}</button>
          </footer>
        </div>
          </>
        )}
      </main>

      <SignalFilterControls
        comparison={data.comparison}
        filter={data.filter}
        loading={loading}
        onApply={loadFilter}
        onClose={() => setControlsOpen(false)}
        open={controlsOpen}
        outputId={legacyOutputId}
      />

      {searchOpen ? (
        <div className="signal-v2-command-layer" role="presentation">
          <button aria-label={t("search.close")} className="signal-v2-command-scrim" onClick={() => setSearchOpen(false)} type="button" />
          <div aria-label={t("search.label")} aria-modal="true" className="signal-v2-command" role="dialog">
            <div className="signal-v2-command__input">
              <MagnifyingGlass size={19} />
              <input placeholder={t("search.placeholder")} ref={searchRef} />
              <kbd>Esc</kbd>
            </div>
            <div className="signal-v2-command__scope">
              <span>{t("search.quick")}</span>
              <Link href={canonicalMentions} onClick={() => setSearchOpen(false)} prefetch={false}>
                <ListMagnifyingGlass size={16} />{t("nav.mentions")}
              </Link>
              <Link href={firstStrategicStudy?.href ?? `${legacyReport}#tb-decision-field`} onClick={() => setSearchOpen(false)} prefetch={false}>
                <Target size={16} />{t("nav.tb")}
              </Link>
              <Link href={`${legacyReport}#opportunities`} onClick={() => setSearchOpen(false)} prefetch={false}>
                <Sparkle size={16} />{t("nav.opportunities")}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StrategicStudyContent({
  canonicalHome,
  study
}: {
  canonicalHome: string;
  study: SignalStrategicStudyNavigationItem;
}) {
  const t = useTranslations("SignalV2");
  const release = study.currentRelease;
  const movementEntries = release
    ? Object.entries(release.movement_counts)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
    : [];

  return (
    <div className="signal-v2-strategic-page">
      <div className="signal-v2-page-head">
        <div>
          <div className="signal-v2-title-line">
            <Target size={20} weight="fill" />
            <h1>{study.title}</h1>
            <span>{t("strategicStudy.status")}</span>
          </div>
          <p>{t("strategicStudy.subtitle")}</p>
        </div>
        <Link className="signal-v2-secondary-link" href={canonicalHome} prefetch={false}>
          {t("strategicStudy.backToMonitoring")}
        </Link>
      </div>

      {release ? (
        <>
          <section className="signal-v2-strategic-hero">
            <div>
              <small>{t("strategicStudy.currentRelease")}</small>
              <h2>{release.title}</h2>
              <p>
                {t("strategicStudy.period", {
                  start: formatDate(release.period_start),
                  end: formatDate(release.period_end)
                })}
              </p>
            </div>
            <div className="signal-v2-strategic-hero__metrics">
              <div>
                <strong>{formatNumber(release.artifact_count)}</strong>
                <span>{t("strategicStudy.artifacts")}</span>
              </div>
              <div>
                <strong>{formatNumber(release.temporal_metric_count)}</strong>
                <span>{t("strategicStudy.temporalMetrics")}</span>
              </div>
              <div>
                <strong>{formatNumber(release.corpus_revision)}</strong>
                <span>{t("strategicStudy.corpusRevision")}</span>
              </div>
            </div>
          </section>

          <section className="signal-v2-strategic-grid">
            <article className="signal-v2-strategic-card">
              <div className="signal-v2-strategic-card__heading">
                <div>
                  <small>{t("strategicStudy.analysisContents")}</small>
                  <h2>{t("strategicStudy.reviewedArtifacts")}</h2>
                </div>
                <span>{prettify(release.status)}</span>
              </div>
              {release.artifacts.length > 0 ? (
                <ul className="signal-v2-strategic-artifacts">
                  {release.artifacts.map((artifact) => (
                    <li key={`${artifact.artifact_id}:${artifact.artifact_revision}`}>
                      <FileText size={16} />
                      <div>
                        <strong>{artifact.title ?? prettify(artifact.artifact_type)}</strong>
                        {artifact.summary ? <p>{artifact.summary}</p> : null}
                      </div>
                      <span>{prettify(artifact.review_status)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="signal-v2-strategic-empty">{t("strategicStudy.noClientArtifacts")}</p>
              )}
            </article>

            <aside className="signal-v2-strategic-card">
              <div className="signal-v2-strategic-card__heading">
                <div>
                  <small>{t("strategicStudy.temporalReading")}</small>
                  <h2>{t("strategicStudy.movements")}</h2>
                </div>
              </div>
              {movementEntries.length > 0 ? (
                <dl className="signal-v2-strategic-movements">
                  {movementEntries.map(([movement, count]) => (
                    <div key={movement}>
                      <dt>{prettify(movement)}</dt>
                      <dd>{formatNumber(count)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="signal-v2-strategic-empty">{t("strategicStudy.noComparison")}</p>
              )}
              {study.legacyOutputId ? (
                <Link
                  className="signal-v2-primary-link"
                  href={`/signal/${study.legacyOutputId}#tb-decision-field`}
                  prefetch={false}
                >
                  {t("strategicStudy.openCurrentView")} <ArrowRight size={14} />
                </Link>
              ) : null}
            </aside>
          </section>
        </>
      ) : (
        <section className="signal-v2-strategic-empty-state">
          <Target size={28} />
          <div>
            <small>{t("strategicStudy.linkedStudy")}</small>
            <h2>{t("strategicStudy.pendingTitle")}</h2>
            <p>{t("strategicStudy.pendingBody")}</p>
          </div>
          {study.legacyOutputId ? (
            <Link
              className="signal-v2-primary-link"
              href={`/signal/${study.legacyOutputId}#tb-decision-field`}
              prefetch={false}
            >
              {t("strategicStudy.openCurrentView")} <ArrowRight size={14} />
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}

function NavLink({
  active = false,
  href,
  icon,
  label,
  onNavigate
}: {
  active?: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`signal-v2-nav__item${active ? " signal-v2-nav__item--active" : ""}`}
      href={href}
      onClick={(event) => {
        if (!onNavigate || active) return;
        if (
          event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
        ) return;
        event.preventDefault();
        onNavigate();
      }}
      prefetch={false}
    >
      <span>{icon}</span>
      {label}
    </Link>
  );
}

function ConversationKpis({
  current,
  hasComparison,
  previous
}: {
  current: SignalBrandMonitoringV1["conversation_structure"]["summary"];
  hasComparison: boolean;
  previous: SignalBrandMonitoringV1["conversation_structure"]["previous_summary"];
}) {
  const t = useTranslations("SignalV2");
  const items: Array<{
    key: ConversationMetric;
    value: number;
    previousValue: number | null;
  }> = [
    { key: "mentions", value: current.mentions, previousValue: previous?.mentions ?? null },
    { key: "conversations", value: current.conversations, previousValue: previous?.conversations ?? null },
    { key: "root_posts", value: current.root_posts, previousValue: previous?.root_posts ?? null },
    { key: "comments", value: current.comments, previousValue: previous?.comments ?? null }
  ];
  return (
    <section aria-label={t("kpis.label")} className="signal-v2-kpi-strip">
      {items.map((item) => {
        const change = item.previousValue == null
          ? null
          : comparisonDelta(item.value, item.previousValue);
        return (
          <article key={item.key}>
            <span className="signal-v2-kpi-strip__label">
              <MetricHelp
                content={translatedHelp(t, `kpis.help.${item.key}`)}
                label={t(`kpis.${item.key}`)}
              />
            </span>
            <strong>{formatNumber(item.value)}</strong>
            <small className={change == null || change === 0
              ? undefined
              : change > 0
                ? "signal-v2-trend--up"
                : "signal-v2-trend--down"}
            >
              {hasComparison ? formatDelta(change) : t("cards.sentiment.noComparison")}
            </small>
          </article>
        );
      })}
    </section>
  );
}

function ConversationMetricSwitch({
  onChange,
  value
}: {
  onChange: (value: ConversationMetric) => void;
  value: ConversationMetric;
}) {
  const t = useTranslations("SignalV2");
  const options: ConversationMetric[] = ["mentions", "conversations", "root_posts", "comments"];
  return (
    <div aria-label={t("cards.volume.selector")} className="signal-v2-metric-switch" role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {t(`cards.volume.units.${option}`)}
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  children,
  className = "",
  dataState,
  eyebrow,
  headingAction,
  help,
  metric,
  title,
  trend
}: {
  children: React.ReactNode;
  className?: string;
  dataState: string;
  eyebrow: string;
  headingAction?: React.ReactNode;
  help?: MetricHelpContent;
  metric?: number | null;
  title: string;
  trend?: number | null;
}) {
  return (
    <article className={`signal-v2-card ${className}`}>
      <CardHeading
        action={headingAction}
        dataState={dataState}
        eyebrow={eyebrow}
        help={help}
        title={title}
      />
      {metric != null ? (
        <div className="signal-v2-card__metric">
          <strong>{formatNumber(metric)}</strong>
          {trend != null ? (
            <span className={trend >= 0 ? "signal-v2-trend--up" : "signal-v2-trend--down"}>
              {trend >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
              {formatDelta(trend)}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

function CardHeading({
  action,
  dataState,
  eyebrow,
  help,
  title
}: {
  action?: React.ReactNode;
  dataState: string;
  eyebrow: string;
  help?: MetricHelpContent;
  title: string;
}) {
  const t = useTranslations("SignalV2");
  return (
    <header className={`signal-v2-card__heading${action ? " signal-v2-card__heading--with-action" : ""}`}>
      <div>
        <small>{eyebrow}</small>
        <h2>
          {help ? <MetricHelp content={help} label={title} /> : title}
        </h2>
      </div>
      <div className="signal-v2-card__heading-actions">
        {action}
        <span className={`signal-v2-state signal-v2-state--${dataState}`}>
          {stateShortLabel(dataState, t)}
        </span>
      </div>
    </header>
  );
}

function AttentionComparison({
  current,
  hasComparison,
  mode = "ratio",
  previous
}: {
  current: number | null;
  hasComparison: boolean;
  mode?: "points" | "ratio";
  previous: number | null;
}) {
  const t = useTranslations("SignalV2");
  if (!hasComparison || current == null || previous == null) {
    return <em className="signal-v2-attention-indicator signal-v2-attention-indicator--neutral">—</em>;
  }
  const delta = mode === "points"
    ? current - previous
    : comparisonDelta(current, previous);
  if (delta == null) {
    return (
      <em className="signal-v2-attention-indicator signal-v2-attention-indicator--neutral">
        {t("cards.attention.noComparableBaseline")}
      </em>
    );
  }
  const tone = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  return (
    <em className={`signal-v2-attention-indicator signal-v2-attention-indicator--${tone}`}>
      {delta > 0 ? <ArrowUpRight aria-hidden /> : delta < 0 ? <ArrowDownRight aria-hidden /> : null}
      <span>
        {mode === "points" ? formatPointDelta(delta) : formatDelta(delta)}
        {" "}
        {t("cards.attention.vsPrevious")}
      </span>
    </em>
  );
}

function CoverageIndicator({ measured, total }: { measured: number; total: number }) {
  const t = useTranslations("SignalV2");
  const ratio = total > 0 ? measured / total : null;
  const tone = ratio == null
    ? "neutral"
    : ratio === 1
      ? "up"
      : ratio > 0
        ? "caution"
        : "down";
  return (
    <em className={`signal-v2-attention-indicator signal-v2-attention-indicator--${tone}`}>
      {ratio == null
        ? "—"
        : t("cards.attention.coverage", { value: formatPercent(ratio) })}
    </em>
  );
}

function EmptyMetric({ message }: { message: string }) {
  return (
    <div className="signal-v2-empty">
      <Pulse size={22} />
      <p>{message}</p>
    </div>
  );
}

function DashboardLoadingState({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="signal-v2-loading-status" role="status">
      {label}
    </span>
  );
}

function SentimentDonut({
  buckets,
  hasComparison,
  previousBuckets
}: {
  buckets: BrandMonitoringBreakdown["buckets"];
  hasComparison: boolean;
  previousBuckets: BrandMonitoringBreakdown["buckets"];
}) {
  const t = useTranslations("SignalV2");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const items = useMemo(() => {
    const currentByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    const previousByKey = new Map(previousBuckets.map((bucket) => [bucket.key, bucket]));
    const keys = Array.from(new Set([
      ...buckets.map((bucket) => bucket.key),
      ...previousBuckets.map((bucket) => bucket.key)
    ]));
    return keys.map((key) => {
      const current = currentByKey.get(key);
      const previous = previousByKey.get(key);
      const count = current?.sample_size ?? 0;
      const previousCount = previous?.sample_size ?? 0;
      return {
        key,
        label: sentimentLabel(key, t),
        count,
        previousCount,
        delta: comparisonDelta(count, previousCount),
        color: sentimentColor(key)
      };
    });
  }, [buckets, previousBuckets, t]);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const previousTotal = items.reduce((sum, item) => sum + item.previousCount, 0);
  const activeKey = hoveredKey ?? selectedKey;
  const activeItem = items.find((item) => item.key === activeKey) ?? null;
  const activeValue = activeItem?.count ?? total;
  const activeDelta = activeItem?.delta ?? comparisonDelta(total, previousTotal);
  const activeLabel = activeItem?.label ?? t("cards.sentiment.total");
  const option = useMemo<EChartsCoreOption>(() => ({
    color: items.map((item) => item.color),
    tooltip: {
      ...CHART_TOOLTIP_STYLE,
      trigger: "item",
      formatter: (params: unknown) => sentimentTooltip(params, items, total, hasComparison, t)
    },
    series: [{
      type: "pie",
      radius: ["62%", "83%"],
      center: ["50%", "50%"],
      selectedMode: "single",
      selectedOffset: 5,
      avoidLabelOverlap: true,
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 4 },
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      data: items.map((item) => ({
        name: item.label,
        value: item.count,
        selected: item.key === selectedKey,
        itemStyle: {
          color: item.color,
          opacity: activeKey && activeKey !== item.key ? 0.22 : 1
        }
      }))
    }]
  }), [activeKey, hasComparison, items, selectedKey, t, total]);
  const resolveKey = (name: string) => items.find((item) => item.label === name)?.key ?? null;

  return (
    <div className="signal-v2-sentiment">
      <div className="signal-v2-sentiment__donut">
        <SignalEChart
          ariaLabel={t("cards.sentiment.aria")}
          className="signal-v2-chart--sentiment"
          onDatumClick={(name) => {
            const key = resolveKey(name);
            if (key) setSelectedKey((current) => current === key ? null : key);
          }}
          onDatumHover={(name) => setHoveredKey(name ? resolveKey(name) : null)}
          option={option}
        />
        <div className="signal-v2-sentiment__center">
          <span>{activeLabel}</span>
          <strong>{formatNumber(activeValue)}</strong>
          <small className={sentimentDeltaClass(activeDelta)}>
            {hasComparison ? formatSentimentDelta(activeDelta) : t("cards.sentiment.noComparison")}
          </small>
        </div>
      </div>
      <div aria-label={t("cards.sentiment.legend")} className="signal-v2-sentiment__legend">
        {items.map((item) => (
          <button
            aria-pressed={selectedKey === item.key}
            className={activeKey === item.key ? "signal-v2-sentiment__legend-row--active" : undefined}
            key={item.key}
            onBlur={() => setHoveredKey(null)}
            onClick={() => setSelectedKey((current) => current === item.key ? null : item.key)}
            onFocus={() => setHoveredKey(item.key)}
            onMouseEnter={() => setHoveredKey(item.key)}
            onMouseLeave={() => setHoveredKey(null)}
            type="button"
          >
            <i style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
            <strong>{formatNumber(item.count)}</strong>
            <small className={sentimentDeltaClass(item.delta)}>
              {hasComparison ? formatSentimentDelta(item.delta) : "—"}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}

function DistributionBars({ buckets }: { buckets: BrandMonitoringBreakdown }) {
  const maximum = Math.max(...buckets.buckets.map((bucket) => bucket.value ?? 0), 1);
  return (
    <div className="signal-v2-distribution">
      {buckets.buckets.slice(0, 6).map((bucket) => (
        <div className="signal-v2-distribution__row" key={bucket.key}>
          <span>{prettify(bucket.label)}</span>
          <div><i style={{ width: `${Math.max(3, ((bucket.value ?? 0) / maximum) * 100)}%` }} /></div>
          <strong>{formatCompact(bucket.value ?? 0)}</strong>
        </div>
      ))}
    </div>
  );
}

function TopicTable({
  topics
}: {
  topics: Array<{ key: string; label: string; value: number; kind: "topic" | "narrative" }>;
}) {
  const t = useTranslations("SignalV2");
  if (topics.length === 0) return <EmptyMetric message={t("cards.topics.empty")} />;
  const total = topics.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="signal-v2-topic-table" role="table">
      <div className="signal-v2-topic-table__head" role="row">
        <span role="columnheader">{t("cards.topics.columnName")}</span>
        <span role="columnheader">{t("cards.topics.columnType")}</span>
        <span role="columnheader">{t("cards.topics.columnMentions")}</span>
        <span role="columnheader">{t("cards.topics.columnShare")}</span>
      </div>
      {topics.slice(0, 8).map((topic) => (
        <div className="signal-v2-topic-table__row" key={`${topic.kind}:${topic.key}`} role="row">
          <strong role="cell">{prettify(topic.label)}</strong>
          <span role="cell">{topic.kind === "topic" ? t("cards.topics.topic") : t("cards.topics.narrative")}</span>
          <span role="cell">{formatNumber(topic.value)}</span>
          <div role="cell">
            <i><b style={{ width: `${total > 0 ? (topic.value / total) * 100 : 0}%` }} /></i>
            <span>{total > 0 ? `${Math.round((topic.value / total) * 100)}%` : "—"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversationColumn({
  empty,
  items,
  label,
  tone
}: {
  empty: string;
  items: BrandMonitoringHighlight[];
  label: string;
  tone: "positive" | "negative";
}) {
  const t = useTranslations("SignalV2");
  return (
    <section>
      <h3><span className={`signal-v2-tone-dot signal-v2-tone-dot--${tone}`} />{label}</h3>
      {items.length === 0 ? <p className="signal-v2-conversation-empty">{empty}</p> : (
        <div className="signal-v2-conversation-list">
          {items.map((item, index) => (
            <article key={item.id}>
              <span>{index + 1}</span>
              <div>
                <small>{prettify(item.platform)} · {formatDate(item.occurred_at)}</small>
                <p>{item.text}</p>
                <em>{localizedHighlightExplanation(item, t)}</em>
              </div>
              {item.url ? (
                <a aria-label={t("cards.conversations.openOriginal")} href={item.url} rel="noreferrer" target="_blank">
                  <ArrowUpRight size={15} />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function mergeTopicBuckets(topics: BrandMonitoringBreakdown, narratives: BrandMonitoringBreakdown) {
  return [
    ...topics.buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      value: bucket.value ?? 0,
      kind: "topic" as const
    })),
    ...narratives.buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      value: bucket.value ?? 0,
      kind: "narrative" as const
    }))
  ].sort((a, b) => b.value - a.value);
}

function worstBreakdownState(first: string, second: string) {
  const order = ["fresh", "stale", "partial", "pending", "not_available"];
  return order[Math.max(order.indexOf(first), order.indexOf(second))] ?? "partial";
}

function translatedHelp(
  t: ReturnType<typeof useTranslations>,
  prefix: string
): MetricHelpContent {
  return {
    title: t(`${prefix}.title`),
    body: t(`${prefix}.body`),
    reading: t(`${prefix}.reading`)
  };
}

function preferredGranularity(start: string, end: string) {
  const days = Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  if (days <= 90) return "day";
  if (days <= 365) return "week";
  return "month";
}

function alignStructuredPrevious(
  points: SignalBrandMonitoringV1["conversation_structure"]["previous_points"],
  length: number,
  metric: ConversationMetric
) {
  const values = points.map((point) => point[metric]);
  if (values.length >= length) return values.slice(values.length - length);
  return [...Array.from({ length: length - values.length }, () => null), ...values];
}

function platformTooltip(
  params: unknown,
  buckets: BrandMonitoringBreakdown["buckets"],
  total: number,
  t: ReturnType<typeof useTranslations>
) {
  if (!params || typeof params !== "object" || !("name" in params)) return "";
  const name = String((params as { name: unknown }).name);
  const bucket = buckets.find((candidate) => prettify(candidate.label) === name);
  if (!bucket) return "";
  const share = total > 0 ? bucket.sample_size / total : 0;
  return [
    `<div class="signal-v2-chart-tooltip__title">${escapeHtml(name)}</div>`,
    `<div class="signal-v2-chart-tooltip__row">`,
    `<span>${formatNumber(bucket.sample_size)} ${t("cards.platforms.mentions")}</span>`,
    `<strong>${formatPercent(share)}</strong>`,
    `</div>`
  ].join("");
}

function driverLabel(item: BrandMonitoringThreadDriver) {
  const candidate = [item.title, item.text]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .find((value) => value.replace(/["'`´“”‘’.,:;!?()[\]{}\-–—_/\\|]/g, "").trim().length >= 8)
    ?? `${prettify(item.platform)} · ${item.comment_count}`;
  return candidate.length > 42 ? `${candidate.slice(0, 39)}…` : candidate;
}

function driverTooltip(
  params: unknown,
  items: BrandMonitoringThreadDriver[],
  t: ReturnType<typeof useTranslations>
) {
  if (!params || typeof params !== "object" || !("name" in params)) return "";
  const name = String((params as { name: unknown }).name);
  const item = items.find((candidate) => driverLabel(candidate) === name);
  if (!item) return "";
  return [
    `<div class="signal-v2-chart-tooltip__title">${escapeHtml(driverLabel(item))}</div>`,
    `<div class="signal-v2-chart-tooltip__stack">`,
    `<span>${formatNumber(item.mention_count)} ${t("cards.drivers.mentions")}</span>`,
    `<span>${formatNumber(item.comment_count)} ${t("cards.drivers.comments")}</span>`,
    `<span>${formatCompact(item.interaction_count)} ${t("cards.drivers.interactions")}</span>`,
    `</div>`
  ].join("");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function sentimentLabel(key: string, t: ReturnType<typeof useTranslations>) {
  const normalized = key.toLowerCase();
  if (normalized === "positive") return t("sentiment.positive");
  if (normalized === "negative") return t("sentiment.negative");
  if (normalized === "neutral") return t("sentiment.neutral");
  return t("sentiment.unknown");
}

function metricEmptyMessage(state: string, t: ReturnType<typeof useTranslations>) {
  if (state === "pending") return t("states.pending");
  if (state === "stale") return t("states.stale");
  if (state === "partial") return t("states.partial");
  return t("states.notAvailable");
}

function freshnessLabel(state: string, t: ReturnType<typeof useTranslations>) {
  if (state === "fresh") return t("freshness.fresh");
  if (state === "stale") return t("freshness.stale");
  if (state === "pending") return t("freshness.pending");
  if (state === "partial") return t("freshness.partial");
  return t("freshness.notAvailable");
}

function stateShortLabel(state: string, t: ReturnType<typeof useTranslations>) {
  if (state === "fresh") return t("stateShort.fresh");
  if (state === "pending") return t("stateShort.pending");
  if (state === "partial") return t("stateShort.partial");
  if (state === "stale") return t("stateShort.stale");
  return t("stateShort.notAvailable");
}

function sentimentColor(key: string) {
  const normalized = key.toLowerCase();
  if (normalized === "positive") return "#008060";
  if (normalized === "negative") return "#d82c0d";
  if (normalized === "neutral") return "#d8d8d8";
  return "#9aa0a6";
}

function comparisonDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

function formatSentimentDelta(delta: number | null) {
  if (delta == null) return "—";
  const percentage = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 1
  }).format(Math.abs(delta) * 100);
  if (delta > 0) return `↑ ${percentage}%`;
  if (delta < 0) return `↓ ${percentage}%`;
  return "→ 0%";
}

function sentimentDeltaClass(delta: number | null) {
  if (delta == null || delta === 0) return undefined;
  return delta > 0 ? "signal-v2-trend--up" : "signal-v2-trend--down";
}

function sentimentTooltip(
  params: unknown,
  items: Array<{
    label: string;
    count: number;
    delta: number | null;
  }>,
  total: number,
  hasComparison: boolean,
  t: ReturnType<typeof useTranslations>
) {
  if (!params || typeof params !== "object" || !("name" in params)) return "";
  const name = String((params as { name: unknown }).name);
  const item = items.find((candidate) => candidate.label === name);
  if (!item) return "";
  const share = total > 0 ? (item.count / total) * 100 : 0;
  const shareLabel = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 1
  }).format(share);
  const comparison = hasComparison
    ? `<small class="signal-v2-chart-tooltip__comparison">${formatSentimentDelta(item.delta)} ${t("cards.sentiment.vsPrevious")}</small>`
    : "";
  return [
    `<div class="signal-v2-chart-tooltip__title">${escapeHtml(item.label)}</div>`,
    `<div class="signal-v2-chart-tooltip__row">`,
    `<span>${formatNumber(item.count)} ${t("cards.sentiment.mentions")}</span>`,
    `<strong>${shareLabel}%</strong>`,
    `</div>`,
    comparison
  ].join("");
}

function localizedHighlightExplanation(
  item: BrandMonitoringHighlight,
  t: ReturnType<typeof useTranslations>
) {
  const tone = item.sentiment > 0
    ? t("cards.conversations.tonePositive")
    : t("cards.conversations.toneNegative");
  if (item.engagement > 0) {
    return t("cards.conversations.explanationEngagement", {
      tone,
      count: formatNumber(item.engagement)
    });
  }
  if (item.reach && item.reach > 0) {
    return t("cards.conversations.explanationReach", { tone });
  }
  return t("cards.conversations.explanationRecency", { tone });
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" })
    .format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDelta(value: number | null) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 1 }).format(value)}`;
}

function formatPointDelta(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(value * 100)} pp`;
}

function prettify(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "N";
}
