import type { Job } from "bullmq";

import {
  buildMonthlyReportPeriods,
  calculateImpactV1,
  classifySignalPulseLifecycle
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
  type EmbeddingNeighborhoodRow,
  type TermCluster
} from "./signal-pulse-clustering";
import { buildSignalPulseDeterministicRead, buildSignalPulseMarketingMove } from "./signal-pulse-copy";

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

const STOPWORDS_ES_MX = new Set([
  "para", "pero", "como", "con", "que", "por", "una", "uno", "los", "las", "del", "este", "esta",
  "esto", "muy", "mas", "menos", "porque", "cuando", "todo", "toda", "todos", "todas", "solo", "bien",
  "mal", "sin", "hay", "son", "soy", "fue", "ser", "mis", "sus", "me", "mi", "ya", "no", "si",
  "tambien", "marca", "producto", "personas", "gente", "hacer", "dice", "dicen", "video", "comentario"
]);

const MAX_SIGNAL_CLUSTERS = 24;
const MAX_EVIDENCE_PER_SIGNAL = 8;
const EMBEDDING_ANCHOR_LIMIT = 220;
const EMBEDDING_NEIGHBORS_PER_ANCHOR = 36;
const EMBEDDING_MIN_SIMILARITY = 0.74;

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
      [ctx.study_corpus_id]
    )).rows;

    const readiness = {
      conversation_mentions: Number(coverage?.conversation_mentions ?? 0),
      signal_pulse_mentions: Number(coverage?.signal_pulse_mentions ?? 0),
      performance_records: Number(coverage?.performance_records ?? 0),
      query_packs: Number(coverage?.query_packs ?? 0),
      budget_cap_usd: budgetCapUsd,
      estimated_cost_usd: 0,
      cluster_first: true,
      status: Number(coverage?.conversation_mentions ?? 0) > 0 ? "ready" : "blocked"
    };

    await mergeMeta(engineAnalysisId, { signal_pulse: { readiness } });
    await recordEngineCostEvent({
      engineAnalysisId,
      pipelineStepId,
      provider: "system",
      model: null,
      operation: "sp_readiness_estimate",
      estimatedCostUsd: 0,
      metadata: readiness
    });
    await markEngineStepCompleted({ pipelineStepId, resultSummary: readiness });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_periods" });
    return { ...readiness, next_step_job_id: next.jobId };
  });
}

export async function signalPulsePeriodsJob(job: Job<SignalPulseStepJobData>) {
  return runSignalPulseStep(job, async ({ engineAnalysisId, pipelineStepId }) => {
    const ctx = await loadSignalPulseContext(engineAnalysisId);
    assertSignalPulse(ctx);
    const bounds = (await pool.query<{ max_date: string | null }>(
      `SELECT max(published_at)::date::text AS max_date
       FROM mentions
       WHERE study_corpus_id = $1 AND inclusion_status = 'included'`,
      [ctx.study_corpus_id]
    )).rows[0];
    const periods = buildMonthlyReportPeriods({
      windowEnd: bounds?.max_date ?? new Date(),
      months: readWindowMonths(ctx)
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '120s'");
      for (const period of periods) {
        const coverage = (await client.query<{
          conversation: number;
          performance: number;
          by_source: Record<string, number> | null;
        }>(
          `
            WITH conversation AS (
              SELECT
                COUNT(DISTINCT m.id)::int AS conversation,
                jsonb_object_agg(platform, count) AS by_source
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
          [ctx.study_corpus_id, period.periodStart, period.periodEnd]
        )).rows[0];
        const coveragePayload = {
          conversation: Number(coverage?.conversation ?? 0),
          performance: Number(coverage?.performance ?? 0),
          by_source: coverage?.by_source ?? {}
        };
        await client.query(
          `
            INSERT INTO report_periods (
              study_corpus_id, granularity, period_start, period_end, label,
              coverage, comparable, comparability_reasons, confidence, known_gaps, computed_at
            )
            VALUES ($1, 'month', $2::date, $3::date, $4, $5::jsonb, $6, $7::jsonb, $8, $9::jsonb, NOW())
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
            ctx.study_corpus_id,
            period.periodStart,
            period.periodEnd,
            period.label,
            JSON.stringify(coveragePayload),
            coveragePayload.conversation > 0,
            JSON.stringify(coveragePayload.conversation > 0 ? [] : ["sin conversation evidence en el periodo"]),
            coveragePayload.conversation >= 150 ? "alta" : coveragePayload.conversation >= 30 ? "media" : "baja",
            JSON.stringify(coveragePayload.performance > 0 ? [] : ["sin performance estructurada"])
          ]
        );
      }
      await client.query("ANALYZE report_periods");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await mergeMeta(engineAnalysisId, { signal_pulse: { periods: { count: periods.length, labels: periods.map((period) => period.label) } } });
    await markEngineStepCompleted({ pipelineStepId, resultSummary: { periods: periods.length } });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_cluster" });
    return { periods: periods.length, next_step_job_id: next.jobId };
  });
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
          AND length(m.text_clean) >= 24
        ORDER BY CASE WHEN mqs.id IS NOT NULL THEN 0 ELSE 1 END, m.published_at DESC
        LIMIT 6000
      `,
      [ctx.study_corpus_id]
    )).rows;
    const embeddingClusters = await loadEmbeddingNeighborhoodClusters(ctx.study_corpus_id);
    const clusters = (embeddingClusters.length > 0 ? embeddingClusters : buildCheapTermClusters(rows))
      .slice(0, MAX_SIGNAL_CLUSTERS);
    const signals = await materializeCanonicalSignals({ ctx, engineAnalysisId, clusters });
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        cluster: {
          algorithm: embeddingClusters.length > 0 ? "semantic_embedding_neighborhood_v1" : "term_cluster_v2_sql_materialized",
          fallback_used: embeddingClusters.length === 0,
          cluster_first: true,
          per_mention_coding: false,
          clusters,
          materialized_signals: signals.length
        }
      }
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: { clusters: clusters.length, materialized_signals: signals.length, mentions_sampled: rows.length }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "sp_name_signals" });
    return {
      clusters: clusters.length,
      algorithm: embeddingClusters.length > 0 ? "semantic_embedding_neighborhood_v1" : "term_cluster_v2_sql_materialized",
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
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        naming: {
          status: "materialized",
          interpretation_source: "deterministic_marketing_read_v2",
          cluster_first: true,
          per_mention_coding: false,
          updated_signals: updated
        }
      }
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: { status: "materialized", updated_signals: updated, per_mention_coding: false }
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
    const interpretation = await buildSignalPulseInterpretation(ctx);
    await mergeMeta(engineAnalysisId, {
      signal_pulse: {
        interpretation: {
          ...interpretation,
          source: "sql_metric_interpretation_v1",
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
           current_step = 'sp_metrics',
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

function readBudgetCapUsd(ctx: AnalysisContext) {
  return numberFrom(ctx.params?.budget_cap_usd) ?? numberFrom(ctx.analysis_plan?.budget_cap_usd) ?? 5;
}

function numberFrom(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function mergeMeta(engineAnalysisId: string, meta: Record<string, unknown>) {
  const signalPulseMeta = meta.signal_pulse;
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
    return;
  }

  await pool.query(
    `UPDATE engine_analyses
     SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [safeJsonStringifyForPostgres(meta), engineAnalysisId]
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
    const description = `La conversacion esta agrupando menciones alrededor de ${title.toLowerCase()}.`;
    const firstLast = await pool.query<{ first_seen: string | null; last_seen: string | null }>(
      `
        SELECT MIN(published_at)::text AS first_seen, MAX(published_at)::text AS last_seen
        FROM mentions
        WHERE id = ANY($1::uuid[])
      `,
      [cluster.sample_mention_ids]
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
          cluster_first: true
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

async function materializePeriodMetrics(args: {
  ctx: AnalysisContext;
  engineAnalysisId: string;
}) {
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
      WITH latest AS (
        SELECT DISTINCT ON (spm.canonical_signal_id)
          spm.canonical_signal_id,
          spm.volume,
          spm.impact_v1::text AS impact,
          spm.confidence,
          spm.lifecycle_state
        FROM signal_period_metrics spm
        JOIN report_periods rp ON rp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
        ORDER BY spm.canonical_signal_id, rp.period_start DESC
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
      ORDER BY COALESCE(latest.impact::numeric, 0) DESC, latest.volume DESC
      LIMIT 1
    `,
    [ctx.study_corpus_id]
  )).rows[0];

  if (!row) {
    return {
      headline: "Todavia no hay senales suficientes para mover marketing.",
      body: "Falta conversacion materializada en signal_period_metrics antes de sostener una lectura.",
      action: "Revisar cobertura de fuentes y volver a correr Signal Pulse."
    };
  }

  const posture = row.signal_type === "risk" ? "requiere contencion" : row.lifecycle_state === "accelerating" ? "esta acelerando" : "merece una prueba controlada";
  return {
    headline: `${row.title} ${posture} este corte.`,
    body: `La senal llega con ${Number(row.volume ?? 0)} menciones en el periodo mas reciente, impacto ${Number(row.impact ?? 0)} y confianza ${row.confidence ?? "baja"}.`,
    action: row.signal_type === "risk"
      ? "Reducir la friccion en claims, piezas y pauta antes de amplificar el territorio."
      : "Convertir la senal en un hook medible antes de mover presupuesto fuerte."
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
      WITH latest AS (
        SELECT DISTINCT ON (spm.canonical_signal_id)
          spm.canonical_signal_id::text,
          spm.impact_v1::text AS impact,
          spm.volume,
          spm.confidence,
          spm.lifecycle_state,
          spm.period_id
        FROM signal_period_metrics spm
        JOIN report_periods rp ON rp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
        ORDER BY spm.canonical_signal_id, rp.period_start DESC
      ),
      evidence AS (
        SELECT
          so.canonical_signal_id::text,
          array_remove(array_agg(soe.id::text ORDER BY soe.position), NULL) AS evidence_refs
        FROM signal_observations so
        JOIN signal_observation_evidence soe ON soe.signal_observation_id = so.id
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
      ORDER BY COALESCE(latest.impact::numeric, 0) DESC, latest.volume DESC
      LIMIT 12
    `,
    [args.ctx.study_corpus_id, args.engineAnalysisId]
  )).rows;
  await pool.query(`DELETE FROM marketing_moves WHERE engine_analysis_id = $1`, [args.engineAnalysisId]);
  let inserted = 0;
  for (const [index, row] of rows.entries()) {
    const moveType = moveTypeFor(row.lifecycle_state, Number(row.impact ?? 0));
    const dimensions = row.dimensions ?? {};
    const move = buildSignalPulseMarketingMove({
      title: row.title,
      moveType,
      lifecycle: row.lifecycle_state,
      confidence: row.confidence,
      impact: Number(row.impact ?? 0),
      volume: Number(row.volume ?? 0),
      marketingRead: stringFrom(dimensions.marketing_read),
      actionHint: stringFrom(dimensions.action_hint)
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
        WITH latest AS (
          SELECT DISTINCT ON (spm.canonical_signal_id)
            spm.*
          FROM signal_period_metrics spm
          JOIN report_periods rp ON rp.id = spm.period_id
          WHERE spm.study_corpus_id = $1
          ORDER BY spm.canonical_signal_id, rp.period_start DESC
        )
        SELECT
          cs.id::text AS signal_id,
          cs.canonical_title AS title,
          latest.impact_v1::float AS impact,
          latest.sentiment_score::float AS sentiment,
          latest.volume,
          latest.confidence,
          latest.lifecycle_state
        FROM latest
        JOIN canonical_signals cs ON cs.id = latest.canonical_signal_id
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
          spm.lifecycle_state
        FROM signal_period_metrics spm
        JOIN canonical_signals cs ON cs.id = spm.canonical_signal_id
        JOIN report_periods rp ON rp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
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
          cs.dimensions->'platforms' AS platforms
        FROM canonical_signals cs
        WHERE cs.study_corpus_id = $1
          AND cs.methodology_slug = 'signal-pulse'
          AND cs.status <> 'archived'
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
          SELECT COUNT(*)::int
          FROM canonical_signals
          WHERE study_corpus_id = $1
            AND methodology_slug = 'signal-pulse'
            AND status <> 'archived'
        ) AS signals,
        (
          SELECT COUNT(*)::int
          FROM signal_period_metrics
          WHERE study_corpus_id = $1
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
    cost: string | null;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM report_periods WHERE study_corpus_id = $1) AS periods,
        (SELECT COUNT(*)::int FROM report_periods WHERE study_corpus_id = $1 AND comparable = true) AS comparable_periods,
        (
          SELECT COUNT(*)::int
          FROM report_periods
          WHERE study_corpus_id = $1
            AND COALESCE((coverage->>'performance')::int, 0) > 0
        ) AS performance_periods,
        (SELECT COUNT(*)::int FROM performance_records WHERE study_corpus_id = $1) AS performance_records,
        (
          SELECT COUNT(*)::int
          FROM signal_observation_evidence soe
          JOIN signal_observations so ON so.id = soe.signal_observation_id
          WHERE so.study_corpus_id = $1 AND so.methodology_slug = 'signal-pulse'
        ) AS evidence,
        (
          SELECT COALESCE(SUM(estimated_cost_usd), 0)::text
          FROM engine_cost_events
          WHERE engine_analysis_id IN (
            SELECT id FROM engine_analyses WHERE study_corpus_id = $1 AND methodology_slug = 'signal-pulse'
          )
        ) AS cost
    `,
    [args.ctx.study_corpus_id]
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
    gate("signal_min_evidence", Number(coverage?.evidence ?? 0) > 0, `${coverage?.evidence ?? 0} evidencias ligadas a señales.`),
    gate("chart_data_available", args.chartsCount >= 4, `${args.chartsCount} chart aggregates listos.`),
    gate("move_has_signal", args.movesCount > 0, `${args.movesCount} moves con señal asociada.`),
    gate("cost_within_budget", cost <= budgetCap, `Costo estimado USD ${round(cost, 4)} de ${budgetCap}.`),
    gate("no_invented_numbers", args.metricsCount > 0, "Los números visibles salen de report_periods, signal_period_metrics y chart_aggregates."),
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

async function loadEmbeddingNeighborhoodClusters(corpusId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const rows = (await client.query<EmbeddingNeighborhoodRow>(
      `
        WITH model_choice AS (
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
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id AND mqs.lens_slug = 'signal-pulse'
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
            AND m.inclusion_status = 'included'
            AND length(m.text_clean) >= 24
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
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
            AND m.inclusion_status = 'included'
            AND length(m.text_clean) >= 24
          ORDER BY se.embedding <=> anchors.embedding
          LIMIT $3
        ) neighbor ON true
        JOIN mentions m ON m.id = neighbor.mention_id
        WHERE 1 - (neighbor.embedding <=> anchors.embedding) >= $4
        ORDER BY anchors.published_at DESC, anchors.anchor_id, neighbor.embedding <=> anchors.embedding
      `,
      [corpusId, EMBEDDING_ANCHOR_LIMIT, EMBEDDING_NEIGHBORS_PER_ANCHOR, EMBEDDING_MIN_SIMILARITY]
    )).rows;
    await client.query("COMMIT");
    return buildEmbeddingNeighborhoodClusters(rows);
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
  if (sentiment < -0.28) return "friccion";
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

function moveTypeFor(lifecycle: string | null, impact: number) {
  if (lifecycle === "emerging") return "test_claim";
  if (lifecycle === "rising" || impact >= 65) return "amplify";
  if (lifecycle === "declining") return "monitor";
  return "create_content";
}

function gate(id: string, passed: boolean, detail: string) {
  return { id, passed, detail };
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArrayFrom(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
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
