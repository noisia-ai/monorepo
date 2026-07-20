import type { TbRagPromptContext } from "@noisia/query-engine";
import type { QueryResultRow } from "pg";
import { pool } from "../db/client";
import { loadAnalysisRagContext } from "./analysis-rag-context";
import { describeCorpusSqlVirtualSchema, runCorpusSql, type CorpusSqlResult } from "./corpus-sql";
import {
  DATA_OS_CAPABILITY_ROLLUP_SQL,
  buildDataOsCapabilities,
  buildDataOsCapabilityGuardrails,
  type DataOsCapability,
  type DataOsCapabilityRow
} from "./tb-data-os-capabilities";
import {
  DATA_OS_SOURCE_INVENTORY_SQL,
  buildDataOsSourceInventory,
  type DataOsSourceInventoryItem,
  type DataOsSourceInventoryRow
} from "./tb-data-os-source-inventory";
import { selectTbRagMonthlySeries, type TbRagSeriesRow } from "./tb-rag-series";

type AnalysisScopeRow = {
  study_corpus_id: string;
  brand_id: string | null;
};

export async function loadTbRagPromptContext(tbAnalysisId: string): Promise<TbRagPromptContext> {
  const scope = await loadAnalysisScope(tbAnalysisId);
  const rag = await loadAnalysisRagContext(scope.study_corpus_id, scope.brand_id);
  const structuredObservations = await loadStructuredObservationSnapshot(scope.study_corpus_id);
  await recordStructuredObservationConsumption(tbAnalysisId, structuredObservations);

  return {
    query_strategy_brief: rag.queryStrategyBrief,
    knowledge_sources: rag.knowledgeSources
      .filter((source) => source.type !== "query_strategy_brief")
      .slice(0, 8)
      .map((source) => ({
        type: source.type,
        content: compactForPrompt(source.content)
      })),
    corpus_intelligence: await loadCorpusIntelligenceSnapshot(tbAnalysisId),
    structured_observations: structuredObservations
  };
}

type StructuredObservationSummaryRow = {
  observations: number | string;
  accepted_observations: number | string;
  review_observations: number | string;
  rejected_observations: number | string;
  records: number | string;
  accepted_records: number | string;
  review_records: number | string;
  rejected_records: number | string;
  temporal_records: number | string;
  snapshot_records: number | string;
  assets: number | string;
  datasets: number | string;
  metric_families: number | string;
  metric_keys: number | string;
  period_start: string | null;
  period_end: string | null;
  temporal_observations: number | string;
  snapshot_observations: number | string;
  snapshot_start: string | null;
  snapshot_end: string | null;
  listening_observations: number | string;
  commercial_observations: number | string;
};

type StructuredMetricFamilyRow = {
  metric_family: string;
  observations: number | string;
  metrics: number | string;
  assets: number | string;
  temporal_observations: number | string;
  snapshot_observations: number | string;
  period_start: string | null;
  period_end: string | null;
  snapshot_start: string | null;
  snapshot_end: string | null;
};

type StructuredObservationSnapshot = {
  source: "data_observations_sql";
  contract: "noisia_data_os_cut_1";
  available: boolean;
  summary: {
    observations: number;
    accepted_observations: number;
    review_observations: number;
    rejected_observations: number;
    records: number;
    accepted_records: number;
    review_records: number;
    rejected_records: number;
    temporal_records: number;
    snapshot_records: number;
    temporal_observations: number;
    snapshot_observations: number;
    listening_observations: number;
    commercial_observations: number;
    assets: number;
    datasets: number;
    metric_families: number;
    metric_keys: number;
    period_start: string | null;
    period_end: string | null;
    snapshot_start: string | null;
    snapshot_end: string | null;
  };
  metric_families: Array<{
    family: string;
    observations: number;
    metrics: number;
    assets: number;
    temporal_observations: number;
    snapshot_observations: number;
    period_start: string | null;
    period_end: string | null;
    snapshot_start: string | null;
    snapshot_end: string | null;
  }>;
  monthly_series: Array<{
    month: string;
    metric_family: string;
    metric_key: string;
    metric_unit: string | null;
    value: number;
    observations: number;
    source: "data_observations" | "listening_data_os" | "listening_mentions_fallback";
  }>;
  listening_source: "listening_data_os" | "listening_mentions_fallback";
  source_inventory: DataOsSourceInventoryItem[];
  capabilities: DataOsCapability[];
  joinability: {
    observation_months: number;
    listening_months: number;
    overlapping_months: number;
    temporal_join_ready: boolean;
  };
  guardrails: string[];
};

async function loadStructuredObservationSnapshot(corpusId: string): Promise<StructuredObservationSnapshot> {
  try {
    const [
      summaryResult,
      familyResult,
      seriesResult,
      listeningResult,
      mentionsResult,
      capabilityResult,
      sourceInventoryResult
    ] = await Promise.all([
      pool.query<StructuredObservationSummaryRow>(
        `
          SELECT
            COUNT(*) AS observations,
            COUNT(*) FILTER (WHERE quality_status = 'accepted') AS accepted_observations,
            COUNT(*) FILTER (WHERE quality_status NOT IN ('accepted', 'rejected')) AS review_observations,
            COUNT(*) FILTER (WHERE quality_status = 'rejected') AS rejected_observations,
            (SELECT COUNT(*) FROM data_asset_records record WHERE record.study_corpus_id = $1::uuid) AS records,
            (SELECT COUNT(*) FROM data_asset_records record WHERE record.study_corpus_id = $1::uuid AND record.quality_status = 'accepted') AS accepted_records,
            (SELECT COUNT(*) FROM data_asset_records record WHERE record.study_corpus_id = $1::uuid AND record.quality_status NOT IN ('accepted', 'rejected')) AS review_records,
            (SELECT COUNT(*) FROM data_asset_records record WHERE record.study_corpus_id = $1::uuid AND record.quality_status = 'rejected') AS rejected_records,
            (SELECT COUNT(*) FROM data_asset_records record
              WHERE record.study_corpus_id = $1::uuid
                AND record.quality_status = 'accepted'
                AND record.period_semantics IN ('measurement', 'event')
                AND record.period_start IS NOT NULL) AS temporal_records,
            (SELECT COUNT(*) FROM data_asset_records record
              WHERE record.study_corpus_id = $1::uuid
                AND record.quality_status = 'accepted'
                AND record.period_semantics = 'snapshot'
                AND record.period_start IS NOT NULL) AS snapshot_records,
            COUNT(DISTINCT data_asset_id) AS assets,
            COUNT(DISTINCT dataset_key) AS datasets,
            COUNT(DISTINCT metric_family) FILTER (WHERE quality_status = 'accepted') AS metric_families,
            COUNT(DISTINCT metric_key) FILTER (WHERE quality_status = 'accepted') AS metric_keys,
            MIN(period_start) FILTER (
              WHERE quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')
            )::text AS period_start,
            MAX(COALESCE(period_end, period_start)) FILTER (
              WHERE quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')
            )::text AS period_end,
            COUNT(*) FILTER (
              WHERE quality_status = 'accepted'
                AND period_semantics IN ('measurement', 'event')
                AND period_start IS NOT NULL
            ) AS temporal_observations,
            COUNT(*) FILTER (
              WHERE quality_status = 'accepted'
                AND period_semantics = 'snapshot'
                AND period_start IS NOT NULL
            ) AS snapshot_observations,
            MIN(period_start) FILTER (
              WHERE quality_status = 'accepted' AND period_semantics = 'snapshot'
            )::text AS snapshot_start,
            MAX(COALESCE(period_end, period_start)) FILTER (
              WHERE quality_status = 'accepted' AND period_semantics = 'snapshot'
            )::text AS snapshot_end,
            COUNT(*) FILTER (
              WHERE dataset_role = 'social_listening' AND quality_status = 'accepted'
            ) AS listening_observations,
            COUNT(*) FILTER (
              WHERE dataset_role IN (
                'ecommerce_sales',
                'web_analytics',
                'search_demand',
                'customer_service',
                'paid_media',
                'organic_social',
                'crm_marketing',
                'reviews_ratings',
                'pricing_inventory',
                'competitive_intelligence'
              )
                AND quality_status = 'accepted'
            ) AS commercial_observations
          FROM data_observations
          WHERE study_corpus_id = $1::uuid
        `,
        [corpusId]
      ),
      pool.query<StructuredMetricFamilyRow>(
        `
          SELECT
            metric_family,
            COUNT(*) AS observations,
            COUNT(DISTINCT metric_key) AS metrics,
            COUNT(DISTINCT data_asset_id) AS assets,
            COUNT(*) FILTER (WHERE period_semantics IN ('measurement', 'event')) AS temporal_observations,
            COUNT(*) FILTER (WHERE period_semantics = 'snapshot') AS snapshot_observations,
            MIN(period_start) FILTER (WHERE period_semantics IN ('measurement', 'event'))::text AS period_start,
            MAX(COALESCE(period_end, period_start)) FILTER (WHERE period_semantics IN ('measurement', 'event'))::text AS period_end,
            MIN(period_start) FILTER (WHERE period_semantics = 'snapshot')::text AS snapshot_start,
            MAX(COALESCE(period_end, period_start)) FILTER (WHERE period_semantics = 'snapshot')::text AS snapshot_end
          FROM data_observations
          WHERE study_corpus_id = $1::uuid
            AND quality_status = 'accepted'
            AND COALESCE(dataset_role, '') NOT LIKE 'social_listening%'
          GROUP BY metric_family
          ORDER BY observations DESC, metric_family
          LIMIT 20
        `,
        [corpusId]
      ),
      pool.query<TbRagSeriesRow>(
        `
          SELECT *
          FROM (
            SELECT
              to_char(date_trunc('month', period_start), 'YYYY-MM') AS month,
              metric_family,
              metric_key,
              metric_unit,
              ROUND((CASE
                WHEN metric_unit = 'ratio'
                  OR metric_family IN ('average_order_value', 'margin', 'conversion_rate', 'sentiment', 'score', 'price', 'search_position')
                  THEN AVG(metric_value)
                ELSE SUM(metric_value)
              END)::numeric, 4) AS metric_value,
              COUNT(*) AS observations
            FROM data_observations
            WHERE study_corpus_id = $1::uuid
              AND quality_status = 'accepted'
              AND period_semantics IN ('measurement', 'event')
              AND period_start IS NOT NULL
              AND COALESCE(dataset_role, '') NOT LIKE 'social_listening%'
            GROUP BY 1, metric_family, metric_key, metric_unit
            ORDER BY 1 DESC, metric_family, metric_key
            LIMIT 120
          ) series
          ORDER BY month ASC, metric_family, metric_key
        `,
        [corpusId]
      ),
      pool.query<TbRagSeriesRow>(
        `
          SELECT
            to_char(date_trunc('month', period_start), 'YYYY-MM') AS month,
            metric_family,
            metric_key,
            metric_unit,
            metric_value,
            COALESCE((raw_record ->> 'records')::int, 1) AS observations
          FROM data_observations
          WHERE study_corpus_id = $1::uuid
            AND dataset_role = 'social_listening'
            AND quality_status = 'accepted'
            AND period_semantics IN ('measurement', 'event')
            AND period_start IS NOT NULL
            AND metric_key IN ('mentions_monthly', 'engagement_monthly', 'sentiment_monthly')
          ORDER BY period_start ASC, metric_key
          LIMIT 180
        `,
        [corpusId]
      ),
      pool.query<TbRagSeriesRow>(
        `
          SELECT
            to_char(date_trunc('month', published_at), 'YYYY-MM') AS month,
            'mentions'::text AS metric_family,
            'mentions_monthly'::text AS metric_key,
            'count'::text AS metric_unit,
            COUNT(*)::numeric AS metric_value,
            COUNT(*) AS observations
          FROM mentions
          WHERE study_corpus_id = $1::uuid
            AND inclusion_status = 'included'
            AND published_at IS NOT NULL
          GROUP BY 1
          ORDER BY 1 ASC
          LIMIT 60
        `,
        [corpusId]
      ),
      pool.query<DataOsCapabilityRow>(
        DATA_OS_CAPABILITY_ROLLUP_SQL,
        [corpusId]
      ),
      pool.query<DataOsSourceInventoryRow>(
        DATA_OS_SOURCE_INVENTORY_SQL,
        [corpusId]
      )
    ]);

    const summaryRow = summaryResult.rows[0];
    const summary = {
      observations: numeric(summaryRow?.observations),
      accepted_observations: numeric(summaryRow?.accepted_observations),
      review_observations: numeric(summaryRow?.review_observations),
      rejected_observations: numeric(summaryRow?.rejected_observations),
      records: numeric(summaryRow?.records),
      accepted_records: numeric(summaryRow?.accepted_records),
      review_records: numeric(summaryRow?.review_records),
      rejected_records: numeric(summaryRow?.rejected_records),
      temporal_records: numeric(summaryRow?.temporal_records),
      snapshot_records: numeric(summaryRow?.snapshot_records),
      temporal_observations: numeric(summaryRow?.temporal_observations),
      snapshot_observations: numeric(summaryRow?.snapshot_observations),
      listening_observations: numeric(summaryRow?.listening_observations),
      commercial_observations: numeric(summaryRow?.commercial_observations),
      assets: numeric(summaryRow?.assets),
      datasets: numeric(summaryRow?.datasets),
      metric_families: numeric(summaryRow?.metric_families),
      metric_keys: numeric(summaryRow?.metric_keys),
      period_start: summaryRow?.period_start ?? null,
      period_end: summaryRow?.period_end ?? null,
      snapshot_start: summaryRow?.snapshot_start ?? null,
      snapshot_end: summaryRow?.snapshot_end ?? null
    };
    const selectedSeries = selectTbRagMonthlySeries({
      commercial: seriesResult.rows,
      canonicalListening: listeningResult.rows,
      rawListeningFallback: mentionsResult.rows
    });
    const capabilities = buildDataOsCapabilities({
      rows: capabilityResult.rows,
      rawListeningFallbackObservations: mentionsResult.rows.reduce(
        (total, row) => total + numeric(row.observations),
        0
      )
    });
    const sourceInventory = buildDataOsSourceInventory(sourceInventoryResult.rows);
    const rawListeningRecords = mentionsResult.rows.reduce(
      (total, row) => total + numeric(row.observations),
      0
    );

    return {
      source: "data_observations_sql",
      contract: "noisia_data_os_cut_1",
      available: summary.accepted_observations > 0
        || summary.accepted_records > 0
        || rawListeningRecords > 0,
      summary,
      metric_families: familyResult.rows.map((row) => ({
        family: row.metric_family,
        observations: numeric(row.observations),
        metrics: numeric(row.metrics),
        assets: numeric(row.assets),
        temporal_observations: numeric(row.temporal_observations),
        snapshot_observations: numeric(row.snapshot_observations),
        period_start: row.period_start,
        period_end: row.period_end,
        snapshot_start: row.snapshot_start,
        snapshot_end: row.snapshot_end
      })),
      monthly_series: selectedSeries.monthlySeries,
      listening_source: selectedSeries.listeningSource,
      source_inventory: sourceInventory,
      capabilities,
      joinability: {
        observation_months: selectedSeries.observationMonths,
        listening_months: selectedSeries.listeningMonths,
        overlapping_months: selectedSeries.overlappingMonths,
        temporal_join_ready: selectedSeries.overlappingMonths > 0
      },
      guardrails: [
        "Treat needs_mapping_review observations as context only, never as scored evidence.",
        "Canonical source records and static catalogs provide entities, dimensions, and join keys; numeric claims require accepted observations.",
        "Snapshot observations describe a governed point-in-time capture. Never turn a snapshot capture date into a trend or monthly series.",
        "A missing optional business source means unknown, not zero. Do not fabricate sales, traffic, search, service, media, CRM, review, price, stock, or competitor performance.",
        selectedSeries.listeningSource === "listening_data_os"
          ? "Use the governed listening series; do not recount raw mentions."
          : "Governed listening aggregates were unavailable, so raw mentions are a declared fallback.",
        ...buildDataOsCapabilityGuardrails(capabilities),
        "Do not infer causality from temporal correlation.",
        "State when sales, search, traffic, service, or listening windows do not overlap."
      ]
    };
  } catch (error) {
    console.warn("[tb-rag-context] structured observations skipped", {
      corpusId,
      error: error instanceof Error ? error.message : String(error)
    });
    return emptyStructuredObservationSnapshot();
  }
}

async function recordStructuredObservationConsumption(
  tbAnalysisId: string,
  snapshot: StructuredObservationSnapshot
) {
  const consumedAt = new Date().toISOString();
  try {
    await pool.query(
      `
        UPDATE tb_analyses
        SET meta_json = jsonb_set(
              COALESCE(meta_json, '{}'::jsonb),
              '{data_os_context}',
              $2::jsonb,
              true
            ),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        tbAnalysisId,
        JSON.stringify({
          contract: snapshot.contract,
          consumed: snapshot.available,
          consumed_at: consumedAt,
          observation_count: snapshot.summary.observations,
          accepted_observation_count: snapshot.summary.accepted_observations,
          review_observation_count: snapshot.summary.review_observations,
          rejected_observation_count: snapshot.summary.rejected_observations,
          canonical_record_count: snapshot.summary.records,
          accepted_record_count: snapshot.summary.accepted_records,
          review_record_count: snapshot.summary.review_records,
          rejected_record_count: snapshot.summary.rejected_records,
          temporal_record_count: snapshot.summary.temporal_records,
          snapshot_record_count: snapshot.summary.snapshot_records,
          temporal_observation_count: snapshot.summary.temporal_observations,
          snapshot_observation_count: snapshot.summary.snapshot_observations,
          listening_observation_count: snapshot.summary.listening_observations,
          commercial_observation_count: snapshot.summary.commercial_observations,
          listening_source: snapshot.listening_source,
          capabilities: Object.fromEntries(
            snapshot.capabilities.map((capability) => [
              capability.key,
              {
                status: capability.status,
                source: capability.evidence_source,
                accepted_observations: capability.accepted_observations,
                review_observations: capability.review_observations,
                accepted_records: capability.accepted_records,
                review_records: capability.review_records,
                temporal_observations: capability.temporal_observations,
                snapshot_observations: capability.snapshot_observations,
                temporal_records: capability.temporal_records,
                snapshot_records: capability.snapshot_records,
                months: capability.months,
                period_start: capability.period_start,
                period_end: capability.period_end,
                snapshot_start: capability.snapshot_start,
                snapshot_end: capability.snapshot_end
              }
            ])
          ),
          missing_domains: snapshot.capabilities
            .filter((capability) => capability.status === "missing")
            .map((capability) => capability.key),
          review_required_domains: snapshot.capabilities
            .filter((capability) => capability.status === "review_required")
            .map((capability) => capability.key),
          metric_families: snapshot.summary.metric_families,
          source_inventory: {
            total: snapshot.source_inventory.length,
            ready: snapshot.source_inventory.filter((source) => source.status === "ready").length,
            review_required: snapshot.source_inventory.filter((source) => source.status === "review_required").length,
            blocked: snapshot.source_inventory.filter((source) => source.status === "blocked").length,
            files: snapshot.source_inventory.map((source) => ({
              file_name: source.file_name,
              status: source.status,
              canonical_record_store: source.canonical_record_store,
              canonical_records: source.rows.canonical,
              accepted_records: source.rows.accepted,
              review_records: source.rows.review_required,
              temporal_records: source.rows.temporal,
              snapshot_records: source.rows.snapshot,
              accepted_observations: source.observations.accepted,
              review_observations: source.observations.review_required,
              temporal_observations: source.observations.temporal,
              snapshot_observations: source.observations.snapshot,
              period_start: source.semantic.period_start,
              period_end: source.semantic.period_end,
              snapshot_start: source.semantic.snapshot_start,
              snapshot_end: source.semantic.snapshot_end
            }))
          },
          period_start: snapshot.summary.period_start,
          period_end: snapshot.summary.period_end,
          snapshot_start: snapshot.summary.snapshot_start,
          snapshot_end: snapshot.summary.snapshot_end,
          overlapping_months: snapshot.joinability.overlapping_months
        })
      ]
    );
  } catch (error) {
    console.warn("[tb-rag-context] could not persist Data OS consumption marker", {
      tbAnalysisId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function emptyStructuredObservationSnapshot(): StructuredObservationSnapshot {
  return {
    source: "data_observations_sql",
    contract: "noisia_data_os_cut_1",
    available: false,
    summary: {
      observations: 0,
      accepted_observations: 0,
      review_observations: 0,
      rejected_observations: 0,
      records: 0,
      accepted_records: 0,
      review_records: 0,
      rejected_records: 0,
      temporal_records: 0,
      snapshot_records: 0,
      temporal_observations: 0,
      snapshot_observations: 0,
      listening_observations: 0,
      commercial_observations: 0,
      assets: 0,
      datasets: 0,
      metric_families: 0,
      metric_keys: 0,
      period_start: null,
      period_end: null,
      snapshot_start: null,
      snapshot_end: null
    },
    metric_families: [],
    monthly_series: [],
    listening_source: "listening_mentions_fallback",
    source_inventory: [],
    capabilities: buildDataOsCapabilities({ rows: [] }),
    joinability: {
      observation_months: 0,
      listening_months: 0,
      overlapping_months: 0,
      temporal_join_ready: false
    },
    guardrails: ["No governed structured observations were available for this analysis run."]
  };
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadAnalysisScope(tbAnalysisId: string): Promise<AnalysisScopeRow> {
  const result = await pool.query<AnalysisScopeRow>(
    `SELECT ta.study_corpus_id, sc.brand_id
     FROM tb_analyses ta
     JOIN study_corpora sc ON sc.id = ta.study_corpus_id
     WHERE ta.id = $1`,
    [tbAnalysisId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`tb_analyses ${tbAnalysisId} not found`);
  return row;
}

function compactForPrompt(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    summary: typeof record.summary === "string" ? record.summary.slice(0, 900) : undefined,
    recommended_use: Array.isArray(record.recommended_use) ? record.recommended_use.slice(0, 6) : undefined,
    priority_topics: Array.isArray(record.priority_topics) ? record.priority_topics.slice(0, 8) : undefined,
    competitor_clues: Array.isArray(record.competitor_clues) ? record.competitor_clues.slice(0, 8) : undefined,
    raw_text_excerpt:
      typeof record.raw_text_excerpt === "string"
        ? record.raw_text_excerpt.slice(0, 900)
        : typeof record.raw_text === "string"
          ? record.raw_text.slice(0, 900)
          : undefined
  };
}

async function loadCorpusIntelligenceSnapshot(tbAnalysisId: string) {
  const [overview, channels, entityMix, findingQuant, openSignals, temporal] = await Promise.all([
    safeRunCorpusSql<{
      total_mentions: number;
      period_start: string | null;
      period_end: string | null;
      coded_mentions: number;
      uncoded_mentions: number;
    }>({
      label: "overview",
      tbAnalysisId,
      sql: `
        SELECT
          COUNT(DISTINCT sm.mention_id)::int AS total_mentions,
          MIN(sm.published_at)::text AS period_start,
          MAX(sm.published_at)::text AS period_end,
          COUNT(DISTINCT fc.mention_id)::int AS coded_mentions,
          (COUNT(DISTINCT sm.mention_id) - COUNT(DISTINCT fc.mention_id))::int AS uncoded_mentions
        FROM scoped_mentions sm
        LEFT JOIN finding_codings fc ON fc.mention_id = sm.mention_id
      `,
      limit: 1
    }),
    safeRunCorpusSql<{ platform: string | null; mention_count: number; coded_count: number }>({
      label: "channels",
      tbAnalysisId,
      sql: `
        SELECT
          CASE
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%tiktok%' THEN 'tiktok'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%instagram%' THEN 'instagram'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) = 'x'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%twitter.com%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%x.com%' THEN 'x'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%facebook%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%facebook%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%facebook%' THEN 'facebook'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%youtube%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%youtube%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%youtube%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%youtu.be%' THEN 'youtube'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%reddit%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%reddit%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%reddit%' THEN 'reddit'
            ELSE sm.platform
          END AS platform,
          COUNT(DISTINCT sm.mention_id)::int AS mention_count,
          COUNT(DISTINCT fc.mention_id)::int AS coded_count
        FROM scoped_mentions sm
        LEFT JOIN finding_codings fc ON fc.mention_id = sm.mention_id
        GROUP BY 1
        ORDER BY mention_count DESC
      `,
      limit: 12
    }),
    safeRunCorpusSql<{ entity_kind: string | null; entity_label: string | null; mention_count: number }>({
      label: "entity_mix",
      tbAnalysisId,
      sql: `
        SELECT
          COALESCE(sm.entity_kind, sm.mention_type, 'unknown') AS entity_kind,
          COALESCE(sm.entity_label, sm.mention_type, 'Sin etiqueta') AS entity_label,
          COUNT(DISTINCT sm.mention_id)::int AS mention_count
        FROM scoped_mentions sm
        GROUP BY 1, 2
        ORDER BY mention_count DESC
      `,
      limit: 20
    }),
    safeRunCorpusSql<{
      finding_id: string;
      finding_name: string;
      polarity: string;
      layer: string | null;
      mention_count: number;
      avg_intensity: number | null;
      first_seen: string | null;
      last_seen: string | null;
      dominant_channel: string | null;
    }>({
      label: "finding_quantification",
      tbAnalysisId,
      sql: `
        WITH finding_counts AS (
          SELECT
            fc.finding_id,
            fc.finding_name,
            fc.polarity,
            fc.layer,
            COUNT(DISTINCT fc.mention_id)::int AS mention_count,
            AVG(fc.intensity_score)::float AS avg_intensity,
            MIN(fc.published_at)::text AS first_seen,
            MAX(fc.published_at)::text AS last_seen
          FROM finding_codings fc
          WHERE fc.finding_id IS NOT NULL
          GROUP BY fc.finding_id, fc.finding_name, fc.polarity, fc.layer
        ),
        channel_rank AS (
          SELECT
            finding_id,
            CASE
              WHEN lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(source_url, '')) LIKE '%tiktok%' THEN 'tiktok'
              WHEN lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
                OR lower(COALESCE(source_url, '')) LIKE '%instagram%' THEN 'instagram'
              WHEN lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) = 'x'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
                OR lower(COALESCE(source_url, '')) LIKE '%twitter.com%'
                OR lower(COALESCE(source_url, '')) LIKE '%x.com%' THEN 'x'
              ELSE platform
            END AS platform,
            COUNT(*)::int AS mentions,
            ROW_NUMBER() OVER (PARTITION BY finding_id ORDER BY COUNT(*) DESC) AS rn
          FROM finding_codings
          WHERE finding_id IS NOT NULL
          GROUP BY finding_id, 2
        )
        SELECT
          f.finding_id,
          f.finding_name,
          f.polarity,
          f.layer,
          f.mention_count,
          f.avg_intensity,
          f.first_seen,
          f.last_seen,
          c.platform AS dominant_channel
        FROM finding_counts f
        LEFT JOIN channel_rank c ON c.finding_id = f.finding_id AND c.rn = 1
        ORDER BY f.mention_count DESC
      `,
      limit: 40
    }),
    safeRunCorpusSql<{ tag: string; mention_count: number; sample_quote: string | null; dominant_channel: string | null }>({
      label: "open_signal_candidates",
      tbAnalysisId,
      sql: `
        WITH noisy_tags AS (
          SELECT
            lower(trim(tag)) AS tag,
            fc.mention_id,
            CASE
              WHEN lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%tiktok%' THEN 'tiktok'
              WHEN lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%instagram%' THEN 'instagram'
              WHEN lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) = 'x'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%twitter.com%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%x.com%' THEN 'x'
              ELSE fc.platform
            END AS platform,
            fc.text_clean
          FROM finding_codings fc
          CROSS JOIN LATERAL unnest(fc.emergent_tags) AS tags(tag)
          WHERE (fc.finding_id IS NULL OR fc.polarity = 'irrelevant' OR fc.ambiguous = true)
            AND lower(trim(tag)) <> 'irrelevant'
            AND length(trim(tag)) > 2
        ),
        tag_counts AS (
          SELECT tag, COUNT(DISTINCT mention_id)::int AS mention_count, MIN(text_clean) AS sample_quote
          FROM noisy_tags
          GROUP BY tag
        ),
        channel_rank AS (
          SELECT tag, platform, COUNT(*)::int AS mentions,
                 ROW_NUMBER() OVER (PARTITION BY tag ORDER BY COUNT(*) DESC) AS rn
          FROM noisy_tags
          GROUP BY tag, platform
        )
        SELECT
          t.tag,
          t.mention_count,
          t.sample_quote,
          c.platform AS dominant_channel
        FROM tag_counts t
        LEFT JOIN channel_rank c ON c.tag = t.tag AND c.rn = 1
        ORDER BY t.mention_count DESC
      `,
      limit: 24,
      timeoutMs: 30_000
    }),
    safeRunCorpusSql<{ month: string; mention_count: number; coded_count: number }>({
      label: "temporal_coverage",
      tbAnalysisId,
      sql: `
        SELECT
          to_char(date_trunc('month', sm.published_at), 'YYYY-MM') AS month,
          COUNT(DISTINCT sm.mention_id)::int AS mention_count,
          COUNT(DISTINCT fc.mention_id)::int AS coded_count
        FROM scoped_mentions sm
        LEFT JOIN finding_codings fc ON fc.mention_id = sm.mention_id
        WHERE sm.published_at IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      `,
      limit: 36
    })
  ]);

  return {
    source: "corpus_sql",
    virtual_schema: describeCorpusSqlVirtualSchema(),
    coverage: overview.rows[0] ?? null,
    channel_distribution: channels.rows,
    entity_mix: entityMix.rows,
    finding_quantification: findingQuant.rows,
    open_signal_candidates: openSignals.rows,
    temporal_coverage: temporal.rows
  };
}

async function safeRunCorpusSql<T extends QueryResultRow>(
  args: Parameters<typeof runCorpusSql<T>>[0] & { label: string }
): Promise<CorpusSqlResult<T>> {
  const { label, ...sqlArgs } = args;
  try {
    return await runCorpusSql<T>(sqlArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[tb-rag-context] corpus_sql ${label} skipped: ${message}`);
    return { rows: [], rowCount: 0, limit: sqlArgs.limit ?? 500 };
  }
}
