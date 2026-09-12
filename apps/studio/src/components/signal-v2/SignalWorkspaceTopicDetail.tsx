"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalWorkspaceTopicDetailV1 } from "@noisia/db";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import { SignalEChart } from "./SignalEChart";
import { buildSignalTopicSentimentOption, buildSignalTopicTrendOption } from "./SignalTopicChartOptions";
import { SignalTopicSentimentLegend } from "./SignalTopicsPrimitives";

type Identity = { workspace_id: string; generation_id: string | null; scope_digest: string; term_key: string };
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function validNativeTopicDetail(value: unknown, identity: Identity): value is SignalWorkspaceTopicDetailV1 {
  if (!value || typeof value !== "object") return false;
  const item = value as SignalWorkspaceTopicDetailV1;
  return item.contract_version === "signal-workspace-topic-detail-v1" && item.workspace_id === identity.workspace_id
    && typeof item.generation_id === "string" && item.generation_id === identity.generation_id && item.scope_digest === identity.scope_digest && item.term_key === identity.term_key
    && count(item.mention_count) && count(item.undated_mentions) && item.undated_mentions <= item.mention_count
    && Array.isArray(item.series) && new Set(item.series.map(point => point?.date)).size === item.series.length && item.series.every(point => !!point && typeof point.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(point.date) && count(point.mention_count))
    && item.series.reduce((sum, point) => sum + point.mention_count, 0) + item.undated_mentions === item.mention_count
    && !!item.sentiment && item.sentiment.meaning === "evidence_sentiment_not_topic_polarity"
    && [item.sentiment.positive, item.sentiment.neutral, item.sentiment.negative, item.sentiment.unclassified].every(count)
    && item.sentiment.positive + item.sentiment.neutral + item.sentiment.negative + item.sentiment.unclassified === item.mention_count
    && item.relationship_meaning === "cooccurrence_not_causality" && Array.isArray(item.related_topics)
    && item.related_topics.length <= 20 && new Set(item.related_topics.map(topic => topic?.term_key)).size === item.related_topics.length
    && item.related_topics.every(topic => !!topic && typeof topic.term_key === "string"
      && topic.term_key !== item.term_key && typeof topic.label === "string" && count(topic.shared_mentions) && topic.shared_mentions <= item.mention_count);
}

export function SignalWorkspaceTopicDetail({ data, termKey, onSelect }: {
  data: SignalWorkspaceTopicsOverviewV1; termKey: string; onSelect: (key: string) => void;
}) {
  const t = useTranslations("SignalV2.workspaceTopics.detailMetrics");
  const [detail, setDetail] = useState<SignalWorkspaceTopicDetailV1 | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setFailed(false);
    if (!data.is_current || !data.generation_id) return () => controller.abort();
    const params = new URLSearchParams({ view: "all_conversations", scope_digest: data.scope_digest });
    if (data.filters.date_from) params.set("date_from", data.filters.date_from);
    if (data.filters.date_to) params.set("date_to", data.filters.date_to);
    void fetch(`/api/data-os/signal/${data.workspace_id}/topics-narratives/topic/${encodeURIComponent(termKey)}?${params}`,
      { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("detail_unavailable");
      const value: unknown = await response.json();
      if (!validNativeTopicDetail(value, { workspace_id: data.workspace_id, generation_id: data.generation_id, scope_digest: data.scope_digest, term_key: termKey })) throw new Error("detail_scope_changed");
      if (!controller.signal.aborted) setDetail(value);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [data.workspace_id, data.generation_id, data.scope_digest, data.is_current, data.filters.date_from, data.filters.date_to, termKey, attempt]);
  const current = data.is_current && detail && validNativeTopicDetail(detail, { ...data, term_key: termKey }) ? detail : null;
  return <>{failed ? <p role="alert">{t("error")} <button className="signal-v2-filter" type="button" onClick={() => setAttempt(value => value + 1)}>{t("retry")}</button></p> : null}
    <SignalWorkspaceTopicDetailMetrics detail={current} loading={!current && !failed && data.is_current} onSelect={onSelect} />
  </>;
}

export function SignalWorkspaceTopicDetailMetrics({ detail, loading = false, onSelect }: {
  detail: SignalWorkspaceTopicDetailV1 | null; loading?: boolean; onSelect: (key: string) => void;
}) {
  const t = useTranslations("SignalV2.workspaceTopics.detailMetrics"), locale = useLocale();
  const number = (value: number) => value.toLocaleString(locale);
  const sentiment = detail?.sentiment;
  const classified = sentiment ? sentiment.positive + sentiment.neutral + sentiment.negative : 0;
  const trendOption = useMemo(() => buildSignalTopicTrendOption((detail?.series ?? []).map((point) => ({
    label: formatTopicDate(point.date, locale),
    value: point.mention_count
  })), t("mentions"), false), [detail?.series, locale, t]);
  const sentimentOption = useMemo(() => buildSignalTopicSentimentOption({
    positive: sentiment?.positive ?? 0,
    neutral: sentiment?.neutral ?? 0,
    negative: sentiment?.negative ?? 0
  }, { positive: t("positive"), neutral: t("neutral"), negative: t("negative") }, false), [sentiment, t]);
  return <div aria-busy={loading} className="signal-v2-tn__native-detail-metrics">
    <div className="signal-v2-tn__detail-charts">
      <article><strong>{t("presence")}</strong>
        {detail?.series.length ? <SignalEChart className="signal-v2-tn__trend" ariaLabel={t("presence")} option={trendOption} />
          : <div className="signal-v2-tn__trend"><p>{t(loading ? "loading" : "unavailable")}</p></div>}
        {detail && detail.undated_mentions > 0 ? <small>{t("undated", { count: number(detail.undated_mentions) })}</small> : null}
      </article>
      <article><strong>{t("sentiment")}</strong>
        {classified > 0 && sentiment ? <><SignalEChart className="signal-v2-tn__sentiment-chart" ariaLabel={t("sentiment")} option={sentimentOption} />
          <SignalTopicSentimentLegend counts={{ positive: number(sentiment.positive), neutral: number(sentiment.neutral), negative: number(sentiment.negative) }}
            labels={{ positive: t("positive"), neutral: t("neutral"), negative: t("negative") }} />
        </> : <div className="signal-v2-tn__sentiment-chart"><p>{t(loading ? "loading" : "unavailable")}</p></div>}
        {sentiment ? <small>{t("unclassified", { count: number(sentiment.unclassified) })}</small> : null}
        <p className="signal-v2-tn__evidence-intro">{t("sentimentMeaning")}</p>
      </article>
    </div>
    <div className="signal-v2-tn__preview"><strong>{t("relationships")}</strong><p className="signal-v2-tn__evidence-intro">{t("relationshipMeaning")}</p>
      {detail?.related_topics.length ? detail.related_topics.map(topic => <button key={topic.term_key} type="button" onClick={() => onSelect(topic.term_key)}>
        <span>{topic.label}</span><p>{t("shared", { count: number(topic.shared_mentions) })}</p>
      </button>) : <p>{t(loading ? "loading" : detail ? "noRelationships" : "unavailable")}</p>}
    </div>
  </div>;
}

function formatTopicDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}
