import { createHash } from "node:crypto";

import {
  canonicalSignalFilterJsonV1,
  normalizeSignalFilterV1,
  signalFiltersHashV1,
  SignalBackendContractError,
  type SignalDimensionV1,
  type SignalFilterV1,
  type SignalGranularityV1
} from "./signal-backend-v1";
import {
  signalMetricDefinitionV1,
  type SignalMetricDefinitionV1
} from "./signal-metric-catalog-v1";

export const SIGNAL_MATERIALIZATION_CONTRACT_VERSION = "signal-materialization-v1" as const;
export const SIGNAL_MATERIALIZE_JOB_NAME = "signal.metric-materialize.v1" as const;
export const SIGNAL_MATERIALIZATION_MAX_RANGE_DAYS = 366;
export const SIGNAL_MATERIALIZATION_MAX_DIMENSIONS = 6;
export const SIGNAL_MATERIALIZATION_MAX_VALUES_PER_DIMENSION = 50;
export const SIGNAL_MATERIALIZATION_MAX_PRECOMPUTED_FILTERS = 8;
export const SIGNAL_MATERIALIZATION_MAX_AD_HOC_METRICS = 5;
export const SIGNAL_MATERIALIZATION_MAX_CACHED_FILTERS_PER_RUN = 64;

export type SignalMaterializationStateV1 = "fresh" | "stale" | "pending" | "partial" | "not_available";
export type SignalMaterializationCacheScopeV1 = "default" | "precomputed" | "ad_hoc";

type SignalMaterializeJobScopeV1 = {
  contract_version: typeof SIGNAL_MATERIALIZATION_CONTRACT_VERSION;
  workspace_id: string;
  study_corpus_id: string;
};

export type SignalMaterializeJobDataV1 = SignalMaterializeJobScopeV1 & (
  | {
      trigger: "invalidation";
      invalidation_id: string;
      affected_from: string | null;
      affected_through: string | null;
    }
  | {
      trigger: "ad_hoc";
      filter: SignalFilterV1;
      metric_keys: string[];
    }
);

export type SignalSqlPredicateV1 = {
  sql: string;
  params: unknown[];
  fingerprint: string;
  normalized_filter: SignalFilterV1;
  filters_hash: string;
};

export type SignalMetricMaterializationPlanV1 = {
  contract_version: typeof SIGNAL_MATERIALIZATION_CONTRACT_VERSION;
  metric: SignalMetricDefinitionV1;
  cache_scope: SignalMaterializationCacheScopeV1;
  predicate: SignalSqlPredicateV1;
  sql: string;
  params: unknown[];
};

export type SignalMaterializationRowV1 = {
  period_start: string;
  period_end: string;
  value: string | number | null;
  denominator: string | number | null;
  sample_size: string | number;
  typed_payload: Record<string, unknown>;
  materialization_state: Exclude<SignalMaterializationStateV1, "stale" | "pending">;
  quality_state: "pass" | "partial" | "failed" | "unknown";
};

export type SignalMetricQualityEvaluationV1 = {
  state: "pass" | "partial" | "failed" | "unknown";
  results: Array<{
    key: string;
    severity: "block" | "partial";
    state: "pass" | "partial" | "failed";
    reason: string | null;
  }>;
};

export type SignalFixtureMentionV1 = {
  id: string;
  published_at: string;
  included?: boolean;
  dimensions: Partial<Record<SignalDimensionV1, string[]>>;
  engagement?: number | null;
};

export type SignalFixtureMaterializationV1 = {
  value: number | null;
  denominator: number | null;
  sample_size: number;
  constituent_ids: string[];
  breakdown: Array<{ key: string; value: number; constituent_ids: string[] }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRECOMPUTED_DIMENSIONS = new Set<SignalDimensionV1>(["platform", "source_type", "country", "language"]);

export function buildSignalMentionPredicateV1(
  filterInput: unknown,
  studyCorpusIds: string[]
): SignalSqlPredicateV1 {
  const filter = validateMaterializationFilter(filterInput);
  const corpusIds = sortedUniqueUuids(studyCorpusIds, "study_corpus_ids");
  if (corpusIds.length === 0) {
    throw new SignalBackendContractError("invalid_filter", "At least one study corpus is required.", {
      field: "study_corpus_ids"
    });
  }

  const params: unknown[] = [];
  const parameter = (value: unknown, cast = "") => {
    params.push(value);
    return `$${params.length}${cast}`;
  };
  const conditions = [
    `m.study_corpus_id = ANY(${parameter(corpusIds, "::uuid[]")})`,
    "m.inclusion_status = 'included'",
    `(m.published_at AT TIME ZONE ${parameter(filter.timezone)})::date >= ${parameter(filter.date_range.start, "::date")}`,
    `(m.published_at AT TIME ZONE ${parameter(filter.timezone)})::date <= ${parameter(filter.date_range.end, "::date")}`
  ];

  for (const [dimension, values] of Object.entries(filter.dimensions) as Array<[SignalDimensionV1, string[]]>) {
    if (!values.length) continue;
    const valuesParameter = parameter(values, "::text[]");
    conditions.push(dimensionPredicate(dimension, valuesParameter));
  }

  const sql = conditions.map((condition) => `(${condition})`).join("\n        AND ");
  return {
    sql,
    params,
    fingerprint: sha256(JSON.stringify({ sql, params })),
    normalized_filter: filter,
    filters_hash: signalFiltersHashV1(filter)
  };
}

export function buildSignalMentionDrillDownPlanV1(args: {
  filter: unknown;
  study_corpus_ids: string[];
  metric_key?: string;
  limit?: number;
  cursor?: { occurred_at: string; subject_id: string };
}) {
  const predicate = buildSignalMentionPredicateV1(args.filter, args.study_corpus_ids);
  const metricPredicate = args.metric_key ? metricConstituentPredicateSql(args.metric_key) : null;
  const params = [...predicate.params];
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
  let cursor = "";
  if (args.cursor) {
    params.push(args.cursor.occurred_at, args.cursor.subject_id);
    cursor = `\n        AND (m.published_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);
  return {
    predicate,
    sql: `
      SELECT m.id::text AS subject_id, m.published_at AS occurred_at,
        m.text_snippet, m.title, m.url,
        COALESCE(m.resolved_platform, m.platform) AS platform,
        m.language, m.country
      FROM mentions m
      WHERE ${predicate.sql}${metricPredicate ? `\n        AND (${metricPredicate})` : ""}${cursor}
      ORDER BY m.published_at DESC, m.id DESC
      LIMIT $${params.length}::int
    `,
    params
  };
}

function metricConstituentPredicateSql(metricKey: string) {
  if (!signalMetricDefinitionV1(metricKey, 1)) {
    throw new SignalBackendContractError("not_available", "Signal metric definition is not available.", { metric_key: metricKey });
  }
  if (metricKey === "sentiment.share") return "m.sentiment_score IS NOT NULL";
  if (metricKey === "platform.share") return "COALESCE(m.resolved_platform, m.platform) IS NOT NULL";
  if (metricKey === "source_type.share") return "m.source_system IS NOT NULL";
  if (metricKey === "engagement.total" || metricKey === "engagement.average_per_mention") {
    return ["likes", "comments", "shares", "reposts", "saves"]
      .map((key) => `jsonb_typeof(m.engagement->'${key}') = 'number'`)
      .join(" OR ");
  }
  if (metricKey === "governed_entity.volume") {
    return `EXISTS (
      SELECT 1 FROM record_entity_links rel
      JOIN intelligence_entities entity ON entity.id = rel.entity_id AND entity.status = 'active'
      WHERE rel.subject_type = 'mention' AND rel.subject_id = m.id
    )`;
  }
  const taxonomyPattern = metricKey === "emotion.share" ? "emotion"
    : metricKey === "topic.volume" ? "topic"
      : metricKey === "narrative.volume" ? "narrative"
        : null;
  if (taxonomyPattern) {
    return `EXISTS (
      SELECT 1 FROM record_tags tag
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
      JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
      WHERE tag.subject_type = 'mention' AND tag.subject_id = m.id
        AND tag.review_status = 'approved'
        AND lower(taxonomy.taxonomy_key) LIKE '%${taxonomyPattern}%'
    )`;
  }
  return "true";
}

export function buildSignalMetricMaterializationPlanV1(args: {
  metric_key: string;
  metric_version?: number;
  filter: unknown;
  study_corpus_ids: string[];
}): SignalMetricMaterializationPlanV1 {
  const metric = signalMetricDefinitionV1(args.metric_key, args.metric_version ?? 1);
  if (!metric) {
    throw new SignalBackendContractError("not_available", "Signal metric definition is not available.", {
      metric_key: args.metric_key,
      metric_version: args.metric_version ?? 1
    });
  }
  const visiblePredicate = buildSignalMentionPredicateV1(args.filter, args.study_corpus_ids);
  validateMetricDimensions(metric, visiblePredicate.normalized_filter);
  const granularity = visiblePredicate.normalized_filter.granularity;
  const executionFilter = metric.key === "conversation.velocity"
    ? {
        ...visiblePredicate.normalized_filter,
        date_range: {
          ...visiblePredicate.normalized_filter.date_range,
          start: previousSignalBucketStartV1(
            visiblePredicate.normalized_filter.date_range.start,
            granularity
          )
        }
      }
    : visiblePredicate.normalized_filter;
  const executionPredicate = metric.key === "conversation.velocity"
    ? buildSignalMentionPredicateV1(executionFilter, args.study_corpus_ids)
    : visiblePredicate;
  const predicate = metric.key === "conversation.velocity"
    ? {
        ...executionPredicate,
        normalized_filter: visiblePredicate.normalized_filter,
        filters_hash: visiblePredicate.filters_hash,
        fingerprint: sha256(JSON.stringify({
          sql: executionPredicate.sql,
          params: executionPredicate.params,
          visible_filters_hash: visiblePredicate.filters_hash
        }))
      }
    : visiblePredicate;
  const periodStart = periodStartSql(granularity, visiblePredicate.normalized_filter.timezone);
  const periodEnd = periodEndSql(granularity, "period_start");
  const base = `
    WITH base_mentions AS (
      SELECT m.id, m.published_at, m.engagement, m.sentiment_score,
        m.source_system, COALESCE(m.resolved_platform, m.platform) AS platform,
        m.language, m.country, m.content_type,
        ${periodStart} AS period_start
      FROM mentions m
      WHERE ${predicate.sql}
    )`;
  const sql = materializationSql(
    metric.key,
    base,
    periodEnd,
    periodBucketStartV1(visiblePredicate.normalized_filter.date_range.start, granularity),
    periodBucketStartV1(executionFilter.date_range.start, granularity),
    periodBucketStartV1(visiblePredicate.normalized_filter.date_range.end, granularity),
    granularity
  );
  return {
    contract_version: SIGNAL_MATERIALIZATION_CONTRACT_VERSION,
    metric,
    cache_scope: classifySignalFilterCacheScopeV1(predicate.normalized_filter),
    predicate,
    sql,
    params: predicate.params
  };
}

export function previousSignalBucketStartV1(date: string, granularity: SignalGranularityV1) {
  const current = periodBucketStartV1(date, granularity);
  const value = new Date(`${current}T00:00:00.000Z`);
  if (granularity === "day") value.setUTCDate(value.getUTCDate() - 1);
  else if (granularity === "week") value.setUTCDate(value.getUTCDate() - 7);
  else value.setUTCMonth(value.getUTCMonth() - 1);
  return isoDate(value);
}

export function classifySignalFilterCacheScopeV1(filterInput: unknown): SignalMaterializationCacheScopeV1 {
  const filter = validateMaterializationFilter(filterInput);
  const entries = Object.entries(filter.dimensions) as Array<[SignalDimensionV1, string[]]>;
  if (entries.length === 0) return "default";
  if (entries.length === 1 && entries[0] && PRECOMPUTED_DIMENSIONS.has(entries[0][0]) && entries[0][1].length === 1) {
    return "precomputed";
  }
  return "ad_hoc";
}

export function buildSignalPrecomputedFiltersV1(
  filterInput: unknown,
  facets: Partial<Record<"platform" | "source_type" | "country" | "language", string[]>>
) {
  const base = validateMaterializationFilter(filterInput);
  const filters: SignalFilterV1[] = [{ ...base, dimensions: {} }];
  for (const dimension of ["platform", "source_type", "country", "language"] as const) {
    for (const value of sortedUniqueStrings(facets[dimension] ?? [])) {
      if (filters.length >= SIGNAL_MATERIALIZATION_MAX_PRECOMPUTED_FILTERS) return filters;
      filters.push(normalizeSignalFilterV1({ ...base, dimensions: { [dimension]: [value] } }));
    }
  }
  return filters;
}

export function splitSignalMaterializationDateRangeV1(dateRange: { start: string; end: string }) {
  const start = new Date(`${dateRange.start}T00:00:00Z`);
  const end = new Date(`${dateRange.end}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new SignalBackendContractError("invalid_filter", "Signal materialization date range is invalid.", {
      field: "date_range"
    });
  }
  const windows: Array<{ start: string; end: string }> = [];
  for (let cursor = start; cursor <= end;) {
    const through = new Date(Math.min(end.getTime(), cursor.getTime() + (SIGNAL_MATERIALIZATION_MAX_RANGE_DAYS - 1) * 86_400_000));
    windows.push({ start: isoDate(cursor), end: isoDate(through) });
    cursor = new Date(through.getTime() + 86_400_000);
  }
  return windows;
}

export function signalMetricMaterializationKeyV1(args: {
  workspace_id: string;
  study_corpus_id: string;
  metric_key: string;
  metric_version: number;
  granularity: SignalGranularityV1;
  period_start: string;
  period_end: string;
  filters_hash: string;
}) {
  return sha256(JSON.stringify(args));
}

export function buildSignalAdHocMaterializationJobV1(args: {
  workspace_id: string;
  study_corpus_id: string;
  filter: unknown;
  metric_keys: string[];
}) {
  const filter = validateMaterializationFilter(args.filter);
  const metricKeys = sortedUniqueStrings(args.metric_keys);
  if (metricKeys.length === 0 || metricKeys.length > SIGNAL_MATERIALIZATION_MAX_AD_HOC_METRICS) {
    throw new SignalBackendContractError("invalid_filter", "Ad hoc materialization requires one to five metrics.", {
      maximum_metrics: SIGNAL_MATERIALIZATION_MAX_AD_HOC_METRICS
    });
  }
  for (const metricKey of metricKeys) {
    if (!signalMetricDefinitionV1(metricKey, 1)) {
      throw new SignalBackendContractError("not_available", "Ad hoc metric is not in the active V1 catalog.", {
        metric_key: metricKey
      });
    }
  }
  const predicate = buildSignalMentionPredicateV1(filter, [args.study_corpus_id]);
  const data: SignalMaterializeJobDataV1 = {
    contract_version: SIGNAL_MATERIALIZATION_CONTRACT_VERSION,
    trigger: "ad_hoc",
    workspace_id: args.workspace_id,
    study_corpus_id: args.study_corpus_id,
    filter,
    metric_keys: metricKeys
  };
  return {
    data,
    job_id: `signal-ad-hoc-${sha256(JSON.stringify({
      workspace_id: args.workspace_id,
      study_corpus_id: args.study_corpus_id,
      filters_hash: predicate.filters_hash,
      metric_keys: metricKeys
    })).slice(7, 39)}`
  };
}

export function materializeSignalFixtureV1(
  metricKey: "conversation.volume" | "engagement.total" | "engagement.average_per_mention",
  filterInput: unknown,
  mentions: SignalFixtureMentionV1[],
  breakdownDimension: SignalDimensionV1 = "platform"
): SignalFixtureMaterializationV1 {
  const filter = validateMaterializationFilter(filterInput);
  const included = mentions.filter((mention) => fixtureMatchesFilter(mention, filter));
  const measured = included.filter((mention) => mention.engagement != null);
  const constituents = metricKey === "conversation.volume" ? included : measured;
  let value: number | null;
  let denominator: number | null = null;
  if (metricKey === "conversation.volume") value = included.length;
  else if (metricKey === "engagement.total") value = measured.length ? sum(measured.map((mention) => mention.engagement ?? 0)) : null;
  else {
    denominator = measured.length || null;
    value = denominator ? sum(measured.map((mention) => mention.engagement ?? 0)) / denominator : null;
  }

  const buckets = new Map<string, string[]>();
  for (const mention of constituents) {
    for (const key of mention.dimensions[breakdownDimension] ?? []) {
      const canonical = key.normalize("NFC").trim().toLocaleLowerCase("en-US");
      if (!canonical) continue;
      const ids = buckets.get(canonical) ?? [];
      if (!ids.includes(mention.id)) ids.push(mention.id);
      buckets.set(canonical, ids);
    }
  }
  return {
    value,
    denominator,
    sample_size: constituents.length,
    constituent_ids: constituents.map((mention) => mention.id).sort(),
    breakdown: Array.from(buckets, ([key, ids]) => ({ key, value: ids.length, constituent_ids: ids.sort() }))
      .sort((left, right) => left.key.localeCompare(right.key))
  };
}

function validateMaterializationFilter(filterInput: unknown) {
  const filter = normalizeSignalFilterV1(filterInput);
  const start = Date.parse(`${filter.date_range.start}T00:00:00Z`);
  const end = Date.parse(`${filter.date_range.end}T00:00:00Z`);
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days > SIGNAL_MATERIALIZATION_MAX_RANGE_DAYS) {
    throw new SignalBackendContractError("invalid_filter", "Signal materialization range exceeds 366 days.", {
      maximum_days: SIGNAL_MATERIALIZATION_MAX_RANGE_DAYS,
      requested_days: days
    });
  }
  const entries = Object.entries(filter.dimensions);
  if (entries.length > SIGNAL_MATERIALIZATION_MAX_DIMENSIONS) {
    throw new SignalBackendContractError("invalid_filter", "Signal filter has too many dimensions.", {
      maximum_dimensions: SIGNAL_MATERIALIZATION_MAX_DIMENSIONS
    });
  }
  for (const [dimension, values] of entries) {
    if ((values?.length ?? 0) > SIGNAL_MATERIALIZATION_MAX_VALUES_PER_DIMENSION) {
      throw new SignalBackendContractError("invalid_filter", "Signal dimension exceeds its cardinality limit.", {
        dimension,
        maximum_values: SIGNAL_MATERIALIZATION_MAX_VALUES_PER_DIMENSION
      });
    }
  }
  return filter;
}

function validateMetricDimensions(metric: SignalMetricDefinitionV1, filter: SignalFilterV1) {
  const supported = new Set(metric.dimensions.map((dimension) => dimension.key));
  for (const dimension of Object.keys(filter.dimensions) as SignalDimensionV1[]) {
    if (!supported.has(dimension)) {
      throw new SignalBackendContractError("unsupported_dimension", `${dimension} is not supported by ${metric.key}.`, {
        metric_key: metric.key,
        dimension,
        supported_dimensions: Array.from(supported)
      });
    }
  }
}

function dimensionPredicate(dimension: SignalDimensionV1, valuesParameter: string) {
  const simple: Partial<Record<SignalDimensionV1, string>> = {
    platform: "lower(COALESCE(m.resolved_platform, m.platform))",
    source_type: "lower(m.source_system)",
    country: "lower(m.country)",
    language: "lower(m.language)",
    content_format: "lower(m.content_type)",
    product: "lower(m.batch_entity_label)",
    sentiment_polarity: "CASE WHEN m.sentiment_score > 0.2 THEN 'positive' WHEN m.sentiment_score < -0.2 THEN 'negative' WHEN m.sentiment_score IS NULL THEN NULL ELSE 'neutral' END"
  };
  if (simple[dimension]) return `${simple[dimension]} = ANY(${valuesParameter})`;
  if (dimension === "entity") {
    return `EXISTS (
      SELECT 1 FROM record_entity_links rel
      JOIN intelligence_entities entity ON entity.id = rel.entity_id AND entity.status = 'active'
      WHERE rel.subject_type = 'mention' AND rel.subject_id = m.id
        AND lower(entity.canonical_name) = ANY(${valuesParameter})
    )`;
  }
  const taxonomyDimensions = new Set<SignalDimensionV1>(["topic", "taxonomy", "trigger", "barrier", "emotion"]);
  if (taxonomyDimensions.has(dimension)) {
    return `EXISTS (
      SELECT 1 FROM record_tags tag
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
      JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
      WHERE tag.subject_type = 'mention' AND tag.subject_id = m.id
        AND tag.review_status = 'approved'
        AND (lower(term.term_key) = ANY(${valuesParameter}) OR lower(COALESCE(tag.value, term.label)) = ANY(${valuesParameter}))
        ${dimension === "taxonomy" ? "" : `AND lower(taxonomy.taxonomy_key) LIKE '%${dimension}%'`}
    )`;
  }
  return `EXISTS (
    SELECT 1 FROM record_feature_values feature
    WHERE feature.subject_type = 'mention' AND feature.subject_id = m.id
      AND feature.feature_key = '${dimension}'
      AND lower(trim(both '"' from feature.feature_value::text)) = ANY(${valuesParameter})
  )`;
}

function materializationSql(
  metricKey: string,
  base: string,
  periodEnd: string,
  visiblePeriodStart: string,
  executionPeriodStart: string,
  visiblePeriodEnd: string,
  granularity: SignalGranularityV1
) {
  if (metricKey === "conversation.volume" || metricKey === "conversation.velocity") {
    const velocity = metricKey === "conversation.velocity";
    const step = granularity === "day" ? "1 day" : granularity === "week" ? "1 week" : "1 month";
    return `${base}, periods AS (
      SELECT generate_series(
        '${executionPeriodStart}'::date,
        '${visiblePeriodEnd}'::date,
        interval '${step}'
      )::date AS period_start
    ), counts AS (
      SELECT periods.period_start, COUNT(base_mentions.id)::numeric AS mention_count
      FROM periods
      LEFT JOIN base_mentions USING (period_start)
      GROUP BY periods.period_start
    ), values AS (
      SELECT period_start, mention_count,
        LAG(mention_count) OVER (ORDER BY period_start) AS previous_count
      FROM counts
    )
    SELECT period_start::text, ${periodEnd}::text AS period_end,
      ${velocity ? "CASE WHEN previous_count > 0 THEN (mention_count - previous_count) / previous_count ELSE NULL END" : "mention_count"} AS value,
      ${velocity ? "previous_count" : "NULL::numeric"} AS denominator,
      mention_count::int AS sample_size,
      jsonb_build_object(
        'kind', '${velocity ? "period_change" : "scalar"}',
        'mention_count', mention_count,
        'previous_count', previous_count
      ) AS typed_payload,
      CASE WHEN ${velocity ? "previous_count IS NULL OR previous_count = 0" : "false"} THEN 'not_available' ELSE 'fresh' END AS materialization_state,
      CASE WHEN ${velocity ? "previous_count IS NULL OR previous_count = 0" : "false"} THEN 'unknown' ELSE 'pass' END AS quality_state
    FROM values
    ${velocity ? `WHERE period_start >= '${visiblePeriodStart}'::date` : ""}
    ORDER BY period_start`;
  }

  if (metricKey === "engagement.total" || metricKey === "engagement.average_per_mention") {
    const average = metricKey === "engagement.average_per_mention";
    const component = (key: string) => `CASE WHEN jsonb_typeof(engagement->'${key}') = 'number' THEN (engagement->>'${key}')::numeric END`;
    const components = ["likes", "comments", "shares", "reposts", "saves"].map(component);
    const measured = components.map((expression) => `${expression} IS NOT NULL`).join(" OR ");
    const total = components.map((expression) => `COALESCE(${expression}, 0)`).join(" + ");
    return `${base}, measured AS (
      SELECT period_start, (${total}) AS engagement_value
      FROM base_mentions WHERE ${measured}
    )
    SELECT period_start::text, ${periodEnd}::text AS period_end,
      ${average ? "SUM(engagement_value) / NULLIF(COUNT(*), 0)" : "SUM(engagement_value)"} AS value,
      ${average ? "COUNT(*)::numeric" : "NULL::numeric"} AS denominator,
      COUNT(*)::int AS sample_size,
      jsonb_build_object('kind', '${average ? "ratio" : "scalar"}', 'measured_mentions', COUNT(*)) AS typed_payload,
      'fresh'::text AS materialization_state, 'pass'::text AS quality_state
    FROM measured GROUP BY period_start ORDER BY period_start`;
  }

  const category = categorySql(metricKey);
  const share = metricKey.endsWith(".share");
  const pendingReview = pendingReviewSql(metricKey);
  return `${base}, classified AS (
    SELECT b.id, b.period_start, category.key
    FROM base_mentions b
    JOIN LATERAL (${category}) category ON category.key IS NOT NULL
  ), pending_reviews AS (
    ${pendingReview}
  ), buckets AS (
    SELECT period_start, key, COUNT(DISTINCT id)::numeric AS bucket_value
    FROM classified GROUP BY period_start, key
  ), denominators AS (
    SELECT period_start, COUNT(DISTINCT id)::numeric AS period_denominator
    FROM classified GROUP BY period_start
  ), scored AS (
    SELECT bucket.period_start, bucket.key, bucket.bucket_value, denominator.period_denominator
    FROM buckets bucket
    JOIN denominators denominator USING (period_start)
  ), all_periods AS (
    SELECT DISTINCT period_start FROM base_mentions
  ), periods AS (
    SELECT period.period_start,
      denominator.period_denominator::numeric AS denominator,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', scored.key,
            'value', ${share ? "scored.bucket_value / NULLIF(scored.period_denominator, 0)" : "scored.bucket_value"},
            'denominator', ${share ? "scored.period_denominator" : "NULL"},
            'sample_size', scored.bucket_value::int,
            'state', 'available'
          ) ORDER BY scored.bucket_value DESC, scored.key
        )
        FROM scored WHERE scored.period_start = period.period_start
      ), '[]'::jsonb) AS buckets,
      COALESCE(pending.pending_count, 0)::int AS pending_count
    FROM all_periods period
    LEFT JOIN denominators denominator USING (period_start)
    LEFT JOIN pending_reviews pending USING (period_start)
  )
  SELECT period_start::text, ${periodEnd}::text AS period_end,
    ${share ? "NULL::numeric" : "denominator"} AS value,
    ${share ? "denominator" : "NULL::numeric"} AS denominator,
    COALESCE(denominator, 0)::int AS sample_size,
    jsonb_build_object(
      'kind', 'breakdown',
      'buckets', buckets,
      'pending_review_count', pending_count,
      'quality_reasons', CASE
        WHEN pending_count > 0 THEN jsonb_build_array('review_pending')
        ELSE '[]'::jsonb
      END
    ) AS typed_payload,
    CASE
      WHEN pending_count > 0 THEN 'partial'
      WHEN denominator IS NULL OR denominator = 0 THEN 'not_available'
      ELSE 'fresh'
    END::text AS materialization_state,
    CASE
      WHEN pending_count > 0 THEN 'partial'
      WHEN denominator IS NULL OR denominator = 0 THEN 'unknown'
      ELSE 'pass'
    END::text AS quality_state
  FROM periods ORDER BY period_start`;
}

function pendingReviewSql(metricKey: string) {
  const taxonomyPattern = metricKey === "emotion.share" ? "emotion"
    : metricKey === "topic.volume" ? "topic"
      : metricKey === "narrative.volume" ? "narrative"
        : null;
  if (!taxonomyPattern) {
    return "SELECT NULL::date AS period_start, 0::bigint AS pending_count WHERE false";
  }
  return `SELECT b.period_start, COUNT(DISTINCT b.id)::bigint AS pending_count
    FROM base_mentions b
    JOIN record_tags tag ON tag.subject_type = 'mention' AND tag.subject_id = b.id
    JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
    JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
    WHERE tag.review_status NOT IN ('approved', 'rejected')
      AND lower(taxonomy.taxonomy_key) LIKE '%${taxonomyPattern}%'
    GROUP BY b.period_start`;
}

function categorySql(metricKey: string) {
  if (metricKey === "sentiment.share") {
    return `SELECT CASE WHEN b.sentiment_score > 0.2 THEN 'positive'
      WHEN b.sentiment_score < -0.2 THEN 'negative'
      WHEN b.sentiment_score IS NULL THEN NULL ELSE 'neutral' END AS key`;
  }
  if (metricKey === "platform.share") return "SELECT lower(b.platform) AS key";
  if (metricKey === "source_type.share") return "SELECT lower(b.source_system) AS key";
  if (metricKey === "governed_entity.volume") {
    return `SELECT lower(entity.canonical_name) AS key
      FROM record_entity_links rel
      JOIN intelligence_entities entity ON entity.id = rel.entity_id AND entity.status = 'active'
      WHERE rel.subject_type = 'mention' AND rel.subject_id = b.id`;
  }
  const taxonomyPattern = metricKey === "emotion.share" ? "emotion"
    : metricKey === "topic.volume" ? "topic"
      : "narrative";
  return `SELECT lower(COALESCE(tag.value, term.label)) AS key
    FROM record_tags tag
    JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
    JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id AND taxonomy.status = 'active'
    WHERE tag.subject_type = 'mention' AND tag.subject_id = b.id
      AND tag.review_status = 'approved'
      AND lower(taxonomy.taxonomy_key) LIKE '%${taxonomyPattern}%'`;
}

export function evaluateSignalMetricQualityV1(args: {
  metric: SignalMetricDefinitionV1;
  row: Pick<SignalMaterializationRowV1, "denominator" | "sample_size" | "materialization_state" | "quality_state" | "typed_payload">;
  data_freshness: "fresh" | "stale" | "partial" | "not_available";
}): SignalMetricQualityEvaluationV1 {
  const denominator = args.row.denominator == null ? null : Number(args.row.denominator);
  const sampleSize = Number(args.row.sample_size);
  const pendingReviewCount = Number(args.row.typed_payload.pending_review_count ?? 0);
  const results = args.metric.quality_rules.map((rule) => {
    let failed = false;
    let partial = false;
    let reason: string | null = null;
    if (rule.key === "accepted_coverage") {
      failed = args.data_freshness === "not_available";
      partial = args.data_freshness === "partial";
      reason = failed || partial ? "accepted_source_coverage_incomplete" : null;
    } else if (rule.key === "known_source_gap" || rule.key === "watermark_comparability" || rule.key === "provider_component_coverage") {
      partial = args.data_freshness === "partial" || args.data_freshness === "stale";
      reason = partial ? "source_freshness_or_coverage_degraded" : null;
    } else if (rule.key === "equal_period_days") {
      failed = false;
    } else if (rule.key === "positive_previous_denominator" || rule.key === "positive_measured_mentions") {
      failed = denominator == null || denominator <= 0;
      reason = failed ? "denominator_not_positive" : null;
    } else if (rule.key === "observed_component" || rule.key.startsWith("classified_") || rule.key.startsWith("governed_")) {
      failed = sampleSize <= 0 && pendingReviewCount <= 0;
      reason = failed ? "accepted_evidence_not_available" : null;
    } else if (rule.key === "review_pending") {
      partial = pendingReviewCount > 0;
      reason = partial ? "governed_classification_review_pending" : null;
    } else if (rule.key === "classification_coverage") {
      partial = pendingReviewCount > 0 || args.row.quality_state === "partial";
      reason = partial ? "classification_coverage_incomplete" : null;
    }
    return {
      key: rule.key,
      severity: rule.severity,
      state: failed ? "failed" as const : partial ? "partial" as const : "pass" as const,
      reason
    };
  });
  const state = results.some((result) => result.severity === "block" && result.state === "failed")
    ? "failed"
    : results.some((result) => result.state === "partial") || args.row.quality_state === "partial"
      ? "partial"
      : args.row.quality_state;
  return { state, results };
}

function periodStartSql(granularity: SignalGranularityV1, timezone: string) {
  const unit = granularity === "day" ? "day" : granularity === "week" ? "week" : "month";
  return `date_trunc('${unit}', m.published_at AT TIME ZONE '${timezone.replaceAll("'", "''")}')::date`;
}

function periodEndSql(granularity: SignalGranularityV1, expression: string) {
  if (granularity === "day") return expression;
  if (granularity === "week") return `(${expression} + 6)`;
  return `(date_trunc('month', ${expression}) + interval '1 month - 1 day')::date`;
}

function periodBucketStartV1(date: string, granularity: SignalGranularityV1) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (granularity === "week") {
    const day = value.getUTCDay();
    value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  } else if (granularity === "month") {
    value.setUTCDate(1);
  }
  return isoDate(value);
}

function fixtureMatchesFilter(mention: SignalFixtureMentionV1, filter: SignalFilterV1) {
  if (mention.included === false) return false;
  const date = mention.published_at.slice(0, 10);
  if (date < filter.date_range.start || date > filter.date_range.end) return false;
  return (Object.entries(filter.dimensions) as Array<[SignalDimensionV1, string[]]>).every(([dimension, expected]) => {
    const actual = new Set((mention.dimensions[dimension] ?? []).map((value) => value.normalize("NFC").trim().toLocaleLowerCase("en-US")));
    return expected.some((value) => actual.has(value));
  });
}

function sortedUniqueUuids(values: string[], field: string) {
  const normalized = sortedUniqueStrings(values);
  for (const value of normalized) {
    if (!UUID_PATTERN.test(value)) {
      throw new SignalBackendContractError("invalid_filter", `${field} contains an invalid UUID.`, { field });
    }
  }
  return normalized;
}

function sortedUniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.normalize("NFC").trim().toLocaleLowerCase("en-US")).filter(Boolean))).sort();
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function canonicalSignalMaterializationFilterJsonV1(filterInput: unknown) {
  return canonicalSignalFilterJsonV1(validateMaterializationFilter(filterInput));
}
