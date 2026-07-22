import { createHash } from "node:crypto";

import {
  SIGNAL_BACKEND_CONTRACT_VERSION,
  SIGNAL_DIMENSIONS,
  SIGNAL_METRIC_CATALOG_V1,
  SignalBackendContractError,
  buildSignalMentionPredicateV1,
  buildSignalAdHocMaterializationJobV1,
  buildSignalMentionDrillDownPlanV1,
  decodeSignalDrillDownCursorV1,
  encodeSignalDrillDownCursorV1,
  parseSignalFilterQueryParamsV1,
  normalizeSignalMetricQueryV1,
  signalFiltersHashV1,
  signalMetricDefinitionV1,
  validateDataWatermarkV1,
  validateSignalBreakdownV1,
  validateSignalTimeSeriesV1,
  type DataFreshnessStateV1,
  type DataWatermarkV1,
  type SignalBreakdownBucketV1,
  type SignalDimensionV1,
  type SignalFilterV1,
  type SignalMetricPointV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import { isSignalAdHocMaterializationEnabled } from "@/lib/data-os/serving";
import { enqueueSignalAdHocMaterialization } from "@/lib/queue/data-os";

type JsonRecord = Record<string, unknown>;

type MaterializationRow = {
  metric_key: string;
  metric_version: number;
  metric_group_key: string;
  period_start: string;
  period_end: string;
  value: string | number | null;
  denominator: string | number | null;
  sample_size: number;
  typed_payload: JsonRecord;
  materialization_state: "fresh" | "stale" | "pending" | "partial" | "not_available";
  quality_state: string;
  data_watermark: DataWatermarkV1;
  data_watermark_hash: string;
  computed_at: Date;
  stale_after: Date | null;
};

const RESERVED_FILTER_PARAMS = new Set([
  "metric_key", "metric_version", "group", "dimension", "breakdown_dimension",
  "comparison_start", "comparison_end", "cursor", "limit", "require_fresh"
]);
const NATURAL_BREAKDOWN_DIMENSION: Partial<Record<string, SignalDimensionV1>> = {
  "sentiment.share": "sentiment_polarity",
  "emotion.share": "emotion",
  "platform.share": "platform",
  "source_type.share": "source_type",
  "topic.volume": "topic",
  "narrative.volume": "taxonomy",
  "governed_entity.volume": "entity"
};

export function parseSignalApiFilterV1(searchParams: URLSearchParams, workspaceTimezone: string) {
  const filterParams = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (!RESERVED_FILTER_PARAMS.has(key)) filterParams.append(key, value);
  }
  if (!filterParams.has("timezone") && !filterParams.has("tz")) {
    filterParams.set("timezone", workspaceTimezone);
  }
  return parseSignalFilterQueryParamsV1(filterParams);
}

export function signalBackendErrorResponse(error: unknown) {
  if (error instanceof SignalBackendContractError) {
    const status = error.code === "invalid_filter" || error.code === "unsupported_dimension"
      ? 400
      : error.code === "stale"
        ? 409
        : error.code === "partial"
          ? 206
          : 404;
    return Response.json(error.toJSON(), { status, headers: { "Cache-Control": "private, no-store" } });
  }
  console.error("Signal workspace API failed", error instanceof Error ? error.message : "unknown_error");
  return Response.json(new SignalBackendContractError(
    "not_available",
    "Signal data is temporarily not available."
  ).toJSON(), { status: 503, headers: { "Cache-Control": "private, no-store" } });
}

export function signalJsonResponse(request: Request, payload: unknown, options: {
  etagSeed?: string;
  state?: string;
  status?: number;
} = {}) {
  const etag = options.etagSeed ? weakEtag(options.etagSeed) : null;
  if (etag && request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: signalCacheHeaders(etag, options.state) });
  }
  return Response.json(payload, {
    status: options.status ?? 200,
    headers: signalCacheHeaders(etag, options.state)
  });
}

export function signalMaterializationResultResponse(
  request: Request,
  result:
    | { status: "ready"; payload: unknown; etagSeed: string }
    | { status: "pending"; payload: unknown }
    | { status: "missing"; error: SignalBackendContractError }
) {
  if (result.status === "missing") return signalBackendErrorResponse(result.error);
  if (result.status === "pending") {
    return signalJsonResponse(request, result.payload, { status: 202, state: "pending" });
  }
  const state = isRecord(result.payload)
    && isRecord(result.payload.freshness)
    && typeof result.payload.freshness.state === "string"
    ? result.payload.freshness.state
    : undefined;
  return signalJsonResponse(request, result.payload, { etagSeed: result.etagSeed, state });
}

export function requireFreshSignalResult<T extends {
  status: "ready" | "pending" | "missing";
  payload?: unknown;
}>(result: T, required: boolean) {
  if (!required || result.status !== "ready" || !isRecord(result.payload) || !isRecord(result.payload.freshness)) return result;
  const state = result.payload.freshness.state;
  if (state === "stale" || state === "partial") {
    throw new SignalBackendContractError(state, `Signal materialization is ${state}.`, {
      filters_hash: result.payload.filters_hash ?? null
    });
  }
  return result;
}

export async function loadSignalBootstrapV1(workspace: ResolvedSignalWorkspace, isInternalUser: boolean) {
  const corpus = requireServingCorpus(workspace);
  const [coverage, watermarks, metricStates] = await Promise.all([
    pool.query<{ date_from: string | null; date_through: string | null; mentions: number }>(`
      SELECT MIN((published_at AT TIME ZONE $2)::date)::text AS date_from,
        MAX((published_at AT TIME ZONE $2)::date)::text AS date_through,
        COUNT(*)::int AS mentions
      FROM mentions
      WHERE study_corpus_id = $1::uuid AND inclusion_status = 'included'
    `, [corpus.id, workspace.timezone]),
    pool.query<{
      data_freshness_state: DataFreshnessStateV1;
      data_watermark_hash: string | null;
      max_observed_at: Date | null;
      accepted_at: Date;
      materialized_at: Date;
      stale_after: Date | null;
    }>(`
      SELECT watermark.data_freshness_state,
        (
          SELECT materialization.data_watermark_hash
          FROM metric_materializations materialization
          WHERE materialization.data_watermark_id = watermark.id
          ORDER BY materialization.computed_at DESC
          LIMIT 1
        ) AS data_watermark_hash,
        watermark.max_observed_at, watermark.accepted_at,
        watermark.materialized_at, watermark.stale_after
      FROM signal_data_watermarks watermark
      WHERE watermark.workspace_id = $1::uuid AND watermark.study_corpus_id = $2::uuid
      ORDER BY watermark.accepted_at DESC, watermark.id
    `, [workspace.id, corpus.id]),
    pool.query<{ metric_group_key: string; state: string; computed_at: Date }>(`
      WITH latest AS (
        SELECT DISTINCT ON (metric_key, metric_version)
          metric_group_key,
          CASE
            WHEN stale_after IS NOT NULL AND stale_after <= now() THEN 'stale'
            ELSE materialization_state
          END AS materialization_state,
          computed_at
        FROM metric_materializations
        WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
          AND cache_scope = 'default'
        ORDER BY metric_key, metric_version, computed_at DESC
      )
      SELECT metric_group_key,
        CASE
          WHEN bool_or(materialization_state = 'stale') THEN 'stale'
          WHEN bool_or(materialization_state = 'partial') THEN 'partial'
          WHEN bool_or(materialization_state = 'pending') THEN 'pending'
          WHEN bool_and(materialization_state = 'not_available') THEN 'not_available'
          ELSE 'fresh'
        END AS state,
        MAX(computed_at) AS computed_at
      FROM latest
      GROUP BY metric_group_key ORDER BY metric_group_key
    `, [workspace.id, corpus.id])
  ]);
  const coverageRow = coverage.rows[0] ?? { date_from: null, date_through: null, mentions: 0 };
  const freshnessState = worstState(watermarks.rows.map((row) => row.data_freshness_state));
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace: {
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      organization_id: workspace.organizationId,
      subject: workspace.subject,
      timezone: workspace.timezone,
      status: workspace.status
    },
    corpus: { id: corpus.id, role: corpus.role, status: corpus.status, name: corpus.name },
    coverage: coverageRow,
    data_freshness: {
      state: freshnessState,
      data_through_at: maxInstant(watermarks.rows.map((row) => row.max_observed_at)),
      accepted_at: maxInstant(watermarks.rows.map((row) => row.accepted_at)),
      materialized_at: maxInstant(watermarks.rows.map((row) => row.materialized_at)),
      stale_after: minInstant(watermarks.rows.map((row) => row.stale_after)),
      watermark_hashes: watermarks.rows.map((row) => row.data_watermark_hash).filter(Boolean)
    },
    interpretation_freshness: { state: "not_available", reason: "SB-07_not_started" },
    metric_groups: metricStates.rows.map((row) => ({
      key: row.metric_group_key,
      state: row.state,
      computed_at: row.computed_at.toISOString()
    })),
    visibility: { internal: isInternalUser, source_type: isInternalUser, quality_details: isInternalUser }
  };
}

export async function loadSignalFacetsV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const corpus = requireServingCorpus(args.workspace);
  const predicate = buildSignalMentionPredicateV1(args.filter, [corpus.id]);
  const params = [...predicate.params];
  const featureDimensions = ["signal", "signal_lifecycle", "audience", "demographic", "journey_stage", "campaign", "product"];
  params.push(featureDimensions);
  const featureParameter = `$${params.length}::text[]`;
  const sourceTypeSelect = args.isInternalUser
    ? "UNION ALL SELECT id, 'source_type', lower(source_system) FROM filtered WHERE source_system IS NOT NULL"
    : "";
  const result = await pool.query<{ dimension: SignalDimensionV1; key: string; count: number }>(`
    WITH filtered AS (
      SELECT m.id, m.sentiment_score, m.source_system,
        COALESCE(m.resolved_platform, m.platform) AS platform,
        m.language, m.country, m.content_type
      FROM mentions m WHERE ${predicate.sql}
    ), facet_values AS (
      SELECT id, 'platform'::text AS dimension, lower(platform) AS key FROM filtered WHERE platform IS NOT NULL
      UNION ALL SELECT id, 'country', lower(country) FROM filtered WHERE country IS NOT NULL
      UNION ALL SELECT id, 'language', lower(language) FROM filtered WHERE language IS NOT NULL
      UNION ALL SELECT id, 'content_format', lower(content_type) FROM filtered WHERE content_type IS NOT NULL
      UNION ALL SELECT id, 'sentiment_polarity', CASE
        WHEN sentiment_score > 0.2 THEN 'positive' WHEN sentiment_score < -0.2 THEN 'negative'
        WHEN sentiment_score IS NULL THEN NULL ELSE 'neutral' END FROM filtered
      ${sourceTypeSelect}
      UNION ALL
      SELECT filtered.id, 'entity', lower(entity.canonical_name)
      FROM filtered JOIN record_entity_links link ON link.subject_type = 'mention' AND link.subject_id = filtered.id
      JOIN intelligence_entities entity ON entity.id = link.entity_id AND entity.status = 'active'
      UNION ALL
      SELECT filtered.id, 'taxonomy', lower(COALESCE(tag.value, term.label))
      FROM filtered JOIN record_tags tag ON tag.subject_type = 'mention' AND tag.subject_id = filtered.id
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
      WHERE tag.review_status <> 'rejected'
      UNION ALL
      SELECT filtered.id,
        CASE
          WHEN lower(taxonomy.taxonomy_key) LIKE '%topic%' THEN 'topic'
          WHEN lower(taxonomy.taxonomy_key) LIKE '%emotion%' THEN 'emotion'
          WHEN lower(taxonomy.taxonomy_key) LIKE '%trigger%' THEN 'trigger'
          WHEN lower(taxonomy.taxonomy_key) LIKE '%barrier%' THEN 'barrier'
          ELSE 'taxonomy'
        END,
        lower(COALESCE(tag.value, term.label))
      FROM filtered JOIN record_tags tag ON tag.subject_type = 'mention' AND tag.subject_id = filtered.id
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
      JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
      WHERE tag.review_status <> 'rejected'
      UNION ALL
      SELECT filtered.id, feature.feature_key, lower(trim(both '"' from feature.feature_value::text))
      FROM filtered JOIN record_feature_values feature
        ON feature.subject_type = 'mention' AND feature.subject_id = filtered.id
      WHERE feature.feature_key = ANY(${featureParameter})
    ), counted AS (
      SELECT dimension, key, COUNT(DISTINCT id)::int AS count,
        row_number() OVER (PARTITION BY dimension ORDER BY COUNT(DISTINCT id) DESC, key) AS position
      FROM facet_values
      WHERE key IS NOT NULL AND btrim(key) <> ''
      GROUP BY dimension, key
    )
    SELECT dimension, key, count FROM counted WHERE position <= 100
    ORDER BY dimension, count DESC, key
  `, params);
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    filters_hash: predicate.filters_hash,
    facets: groupFacets(result.rows)
  };
}

export async function loadSignalMetricGroupsV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const corpus = requireServingCorpus(args.workspace);
  const filtersHash = buildSignalMentionPredicateV1(args.filter, [corpus.id]).filters_hash;
  const states = await pool.query<{
    metric_key: string;
    metric_version: number;
    materialization_state: string;
    computed_at: Date;
    stale_after: Date | null;
  }>(`
    SELECT DISTINCT ON (metric_key, metric_version)
      metric_key, metric_version,
      CASE
        WHEN stale_after IS NOT NULL AND stale_after <= now() THEN 'stale'
        ELSE materialization_state
      END AS materialization_state,
      computed_at, stale_after
    FROM metric_materializations
    WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid AND filters_hash = $3
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY metric_key, metric_version, computed_at DESC
  `, [args.workspace.id, corpus.id, filtersHash]);
  const byMetric = new Map(states.rows.map((row) => [`${row.metric_key}@${row.metric_version}`, row]));
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    filters_hash: filtersHash,
    groups: SIGNAL_METRIC_CATALOG_V1.map((group) => ({
      key: group.key,
      name: group.name,
      metrics: group.metrics
        .filter((metric) => args.isInternalUser || metric.visibility !== "internal")
        .map((metric) => {
          const state = byMetric.get(`${metric.key}@${metric.version}`);
          return {
            key: metric.key,
            version: metric.version,
            name: metric.name,
            unit: metric.unit,
            denominator: metric.denominator,
            grains: metric.grains,
            dimensions: metric.dimensions
              .filter((dimension) => args.isInternalUser || dimension.visibility !== "internal")
              .map((dimension) => dimension.key),
            state: state?.materialization_state ?? "not_available",
            computed_at: state?.computed_at.toISOString() ?? null,
            stale_after: state?.stale_after?.toISOString() ?? null
          };
        })
    }))
  };
}

export async function loadSignalSeriesV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  metricKey: string;
  metricVersion: number;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const metric = requireVisibleMetric(args.metricKey, args.metricVersion, args.isInternalUser);
  assertMetricFilterDimensions(metric.key, metric.version, args.filter);
  const rows = await loadMaterializationRows(args.workspace, args.filter, metric.key, metric.version);
  if (rows.length === 0) return queueMissingMaterialization(args.workspace, args.filter, [metric.key]);
  const state = rowsState(rows);
  const watermark = publicWatermark(validateDataWatermarkV1(rows[0]?.data_watermark), args.isInternalUser);
  const points: SignalMetricPointV1[] = rows.map((row) => ({
    period_start: row.period_start,
    period_end: row.period_end,
    value: numeric(row.value),
    denominator: numeric(row.denominator),
    sample_size: Number(row.sample_size),
    state: pointState(row.materialization_state)
  }));
  const payload = validateSignalTimeSeriesV1({
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: metric.key,
    metric_version: metric.version,
    filters_hash: signalFiltersHashV1(args.filter),
    granularity: args.filter.granularity,
    watermark,
    freshness: dataFreshness(rows, state, watermark),
    points
  });
  return { status: "ready" as const, payload, etagSeed: rowEtagSeed(rows) };
}

export async function loadSignalBreakdownV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  metricKey: string;
  metricVersion: number;
  dimension: SignalDimensionV1;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const metric = requireVisibleMetric(args.metricKey, args.metricVersion, args.isInternalUser);
  const naturalDimension = NATURAL_BREAKDOWN_DIMENSION[metric.key];
  if (!naturalDimension || naturalDimension !== args.dimension) {
    throw new SignalBackendContractError("unsupported_dimension", `${args.dimension} is not the governed breakdown for ${metric.key}.`, {
      metric_key: metric.key,
      dimension: args.dimension,
      governed_breakdown_dimension: naturalDimension ?? null
    });
  }
  if (!metric.dimensions.some((dimension) => dimension.key === args.dimension && (args.isInternalUser || dimension.visibility !== "internal"))) {
    throw new SignalBackendContractError("unsupported_dimension", `${args.dimension} is not available for ${metric.key}.`, {
      metric_key: metric.key,
      dimension: args.dimension
    });
  }
  const rows = await loadMaterializationRows(args.workspace, args.filter, metric.key, metric.version);
  if (rows.length === 0) return queueMissingMaterialization(args.workspace, args.filter, [metric.key]);
  const buckets = mergeBreakdownBuckets(rows, metric.unit === "ratio");
  const state = rowsState(rows);
  const watermark = publicWatermark(validateDataWatermarkV1(rows[0]?.data_watermark), args.isInternalUser);
  const payload = validateSignalBreakdownV1({
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: metric.key,
    metric_version: metric.version,
    filters_hash: signalFiltersHashV1(args.filter),
    dimension: args.dimension,
    watermark,
    freshness: dataFreshness(rows, state, watermark),
    buckets
  });
  return { status: "ready" as const, payload, etagSeed: rowEtagSeed(rows) };
}

export async function loadSignalComparisonV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  comparisonRange: { start: string; end: string };
  metricKey: string;
  metricVersion: number;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const comparisonFilter = parseSignalFilterQueryParamsV1(new URLSearchParams({
    start: args.comparisonRange.start,
    end: args.comparisonRange.end,
    timezone: args.filter.timezone,
    granularity: args.filter.granularity,
    ...Object.fromEntries(Object.entries(args.filter.dimensions).map(([key, values]) => [`dimension.${key}`, values.join(",")]))
  }));
  normalizeSignalMetricQueryV1({
    workspace: {
      organization_id: args.workspace.organizationId,
      workspace_id: args.workspace.id
    },
    metric_key: args.metricKey,
    metric_version: args.metricVersion,
    filter: args.filter,
    comparison_date_range: comparisonFilter.date_range
  });
  const [current, comparison] = await Promise.all([
    loadSignalSeriesV1(args),
    loadSignalSeriesV1({ ...args, filter: comparisonFilter })
  ]);
  if (current.status !== "ready") return current;
  if (comparison.status !== "ready") return comparison;
  const metric = requireVisibleMetric(args.metricKey, args.metricVersion, args.isInternalUser);
  const currentValue = summarizePoints(current.payload.points, metric.unit === "ratio");
  const comparisonValue = summarizePoints(comparison.payload.points, metric.unit === "ratio");
  return {
    status: "ready" as const,
    etagSeed: `${current.etagSeed}:${comparison.etagSeed}`,
    payload: {
      contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      metric_key: metric.key,
      metric_version: metric.version,
      current: { filters_hash: current.payload.filters_hash, date_range: args.filter.date_range, value: currentValue },
      comparison: { filters_hash: comparison.payload.filters_hash, date_range: comparisonFilter.date_range, value: comparisonValue },
      delta: currentValue != null && comparisonValue != null ? currentValue - comparisonValue : null,
      delta_ratio: currentValue != null && comparisonValue != null && comparisonValue !== 0
        ? (currentValue - comparisonValue) / comparisonValue
        : null
    }
  };
}

export async function loadSignalMentionsV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  metricKey: string;
  cursor?: string | null;
  limit?: number;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  requireVisibleMetric(args.metricKey, 1, args.isInternalUser);
  const corpus = requireServingCorpus(args.workspace);
  const filtersHash = signalFiltersHashV1(args.filter);
  const decoded = args.cursor ? decodeSignalDrillDownCursorV1(args.cursor) : null;
  if (decoded && (decoded.metric_key !== args.metricKey || decoded.filters_hash !== filtersHash)) {
    throw new SignalBackendContractError("invalid_filter", "Drill-down cursor does not match the active metric/filter.", {
      field: "cursor"
    });
  }
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: args.filter,
    study_corpus_ids: [corpus.id],
    metric_key: args.metricKey,
    limit: args.limit,
    ...(decoded ? { cursor: decoded.sort } : {})
  });
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
  const result = await pool.query<{
    subject_id: string;
    occurred_at: Date;
    text_snippet: string | null;
    title: string | null;
    url: string | null;
    platform: string | null;
    language: string | null;
    country: string | null;
  }>(plan.sql, plan.params);
  const hasNext = result.rows.length > limit;
  const records = result.rows.slice(0, limit).map((row) => ({
    subject_id: row.subject_id,
    occurred_at: row.occurred_at.toISOString(),
    text_snippet: row.text_snippet,
    title: row.title,
    url: row.url,
    platform: row.platform,
    language: row.language,
    country: row.country
  }));
  const last = records.at(-1);
  const nextCursor = hasNext && last ? encodeSignalDrillDownCursorV1({
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: args.metricKey,
    filters_hash: filtersHash,
    direction: "next",
    sort: { occurred_at: last.occurred_at, subject_id: last.subject_id }
  }) : null;
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: args.metricKey,
    filters_hash: filtersHash,
    records,
    page: { limit, next_cursor: nextCursor }
  };
}

export async function loadSignalLineageV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  metricKey?: string | null;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const corpus = requireServingCorpus(args.workspace);
  const filtersHash = buildSignalMentionPredicateV1(args.filter, [corpus.id]).filters_hash;
  const params: unknown[] = [args.workspace.id, corpus.id, filtersHash];
  const metricPredicate = args.metricKey ? `AND materialization.metric_key = $4` : "";
  if (args.metricKey) {
    requireVisibleMetric(args.metricKey, 1, args.isInternalUser);
    params.push(args.metricKey);
  }
  const result = await pool.query<{
    materialization_key: string;
    metric_key: string;
    metric_version: number;
    formula_hash: string | null;
    data_watermark_hash: string;
    materialization_state: string;
    quality_state: string;
    computed_at: Date;
  }>(`
    SELECT materialization.materialization_key, materialization.metric_key,
      materialization.metric_version, definition.formula_hash,
      materialization.data_watermark_hash,
      CASE
        WHEN materialization.stale_after IS NOT NULL AND materialization.stale_after <= now() THEN 'stale'
        ELSE materialization.materialization_state
      END AS materialization_state,
      materialization.quality_state, materialization.computed_at
    FROM metric_materializations materialization
    JOIN metric_definitions definition ON definition.id = materialization.metric_definition_id
    WHERE materialization.workspace_id = $1::uuid
      AND materialization.study_corpus_id = $2::uuid
      AND materialization.filters_hash = $3
      AND (materialization.cache_scope <> 'ad_hoc' OR materialization.expires_at > now())
      ${metricPredicate}
    ORDER BY materialization.metric_key, materialization.period_start
    LIMIT 500
  `, params);
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    corpus_id: corpus.id,
    filters_hash: filtersHash,
    materializations: result.rows.map((row) => ({
      materialization_key: row.materialization_key,
      metric_key: row.metric_key,
      metric_version: row.metric_version,
      formula_hash: row.formula_hash,
      data_watermark_hash: row.data_watermark_hash,
      state: row.materialization_state,
      ...(args.isInternalUser ? { quality_state: row.quality_state } : {}),
      computed_at: row.computed_at.toISOString()
    }))
  };
}

async function loadMaterializationRows(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  metricKey: string,
  metricVersion: number
) {
  const corpus = requireServingCorpus(workspace);
  const predicate = buildSignalMentionPredicateV1(filter, [corpus.id]);
  const result = await pool.query<MaterializationRow>(`
    SELECT metric_key, metric_version, metric_group_key,
      period_start::text, period_end::text, value, denominator, sample_size,
      typed_payload, materialization_state, quality_state, data_watermark,
      data_watermark_hash, computed_at, stale_after
    FROM metric_materializations
    WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
      AND metric_key = $3 AND metric_version = $4
      AND filters_hash = $5 AND granularity = $6
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY period_start
  `, [workspace.id, corpus.id, metricKey, metricVersion, predicate.filters_hash, filter.granularity]);
  return result.rows;
}

async function queueMissingMaterialization(workspace: ResolvedSignalWorkspace, filter: SignalFilterV1, metricKeys: string[]) {
  if (!isSignalAdHocMaterializationEnabled()) {
    return {
      status: "missing" as const,
      error: new SignalBackendContractError(
        "not_available",
        "No materialization exists for the canonical filter.",
        { filters_hash: signalFiltersHashV1(filter), ad_hoc_materialization_enabled: false }
      )
    };
  }
  const corpus = requireServingCorpus(workspace);
  const job = buildSignalAdHocMaterializationJobV1({
    workspace_id: workspace.id,
    study_corpus_id: corpus.id,
    filter,
    metric_keys: metricKeys
  });
  await enqueueSignalAdHocMaterialization(job.data, job.job_id);
  return {
    status: "pending" as const,
    payload: {
      contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      state: "pending",
      filters_hash: signalFiltersHashV1(filter),
      retry_after_seconds: 5
    }
  };
}

function requireServingCorpus(workspace: ResolvedSignalWorkspace) {
  const corpus = workspace.corpora[0];
  if (!corpus) throw new SignalBackendContractError("not_available", "Workspace has no serving corpus.");
  return corpus;
}

function requireVisibleMetric(metricKey: string, version: number, isInternalUser: boolean) {
  const metric = signalMetricDefinitionV1(metricKey, version);
  if (!metric || (!isInternalUser && metric.visibility === "internal")) {
    throw new SignalBackendContractError("not_available", "Metric is not available in this workspace visibility.", {
      metric_key: metricKey,
      metric_version: version
    });
  }
  return metric;
}

function assertMetricFilterDimensions(metricKey: string, version: number, filter: SignalFilterV1) {
  const metric = signalMetricDefinitionV1(metricKey, version);
  const supported = new Set(metric?.dimensions.map((dimension) => dimension.key) ?? []);
  const unsupported = (Object.keys(filter.dimensions) as SignalDimensionV1[]).find((dimension) => !supported.has(dimension));
  if (unsupported) {
    throw new SignalBackendContractError("unsupported_dimension", `${unsupported} is not supported by ${metricKey}.`, {
      metric_key: metricKey,
      dimension: unsupported
    });
  }
}

function assertVisibleFilterDimensions(filter: SignalFilterV1, isInternalUser: boolean) {
  if (!isInternalUser && filter.dimensions.source_type) {
    throw new SignalBackendContractError("unsupported_dimension", "source_type is an internal Signal dimension.", {
      dimension: "source_type"
    });
  }
}

function dataFreshness(rows: MaterializationRow[], state: DataFreshnessStateV1, watermark: DataWatermarkV1) {
  return {
    state,
    evaluated_at: new Date().toISOString(),
    stale_after: minInstant(rows.map((row) => row.stale_after)),
    watermark,
    reason: state === "stale" ? "materialization_stale" : state === "partial" ? "source_coverage_partial" : null
  };
}

function rowsState(rows: MaterializationRow[]): DataFreshnessStateV1 {
  if (rows.some((row) => row.stale_after && row.stale_after <= new Date())) return "stale";
  const state = worstState(rows.map((row) => row.materialization_state));
  return state === "not_available" ? "partial" : state;
}

function worstState(states: string[]): DataFreshnessStateV1 {
  if (states.length === 0 || states.every((state) => state === "not_available")) return "not_available";
  if (states.includes("stale")) return "stale";
  if (states.includes("partial") || states.includes("pending") || states.includes("not_available")) return "partial";
  return "fresh";
}

function pointState(state: MaterializationRow["materialization_state"]): SignalMetricPointV1["state"] {
  if (state === "fresh") return "available";
  if (state === "pending") return "not_available";
  return state;
}

function publicWatermark(watermark: DataWatermarkV1, isInternalUser: boolean) {
  return isInternalUser ? watermark : { ...watermark, source_sync_run_ids: [] };
}

function mergeBreakdownBuckets(rows: MaterializationRow[], ratio: boolean): SignalBreakdownBucketV1[] {
  const buckets = new Map<string, {
    label: string;
    numerator: number;
    denominator: number;
    sampleSize: number;
    hasNumerator: boolean;
    hasDenominator: boolean;
    states: string[];
  }>();
  for (const row of rows) {
    const payloadBuckets = Array.isArray(row.typed_payload?.buckets) ? row.typed_payload.buckets : [];
    for (const item of payloadBuckets) {
      if (!item || typeof item !== "object") continue;
      const bucket = item as JsonRecord;
      const key = String(bucket.key ?? "").trim();
      if (!key) continue;
      const sampleSize = numeric(bucket.sample_size);
      const denominator = numeric(bucket.denominator);
      const value = numeric(bucket.value);
      const current = buckets.get(key) ?? {
        label: key,
        numerator: 0,
        denominator: 0,
        sampleSize: 0,
        hasNumerator: false,
        hasDenominator: false,
        states: []
      };
      if (sampleSize != null) current.sampleSize += sampleSize;
      if (denominator != null) {
        current.denominator += denominator;
        current.hasDenominator = true;
      }
      const numerator = ratio ? sampleSize : value;
      if (numerator != null) {
        current.numerator += numerator;
        current.hasNumerator = true;
      }
      current.states.push(row.materialization_state === "fresh" ? String(bucket.state ?? "available") : pointState(row.materialization_state));
      buckets.set(key, current);
    }
  }
  return Array.from(buckets, ([key, bucket]): SignalBreakdownBucketV1 => ({
    key,
    label: bucket.label,
    value: ratio
      ? (bucket.hasNumerator && bucket.hasDenominator && bucket.denominator > 0 ? bucket.numerator / bucket.denominator : null)
      : (bucket.hasNumerator ? bucket.numerator : null),
    denominator: ratio && bucket.hasDenominator ? bucket.denominator : null,
    sample_size: bucket.sampleSize,
    state: bucket.states.includes("stale")
      ? "stale"
      : bucket.states.includes("partial")
        ? "partial"
        : !bucket.hasNumerator || bucket.states.includes("not_available")
          ? "not_available"
          : "available"
  })).sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity) || left.key.localeCompare(right.key));
}

function summarizePoints(points: SignalMetricPointV1[], ratio: boolean) {
  const available = points.filter((point) => point.value != null);
  if (available.length === 0) return null;
  if (!ratio) return available.reduce((total, point) => total + (point.value ?? 0), 0);
  const denominator = available.reduce((total, point) => total + (point.denominator ?? 0), 0);
  if (denominator === 0) return null;
  return available.reduce((total, point) => total + (point.value ?? 0) * (point.denominator ?? 0), 0) / denominator;
}

function groupFacets(rows: Array<{ dimension: SignalDimensionV1; key: string; count: number }>) {
  const grouped: Partial<Record<SignalDimensionV1, Array<{ key: string; count: number }>>> = {};
  for (const row of rows) {
    if (!SIGNAL_DIMENSIONS.includes(row.dimension)) continue;
    const values = grouped[row.dimension] ?? [];
    values.push({ key: row.key, count: Number(row.count) });
    grouped[row.dimension] = values;
  }
  return grouped;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function maxInstant(values: Array<Date | null>) {
  const instants = values.flatMap((value) => value ? [value.getTime()] : []);
  return instants.length ? new Date(Math.max(...instants)).toISOString() : null;
}

function minInstant(values: Array<Date | null>) {
  const instants = values.flatMap((value) => value ? [value.getTime()] : []);
  return instants.length ? new Date(Math.min(...instants)).toISOString() : null;
}

function rowEtagSeed(rows: MaterializationRow[]) {
  return rows.map((row) => `${row.data_watermark_hash}:${row.computed_at.toISOString()}:${row.materialization_state}`).join("|");
}

function weakEtag(seed: string) {
  return `W/"${createHash("sha256").update(seed, "utf8").digest("base64url")}"`;
}

function signalCacheHeaders(etag: string | null, state?: string) {
  const headers: Record<string, string> = {
    "Cache-Control": state === "fresh" ? "private, max-age=30, stale-while-revalidate=60" : "private, no-cache",
    Vary: "Cookie, Authorization"
  };
  if (etag) headers.ETag = etag;
  return headers;
}
