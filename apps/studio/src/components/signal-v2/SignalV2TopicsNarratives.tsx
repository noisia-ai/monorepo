"use client";

import {
  ArrowRight,
  CaretRight,
  Funnel,
  Quotes,
  Sparkle,
  SpinnerGap,
  X
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { EChartsCoreOption } from "echarts/core";

import type {
  SignalComparisonV1,
  SignalFilterV1,
  SignalTaxonomyCooccurrenceV1,
  SignalTaxonomyEvidencePageV1,
  SignalTaxonomyKindV1,
  SignalTaxonomyTermDetailV1,
  SignalTaxonomyTermMetricV1,
  SignalTaxonomyInsightsServingV1,
  SignalTopicsNarrativesOverviewV1
} from "@noisia/query-engine";
import {
  MonthlyInsightCarousel,
  type SignalInsightCarouselData,
  type SignalInsightCarouselItem
} from "@/components/signal-v2/MonthlyInsightCarousel";
import {
  SignalAnalyticsFilter,
  type SignalAnalyticsFilterSelection
} from "@/components/signal-v2/SignalAnalyticsFilter";
import { SignalEChart } from "@/components/signal-v2/SignalEChart";
import { SignalDataScopeFilter } from "@/components/signal-v2/SignalDataScopeFilter";
import {
  SignalEvidenceDrawer,
  type SignalEvidenceDrawerRecord
} from "@/components/signal-v2/SignalEvidenceDrawer";
import { SignalMetricHelp } from "@/components/signal-v2/SignalMetricHelp";
import { SignalSourceIcon } from "@/components/signal-v2/SignalSourceIcon";
import { SignalV2ModuleHeader } from "@/components/signal-v2/SignalV2ModuleHeader";
import { fetchSignalJsonWithRetry } from "@/lib/data-os/signal-client-fetch";

const BLUE = "#1689f5";
const BLUE_SOFT = "#8fcef9";
const GRID = "#ebebeb";
const TEXT = "#303030";
const MUTED = "#737373";
const MIN_RELATIONSHIP_LIFT = 1.1;
const MIN_RELATIONSHIP_MENTIONS = 2;
const taxonomyInsightsRequests = new Map<
  string,
  Promise<{ ok: boolean; payload: SignalTaxonomyInsightsServingV1 & { message?: string } }>
>();

type RelationshipMetric = SignalTaxonomyCooccurrenceV1 & {
  expected_count: number;
  lift: number;
};

export function SignalV2TopicsNarratives({
  brandName,
  canRefreshInsights,
  comparison,
  coverage,
  data,
  filter,
  loading,
  onApplyFilter,
  onOpenControls,
  onOpenMentions,
  workspaceSlug
}: {
  brandName: string;
  canRefreshInsights: boolean;
  comparison: SignalComparisonV1;
  coverage: { date_from: string | null; date_through: string | null };
  data: SignalTopicsNarrativesOverviewV1;
  filter: SignalFilterV1;
  loading: boolean;
  onApplyFilter: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
  onOpenControls: () => void;
  onOpenMentions: () => void;
  workspaceSlug: string;
}) {
  const t = useTranslations("SignalV2.topicsNarratives");
  const common = useTranslations("SignalV2");
  const locale = useLocale();
  const router = useRouter();
  const [mentionNavigationPending, startMentionNavigation] = useTransition();
  const [kind, setKind] = useState<SignalTaxonomyKindV1>("topic");
  const section = kind === "topic" ? data.topics : data.narratives;
  const [selectedTermKey, setSelectedTermKey] = useState<string | null>(
    section.terms[0]?.term_key ?? null
  );
  const [detail, setDetail] = useState<SignalTaxonomyTermDetailV1 | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<SignalTaxonomyEvidencePageV1 | null>(null);
  const [evidencePreviewLoading, setEvidencePreviewLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(Boolean(section.terms[0]?.term_key));
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetryVersion, setDetailRetryVersion] = useState(0);
  const [evidence, setEvidence] = useState<SignalTaxonomyEvidencePageV1 | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);
  const [openingMentionId, setOpeningMentionId] = useState<string | null>(null);
  const [coverageNoticeDismissed, setCoverageNoticeDismissed] = useState(false);
  const [rankingView, setRankingView] = useState<"map" | "list">("list");
  const [insights, setInsights] = useState<SignalTaxonomyInsightsServingV1 | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightRunError, setInsightRunError] = useState<string | null>(null);
  const [insightQueueSample, setInsightQueueSample] = useState<{
    analyzed_mentions: number;
    population_mentions: number;
  } | null>(null);

  const loadInsights = useCallback(async () => {
    const endpoint = `/api/data-os/signal/${data.workspace_id}/topics-narratives/insights`;
    let request = taxonomyInsightsRequests.get(endpoint);
    if (!request) {
      request = fetch(endpoint, { cache: "no-store" }).then(async (response) => ({
        ok: response.ok,
        payload: await response.json() as SignalTaxonomyInsightsServingV1 & { message?: string }
      }));
      taxonomyInsightsRequests.set(endpoint, request);
      const clearRequest = () => {
        if (taxonomyInsightsRequests.get(endpoint) === request) {
          taxonomyInsightsRequests.delete(endpoint);
        }
      };
      void request.then(clearRequest, clearRequest);
    }
    const { ok, payload } = await request;
    if (!ok) {
      throw new Error(payload.message ?? t("insights.error"));
    }
    setInsights(payload);
    if (payload.enrichment.analyzed_mentions > 0) {
      setInsightQueueSample({
        analyzed_mentions: payload.enrichment.analyzed_mentions,
        population_mentions: payload.result?.sample.population_mentions ?? 0
      });
    }
    return payload;
  }, [data.workspace_id, t]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setInsightsLoading(true);
      try {
        const payload = await loadInsights();
        if (!cancelled) setInsightRunError(
          payload.state === "failed"
            ? payload.run?.error_message ?? t("insights.error")
            : null
        );
      } catch (error) {
        if (!cancelled) {
          setInsightRunError(error instanceof Error ? error.message : t("insights.error"));
        }
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadInsights, t]);

  useEffect(() => {
    if (insights?.state !== "pending") return;
    const timer = window.setInterval(() => {
      void loadInsights().catch((error) => {
        setInsightRunError(error instanceof Error ? error.message : t("insights.error"));
      });
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [insights?.run?.status, insights?.state, loadInsights, t]);

  const runInsights = async () => {
    setInsightRunError(null);
    setInsights((current) => current
      ? { ...current, state: "pending" }
      : current);
    try {
      const response = await fetch(
        `/api/data-os/signal/${data.workspace_id}/topics-narratives/insights`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ budget_cap_usd: 4 })
        }
      );
      const payload = await response.json() as {
        message?: string;
        serving?: SignalTaxonomyInsightsServingV1;
        sample?: {
          analyzed_mentions: number;
          population_mentions: number;
        };
      };
      if (!response.ok) throw new Error(payload.message ?? t("insights.error"));
      if (payload.sample) setInsightQueueSample(payload.sample);
      if (payload.serving) {
        setInsights(payload.serving);
      } else {
        await loadInsights();
      }
    } catch (error) {
      setInsightRunError(error instanceof Error ? error.message : t("insights.error"));
      await loadInsights().catch(() => undefined);
    }
  };

  const resetSelectedTermState = (willLoad: boolean) => {
    setDetail(null);
    setDetailLoading(willLoad);
    setEvidencePreview(null);
    setEvidencePreviewLoading(willLoad);
    setDetailError(null);
    setEvidence(null);
    setEvidenceOpen(false);
    setEvidenceError(false);
  };

  const selectKind = (nextKind: SignalTaxonomyKindV1) => {
    const nextSection = nextKind === "topic" ? data.topics : data.narratives;
    const nextTermKey = nextSection.terms[0]?.term_key ?? null;
    setKind(nextKind);
    setSelectedTermKey(nextTermKey);
    resetSelectedTermState(Boolean(nextTermKey));
  };

  const selectTerm = (termKey: string) => {
    if (termKey === selectedTermKey) {
      if (detailError) setDetailRetryVersion((version) => version + 1);
      return;
    }
    setSelectedTermKey(termKey);
    resetSelectedTermState(true);
  };

  useEffect(() => {
    const nextSection = kind === "topic" ? data.topics : data.narratives;
    if (!nextSection.terms.some((term) => term.term_key === selectedTermKey)) {
      const nextTermKey = nextSection.terms[0]?.term_key ?? null;
      setSelectedTermKey(nextTermKey);
      resetSelectedTermState(Boolean(nextTermKey));
    }
  }, [data.narratives, data.topics, kind, selectedTermKey]);

  useEffect(() => {
    if (!selectedTermKey) {
      setDetail(null);
      setDetailLoading(false);
      setEvidencePreview(null);
      setEvidencePreviewLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      setDetailLoading(true);
      setEvidencePreviewLoading(true);
      setDetailError(null);
      try {
        const params = taxonomyQuery(filter, comparison);
        const base = `/api/data-os/signal/${data.workspace_id}/topics-narratives/${kind}/${encodeURIComponent(selectedTermKey)}`;
        const evidenceParams = new URLSearchParams(params);
        evidenceParams.set("limit", "5");
        const evidenceRequest = fetchSignalJsonWithRetry<SignalTaxonomyEvidencePageV1>(
          `${base}/evidence?${evidenceParams}`,
          {
            fallbackMessage: t("errors.evidence"),
            signal: controller.signal
          }
        ).then(
          (payload) => ({ payload, error: null }),
          (error: unknown) => ({ payload: null, error })
        );
        const detailPayload = await fetchSignalJsonWithRetry<SignalTaxonomyTermDetailV1>(
          `${base}?${params}`,
          {
            fallbackMessage: t("errors.detail"),
            signal: controller.signal
          }
        );
        if (!cancelled) {
          setDetail(detailPayload);
          setDetailLoading(false);
        }
        const evidenceResult = await evidenceRequest;
        if (!cancelled && evidenceResult.payload) {
          setEvidencePreview(evidenceResult.payload);
        } else if (!cancelled && !controller.signal.aborted && evidenceResult.error) {
          setEvidencePreview(null);
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setDetail(null);
          setEvidencePreview(null);
          setDetailError(error instanceof Error ? error.message : t("errors.detail"));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
          setEvidencePreviewLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [comparison, data.workspace_id, detailRetryVersion, filter, kind, selectedTermKey, t]);

  const selectedMetric = section.terms.find((term) => term.term_key === selectedTermKey)
    ?? section.terms[0]
    ?? null;
  const relationshipMetrics = useMemo(
    () => buildRelationshipMetrics(
      section.terms,
      section.cooccurrences,
      section.coverage.classified_mentions
    ),
    [section.cooccurrences, section.coverage.classified_mentions, section.terms]
  );
  const visibleRelationships = useMemo(
    () => relationshipMetrics
      .filter(isVisibleRelationship)
      .sort((left, right) =>
        right.lift - left.lift
        || right.mention_count - left.mention_count
        || left.left_term_key.localeCompare(right.left_term_key)
        || left.right_term_key.localeCompare(right.right_term_key)
      )
      .slice(0, 28),
    [relationshipMetrics]
  );
  const selectedRelationships = useMemo(
    () => visibleRelationships
      .filter((pair) =>
        pair.left_term_key === selectedTermKey
        || pair.right_term_key === selectedTermKey
      )
      .sort((left, right) =>
        right.lift - left.lift
        || right.mention_count - left.mention_count
        || relationshipOtherKey(left, selectedTermKey).localeCompare(
          relationshipOtherKey(right, selectedTermKey)
        )
      ),
    [selectedTermKey, visibleRelationships]
  );
  const selectedSentiment = detail ? dominantEvidenceSentiment(detail) : null;
  const coveragePercent = section.coverage.coverage == null
    ? null
    : Math.round(section.coverage.coverage * 100);
  const maxCount = Math.max(1, ...section.terms.map((term) => term.mention_count));
  const insightBudget = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(4);
  const trendOption = useMemo(
    () => buildTrendOption(detail, locale, t("charts.currentPeriod")),
    [detail, locale, t]
  );
  const sentimentOption = useMemo(
    () => buildSentimentOption(detail, {
      negative: t("sentiment.negative"),
      neutral: t("sentiment.neutral"),
      positive: t("sentiment.positive")
    }),
    [detail, t]
  );
  const conversationMapOption = useMemo(
    () => buildConversationMapOption(section.terms, selectedTermKey, locale, {
      engagement: t("ranking.engagement"),
      mentions: t("ranking.volume"),
      share: t("ranking.share"),
      sentiment: t("detail.sentiment"),
      sentimentLabels: {
        positive: t("sentiment.positive"),
        neutral: t("sentiment.neutral"),
        negative: t("sentiment.negative"),
        mixed: t("sentiment.mixed"),
        not_available: t("sentiment.not_available")
      }
    }),
    [locale, section.terms, selectedTermKey, t]
  );
  const relationshipOption = useMemo(
    () => buildRelationshipOption(
      section.terms,
      visibleRelationships,
      selectedTermKey,
      locale,
      {
        associationLift: (value) => t("cooccurrence.associationLift", {
          value: new Intl.NumberFormat(locale, {
            maximumFractionDigits: 2,
            minimumFractionDigits: 1
          }).format(value)
        }),
        supportingMentions: (count) => t("cooccurrence.termMentions", { count }),
        sharedMentions: (count) => t("cooccurrence.sharedMentions", { count })
      }
    ),
    [locale, section.terms, selectedTermKey, t, visibleRelationships]
  );
  const insightCarousel = useMemo<SignalInsightCarouselData | null>(() => {
    const result = insights?.result;
    if (!result || result.items.length === 0) return null;
    const isSpanish = locale.toLowerCase().startsWith("es");
    return {
      identity: result.packet_hash,
      window: result.window,
      calculated_through: result.calculated_through,
      items: result.items.map((item) => ({
        id: `taxonomy-insight-${item.insight_id}`,
        kind: item.kind,
        tone: item.tone,
        rank: 1_000 - item.priority,
        metric: {
          current: item.supporting_mention_ids.length,
          previous: null,
          delta: null,
          delta_ratio: null,
          unit: "count" as const
        },
        chart: item.chart,
        evidence: {
          mention_ids: item.supporting_mention_ids,
          evidence_count: item.supporting_mention_ids.length
        },
        editorial: {
          state: "claude" as const,
          short_title: localizedInsightText(item.title, isSpanish),
          headline: localizedInsightText(item.headline, isSpanish),
          explanation: localizedInsightText(item.explanation, isSpanish),
          why_it_matters: localizedInsightText(item.why_it_matters, isSpanish),
          confidence: item.confidence,
          limitations: item.limitations.map((limitation) => (
            localizedInsightText(limitation, isSpanish)
          )),
          chart_aria: t("insights.chartAria", {
            title: localizedInsightText(item.title, isSpanish)
          })
        }
      }))
    };
  }, [insights?.result, locale, t]);

  const openEnrichedMention = (mentionId: string) => {
    setOpeningMentionId(mentionId);
    startMentionNavigation(() => {
      router.push(mentionHref(workspaceSlug, mentionId, filter, comparison), {
        scroll: false
      });
    });
  };

  const openEvidence = async () => {
    if (!selectedTermKey) return;
    setEvidenceOpen(true);
    setEvidence(null);
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
      <SignalV2ModuleHeader
        aside={<span className={`signal-v2-tn__state signal-v2-tn__state--${data.state}`}>
          {t(`states.${data.state}`)}
        </span>}
        controls={<>
          <SignalAnalyticsFilter
            comparison={comparison}
            coverage={coverage}
            filter={filter}
            loading={loading}
            onApply={onApplyFilter}
          />
          <SignalDataScopeFilter
            brandName={brandName}
            coverageFrom={coverage.date_from ?? filter.date_range.start}
            coverageThrough={coverage.date_through ?? filter.date_range.end}
            mentionCount={section.coverage.included_mentions}
            onOpenMentions={onOpenMentions}
          />
          <button className="signal-v2-filter" onClick={onOpenControls} type="button">
            <Funnel size={15} />
            {common("filters.more")}
          </button>
          {canRefreshInsights ? (
            <button
              className="signal-v2-filter signal-v2-filter--insights"
              disabled={insights?.state === "pending"}
              onClick={() => void runInsights()}
              title={t("insights.budgetHelp", {
                budget: insightBudget,
                limit: 200
              })}
              type="button"
            >
              {insights?.state === "pending"
                ? <SpinnerGap className="signal-v2-spin" size={15} />
                : <Sparkle size={15} weight="fill" />}
              {insights?.run?.status === "queued"
                ? t("insights.queued")
                : insights?.run?.status === "running" || insights?.state === "pending"
                  ? t("insights.running")
                  : insights?.state === "ready"
                    ? t("insights.refreshWithBudget", { budget: insightBudget })
                    : t("insights.actionWithBudget", { budget: insightBudget })}
            </button>
          ) : null}
        </>}
        icon={<Quotes size={20} weight="fill" />}
        status={t("status")}
        subtitle={t("subtitle")}
        title={t("title")}
      />

      {!coverageNoticeDismissed
      && (data.state === "partial" || section.coverage.quality_state === "partial") ? (
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
          <button
            aria-label={t("partial.dismiss")}
            onClick={() => setCoverageNoticeDismissed(true)}
            type="button"
          >
            <X size={14} />
          </button>
        </section>
      ) : null}

      {insightRunError ? (
        <div className="signal-v2-error" role="alert">
          <span>{insightRunError}</span>
          <button onClick={() => setInsightRunError(null)} type="button">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {insightCarousel ? (
        <MonthlyInsightCarousel
          insights={insightCarousel}
          labels={{
            aria: t("insights.aria"),
            useful: t("insights.eyebrow"),
            fixedWindow: t("insights.fixedWindow"),
            why: t("insights.why"),
            whyItMatters: t("insights.whyItMatters"),
            limitations: t("insights.limitations"),
            openEvidence: t("insights.openEvidence")
          }}
          onOpenEvidence={(insight: SignalInsightCarouselItem) => {
            const mentionId = insight.evidence.mention_ids[0];
            if (mentionId) openEnrichedMention(mentionId);
          }}
          secondaryMeta={t("insights.sampleMeta", {
            analyzed: insights?.result?.sample.analyzed_mentions ?? 0,
            population: insights?.result?.sample.population_mentions ?? 0
          })}
        />
      ) : (
        <section className="signal-v2-tn__insight-status" aria-busy={insightsLoading || insights?.state === "pending"}>
          {insightsLoading || insights?.state === "pending"
            ? <SpinnerGap className="signal-v2-spin" size={17} />
            : <Sparkle size={17} weight="fill" />}
          <div>
            <strong>{t("insights.emptyTitle")}</strong>
            <p>
              {insightsLoading
                ? t("insights.loadingBody")
                : insights?.state === "ready"
                ? t("insights.noFindings", {
                    analyzed: insights.enrichment.analyzed_mentions
                  })
                : insights?.state === "pending"
                  ? t("insights.pendingBody", {
                      analyzed: insightQueueSample?.analyzed_mentions ?? insights.enrichment.analyzed_mentions,
                      population: insightQueueSample?.population_mentions ?? 0
                    })
                  : t("insights.emptyBody", {
                      budget: insightBudget,
                      limit: 200
                    })}
            </p>
          </div>
        </section>
      )}

      <div
        aria-busy={loading}
        className={`signal-v2-tn__data-stage${loading ? " signal-v2-dashboard-stage--loading" : ""}`}
      >
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
          onClick={() => selectKind("topic")}
          role="tab"
          type="button"
        >
          {t("tabs.topics")}
          <span>{data.topics.terms.length}</span>
        </button>
        <button
          aria-selected={kind === "narrative"}
          onClick={() => selectKind("narrative")}
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
              <div className="signal-v2-tn__view-switch" role="group" aria-label={t("ranking.viewLabel")}>
                <button
                  aria-pressed={rankingView === "map"}
                  onClick={() => setRankingView("map")}
                  type="button"
                >
                  {t("ranking.map")}
                </button>
                <button
                  aria-pressed={rankingView === "list"}
                  onClick={() => setRankingView("list")}
                  type="button"
                >
                  {t("ranking.list")}
                </button>
              </div>
            </header>
            {rankingView === "map" ? (
              <div className="signal-v2-tn__conversation-map">
                <div className="signal-v2-tn__map-legend" aria-label={t("ranking.sentimentLegend")}>
                  {(["positive", "neutral", "negative", "mixed", "not_available"] as const).map((sentiment) => (
                    <span key={sentiment}>
                      <i className={`is-${sentiment}`} />
                      {t(`sentiment.${sentiment}`)}
                    </span>
                  ))}
                </div>
                <SignalEChart
                  ariaLabel={kind === "topic" ? t("charts.topicMap") : t("charts.narrativeMap")}
                  className="signal-v2-tn__bubble-chart"
                  onDatumClick={(termKey) => selectTerm(termKey)}
                  option={conversationMapOption}
                />
              </div>
            ) : (
              <>
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
                  onClick={() => selectTerm(term.term_key)}
                  type="button"
                >
                  <span className="signal-v2-tn__term">
                    <strong>{displayTermLabel(term.label, locale)}</strong>
                    <i><b style={{ width: `${Math.max(3, term.mention_count / maxCount * 100)}%` }} /></i>
                  </span>
                  <b>{formatNumber(term.mention_count, locale)}</b>
                  <span>{formatShare(term.share_of_included, locale)}</span>
                  <ShareDelta value={term.share_delta} locale={locale} />
                  <CaretRight size={14} />
                </button>
              ))}
            </div>
              </>
            )}
          </section>

          <section className="signal-v2-card signal-v2-tn__detail">
            <header className="signal-v2-card__heading">
              <div>
                <small>{t("detail.eyebrow")}</small>
                <h2>
                  <SignalMetricHelp
                    content={{
                      title: t("helpers.interpretation.title"),
                      body: t("helpers.interpretation.body"),
                      reading: t("helpers.interpretation.reading")
                    }}
                    label={kind === "topic" ? t("detail.topicDetail") : t("detail.narrativeDetail")}
                  />
                </h2>
              </div>
            </header>
            {detailLoading ? (
              <TnDetailSkeleton label={common("actions.loading")} />
            ) : detailError ? (
              <div className="signal-v2-tn__unavailable" role="status">
                <p>{t("detail.notAvailable")}</p>
                <button
                  className="signal-v2-tn__button"
                  onClick={() => setDetailRetryVersion((version) => version + 1)}
                  type="button"
                >
                  {t("detail.retry")}
                </button>
              </div>
            ) : detail ? (
              <>
                <div className="signal-v2-tn__definition">
                  <strong>{displayTermLabel(detail.term.label, locale)}</strong>
                  <p>{governedTermDescription(detail, locale)}</p>
                </div>
                <div className="signal-v2-tn__term-metrics">
                  <article>
                    <small>
                      <SignalMetricHelp
                        content={{
                          title: t("helpers.supportingMentions.title"),
                          body: t("helpers.supportingMentions.body"),
                          reading: t("helpers.supportingMentions.reading")
                        }}
                        label={t("detail.mentions")}
                      />
                    </small>
                    <strong>{formatNumber(detail.term.mention_count, locale)}</strong>
                  </article>
                  <article>
                    <small>
                      <SignalMetricHelp
                        content={{
                          title: t("helpers.periodShare.title"),
                          body: t("helpers.periodShare.body"),
                          reading: t("helpers.periodShare.reading")
                        }}
                        label={t("detail.share")}
                      />
                    </small>
                    <strong>{formatShare(detail.term.share_of_included, locale)}</strong>
                    {detail.term.share_delta == null ? null : (
                      <span className="signal-v2-tn__metric-comparison">
                        {t("detail.previousPeriod", {
                          change: formatShareDelta(detail.term.share_delta, locale)
                        })}
                      </span>
                    )}
                  </article>
                  <article>
                    <small>
                      <SignalMetricHelp
                        content={{
                          title: t("helpers.sentimentEvidence.title"),
                          body: t("helpers.sentimentEvidence.body"),
                          reading: t("helpers.sentimentEvidence.reading")
                        }}
                        label={t("detail.sentiment")}
                      />
                    </small>
                    <strong>
                      {selectedSentiment
                        ? t(`sentiment.${selectedSentiment}`)
                        : "—"}
                    </strong>
                  </article>
                </div>
                <div className="signal-v2-tn__detail-charts">
                  <article>
                    <h3 className="signal-v2-tn__subheading">
                      <SignalMetricHelp
                        content={{
                          title: t("helpers.trend.title"),
                          body: t("helpers.trend.body"),
                          reading: t("helpers.trend.reading")
                        }}
                        label={t("detail.presence")}
                      />
                    </h3>
                    <SignalEChart
                      ariaLabel={t("charts.termTrend", { term: displayTermLabel(detail.term.label, locale) })}
                      className="signal-v2-tn__trend"
                      option={trendOption}
                    />
                  </article>
                  <article>
                    <h3 className="signal-v2-tn__subheading">
                      <SignalMetricHelp
                        content={{
                          title: t("helpers.sentimentEvidence.title"),
                          body: t("helpers.sentimentEvidence.body"),
                          reading: t("helpers.sentimentEvidence.reading")
                        }}
                        label={t("detail.sentimentComposition")}
                      />
                    </h3>
                    <SignalEChart
                      ariaLabel={t("charts.sentimentMix", { term: displayTermLabel(detail.term.label, locale) })}
                      className="signal-v2-tn__sentiment-chart"
                      option={sentimentOption}
                    />
                    <div className="signal-v2-tn__sentiment-legend">
                      <div>
                        <i className="is-positive" />
                        <span>{t("sentiment.positive")}</span>
                        <strong>{detail.sentiment.positive_mentions}</strong>
                      </div>
                      <div>
                        <i className="is-neutral" />
                        <span>{t("sentiment.neutral")}</span>
                        <strong>{detail.sentiment.neutral_mentions}</strong>
                      </div>
                      <div>
                        <i className="is-negative" />
                        <span>{t("sentiment.negative")}</span>
                        <strong>{detail.sentiment.negative_mentions}</strong>
                      </div>
                    </div>
                  </article>
                </div>
                <div className="signal-v2-tn__preview">
                  <div>
                    <strong>{t("detail.composition")}</strong>
                  </div>
                  {evidencePreviewLoading ? (
                    <TnEvidencePreviewSkeleton />
                  ) : evidencePreview?.records.slice(0, 5).map((record) => (
                    <button key={record.mention_id} onClick={() => void openEvidence()} type="button">
                      <span>
                        <SignalSourceIcon
                          label={record.platform ?? t("evidence.unknownSource")}
                          platform={record.platform}
                          size={15}
                        />
                        {record.platform ?? t("evidence.unknownSource")}
                      </span>
                      <p>{record.evidence_quotes[0]?.quote ?? record.text_snippet ?? record.title ?? t("evidence.noText")}</p>
                      <CaretRight size={13} />
                    </button>
                  ))}
                </div>
                <div className="signal-v2-tn__detail-actions">
                  <span>
                    {evidencePreview
                    && evidencePreview.page.total_count > Math.min(5, evidencePreview.records.length)
                      ? t("detail.additionalEvidence", {
                          count: evidencePreview.page.total_count - Math.min(5, evidencePreview.records.length)
                        })
                      : null}
                  </span>
                  <button className="signal-v2-tn__button" onClick={() => void openEvidence()} type="button">
                    {t("detail.openEvidence")}
                    <ArrowRight size={14} />
                  </button>
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
                    label={kind === "topic"
                      ? t("cooccurrence.topicTitle")
                      : t("cooccurrence.narrativeTitle")}
                  />
                </h2>
              </div>
            </header>
            <div className="signal-v2-tn__relationship-layout">
              <div className="signal-v2-tn__relationship-visual">
                <div className="signal-v2-tn__relationship-toolbar">
                  <strong>
                    {t(kind === "topic"
                      ? "cooccurrence.topicMapContext"
                      : "cooccurrence.narrativeMapContext", {
                      term: selectedMetric
                        ? displayTermLabel(selectedMetric.label, locale)
                        : t("detail.title")
                    })}
                  </strong>
                  <small>{t("cooccurrence.navigationHint")}</small>
                </div>
                {visibleRelationships.length > 0 ? (
                  <SignalEChart
                    key={`${kind}:${data.filters_hash}`}
                    ariaLabel={kind === "topic"
                      ? t("charts.topicRelationships")
                      : t("charts.narrativeRelationships")}
                    className="signal-v2-tn__relationship-chart"
                    onDatumClick={(termKey) => {
                      if (section.terms.some((term) => term.term_key === termKey)) selectTerm(termKey);
                    }}
                    option={relationshipOption}
                  />
                ) : (
                  <p className="signal-v2-tn__relationship-empty">{t("cooccurrence.empty")}</p>
                )}
              </div>
              <aside className="signal-v2-tn__co-list">
                <strong>{t("cooccurrence.listTitle")}</strong>
                <p>{t("cooccurrence.listBody")}</p>
                {selectedRelationships.length > 0 ? (
                  selectedRelationships.slice(0, 8).map((pair) => {
                    const relatedTermKey = relationshipOtherKey(pair, selectedTermKey);
                    return (
                      <button
                        key={`${pair.left_term_key}:${pair.right_term_key}`}
                        onClick={() => selectTerm(relatedTermKey)}
                        type="button"
                      >
                        <span>{displayTermLabel(labelFor(section.terms, relatedTermKey), locale)}</span>
                        <small>
                          {t("cooccurrence.sharedMentions", { count: pair.mention_count })}
                          <b>
                            {t("cooccurrence.associationLift", {
                              value: new Intl.NumberFormat(locale, {
                                maximumFractionDigits: 2,
                                minimumFractionDigits: 1
                              }).format(pair.lift)
                            })}
                          </b>
                        </small>
                        <CaretRight size={14} />
                      </button>
                    );
                  })
                ) : (
                  <p className="signal-v2-tn__co-list-empty">
                    {t("cooccurrence.selectedEmpty")}
                  </p>
                )}
              </aside>
            </div>
          </section>
        </div>
      )}
      </div>

      {evidenceOpen ? (
        <SignalEvidenceDrawer
          ariaLabel={t("evidence.title")}
          closeLabel={t("evidence.close")}
          emptyLabel={t("evidence.empty")}
          errorMessage={evidenceError ? t("errors.evidence") : null}
          eyebrow={kind === "topic" ? t("tabs.topics") : t("tabs.narratives")}
          intro={t("evidence.body")}
          loadMoreLabel={evidence?.page.next_cursor ? t("evidence.loadMore") : undefined}
          loading={evidenceLoading}
          loadingLabel={common("actions.loading")}
          onClose={() => setEvidenceOpen(false)}
          onLoadMore={evidence?.page.next_cursor ? () => void loadMoreEvidence() : undefined}
          onOpenEnriched={(record) => openEnrichedMention(record.id)}
          openOriginalLabel={t("evidence.openOriginal")}
          openingEnrichedLabel={t("evidence.openingEnriched")}
          openingRecordId={mentionNavigationPending ? openingMentionId : null}
          records={(evidence?.records ?? []).map((record): SignalEvidenceDrawerRecord => ({
            body: record.text_snippet ?? record.title ?? t("evidence.noText"),
            id: record.mention_id,
            occurredAt: record.occurred_at,
            originalUrl: record.url,
            platform: record.platform ?? t("evidence.unknownSource"),
            quote: record.evidence_quotes[0]?.quote
          }))}
          title={selectedMetric ? displayTermLabel(selectedMetric.label, locale) : t("evidence.title")}
          viewEnrichedLabel={t("evidence.viewEnriched")}
        />
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

function TnDetailSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-label={label || undefined}
      className="signal-v2-tn__detail-skeleton"
      role={label ? "status" : undefined}
    >
      <div className="signal-v2-tn__definition">
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--term" />
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--copy" />
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--copy-short" />
      </div>
      <div className="signal-v2-tn__term-metrics signal-v2-tn__skeleton-metrics">
        <article><i /><b /></article>
        <article><i /><b /><em /></article>
        <article><i /><b /></article>
      </div>
      <div className="signal-v2-tn__detail-charts">
        <article>
          <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--subheading" />
          <i className="signal-v2-tn__skeleton-chart signal-v2-tn__skeleton-chart--trend" />
        </article>
        <article>
          <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--subheading" />
          <i className="signal-v2-tn__skeleton-chart signal-v2-tn__skeleton-chart--donut" />
          <div className="signal-v2-tn__skeleton-legend"><i /><i /><i /></div>
        </article>
      </div>
      <div className="signal-v2-tn__preview">
        <div><i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--subheading" /></div>
        <TnEvidencePreviewSkeleton />
      </div>
      <div className="signal-v2-tn__detail-actions signal-v2-tn__skeleton-actions">
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--meta" />
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--button" />
      </div>
    </div>
  );
}

function TnEvidencePreviewSkeleton() {
  return (
    <div className="signal-v2-tn__preview-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <i key={index}>
          <span />
          <b />
        </i>
      ))}
    </div>
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
  if (comparison.mode !== "none" && comparison.date_range) {
    params.set("comparison_start", comparison.date_range.start);
    params.set("comparison_end", comparison.date_range.end);
  }
  return params;
}

function mentionHref(
  workspaceSlug: string,
  mentionId: string,
  filter: SignalFilterV1,
  comparison: SignalComparisonV1
) {
  const params = taxonomyQuery(filter, comparison);
  params.set("mention", mentionId);
  return `/signal/${encodeURIComponent(workspaceSlug)}/mentions?${params}`;
}

function governedTermDescription(detail: SignalTaxonomyTermDetailV1, locale: string) {
  const descriptions = [detail.term.definition, detail.term.statement]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(descriptions)).join(" ")
    || displayTermLabel(detail.term.label, locale);
}

function dominantEvidenceSentiment(detail: SignalTaxonomyTermDetailV1) {
  if (detail.sentiment.classified_mentions <= 0) return null;
  const values = [
    { key: "positive" as const, count: detail.sentiment.positive_mentions },
    { key: "neutral" as const, count: detail.sentiment.neutral_mentions },
    { key: "negative" as const, count: detail.sentiment.negative_mentions }
  ];
  return values.sort((left, right) => right.count - left.count)[0]?.key ?? null;
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
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 10,
        hideOverlap: true
      }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 10
      },
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

function buildSentimentOption(
  detail: SignalTaxonomyTermDetailV1 | null,
  labels: { negative: string; neutral: string; positive: string }
): EChartsCoreOption {
  const sentiment = detail?.sentiment;
  const total = sentiment?.classified_mentions ?? 0;
  return {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number };
        return `<strong>${item.name ?? ""}</strong><br/>${item.value ?? 0} · ${Number(item.percent ?? 0).toFixed(1)}%`;
      },
      backgroundColor: "#fff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      textStyle: { color: TEXT, fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    },
    graphic: [{
      type: "text",
      left: "center",
      top: "middle",
      style: {
        text: String(total),
        fill: TEXT,
        font: "700 24px Product Sans, Google Sans, sans-serif",
        textAlign: "center",
        textVerticalAlign: "middle"
      }
    }],
    series: [{
      type: "pie",
      radius: ["58%", "78%"],
      center: ["50%", "50%"],
      minAngle: 2,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { show: false },
      emphasis: { scaleSize: 4 },
      data: [
        { name: labels.positive, value: sentiment?.positive_mentions ?? 0, itemStyle: { color: "#008060" } },
        { name: labels.neutral, value: sentiment?.neutral_mentions ?? 0, itemStyle: { color: "#d7d7d7" } },
        { name: labels.negative, value: sentiment?.negative_mentions ?? 0, itemStyle: { color: "#d72c0d" } }
      ]
    }]
  };
}

function buildConversationMapOption(
  terms: SignalTaxonomyTermMetricV1[],
  selectedTermKey: string | null,
  locale: string,
  labels: {
    engagement: string;
    mentions: string;
    share: string;
    sentiment: string;
    sentimentLabels: Record<
      NonNullable<SignalTaxonomyTermMetricV1["dominant_sentiment"]>,
      string
    >;
  }
): EChartsCoreOption {
  const maxShare = Math.max(
    0.01,
    ...terms.map((term) => (term.share_of_included ?? 0) * 100)
  );
  const maxMentions = Math.max(1, ...terms.map((term) => term.mention_count));
  const maxEngagement = Math.max(1, ...terms.map((term) => term.engagement_total ?? 0));
  const engagementAxisMax = 10 ** Math.ceil(Math.log10(maxEngagement + 1));
  return {
    grid: {
      left: 6,
      right: 12,
      top: 24,
      bottom: 8,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel"
    },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: unknown) => {
        const item = params as {
          data?: {
            engagement?: number;
            label?: string;
            mentions?: number;
            share?: number;
            sentiment?: NonNullable<SignalTaxonomyTermMetricV1["dominant_sentiment"]>;
          };
        };
        const datum = item.data ?? {};
        const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
        return [
          `<strong>${datum.label ?? ""}</strong>`,
          `${labels.mentions}: ${number.format(datum.mentions ?? 0)}`,
          `${labels.engagement}: ${number.format(datum.engagement ?? 0)}`,
          `${labels.share}: ${number.format(datum.share ?? 0)}%`,
          `${labels.sentiment}: ${labels.sentimentLabels[datum.sentiment ?? "not_available"]}`
        ].join("<br/>");
      },
      backgroundColor: "#fff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      textStyle: { color: TEXT, fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    },
    xAxis: {
      type: "value",
      max: Math.ceil(maxMentions * 1.12),
      minInterval: 1,
      name: labels.mentions,
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 11
      },
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 10
      },
      axisLine: { lineStyle: { color: GRID } },
      splitLine: { lineStyle: { color: GRID } }
    },
    yAxis: {
      type: "log",
      logBase: 10,
      min: 1,
      max: engagementAxisMax,
      name: labels.engagement,
      nameTextStyle: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 11
      },
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 10,
        formatter: (value: number) => new Intl.NumberFormat(locale, {
          maximumFractionDigits: 0,
          notation: value >= 10_000 ? "compact" : "standard"
        }).format(Math.max(0, value - 1))
      },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: GRID } }
    },
    series: [{
      type: "scatter",
      symbolSize: (value: unknown) => {
        const values = Array.isArray(value) ? value : [0, 0, 0];
        const share = Number(values[2] ?? 0);
        return 16 + Math.sqrt(share / maxShare) * 38;
      },
      itemStyle: {
        color: BLUE,
        borderColor: "#fff",
        borderWidth: 2,
        opacity: 0.78
      },
      emphasis: { focus: "self", scale: 1.1 },
      data: terms.map((term) => {
        const selected = term.term_key === selectedTermKey;
        const sentiment = term.dominant_sentiment ?? "not_available";
        return {
          name: term.term_key,
          label: displayTermLabel(term.label, locale),
          mentions: term.mention_count,
          engagement: term.engagement_total ?? 0,
          share: (term.share_of_included ?? 0) * 100,
          sentiment,
          itemStyle: {
            color: sentimentColor(sentiment),
            borderColor: selected ? "#303030" : "#fff",
            borderWidth: selected ? 3 : 2,
            opacity: selected ? 1 : 0.76
          },
          value: [
            term.mention_count,
            (term.engagement_total ?? 0) + 1,
            (term.share_of_included ?? 0) * 100
          ],
          z: selected ? 3 : 1
        };
      })
    }]
  };
}

function buildRelationshipOption(
  terms: SignalTaxonomyTermMetricV1[],
  relationships: RelationshipMetric[],
  selectedTermKey: string | null,
  locale: string,
  labels: {
    associationLift: (value: number) => string;
    supportingMentions: (count: number) => string;
    sharedMentions: (count: number) => string;
  }
): EChartsCoreOption {
  const graphKeys = new Set<string>();
  for (const relationship of relationships) {
    graphKeys.add(relationship.left_term_key);
    graphKeys.add(relationship.right_term_key);
  }
  if (selectedTermKey) graphKeys.add(selectedTermKey);
  const neighborKeys = new Set(
    relationships
      .filter((relationship) =>
        relationship.left_term_key === selectedTermKey
        || relationship.right_term_key === selectedTermKey
      )
      .map((relationship) => relationshipOtherKey(relationship, selectedTermKey))
  );
  const graphTerms = terms.filter((term) => graphKeys.has(term.term_key));
  const maxMentions = Math.max(1, ...graphTerms.map((term) => term.mention_count));
  const maxShared = Math.max(1, ...relationships.map((pair) => pair.mention_count));
  const nodes = graphTerms.map((term) => {
    const selected = term.term_key === selectedTermKey;
    const adjacent = selected || neighborKeys.has(term.term_key);
    const sentiment = term.dominant_sentiment ?? "not_available";
    return {
      name: term.term_key,
      displayName: displayTermLabel(term.label, locale),
      value: term.mention_count,
      symbolSize: 22 + Math.sqrt(term.mention_count / maxMentions) * 26,
      itemStyle: {
        color: sentimentColor(sentiment),
        borderColor: selected ? "#155b9b" : "#fff",
        borderWidth: selected ? 3 : 2,
        opacity: selectedTermKey && !adjacent ? 0.48 : 0.92
      },
      label: {
        color: selected ? "#1f1f1f" : TEXT,
        fontWeight: selected ? 650 : 500
      },
      z: selected ? 4 : adjacent ? 3 : 1
    };
  });
  return {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: unknown) => {
        const item = params as {
          dataType?: string;
          data?: {
            displayName?: string;
            lift?: number;
            sharedCount?: number;
            value?: number;
          };
        };
        return item.dataType === "edge"
          ? [
              labels.sharedMentions(item.data?.sharedCount ?? item.data?.value ?? 0),
              labels.associationLift(item.data?.lift ?? 0)
            ].join("<br/>")
          : [
              `<strong>${item.data?.displayName ?? ""}</strong>`,
              labels.supportingMentions(item.data?.value ?? 0)
            ].join("<br/>");
      },
      backgroundColor: "#fff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      textStyle: { color: TEXT, fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    },
    series: [{
      type: "graph",
      layout: "force",
      left: 28,
      right: 28,
      top: 24,
      bottom: 28,
      roam: true,
      draggable: true,
      scaleLimit: { min: 0.62, max: 3.5 },
      force: {
        edgeLength: [92, 178],
        friction: 0.48,
        gravity: 0.08,
        layoutAnimation: false,
        repulsion: 190
      },
      label: {
        show: true,
        color: TEXT,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 12,
        lineHeight: 15,
        position: "right",
        distance: 7,
        formatter: (params: unknown) => {
          const item = params as { data?: { displayName?: string } };
          return item.data?.displayName ?? "";
        }
      },
      itemStyle: { color: BLUE_SOFT, borderColor: BLUE, borderWidth: 1 },
      lineStyle: { color: "#9ca3a8", curveness: 0.05, opacity: 0.55 },
      emphasis: { focus: "adjacency" },
      data: nodes,
      links: relationships.map((pair) => {
        const touchesSelection = pair.left_term_key === selectedTermKey
          || pair.right_term_key === selectedTermKey;
        return {
          source: pair.left_term_key,
          target: pair.right_term_key,
          sharedCount: pair.mention_count,
          lift: pair.lift,
          value: pair.mention_count,
          lineStyle: {
            color: touchesSelection ? "#6d8292" : "#aeb4b8",
            opacity: selectedTermKey ? (touchesSelection ? 0.9 : 0.23) : 0.55,
            width: 1 + Math.sqrt(pair.mention_count / maxShared) * 3.5
          }
        };
      })
    }]
  };
}

function buildRelationshipMetrics(
  terms: SignalTaxonomyTermMetricV1[],
  cooccurrences: SignalTaxonomyCooccurrenceV1[],
  classifiedMentions: number
): RelationshipMetric[] {
  const counts = new Map(terms.map((term) => [term.term_key, term.mention_count]));
  return cooccurrences.flatMap((pair) => {
    const leftCount = counts.get(pair.left_term_key) ?? 0;
    const rightCount = counts.get(pair.right_term_key) ?? 0;
    const expectedCount = classifiedMentions > 0
      ? leftCount * rightCount / classifiedMentions
      : 0;
    if (expectedCount <= 0) return [];
    return [{
      ...pair,
      expected_count: expectedCount,
      lift: pair.mention_count / expectedCount
    }];
  });
}

function isVisibleRelationship(relationship: RelationshipMetric) {
  return relationship.mention_count >= MIN_RELATIONSHIP_MENTIONS
    && relationship.lift >= MIN_RELATIONSHIP_LIFT;
}

function labelFor(terms: SignalTaxonomyTermMetricV1[], key: string) {
  return terms.find((term) => term.term_key === key)?.label ?? key;
}

function relationshipOtherKey(
  pair: SignalTaxonomyCooccurrenceV1,
  selectedTermKey: string | null
) {
  return pair.left_term_key === selectedTermKey
    ? pair.right_term_key
    : pair.left_term_key;
}

function sentimentColor(
  sentiment: NonNullable<SignalTaxonomyTermMetricV1["dominant_sentiment"]>
) {
  return {
    positive: "#07845f",
    neutral: "#a7a7a7",
    negative: "#d83b25",
    mixed: "#5c83a3",
    not_available: "#9fc9e8"
  }[sentiment];
}

function localizedInsightText(
  value: { en_us: string; es_mx: string },
  isSpanish: boolean
) {
  return isSpanish ? value.es_mx : value.en_us;
}

function displayTermLabel(value: string, locale: string) {
  const normalized = value.replaceAll("_", " ").replace(/\s+/gu, " ").trim();
  const preserved = new Map([
    ["laika", "Laika"],
    ["petco", "Petco"],
    ["tiktok", "TikTok"],
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["youtube", "YouTube"],
    ["google", "Google"],
    ["méxico", "México"],
    ["mexico", "México"],
    ["cx", "CX"],
    ["t&b", "T&B"]
  ]);
  const sentenceCase = normalized
    .toLocaleLowerCase(locale)
    .split(" ")
    .map((part, index) => preserved.get(part)
      ?? (index === 0 ? part.charAt(0).toLocaleUpperCase(locale) + part.slice(1) : part))
    .join(" ");
  if (!locale.toLocaleLowerCase().startsWith("es")) return sentenceCase;
  const spanishDisplayCorrections = new Map([
    ["adopcion", "adopción"],
    ["atencion", "atención"],
    ["comparacion", "comparación"],
    ["fisica", "física"],
    ["humanizacion", "humanización"],
    ["logistica", "logística"],
    ["membresia", "membresía"],
    ["nutricion", "nutrición"],
    ["percepcion", "percepción"],
    ["proposito", "propósito"],
    ["suscripcion", "suscripción"]
  ]);
  return sentenceCase
    .split(" ")
    .map((part) => spanishDisplayCorrections.get(part.toLocaleLowerCase(locale))
      ?? part)
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

function formatShareDelta(value: number, locale: string) {
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    signDisplay: "always"
  }).format(value * 100)} pp`;
}

function formatDate(value: string, locale: string, compact = false) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, compact
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}
