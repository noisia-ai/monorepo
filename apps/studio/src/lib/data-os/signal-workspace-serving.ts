import { createHash } from "node:crypto";

import {
  SIGNAL_BACKEND_CONTRACT_VERSION,
  SIGNAL_DIMENSIONS,
  SIGNAL_METRIC_CATALOG_V1,
  SignalBackendContractError,
  buildSignalMetricMaterializationPlanV1,
  buildSignalMentionReadPredicateV1,
  buildSignalPopulationMentionReadPredicateV1,
  buildSignalAdHocMaterializationJobV1,
  buildSignalMentionDrillDownPlanV1,
  dataWatermarkHashV1,
  decodeSignalDrillDownCursorV1,
  encodeSignalDrillDownCursorV1,
  evaluateSignalMetricQualityV1,
  parseSignalFilterQueryParamsV1,
  normalizeSignalMetricQueryV1,
  signalFiltersHashV1,
  signalServingScopeCursorIsolationHashV1,
  signalServingScopeEtagSeedV1,
  signalServingScopeIdentityHashV1,
  signalMetricDefinitionV1,
  validateDataWatermarkV1,
  validateSignalBreakdownV1,
  validateSignalTimeSeriesV1,
  type DataFreshnessStateV1,
  type DataWatermarkV1,
  type SignalBreakdownBucketV1,
  type SignalDimensionV1,
  type SignalFilterV1,
  type SignalMaterializationRowV1,
  type SignalMetricDefinitionV1,
  type SignalMetricPointV1,
  type SignalServingScopeDescriptorV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import {
  buildSignalOperationalMentionReadPredicateV1,
  operationalMaterializationScopeV1,
  requireSignalOperationalReadScopeV1,
  resolveSignalOperationalReadScopeV1,
  type SignalOperationalReadScopeV1
} from "@/lib/data-os/signal-operational-read-scope";
import { isSignalAdHocMaterializationEnabled } from "@/lib/data-os/serving";
import {
  enqueueSignalAdHocMaterialization,
  isDataOsQueueConfigured
} from "@/lib/queue/data-os";

export interface SignalServingQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export type SignalClientEvidenceAccessV1 =
  | {
      state: "available";
      metric_denominator_count: number;
      evidence_constituent_count: number;
      evidence_visible_count: number;
      evidence_withheld_count: number;
      reason: null;
    }
  | {
      state: "not_available";
      metric_denominator_count: number;
      evidence_constituent_count: number;
      evidence_visible_count: null;
      evidence_withheld_count: null;
      reason: "mentions_capability_not_available";
    };

/**
 * Counts the metric population and its client-visible evidence intersection.
 *
 * Metric and evidence populations intentionally remain independent: metrics use
 * the module population while rows/excerpts must additionally be present in the
 * Mentions view. Both sides are deduplicated by canonical root. Passing `null`
 * is an explicit fail-closed evidence decision; omitting this helper preserves
 * legacy payloads and behavior.
 */
export async function loadSignalClientEvidenceAccessV1(args: {
  workspace: ResolvedSignalWorkspace;
  metricReadScope: SignalOperationalReadScopeV1;
  evidenceReadScope: SignalOperationalReadScopeV1 | null;
  filter: SignalFilterV1;
  queryable?: SignalServingQueryable;
}): Promise<SignalClientEvidenceAccessV1> {
  const metricScope = requireSignalOperationalReadScopeV1(
    args.workspace,
    args.metricReadScope
  );
  const metricPredicate = buildSignalOperationalMentionReadPredicateV1(
    metricScope,
    args.filter
  );
  if (!args.evidenceReadScope) {
    const result = await (args.queryable ?? pool).query<{ metric_count: number }>(`
      SELECT count(DISTINCT COALESCE(m.canonical_mention_id, m.id))::int AS metric_count
      FROM mentions m
      WHERE ${metricPredicate.sql}
    `, metricPredicate.params);
    const metricCount = requiredNonNegativeCount(
      result.rows[0]?.metric_count,
      "client_evidence_metric_count_not_available"
    );
    return {
      state: "not_available",
      metric_denominator_count: metricCount,
      evidence_constituent_count: metricCount,
      evidence_visible_count: null,
      evidence_withheld_count: null,
      reason: "mentions_capability_not_available"
    };
  }
  const evidenceScope = requireSignalOperationalReadScopeV1(
    args.workspace,
    args.evidenceReadScope
  );
  const evidencePredicate = buildSignalOperationalMentionReadPredicateV1(
    evidenceScope,
    args.filter
  );
  const evidenceSql = rebaseSqlParameters(
    evidencePredicate.sql,
    metricPredicate.params.length
  );
  const result = await (args.queryable ?? pool).query<{
    metric_count: number;
    visible_count: number;
  }>(`
    WITH metric_roots AS (
      SELECT DISTINCT COALESCE(m.canonical_mention_id, m.id) AS mention_id
      FROM mentions m
      WHERE ${metricPredicate.sql}
    ), evidence_roots AS (
      SELECT DISTINCT COALESCE(m.canonical_mention_id, m.id) AS mention_id
      FROM mentions m
      WHERE ${evidenceSql}
    )
    SELECT
      (SELECT count(*)::int FROM metric_roots) AS metric_count,
      (SELECT count(*)::int
       FROM metric_roots metric
       JOIN evidence_roots evidence USING (mention_id)) AS visible_count
  `, [...metricPredicate.params, ...evidencePredicate.params]);
  const metricCount = requiredNonNegativeCount(
    result.rows[0]?.metric_count,
    "client_evidence_metric_count_not_available"
  );
  const visibleCount = requiredNonNegativeCount(
    result.rows[0]?.visible_count,
    "client_evidence_visible_count_not_available"
  );
  if (visibleCount > metricCount) {
    throw new SignalBackendContractError(
      "not_available",
      "Client evidence coverage is inconsistent with its metric denominator.",
      { reason: "client_evidence_count_contract_invalid" }
    );
  }
  return {
    state: "available",
    metric_denominator_count: metricCount,
    evidence_constituent_count: metricCount,
    evidence_visible_count: visibleCount,
    evidence_withheld_count: Math.max(0, metricCount - visibleCount),
    reason: null
  };
}

function requiredNonNegativeCount(value: unknown, reason: string): number {
  const count = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new SignalBackendContractError(
      "not_available",
      "Client evidence coverage could not be measured.",
      { reason }
    );
  }
  return count;
}

type JsonRecord = Record<string, unknown>;

export type SignalServingMaterializationRowV1 = {
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
type MaterializationRow = SignalServingMaterializationRowV1;

type LiveWatermarkRow = {
  corpus_revision: number;
  last_source_sync_run_id: string | null;
  last_import_batch_id: string | null;
  max_observed_at: Date | null;
  accepted_at: Date;
  materialized_at: Date;
  data_freshness_state: "fresh" | "stale" | "partial" | "not_available";
  stale_after: Date | null;
};

const RESERVED_FILTER_PARAMS = new Set([
  "metric_key", "metric_version", "group", "dimension", "breakdown_dimension",
  "compare", "comparison", "comparison_mode", "compareStart", "compareEnd",
  "comparison_start", "comparison_end", "cursor", "limit", "require_fresh", "view"
]);
const NATURAL_BREAKDOWN_DIMENSION: Partial<Record<string, SignalDimensionV1>> = {
  "sentiment.share": "sentiment_polarity",
  "emotion.share": "emotion",
  "platform.share": "platform",
  "source_type.share": "source_type",
  "topic.volume": "topic",
  "narrative.volume": "narrative",
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
  console.error("Signal workspace API failed", error);
  const message = process.env.NODE_ENV === "development" && error instanceof Error
    ? error.message
    : "Signal data is temporarily not available.";
  return Response.json(new SignalBackendContractError(
    "not_available",
    message
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

export function signalWorstResponseStateV1(states: string[]) {
  if (states.length === 0 || states.every((state) => state === "not_available")) return "not_available";
  if (states.includes("stale")) return "stale";
  if (states.includes("partial")) return "partial";
  if (states.includes("pending")) return "pending";
  if (states.includes("not_available")) return "not_available";
  return states.every((state) => state === "fresh" || state === "available")
    ? "fresh"
    : "partial";
}

export function signalMaterializationResultResponse(
  request: Request,
  result:
    | { status: "ready"; payload: unknown; etagSeed: string }
    | { status: "pending"; payload: unknown }
    | { status: "missing"; error: SignalBackendContractError },
  options: { servingScope?: SignalServingScopeDescriptorV1 | null } = {}
) {
  if (result.status === "missing") return signalBackendErrorResponse(result.error);
  const payload = attachServingScope(result.payload, options.servingScope ?? null);
  if (result.status === "pending") {
    return signalJsonResponse(request, payload, { status: 202, state: "pending" });
  }
  const state = isRecord(payload)
    && isRecord(payload.freshness)
    && typeof payload.freshness.state === "string"
    ? payload.freshness.state
    : undefined;
  const etagSeed = options.servingScope
    ? `${signalServingScopeIdentityHashV1(options.servingScope)}:${result.etagSeed}`
    : result.etagSeed;
  return signalJsonResponse(request, payload, { etagSeed, state });
}

function attachServingScope(
  payload: unknown,
  servingScope: SignalServingScopeDescriptorV1 | null
) {
  if (!servingScope) return payload;
  if (!isRecord(payload)) {
    throw new SignalBackendContractError(
      "not_available",
      "Governed materialization payload cannot declare its serving authority.",
      { reason: "governed_materialization_payload_invalid" }
    );
  }
  return { ...payload, serving_scope: servingScope };
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

export async function loadSignalBootstrapV1(
  workspace: ResolvedSignalWorkspace,
  isInternalUser: boolean,
  readScope?: SignalOperationalReadScopeV1
) {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const ownership = operationalDbScope(scope);
  const [coverage, watermarks, metricStates, interpretationStates] = await Promise.all([
    pool.query<{ date_from: string | null; date_through: string | null; mentions: number }>(`
      SELECT MIN((published_at AT TIME ZONE $2)::date)::text AS date_from,
        MAX((published_at AT TIME ZONE $2)::date)::text AS date_through,
        COUNT(*)::int AS mentions
      FROM mentions mention
      WHERE ${ownership.mentionSql("mention", 1)}
    `, [ownership.id, workspace.timezone]),
    pool.query<{
      data_freshness_state: DataFreshnessStateV1;
      data_watermark_hash: string | null;
      max_observed_at: Date | null;
      accepted_at: Date;
      materialized_at: Date;
      stale_after: Date | null;
    }>(`
      SELECT CASE
          WHEN watermark.stale_after IS NOT NULL AND watermark.stale_after <= now() THEN 'stale'
          ELSE watermark.data_freshness_state
        END AS data_freshness_state,
        (
          SELECT materialization.data_watermark_hash
          FROM metric_materializations materialization
          WHERE materialization.data_watermark_id = watermark.id
            AND ${ownership.materializationSql("materialization", 2)}
          ORDER BY materialization.computed_at DESC
          LIMIT 1
        ) AS data_watermark_hash,
        watermark.max_observed_at, watermark.accepted_at,
        watermark.materialized_at, watermark.stale_after
      FROM signal_data_watermarks watermark
      WHERE watermark.workspace_id = $1::uuid
        AND ${ownership.watermarkSql("watermark", 2)}
      ORDER BY watermark.accepted_at DESC, watermark.id
    `, [workspace.id, ownership.id]),
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
        WHERE workspace_id = $1::uuid
          AND ${ownership.materializationSql("metric_materializations", 2)}
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
    `, [workspace.id, ownership.id]),
    pool.query<{ state: string; reason: string | null; evaluated_at: Date }>(`
      SELECT state, reason, evaluated_at
      FROM signal_interpretation_freshness
      WHERE workspace_id = $1::uuid
        AND ${ownership.interpretationScopeSql("data_scope", 2)}
      ORDER BY evaluated_at DESC, id
    `, [workspace.id, ownership.id])
  ]);
  const coverageRow = coverage.rows[0] ?? { date_from: null, date_through: null, mentions: 0 };
  const freshnessState = worstState(watermarks.rows.map((row) => row.data_freshness_state));
  const interpretationFreshness = {
    state: signalWorstResponseStateV1(interpretationStates.rows.map((row) => row.state)),
    reason: interpretationStates.rows.find((row) => row.state !== "fresh")?.reason ?? null,
    evaluated_at: maxInstant(interpretationStates.rows.map((row) => row.evaluated_at))
  };
  const responseState = signalWorstResponseStateV1([
    freshnessState,
    interpretationFreshness.state,
    ...metricStates.rows.map((row) => row.state)
  ]);
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
    read_scope: scope.descriptor,
    corpus: scope.legacyCorpus
      ? {
          id: scope.legacyCorpus.id,
          role: scope.legacyCorpus.role,
          status: scope.legacyCorpus.status,
          name: scope.legacyCorpus.name
        }
      : null,
    coverage: coverageRow,
    data_freshness: {
      state: freshnessState,
      data_through_at: maxInstant(watermarks.rows.map((row) => row.max_observed_at)),
      accepted_at: maxInstant(watermarks.rows.map((row) => row.accepted_at)),
      materialized_at: maxInstant(watermarks.rows.map((row) => row.materialized_at)),
      stale_after: minInstant(watermarks.rows.map((row) => row.stale_after)),
      watermark_hashes: watermarks.rows.map((row) => row.data_watermark_hash).filter(Boolean)
    },
    interpretation_freshness: interpretationFreshness,
    metric_groups: metricStates.rows.map((row) => ({
      key: row.metric_group_key,
      state: row.state,
      computed_at: row.computed_at.toISOString()
    })),
    visibility: { internal: isInternalUser, source_type: isInternalUser, quality_details: isInternalUser },
    state: responseState
  };
}

export async function loadSignalFacetsV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const predicate = buildSignalOperationalMentionReadPredicateV1(readScope, args.filter);
  const params = [...predicate.params];
  const featureDimensions = ["signal", "signal_lifecycle", "audience", "demographic", "journey_stage", "campaign", "product"];
  params.push(featureDimensions);
  const featureParameter = `$${params.length}::text[]`;
  params.push(args.workspace.id);
  const workspaceParameter = `$${params.length}::uuid`;
  const sourceTypeSelect = args.isInternalUser
    ? "UNION ALL SELECT id, 'source_type', lower(source_system) FROM filtered WHERE source_system IS NOT NULL"
    : "";
  const legacyScopeSelect = readScope.visibleSource === "legacy_corpus" ? `
      UNION ALL
      SELECT filtered.id, 'corpus_scope',
        CASE
          WHEN lower(COALESCE(source.scope, '')) = 'brand' THEN 'brand'
          WHEN lower(COALESCE(source.scope, '')) IN ('competitor', 'competitors') THEN 'competitor'
          WHEN lower(COALESCE(source.scope, '')) = 'category' THEN 'category'
          ELSE 'unknown'
        END
      FROM filtered
      JOIN mention_query_sources source ON source.mention_id = filtered.id
      UNION ALL
      SELECT filtered.id, 'corpus_scope',
        CASE
          WHEN lower(COALESCE(batch.entity_kind, batch.mention_type, '')) IN ('brand', 'primary_brand') THEN 'brand'
          WHEN lower(COALESCE(batch.entity_kind, batch.mention_type, '')) IN ('competitor', 'competitors') THEN 'competitor'
          WHEN lower(COALESCE(batch.entity_kind, batch.mention_type, '')) = 'category' THEN 'category'
          ELSE 'unknown'
        END
      FROM filtered
      JOIN import_batches batch ON batch.id = filtered.source_file_id`
    : "";
  const linkedMentionJoin = (alias: string) => (
    readScope.visibleSource === "legacy_corpus"
      ? `${alias}.id = filtered.id`
      : `${alias}.canonical_mention_id = filtered.id`
  );
  const result = await pool.query<{ dimension: SignalDimensionV1; key: string; count: number }>(`
    WITH filtered AS (
      SELECT m.id, m.study_corpus_id, m.source_file_id, m.sentiment_score, m.source_system,
        COALESCE(m.resolved_platform, m.platform) AS platform,
        m.language, m.country,
        lower(COALESCE(
          NULLIF(m.content_type, ''),
          'unknown'
        )) AS content_type
      FROM mentions m WHERE ${predicate.sql}
    ), latest_tb_feature AS (
      SELECT DISTINCT ON (filtered.id)
        filtered.id,
        feature.feature_value
      FROM filtered
      JOIN mentions coding_mention ON ${linkedMentionJoin("coding_mention")}
      JOIN record_feature_values feature ON feature.subject_id = coding_mention.id
      JOIN tb_analyses analysis
        ON analysis.id = feature.tb_analysis_id
        AND analysis.study_corpus_id = coding_mention.study_corpus_id
        AND analysis.status IN ('approved_by_im', 'approved_by_kam')
      WHERE feature.subject_type = 'mention'
        AND feature.feature_key = 'tb_coding'
      ORDER BY filtered.id, analysis.created_at DESC, feature.created_at DESC, feature.id DESC
    ), facet_values AS (
      SELECT id, 'platform'::text AS dimension, lower(platform) AS key FROM filtered WHERE platform IS NOT NULL
      UNION ALL SELECT id, 'country', lower(country) FROM filtered WHERE country IS NOT NULL
      UNION ALL SELECT id, 'language', lower(language) FROM filtered WHERE language IS NOT NULL
      UNION ALL SELECT id, 'content_format', lower(content_type) FROM filtered WHERE content_type IS NOT NULL
      UNION ALL SELECT id, 'conversation_role',
        CASE WHEN content_type = 'comment' THEN 'comment' ELSE 'root_post' END
      FROM filtered
      UNION ALL SELECT id, 'sentiment_polarity', CASE
        WHEN sentiment_score > 0.2 THEN 'positive' WHEN sentiment_score < -0.2 THEN 'negative'
        WHEN sentiment_score IS NULL THEN NULL ELSE 'neutral' END FROM filtered
      ${sourceTypeSelect}
      ${legacyScopeSelect}
      UNION ALL
      SELECT filtered.id, 'entity', lower(entity.canonical_name)
      FROM filtered
      JOIN mentions entity_mention ON ${linkedMentionJoin("entity_mention")}
      JOIN record_entity_links link ON link.subject_type = 'mention'
        AND link.subject_id = entity_mention.id
      JOIN intelligence_entities entity ON entity.id = link.entity_id AND entity.status = 'active'
      UNION ALL
      SELECT filtered.id, 'taxonomy', lower(COALESCE(tag.value, term.label))
      FROM filtered
      JOIN mentions tagged_mention ON ${linkedMentionJoin("tagged_mention")}
      JOIN record_tags tag ON tag.subject_type = 'mention' AND tag.subject_id = tagged_mention.id
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id AND term.status = 'active'
      WHERE tag.review_status = 'approved'
      UNION ALL
      SELECT filtered.id, profile.kind,
        lower(COALESCE(tag.value, term.label))
      FROM filtered
      JOIN mentions profile_mention ON ${linkedMentionJoin("profile_mention")}
      JOIN record_tags tag ON tag.subject_type = 'mention' AND tag.subject_id = profile_mention.id
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.workspace_id = ${workspaceParameter}
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.status = 'active'
      WHERE tag.review_status = 'approved'
      UNION ALL
      SELECT filtered.id, feature.feature_key, lower(trim(both '"' from feature.feature_value::text))
      FROM filtered
      JOIN mentions feature_mention ON ${linkedMentionJoin("feature_mention")}
      JOIN record_feature_values feature
        ON feature.subject_type = 'mention' AND feature.subject_id = feature_mention.id
      WHERE feature.feature_key = ANY(${featureParameter})
      UNION ALL
      SELECT latest.id, 'tb_polarity', lower(coding.item->>'polarity')
      FROM latest_tb_feature latest
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(latest.feature_value->'codings', '[]'::jsonb)) coding(item)
      UNION ALL
      SELECT latest.id, 'tb_layer', lower(coding.item->>'layer')
      FROM latest_tb_feature latest
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(latest.feature_value->'codings', '[]'::jsonb)) coding(item)
      UNION ALL
      SELECT latest.id, 'observed_signal', lower(signal.value)
      FROM latest_tb_feature latest
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(latest.feature_value->'codings', '[]'::jsonb)) coding(item)
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(coding.item->'emergent_tags', '[]'::jsonb)) signal(value)
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
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const ownership = operationalDbScope(readScope);
  const filtersHash = buildSignalOperationalMentionReadPredicateV1(readScope, args.filter).filters_hash;
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
    WHERE workspace_id = $1::uuid
      AND ${ownership.materializationSql("metric_materializations", 2)}
      AND filters_hash = $3
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY metric_key, metric_version, computed_at DESC
  `, [args.workspace.id, ownership.id, filtersHash]);
  const interpretationStates = await pool.query<{
    metric_group_key: string;
    state: string;
    reason: string | null;
    evaluated_at: Date;
  }>(`
    SELECT metric_group_key, state, reason, evaluated_at
    FROM signal_interpretation_freshness
    WHERE workspace_id = $1::uuid AND filters_hash = $3
      AND ${ownership.interpretationScopeSql("data_scope", 2)}
  `, [args.workspace.id, ownership.id, filtersHash]);
  const byMetric = new Map(states.rows.map((row) => [`${row.metric_key}@${row.metric_version}`, row]));
  const byGroupInterpretation = new Map(interpretationStates.rows.map((row) => [row.metric_group_key, row]));
  const groups = SIGNAL_METRIC_CATALOG_V1.map((group) => ({
    key: group.key,
    name: group.name,
    interpretation: {
      state: byGroupInterpretation.get(group.key)?.state ?? "not_available",
      reason: byGroupInterpretation.get(group.key)?.reason ?? "interpretation_not_available",
      evaluated_at: byGroupInterpretation.get(group.key)?.evaluated_at.toISOString() ?? null
    },
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
  }));
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    filters_hash: filtersHash,
    state: signalWorstResponseStateV1(groups.flatMap((group) => [
      ...group.metrics.map((metric) => metric.state),
      group.interpretation.state
    ])),
    groups
  };
}

export async function loadSignalInterpretationsV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const ownership = operationalDbScope(readScope);
  const filtersHash = buildSignalOperationalMentionReadPredicateV1(readScope, args.filter).filters_hash;
  const result = await pool.query<{
    metric_group_key: string;
    metric_group_version: number;
    status: string;
    review_status: string;
    generated_by: string;
    data_watermark_hash: string;
    data_scope: JsonRecord;
    content: JsonRecord;
    created_at: Date;
  }>(`
    SELECT DISTINCT ON (interpretation.metric_group_key)
      interpretation.metric_group_key, interpretation.metric_group_version,
      CASE
        WHEN freshness.data_watermark_hash IS DISTINCT FROM interpretation.data_watermark_hash
          THEN 'stale'
        ELSE interpretation.status
      END AS status,
      interpretation.review_status, interpretation.generated_by,
      interpretation.data_watermark_hash, interpretation.data_scope,
      interpretation.content, interpretation.created_at
    FROM metric_interpretations interpretation
    LEFT JOIN signal_interpretation_freshness freshness
      ON freshness.latest_interpretation_id = interpretation.id
    WHERE interpretation.workspace_id = $1::uuid
      AND ${ownership.interpretationRowSql("interpretation", 2)}
      AND interpretation.filters_hash = $3
      AND (
        interpretation.review_status IN ('auto_published', 'approved')
        OR $4::boolean = true
      )
    ORDER BY interpretation.metric_group_key, interpretation.created_at DESC, interpretation.id
  `, [args.workspace.id, ownership.id, filtersHash, args.isInternalUser]);
  const byGroup = new Map(result.rows.map((row) => [row.metric_group_key, row]));
  const interpretations = SIGNAL_METRIC_CATALOG_V1.map((group) => {
    const row = byGroup.get(group.key);
    if (!row) return {
      metric_group_key: group.key,
      metric_group_version: 1,
      state: "not_available",
      reason: "interpretation_not_available",
      interpretation: null
    };
    return {
      metric_group_key: row.metric_group_key,
      metric_group_version: row.metric_group_version,
      state: row.status,
      review_status: row.review_status,
      generated_by: row.generated_by,
      data_watermark_hash: row.data_watermark_hash,
      data_scope: args.isInternalUser ? row.data_scope : undefined,
      generated_at: row.created_at.toISOString(),
      interpretation: row.content
    };
  });
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    filters_hash: filtersHash,
    state: signalWorstResponseStateV1(interpretations.map((item) => item.state)),
    interpretations
  };
}

export async function loadSignalSeriesV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  metricKey: string;
  metricVersion: number;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const metric = requireVisibleMetric(args.metricKey, args.metricVersion, args.isInternalUser);
  assertMetricFilterDimensions(metric.key, metric.version, args.filter);
  const rows = await loadMaterializationRows(args.workspace, args.filter, metric.key, metric.version, args.readScope);
  if (rows.length === 0) return queueMissingMaterialization(args.workspace, args.filter, [metric.key], args.readScope);
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
  readScope?: SignalOperationalReadScopeV1;
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
  const rows = await loadMaterializationRows(args.workspace, args.filter, metric.key, metric.version, args.readScope);
  if (rows.length === 0) return queueMissingMaterialization(args.workspace, args.filter, [metric.key], args.readScope);
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
  readScope?: SignalOperationalReadScopeV1;
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
  const currentValue = summarizeSignalMetricPointsV1(current.payload.points, metric.key, metric.unit);
  const comparisonValue = summarizeSignalMetricPointsV1(comparison.payload.points, metric.key, metric.unit);
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

export type SignalMentionTagV1 = {
  taxonomy_key: string;
  taxonomy_name: string;
  term_key: string;
  label: string;
  value: string | null;
  score: number | null;
};

export type SignalMentionEntityV1 = {
  type: string;
  name: string;
  relation: string;
  confidence: string | null;
};

export type SignalMentionFeatureV1 = {
  key: string;
  value: unknown;
  value_type: string | null;
  confidence: string | null;
};

export type SignalMentionAttributionV1 = {
  scope: "brand" | "competitor" | "category" | "unknown";
  label: string;
};

export type SignalMentionTbCodingV1 = {
  finding_id: string | null;
  polarity: "trigger" | "barrier" | "mixed" | "irrelevant" | null;
  layer: "personal" | "psicologico" | "social" | "cultural" | null;
  intensity_score: number | null;
  emergent_tags: string[];
  ambiguous: boolean;
};

export type SignalMentionTbClassificationV1 = {
  contract: string;
  analysis_id: string;
  analysis_status: string | null;
  codings: SignalMentionTbCodingV1[];
};

export type SignalMentionRecordV1 = {
  subject_id: string;
  occurred_at: string;
  text_snippet: string;
  title: string | null;
  url: string | null;
  platform: string | null;
  language: string | null;
  country: string | null;
  content_type: string;
  conversation_role: "root_post" | "comment";
  sentiment: "positive" | "neutral" | "negative" | null;
  sentiment_score: number | null;
  engagement: JsonRecord;
  interaction_count: number;
  thread_key: string;
  tags: SignalMentionTagV1[];
  entities: SignalMentionEntityV1[];
  features: SignalMentionFeatureV1[];
  attribution: SignalMentionAttributionV1[];
  tb_classification: SignalMentionTbClassificationV1 | null;
};

export type SignalMentionsPayloadV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  read_scope?: SignalOperationalReadScopeV1["descriptor"];
  metric_key: string;
  filters_hash: string;
  total_count: number;
  records: SignalMentionRecordV1[];
  page: {
    limit: number;
    offset: number;
    next_cursor: string | null;
    next_offset: number | null;
  };
};

export type SignalMentionSortV1 = {
  field: "published" | "platform" | "conversation_role" | "engagement";
  direction: "asc" | "desc";
};

export function signalMentionsServingTokensV1(args: {
  servingScope: SignalServingScopeDescriptorV1;
  filter: SignalFilterV1;
  sort?: SignalMentionSortV1;
}) {
  const normalizedFiltersHash = signalFiltersHashV1(args.filter);
  const normalizedSortHash = sha256Text(JSON.stringify([
    args.sort?.field ?? "published",
    args.sort?.direction ?? "desc"
  ]));
  return {
    normalized_filters_hash: normalizedFiltersHash,
    normalized_sort_hash: normalizedSortHash,
    cursor_isolation_hash: signalServingScopeCursorIsolationHashV1({
      scope: args.servingScope,
      normalized_filters_hash: normalizedFiltersHash,
      normalized_sort_hash: normalizedSortHash
    }),
    etag_seed: signalServingScopeEtagSeedV1({
      scope: args.servingScope,
      normalized_filters_hash: normalizedFiltersHash,
      normalized_sort_hash: normalizedSortHash
    })
  };
}

type SignalMentionRowV1 = {
  subject_id: string;
  occurred_at: Date;
  text_snippet: string | null;
  title: string | null;
  url: string | null;
  platform: string | null;
  language: string | null;
  country: string | null;
  content_type: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  sentiment_score: string | number | null;
  engagement: unknown;
  thread_key: string;
  tags: unknown;
  entities: unknown;
  features: unknown;
  attribution: unknown;
  tb_classification: unknown;
  tb_analysis_status: string | null;
  total_count: number;
};

async function executeSignalMentionDrillDownV1(args: {
  plan: ReturnType<typeof buildSignalMentionDrillDownPlanV1>;
  metricKey: string;
  filtersHash: string;
  limit?: number;
  offset?: number;
  sort?: SignalMentionSortV1;
  readScope?: SignalOperationalReadScopeV1["descriptor"];
  queryable?: SignalServingQueryable;
}): Promise<SignalMentionsPayloadV1> {
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
  const offset = Math.max(0, Math.min(100_000, Math.floor(args.offset ?? 0)));
  const result = await (args.queryable ?? pool).query<SignalMentionRowV1>(args.plan.sql, args.plan.params);
  const hasNext = result.rows.length > limit;
  const records = result.rows.slice(0, limit).map((row) => ({
    subject_id: row.subject_id,
    occurred_at: row.occurred_at.toISOString(),
    text_snippet: row.text_snippet ?? "",
    title: clientSafeMentionTitle(row.title),
    url: row.url,
    platform: row.platform,
    language: clientSafeMentionScalar(row.language),
    country: clientSafeMentionScalar(row.country),
    content_type: row.content_type ?? "unknown",
    conversation_role: row.content_type === "comment" ? "comment" as const : "root_post" as const,
    sentiment: row.sentiment,
    sentiment_score: numeric(row.sentiment_score),
    engagement: isRecord(row.engagement) ? row.engagement : {},
    interaction_count: mentionInteractionTotal(row.engagement),
    thread_key: row.thread_key,
    tags: mentionTags(row.tags),
    entities: mentionEntities(row.entities),
    features: mentionFeatures(row.features),
    attribution: mentionAttribution(row.attribution),
    tb_classification: mentionTbClassification(
      row.tb_classification,
      row.tb_analysis_status
    )
  }));
  const last = records.at(-1);
  const defaultCursorOrder = !args.sort
    || (args.sort.field === "published" && args.sort.direction === "desc");
  const nextCursor = defaultCursorOrder && hasNext && last ? encodeSignalDrillDownCursorV1({
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: args.metricKey,
    filters_hash: args.filtersHash,
    direction: "next",
    sort: { occurred_at: last.occurred_at, subject_id: last.subject_id }
  }) : null;
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    ...(args.readScope ? { read_scope: args.readScope } : {}),
    metric_key: args.metricKey,
    filters_hash: args.filtersHash,
    total_count: result.rows[0]?.total_count ?? 0,
    records,
    page: {
      limit,
      offset,
      next_cursor: nextCursor,
      next_offset: hasNext ? offset + limit : null
    }
  };
}

export async function loadSignalMentionsV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  servingScope?: SignalServingScopeDescriptorV1;
  filter: SignalFilterV1;
  studyCorpusIds?: string[];
  populationId?: string;
  metricKey?: string;
  subjectIds?: string[];
  cursor?: string | null;
  limit?: number;
  offset?: number;
  sort?: SignalMentionSortV1;
  isInternalUser: boolean;
  queryable?: SignalServingQueryable;
}): Promise<SignalMentionsPayloadV1> {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  if (args.servingScope) {
    if (args.servingScope.workspace_id !== args.workspace.id
      || args.servingScope.module_key !== "mentions") {
      throw new SignalBackendContractError(
        "invalid_filter",
        "Mentions serving scope does not belong to this workspace/module.",
        { field: "serving_scope" }
      );
    }
    if (!args.readScope
      || args.readScope.visibleSource !== "governed_population"
      || args.readScope.population?.id !== args.servingScope.population.population_id) {
      throw new SignalBackendContractError(
        "not_available",
        "Mentions serving scope and governed population do not match.",
        { reason: "mentions_serving_population_mismatch" }
      );
    }
  }
  const metricKey = args.metricKey ?? "conversation.volume";
  requireVisibleMetric(metricKey, 1, args.isInternalUser);
  if (args.readScope && (args.populationId || args.studyCorpusIds?.length)) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Resolved operational scope cannot be combined with an explicit data scope.",
      { field: "read_scope" }
    );
  }
  if (args.populationId && args.studyCorpusIds?.length) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Mentions serving accepts either a governed population or study corpora, not both.",
      { field: "population_id" }
    );
  }
  const operationalScope = args.readScope
    ? requireSignalOperationalReadScopeV1(args.workspace, args.readScope)
    : null;
  const resolvedPopulationId = operationalScope?.visibleSource === "governed_population"
    ? operationalScope.population?.id
    : args.populationId;
  const studyCorpusIds = resolvedPopulationId
    ? []
    : args.studyCorpusIds?.length
      ? requireWorkspaceCorpusIds(args.workspace, args.studyCorpusIds)
      : operationalScope?.legacyCorpus
        ? [operationalScope.legacyCorpus.id]
        : [requireSignalOperationalReadScopeV1(args.workspace).legacyCorpus!.id];
  const filtersHash = args.servingScope
    ? signalMentionsServingTokensV1({
        servingScope: args.servingScope,
        filter: args.filter,
        sort: args.sort
      }).cursor_isolation_hash
    : signalFiltersHashV1(args.filter);
  const decoded = args.cursor ? decodeSignalDrillDownCursorV1(args.cursor) : null;
  if (decoded && (decoded.metric_key !== metricKey || decoded.filters_hash !== filtersHash)) {
    throw new SignalBackendContractError("invalid_filter", "Drill-down cursor does not match the active metric/filter.", {
      field: "cursor"
    });
  }
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: args.filter,
    ...(resolvedPopulationId
      ? { population_id: resolvedPopulationId }
      : { study_corpus_ids: studyCorpusIds }),
    workspace_id: args.workspace.id,
    metric_key: metricKey,
    ...(args.subjectIds ? { subject_ids: args.subjectIds } : {}),
    limit: args.limit,
    offset: args.offset,
    order_by: args.sort,
    ...(decoded ? { cursor: decoded.sort } : {})
  });
  return executeSignalMentionDrillDownV1({
    plan,
    metricKey,
    filtersHash,
    limit: args.limit,
    offset: args.offset,
    sort: args.sort,
    queryable: args.queryable,
    ...(operationalScope ? { readScope: operationalScope.descriptor } : {})
  });
}

export async function loadSignalWorkspaceCanonicalMentionsV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  metricKey?: string;
  subjectIds?: string[];
  cursorScopeHash?: string;
  cursor?: string | null;
  limit?: number;
  offset?: number;
  sort?: SignalMentionSortV1;
  isInternalUser: boolean;
}): Promise<SignalMentionsPayloadV1> {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const metricKey = args.metricKey ?? "conversation.volume";
  requireVisibleMetric(metricKey, 1, args.isInternalUser);
  const baseFiltersHash = signalFiltersHashV1(args.filter);
  const filtersHash = args.cursorScopeHash
    ? `sha256:${createHash("sha256").update(`${baseFiltersHash}:${args.cursorScopeHash}`, "utf8").digest("hex")}`
    : baseFiltersHash;
  const decoded = args.cursor ? decodeSignalDrillDownCursorV1(args.cursor) : null;
  if (decoded && (decoded.metric_key !== metricKey || decoded.filters_hash !== filtersHash)) {
    throw new SignalBackendContractError("invalid_filter", "Drill-down cursor does not match the active metric/filter.", {
      field: "cursor"
    });
  }
  if (args.subjectIds && args.subjectIds.length === 0) {
    return {
      contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      metric_key: metricKey,
      filters_hash: filtersHash,
      total_count: 0,
      records: [],
      page: {
        limit: Math.max(1, Math.min(100, Math.floor(args.limit ?? 50))),
        offset: Math.max(0, Math.min(100_000, Math.floor(args.offset ?? 0))),
        next_cursor: null,
        next_offset: null
      }
    };
  }
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: args.filter,
    workspace_canonical: true,
    workspace_id: args.workspace.id,
    metric_key: metricKey,
    ...(args.subjectIds ? { subject_ids: args.subjectIds } : {}),
    limit: args.limit,
    offset: args.offset,
    order_by: args.sort,
    ...(decoded ? { cursor: decoded.sort } : {})
  });
  return executeSignalMentionDrillDownV1({
    plan,
    metricKey,
    filtersHash,
    limit: args.limit,
    offset: args.offset,
    sort: args.sort
  });
}

export async function loadSignalMentionsModuleShadowV1(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  isInternalUser: boolean;
  queryable?: SignalServingQueryable;
}) {
  const legacyScope = await resolveSignalOperationalReadScopeV1(args.workspace, {
    mode: "legacy",
    queryable: args.queryable
  });
  const corpus = legacyScope.legacyCorpus!;
  const legacyPredicate = buildSignalMentionReadPredicateV1(
    args.filter,
    [corpus.id],
    args.workspace.id
  );
  const governedPredicate = buildSignalPopulationMentionReadPredicateV1(
    args.filter,
    args.populationId,
    args.workspace.id
  );
  const legacySet = await loadMentionShadowSet(legacyPredicate, args.queryable);
  const governedSet = await loadMentionShadowSet(governedPredicate, args.queryable);
  const legacyFirstPage = await loadSignalMentionsV1({
    workspace: args.workspace,
    readScope: legacyScope,
    filter: args.filter,
    limit: 100,
    isInternalUser: args.isInternalUser,
    queryable: args.queryable
  });
  const governedFirstPage = await loadSignalMentionsV1({
    workspace: args.workspace,
    populationId: args.populationId,
    filter: args.filter,
    limit: 100,
    isInternalUser: args.isInternalUser,
    queryable: args.queryable
  });
  const legacySecondPage = legacyFirstPage.page.next_cursor
    ? await loadSignalMentionsV1({
        workspace: args.workspace,
        readScope: legacyScope,
        filter: args.filter,
        cursor: legacyFirstPage.page.next_cursor,
        limit: 100,
        isInternalUser: args.isInternalUser,
        queryable: args.queryable
      })
    : null;
  const governedSecondPage = governedFirstPage.page.next_cursor
    ? await loadSignalMentionsV1({
        workspace: args.workspace,
        populationId: args.populationId,
        filter: args.filter,
        cursor: governedFirstPage.page.next_cursor,
        limit: 100,
        isInternalUser: args.isInternalUser,
        queryable: args.queryable
      })
    : null;
  const legacy = summarizeMentionReaderShadow(
    legacySet,
    legacyFirstPage,
    legacySecondPage
  );
  const governed = summarizeMentionReaderShadow(
    governedSet,
    governedFirstPage,
    governedSecondPage
  );
  const parity = legacy.total_count === governed.total_count
    && legacy.canonical_ids_hash === governed.canonical_ids_hash
    && legacy.period_start === governed.period_start
    && legacy.period_end === governed.period_end
    && legacy.first_result_id === governed.first_result_id;
  return {
    reader: "loadSignalMentionsV1",
    set_comparison: "sql_full_canonical_hash" as const,
    legacy,
    governed,
    parity,
    reconciled: parity,
    state: parity ? "exact" as const : "diverged" as const
  };
}

/**
 * Executes only the population-owned Mentions reader proof, including the
 * stable first/second-page cursor check. It intentionally has no operational
 * read scope and therefore cannot fall back to a legacy corpus or pointer.
 */
export async function loadSignalMentionsGovernedModuleProofV1(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  isInternalUser: boolean;
  queryable?: SignalServingQueryable;
}) {
  const governedSet = await loadMentionShadowSet(
    buildSignalPopulationMentionReadPredicateV1(
      args.filter,
      args.populationId,
      args.workspace.id
    ),
    args.queryable
  );
  const firstPage = await loadSignalMentionsV1({
    workspace: args.workspace,
    populationId: args.populationId,
    filter: args.filter,
    limit: 100,
    isInternalUser: args.isInternalUser,
    queryable: args.queryable
  });
  const secondPage = firstPage.page.next_cursor
    ? await loadSignalMentionsV1({
        workspace: args.workspace,
        populationId: args.populationId,
        filter: args.filter,
        cursor: firstPage.page.next_cursor,
        limit: 100,
        isInternalUser: args.isInternalUser,
        queryable: args.queryable
      })
    : null;
  return summarizeMentionReaderShadow(governedSet, firstPage, secondPage);
}

type MentionShadowSet = {
  total_count: number;
  canonical_count: number;
  canonical_ids_hash: string;
  canonical_id_sample: string[];
  period_start: string | null;
  period_end: string | null;
};

async function loadMentionShadowSet(
  predicate: ReturnType<typeof buildSignalMentionReadPredicateV1>,
  queryable?: SignalServingQueryable
): Promise<MentionShadowSet> {
  const params = [...predicate.params, predicate.normalized_filter.timezone];
  const timezoneParameter = `$${params.length}`;
  const result = await (queryable ?? pool).query<MentionShadowSet>(`
    WITH scoped AS (
      SELECT
        m.id,
        COALESCE(m.canonical_mention_id, m.id) AS canonical_id,
        (m.published_at AT TIME ZONE ${timezoneParameter})::date AS local_date
      FROM mentions m
      WHERE ${predicate.sql}
    ), canonical AS (
      SELECT DISTINCT canonical_id FROM scoped
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS total_count,
      (SELECT count(*)::int FROM canonical) AS canonical_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(canonical_id::text, ',' ORDER BY canonical_id::text)
        FROM canonical
      ), ''), 'UTF8')), 'hex') AS canonical_ids_hash,
      COALESCE((
        SELECT array_agg(canonical_id::text ORDER BY canonical_id::text)
        FROM (SELECT canonical_id FROM canonical ORDER BY canonical_id LIMIT 5) sample
      ), ARRAY[]::text[]) AS canonical_id_sample,
      (SELECT min(local_date)::text FROM scoped) AS period_start,
      (SELECT max(local_date)::text FROM scoped) AS period_end
  `, params);
  return result.rows[0] ?? {
    total_count: 0,
    canonical_count: 0,
    canonical_ids_hash: hashShadowIds([]),
    canonical_id_sample: [],
    period_start: null,
    period_end: null
  };
}

function summarizeMentionReaderShadow(
  set: MentionShadowSet,
  firstPage: SignalMentionsPayloadV1,
  secondPage: SignalMentionsPayloadV1 | null
) {
  const firstIds = new Set(firstPage.records.map((record) => record.subject_id));
  const secondIds = secondPage?.records.map((record) => record.subject_id) ?? [];
  const cursorOverlap = secondIds.filter((id) => firstIds.has(id)).length;
  const requiresCursor = set.total_count > firstPage.page.limit;
  const cursorValid = firstPage.total_count === set.total_count
    && (requiresCursor ? firstPage.page.next_cursor !== null : firstPage.page.next_cursor === null)
    && (!requiresCursor || Boolean(secondPage))
    && cursorOverlap === 0;
  return {
    ...set,
    first_page_count: firstPage.records.length,
    second_page_count: secondPage?.records.length ?? 0,
    cursor_rows_checked: firstPage.records.length + (secondPage?.records.length ?? 0),
    cursor_overlap_count: cursorOverlap,
    cursor_valid: cursorValid,
    next_cursor_present: firstPage.page.next_cursor !== null,
    next_cursor_hash: firstPage.page.next_cursor
      ? hashShadowIds([firstPage.page.next_cursor])
      : null,
    first_result_id: firstPage.records[0]?.subject_id ?? null
  };
}

function hashShadowIds(ids: string[]) {
  return `sha256:${createHash("sha256").update(ids.join(","), "utf8").digest("hex")}`;
}

export async function loadSignalWorkspaceCanonicalMentionByIdV1(args: {
  workspace: ResolvedSignalWorkspace;
  filter: SignalFilterV1;
  mentionId: string;
  isInternalUser: boolean;
}) {
  const payload = await loadSignalWorkspaceCanonicalMentionsV1({
    workspace: args.workspace,
    filter: args.filter,
    subjectIds: [args.mentionId],
    limit: 1,
    isInternalUser: args.isInternalUser
  });
  if (payload.records[0]) return payload.records[0];

  const scoped = await pool.query<{
    canonical_mention_id: string;
    occurred_on: string;
  }>(
    `SELECT
       canonical.id::text AS canonical_mention_id,
       (canonical.published_at AT TIME ZONE $3)::date::text AS occurred_on
     FROM mentions requested
     JOIN mentions canonical
       ON canonical.id = COALESCE(requested.canonical_mention_id, requested.id)
      AND canonical.workspace_id = requested.workspace_id
     WHERE requested.workspace_id = $1::uuid
       AND requested.id = $2::uuid
       AND canonical.canonical_mention_id = canonical.id
     LIMIT 1`,
    [args.workspace.id, args.mentionId, args.workspace.timezone]
  );
  const mention = scoped.rows[0];
  if (!mention) return null;
  const focusedFilter: SignalFilterV1 = {
    ...args.filter,
    date_range: { start: mention.occurred_on, end: mention.occurred_on },
    dimensions: {},
    search_query: undefined,
    text_search: undefined
  };
  const fallback = await loadSignalWorkspaceCanonicalMentionsV1({
    workspace: args.workspace,
    filter: focusedFilter,
    subjectIds: [mention.canonical_mention_id],
    limit: 1,
    isInternalUser: args.isInternalUser
  });
  return fallback.records[0] ?? null;
}

export async function loadSignalMentionByIdV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  mentionId: string;
  isInternalUser: boolean;
}) {
  const payload = await loadSignalMentionsV1({
    workspace: args.workspace,
    readScope: args.readScope,
    filter: args.filter,
    subjectIds: [args.mentionId],
    limit: 1,
    isInternalUser: args.isInternalUser
  });
  if (payload.records[0]) return payload.records[0];

  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const ownership = operationalDbScope(readScope);
  const scoped = await pool.query<{
    canonical_mention_id: string;
    occurred_on: string;
  }>(
    `SELECT
       canonical.id::text AS canonical_mention_id,
       (canonical.published_at AT TIME ZONE $3)::date::text AS occurred_on
     FROM mentions requested
     JOIN mentions canonical
       ON canonical.id = COALESCE(requested.canonical_mention_id, requested.id)
      AND canonical.workspace_id = requested.workspace_id
     WHERE requested.workspace_id = $1::uuid
       AND requested.id = $2::uuid
       AND ${ownership.mentionSql("canonical", 4)}
     LIMIT 1`,
    [args.workspace.id, args.mentionId, args.workspace.timezone, ownership.id]
  );
  const mention = scoped.rows[0];
  if (!mention) return null;
  const focusedFilter: SignalFilterV1 = {
    ...args.filter,
    date_range: { start: mention.occurred_on, end: mention.occurred_on },
    dimensions: {},
    search_query: undefined
  };
  const fallback = await loadSignalMentionsV1({
    workspace: args.workspace,
    readScope,
    filter: focusedFilter,
    subjectIds: [mention.canonical_mention_id],
    limit: 1,
    isInternalUser: args.isInternalUser
  });
  return fallback.records[0] ?? null;
}

function requireWorkspaceCorpusIds(
  workspace: ResolvedSignalWorkspace,
  requested: string[]
) {
  const allowed = new Set(workspace.corpora.map((corpus) => corpus.id));
  const normalized = Array.from(new Set(requested));
  if (normalized.length === 0 || normalized.some((id) => !allowed.has(id))) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Requested mention scope is not part of this workspace.",
      { field: "study_corpus_ids" }
    );
  }
  return normalized;
}

export async function loadSignalLineageV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  metricKey?: string | null;
  isInternalUser: boolean;
}) {
  assertVisibleFilterDimensions(args.filter, args.isInternalUser);
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const ownership = operationalDbScope(readScope);
  const filtersHash = buildSignalOperationalMentionReadPredicateV1(readScope, args.filter).filters_hash;
  const params: unknown[] = [args.workspace.id, ownership.id, filtersHash];
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
      AND ${ownership.materializationSql("materialization", 2)}
      AND materialization.filters_hash = $3
      AND (materialization.cache_scope <> 'ad_hoc' OR materialization.expires_at > now())
      ${metricPredicate}
    ORDER BY materialization.metric_key, materialization.period_start
    LIMIT 500
  `, params);
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    read_scope: readScope.descriptor,
    corpus_id: readScope.legacyCorpus?.id ?? null,
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
  metricVersion: number,
  readScope?: SignalOperationalReadScopeV1
): Promise<SignalServingMaterializationRowV1[]> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const ownership = operationalDbScope(scope);
  const predicate = buildSignalOperationalMentionReadPredicateV1(scope, filter);
  const result = await pool.query<SignalServingMaterializationRowV1>(`
    SELECT metric_key, metric_version, metric_group_key,
      period_start::text, period_end::text, value, denominator, sample_size,
      typed_payload, materialization_state, quality_state, data_watermark,
      data_watermark_hash, computed_at, stale_after
    FROM metric_materializations
    WHERE workspace_id = $1::uuid
      AND ${ownership.materializationSql("metric_materializations", 2)}
      AND metric_key = $3 AND metric_version = $4
      AND filters_hash = $5 AND granularity = $6
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY period_start
  `, [workspace.id, ownership.id, metricKey, metricVersion, predicate.filters_hash, filter.granularity]);
  if (result.rows.length > 0 && result.rows.every(isUsableMaterializationRow)) {
    return result.rows;
  }

  const metric = signalMetricDefinitionV1(metricKey, metricVersion);
  if (!metric) return [];
  const liveRows = await loadLiveMaterializationRows(workspace, filter, metric, scope);
  if (
    liveRows.length > 0 &&
    isSignalAdHocMaterializationEnabled() &&
    isDataOsQueueConfigured()
  ) {
    const job = buildSignalAdHocMaterializationJobV1({
      workspace_id: workspace.id,
      ...operationalMaterializationScopeV1(scope),
      filter,
      metric_keys: [metric.key]
    });
    void enqueueSignalAdHocMaterialization(job.data, job.job_id).catch(() => {
      console.warn("Signal ad hoc cache warm-up could not be queued.", {
        metric_key: metric.key
      });
    });
  }
  return liveRows;
}

function isUsableMaterializationRow(row: SignalServingMaterializationRowV1) {
  if (row.materialization_state === "stale") return false;
  return row.stale_after === null || row.stale_after.getTime() > Date.now();
}

/**
 * Narrow read-through used by specialized Signal surfaces. It preserves the
 * canonical materialization-first behavior while allowing arbitrary filters to
 * fall back to the same live SQL plans as Brand Monitoring.
 */
export async function loadSignalServingMaterializationRowsV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  metricKey: string;
  metricVersion?: number;
}) {
  return loadMaterializationRows(
    args.workspace,
    args.filter,
    args.metricKey,
    args.metricVersion ?? 1,
    args.readScope
  );
}

async function loadLiveMaterializationRows(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  metric: SignalMetricDefinitionV1,
  readScope?: SignalOperationalReadScopeV1
): Promise<SignalServingMaterializationRowV1[]> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const ownership = operationalDbScope(scope);
  const materializationScope = operationalMaterializationScopeV1(scope);
  const plan = buildSignalMetricMaterializationPlanV1({
    metric_key: metric.key,
    metric_version: metric.version,
    filter,
    ...(materializationScope.kind === "governed_population"
      ? { population_id: materializationScope.population_id }
      : { study_corpus_ids: [materializationScope.study_corpus_id] }),
    workspace_id: workspace.id
  });
  const [computed, watermarkResult] = await Promise.all([
    pool.query<SignalMaterializationRowV1>(plan.sql, plan.params),
    pool.query<LiveWatermarkRow>(`
      SELECT corpus_revision, last_source_sync_run_id::text,
        last_import_batch_id::text, max_observed_at, accepted_at,
        materialized_at, data_freshness_state, stale_after
      FROM signal_data_watermarks
      WHERE workspace_id = $1::uuid
        AND ${ownership.watermarkSql("signal_data_watermarks", 2)}
      ORDER BY accepted_at DESC, id
    `, [workspace.id, ownership.id])
  ]);
  if (watermarkResult.rows.length === 0) return [];

  const watermark = combinedLiveWatermark(workspace, scope, watermarkResult.rows);
  const watermarkHash = dataWatermarkHashV1(watermark);
  const freshness = combinedLiveFreshness(watermarkResult.rows);
  const staleAfter = earliestLiveStaleAfter(watermarkResult.rows);
  const computedAt = new Date(watermark.materialized_at);
  const rows = computed.rows.length > 0
    ? computed.rows
    : [emptyLiveMetricRow(filter, metric)];

  return rows.map((row) => {
    const quality = evaluateSignalMetricQualityV1({
      metric,
      row,
      data_freshness: freshness
    });
    return {
      metric_key: metric.key,
      metric_version: metric.version,
      metric_group_key: metric.group,
      period_start: row.period_start,
      period_end: row.period_end,
      value: row.value,
      denominator: row.denominator,
      sample_size: Number(row.sample_size),
      typed_payload: {
        ...row.typed_payload,
        quality_rule_results: quality.results,
        serving_mode: "live_read_through"
      },
      materialization_state: effectiveLiveState(
        row.materialization_state,
        freshness,
        quality.state
      ),
      quality_state: quality.state,
      data_watermark: watermark,
      data_watermark_hash: watermarkHash,
      computed_at: computedAt,
      stale_after: staleAfter
    };
  });
}

function emptyLiveMetricRow(
  filter: SignalFilterV1,
  metric: SignalMetricDefinitionV1
): SignalMaterializationRowV1 {
  return {
    period_start: filter.date_range.start,
    period_end: filter.date_range.end,
    value: null,
    denominator: null,
    sample_size: 0,
    typed_payload: {
      kind: metric.key.endsWith(".share") || metric.key.endsWith(".volume")
        ? "breakdown"
        : "scalar",
      buckets: []
    },
    materialization_state: "not_available",
    quality_state: "unknown"
  };
}

function combinedLiveWatermark(
  workspace: ResolvedSignalWorkspace,
  readScope: SignalOperationalReadScopeV1,
  rows: LiveWatermarkRow[]
) {
  const acceptedAt = new Date(Math.max(...rows.map((row) => row.accepted_at.getTime())));
  const materializedAt = new Date(Math.max(
    acceptedAt.getTime(),
    ...rows.map((row) => row.materialized_at.getTime())
  ));
  const observed = rows.flatMap((row) => row.max_observed_at ? [row.max_observed_at.getTime()] : []);
  const maxObserved = observed.length
    ? new Date(Math.min(Math.max(...observed), acceptedAt.getTime()))
    : null;
  return validateDataWatermarkV1({
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace_id: workspace.id,
    read_scope: readScope.visibleSource,
    corpus_id: readScope.visibleSource === "legacy_corpus"
      ? readScope.legacyCorpus?.id ?? null
      : null,
    corpus_revision: readScope.visibleSource === "legacy_corpus"
      ? Math.max(...rows.map((row) => row.corpus_revision))
      : null,
    population_id: readScope.visibleSource === "governed_population"
      ? readScope.population?.id ?? null
      : null,
    population_version: readScope.visibleSource === "governed_population"
      ? readScope.population?.version ?? null
      : null,
    population_definition_hash: readScope.visibleSource === "governed_population"
      ? readScope.population?.definition_hash ?? null
      : null,
    source_sync_run_ids: Array.from(new Set(rows.flatMap((row) => [
      row.last_source_sync_run_id,
      row.last_import_batch_id
    ]).filter((id): id is string => Boolean(id)))),
    data_through_at: maxObserved?.toISOString() ?? null,
    accepted_at: acceptedAt.toISOString(),
    materialized_at: materializedAt.toISOString()
  });
}

function combinedLiveFreshness(rows: LiveWatermarkRow[]): DataFreshnessStateV1 {
  const now = new Date();
  if (rows.some((row) => row.data_freshness_state === "stale" || (row.stale_after && row.stale_after <= now))) {
    return "stale";
  }
  if (rows.some((row) => row.data_freshness_state === "partial" || row.data_freshness_state === "not_available")) {
    return "partial";
  }
  return "fresh";
}

function earliestLiveStaleAfter(rows: LiveWatermarkRow[]) {
  const values = rows.flatMap((row) => row.stale_after ? [row.stale_after.getTime()] : []);
  return values.length ? new Date(Math.min(...values)) : null;
}

function effectiveLiveState(
  metricState: SignalMaterializationRowV1["materialization_state"],
  freshness: DataFreshnessStateV1,
  quality: ReturnType<typeof evaluateSignalMetricQualityV1>["state"]
): SignalServingMaterializationRowV1["materialization_state"] {
  if (metricState === "not_available" || quality === "failed") return "not_available";
  if (freshness === "stale") return "stale";
  if (freshness === "partial" || metricState === "partial" || quality === "partial") return "partial";
  return "fresh";
}

function operationalDbScope(scope: SignalOperationalReadScopeV1) {
  const id = scope.visibleSource === "governed_population"
    ? scope.population?.id
    : scope.legacyCorpus?.id;
  if (!id) {
    throw new SignalBackendContractError(
      "not_available",
      "Operational read scope has no serving identity.",
      { read_mode: scope.mode, visible_source: scope.visibleSource }
    );
  }
  // Shadow carries a governed population only for the side-by-side comparison.
  // Its client-visible read must remain byte-semantically legacy scoped.
  const population = scope.visibleSource === "governed_population"
    ? scope.population
    : null;
  return {
    id,
    mentionSql(alias: string, parameter: number) {
      return population
        ? `${alias}.workspace_id = '${scope.workspace.id.replaceAll("'", "''")}'::uuid
          AND ${alias}.canonical_mention_id = ${alias}.id
          AND EXISTS (
            SELECT 1 FROM signal_population_memberships operational_membership
            WHERE operational_membership.population_id = $${parameter}::uuid
              AND operational_membership.workspace_id = ${alias}.workspace_id
              AND operational_membership.mention_id = ${alias}.id
              AND operational_membership.membership_status = 'included'
              AND operational_membership.removed_at IS NULL
          )`
        : `${alias}.study_corpus_id = $${parameter}::uuid
          AND ${alias}.inclusion_status = 'included'`;
    },
    materializationSql(alias: string, parameter: number) {
      return population
        ? `${alias}.population_id = $${parameter}::uuid
          AND ${alias}.population_version = ${population.version}
          AND ${alias}.population_definition_hash = '${population.definition_hash.replaceAll("'", "''")}'`
        : `${alias}.study_corpus_id = $${parameter}::uuid`;
    },
    watermarkSql(alias: string, parameter: number) {
      return population
        ? `${alias}.population_id = $${parameter}::uuid
          AND ${alias}.study_corpus_id IS NULL`
        : `${alias}.study_corpus_id = $${parameter}::uuid`;
    },
    interpretationScopeSql(expression: string, parameter: number) {
      return population
        ? `${expression}->>'population_id' = $${parameter}::text`
        : `(
          ${expression}->>'study_corpus_id' = $${parameter}::text
          OR ${expression}->'study_corpus_ids' ? $${parameter}::text
        )`;
    },
    interpretationRowSql(alias: string, parameter: number) {
      return population
        ? `${alias}.data_scope->>'population_id' = $${parameter}::text`
        : `${alias}.study_corpus_id = $${parameter}::uuid`;
    }
  };
}

async function queueMissingMaterialization(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  metricKeys: string[],
  readScope?: SignalOperationalReadScopeV1
) {
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
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const job = buildSignalAdHocMaterializationJobV1({
    workspace_id: workspace.id,
    ...operationalMaterializationScopeV1(scope),
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

export function summarizeSignalMetricPointsV1(
  points: SignalMetricPointV1[],
  metricKey: string,
  unit: "count" | "ratio" | "score"
) {
  const available = points.filter((point) => point.value != null);
  if (available.length === 0) return null;
  if (metricKey === "conversation.velocity") {
    return available.at(-1)?.value ?? null;
  }
  if (unit !== "ratio") return available.reduce((total, point) => total + (point.value ?? 0), 0);
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

function mentionInteractionTotal(value: unknown) {
  if (!isRecord(value)) return 0;
  return ["likes", "comments", "shares", "reposts", "saves"].reduce((total, key) => (
    total + (numeric(value[key]) ?? 0)
  ), 0);
}

function mentionTags(value: unknown): SignalMentionTagV1[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const taxonomyKey = String(item.taxonomy_key ?? "").trim();
    const label = String(item.label ?? "").trim();
    if (!taxonomyKey || !label) return [];
    return [{
      taxonomy_key: taxonomyKey,
      taxonomy_name: String(item.taxonomy_name ?? taxonomyKey),
      term_key: String(item.term_key ?? label),
      label,
      value: item.value == null ? null : String(item.value),
      score: numeric(item.score)
    }];
  });
}

function mentionEntities(value: unknown): SignalMentionEntityV1[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = String(item.name ?? "").trim();
    if (!name) return [];
    return [{
      type: String(item.type ?? "entity"),
      name,
      relation: String(item.relation ?? "mentions"),
      confidence: item.confidence == null ? null : String(item.confidence)
    }];
  });
}

function mentionFeatures(value: unknown): SignalMentionFeatureV1[] {
  if (!Array.isArray(value)) return [];
  const features = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = String(item.key ?? "").trim();
    if (!key) return [];
    return [{
      key,
      value: item.value ?? null,
      value_type: item.value_type == null ? null : String(item.value_type),
      confidence: item.confidence == null ? null : String(item.confidence)
    }];
  });
  return features.filter((feature, index) => (
    features.findIndex((candidate) => (
      candidate.key === feature.key
      && JSON.stringify(candidate.value) === JSON.stringify(feature.value)
    )) === index
  ));
}

function mentionAttribution(value: unknown): SignalMentionAttributionV1[] {
  if (!Array.isArray(value)) return [];
  const attribution = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const scope = String(item.scope ?? "").trim();
    if (!["brand", "competitor", "category", "unknown"].includes(scope)) return [];
    const label = String(item.label ?? "").trim();
    return [{
      scope: scope as SignalMentionAttributionV1["scope"],
      label: label || "Unattributed"
    }];
  });
  return attribution.filter((item, index) => (
    attribution.findIndex((candidate) => (
      candidate.scope === item.scope && candidate.label === item.label
    )) === index
  ));
}

function mentionTbClassification(
  value: unknown,
  analysisStatus: string | null
): SignalMentionTbClassificationV1 | null {
  if (!isRecord(value) || !Array.isArray(value.codings)) return null;
  const analysisId = String(value.tb_analysis_id ?? "").trim();
  const contract = String(value.contract ?? "").trim();
  if (!analysisId || !contract) return null;
  const codings = value.codings.flatMap((item) => {
    if (!isRecord(item)) return [];
    const polarity = item.polarity == null ? null : String(item.polarity);
    const layer = item.layer == null ? null : String(item.layer);
    if (
      polarity != null
      && !["trigger", "barrier", "mixed", "irrelevant"].includes(polarity)
    ) return [];
    if (
      layer != null
      && !["personal", "psicologico", "social", "cultural"].includes(layer)
    ) return [];
    return [{
      finding_id: item.finding_id == null ? null : String(item.finding_id),
      polarity: polarity as SignalMentionTbCodingV1["polarity"],
      layer: layer as SignalMentionTbCodingV1["layer"],
      intensity_score: numeric(item.intensity_score),
      emergent_tags: Array.isArray(item.emergent_tags)
        ? item.emergent_tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [],
      ambiguous: item.ambiguous === true
    }];
  });
  if (codings.length === 0) return null;
  return {
    contract,
    analysis_id: analysisId,
    analysis_status: analysisStatus,
    codings
  };
}

function clientSafeMentionTitle(value: string | null) {
  return clientSafeMentionScalar(value);
}

function clientSafeMentionScalar(value: string | null) {
  if (!value) return null;
  const scalar = value.trim();
  if (!scalar || /^[\s"'“”‘’«»]+$/u.test(scalar)) return null;
  return scalar;
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

function rebaseSqlParameters(sql: string, offset: number) {
  if (offset === 0) return sql;
  return sql.replace(/\$(\d+)/gu, (_match, rawIndex: string) => (
    `$${Number(rawIndex) + offset}`
  ));
}

function sha256Text(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
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
