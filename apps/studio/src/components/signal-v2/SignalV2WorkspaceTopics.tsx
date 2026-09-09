"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, CaretRight, Quotes } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalFilterV1, SignalWorkspaceTopicsOverviewV1, SignalWorkspaceTopicEvidencePageV1 } from "@noisia/query-engine";
import { SignalV2ModuleHeader } from "./SignalV2ModuleHeader";
import { SignalAnalyticsFilter, type SignalAnalyticsFilterSelection } from "./SignalAnalyticsFilter";
import { SignalEChart } from "./SignalEChart";
import { SignalEvidenceDrawer } from "./SignalEvidenceDrawer";

export function SignalV2WorkspaceTopics({ data, loading, manageTopicsHref, onApplyFilter }: {
  data: SignalWorkspaceTopicsOverviewV1; loading: boolean; manageTopicsHref: string | null;
  onApplyFilter: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
}) {
  const t = useTranslations("SignalV2.workspaceTopics"), locale = useLocale();
  const [selectedKey, setSelectedKey] = useState<string | null>(data.terms[0]?.term_key ?? null);
  const [termLimit, setTermLimit] = useState(50);
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
      const body = await response.json() as SignalWorkspaceTopicEvidencePageV1;
      if (controller.signal.aborted || version !== sequence.current) return;
      if (!response.ok) {
        if ([401, 403, 404, 409].includes(response.status)) setPage(null);
        throw new Error([401, 403, 404, 409].includes(response.status) ? "evidenceStale" : "evidenceError");
      }
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
  }, [data.scope_digest, data.workspace_id, term?.term_key]);
  const refresh = () => filter ? onApplyFilter({ start: filter.date_range.start, end: filter.date_range.end, comparisonMode: "none", dimensions: {}, searchQuery: "" }) : Promise.resolve(false);
  const select = (key: string) => { setSelectedKey(key); setDrawer(false); };
  return <div className="signal-v2-tn signal-v2-tn--workspace">
    <SignalV2ModuleHeader icon={<Quotes size={20} weight="fill" />} title={t("title")} subtitle={t("scope")}
      status={t(data.is_current ? "current" : "stale")}
      aside={manageTopicsHref ? <Link className="signal-v2-filter" href={manageTopicsHref} prefetch={false}>{t("manage")}</Link> : null}
      controls={filter ? <><SignalAnalyticsFilter boundedToCoverage filter={filter} comparison={{ mode: "none", date_range: null }}
        coverage={{ date_from: data.available_dates.date_from, date_through: data.available_dates.date_to }} loading={loading}
        showComparison={false} onApply={selection => onApplyFilter({ ...selection, comparisonMode: "none", dimensions: {}, searchQuery: "" })} />
        <button className="signal-v2-filter" type="button" disabled={loading} onClick={() => void refresh()}><ArrowClockwise size={16} />{t("refresh")}</button>
        <span>{t("utc")}</span></> : null} />
    <div className="signal-v2-tn__coverage-note" role="status"><div><strong>{t("computed")}</strong><p>{t("quality")}</p>
      {!data.is_current ? <p>{t("staleBody")}</p> : null}</div></div>
    <div className="signal-v2-tn__kpis">
      {([["denominator", data.denominator], ["assigned", data.coverage.assigned_unique], ["abstained", data.coverage.abstained], ["pending", data.coverage.unresolved]] as const)
        .map(([label, value]) => <section className="signal-v2-tn__kpi" key={label}><small>{t(label)}</small><strong>{number(value)}</strong></section>)}
    </div>
    <p className="signal-v2-tn__evidence-intro">{t("denominatorHelp")}{data.coverage.withheld > 0 ? ` ${t("withheld", { count: data.coverage.withheld })}` : ""}</p>
    {!data.terms.length ? <section className="signal-v2-card"><div className="signal-v2-card__heading"><div><h2>{t("empty")}</h2><p>{t("emptyBody")}</p></div></div></section> : <div className="signal-v2-tn__grid">
      <section className="signal-v2-card signal-v2-tn__ranking"><header className="signal-v2-card__heading"><h2>{t("selectedTopics")}</h2></header>
        <div className="signal-v2-tn__rank-head"><span>{t("topic")}</span><span>{t("mentions")}</span><span>{t("share")}</span><span /></div>
        <div className="signal-v2-tn__rank-list">{data.terms.slice(0, termLimit).map(item => <button type="button" key={item.term_key} aria-pressed={item.term_key === term?.term_key} onClick={() => select(item.term_key)}>
          <span className="signal-v2-tn__term"><strong>{item.label}</strong></span><b>{number(item.mention_count)}</b>
          <span>{item.share_of_corpus === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(item.share_of_corpus)}</span><span /><CaretRight size={14} />
        </button>)}</div>
        {data.terms.length > termLimit ? <button className="signal-v2-filter" type="button" onClick={() => setTermLimit(value => value + 50)}>{t("more")}</button> : null}
      </section>
      <section className="signal-v2-card signal-v2-tn__detail"><header className="signal-v2-card__heading"><div><small>{t("definition")}</small><h2>{term?.label}</h2></div></header>
        <div className="signal-v2-tn__evidence-intro"><p>{term?.definition}</p><p>{t("membership", { count: term?.mention_count ?? 0 })}</p>
          <button className="signal-v2-filter" type="button" disabled={!term || !data.is_current} onClick={() => { setDrawer(true); void read(); }}>{t("evidence")}</button>
        </div>
      </section>
    </div>}
    {data.series.length ? <section className="signal-v2-card"><header className="signal-v2-card__heading"><h2>{t("trend")}</h2></header>
      <SignalEChart ariaLabel={t("trend")} option={{ animation: false, grid: { left: 55, right: 24, top: 24, bottom: 40 },
        xAxis: { type: "category", data: data.series.map(item => item.date) }, yAxis: { type: "value", minInterval: 1 },
        series: [{ type: "line", name: t("assigned"), data: data.series.map(item => item.assigned_unique), showSymbol: false, lineStyle: { color: "#1689f5" } }] }} />
    </section> : null}
    <p className="signal-v2-tn__evidence-intro">{t("noNarratives")}</p>
    {drawer && term ? <SignalEvidenceDrawer ariaLabel={t("evidence")} closeLabel={t("close")} eyebrow={t("computed")} title={term.label} intro={t("quality")}
      records={(evidence?.items ?? []).map(item => ({ id: item.mention_id, body: item.text, occurredAt: item.occurred_at, platform: item.platform, originalUrl: item.url }))}
      loading={reading} loadingLabel={t("loading")} emptyLabel={t("noEvidence")} errorMessage={error ? t(error === "evidenceStale" ? "evidenceStale" : "evidenceError") : null}
      onClose={() => { request.current?.abort(); sequence.current++; setDrawer(false); setReading(false); }}
      onLoadMore={evidence?.next_cursor ? () => void read(evidence.next_cursor!) : error && data.is_current ? () => void read() : undefined}
      loadMoreLabel={t(error ? "refresh" : "more")} openOriginalLabel={t("original")} openingEnrichedLabel={t("loading")} viewEnrichedLabel={t("evidence")} /> : null}
  </div>;
}
