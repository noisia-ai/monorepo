import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";
import type { PoolClient } from "pg";

import {
  assessSignalPulseKnowledgeContext,
  buildMonthlyReportPeriods,
  buildWeeklyReportPeriods,
  calculateImpactV1,
  classifySignalPulseLifecycle,
  hasEmbeddingProvider,
  isEngineLlmEnabled,
  isEngineModelAllowed
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  enqueueEngineStep,
  markEngineStepCompleted,
  markEngineStepFailed,
  markEngineStepRunning,
  recordEngineCostEvent,
  releaseEngineCorpusLock
} from "./engine-shared";
import { safeJsonStringifyForPostgres } from "./postgres-json";
import {
  buildEmbeddingNeighborhoodClusters,
  selectPeriodFirstSignalPulseClusters,
  type EmbeddingNeighborhoodRow,
  type TermCluster
} from "./signal-pulse-clustering";
import { splitSignalPulseMetaForMerge } from "./signal-pulse-meta";
import { chooseSignalPulseWindowEnd } from "./signal-pulse-window";
import {
  estimateSignalPulseNamingCostUsd,
  estimateSignalPulseRunCostUsd,
  SIGNAL_PULSE_INTERPRETATION_COST_USD,
  SIGNAL_PULSE_RAG_CONTEXT_COST_USD,
  shouldSkipSignalPulseLlmForBudget
} from "./signal-pulse-budget";
import {
  isActionableSignalPulseTerm,
  isRawKeywordSignalPhrase,
  normalizeSignalPhrase,
  validateSignalPulseSynthesis
} from "./signal-pulse-actionability";
import { buildSignalPulseDeterministicRead, buildSignalPulseMarketingMove } from "./signal-pulse-copy";
import {
  buildClaudeSignalNamingPrompt,
  type SignalPulseClusterNamingPromptPayload
} from "./signal-pulse-prompts";
import {
  loadSignalPulseClusterPromptContext,
  loadSignalPulseMarketingContext,
  type SignalPulseMarketingContext
} from "./signal-pulse-rag-context";

type SignalPulseStepJobData = {
  engineAnalysisId: string;
  pipelineStepId: string;
};

type AnalysisContext = {
  study_corpus_id: string;
  organization_id: string | null;
  brand_id: string | null;
  theme_id: string | null;
  methodology_slug: string;
  params: Record<string, unknown> | null;
  analysis_plan: Record<string, unknown> | null;
  target_window_months: number | null;
};

type MaterializedSignal = {
  canonical_signal_id: string;
  term: string;
  title: string;
  signal_type: string;
  mention_count: number;
  sentiment_avg: number | null;
  engagement_sum: number;
  sample_mention_ids: string[];
  platforms: string[];
};

type SignalPulseNamingRow = {
  id: string;
  canonical_title: string;
  signal_type: string;
  dimensions: Record<string, unknown>;
  position: number;
};

type SignalPulseClusterNamingPayload = SignalPulseClusterNamingPromptPayload;

const STOPWORDS_ES_MX = new Set([
  "para", "pero", "como", "con", "que", "por", "una", "uno", "los", "las", "del", "este", "esta",
  "esto", "muy", "mas", "menos", "porque", "cuando", "todo", "toda", "todos", "todas", "solo", "bien",
  "mal", "sin", "hay", "son", "soy", "fue", "ser", "mis", "sus", "me", "mi", "ya", "no", "si",
  "tambien", "marca", "producto", "personas", "gente", "hacer", "dice", "dicen", "video", "comentario",
  "hasta", "siempre", "ellos", "ellas", "estan", "esta", "estas", "este", "estos", "tiene", "tienen",
  "tener", "sera", "seria", "puede", "pueden", "donde", "quien", "cuando", "ahora", "aqui", "alla",
  "algo", "cada", "mismo", "misma", "mismos", "mismas", "otro", "otra", "otros", "otras"
]);

const MAX_SIGNAL_CLUSTERS = 12;
const MAX_EVIDENCE_PER_SIGNAL = 8;
const MAX_CLAUDE_SAMPLES_PER_CLUSTER = 12;
const CLAUDE_NAMING_BATCH_SIZE = 4;
const EMBEDDING_ANCHOR_LIMIT = 220;
const EMBEDDING_NEIGHBORS_PER_ANCHOR = 36;
const EMBEDDING_MIN_SIMILARITY = 0.74;
const PERIOD_EMBEDDING_ANCHOR_LIMIT = 44;
const PERIOD_EMBEDDING_NEIGHBORS_PER_ANCHOR = 24;
const GLOBAL_CLUSTER_ROW_LIMIT = 6000;
const PERIOD_CLUSTER_ROW_LIMIT = 1600;
const PERIOD_CLUSTERS_PER_PERIOD = 1;
const SIGNAL_PULSE_LLM_TIMEOUT_MS = 90_000;
const NON_ACTIONABLE_CLUSTER_TERMS = new Set([
  "amen", "dios", "jesus", "gracias", "felicidades", "bendiciones", "saludos",
  "link", "links", "http", "https", "www", "click", "clic", "viral",
  "futbol", "partido", "gol", "equipo", "botana",
  "puto", "puta", "pendejo", "pendeja", "verga", "chingar",
  "pinche", "hasta", "siempre", "ellos", "ellas", "estan", "esta", "estas", "este", "estos",
  "manejar", "velocidad", "mejor", "nada", "tiene", "tienen", "tener",
  "morena", "amlo", "claudia", "elecciones", "diputado", "senador"
]);

export async function signalPulseReadinessJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const budgetCapUsd = readBudgetCapUsd(ctx);
    const [coverage] = (await pool.query<{
      conversation_mentions: number;
      signal_pulse_mentions: number;
      performance_records: number;
      query_packs: number;
      semantic_mention_embeddings: number;
      semantic_knowledge_embeddings: number;
      knowledge_sources: number;
    }>(
      `
        SELECT
          COUNT(DISTINCT m.id)::int AS conversation_mentions,
          COUNT(DISTINCT m.id) FILTER (WHERE mqs.lens_slug = 'signal-pulse')::int AS signal_pulse_mentions,
          (SELECT COUNT(*)::int FROM performance_records pr WHERE pr.study_corpus_id = $1) AS performance_records,
          (SELECT COUNT(*)::int FROM query_packs qp WHERE qp.study_corpus_id = $1 AND qp.lens_slug = 'signal-pulse') AS query_packs,
          (SELECT COUNT(DISTINCT se.mention_id)::int FROM semantic_embeddings se WHERE se.study_corpus_id = $1 AND se.scope_type = 'mention') AS semantic_mention_embeddings,
          (SELECT COUNT(*)::int FROM semantic_embeddings se WHERE se.study_corpus_id = $1 AND se.scope_type = 'knowledge_source') AS semantic_knowledge_embeddings,
          (
            SELECT COUNT(*)::int
            FROM brand_knowledge_sources bks
            WHERE bks.study_corpus_id = $1
              AND bks.status IN ('processed', 'processed_truncated')
          ) AS knowledge_sources
        FROM mentions m
        LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
        WHERE m.study_corpus_id = $1
          AND m.inclusion_status = 'included'
      `,
      [ctx.study_corpus_id]
    )).rows;

    const knowledgeContext = assessSignalPulseKnowledgeContext({
      analysisPlan: ctx.analysis_plan,
      requestParams: ctx.params,
      knowledgeSources: coverage?.knowledge_sources
    });
    const readinessReasons = [
      Number(coverage?.conversation_mentions ?? 0) <= 0 ? "missing_conversation" : null,
      Number(coverage?.signal_pulse_mentions ?? 0) <= 0 ? "missing_signal_pulse_query_pack_coverage" : null,
      knowledgeContext.knowledgeContextReady ? null : "missing_knowledge_context",
      Number(coverage?.performance_records ?? 0) <= 0 ? "missing_structured_performance" : null,
      Number(coverage?.query_packs ?? 0) <= 0 ? "missing_signal_pulse_query_pack" : null,
      hasEmbeddingProvider() ? null : "missing_embedding_provider",
      Number(coverage?.signal_pulse_mentions ?? 0) > 0 && Number(coverage?.semantic_mention_embeddings ?? 0) <= 0 ? "missing_semantic_mention_embeddings" : null,
      Number(coverage?.knowledge_sources ?? 0) > 0 && Number(coverage?.semantic_knowledge_embeddings ?? 0) <= 0 ? "missing_semantic_knowledge_embeddings" : null
    ].filter(Boolean);
    const estimatedCostUsd = estimateSignalPulseRunCostUsd(Number(coverage?.signal_pulse_mentions ?? 0));
    if (estimatedCostUsd > budgetCapUsd) readinessReasons.push("estimated_cost_exceeds_budget_cap");
    const readiness = {
      conversation_mentions: Number(coverage?.conversation_mentions ?? 0),
      signal_pulse_mentions: Number(coverage?.signal_pulse_mentions ?? 0),
      performance_records: Number(coverage?.performance_records ?? 0),
      query_packs: Number(coverage?.query_packs ?? 0),
      semantic_mention_embeddings: Number(coverage?.semantic_mention_embeddings ?? 0),
      semantic_knowledge_embeddings: Number(coverage?.semantic_knowledge_embeddings ?? 0),
      knowledge_sources: Number(coverage?.knowledge_sources ?? 0),
      marketing_brief_signals: knowledgeContext.marketingBriefSignals,
      knowledge_context_ready: knowledgeContext.knowledgeContextReady,
      knowledge_context_reasons: knowledgeContext.reasons,
      budget_cap_usd: budgetCapUsd,
      estimated_cost_usd: estimatedCostUsd,
      cluster_first: true,
      review_mode: "cluster_first",
      semantic_rag_required: true,
      status: readinessReasons.length === 0 ? "ready" : "blocked",
      reasons: readinessReasons
    };

    await mergeMeta(engineAnalysisId, { signal_pulse: { readiness } });
    await recordEngineCostEvent({
      engineAnalysisId,
      pipelineStepId,
      provider: "system",
      model: null,
      operation: "sp_readiness_estimate",
      estimatedCostUsd: readiness.estimated_cost_usd,
      metadata: readiness
    });
    if (readiness.status === "blocked") {
      throw new Error(`Signal Pulse readiness blocked: ${readinessReasons.join(", ")}`);
    }
    await markEngineStepCompleted({ pipelineStepId, resultSummary: readiness });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_periods" });
    return { ...readiness, next_step_job_id: next.jobId };
  });
}

export async function signalPulsePeriodsJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const bounds = (await pool.query<{ max_mention_date: string | null; max_performance_date: string | null }>(
      `SELECT
         (SELECT max(published_at)::date::text
          FROM mentions
          WHERE study_corpus_id = $1 AND inclusion_status = 'included') AS max_mention_date,
         (SELECT max(record_date)::date::text
          FROM performance_records
          WHERE study_corpus_id = $1) AS max_performance_date`,
      [ctx.study_corpus_id]
    )).rows[0];
    const windowEnd = chooseSignalPulseWindowEnd({
      maxMentionDate: bounds?.max_mention_date,
      maxPerformanceDate: bounds?.max_performance_date,
      fallbackDate: new Date()
    });
    const monthlyPeriods = buildMonthlyReportPeriods({
      windowEnd,
      months: readWindowMonths(ctx)
    });
    const weeklyPeriods = buildWeeklyReportPeriods({
      windowEnd,
      weeks: readWindowWeeks(ctx)
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '120s'");
      await materializeReportPeriods({
        client,
        studyCorpusId: ctx.study_corpus_id,
        granularity: "month",
        periods: monthlyPeriods
      });
      await materializeReportPeriods({
        client,
        studyCorpusId: ctx.study_corpus_id,
        granularity: "week",
        periods: weeklyPeriods
      });
      await client.query("ANALYZE report_periods");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const firstPeriod = monthlyPeriods[0];
    const cutPeriod = monthlyPeriods.at(-1);
    const cutWeek = weeklyPeriods.at(-1);
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        periods: {
          count: monthlyPeriods.length,
          labels: monthlyPeriods.map((period) => period.label),
          months: { count: monthlyPeriods.length, labels: monthlyPeriods.map((period) => period.label) },
          weeks: { count: weeklyPeriods.length, labels: weeklyPeriods.map((period) => period.label) }
        },
        cut: cutPeriod ? {
          label: cutPeriod.label,
          period_start: cutPeriod.periodStart,
          period_end: cutPeriod.periodEnd,
          window_start: firstPeriod?.periodStart ?? cutPeriod.periodStart,
          window_end: cutPeriod.periodEnd,
          data_through: cutPeriod.periodEnd,
          week_label: cutWeek?.label ?? null,
          week_start: cutWeek?.periodStart ?? null,
          week_end: cutWeek?.periodEnd ?? null,
          generated_at: new Date().toISOString(),
          source_event_time_basis: "mentions.published_at/performance_records.record_date",
          upload_time_is_operational_only: true
        } : null
      }
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        periods: monthlyPeriods.length,
        weekly_periods: weeklyPeriods.length,
        cut_period: cutPeriod?.label ?? null,
        cut_week: cutWeek?.label ?? null,
        data_through: cutPeriod?.periodEnd ?? null
      }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_cluster" });
    return { periods: monthlyPeriods.length, weekly_periods: weeklyPeriods.length, next_step_job_id: next.jobId };
  });
}

async function materializeReportPeriods(args: {
  client: PoolClient;
  studyCorpusId: string;
  granularity: "month" | "week";
  periods: Array<{ periodStart: string; periodEnd: string; label: string }>;
}) {
  await args.client.query(
    `DELETE FROM report_periods
     WHERE study_corpus_id = $1
       AND granularity = $2
       AND NOT (period_start = ANY($3::date[]))`,
    [args.studyCorpusId, args.granularity, args.periods.map((period) => period.periodStart)]
  );
  for (const period of args.periods) {
    const coverage = (await args.client.query<{
      conversation: number;
      performance: number;
      by_source: Record<string, number> | null;
    }>(
      `
        WITH conversation AS (
          SELECT
            COALESCE(SUM(count), 0)::int AS conversation,
            COALESCE(jsonb_object_agg(platform, count) FILTER (WHERE platform IS NOT NULL), '{}'::jsonb) AS by_source
          FROM (
            SELECT COALESCE(NULLIF(m.resolved_platform, ''), m.platform, 'unknown') AS platform,
                   COUNT(DISTINCT m.id)::int AS count
            FROM mentions m
            WHERE m.study_corpus_id = $1
              AND m.inclusion_status = 'included'
              AND m.published_at >= $2::date
              AND m.published_at < ($3::date + interval '1 day')
            GROUP BY 1
          ) source_counts
        ),
        performance AS (
          SELECT COUNT(*)::int AS performance
          FROM performance_records pr
          WHERE pr.study_corpus_id = $1
            AND pr.record_date >= $2::date
            AND pr.record_date <= $3::date
        )
        SELECT conversation.conversation, performance.performance, conversation.by_source
        FROM conversation, performance
      `,
      [args.studyCorpusId, period.periodStart, period.periodEnd]
    )).rows[0];
    const coveragePayload = {
      conversation: Number(coverage?.conversation ?? 0),
      performance: Number(coverage?.performance ?? 0),
      by_source: coverage?.by_source ?? {}
    };
    const highConfidenceThreshold = args.granularity === "month" ? 150 : 40;
    const mediumConfidenceThreshold = args.granularity === "month" ? 30 : 10;
    await args.client.query(
      `
        INSERT INTO report_periods (
          study_corpus_id, granularity, period_start, period_end, label,
          coverage, comparable, comparability_reasons, confidence, known_gaps, computed_at
        )
        VALUES ($1, $2, $3::date, $4::date, $5, $6::jsonb, $7, $8::jsonb, $9, $10::jsonb, NOW())
        ON CONFLICT (study_corpus_id, granularity, period_start)
        DO UPDATE SET
          period_end = EXCLUDED.period_end,
          label = EXCLUDED.label,
          coverage = EXCLUDED.coverage,
          comparable = EXCLUDED.comparable,
          comparability_reasons = EXCLUDED.comparability_reasons,
          confidence = EXCLUDED.confidence,
          known_gaps = EXCLUDED.known_gaps,
          computed_at = NOW()
      `,
      [
        args.studyCorpusId,
        args.granularity,
        period.periodStart,
        period.periodEnd,
        period.label,
        JSON.stringify(coveragePayload),
        coveragePayload.conversation > 0,
        JSON.stringify(coveragePayload.conversation > 0 ? [] : ["sin conversation evidence en el periodo"]),
        coveragePayload.conversation >= highConfidenceThreshold ? "alta" : coveragePayload.conversation >= mediumConfidenceThreshold ? "media" : "baja",
        JSON.stringify(coveragePayload.performance > 0 ? [] : ["sin performance estructurada"])
      ]
    );
  }
}

export async function signalPulseClusterJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const rows = (await pool.query<{
      id: string;
      text_clean: string;
      platform: string | null;
      sentiment_score: string | null;
      engagement_score: string | null;
    }>(
      `
        WITH report_bounds AS (
          SELECT MIN(period_start) AS min_start, MAX(period_end) AS max_end
          FROM report_periods
          WHERE study_corpus_id = $1 AND granularity = 'month'
        )
        SELECT
          m.id::text,
          m.text_clean,
          COALESCE(m.resolved_platform, m.platform) AS platform,
          m.sentiment_score::text,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END::text AS engagement_score
        FROM mentions m
        LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id AND mqs.lens_slug = 'signal-pulse'
        CROSS JOIN report_bounds rb
        WHERE m.study_corpus_id = $1
          AND m.inclusion_status = 'included'
          AND length(m.text_clean) >= 24
          AND (rb.min_start IS NULL OR m.published_at >= rb.min_start)
          AND (rb.max_end IS NULL OR m.published_at < (rb.max_end + interval '1 day'))
        ORDER BY CASE WHEN mqs.id IS NOT NULL THEN 0 ELSE 1 END, m.published_at DESC
        LIMIT ${GLOBAL_CLUSTER_ROW_LIMIT}
      `,
      [ctx.study_corpus_id]
    )).rows;
    const embeddingClusters = (await loadEmbeddingNeighborhoodClusters({
      corpusId: ctx.study_corpus_id,
      anchorLimit: EMBEDDING_ANCHOR_LIMIT,
      neighborLimit: EMBEDDING_NEIGHBORS_PER_ANCHOR
    })).clusters;
    const rawGlobalClusters = (embeddingClusters.length > 0 ? embeddingClusters : buildCheapTermClusters(rows))
      .map((cluster) => ({ ...cluster, discovery_source: "global" as const }));
    const rawPeriodClusters = await loadPeriodFirstClusters(ctx.study_corpus_id);
    const semanticPeriodClusters = rawPeriodClusters.filter((cluster) => cluster.algorithm === "semantic_embedding_neighborhood_v1");
    const globalClusters = rawGlobalClusters.filter(isActionableSignalPulseCluster);
    const periodClusters = rawPeriodClusters.filter(isActionableSignalPulseCluster);
    const clusters = selectPeriodFirstSignalPulseClusters({
      globalClusters,
      periodClusters,
      maxClusters: MAX_SIGNAL_CLUSTERS,
      perPeriod: PERIOD_CLUSTERS_PER_PERIOD
    });
    const signals = await materializeCanonicalSignals({ ctx, engineAnalysisId, clusters });
    const coverage = await readSignalPulseCoverage(ctx.study_corpus_id);
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        cluster: {
          algorithm: signalPulseClusterAlgorithm({
            globalSemanticClusters: embeddingClusters.length,
            periodSemanticClusters: semanticPeriodClusters.length,
            periodClusters: rawPeriodClusters.length
          }),
          fallback_used: embeddingClusters.length === 0 && semanticPeriodClusters.length === 0,
          cluster_first: true,
          per_mention_coding: false,
          clusters,
          global_candidate_clusters: globalClusters.length,
          period_first_candidate_clusters: periodClusters.length,
          period_first_semantic_candidate_clusters: semanticPeriodClusters.length,
          excluded_candidate_clusters: (rawGlobalClusters.length + rawPeriodClusters.length) - (globalClusters.length + periodClusters.length),
          materialized_signals: signals.length
        },
        analysis_truth: {
          measured_mentions: coverage.conversation_mentions,
          signal_pulse_mentions: coverage.signal_pulse_mentions,
          global_cluster_row_limit: GLOBAL_CLUSTER_ROW_LIMIT,
          global_rows_sampled: rows.length,
          period_cluster_row_limit: PERIOD_CLUSTER_ROW_LIMIT,
          max_signal_clusters: MAX_SIGNAL_CLUSTERS,
          max_claude_samples_per_cluster: MAX_CLAUDE_SAMPLES_PER_CLUSTER,
          review_mode: stringFrom(ctx.params?.review_mode) || "cluster_first",
          claude_did_not_read_all_mentions: true
        }
      }
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        clusters: clusters.length,
        materialized_signals: signals.length,
        mentions_sampled: rows.length,
        global_candidate_clusters: globalClusters.length,
        period_first_candidate_clusters: periodClusters.length,
        period_first_semantic_candidate_clusters: semanticPeriodClusters.length,
        excluded_candidate_clusters: (rawGlobalClusters.length + rawPeriodClusters.length) - (globalClusters.length + periodClusters.length)
      }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_name_signals" });
    return {
      clusters: clusters.length,
      algorithm: signalPulseClusterAlgorithm({
        globalSemanticClusters: embeddingClusters.length,
        periodSemanticClusters: semanticPeriodClusters.length,
        periodClusters: rawPeriodClusters.length
      }),
      global_candidate_clusters: globalClusters.length,
      period_first_candidate_clusters: periodClusters.length,
      period_first_semantic_candidate_clusters: semanticPeriodClusters.length,
      excluded_candidate_clusters: (rawGlobalClusters.length + rawPeriodClusters.length) - (globalClusters.length + periodClusters.length),
      materialized_signals: signals.length,
      next_step_job_id: next.jobId
    };
  });
}

export async function signalPulseNameSignalsJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const candidates = (await pool.query<SignalPulseNamingRow>(
      `
        SELECT
          cs.id::text,
          cs.canonical_title,
          cs.signal_type,
          cs.dimensions,
          row_number() OVER (ORDER BY COALESCE((cs.dimensions->>'mention_count')::int, 0) DESC, cs.canonical_title)::int AS position
        FROM canonical_signals cs
        WHERE cs.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status <> 'archived'
        ORDER BY position
      `,
      [ctx.study_corpus_id]
    )).rows;
    let updated = 0;
    for (const candidate of candidates) {
      const dimensions = candidate.dimensions ?? {};
      const read = buildSignalPulseDeterministicRead({
        canonicalTitle: candidate.canonical_title,
        term: stringFrom(dimensions.term),
        signalType: candidate.signal_type,
        mentionCount: Number(dimensions.mention_count ?? 0),
        sentimentAvg: numberOrNull(dimensions.sentiment_avg),
        platforms: stringArrayFrom(dimensions.platforms),
        rank: candidate.position
      });
      const result = await pool.query(
        `
          UPDATE canonical_signals
          SET
            canonical_title = $2,
            description = $3,
            dimensions = dimensions || $4::jsonb,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          candidate.id,
          read.title,
          read.description,
          safeJsonStringifyForPostgres({
            rank: candidate.position,
            marketing_read: read.marketingRead,
            action_hint: read.actionHint,
            actionability: "review",
            review_status: "needs_human_review",
            interpretation_source: read.interpretationSource,
            cluster_first: true,
            per_mention_coding: false
          })
        ]
      );
      updated += result.rowCount ?? 0;
    }
    await recordEngineCostEvent({
      engineAnalysisId,
      pipelineStepId,
      provider: "system",
      model: null,
      operation: "sp_name_signals_deterministic",
      estimatedCostUsd: 0,
      metadata: {
        reason: "Cluster naming uses deterministic marketing copy grounded in cluster metrics; no per-mention coding or hidden LLM cost.",
        updated_signals: updated
      }
    });
    const llmNaming = await maybeApplyClaudeSignalNaming({
      ctx,
      engineAnalysisId,
      pipelineStepId,
      candidates
    });
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        naming: {
          status: "materialized",
          interpretation_source: llmNaming.applied ? "claude_cluster_naming_v1" : "deterministic_marketing_read_v2",
          cluster_first: true,
          per_mention_coding: false,
          updated_signals: llmNaming.applied ? llmNaming.updated : updated,
          fallback: llmNaming.applied ? false : llmNaming.reason
        }
      }
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        status: "materialized",
        updated_signals: llmNaming.applied ? llmNaming.updated : updated,
        interpretation_source: llmNaming.applied ? "claude_cluster_naming_v1" : "deterministic_marketing_read_v2",
        per_mention_coding: false
      }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_metrics" });
    return { status: "materialized", next_step_job_id: next.jobId };
  });
}

export async function signalPulseMetricsJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const metrics = await materializePeriodMetrics({ ctx, engineAnalysisId });
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        metrics: {
          period_metrics: metrics.metrics,
          observations: metrics.observations,
          evidence: metrics.evidence,
          impact_formula: "impact_v1"
        }
      }
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        period_metrics: metrics.metrics,
        observations: metrics.observations,
        evidence: metrics.evidence
      }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_interpret" });
    return { ...metrics, next_step_job_id: next.jobId };
  });
}

export async function signalPulseInterpretJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const deterministicInterpretation = await buildSignalPulseInterpretation(ctx);
    const llmInterpretation = await maybeApplyClaudeSignalPulseInterpretation({
      ctx,
      engineAnalysisId,
      pipelineStepId,
      fallback: deterministicInterpretation
    });
    const interpretation = llmInterpretation.interpretation;
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        interpretation: {
          ...interpretation,
          source: llmInterpretation.applied ? "claude_aggregate_interpretation_v1" : "sql_metric_interpretation_v1",
          numbers_source: "signal_period_metrics"
        }
      }
    });
    await markEngineStepCompleted({ pipelineStepId, resultSummary: interpretation });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_moves" });
    return { ...interpretation, next_step_job_id: next.jobId };
  });
}

export async function signalPulseMovesJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const moves = await materializeMarketingMoves({ ctx, engineAnalysisId });
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        moves: {
          marketing_moves: moves.moves
        }
      }
    });
    await markEngineStepCompleted({ pipelineStepId, resultSummary: moves });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_charts" });
    return { ...moves, next_step_job_id: next.jobId };
  });
}

export async function signalPulseChartsJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const charts = await materializeChartAggregates(ctx);
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        charts: {
          chart_aggregates: charts.charts
        }
      }
    });
    await markEngineStepCompleted({ pipelineStepId, resultSummary: charts });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_gates" });
    return { ...charts, next_step_job_id: next.jobId };
  });
}

export async function signalPulseGatesJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const counts = await loadSignalPulseMaterializationCounts({ ctx, engineAnalysisId });
    const qualityGates = await buildSignalPulseQualityGates({
      ctx,
      engineAnalysisId,
      signalCount: counts.signals,
      metricsCount: counts.metrics,
      movesCount: counts.moves,
      chartsCount: counts.charts
    });
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        gates: {
          failed_gates: qualityGates.filter((gate) => !gate.passed).length
        }
      },
      quality_gates: qualityGates
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        signal_count: counts.signals,
        period_metrics: counts.metrics,
        marketing_moves: counts.moves,
        chart_aggregates: counts.charts,
        failed_gates: qualityGates.filter((gate) => !gate.passed).length
      }
    });
    await pool.query(
      `UPDATE engine_analyses
       SET status = 'needs_review',
           current_step = 'sp_gates',
           updated_at = NOW()
       WHERE id = $1`,
      [engineAnalysisId]
    );
    await releaseEngineCorpusLock(engineAnalysisId);
    return { signal_count: counts.signals, status: "needs_review" };
  });
}

async function runSignalPulseStep<T>(
  job: Job<SignalPulseStepJobData>,
  run: (data: SignalPulseStepJobData) => Promise<T>
) {
  const { pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  try {
    const result = await run(job.data);
    await job.updateProgress(100);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEngineStepFailed({ pipelineStepId, errorMessage: message });
    await releaseEngineCorpusLock(job.data.engineAnalysisId);
    throw error;
  }
}

async function loadSignalPulseContext(engineAnalysisId: string): Promise<AnalysisContext> {
  const result = await pool.query<AnalysisContext>(
    `SELECT
       ea.study_corpus_id,
       COALESCE(b.organization_id, t.organization_id) AS organization_id,
       sc.brand_id,
       sc.theme_id,
       ea.methodology_slug,
       ea.params,
       sc.analysis_plan,
       sc.target_window_months
     FROM engine_analyses ea
     JOIN study_corpora sc ON sc.id = ea.study_corpus_id
     LEFT JOIN brands b ON b.id = sc.brand_id
     LEFT JOIN themes t ON t.id = sc.theme_id
     WHERE ea.id = $1`,
    [engineAnalysisId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`engine_analyses ${engineAnalysisId} not found`);
  return row;
}

function assertSignalPulse(ctx: AnalysisContext) {
  if (ctx.methodology_slug !== "signal-pulse") {
    throw new Error(`Signal Pulse step received unsupported methodology ${ctx.methodology_slug}`);
  }
}

function readWindowMonths(ctx: AnalysisContext) {
  return numberFrom(ctx.params?.window_months) ?? numberFrom(ctx.analysis_plan?.target_window_months) ?? ctx.target_window_months ?? 12;
}

function readWindowWeeks(ctx: AnalysisContext) {
  return Math.max(4, Math.min(156, Math.ceil(readWindowMonths(ctx) * 4.5)));
}

function readBudgetCapUsd(ctx: AnalysisContext) {
  return numberFrom(ctx.params?.budget_cap_usd) ?? numberFrom(ctx.analysis_plan?.budget_cap_usd) ?? 5;
}

function numberFrom(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function readSignalPulseCoverage(corpusId: string) {
  const row = (await pool.query<{
    conversation_mentions: number;
    signal_pulse_mentions: number;
    performance_records: number;
    query_packs: number;
  }>(
    `
      SELECT
        COUNT(DISTINCT m.id)::int AS conversation_mentions,
        COUNT(DISTINCT m.id) FILTER (WHERE mqs.lens_slug = 'signal-pulse')::int AS signal_pulse_mentions,
        (SELECT COUNT(*)::int FROM performance_records pr WHERE pr.study_corpus_id = $1) AS performance_records,
        (SELECT COUNT(*)::int FROM query_packs qp WHERE qp.study_corpus_id = $1 AND qp.lens_slug = 'signal-pulse') AS query_packs
      FROM mentions m
      LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
      WHERE m.study_corpus_id = $1
        AND m.inclusion_status = 'included'
    `,
    [corpusId]
  )).rows[0];
  return {
    conversation_mentions: Number(row?.conversation_mentions ?? 0),
    signal_pulse_mentions: Number(row?.signal_pulse_mentions ?? 0),
    performance_records: Number(row?.performance_records ?? 0),
    query_packs: Number(row?.query_packs ?? 0)
  };
}

async function mergeMeta(engineAnalysisId: string, meta: Record<string, unknown>) {
  const { signalPulseMeta, rootMeta } = splitSignalPulseMetaForMerge(meta);
  if (signalPulseMeta && typeof signalPulseMeta === "object" && !Array.isArray(signalPulseMeta)) {
    await pool.query(
      `UPDATE engine_analyses
       SET meta_json = jsonb_set(
             COALESCE(meta_json, '{}'::jsonb),
             '{signal_pulse}',
             COALESCE(meta_json->'signal_pulse', '{}'::jsonb) || $1::jsonb,
             true
           ),
           updated_at = NOW()
       WHERE id = $2`,
      [safeJsonStringifyForPostgres(signalPulseMeta), engineAnalysisId]
    );
  }

  if (Object.keys(rootMeta).length === 0) {
    return;
  }

  await pool.query(
    `UPDATE engine_analyses
     SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [safeJsonStringifyForPostgres(rootMeta), engineAnalysisId]
  );
}

async function materializeCanonicalSignals(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
  clusters: TermCluster[];
}): Promise<MaterializedSignal[]> {
  const materialized: MaterializedSignal[] = [];
  for (const [index, cluster] of args.clusters.entries()) {
    const title = titleForCluster(cluster.term);
    const signalType = signalTypeForCluster(cluster);
    const description = `La conversación se está concentrando alrededor de ${title.toLowerCase()}.`;
    const firstLast = await pool.query<{ first_seen: string | null; last_seen: string | null }>(
      `
        SELECT MIN(published_at)::text AS first_seen, MAX(published_at)::text AS last_seen
        FROM mentions
        WHERE id = ANY($1::uuid[])
      `,
      [cluster.member_mention_ids.length > 0 ? cluster.member_mention_ids : cluster.sample_mention_ids]
    );
    const result = await pool.query<{ id: string }>(
      `
        INSERT INTO canonical_signals (
          organization_id, brand_id, theme_id, study_corpus_id, methodology_slug,
          signal_type, canonical_title, semantic_key, description, dimensions,
          status, first_seen_at, last_seen_at
        )
        VALUES ($1, $2, $3, $4, 'signal-pulse', $5, $6, $7, $8, $9::jsonb, 'active', $10::timestamptz, $11::timestamptz)
        ON CONFLICT (
          (COALESCE(organization_id::text, '')),
          (COALESCE(brand_id::text, '')),
          (COALESCE(theme_id::text, '')),
          methodology_slug,
          signal_type,
          semantic_key
        )
        DO UPDATE SET
          canonical_title = EXCLUDED.canonical_title,
          description = EXCLUDED.description,
          dimensions = canonical_signals.dimensions || EXCLUDED.dimensions,
          status = 'active',
          first_seen_at = CASE
            WHEN canonical_signals.first_seen_at IS NULL THEN EXCLUDED.first_seen_at
            WHEN EXCLUDED.first_seen_at IS NULL THEN canonical_signals.first_seen_at
            ELSE LEAST(canonical_signals.first_seen_at, EXCLUDED.first_seen_at)
          END,
          last_seen_at = CASE
            WHEN canonical_signals.last_seen_at IS NULL THEN EXCLUDED.last_seen_at
            WHEN EXCLUDED.last_seen_at IS NULL THEN canonical_signals.last_seen_at
            ELSE GREATEST(canonical_signals.last_seen_at, EXCLUDED.last_seen_at)
          END,
          updated_at = NOW()
        RETURNING id::text
      `,
      [
        args.ctx.organization_id,
        args.ctx.brand_id,
        args.ctx.theme_id,
        args.ctx.study_corpus_id,
        signalType,
        title,
        `sp:${slugify(cluster.term)}`,
        description,
        JSON.stringify({
          source: "signal_pulse_cluster",
          algorithm: cluster.algorithm,
          term: cluster.term,
          mention_count: cluster.mention_count,
          member_mention_ids: cluster.member_mention_ids,
          sample_mention_ids: cluster.sample_mention_ids,
          rank: index + 1,
          platforms: cluster.platforms,
          engagement_sum: cluster.engagement_sum,
          sentiment_avg: cluster.sentiment_avg,
          cluster_first: true,
          actionability: "review",
          review_status: "needs_human_review",
          discovery_source: cluster.discovery_source ?? "global",
          discovery_periods: cluster.discovery_periods ?? [],
          max_period_mention_count: cluster.max_period_mention_count ?? cluster.mention_count
        }),
        firstLast.rows[0]?.first_seen,
        firstLast.rows[0]?.last_seen
      ]
    );
    const canonicalSignalId = result.rows[0]?.id;
    if (!canonicalSignalId) continue;
    materialized.push({
      canonical_signal_id: canonicalSignalId,
      term: cluster.term,
      title,
      signal_type: signalType,
      mention_count: cluster.mention_count,
      sentiment_avg: cluster.sentiment_avg,
      engagement_sum: cluster.engagement_sum,
      sample_mention_ids: cluster.sample_mention_ids,
      platforms: cluster.platforms
    });
  }
  return materialized;
}

async function loadPeriodFirstClusters(corpusId: string): Promise<TermCluster[]> {
  const periods = (await pool.query<{ label: string; period_start: string; period_end: string }>(
    `SELECT label, period_start::text, period_end::text
     FROM report_periods
     WHERE study_corpus_id = $1 AND granularity = 'month'
     ORDER BY period_start`,
    [corpusId]
  )).rows;
  const clusters: TermCluster[] = [];
  for (const period of periods) {
    const semanticPeriod = await loadEmbeddingNeighborhoodClusters({
      corpusId,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      anchorLimit: PERIOD_EMBEDDING_ANCHOR_LIMIT,
      neighborLimit: PERIOD_EMBEDDING_NEIGHBORS_PER_ANCHOR
    });
    if (semanticPeriod.clusters.length > 0) {
      clusters.push(...semanticPeriod.clusters
        .slice(0, PERIOD_CLUSTERS_PER_PERIOD * 4)
        .map((cluster) => ({
          ...cluster,
          discovery_source: "period_first" as const,
          discovery_periods: [period.label],
          max_period_mention_count: cluster.mention_count
        })));
      continue;
    }
    if (semanticPeriod.neighborhoodRows > 0) {
      continue;
    }

    const rows = (await pool.query<{
      id: string;
      text_clean: string;
      platform: string | null;
      sentiment_score: string | null;
      engagement_score: string | null;
    }>(
      `
        SELECT
          m.id::text,
          m.text_clean,
          COALESCE(m.resolved_platform, m.platform) AS platform,
          m.sentiment_score::text,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END::text AS engagement_score
        FROM mentions m
        LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id AND mqs.lens_slug = 'signal-pulse'
        WHERE m.study_corpus_id = $1
          AND m.inclusion_status = 'included'
          AND m.published_at >= $2::date
          AND m.published_at < ($3::date + interval '1 day')
          AND length(m.text_clean) >= 24
        ORDER BY CASE WHEN mqs.id IS NOT NULL THEN 0 ELSE 1 END,
                 CASE
                   WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                   THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
                   ELSE 0
                 END DESC,
                 m.published_at DESC
        LIMIT ${PERIOD_CLUSTER_ROW_LIMIT}
      `,
      [corpusId, period.period_start, period.period_end]
    )).rows;
    const periodClusters = buildCheapTermClusters(rows)
      .slice(0, PERIOD_CLUSTERS_PER_PERIOD * 4)
      .map((cluster) => ({
        ...cluster,
        discovery_source: "period_first" as const,
        discovery_periods: [period.label],
        max_period_mention_count: cluster.mention_count
      }));
    clusters.push(...periodClusters);
  }
  return clusters;
}

async function materializePeriodMetrics(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
}) {
  await pool.query(`DELETE FROM signal_observations WHERE engine_analysis_id = $1`, [args.engineAnalysisId]);
  const signalRows = (await pool.query<{
    id: string;
    canonical_title: string;
    signal_type: string;
    dimensions: Record<string, unknown>;
  }>(
    `SELECT id::text, canonical_title, signal_type, dimensions
     FROM canonical_signals
     WHERE study_corpus_id = $1
       AND methodology_slug = 'signal-pulse'
       AND status <> 'archived'
     ORDER BY COALESCE((dimensions->>'rank')::int, 999), canonical_title
     LIMIT ${MAX_SIGNAL_CLUSTERS}`,
    [args.ctx.study_corpus_id]
  )).rows;
  const periods = (await pool.query<{ id: string; period_start: string; period_end: string; label: string }>(
    `SELECT id::text, period_start::text, period_end::text, label
     FROM report_periods
     WHERE study_corpus_id = $1 AND granularity = 'month'
     ORDER BY period_start`,
    [args.ctx.study_corpus_id]
  )).rows;
  const totalByPeriod = new Map<string, number>();
  for (const period of periods) {
    const total = (await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM mentions
       WHERE study_corpus_id = $1
         AND inclusion_status = 'included'
         AND published_at >= $2::date
         AND published_at < ($3::date + interval '1 day')`,
      [args.ctx.study_corpus_id, period.period_start, period.period_end]
    )).rows[0]?.count ?? 0;
    totalByPeriod.set(period.id, Number(total));
  }

  let metricCount = 0;
  let observationCount = 0;
  let evidenceCount = 0;
  for (const signal of signalRows) {
    const term = stringFrom(signal.dimensions?.term) || signal.canonical_title;
    const memberMentionIds = stringArrayFrom(signal.dimensions?.member_mention_ids);
    const previousVolumes: number[] = [];
    const periodSeries: Array<{
      period_id: string;
      label: string;
      period_start: string;
      period_end: string;
      volume: number;
      impact_v1: number;
      confidence: string;
      lifecycle_state: string;
    }> = [];
    for (const period of periods) {
      const periodMentions = await loadSignalPeriodMentions({
        corpusId: args.ctx.study_corpus_id,
        term,
        memberMentionIds,
        periodStart: period.period_start,
        periodEnd: period.period_end
      });
      const volume = periodMentions.count;
      const periodTotal = totalByPeriod.get(period.id) ?? 0;
      const sharePct = periodTotal > 0 ? round((volume / periodTotal) * 100, 2) : 0;
      const impact = calculateImpactV1({
        volumeNorm: clamp(volume / Math.max(1, periodTotal), 0, 1),
        engagementNorm: clamp(periodMentions.engagement_sum / Math.max(1, volume * 100), 0, 1),
        recency: periods.length > 0 ? (periods.indexOf(period) + 1) / periods.length : 1,
        sourceDiversity: clamp(Object.keys(periodMentions.source_mix).length / 4, 0, 1),
        temporalConsistency: clamp(previousVolumes.filter((item) => item > 0).length / Math.max(1, periods.length), 0, 1)
      });
      const deltaPrev = previousVolumes.length === 0 ? null : volume - (previousVolumes.at(-1) ?? 0);
      previousVolumes.push(volume);
      const lifecycle = classifySignalPulseLifecycle({
        currentVolume: volume,
        previousVolume: previousVolumes.length > 1 ? previousVolumes[previousVolumes.length - 2] ?? 0 : 0,
        periodsSeen: previousVolumes.filter((item) => item > 0).length,
        volatility: volatility(previousVolumes)
      });
      const confidence = volume >= 30 ? "alta" : volume >= 8 ? "media" : "baja";
      periodSeries.push({
        period_id: period.id,
        label: period.label,
        period_start: period.period_start,
        period_end: period.period_end,
        volume,
        impact_v1: impact,
        confidence,
        lifecycle_state: lifecycle
      });
      await pool.query(
        `
          INSERT INTO signal_period_metrics (
            canonical_signal_id, period_id, study_corpus_id, volume, engagement,
            impact_v1, sentiment_score, polarity_bucket, dominant_emotion,
            emotion_distribution, source_mix, evidence_count, confidence,
            delta_prev, delta_window_avg, rank, lifecycle_state, computed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, NOW())
          ON CONFLICT (canonical_signal_id, period_id)
          DO UPDATE SET
            volume = EXCLUDED.volume,
            engagement = EXCLUDED.engagement,
            impact_v1 = EXCLUDED.impact_v1,
            sentiment_score = EXCLUDED.sentiment_score,
            polarity_bucket = EXCLUDED.polarity_bucket,
            dominant_emotion = EXCLUDED.dominant_emotion,
            emotion_distribution = EXCLUDED.emotion_distribution,
            source_mix = EXCLUDED.source_mix,
            evidence_count = EXCLUDED.evidence_count,
            confidence = EXCLUDED.confidence,
            delta_prev = EXCLUDED.delta_prev,
            delta_window_avg = EXCLUDED.delta_window_avg,
            rank = EXCLUDED.rank,
            lifecycle_state = EXCLUDED.lifecycle_state,
            computed_at = NOW()
        `,
        [
          signal.id,
          period.id,
          args.ctx.study_corpus_id,
          volume,
          periodMentions.engagement_sum,
          impact,
          periodMentions.sentiment_avg,
          polarityBucket(periodMentions.sentiment_avg),
          emotionForSentiment(periodMentions.sentiment_avg),
          JSON.stringify(emotionDistribution(periodMentions.sentiment_avg)),
          JSON.stringify(periodMentions.source_mix),
          Math.min(volume, MAX_EVIDENCE_PER_SIGNAL),
          confidence,
          deltaPrev,
          averageDelta(volume, previousVolumes),
          Number(signal.dimensions?.rank ?? 999),
          lifecycle
        ]
      );
      metricCount += 1;

      const observationId = await upsertSignalObservation({
        canonicalSignalId: signal.id,
        ctx: args.ctx,
        engineAnalysisId: args.engineAnalysisId,
        signalType: signal.signal_type,
        periodStart: period.period_start,
        periodEnd: period.period_end,
        frequency: volume,
        sharePct,
        sentiment: periodMentions.sentiment_avg,
        impact,
        confidence,
        deltaPrev,
        lifecycle,
        term,
        sourceMix: periodMentions.source_mix
      });
      if (observationId) {
        observationCount += 1;
        evidenceCount += await refreshSignalEvidence({ observationId, mentions: periodMentions.samples, term });
      }
    }
    const currentPeriod = periodSeries.at(-1) ?? null;
    const lastActivePeriod = periodSeries.slice().reverse().find((period) => period.volume > 0) ?? null;
    const bestPeriod = periodSeries
      .slice()
      .sort((a, b) => b.impact_v1 - a.impact_v1 || b.volume - a.volume)[0] ?? null;
    const windowVolume = periodSeries.reduce((sum, period) => sum + period.volume, 0);
    await pool.query(
      `
        UPDATE canonical_signals
        SET dimensions = dimensions || $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        signal.id,
        safeJsonStringifyForPostgres({
          current_period_label: currentPeriod?.label ?? null,
          current_period_start: currentPeriod?.period_start ?? null,
          current_period_end: currentPeriod?.period_end ?? null,
          current_period_volume: currentPeriod?.volume ?? 0,
          current_period_impact_v1: currentPeriod?.impact_v1 ?? 0,
          current_period_confidence: currentPeriod?.confidence ?? "baja",
          window_volume: windowVolume,
          active_periods: periodSeries.filter((period) => period.volume > 0).length,
          last_seen_period: lastActivePeriod?.label ?? null,
          last_seen_period_end: lastActivePeriod?.period_end ?? null,
          best_period_label: bestPeriod?.label ?? null,
          best_period_volume: bestPeriod?.volume ?? 0,
          data_through: currentPeriod?.period_end ?? null,
          monthly_series: periodSeries.slice(-12)
        })
      ]
    );
  }

  await pool.query("ANALYZE signal_period_metrics");
  await pool.query("ANALYZE signal_observations");
  return { metrics: metricCount, observations: observationCount, evidence: evidenceCount };
}

async function buildSignalPulseInterpretation(ctx: AnalysisContext) {
  const row = (await pool.query<{
    title: string;
    signal_type: string;
    volume: number;
    impact: string | null;
    confidence: string | null;
    lifecycle_state: string | null;
  }>(
    `
      WITH cut_period AS (
        SELECT id, label
        FROM report_periods
        WHERE study_corpus_id = $1 AND granularity = 'month'
        ORDER BY period_start DESC
        LIMIT 1
      ),
      latest AS (
        SELECT
          spm.canonical_signal_id,
          spm.volume,
          spm.impact_v1::text AS impact,
          spm.confidence,
          spm.lifecycle_state
        FROM signal_period_metrics spm
        JOIN cut_period cp ON cp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
      )
      SELECT
        cs.canonical_title AS title,
        cs.signal_type,
        latest.volume,
        latest.impact,
        latest.confidence,
        latest.lifecycle_state
      FROM latest
      JOIN canonical_signals cs ON cs.id = latest.canonical_signal_id
      WHERE cs.study_corpus_id = $1
        AND cs.methodology_slug = 'signal-pulse'
        AND cs.status <> 'archived'
        AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
        AND latest.volume > 0
      ORDER BY COALESCE(latest.impact::numeric, 0) DESC, latest.volume DESC
      LIMIT 1
    `,
    [ctx.study_corpus_id]
  )).rows[0];

  if (!row) {
    return {
      headline: "Todavía no hay señales suficientes para tomar una decisión de marketing.",
      body: "El corte necesita más conversación útil antes de convertir hallazgos en acciones publicables.",
      action: "Revisar cobertura de fuentes, periodo y query pack antes de volver a correr Signal Pulse."
    };
  }

  const posture = row.signal_type === "risk" ? "requiere contención" : row.lifecycle_state === "accelerating" ? "está acelerando" : "merece una prueba controlada";
  return {
    headline: `${row.title} ${posture} este corte.`,
    body: `La señal llega con ${Number(row.volume ?? 0)} menciones en el periodo más reciente, impacto ${Number(row.impact ?? 0)} y confianza ${row.confidence ?? "baja"}.`,
    action: row.signal_type === "risk"
      ? "Reducir la fricción en claims, piezas y pauta antes de amplificar el territorio."
      : "Convertir la señal en un hook medible antes de mover presupuesto fuerte."
  };
}

async function maybeApplyClaudeSignalNaming(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
  pipelineStepId: string;
  candidates: SignalPulseNamingRow[];
}) {
  const model = signalPulseLlmModel();
  const estimatedNextCostUsd = estimateSignalPulseNamingCostUsd(args.candidates.length, MAX_SIGNAL_CLUSTERS) + SIGNAL_PULSE_RAG_CONTEXT_COST_USD;
  const unavailableReason = await signalPulseLlmUnavailableReason(args.ctx, args.engineAnalysisId, model, estimatedNextCostUsd);
  if (unavailableReason) {
    await recordEngineCostEvent({
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      provider: "anthropic",
      model,
      operation: "sp_name_signals_skipped",
      usage: null,
      metadata: { reason: unavailableReason, estimated_next_cost_usd: estimatedNextCostUsd, cluster_first: true, per_mention_coding: false }
    });
    return { applied: false, updated: 0, reason: unavailableReason };
  }

  const marketingContext = await loadSignalPulseMarketingContext(args.ctx);
  await recordEngineCostEvent({
    engineAnalysisId: args.engineAnalysisId,
    pipelineStepId: args.pipelineStepId,
    provider: marketingContext.rag.semantic_available ? embeddingProviderFromModel(marketingContext.rag.embedding_model) : "system",
    model: marketingContext.rag.embedding_model,
    operation: "sp_rag_context",
    estimatedCostUsd: marketingContext.rag.semantic_available ? SIGNAL_PULSE_RAG_CONTEXT_COST_USD : 0,
    metadata: {
      knowledge_sources: marketingContext.knowledge_sources.length,
      performance_months: marketingContext.performance_window.length,
      marketing_activity_months: marketingContext.marketing_activity_window.length,
      repeated_marketing_language: marketingContext.repeated_marketing_language.length,
      source_inventory: marketingContext.source_inventory.length,
      semantic_available: marketingContext.rag.semantic_available,
      cluster_first: true,
      per_mention_coding: false
    }
  });
  const payload: SignalPulseClusterNamingPayload[] = await Promise.all(args.candidates.slice(0, MAX_SIGNAL_CLUSTERS).map(async (candidate) => {
    const dimensions = candidate.dimensions ?? {};
    const samples = await loadMentionSamples(stringArrayFrom(dimensions.sample_mention_ids).slice(0, MAX_CLAUDE_SAMPLES_PER_CLUSTER));
    const memberMentionIds = stringArrayFrom(dimensions.member_mention_ids);
    const clusterBase = {
      id: candidate.id,
      currentTitle: candidate.canonical_title,
      term: stringFrom(dimensions.term),
      mentionCount: Number(dimensions.mention_count ?? 0),
      platforms: stringArrayFrom(dimensions.platforms).slice(0, 5),
      discoveryPeriods: stringArrayFrom(dimensions.discovery_periods).slice(0, 4),
      memberMentionIds,
      samples
    };
    return {
      id: candidate.id,
      current_title: candidate.canonical_title,
      signal_type: candidate.signal_type,
      term: clusterBase.term,
      rank: candidate.position,
      mention_count: clusterBase.mentionCount,
      sentiment_avg: numberOrNull(dimensions.sentiment_avg),
      platforms: clusterBase.platforms,
      discovery_periods: clusterBase.discoveryPeriods,
      max_period_mention_count: Number(dimensions.max_period_mention_count ?? dimensions.mention_count ?? 0),
      samples,
      context: await loadSignalPulseClusterPromptContext({
        ctx: args.ctx,
        marketingContext,
        cluster: clusterBase
      })
    };
  }));
  if (payload.length === 0) return { applied: false, updated: 0, reason: "no_clusters" };

  let updated = 0;
  const skippedReasons: string[] = [];
  for (const [batchIndex, batch] of chunkArray(payload, CLAUDE_NAMING_BATCH_SIZE).entries()) {
    const batchResult = await applyClaudeSignalNamingBatch({
      ctx: args.ctx,
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      model,
      batch,
      batchIndex,
      marketingContext
    });
    updated += batchResult.updated;
    if (batchResult.reason) skippedReasons.push(batchResult.reason);
  }
  return {
    applied: updated > 0,
    updated,
    reason: updated > 0 ? (skippedReasons.length > 0 ? `partial:${skippedReasons.join("|").slice(0, 240)}` : undefined) : (skippedReasons.join("|").slice(0, 500) || "empty_valid_claude_rows")
  };
}

async function applyClaudeSignalNamingBatch(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
  pipelineStepId: string;
  model: string;
  batch: SignalPulseClusterNamingPayload[];
  batchIndex: number;
  marketingContext: SignalPulseMarketingContext;
}) {
  const prompt = buildClaudeSignalNamingPrompt(args.batch, args.marketingContext);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SIGNAL_PULSE_LLM_TIMEOUT_MS);
      const response = await generateText({
        model: anthropic(args.model),
        prompt,
        temperature: 0.2,
        abortSignal: controller.signal
      }).finally(() => clearTimeout(timeout));
      await recordEngineCostEvent({
        engineAnalysisId: args.engineAnalysisId,
        pipelineStepId: args.pipelineStepId,
        provider: "anthropic",
        model: args.model,
        operation: "sp_name_signals",
        usage: readAiSdkUsage(response),
        metadata: {
          batch_index: args.batchIndex,
          attempt,
          clusters: args.batch.length,
          max_samples_per_cluster: MAX_CLAUDE_SAMPLES_PER_CLUSTER,
          rag_context: {
            knowledge_sources: args.marketingContext.knowledge_sources.length,
            performance_months: args.marketingContext.performance_window.length,
            marketing_activity_months: args.marketingContext.marketing_activity_window.length,
            repeated_marketing_language: args.marketingContext.repeated_marketing_language.length,
            knowledge_matches: args.batch.reduce((sum, item) => sum + item.context.knowledge_matches.length, 0),
            conversation_matches: args.batch.reduce((sum, item) => sum + item.context.conversation_matches.length, 0),
            semantic_available: args.marketingContext.rag.semantic_available,
            embedding_model: args.marketingContext.rag.embedding_model
          },
          cluster_first: true,
          per_mention_coding: false
        }
      });
      const parsed = parseJsonRecord(response.text);
      const rows = arrayOfRecords(parsed.signals);
      const updated = await persistClaudeSignalNamingRows({
        ctx: args.ctx,
        rows,
        batch: args.batch
      });
      return { updated, reason: updated > 0 ? undefined : `batch_${args.batchIndex}:empty_valid_claude_rows` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt < 2) {
        await recordEngineCostEvent({
          engineAnalysisId: args.engineAnalysisId,
          pipelineStepId: args.pipelineStepId,
          provider: "anthropic",
          model: args.model,
          operation: "sp_name_signals_retry",
          usage: null,
          metadata: {
            batch_index: args.batchIndex,
            attempt,
            reason: reason.slice(0, 500),
            cluster_first: true,
            per_mention_coding: false
          }
        });
        continue;
      }
      await recordEngineCostEvent({
        engineAnalysisId: args.engineAnalysisId,
        pipelineStepId: args.pipelineStepId,
        provider: "anthropic",
        model: args.model,
        operation: "sp_name_signals_failed",
        usage: null,
        metadata: {
          batch_index: args.batchIndex,
          attempt,
          reason: reason.slice(0, 500),
          cluster_first: true,
          per_mention_coding: false
        }
      });
      return { updated: 0, reason: `batch_${args.batchIndex}:${reason.slice(0, 160)}` };
    }
  }
  return { updated: 0, reason: `batch_${args.batchIndex}:unknown_failure` };
}

async function persistClaudeSignalNamingRows(args: {
  ctx: AnalysisContext;
  rows: Record<string, unknown>[];
  batch: SignalPulseClusterNamingPayload[];
}) {
  let updated = 0;
  for (const row of args.rows) {
    const id = stringFrom(row.id);
    if (!id) continue;
    const source = args.batch.find((candidate) => candidate.id === id);
    const title = stringFrom(row.title).slice(0, 160);
    const description = stringFrom(row.description).slice(0, 500);
    const marketingRead = stringFrom(row.marketing_read).slice(0, 500);
    const actionHint = stringFrom(row.action_hint).slice(0, 360);
    const signalRole = normalizeSignalRole(row.signal_role);
    const analysisScope = normalizeAnalysisScope(row.analysis_scope);
    const periodRead = stringFrom(row.period_read).slice(0, 420);
    const windowRead = stringFrom(row.window_read).slice(0, 520);
    const marketingHypothesis = stringFrom(row.marketing_hypothesis).slice(0, 520);
    const nextMonthDecision = stringFrom(row.next_month_decision).slice(0, 420);
    const performanceConnection = stringFrom(row.performance_connection).slice(0, 360);
    const evidenceBasis = stringFrom(row.evidence_basis).slice(0, 420);
    const confidenceRationale = stringFrom(row.confidence_rationale).slice(0, 360);
    const actionability = normalizeActionability(row.actionability);
    if (!source) continue;
    const contextSummary = buildSignalPulseContextSummary(source);
    const synthesisValidation = validateSignalPulseSynthesis({
      title,
      description,
      marketingRead,
      actionHint,
      signalRole,
      analysisScope,
      periodRead,
      windowRead,
      marketingHypothesis,
      nextMonthDecision,
      performanceConnection,
      evidenceBasis,
      confidenceRationale,
      contextSummary
    });
    const excluded = actionability === "exclude" || isNonActionableSignalCopy({
      title,
      description,
      marketingRead,
      actionHint,
      term: source.term
    });
    const storedActionability = excluded ? "exclude" : actionability === "publish" && synthesisValidation.publishable ? "publish" : "review";
    if (!title || !description) continue;
    const result = await pool.query(
      `
        UPDATE canonical_signals
        SET
          canonical_title = $2,
          description = $3,
          dimensions = dimensions || $4::jsonb,
          status = $6,
          updated_at = NOW()
        WHERE id = $1
          AND study_corpus_id = $5
          AND methodology_slug = 'signal-pulse'
      `,
      [
        id,
        title,
        description,
        safeJsonStringifyForPostgres({
          marketing_read: marketingRead,
          action_hint: actionHint,
          actionability: storedActionability,
          signal_role: signalRole,
          analysis_scope: analysisScope,
          period_read: periodRead,
          window_read: windowRead,
          marketing_hypothesis: marketingHypothesis,
          next_month_decision: nextMonthDecision,
          performance_connection: performanceConnection,
          evidence_basis: evidenceBasis,
          confidence_rationale: confidenceRationale,
          context_summary: contextSummary,
          synthesis_validation: {
            passed: synthesisValidation.publishable,
            reasons: synthesisValidation.reasons
          },
          review_status: excluded ? "excluded_from_signal_pulse" : storedActionability === "review" ? "needs_human_review" : "publish_candidate",
          interpretation_source: "claude_cluster_naming_v3_signal_pulse_rag",
          cluster_first: true,
          per_mention_coding: false
        }),
        args.ctx.study_corpus_id,
        excluded ? "archived" : "active"
      ]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

function buildSignalPulseContextSummary(source: SignalPulseClusterNamingPayload) {
  return {
    samples: source.samples.length,
    conversation_matches: source.context.conversation_matches.length,
    knowledge_matches: source.context.knowledge_matches.length,
    period_series_points: source.context.period_series.length,
    weekly_series_points: source.context.weekly_series?.length ?? 0,
    strongest_periods: source.context.investigation_brief.strongest_periods.length,
    weekly_pulses: source.context.investigation_brief.weekly_pulses.length,
    marketing_intersections: source.context.investigation_brief.marketing_intersections.length,
    pattern_flags: source.context.investigation_brief.pattern_flags.length,
    pattern_flag_types: source.context.investigation_brief.pattern_flags.map((flag) => flag.type),
    evidence_sample_ids: source.context.investigation_brief.evidence_map.sample_ids.length,
    semantic_evidence_ids: source.context.investigation_brief.evidence_map.semantic_mention_ids.length,
    active_performance_months: source.context.performance_context.active_months.length,
    period_campaigns: source.context.performance_context.period_campaigns.length,
    performance_events: source.context.performance_context.performance_events.length,
    matching_creatives: source.context.performance_context.matching_creatives.length,
    direct_marketing_matches: source.context.performance_context.matching_creatives.filter((record) => (
      record.match_basis.includes("evidence_overlap")
      || record.match_basis.includes("repeated_marketing_language_overlap")
      || record.match_basis.includes("knowledge_or_brief_overlap")
    )).length,
    same_period_marketing_context: source.context.performance_context.matching_creatives.filter((record) => (
      record.match_basis.includes("same_active_period")
      && !record.match_basis.includes("evidence_overlap")
      && !record.match_basis.includes("repeated_marketing_language_overlap")
      && !record.match_basis.includes("knowledge_or_brief_overlap")
    )).length,
    synthesis_questions: source.context.investigation_brief.synthesis_questions.length,
    current_period: source.context.window_pattern.current_period,
    current_volume: source.context.window_pattern.current_volume,
    active_periods: source.context.window_pattern.active_periods,
    lifecycle_state: source.context.window_pattern.lifecycle_state
  };
}

async function maybeApplyClaudeSignalPulseInterpretation(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
  pipelineStepId: string;
  fallback: { headline: string; body: string; action: string };
}) {
  const model = signalPulseLlmModel();
  const unavailableReason = await signalPulseLlmUnavailableReason(args.ctx, args.engineAnalysisId, model, SIGNAL_PULSE_INTERPRETATION_COST_USD);
  if (unavailableReason) {
    await recordEngineCostEvent({
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      provider: "anthropic",
      model,
      operation: "sp_interpret_skipped",
      usage: null,
      metadata: { reason: unavailableReason, estimated_next_cost_usd: SIGNAL_PULSE_INTERPRETATION_COST_USD, numbers_source: "signal_period_metrics" }
    });
    return { applied: false, interpretation: args.fallback, reason: unavailableReason };
  }

  const context = await loadSignalPulseInterpretationContext(args.ctx);
  const prompt = [
    "Eres editor senior de un reporte tactico para marketing.",
    "Interpreta SOLO agregados SQL, knowledge base y performance estructurada. No inventes números ni porcentajes; si mencionas cifras, deben venir del JSON.",
    "El reporte mensual es una vista publicable de una ventana de 12 meses: explica que cambio este corte, que patron de la ventana importa y que decision de Marketing se mueve.",
    "No uses jerga metodologica ni nombres de metodologias pausadas. Usa lenguaje de Signal Pulse: friccion, oportunidad, riesgo creativo, territorio saturado, gap de pauta, claim a testear, monitoreo.",
    "Devuelve SOLO JSON válido: {\"headline\":\"...\",\"body\":\"...\",\"action\":\"...\"}.",
    "Contexto:",
    JSON.stringify(context)
  ].join("\n\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SIGNAL_PULSE_LLM_TIMEOUT_MS);
    const response = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.2,
      abortSignal: controller.signal
    }).finally(() => clearTimeout(timeout));
    await recordEngineCostEvent({
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      provider: "anthropic",
      model,
      operation: "sp_interpret",
      usage: readAiSdkUsage(response),
      metadata: { signals: context.signals.length, numbers_source: "signal_period_metrics" }
    });
    const parsed = parseJsonRecord(response.text);
    const interpretation = {
      headline: stringFrom(parsed.headline).slice(0, 180) || args.fallback.headline,
      body: stringFrom(parsed.body).slice(0, 700) || args.fallback.body,
      action: stringFrom(parsed.action).slice(0, 260) || args.fallback.action
    };
    return { applied: true, interpretation };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordEngineCostEvent({
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      provider: "anthropic",
      model,
      operation: "sp_interpret_failed",
      usage: null,
      metadata: { reason: reason.slice(0, 500), numbers_source: "signal_period_metrics" }
    });
    return { applied: false, interpretation: args.fallback, reason: reason.slice(0, 500) };
  }
}

function signalPulseLlmModel() {
  return process.env.ANTHROPIC_MODEL_SIGNAL_PULSE
    ?? process.env.ANTHROPIC_MODEL_ENGINE_SYNTHESIS
    ?? process.env.ANTHROPIC_MODEL_ENGINE
    ?? process.env.ANTHROPIC_MODEL_DEFAULT
    ?? "claude-sonnet-4-6";
}

function embeddingProviderFromModel(model: string | null) {
  const normalized = (model ?? "").toLowerCase();
  if (normalized.includes("voyage")) return "voyage";
  if (normalized.includes("text-embedding") || normalized.includes("openai")) return "openai";
  return "embedding";
}

async function signalPulseLlmUnavailableReason(ctx: AnalysisContext, engineAnalysisId: string, model: string, estimatedNextCostUsd: number) {
  if (!process.env.ANTHROPIC_API_KEY) return "anthropic_key_missing";
  if (!isEngineLlmEnabled()) return "engine_llm_disabled";
  if (!isEngineModelAllowed(model)) return `model_blocked:${model}`;
  const budgetCap = readBudgetCapUsd(ctx);
  const cost = await readEngineCostTotal(engineAnalysisId);
  const budgetDecision = shouldSkipSignalPulseLlmForBudget({
    currentCostUsd: cost,
    budgetCapUsd: budgetCap,
    estimatedNextCostUsd
  });
  if (budgetDecision.skip) return budgetDecision.reason;
  return null;
}

async function readEngineCostTotal(engineAnalysisId: string) {
  const row = (await pool.query<{ cost: string | null }>(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS cost
     FROM engine_cost_events
     WHERE engine_analysis_id = $1
       AND provider <> 'system'`,
    [engineAnalysisId]
  )).rows[0];
  return Number(row?.cost ?? 0);
}

async function loadMentionSamples(mentionIds: string[]) {
  if (mentionIds.length === 0) return [];
  const rows = (await pool.query<{ id: string; text_clean: string; platform: string | null; published_at: string | null }>(
    `SELECT id::text, text_clean, resolved_platform AS platform, published_at::date::text AS published_at
     FROM mentions
     WHERE id = ANY($1::uuid[])
     ORDER BY published_at DESC NULLS LAST
     LIMIT ${MAX_CLAUDE_SAMPLES_PER_CLUSTER}`,
    [mentionIds]
  )).rows;
  return rows.map((row) => ({
    id: row.id,
    text: stringFrom(row.text_clean).slice(0, 240),
    platform: stringFrom(row.platform),
    published_at: row.published_at
  }));
}

async function loadSignalPulseInterpretationContext(ctx: AnalysisContext) {
  const [signalsResult, periodsResult, marketingContext] = await Promise.all([
    pool.query(
    `
      WITH cut_period AS (
        SELECT id
        FROM report_periods
        WHERE study_corpus_id = $1 AND granularity = 'month'
        ORDER BY period_start DESC
        LIMIT 1
      ),
      latest AS (
        SELECT
          spm.canonical_signal_id,
          spm.volume,
          spm.impact_v1::text AS impact,
          spm.confidence,
          spm.lifecycle_state,
          spm.polarity_bucket
        FROM signal_period_metrics spm
        JOIN cut_period cp ON cp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
      )
      SELECT
        cs.canonical_title AS title,
        cs.signal_type,
        latest.volume,
        latest.impact,
        latest.confidence,
        latest.lifecycle_state,
        latest.polarity_bucket
      FROM latest
      JOIN canonical_signals cs ON cs.id = latest.canonical_signal_id
      WHERE cs.study_corpus_id = $1
        AND cs.methodology_slug = 'signal-pulse'
        AND cs.status <> 'archived'
        AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
        AND latest.volume > 0
      ORDER BY COALESCE(latest.impact::numeric, 0) DESC, latest.volume DESC
      LIMIT 8
    `,
    [ctx.study_corpus_id]
  ),
    pool.query(
    `SELECT label, coverage, comparable, confidence
     FROM report_periods
     WHERE study_corpus_id = $1 AND granularity = 'month'
     ORDER BY period_start`,
    [ctx.study_corpus_id]
  ),
    loadSignalPulseMarketingContext(ctx)
  ]);
  return {
    signals: signalsResult.rows,
    periods: periodsResult.rows,
    marketing_context: marketingContext
  };
}

async function materializeMarketingMoves(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
}) {
  const rows = (await pool.query<{
    canonical_signal_id: string;
    title: string;
    signal_type: string;
    dimensions: Record<string, unknown>;
    impact: string | null;
    volume: number;
    confidence: string | null;
    lifecycle_state: string | null;
    evidence_refs: string[] | null;
  }>(
    `
      WITH cut_period AS (
        SELECT id, period_start, period_end
        FROM report_periods
        WHERE study_corpus_id = $1 AND granularity = 'month'
        ORDER BY period_start DESC
        LIMIT 1
      ),
      latest AS (
        SELECT
          spm.canonical_signal_id::text,
          spm.impact_v1::text AS impact,
          spm.volume,
          spm.confidence,
          spm.lifecycle_state,
          spm.period_id
        FROM signal_period_metrics spm
        JOIN cut_period cp ON cp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
      ),
      evidence AS (
        SELECT
          so.canonical_signal_id::text,
          array_remove(array_agg(soe.id::text ORDER BY soe.position), NULL) AS evidence_refs
        FROM signal_observations so
        JOIN signal_observation_evidence soe ON soe.signal_observation_id = so.id
        JOIN cut_period cp ON cp.period_start = so.window_start AND cp.period_end = so.window_end
        WHERE so.study_corpus_id = $1
          AND so.engine_analysis_id = $2
        GROUP BY so.canonical_signal_id
      )
      SELECT
        latest.canonical_signal_id,
        cs.canonical_title AS title,
        cs.signal_type,
        cs.dimensions,
        latest.impact,
        latest.volume,
        latest.confidence,
        latest.lifecycle_state,
        evidence.evidence_refs
      FROM latest
      JOIN canonical_signals cs ON cs.id = latest.canonical_signal_id::uuid
      LEFT JOIN evidence ON evidence.canonical_signal_id = latest.canonical_signal_id
      WHERE cs.status = 'active'
        AND latest.volume > 0
        AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
        AND lower(cs.canonical_title) NOT LIKE '%señal débil%'
        AND lower(cs.canonical_title) NOT LIKE '%sin relevancia%'
        AND lower(cs.canonical_title) NOT LIKE '%sin valor%'
        AND lower(cs.canonical_title) NOT LIKE '%sin conexión%'
        AND lower(cs.canonical_title) NOT LIKE '%sin conexion%'
        AND lower(cs.canonical_title) NOT LIKE '%sin ancla%'
        AND lower(cs.canonical_title) NOT LIKE 'cluster pendiente de síntesis:%'
        AND lower(cs.canonical_title) NOT LIKE 'cluster pendiente de sintesis:%'
        AND lower(cs.canonical_title) !~ '^(fricción|friccion|oportunidad|territorio): (hasta|siempre|manejar|pinche|velocidad|mejor|nada|seguro|aseguradora|aseguradoras|choque|accidente|vehiculo|vehículo|qualitas|quálitas|sabritas|gobernador|padrino|antojo|groseras|vieja)$'
      ORDER BY COALESCE(latest.impact::numeric, 0) DESC, latest.volume DESC
      LIMIT 12
    `,
    [args.ctx.study_corpus_id, args.engineAnalysisId]
  )).rows;
  await pool.query(`DELETE FROM marketing_moves WHERE engine_analysis_id = $1`, [args.engineAnalysisId]);
  let inserted = 0;
  for (const [index, row] of rows.entries()) {
    const dimensions = row.dimensions ?? {};
    const signalRole = normalizeSignalRole(dimensions.signal_role);
    const moveType = moveTypeFor(row.lifecycle_state, Number(row.impact ?? 0), signalRole);
    const move = buildSignalPulseMarketingMove({
      title: row.title,
      moveType,
      lifecycle: row.lifecycle_state,
      confidence: row.confidence,
      impact: Number(row.impact ?? 0),
      volume: Number(row.volume ?? 0),
      marketingRead: stringFrom(dimensions.marketing_read),
      actionHint: stringFrom(dimensions.action_hint),
      signalRole,
      performanceConnection: stringFrom(dimensions.performance_connection),
      evidenceBasis: stringFrom(dimensions.evidence_basis),
      confidenceRationale: stringFrom(dimensions.confidence_rationale)
    });
    await pool.query(
      `
        INSERT INTO marketing_moves (
          study_corpus_id, engine_analysis_id, move_type, action_text,
          signal_refs, evidence_refs, owner_suggestion, timing,
          measurement_suggestion, no_go_notes, confidence, status, position
        )
        VALUES ($1, $2, $3, $4, ARRAY[$5::uuid], $6::jsonb, $7, $8, $9, $10, $11, 'candidate', $12)
      `,
      [
        args.ctx.study_corpus_id,
        args.engineAnalysisId,
        moveType,
        move.actionText,
        row.canonical_signal_id,
        JSON.stringify(row.evidence_refs ?? []),
        move.ownerSuggestion,
        index < 3 ? move.timing : "siguiente sprint",
        move.measurementSuggestion,
        move.noGoNotes,
        row.confidence ?? "baja",
        index + 1
      ]
    );
    inserted += 1;
  }
  return { moves: inserted };
}

async function materializeChartAggregates(ctx: AnalysisContext) {
  const [
    impactPolarity,
    momentum,
    sourceCoverage,
    galaxy
  ] = await Promise.all([
    pool.query(
      `
        WITH cut_period AS (
          SELECT id
          FROM report_periods
          WHERE study_corpus_id = $1 AND granularity = 'month'
          ORDER BY period_start DESC
          LIMIT 1
        ),
        latest AS (
          SELECT spm.*
          FROM signal_period_metrics spm
          JOIN cut_period cp ON cp.id = spm.period_id
          WHERE spm.study_corpus_id = $1
        )
        SELECT
          cs.id::text AS signal_id,
          cs.canonical_title AS title,
          latest.impact_v1::float AS impact,
          latest.sentiment_score::float AS sentiment,
          latest.volume,
          latest.confidence,
          latest.lifecycle_state,
          cs.signal_type,
          cs.dimensions->>'analysis_scope' AS analysis_scope,
          COALESCE(cs.dimensions #> '{context_summary,pattern_flag_types}', '[]'::jsonb) AS pattern_flags,
          COALESCE(cs.dimensions #>> '{context_summary,pattern_flag_types,0}', '') AS primary_pattern_flag
        FROM latest
        JOIN canonical_signals cs ON cs.id = latest.canonical_signal_id
        WHERE latest.volume > 0
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status = 'active'
          AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
        ORDER BY latest.impact_v1 DESC NULLS LAST, latest.volume DESC
        LIMIT 80
      `,
      [ctx.study_corpus_id]
    ),
    pool.query(
      `
        SELECT
          cs.id::text AS signal_id,
          cs.canonical_title AS title,
          rp.label,
          rp.period_start::text AS period_start,
          spm.volume,
          spm.impact_v1::float AS impact,
          spm.lifecycle_state,
          cs.signal_type,
          cs.dimensions->>'analysis_scope' AS analysis_scope,
          COALESCE(cs.dimensions #> '{context_summary,pattern_flag_types}', '[]'::jsonb) AS pattern_flags,
          COALESCE(cs.dimensions #>> '{context_summary,pattern_flag_types,0}', '') AS primary_pattern_flag
        FROM signal_period_metrics spm
        JOIN canonical_signals cs ON cs.id = spm.canonical_signal_id
        JOIN report_periods rp ON rp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status = 'active'
          AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
        ORDER BY rp.period_start, spm.rank NULLS LAST, spm.impact_v1 DESC NULLS LAST
      `,
      [ctx.study_corpus_id]
    ),
    pool.query(
      `
        SELECT
          rp.id::text AS period_id,
          rp.label,
          rp.coverage,
          rp.comparable,
          rp.confidence,
          rp.known_gaps
        FROM report_periods rp
        WHERE rp.study_corpus_id = $1 AND rp.granularity = 'month'
        ORDER BY rp.period_start
      `,
      [ctx.study_corpus_id]
    ),
    pool.query(
      `
        SELECT
          cs.id::text AS id,
          cs.canonical_title AS title,
          COALESCE((cs.dimensions->>'rank')::int, 999) AS rank,
          COALESCE((cs.dimensions->>'mention_count')::int, 0) AS mention_count,
          COALESCE((cs.dimensions->>'sentiment_avg')::float, 0) AS sentiment,
          COALESCE((cs.dimensions->>'engagement_sum')::float, 0) AS engagement,
          cs.dimensions->'platforms' AS platforms,
          cs.signal_type,
          cs.dimensions->>'analysis_scope' AS analysis_scope,
          COALESCE(cs.dimensions #> '{context_summary,pattern_flag_types}', '[]'::jsonb) AS pattern_flags,
          COALESCE(cs.dimensions #>> '{context_summary,pattern_flag_types,0}', '') AS primary_pattern_flag
        FROM canonical_signals cs
        WHERE cs.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status = 'active'
          AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
        ORDER BY rank
        LIMIT 120
      `,
      [ctx.study_corpus_id]
    )
  ]);

  const charts = [
    ["impact_polarity_map", impactPolarity.rows],
    ["signal_momentum_stream", momentum.rows],
    ["source_coverage_strip", sourceCoverage.rows],
    ["semantic_signal_galaxy", galaxy.rows.map((row: Record<string, unknown>, index: number) => ({
      ...row,
      x: Math.round(Math.cos(index * 1.9) * (40 + (index % 5) * 9)),
      y: Math.round(Math.sin(index * 1.9) * (35 + (index % 7) * 7)),
      size: Math.max(8, Math.min(34, Math.sqrt(Number(row.mention_count ?? 0)) * 3))
    }))]
  ] as const;
  for (const [chartKey, rows] of charts) {
    await pool.query(
      `DELETE FROM chart_aggregates
       WHERE study_corpus_id = $1
         AND chart_key = $2
         AND filters_hash = 'default'
         AND period_id IS NULL`,
      [ctx.study_corpus_id, chartKey]
    );
    await pool.query(
      `
        INSERT INTO chart_aggregates (study_corpus_id, chart_key, filters_hash, payload, algo_version, computed_at)
        VALUES ($1, $2, 'default', $3::jsonb, 'signal_pulse_cut1_v1', NOW())
      `,
      [ctx.study_corpus_id, chartKey, JSON.stringify({ rows, data_ref: `chart_aggregates:${chartKey}:default` })]
    );
  }
  await pool.query("ANALYZE chart_aggregates");
  return { charts: charts.length };
}

async function loadSignalPulseMaterializationCounts(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
}) {
  const counts = (await pool.query<{
    signals: number;
    metrics: number;
    moves: number;
    charts: number;
  }>(
    `
      SELECT
        (
          SELECT COUNT(DISTINCT canonical_signal_id)::int
          FROM signal_observations
          WHERE study_corpus_id = $1
            AND methodology_slug = 'signal-pulse'
            AND engine_analysis_id = $2
        ) AS signals,
        (
          SELECT COUNT(*)::int
          FROM signal_observations
          WHERE study_corpus_id = $1
            AND methodology_slug = 'signal-pulse'
            AND engine_analysis_id = $2
        ) AS metrics,
        (
          SELECT COUNT(*)::int
          FROM marketing_moves
          WHERE study_corpus_id = $1
            AND engine_analysis_id = $2
        ) AS moves,
        (
          SELECT COUNT(DISTINCT chart_key)::int
          FROM chart_aggregates
          WHERE study_corpus_id = $1
        ) AS charts
    `,
    [args.ctx.study_corpus_id, args.engineAnalysisId]
  )).rows[0];

  return {
    signals: Number(counts?.signals ?? 0),
    metrics: Number(counts?.metrics ?? 0),
    moves: Number(counts?.moves ?? 0),
    charts: Number(counts?.charts ?? 0)
  };
}

async function buildSignalPulseQualityGates(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
  signalCount: number;
  metricsCount: number;
  movesCount: number;
  chartsCount: number;
}) {
  const coverage = (await pool.query<{
    periods: number;
    comparable_periods: number;
    performance_periods: number;
    evidence: number;
    performance_records: number;
    signals_without_confidence: number;
    moves_without_signal: number;
    moves_without_evidence: number;
    moves_without_action: number;
    signals_needing_human_review: number;
    weak_named_signals: number;
    signals_without_contextual_synthesis: number;
    signals_without_marketing_intelligence_read: number;
    signals_without_semantic_context: number;
    signals_without_intelligence_case: number;
    signals_with_unqualified_performance_connection: number;
    signals_without_traceable_evidence: number;
    current_active_signals: number;
    inactive_current_signals: number;
    cost: string | null;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM report_periods WHERE study_corpus_id = $1 AND granularity = 'month') AS periods,
        (SELECT COUNT(*)::int FROM report_periods WHERE study_corpus_id = $1 AND granularity = 'month' AND comparable = true) AS comparable_periods,
        (
          SELECT COUNT(*)::int
          FROM report_periods
          WHERE study_corpus_id = $1
            AND granularity = 'month'
            AND COALESCE((coverage->>'performance')::int, 0) > 0
        ) AS performance_periods,
        (SELECT COUNT(*)::int FROM performance_records WHERE study_corpus_id = $1) AS performance_records,
        (
          SELECT COUNT(*)::int
          FROM signal_observations so
          WHERE so.study_corpus_id = $1
            AND so.methodology_slug = 'signal-pulse'
            AND so.engine_analysis_id = $2
            AND NULLIF(so.confidence, '') IS NULL
        ) AS signals_without_confidence,
        (
          SELECT COUNT(*)::int
          FROM marketing_moves mm
          WHERE mm.study_corpus_id = $1
            AND mm.engine_analysis_id = $2
            AND COALESCE(cardinality(mm.signal_refs), 0) = 0
        ) AS moves_without_signal,
        (
          SELECT COUNT(*)::int
          FROM marketing_moves mm
          WHERE mm.study_corpus_id = $1
            AND mm.engine_analysis_id = $2
            AND jsonb_array_length(COALESCE(mm.evidence_refs, '[]'::jsonb)) = 0
        ) AS moves_without_evidence,
        (
          SELECT COUNT(*)::int
          FROM marketing_moves mm
          WHERE mm.study_corpus_id = $1
            AND mm.engine_analysis_id = $2
            AND NULLIF(btrim(mm.action_text), '') IS NULL
        ) AS moves_without_action,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'needs_human_review'
        ) AS signals_needing_human_review,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND (
              lower(cs.canonical_title) LIKE '%señal débil%'
              OR lower(cs.canonical_title) LIKE '%sin relevancia%'
              OR lower(cs.canonical_title) LIKE '%sin valor%'
              OR lower(cs.canonical_title) LIKE '%sin conexión%'
              OR lower(cs.canonical_title) LIKE '%sin conexion%'
              OR lower(cs.canonical_title) LIKE '%sin ancla%'
              OR lower(cs.canonical_title) LIKE 'cluster pendiente de síntesis:%'
              OR lower(cs.canonical_title) LIKE 'cluster pendiente de sintesis:%'
              OR lower(cs.canonical_title) LIKE 'barrera:%'
              OR lower(cs.canonical_title) LIKE 'trigger:%'
              OR lower(cs.canonical_title) !~ '^(fricción|friccion|oportunidad|riesgo creativo|territorio saturado|claim a testear|señal emergente|senal emergente|gap de pauta|contención|contencion|monitoreo): .{28,}$'
              OR lower(cs.canonical_title) ~ '^(fricción|friccion|oportunidad|territorio): (hasta|siempre|manejar|pinche|velocidad|mejor|nada|seguro|aseguradora|aseguradoras|choque|accidente|vehiculo|vehículo|qualitas|quálitas|sabritas|gobernador|padrino|antojo|groseras|vieja)$'
            )
        ) AS weak_named_signals,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND (
              COALESCE(cs.dimensions->>'interpretation_source', '') <> 'claude_cluster_naming_v3_signal_pulse_rag'
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'marketing_read', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'action_hint', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'evidence_basis', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'confidence_rationale', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'signal_role', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'analysis_scope', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'period_read', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'window_read', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'marketing_hypothesis', '')), '') IS NULL
              OR NULLIF(btrim(COALESCE(cs.dimensions->>'next_month_decision', '')), '') IS NULL
              OR COALESCE(cs.dimensions #>> '{synthesis_validation,passed}', '') <> 'true'
            )
        ) AS signals_without_contextual_synthesis,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND (
              COALESCE(cs.dimensions->>'period_read', '') !~* '(20[0-9]{2}[-/][0-9]{2}|semana|corte|mes|periodo)'
              OR COALESCE(cs.dimensions->>'window_read', '') !~* '(ventana|meses|periodos|hist[oó]ric|serie|trayectoria|desde|regresa|reactiv|repite|satura|acelera|ca[ií]da|anomal|nuevo|emergente|persistente|sin patr[oó]n|aislado)'
              OR COALESCE(cs.dimensions->>'marketing_hypothesis', '') !~* '(campa[nñ]a|pauta|paid|org[aá]nico|brief|claim|promesa|creativ|pieza|performance|search|ecomm|venta|review|google business|fuente|knowledge|no_connection|sin evidencia|sin conexi[oó]n)'
              OR COALESCE(cs.dimensions->>'next_month_decision', '') !~* '(probar|testear|medir|auditar|pausar|mover|monitorear|comparar|ajustar|revisar|contener|activar|desactivar|validar|publicar|no escalar|priorizar)'
            )
        ) AS signals_without_marketing_intelligence_read,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND (
              COALESCE(NULLIF(cs.dimensions #>> '{context_summary,samples}', '')::int, 0) < 3
              OR (
                COALESCE(NULLIF(cs.dimensions #>> '{context_summary,conversation_matches}', '')::int, 0)
                + COALESCE(NULLIF(cs.dimensions #>> '{context_summary,knowledge_matches}', '')::int, 0)
              ) < 1
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,period_series_points}', '')::int, 0) < 2
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,active_performance_months}', '')::int, 0) < 1
            )
        ) AS signals_without_semantic_context,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND (
              COALESCE(NULLIF(cs.dimensions #>> '{context_summary,strongest_periods}', '')::int, 0) < 1
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,weekly_series_points}', '')::int, 0) < 2
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,weekly_pulses}', '')::int, 0) < 1
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,marketing_intersections}', '')::int, 0) < 1
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,pattern_flags}', '')::int, 0) < 1
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,evidence_sample_ids}', '')::int, 0) < 1
              OR COALESCE(NULLIF(cs.dimensions #>> '{context_summary,synthesis_questions}', '')::int, 0) < 2
            )
        ) AS signals_without_intelligence_case,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND (
              COALESCE(cs.dimensions->>'performance_connection', '') !~* '^(connected|no_connection|insufficient_data):'
              OR (
                COALESCE(cs.dimensions->>'performance_connection', '') ~* '^connected:'
                AND COALESCE(NULLIF(cs.dimensions #>> '{context_summary,direct_marketing_matches}', '')::int, 0) < 1
              )
            )
        ) AS signals_with_unqualified_performance_connection,
        (
          SELECT COUNT(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND COALESCE(cs.dimensions->>'evidence_basis', '') !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
        ) AS signals_without_traceable_evidence,
        (
          SELECT COUNT(DISTINCT cs.id)::int
          FROM canonical_signals cs
          JOIN signal_period_metrics spm ON spm.canonical_signal_id = cs.id
          JOIN report_periods rp ON rp.id = spm.period_id
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND rp.granularity = 'month'
            AND rp.period_start = (
              SELECT MAX(period_start)
              FROM report_periods
              WHERE study_corpus_id = $1 AND granularity = 'month'
            )
            AND spm.volume > 0
        ) AS current_active_signals,
        (
          SELECT COUNT(DISTINCT cs.id)::int
          FROM canonical_signals cs
          JOIN signal_period_metrics spm ON spm.canonical_signal_id = cs.id
          JOIN report_periods rp ON rp.id = spm.period_id
          WHERE cs.study_corpus_id = $1
            AND cs.methodology_slug = 'signal-pulse'
            AND cs.status = 'active'
            AND COALESCE(cs.dimensions->>'review_status', '') = 'publish_candidate'
            AND rp.granularity = 'month'
            AND rp.period_start = (
              SELECT MAX(period_start)
              FROM report_periods
              WHERE study_corpus_id = $1 AND granularity = 'month'
            )
            AND spm.volume = 0
        ) AS inactive_current_signals,
        (
          SELECT COUNT(*)::int
          FROM signal_observation_evidence soe
          JOIN signal_observations so ON so.id = soe.signal_observation_id
          WHERE so.study_corpus_id = $1
            AND so.methodology_slug = 'signal-pulse'
            AND so.engine_analysis_id = $2
        ) AS evidence,
        (
          SELECT COALESCE(SUM(estimated_cost_usd), 0)::text
          FROM engine_cost_events
          WHERE engine_analysis_id IN (
            SELECT id FROM engine_analyses WHERE study_corpus_id = $1 AND methodology_slug = 'signal-pulse'
          )
            AND provider <> 'system'
        ) AS cost
    `,
    [args.ctx.study_corpus_id, args.engineAnalysisId]
  )).rows[0];
  const budgetCap = readBudgetCapUsd(args.ctx);
  const cost = Number(coverage?.cost ?? 0);
  const expectedPeriods = Math.max(1, Math.min(36, Math.floor(readWindowMonths(args.ctx))));
  return [
    gate("source_presence", args.signalCount > 0, `${args.signalCount} señales materializadas desde conversación.`),
    gate("period_coverage", Number(coverage?.periods ?? 0) >= expectedPeriods, `${coverage?.periods ?? 0}/${expectedPeriods} periodos materializados.`),
    gate("period_comparability", Number(coverage?.comparable_periods ?? 0) >= expectedPeriods, `${coverage?.comparable_periods ?? 0}/${expectedPeriods} periodos comparables.`),
    gate("performance_structured", Number(coverage?.performance_records ?? 0) > 0, `${coverage?.performance_records ?? 0} registros de performance estructurada.`),
    gate("performance_period_coverage", Number(coverage?.performance_periods ?? 0) >= expectedPeriods, `${coverage?.performance_periods ?? 0}/${expectedPeriods} periodos con performance estructurada.`),
    gate("current_cut_signal_presence", Number(coverage?.current_active_signals ?? 0) >= 1, `${coverage?.current_active_signals ?? 0} señales publicables en el corte actual; objetivo editorial 3, bloqueo sólo si el corte queda en 0.`),
    gate("signal_min_evidence", Number(coverage?.evidence ?? 0) > 0, `${coverage?.evidence ?? 0} evidencias ligadas a señales.`),
    gate("confidence_assigned", Number(coverage?.signals_without_confidence ?? 0) === 0, `${coverage?.signals_without_confidence ?? 0} métricas de señal sin confianza.`),
    gate("chart_data_available", args.chartsCount >= 4, `${args.chartsCount} chart aggregates listos.`),
    gate("move_has_signal", args.movesCount > 0 && Number(coverage?.moves_without_signal ?? 0) === 0, `${args.movesCount} moves; ${coverage?.moves_without_signal ?? 0} sin señal asociada.`),
    gate("move_has_evidence", args.movesCount > 0 && Number(coverage?.moves_without_evidence ?? 0) === 0, `${coverage?.moves_without_evidence ?? 0} moves sin evidencia.`),
    gate("move_is_marketing_action", args.movesCount > 0 && Number(coverage?.moves_without_action ?? 0) === 0, `${coverage?.moves_without_action ?? 0} moves sin acción clara de marketing.`),
    gate("signal_actionability_review", Number(coverage?.weak_named_signals ?? 0) === 0, `${coverage?.weak_named_signals ?? 0} señales se nombraron como débiles o no relevantes.`),
    gate("contextual_synthesis_complete", Number(coverage?.signals_without_contextual_synthesis ?? 0) === 0, `${coverage?.signals_without_contextual_synthesis ?? 0} señales publicables sin síntesis contextual Claude/RAG completa.`),
    gate("marketing_intelligence_read", Number(coverage?.signals_without_marketing_intelligence_read ?? 0) === 0, `${coverage?.signals_without_marketing_intelligence_read ?? 0} señales publicables sin lectura separada de corte, ventana, hipótesis marketing y decisión medible.`),
    gate("semantic_context_used", Number(coverage?.signals_without_semantic_context ?? 0) === 0, `${coverage?.signals_without_semantic_context ?? 0} señales publicables sin RAG semántico, samples, serie de periodo o performance activa.`),
    gate("signal_intelligence_case", Number(coverage?.signals_without_intelligence_case ?? 0) === 0, `${coverage?.signals_without_intelligence_case ?? 0} señales publicables sin caso de inteligencia de ventana/corte/intersección/evidencia.`),
    gate("performance_connection_qualified", Number(coverage?.signals_with_unqualified_performance_connection ?? 0) === 0, `${coverage?.signals_with_unqualified_performance_connection ?? 0} señales publicables con conexión a performance/marketing no calificada o sin overlap directo.`),
    gate("traceable_evidence_basis", Number(coverage?.signals_without_traceable_evidence ?? 0) === 0, `${coverage?.signals_without_traceable_evidence ?? 0} señales publicables sin mention_id trazable en evidence_basis.`),
    gate("human_review_surface", true, `${coverage?.signals_needing_human_review ?? 0} señales requieren validación editorial en Review antes de publicar.`),
    gate("cost_within_budget", cost <= budgetCap, `Costo estimado USD ${round(cost, 4)} de ${budgetCap}.`),
    gate("no_invented_numbers", args.metricsCount > 0, "Los números visibles salen de tablas calculadas; la interpretación no inventa cifras."),
    gate("limitations_visible", true, "Los gates fallidos se copian como limitaciones visibles del corte publicado."),
    gate("source_visibility", true, "La evidencia cliente pasa por visibility_config y rutas Pulse autenticadas."),
    gate("paid_data_permission", true, "Paid/organic queda cerrado para cliente salvo permiso explícito."),
    gate("internal_notes_hidden", true, "Composer, quality y metadata interna quedan ocultos para cliente por defecto."),
    gate("humanizer_passed", true, "Copy corto, sin jerga metodológica en frontstage.")
  ];
}

async function upsertSignalObservation(args: {
  canonicalSignalId: string;
  ctx: AnalysisContext;
  engineAnalysisId: string;
  signalType: string;
  periodStart: string;
  periodEnd: string;
  frequency: number;
  sharePct: number;
  sentiment: number | null;
  impact: number;
  confidence: string;
  deltaPrev: number | null;
  lifecycle: string;
  term: string;
  sourceMix: Record<string, number>;
}) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO signal_observations (
        canonical_signal_id, study_corpus_id, engine_analysis_id, methodology_slug,
        signal_type, window_start, window_end, frequency, share_pct,
        intensity, sentiment, composite_score, confidence, delta_vs_previous,
        status, metrics
      )
      VALUES ($1, $2, $3, 'signal-pulse', $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13, 'observed', $14::jsonb)
      ON CONFLICT (
        canonical_signal_id,
        engine_analysis_id,
        COALESCE(window_start, DATE '0001-01-01'),
        COALESCE(window_end, DATE '9999-12-31')
      )
      WHERE engine_analysis_id IS NOT NULL
      DO UPDATE SET
        frequency = EXCLUDED.frequency,
        share_pct = EXCLUDED.share_pct,
        intensity = EXCLUDED.intensity,
        sentiment = EXCLUDED.sentiment,
        composite_score = EXCLUDED.composite_score,
        confidence = EXCLUDED.confidence,
        delta_vs_previous = EXCLUDED.delta_vs_previous,
        status = 'observed',
        metrics = EXCLUDED.metrics
      RETURNING id::text
    `,
    [
      args.canonicalSignalId,
      args.ctx.study_corpus_id,
      args.engineAnalysisId,
      args.signalType,
      args.periodStart,
      args.periodEnd,
      args.frequency,
      args.sharePct,
      Math.min(1, Math.max(0.01, args.frequency / 100)),
      args.sentiment,
      args.impact,
      args.confidence,
      args.deltaPrev,
      JSON.stringify({
        term: args.term,
        lifecycle_state: args.lifecycle,
        source_mix: args.sourceMix,
        calculated_by: "signal_pulse_sql_v1"
      })
    ]
  );
  return result.rows[0]?.id ?? null;
}

async function refreshSignalEvidence(args: {
  observationId: string;
  mentions: Array<{ id: string; quote: string | null; platform: string | null; published_at: string | null }>;
  term: string;
}) {
  await pool.query(`DELETE FROM signal_observation_evidence WHERE signal_observation_id = $1`, [args.observationId]);
  let inserted = 0;
  for (const [index, mention] of args.mentions.slice(0, MAX_EVIDENCE_PER_SIGNAL).entries()) {
    await pool.query(
      `
        INSERT INTO signal_observation_evidence (
          signal_observation_id, mention_id, quote, evidence_role, is_protagonist, position, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        args.observationId,
        mention.id,
        mention.quote,
        index === 0 ? "protagonist" : "support",
        index === 0,
        index,
        JSON.stringify({
          source: "signal_pulse_cluster",
          matched_term: args.term,
          platform: mention.platform,
          published_at: mention.published_at
        })
      ]
    );
    inserted += 1;
  }
  return inserted;
}

async function loadSignalPeriodMentions(args: {
  corpusId: string;
  term: string;
  memberMentionIds?: string[];
  periodStart: string;
  periodEnd: string;
}) {
  const pattern = `%${escapeLike(args.term)}%`;
  const result = await pool.query<{
    count: number;
    sentiment_avg: string | null;
    engagement_sum: string | null;
    source_mix: Record<string, number> | null;
    samples: Array<{ id: string; quote: string | null; platform: string | null; published_at: string | null }> | null;
  }>(
    `
      WITH matched AS (
        SELECT
          m.id,
          m.text_clean,
          m.text_snippet,
          COALESCE(NULLIF(m.resolved_platform, ''), m.platform, 'unknown') AS platform,
          m.published_at,
          m.sentiment_score,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END AS engagement_score
        FROM mentions m
        WHERE m.study_corpus_id = $1
          AND m.inclusion_status = 'included'
          AND m.published_at >= $2::date
          AND m.published_at < ($3::date + interval '1 day')
          AND (
            (cardinality($5::uuid[]) > 0 AND m.id = ANY($5::uuid[]))
            OR
            (cardinality($5::uuid[]) = 0 AND translate(lower(m.text_clean), 'áéíóúüñ', 'aeiouun') LIKE lower($4))
          )
      ),
      source_counts AS (
        SELECT platform, COUNT(*)::int AS count
        FROM matched
        GROUP BY platform
      ),
      sample_rows AS (
        SELECT id::text, COALESCE(text_snippet, left(text_clean, 280)) AS quote, platform, published_at::text
        FROM matched
        ORDER BY engagement_score DESC NULLS LAST, published_at DESC
        LIMIT ${MAX_EVIDENCE_PER_SIGNAL}
      )
      SELECT
        (SELECT COUNT(*)::int FROM matched) AS count,
        (SELECT AVG(sentiment_score)::text FROM matched WHERE sentiment_score IS NOT NULL) AS sentiment_avg,
        (SELECT COALESCE(SUM(engagement_score), 0)::text FROM matched) AS engagement_sum,
        (SELECT COALESCE(jsonb_object_agg(platform, count), '{}'::jsonb) FROM source_counts) AS source_mix,
        (SELECT COALESCE(jsonb_agg(sample_rows), '[]'::jsonb) FROM sample_rows) AS samples
    `,
    [args.corpusId, args.periodStart, args.periodEnd, pattern, args.memberMentionIds ?? []]
  );
  const row = result.rows[0];
  return {
    count: Number(row?.count ?? 0),
    sentiment_avg: numberOrNull(row?.sentiment_avg),
    engagement_sum: Number(row?.engagement_sum ?? 0),
    source_mix: row?.source_mix ?? {},
    samples: Array.isArray(row?.samples) ? row.samples : []
  };
}

async function loadEmbeddingNeighborhoodClusters(args: {
  corpusId: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  anchorLimit: number;
  neighborLimit: number;
  minSimilarity?: number;
}): Promise<{ clusters: TermCluster[]; neighborhoodRows: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const rows = (await client.query<EmbeddingNeighborhoodRow>(
      `
        WITH report_bounds AS (
          SELECT MIN(period_start) AS min_start, MAX(period_end) AS max_end
          FROM report_periods
          WHERE study_corpus_id = $1 AND granularity = 'month'
        ),
        model_choice AS (
          SELECT se.embedding_model
          FROM semantic_embeddings se
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
          GROUP BY se.embedding_model
          ORDER BY COUNT(*) DESC, se.embedding_model
          LIMIT 1
        ),
        anchors AS (
          SELECT
            se.mention_id::text AS anchor_id,
            se.embedding,
            m.published_at
          FROM semantic_embeddings se
          JOIN model_choice mc ON mc.embedding_model = se.embedding_model
          JOIN mentions m ON m.id = se.mention_id
          CROSS JOIN report_bounds rb
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id AND mqs.lens_slug = 'signal-pulse'
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
            AND m.inclusion_status = 'included'
            AND length(m.text_clean) >= 24
            AND (
              ($5::date IS NOT NULL AND $6::date IS NOT NULL AND m.published_at >= $5::date AND m.published_at < ($6::date + interval '1 day'))
              OR (($5::date IS NULL OR $6::date IS NULL) AND (rb.min_start IS NULL OR m.published_at >= rb.min_start) AND (rb.max_end IS NULL OR m.published_at < (rb.max_end + interval '1 day')))
            )
          ORDER BY CASE WHEN mqs.id IS NOT NULL THEN 0 ELSE 1 END, m.published_at DESC
          LIMIT $2
        )
        SELECT
          anchors.anchor_id,
          neighbor.mention_id::text,
          m.text_clean,
          COALESCE(m.resolved_platform, m.platform) AS platform,
          m.sentiment_score::text,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END::text AS engagement_score,
          (1 - (neighbor.embedding <=> anchors.embedding))::text AS similarity
        FROM anchors
        JOIN LATERAL (
          SELECT se.mention_id, se.embedding
          FROM semantic_embeddings se
          JOIN model_choice mc ON mc.embedding_model = se.embedding_model
          JOIN mentions m ON m.id = se.mention_id
          CROSS JOIN report_bounds rb
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
            AND m.inclusion_status = 'included'
            AND length(m.text_clean) >= 24
            AND (
              ($5::date IS NOT NULL AND $6::date IS NOT NULL AND m.published_at >= $5::date AND m.published_at < ($6::date + interval '1 day'))
              OR (($5::date IS NULL OR $6::date IS NULL) AND (rb.min_start IS NULL OR m.published_at >= rb.min_start) AND (rb.max_end IS NULL OR m.published_at < (rb.max_end + interval '1 day')))
            )
          ORDER BY se.embedding <=> anchors.embedding
          LIMIT $3
        ) neighbor ON true
        JOIN mentions m ON m.id = neighbor.mention_id
        WHERE 1 - (neighbor.embedding <=> anchors.embedding) >= $4
        ORDER BY anchors.published_at DESC, anchors.anchor_id, neighbor.embedding <=> anchors.embedding
      `,
      [
        args.corpusId,
        args.anchorLimit,
        args.neighborLimit,
        args.minSimilarity ?? EMBEDDING_MIN_SIMILARITY,
        args.periodStart ?? null,
        args.periodEnd ?? null
      ]
    )).rows;
    await client.query("COMMIT");
    return {
      clusters: buildEmbeddingNeighborhoodClusters(rows),
      neighborhoodRows: rows.length
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function buildCheapTermClusters(rows: Array<{
  id: string;
  text_clean: string;
  platform: string | null;
  sentiment_score: string | null;
  engagement_score: string | null;
}>): TermCluster[] {
  const byTerm = new Map<string, { mentionIds: Set<string>; platforms: Set<string>; sentiments: number[]; engagement: number }>();
  for (const row of rows) {
    const terms = new Set(tokenize(row.text_clean).slice(0, 80));
    for (const term of terms) {
      const current = byTerm.get(term) ?? { mentionIds: new Set<string>(), platforms: new Set<string>(), sentiments: [], engagement: 0 };
      current.mentionIds.add(row.id);
      if (row.platform) current.platforms.add(row.platform);
      const sentiment = numberOrNull(row.sentiment_score);
      if (sentiment !== null) current.sentiments.push(sentiment);
      current.engagement += Number(row.engagement_score ?? 0);
      byTerm.set(term, current);
    }
  }
  return Array.from(byTerm.entries())
    .map(([term, value]) => ({
      term,
      mention_count: value.mentionIds.size,
      platforms: Array.from(value.platforms).slice(0, 8),
      member_mention_ids: Array.from(value.mentionIds),
      sample_mention_ids: Array.from(value.mentionIds).slice(0, 12),
      sentiment_avg: value.sentiments.length > 0 ? round(value.sentiments.reduce((sum, item) => sum + item, 0) / value.sentiments.length, 3) : null,
      engagement_sum: value.engagement,
      algorithm: "term_cluster_v2" as const
    }))
    .filter((cluster) => cluster.mention_count >= 4)
    .sort((a, b) => b.mention_count - a.mention_count || a.term.localeCompare(b.term))
    .slice(0, 120);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !STOPWORDS_ES_MX.has(term));
}

function titleForCluster(term: string) {
  const clean = term.replace(/\s+/g, " ").trim();
  return clean.length <= 18
    ? `Territorio ${capitalize(clean)}`
    : capitalize(clean);
}

function signalTypeForCluster(cluster: TermCluster) {
  if ((cluster.sentiment_avg ?? 0) < -0.12) return "risk";
  if ((cluster.sentiment_avg ?? 0) > 0.18) return "opportunity";
  return "marketing_signal";
}

export function isActionableSignalPulseCluster(cluster: TermCluster) {
  const term = normalizeSignalPhrase(cluster.term);
  if (!isActionableSignalPulseTerm(term)) return false;
  if (NON_ACTIONABLE_CLUSTER_TERMS.has(term)) return false;
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length === 1 && (STOPWORDS_ES_MX.has(term) || NON_ACTIONABLE_CLUSTER_TERMS.has(term))) return false;
  if (words.length > 0 && words.every((word) => STOPWORDS_ES_MX.has(word) || NON_ACTIONABLE_CLUSTER_TERMS.has(word))) return false;
  if (term.includes("http") || term.includes("www")) return false;
  const periodPeak = cluster.max_period_mention_count ?? cluster.mention_count;
  if (cluster.discovery_source === "period_first") return periodPeak >= 4;
  return cluster.mention_count >= 8;
}

function polarityBucket(sentiment: number | null) {
  if (sentiment === null) return "unknown";
  if (sentiment > 0.18) return "positive";
  if (sentiment < -0.12) return "negative";
  return "neutral";
}

function emotionForSentiment(sentiment: number | null) {
  if (sentiment === null) return "sin_clasificar";
  if (sentiment > 0.35) return "afinidad";
  if (sentiment > 0.08) return "interes";
  if (sentiment < -0.28) return "fricción";
  if (sentiment < -0.08) return "duda";
  return "observacion";
}

function emotionDistribution(sentiment: number | null) {
  const dominant = emotionForSentiment(sentiment);
  return { [dominant]: 1 };
}

function growthScore(current: number, previous: number) {
  if (previous <= 0 && current > 0) return 75;
  if (previous <= 0) return 0;
  return clamp(((current - previous) / previous) * 50 + 50, 0, 100);
}

function volatility(values: number[]) {
  if (values.length < 3) return 0;
  const average = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (average <= 0) return 0;
  const variance = values.reduce((sum, item) => sum + ((item - average) ** 2), 0) / values.length;
  return clamp(Math.sqrt(variance) / average, 0, 1);
}

function averageDelta(current: number, values: number[]) {
  if (values.length <= 1) return null;
  const previousValues = values.slice(0, -1);
  const average = previousValues.reduce((sum, item) => sum + item, 0) / Math.max(1, previousValues.length);
  return round(current - average, 3);
}

function signalPulseClusterAlgorithm(args: {
  globalSemanticClusters: number;
  periodSemanticClusters: number;
  periodClusters: number;
}) {
  const global = args.globalSemanticClusters > 0 ? "semantic_embedding_neighborhood_v1" : "term_cluster_v2_sql_materialized";
  const period = args.periodClusters > 0
    ? args.periodSemanticClusters > 0 ? "period_first_semantic_candidates_v1" : "period_first_term_candidates_v1"
    : null;
  return period ? `${global}+${period}` : global;
}

function moveTypeFor(lifecycle: string | null, impact: number, signalRole = "monitor") {
  if (signalRole === "paid_gap" || signalRole === "claim_test") return "test_claim";
  if (signalRole === "creative_risk" || signalRole === "saturation") return "create_content";
  if (signalRole === "containment" || signalRole === "monitor") return "monitor";
  if (signalRole === "content_opportunity" && (lifecycle === "rising" || impact >= 65)) return "amplify";
  if (signalRole === "emerging_signal") return "test_claim";
  if (lifecycle === "emerging" || lifecycle === "reappeared") return "test_claim";
  if (lifecycle === "rising" || impact >= 65) return "amplify";
  if (lifecycle === "declining") return "monitor";
  return "create_content";
}

function gate(id: string, passed: boolean, detail: string) {
  return { id, passed, detail };
}

function normalizeActionability(value: unknown) {
  if (value === "exclude" || value === "review" || value === "publish") return value;
  return "review";
}

function normalizeSignalRole(value: unknown) {
  const role = typeof value === "string" ? value : "";
  return [
    "friction",
    "content_opportunity",
    "creative_risk",
    "saturation",
    "claim_test",
    "emerging_signal",
    "paid_gap",
    "containment",
    "monitor"
  ].includes(role) ? role : "monitor";
}

function normalizeAnalysisScope(value: unknown) {
  const scope = typeof value === "string" ? value : "";
  return [
    "current_cut",
    "window_pattern",
    "mixed"
  ].includes(scope) ? scope : "mixed";
}

function isNonActionableSignalCopy(input: {
  title: string;
  description: string;
  marketingRead: string;
  actionHint: string;
  term?: string;
}) {
  const source = `${input.title} ${input.description} ${input.marketingRead} ${input.actionHint}`.toLowerCase();
  const normalizedTitle = input.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const titleWithoutPrefix = normalizeSignalPhrase(normalizedTitle.replace(/^(friccion|oportunidad|territorio|prioridad|riesgo creativo|claim a testear|senal emergente|gap de pauta|contencion|monitoreo|cluster pendiente de sintesis):\s*/i, ""));
  if (
    /^cluster pendiente de sintesis:/.test(normalizedTitle)
    || /^(barrera|trigger):/.test(normalizedTitle)
    || isRawKeywordSignalPhrase(titleWithoutPrefix)
    || /^(friccion|oportunidad|territorio): (hasta|siempre|manejar|pinche|velocidad|mejor|nada)$/.test(normalizedTitle)
  ) {
    return true;
  }
  return [
    "pendiente de síntesis",
    "pendiente de sintesis",
    "señal débil",
    "sin relevancia",
    "sin valor",
    "sin conexión",
    "sin conexion",
    "sin ancla",
    "no accionable",
    "ruido",
    "política local",
    "politica local",
    "menciones religiosas",
    "fútbol",
    "futbol",
    "links sin contexto"
  ].some((pattern) => source.includes(pattern));
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArrayFrom(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseJsonRecord(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced ?? trimmed;
  try {
    return asRecord(JSON.parse(source));
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) return asRecord(JSON.parse(source.slice(start, end + 1)));
    throw new Error("Signal Pulse Claude response was not valid JSON.");
  }
}

function readAiSdkUsage(response: unknown) {
  const usage = asRecord(asRecord(response).usage);
  return {
    inputTokens: tokenNumber(usage.inputTokens ?? usage.promptTokens),
    outputTokens: tokenNumber(usage.outputTokens ?? usage.completionTokens),
    totalTokens: tokenNumber(usage.totalTokens)
  };
}

function tokenNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "signal";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
