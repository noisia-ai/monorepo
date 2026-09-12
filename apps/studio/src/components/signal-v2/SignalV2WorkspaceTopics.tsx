"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, Gauge, Quotes } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalFilterV1, SignalWorkspaceTopicsOverviewV1, SignalWorkspaceTopicEvidencePageV1 } from "@noisia/query-engine";
import { SignalV2ModuleHeader } from "./SignalV2ModuleHeader";
import { SignalAnalyticsFilter, type SignalAnalyticsFilterSelection } from "./SignalAnalyticsFilter";
import { SignalDataScopeFilter } from "./SignalDataScopeFilter";
import { SignalEChart } from "./SignalEChart";
import { SignalWorkspaceTopicDetail } from "./SignalWorkspaceTopicDetail";
import { SignalSourceIcon } from "./SignalSourceIcon";
import { SignalEvidenceDrawer } from "./SignalEvidenceDrawer";
import { SignalTopicsKpi, SignalTopicsRankingCard, SignalTopicsRankingList } from "./SignalTopicsPrimitives";
import { buildSignalTopicTrendOption } from "./SignalTopicChartOptions";

const sections = ["topics", "narratives", "noise", "unresolved"] as const;
type NativeTopicSection = typeof sections[number];

export function SignalV2WorkspaceTopics({ brandName, data, loading, manageTopicsHref, onApplyFilter, onRefresh, surface = "topics", onOpenTopics, onOpenMention, onOpenMentions, refreshFailed = false, workspaceTimezone }: {
  brandName: string;
  data: SignalWorkspaceTopicsOverviewV1; loading: boolean; manageTopicsHref: string | null;
  onApplyFilter: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onRefresh?: () => Promise<boolean>; surface?: "summary" | "topics"; onOpenTopics?: () => void; refreshFailed?: boolean;
  onOpenMention?: (mentionId: string) => void;
  onOpenMentions: () => void;
  workspaceTimezone: string;
}) {
  const t = useTranslations("SignalV2.workspaceTopics"), locale = useLocale();
  const [selectedKey, setSelectedKey] = useState<string | null>(data.terms[0]?.term_key ?? null);
  const [termLimit, setTermLimit] = useState(50);
  const [section, setSection] = useState<NativeTopicSection>("topics");
  const [rankingView, setRankingView] = useState<"list" | "chart">("list");
  const tabsId = useId();
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);

  const refreshCallback = useRef(onRefresh); refreshCallback.current = onRefresh;
  const [drawer, setDrawer] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<SignalWorkspaceTopicEvidencePageV1 | null>(null);
  const request = useRef<AbortController | null>(null), sequence = useRef(0);
  const term = data.terms.find(item => item.term_key === selectedKey) ?? data.terms[0] ?? null;
  const evidence = page?.scope_digest === data.scope_digest && page.term_key === term?.term_key
    && page.workspace_id === data.workspace_id && data.is_current ? page : null;
  const dateFrom = data.filters.date_from ?? data.available_dates.date_from;
  const dateTo = data.filters.date_to ?? data.available_dates.date_to;
  const filter: SignalFilterV1 | null = dateFrom && dateTo ? { contract_version: "signal-backend-v1", date_range: { start: dateFrom, end: dateTo },
    timezone: "UTC", granularity: "day", dimensions: {} } : null;
  const number = (value: number) => value.toLocaleString(locale);
  const share = (value: number | null) => value === null ? "—" : new Intl.NumberFormat(locale,
    { style: "percent", maximumFractionDigits: 1 }).format(value);
  const read = useCallback(async (cursor?: string) => {
    if (!term || !data.is_current || !data.generation_id) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const version = ++sequence.current; setReading(true); setError(null);
    const params = new URLSearchParams({ view: "all_conversations", scope_digest: data.scope_digest, limit: "25" });
    if (data.filters.date_from) params.set("date_from", data.filters.date_from);
    if (data.filters.date_to) params.set("date_to", data.filters.date_to);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/data-os/signal/${data.workspace_id}/topics-narratives/topic/${encodeURIComponent(term.term_key)}/evidence?${params}`,
        { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || version !== sequence.current) return;
      if (!response.ok) {
        if ([401, 403, 404, 409].includes(response.status)) setPage(null);
        throw new Error([401, 403, 404, 409].includes(response.status) ? "evidenceStale" : "evidenceError");
      }
      const body = await response.json() as SignalWorkspaceTopicEvidencePageV1;
      if (controller.signal.aborted || version !== sequence.current) return;
      if (body.contract_version !== "signal-workspace-topic-evidence-v1" || body.workspace_id !== data.workspace_id
        || body.generation_id !== data.generation_id || body.scope_digest !== data.scope_digest || body.term_key !== term.term_key) {
        setPage(null); throw new Error("evidenceStale");
      }
      setPage(previous => cursor && previous?.scope_digest === body.scope_digest && previous.term_key === body.term_key
        ? { ...body, items: [...previous.items, ...body.items.filter(item => !previous.items.some(prior => prior.mention_id === item.mention_id))] }
        : body);
    } catch (cause) {
      if (!controller.signal.aborted && version === sequence.current) setError(cause instanceof Error ? cause.message : "evidenceError");
    } finally { if (!controller.signal.aborted && version === sequence.current) setReading(false); }
  }, [data.filters.date_from, data.filters.date_to, data.generation_id, data.is_current, data.scope_digest, data.workspace_id, term]);
  useEffect(() => {
    const fence = sequence;
    sequence.current++; request.current?.abort(); setPage(null); setError(null); setReading(false);
    return () => { fence.current++; request.current?.abort(); };
  }, [data.scope_digest, data.workspace_id, data.generation_id, data.is_current, term?.term_key]);
  useEffect(() => {
    if ((section === "topics" || surface === "summary") && data.is_current && term) void read();
  }, [read, section, surface, data.is_current, term]);
  useEffect(() => {
    if (!data.is_processing || loading || refreshFailed || !onRefresh) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => { void refreshCallback.current?.(); }, 10_000);
    };
    schedule(); document.addEventListener("visibilitychange", schedule);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [data.workspace_id, data.observed_at, data.is_processing, loading, refreshFailed, onRefresh]);
  const refresh = async () => {
    return onRefresh ? onRefresh() : filter ? onApplyFilter({ start: filter.date_range.start, end: filter.date_range.end,
      comparisonMode: "none", dimensions: {}, searchQuery: "" }) : false;
  };
  const select = (key: string) => { setSelectedKey(key); setDrawer(false); };
  const visibleTerms = data.terms.slice(0, surface === "summary" ? 10 : termLimit);
  const selectSection = (next: NativeTopicSection) => {
    request.current?.abort(); sequence.current++; setReading(false); setDrawer(false); setSection(next);
  };
  return <div className="signal-v2-tn signal-v2-tn--workspace">
    <SignalV2ModuleHeader icon={surface === "summary" ? <Gauge size={20} weight="fill" /> : <Quotes size={20} weight="fill" />} title={t(surface === "summary" ? "summaryTitle" : "title")} subtitle={t("scope")}
      status={t(data.is_processing ? "updating" : data.is_current ? data.interpretation_coverage?.complete === false ? "partialCurrent" : "current" : "stale")}
      aside={manageTopicsHref ? <Link className="signal-v2-filter" href={manageTopicsHref} prefetch={false}>{t("manage")}</Link> : null}
      controls={<>{filter ? <SignalAnalyticsFilter boundedToCoverage filter={filter} comparison={{ mode: "none", date_range: null }}
        coverage={{ date_from: data.available_dates.date_from, date_through: data.available_dates.date_to }} loading={loading}
        showComparison={false} onApply={selection => onApplyFilter({ ...selection, comparisonMode: "none", dimensions: {}, searchQuery: "" })} /> : null}
        {dateFrom && dateTo ? <SignalDataScopeFilter brandName={brandName} coverageFrom={dateFrom} coverageThrough={dateTo}
          disabled={loading} mentionCount={data.denominator} onOpenMentions={onOpenMentions} /> : null}
        <button className="signal-v2-filter" type="button" disabled={loading} onClick={() => void refresh()}><ArrowClockwise size={16} />{t("refresh")}</button>
        <span>{t("workspaceTimezone", { timezone: workspaceTimezone })}</span></>} />
    {refreshFailed ? <div className="signal-v2-error" role="alert">{t("refreshError")}</div> : null}
    <div aria-busy={loading} className={`signal-v2-tn__data-stage${loading ? " signal-v2-dashboard-stage--loading" : ""}`}>
    {surface === "topics" ? <div className="signal-v2-tn__switch signal-v2-tn__switch--native" role="tablist" aria-label={t("sections.label")}>
      {sections.map((key, index) => <button key={key} type="button" role="tab" id={`${tabsId}-${key}`}
        aria-controls={`${tabsId}-panel`} aria-selected={section === key} tabIndex={section === key ? 0 : -1}
        ref={element => { tabButtons.current[index] = element; }} onClick={() => selectSection(key)}
        onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1
            : event.key === "ArrowRight" ? (index + 1) % sections.length
            : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : null;
          if (next === null) return;
          event.preventDefault(); selectSection(sections[next]!); tabButtons.current[next]?.focus();
        }}>{t(`sections.${key}`)}<span>{key === "topics" ? number(data.terms.length)
          : key === "unresolved" ? number(data.coverage.unresolved) : t("sections.unavailable")}</span></button>)}
    </div> : null}
    <div id={`${tabsId}-panel`} role={surface === "topics" ? "tabpanel" : undefined}
      aria-labelledby={surface === "topics" ? `${tabsId}-${section}` : undefined} tabIndex={surface === "topics" ? 0 : undefined}>
    {section !== "topics" && surface === "topics" ? <SignalWorkspaceTopicDisposition section={section} data={data} />
      : !data.terms.length ? <section className="signal-v2-tn__empty"><Quotes size={24} />
        <strong>{t(data.is_processing ? "emptyPreparing" : "empty")}</strong><p>{t(data.is_processing ? "emptyPreparingBody" : "emptyBody")}</p>
      </section> : <div className="signal-v2-tn__grid">
      <SignalTopicsRankingCard activeView={rankingView} eyebrow={t("rankingEyebrow")} onViewChange={setRankingView}
        title={t("selectedTopics")} viewLabel={t("rankingView")} views={[
          { key: "chart", label: t("chart") }, { key: "list", label: t("list") }
        ]}>
        {rankingView === "list" ? <SignalTopicsRankingList labels={{ term: t("topic"), count: t("mentions"), share: t("share") }}
          selectedKey={term?.term_key ?? null} onSelect={select} entries={visibleTerms.map(item => ({ key: item.term_key,
            label: item.label, count: item.mention_count, formattedCount: number(item.mention_count), share: share(item.share_of_corpus) }))} />
          : <><p className="signal-v2-tn__evidence-intro">{t("chartHelp")}</p>
            <SignalEChart ariaLabel={t("selectedTopics")} onDatumClick={select}
              option={nativeTopicsVolumeChartV1(visibleTerms, term?.term_key ?? null, t("mentions"))} /></>}
        {surface === "topics" && data.terms.length > termLimit ? <button className="signal-v2-filter" type="button" onClick={() => setTermLimit(value => value + 50)}>{t("more")}</button> : null}
        {surface === "summary" && onOpenTopics ? <button className="signal-v2-filter" type="button" onClick={onOpenTopics}>{t("openTopics")}</button> : null}
      </SignalTopicsRankingCard>
      <section className="signal-v2-card signal-v2-tn__detail" aria-label={t("detailTitle")}>
        <header className="signal-v2-card__heading"><div><small>{t("definition")}</small><h2>{t("detailTitle")}</h2></div></header>
        <div className="signal-v2-tn__definition"><strong>{term?.label}</strong><p>{term?.definition}</p></div>
        <div className="signal-v2-tn__term-metrics">
          <article><small>{t("mentions")}</small><strong>{number(term?.mention_count ?? 0)}</strong></article>
          <article><small>{t("share")}</small><strong>{share(term?.share_of_corpus ?? null)}</strong></article>
          <article><small>{t("definitionVersion")}</small><strong>{number(term?.definition_revision ?? 0)}</strong></article>
        </div>
        <div className="signal-v2-tn__evidence-intro"><p>{t("membership", { count: term?.mention_count ?? 0 })}</p><p>{t("traceability")}</p></div>
        <div className="signal-v2-tn__detail-actions"><button className="signal-v2-tn__button" type="button" disabled={!term || !data.is_current}
          onClick={() => { setDrawer(true); if (!evidence) void read(); }}><Quotes size={15} />{t("evidence")}</button></div>
        {term ? <SignalWorkspaceTopicDetail data={data} termKey={term.term_key} onSelect={select} /> : null}
        <div className="signal-v2-tn__preview"><strong>{t("detailMetrics.evidence")}</strong>
          {evidence?.items.slice(0, 5).map(item => <button key={item.mention_id} type="button" onClick={() => setDrawer(true)}>
            <span><SignalSourceIcon label={item.platform} platform={item.platform} size={15} />{item.platform}</span><p>{item.text}</p>
          </button>)}
          {!evidence?.items.length ? <p>{t(reading ? "loading" : "noEvidence")}</p> : null}
          {error ? <p role="alert">{t(error === "evidenceStale" ? "evidenceStale" : "evidenceError")}</p> : null}
        </div>
      </section>
    </div>}
    </div>
    {(section === "topics" || surface === "summary") && data.series.length ? <section className="signal-v2-card"><header className="signal-v2-card__heading"><h2>{t("trend")}</h2></header>
      <SignalEChart ariaLabel={t("trend")} option={buildSignalTopicTrendOption(data.series.map(item => ({
        label: formatTopicDate(item.date, locale), value: item.assigned_unique
      })), t("assigned"), false)} />
    </section> : null}
    <section aria-label={t("computed")} className="signal-v2-tn__operations">
      <div className="signal-v2-tn__coverage-note" role="status"><div><strong>{t("computed")}</strong><p>{t("quality")}</p>
        {!data.is_current ? <p>{t("staleBody")}</p> : null}
        {data.interpretation_coverage ? <p>{t(data.interpretation_coverage.complete ? "interpretationComplete" : "interpretationPartial", {
          done: data.interpretation_coverage.interpreted_unit_count, total: data.interpretation_coverage.expected_unit_count })}</p>
          : data.generation_id ? <p>{t("interpretationUnknown")}</p> : null}
        {data.coverage.unresolved > 0 ? <p>{t("pendingCoverage", { count: data.coverage.unresolved })}</p> : null}
        {data.is_processing ? <p>{t("processing")}</p> : null}
      </div></div>
      <div className="signal-v2-tn__kpis">
        {([["denominator", data.denominator], ["assigned", data.coverage.assigned_unique], ["abstained", data.coverage.abstained], ["pending", data.coverage.unresolved]] as const)
          .map(([label, value]) => <SignalTopicsKpi key={label} label={t(label)} value={number(value)}
            help={{ title: t(label), body: t(`metricHelp.${label}`) }} secondary={t(`metricCaption.${label}`)} />)}
      </div>
      <p className="signal-v2-tn__evidence-intro">{t("denominatorHelp")}{data.coverage.withheld > 0 ? ` ${t("withheld", { count: data.coverage.withheld })}` : ""}</p>
    </section>
    <p className="signal-v2-tn__evidence-intro">{t("noNarratives")}</p>
    </div>
    {drawer && term ? <SignalEvidenceDrawer ariaLabel={t("evidence")} closeLabel={t("close")} eyebrow={t("computed")} title={term.label} intro={t("quality")}
      records={(evidence?.items ?? []).map(item => ({ id: item.mention_id, body: item.text, occurredAt: item.occurred_at, platform: item.platform, originalUrl: item.url }))}
      loading={reading} loadingLabel={t("loading")} emptyLabel={t("noEvidence")} errorMessage={error ? t(error === "evidenceStale" ? "evidenceStale" : "evidenceError") : null}
      onClose={() => { request.current?.abort(); sequence.current++; setDrawer(false); setReading(false); }}
      onOpenEnriched={onOpenMention ? record => { setDrawer(false); onOpenMention(record.id); } : undefined}
      onLoadMore={evidence?.next_cursor ? () => void read(evidence.next_cursor!) : error && data.is_current ? () => void read() : undefined}
      loadMoreLabel={t(error ? "refresh" : "more")} openOriginalLabel={t("original")} openingEnrichedLabel={t("loading")} viewEnrichedLabel={t("openMention")} /> : null}
  </div>;
}

export function SignalWorkspaceTopicDisposition({ section, data }: {
  section: Exclude<NativeTopicSection, "topics">; data: SignalWorkspaceTopicsOverviewV1;
}) {
  const t = useTranslations("SignalV2.workspaceTopics"), locale = useLocale();
  return <section className="signal-v2-tn__empty" role="status" data-availability={section === "unresolved" ? "available" : "not_available"}>
    <Quotes size={24} aria-hidden /><strong>{t(`dispositions.${section}.title`)}</strong>
    {section === "unresolved" ? <strong>{data.coverage.unresolved.toLocaleString(locale)}</strong> : null}
    <p>{t(`dispositions.${section}.body`)}</p>
    {section === "noise" ? <p>{t("noiseAbstention", { count: data.coverage.abstained })}</p> : null}
    {section === "unresolved" ? <p>{t("pendingCoverage", { count: data.coverage.unresolved })}</p> : null}
  </section>;
}

/** The chart encodes volume only. It does not infer semantic proximity or sentiment. */
export function nativeTopicsVolumeChartV1(terms: SignalWorkspaceTopicsOverviewV1["terms"], selected: string | null, seriesName: string) {
  const labels = new Map(terms.map(term => [term.term_key, term.label]));
  return { animation: false, grid: { left: 12, right: 35, top: 15, bottom: 35, containLabel: true },
    tooltip: { trigger: "item", renderMode: "richText", formatter: (item: { name: string; value: number }) =>
      `${labels.get(item.name) ?? item.name}: ${item.value}` },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: { type: "category", inverse: true, data: terms.map(term => term.term_key),
      axisLabel: { width: 155, overflow: "truncate", formatter: (key: string) => labels.get(key) ?? key },
      axisTick: { show: false }, axisLine: { show: false } },
    dataZoom: terms.length > 10 ? [{ type: "slider", yAxisIndex: 0, startValue: 0, endValue: 9, right: 0, width: 12 }] : [],
    series: [{ type: "bar", name: seriesName, barMaxWidth: 24,
      data: terms.map(term => ({ name: term.term_key, value: term.mention_count,
        itemStyle: { color: term.term_key === selected ? "#1689f5" : "#8fcef9", borderRadius: [0, 3, 3, 0] } })) }] };
}

function formatTopicDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}
