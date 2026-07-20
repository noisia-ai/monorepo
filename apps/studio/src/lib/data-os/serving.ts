import { pool } from "@/lib/db";
import type { SignalPulseResolvedVisibility } from "@/lib/signal-pulse/runtime-contracts";

type JsonRecord = Record<string, unknown>;

export type DataOsEnv = Record<string, string | undefined>;

export type DataOsListOptions = {
  limit?: number;
  offset?: number;
};

export type DataOsTagFilters = DataOsListOptions & {
  subjectType?: string | null;
  taxonomy?: string | null;
  reviewStatus?: string | null;
};

export type DataOsReviewQueueFilters = DataOsListOptions & {
  assertionStatus?: string | null;
  confidence?: string | null;
  reviewStatus?: string | null;
  taxonomy?: string | null;
};

export type DataOsTagReviewAction = "approve" | "reject" | "needs_review";

export type DataOsTagReviewInput = {
  action: DataOsTagReviewAction;
  assertionId?: never;
  notes?: string | null;
  reviewerUserId?: string | null;
  tagId: string;
};

export type DataOsAssertionReviewAction = DataOsTagReviewAction;

export type DataOsAssertionReviewInput = {
  action: DataOsAssertionReviewAction;
  assertionId: string;
  notes?: string | null;
  reviewerUserId?: string | null;
  tagId?: never;
};

export type DataOsMetricFilters = DataOsListOptions & {
  period?: string | null;
  signalId?: string | null;
};

export type DataOsLineageFilters = DataOsListOptions & {
  sourceType?: string | null;
  targetType?: string | null;
  relationType?: string | null;
};

export type DataOsCorpusFilters = DataOsListOptions & {
  period?: string | null;
  platform?: string | null;
  sourceType?: string | null;
  inclusionStatus?: string | null;
  taxonomy?: string | null;
  term?: string | null;
  lifecycle?: string | null;
  audience?: string | null;
  demographic?: string | null;
  journeyStage?: string | null;
  signalId?: string | null;
  query?: string | null;
};

export type PulseLiveVisibilityOptions = {
  visibility?: SignalPulseResolvedVisibility;
};

const TAG_REVIEW_STATUS_BY_ACTION: Record<DataOsTagReviewAction, string> = {
  approve: "approved",
  reject: "rejected",
  needs_review: "needs_review"
};

const ASSERTION_STATUS_BY_ACTION: Record<DataOsAssertionReviewAction, string> = {
  approve: "active",
  reject: "rejected",
  needs_review: "needs_review"
};

export function isDataOsServingEnabled(env: DataOsEnv = process.env) {
  return env.NOISIA_DATA_OS_ENABLED === "true" && env.NOISIA_DATA_OS_SERVING_ENABLED === "true";
}

export function isSignalPulseLiveApiEnabled(env: DataOsEnv = process.env) {
  return env.NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED === "true";
}

export function isSignalPulseLiveRenderEnabled(env: DataOsEnv = process.env) {
  return isDataOsServingEnabled(env) && isSignalPulseLiveApiEnabled(env) && env.NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED === "true";
}

export function parsePagination(searchParams: URLSearchParams): Required<DataOsListOptions> {
  const limit = Number(searchParams.get("limit") ?? "100");
  const offset = Number(searchParams.get("offset") ?? "0");
  return {
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100,
    offset: Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0
  };
}

export function optionalSearchParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)?.trim();
  return value ? value : null;
}

export function parseDataOsTagFilters(searchParams: URLSearchParams): DataOsTagFilters {
  return {
    ...parsePagination(searchParams),
    subjectType: optionalSearchParam(searchParams, "subject_type"),
    taxonomy: optionalSearchParam(searchParams, "taxonomy"),
    reviewStatus: optionalSearchParam(searchParams, "review_status")
  };
}

export function parseDataOsReviewQueueFilters(searchParams: URLSearchParams): DataOsReviewQueueFilters {
  return {
    ...parsePagination(searchParams),
    assertionStatus: optionalSearchParam(searchParams, "assertion_status"),
    confidence: optionalSearchParam(searchParams, "confidence"),
    reviewStatus: optionalSearchParam(searchParams, "review_status"),
    taxonomy: optionalSearchParam(searchParams, "taxonomy")
  };
}

export function parsePulseLiveMetricFilters(searchParams: URLSearchParams): DataOsMetricFilters {
  return {
    ...parsePagination(searchParams),
    period: optionalSearchParam(searchParams, "period"),
    signalId: optionalSearchParam(searchParams, "signal_id")
  };
}

export function parseDataOsLineageFilters(searchParams: URLSearchParams): DataOsLineageFilters {
  return {
    ...parsePagination(searchParams),
    sourceType: optionalSearchParam(searchParams, "source_type"),
    targetType: optionalSearchParam(searchParams, "target_type"),
    relationType: optionalSearchParam(searchParams, "relation_type")
  };
}

export function parsePulseLiveCorpusFilters(searchParams: URLSearchParams): DataOsCorpusFilters {
  return {
    ...parsePagination(searchParams),
    period: optionalSearchParam(searchParams, "period"),
    platform: optionalSearchParam(searchParams, "platform"),
    sourceType: optionalSearchParam(searchParams, "source_type"),
    inclusionStatus: optionalSearchParam(searchParams, "inclusion_status"),
    taxonomy: optionalSearchParam(searchParams, "taxonomy"),
    term: optionalSearchParam(searchParams, "term"),
    lifecycle: optionalSearchParam(searchParams, "lifecycle"),
    audience: optionalSearchParam(searchParams, "audience"),
    demographic: optionalSearchParam(searchParams, "demographic"),
    journeyStage: optionalSearchParam(searchParams, "journey_stage"),
    signalId: optionalSearchParam(searchParams, "signal_id"),
    query: optionalSearchParam(searchParams, "q")
  };
}

function attachByProfile<T extends { brand_os_profile_id: string }>(
  profiles: Array<Record<string, unknown>>,
  rows: T[],
  key: string
) {
  const byProfile = new Map<string, T[]>();
  for (const row of rows) {
    const list = byProfile.get(row.brand_os_profile_id) ?? [];
    list.push(row);
    byProfile.set(row.brand_os_profile_id, list);
  }
  for (const profile of profiles) {
    profile[key] = byProfile.get(profile.id as string) ?? [];
  }
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export function disabledDataOsResponse() {
  return Response.json(
    {
      error: "data_os_disabled",
      message: "Noisia Data OS serving APIs are disabled. Enable NOISIA_DATA_OS_ENABLED and NOISIA_DATA_OS_SERVING_ENABLED.",
      fallback: "published_outputs.payload",
      required_flags: ["NOISIA_DATA_OS_ENABLED", "NOISIA_DATA_OS_SERVING_ENABLED"]
    },
    { status: 503 }
  );
}

export function disabledSignalPulseLiveResponse() {
  return Response.json(
    {
      error: "signal_pulse_live_api_disabled",
      message: "Signal Pulse live Data OS APIs are disabled. Enable NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED.",
      fallback: "published_outputs.payload",
      required_flags: ["NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED"]
    },
    { status: 503 }
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hiddenLiveSection(section: string) {
  return {
    status: "hidden",
    section,
    reason: "visibility_config",
    fallback: "published_outputs.payload"
  };
}

function isClientVisibleDashboardRef(ref: unknown) {
  if (!isRecord(ref)) return false;
  const visibility = isRecord(ref.visibility) ? ref.visibility : {};
  return visibility.internal !== true;
}

export function applyPulseLiveVisibility<T extends { dashboard_data_refs?: unknown; source_health?: unknown }>(
  data: T,
  visibility: SignalPulseResolvedVisibility
) {
  const canSeeSourceHealth = visibility.showSources || visibility.showQuality;
  return {
    ...data,
    dashboard_data_refs: visibility.showRawMetadata
      ? data.dashboard_data_refs
      : Array.isArray(data.dashboard_data_refs)
        ? data.dashboard_data_refs.filter(isClientVisibleDashboardRef)
        : [],
    source_health: canSeeSourceHealth ? data.source_health : hiddenLiveSection("source_health"),
    visibility: {
      paid_organic: visibility.showPaidOrganic,
      competitive: visibility.showCompetitive,
      evidence: visibility.showEvidence,
      corpus: visibility.showCorpus,
      sources: visibility.showSources,
      quality: visibility.showQuality,
      raw_metadata: visibility.showRawMetadata
    }
  };
}

export async function listDataOsSources(corpusId: string) {
  const result = await pool.query(
    `
      SELECT
        ds.id,
        ds.source_type,
        ds.provider,
        ds.connection_method,
        ds.name,
        ds.mapping_version,
        ds.role,
        ds.status,
        ds.visibility,
        ds.created_at,
        ds.updated_at,
        latest_sync.id AS latest_sync_id,
        latest_sync.status AS latest_sync_status,
        latest_sync.records_total,
        latest_sync.records_valid,
        latest_sync.records_duplicate,
        latest_sync.records_failed,
        latest_sync.coverage_start,
        latest_sync.coverage_end,
        latest_sync.finished_at
      FROM data_sources ds
      LEFT JOIN LATERAL (
        SELECT ssr.*
        FROM source_sync_runs ssr
        WHERE ssr.data_source_id = ds.id
        ORDER BY ssr.created_at DESC
        LIMIT 1
      ) latest_sync ON true
      WHERE ds.study_corpus_id = $1
      ORDER BY ds.source_type, ds.provider, ds.name
    `,
    [corpusId]
  );

  return result.rows;
}

export async function getDataOsSourceHealth(corpusId: string) {
  const assets = await pool.query(
    `
      SELECT
        da.id,
        da.name,
        da.layer,
        da.asset_kind,
        da.row_count,
        da.status,
        da.sensitivity,
        COALESCE(field_counts.field_count, 0)::int AS field_count,
        quality.status AS quality_status,
        quality.result_key,
        quality.observed_value,
        quality.expected_value,
        quality.checked_at
      FROM data_assets da
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS field_count
        FROM data_asset_fields daf
        WHERE daf.data_asset_id = da.id
      ) field_counts ON true
      LEFT JOIN LATERAL (
        SELECT dqr.*
        FROM data_quality_results dqr
        WHERE dqr.data_asset_id = da.id
        ORDER BY dqr.checked_at DESC
        LIMIT 1
      ) quality ON true
      WHERE da.study_corpus_id = $1
      ORDER BY da.layer, da.name
    `,
    [corpusId]
  );

  const sources = await pool.query(
    `
      SELECT
        count(*)::int AS total_sources,
        count(*) FILTER (WHERE status = 'active')::int AS active_sources,
        count(*) FILTER (WHERE status IN ('broken', 'stale'))::int AS unhealthy_sources
      FROM data_sources
      WHERE study_corpus_id = $1
    `,
    [corpusId]
  );

  const summary = assets.rows.reduce(
    (acc, row) => {
      acc.assets += 1;
      if (row.quality_status === "passed") acc.passed += 1;
      if (row.quality_status === "warning") acc.warnings += 1;
      if (row.quality_status === "failed") acc.failed += 1;
      return acc;
    },
    { assets: 0, passed: 0, warnings: 0, failed: 0 }
  );

  return {
    corpus_id: corpusId,
    summary: {
      ...summary,
      ...(sources.rows[0] ?? { total_sources: 0, active_sources: 0, unhealthy_sources: 0 })
    },
    assets: assets.rows
  };
}

export async function getDataOsCatalog(corpusId: string) {
  const result = await pool.query(
    `
      SELECT
        da.id,
        da.organization_id,
        da.brand_id,
        da.theme_id,
        da.study_corpus_id,
        da.data_source_id,
        da.asset_kind,
        da.layer,
        da.name,
        da.description,
        da.owner_team,
        da.sensitivity,
        da.status,
        da.storage_ref,
        da.row_count,
        da.metadata,
        da.created_at,
        da.updated_at,
        COALESCE(fields.fields, '[]'::jsonb) AS fields,
        COALESCE(contracts.contracts, '[]'::jsonb) AS contracts,
        COALESCE(quality.latest_quality, '[]'::jsonb) AS latest_quality
      FROM data_assets da
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', daf.id,
            'field_name', daf.field_name,
            'field_type', daf.field_type,
            'semantic_type', daf.semantic_type,
            'nullable', daf.nullable,
            'description', daf.description,
            'examples', daf.examples,
            'metadata', daf.metadata,
            'created_at', daf.created_at
          )
          ORDER BY daf.field_name
        ) AS fields
        FROM data_asset_fields daf
        WHERE daf.data_asset_id = da.id
      ) fields ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', dc.id,
            'contract_name', dc.contract_name,
            'version', dc.version,
            'status', dc.status,
            'schema_contract', dc.schema_contract,
            'quality_contract', dc.quality_contract,
            'freshness_contract', dc.freshness_contract,
            'semantic_contract', dc.semantic_contract,
            'created_at', dc.created_at,
            'updated_at', dc.updated_at
          )
          ORDER BY dc.contract_name, dc.version DESC
        ) AS contracts
        FROM data_contracts dc
        WHERE dc.data_asset_id = da.id
      ) contracts ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ranked.id,
            'result_key', ranked.result_key,
            'status', ranked.status,
            'observed_value', ranked.observed_value,
            'expected_value', ranked.expected_value,
            'sample_refs', ranked.sample_refs,
            'checked_at', ranked.checked_at
          )
          ORDER BY ranked.result_key
        ) AS latest_quality
        FROM (
          SELECT DISTINCT ON (dqr.result_key)
            dqr.id,
            dqr.result_key,
            dqr.status,
            dqr.observed_value,
            dqr.expected_value,
            dqr.sample_refs,
            dqr.checked_at
          FROM data_quality_results dqr
          WHERE dqr.data_asset_id = da.id
          ORDER BY dqr.result_key, dqr.checked_at DESC
        ) ranked
      ) quality ON true
      WHERE da.study_corpus_id = $1
      ORDER BY da.layer, da.asset_kind, da.name
    `,
    [corpusId]
  );

  const assets = result.rows;
  const counts = assets.reduce(
    (acc, asset) => {
      const fieldCount = arrayCount(asset.fields);
      acc.assets += 1;
      acc.fields += fieldCount;
      acc.contracts += arrayCount(asset.contracts);
      acc.quality_results += arrayCount(asset.latest_quality);
      if (fieldCount === 0) acc.assets_without_fields += 1;
      if (Array.isArray(asset.latest_quality)) {
        acc.failed_quality += asset.latest_quality.filter((quality: { status?: string }) => quality.status === "failed").length;
      }
      return acc;
    },
    {
      assets: 0,
      fields: 0,
      contracts: 0,
      quality_results: 0,
      assets_without_fields: 0,
      failed_quality: 0
    }
  );

  return {
    corpus_id: corpusId,
    assets,
    counts
  };
}

export async function listDataOsLineage(corpusId: string, filters: DataOsLineageFilters = {}) {
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const result = await pool.query(
    `
      WITH scoped_edges AS (
        SELECT le.*
        FROM lineage_edges le
        WHERE (
          EXISTS (
            SELECT 1
            FROM data_assets da
            WHERE da.study_corpus_id = $1
              AND (
                (le.source_type = 'data_asset' AND le.source_id = da.id)
                OR (le.target_type = 'data_asset' AND le.target_id = da.id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM dashboard_data_refs ddr
            WHERE ddr.study_corpus_id = $1
              AND (
                (le.source_type = 'dashboard_data_ref' AND le.source_id = ddr.id)
                OR (le.target_type = 'dashboard_data_ref' AND le.target_id = ddr.id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM published_outputs po
            WHERE po.study_corpus_id = $1
              AND (
                (le.source_type = 'published_output' AND le.source_id = po.id)
                OR (le.target_type = 'published_output' AND le.target_id = po.id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM data_sources ds
            WHERE ds.study_corpus_id = $1
              AND (
                (le.source_type = 'data_source' AND le.source_id = ds.id)
                OR (le.target_type = 'data_source' AND le.target_id = ds.id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM source_sync_runs ssr
            JOIN data_sources ds ON ds.id = ssr.data_source_id
            WHERE ds.study_corpus_id = $1
              AND (
                (le.source_type = 'source_sync_run' AND le.source_id = ssr.id)
                OR (le.target_type = 'source_sync_run' AND le.target_id = ssr.id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM import_batches ib
            WHERE ib.study_corpus_id = $1
              AND (
                (le.source_type = 'import_batch' AND le.source_id = ib.id)
                OR (le.target_type = 'import_batch' AND le.target_id = ib.id)
              )
          )
          OR (le.source_type = 'study_corpus' AND le.source_id = $1)
          OR (le.target_type = 'study_corpus' AND le.target_id = $1)
        )
      ),
      filtered_edges AS (
        SELECT
          le.*,
          count(*) OVER()::int AS total_count
        FROM scoped_edges le
        WHERE ($2::text IS NULL OR le.source_type = $2)
          AND ($3::text IS NULL OR le.target_type = $3)
          AND ($4::text IS NULL OR le.relation_type = $4)
        ORDER BY le.created_at DESC, le.id
        LIMIT $5 OFFSET $6
      )
      SELECT
        fe.id,
        fe.source_type,
        fe.source_id,
        fe.target_type,
        fe.target_id,
        fe.relation_type,
        fe.metadata,
        fe.created_at,
        fe.total_count,
        CASE fe.source_type
          WHEN 'data_asset' THEN (SELECT da.name FROM data_assets da WHERE da.id = fe.source_id)
          WHEN 'dashboard_data_ref' THEN (SELECT ddr.ref_key FROM dashboard_data_refs ddr WHERE ddr.id = fe.source_id)
          WHEN 'published_output' THEN (SELECT COALESCE(po.title, po.output_type) FROM published_outputs po WHERE po.id = fe.source_id)
          WHEN 'data_source' THEN (SELECT ds.name FROM data_sources ds WHERE ds.id = fe.source_id)
          WHEN 'source_sync_run' THEN (SELECT ssr.status || ':' || ssr.id::text FROM source_sync_runs ssr WHERE ssr.id = fe.source_id)
          WHEN 'import_batch' THEN (SELECT COALESCE(ib.source_file_name, ib.source_system, ib.id::text) FROM import_batches ib WHERE ib.id = fe.source_id)
          WHEN 'brand_knowledge_source' THEN (SELECT bks.title FROM brand_knowledge_sources bks WHERE bks.id = fe.source_id)
          WHEN 'tagging_rule_set' THEN (SELECT trs.rule_set_key || ':v' || trs.version::text FROM tagging_rule_sets trs WHERE trs.id = fe.source_id)
          WHEN 'tagging_model_version' THEN (SELECT tmv.model_key || ':' || tmv.version FROM tagging_model_versions tmv WHERE tmv.id = fe.source_id)
          WHEN 'study_corpus' THEN (SELECT sc.name FROM study_corpora sc WHERE sc.id = fe.source_id)
          ELSE fe.source_id::text
        END AS source_label,
        CASE fe.target_type
          WHEN 'data_asset' THEN (SELECT da.name FROM data_assets da WHERE da.id = fe.target_id)
          WHEN 'dashboard_data_ref' THEN (SELECT ddr.ref_key FROM dashboard_data_refs ddr WHERE ddr.id = fe.target_id)
          WHEN 'published_output' THEN (SELECT COALESCE(po.title, po.output_type) FROM published_outputs po WHERE po.id = fe.target_id)
          WHEN 'data_source' THEN (SELECT ds.name FROM data_sources ds WHERE ds.id = fe.target_id)
          WHEN 'source_sync_run' THEN (SELECT ssr.status || ':' || ssr.id::text FROM source_sync_runs ssr WHERE ssr.id = fe.target_id)
          WHEN 'import_batch' THEN (SELECT COALESCE(ib.source_file_name, ib.source_system, ib.id::text) FROM import_batches ib WHERE ib.id = fe.target_id)
          WHEN 'brand_knowledge_source' THEN (SELECT bks.title FROM brand_knowledge_sources bks WHERE bks.id = fe.target_id)
          WHEN 'tagging_rule_set' THEN (SELECT trs.rule_set_key || ':v' || trs.version::text FROM tagging_rule_sets trs WHERE trs.id = fe.target_id)
          WHEN 'tagging_model_version' THEN (SELECT tmv.model_key || ':' || tmv.version FROM tagging_model_versions tmv WHERE tmv.id = fe.target_id)
          WHEN 'study_corpus' THEN (SELECT sc.name FROM study_corpora sc WHERE sc.id = fe.target_id)
          ELSE fe.target_id::text
        END AS target_label
      FROM filtered_edges fe
      ORDER BY fe.created_at DESC, fe.id
    `,
    [
      corpusId,
      filters.sourceType ?? null,
      filters.targetType ?? null,
      filters.relationType ?? null,
      limit,
      offset
    ]
  );

  return {
    corpus_id: corpusId,
    lineage_edges: result.rows.map((row) => {
      const edge = { ...row };
      delete edge.total_count;
      return edge;
    }),
    pagination: {
      limit,
      offset,
      count: result.rowCount ?? result.rows.length,
      total: Number(result.rows[0]?.total_count ?? 0)
    }
  };
}

export async function listDataOsTaxonomies(corpusId: string) {
  const result = await pool.query(
    `
      SELECT
        tx.id AS taxonomy_id,
        tx.taxonomy_key,
        tx.name AS taxonomy_name,
        tx.description AS taxonomy_description,
        tx.scope,
        tx.methodology_slug,
        tt.id AS term_id,
        tt.term_key,
        tt.label,
        tt.description AS term_description,
        tt.parent_term_id,
        tt.sort_order,
        COALESCE(tag_counts.tag_count, 0)::int AS tag_count
      FROM taxonomies tx
      LEFT JOIN taxonomy_terms tt ON tt.taxonomy_id = tx.id AND tt.status = 'active'
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS tag_count
        FROM record_tags rt
        WHERE rt.taxonomy_term_id = tt.id
          AND rt.study_corpus_id = $1
      ) tag_counts ON true
      WHERE tx.status = 'active'
      ORDER BY tx.taxonomy_key, tt.sort_order NULLS LAST, tt.label
    `,
    [corpusId]
  );

  const taxonomies = new Map<string, Record<string, unknown> & { terms: unknown[] }>();
  for (const row of result.rows) {
    const key = row.taxonomy_id as string;
    if (!taxonomies.has(key)) {
      taxonomies.set(key, {
        id: row.taxonomy_id,
        key: row.taxonomy_key,
        name: row.taxonomy_name,
        description: row.taxonomy_description,
        scope: row.scope,
        methodology_slug: row.methodology_slug,
        terms: []
      });
    }
    if (row.term_id) {
      taxonomies.get(key)?.terms.push({
        id: row.term_id,
        key: row.term_key,
        label: row.label,
        description: row.term_description,
        parent_term_id: row.parent_term_id,
        sort_order: row.sort_order,
        tag_count: row.tag_count
      });
    }
  }

  return { corpus_id: corpusId, taxonomies: [...taxonomies.values()] };
}

export async function listDataOsTags(corpusId: string, filters: DataOsTagFilters = {}) {
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const result = await pool.query(
    `
      SELECT
        rt.id,
        rt.subject_type,
        rt.subject_id,
        rt.value,
        rt.score,
        rt.confidence,
        rt.source,
        rt.review_status,
        rt.evidence,
        rt.created_at,
        tx.taxonomy_key,
        tx.name AS taxonomy_name,
        tt.term_key,
        tt.label AS term_label
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.study_corpus_id = $1
        AND ($2::text IS NULL OR rt.subject_type = $2)
        AND ($3::text IS NULL OR tx.taxonomy_key = $3)
        AND ($4::text IS NULL OR rt.review_status = $4)
      ORDER BY rt.created_at DESC
      LIMIT $5 OFFSET $6
    `,
    [corpusId, filters.subjectType ?? null, filters.taxonomy ?? null, filters.reviewStatus ?? null, limit, offset]
  );

  return {
    corpus_id: corpusId,
    tags: result.rows,
    pagination: { limit, offset, count: result.rowCount ?? result.rows.length }
  };
}

export async function getDataOsReviewQueue(corpusId: string, filters: DataOsReviewQueueFilters = {}) {
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const reviewStatus = filters.reviewStatus ?? "unreviewed";
  const assertionStatus = filters.assertionStatus ?? "candidate";

  const summary = await pool.query(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $1
      )
      SELECT
        (SELECT count(*)::int FROM record_tags rt WHERE rt.study_corpus_id = cs.corpus_id) AS record_tags_total,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND rt.review_status = 'unreviewed'
        ) AS record_tags_unreviewed,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND rt.review_status <> 'unreviewed'
        ) AS record_tags_reviewed,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND rt.confidence = 'low'
        ) AS record_tags_low_confidence,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND jsonb_typeof(rt.evidence) = 'array'
            AND jsonb_array_length(rt.evidence) > 0
        ) AS record_tags_with_evidence,
        (
          SELECT count(DISTINCT tx.taxonomy_key)::int
          FROM record_tags rt
          JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
          JOIN taxonomies tx ON tx.id = tt.taxonomy_id
          WHERE rt.study_corpus_id = cs.corpus_id
        ) AS record_tag_taxonomies,
        (
          SELECT count(*)::int
          FROM tag_review_events tre
          JOIN record_tags rt ON rt.id = tre.record_tag_id
          WHERE rt.study_corpus_id = cs.corpus_id
        ) AS tag_review_events,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE ka.status = 'candidate'
            AND (
              bks.study_corpus_id = cs.corpus_id
              OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS knowledge_assertions_candidate,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE jsonb_typeof(ka.evidence) = 'array'
            AND jsonb_array_length(ka.evidence) > 0
            AND (
              bks.study_corpus_id = cs.corpus_id
              OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS knowledge_assertions_with_evidence,
        (
          SELECT count(*)::int
          FROM knowledge_assertion_review_events kare
          JOIN knowledge_assertions ka ON ka.id = kare.knowledge_assertion_id
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = cs.corpus_id
             OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
        ) AS knowledge_assertion_review_events
      FROM corpus_scope cs
    `,
    [corpusId]
  );

  const tagItems = await pool.query(
    `
      SELECT
        rt.id,
        rt.subject_type,
        rt.subject_id,
        rt.value,
        rt.score,
        rt.confidence,
        rt.source,
        rt.review_status,
        rt.evidence,
        rt.created_at,
        tx.taxonomy_key,
        tx.name AS taxonomy_name,
        tt.term_key,
        tt.label AS term_label,
        mention.platform AS mention_platform,
        mention.published_at AS mention_published_at,
        COALESCE(mention.text_snippet, left(mention.text_clean, 320)) AS mention_preview,
        latest_review.action AS latest_review_action,
        latest_review.notes AS latest_review_notes,
        latest_review.created_at AS latest_reviewed_at,
        count(*) OVER()::int AS total_count
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      LEFT JOIN mentions mention
        ON rt.subject_type = 'mention'
       AND mention.id = rt.subject_id
       AND mention.study_corpus_id = rt.study_corpus_id
      LEFT JOIN LATERAL (
        SELECT tre.action, tre.notes, tre.created_at
        FROM tag_review_events tre
        WHERE tre.record_tag_id = rt.id
        ORDER BY tre.created_at DESC
        LIMIT 1
      ) latest_review ON true
      WHERE rt.study_corpus_id = $1
        AND ($2::text IS NULL OR rt.review_status = $2)
        AND ($3::text IS NULL OR tx.taxonomy_key = $3)
        AND ($4::text IS NULL OR rt.confidence = $4)
        AND jsonb_typeof(rt.evidence) = 'array'
        AND jsonb_array_length(rt.evidence) > 0
      ORDER BY
        CASE rt.review_status WHEN 'unreviewed' THEN 0 WHEN 'needs_review' THEN 1 ELSE 2 END,
        CASE rt.confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        rt.created_at DESC,
        rt.id
      LIMIT $5 OFFSET $6
    `,
    [corpusId, reviewStatus, filters.taxonomy ?? null, filters.confidence ?? null, limit, offset]
  );

  const assertions = await pool.query(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $1
      ),
      scoped_assertions AS (
        SELECT
          ka.id,
          ka.knowledge_source_id,
          bks.title AS knowledge_source_title,
          ka.assertion_text,
          ka.assertion_type,
          ka.valid_from,
          ka.valid_to,
          ka.confidence,
          ka.status,
          ka.evidence,
          ka.metadata,
          ka.created_at,
          ka.updated_at,
          COALESCE(link_counts.link_count, 0)::int AS link_count,
          COALESCE(usage_counts.usage_event_count, 0)::int AS usage_event_count,
          latest_review.action AS latest_review_action,
          latest_review.notes AS latest_review_notes,
          latest_review.created_at AS latest_reviewed_at,
          count(*) OVER()::int AS total_count
        FROM corpus_scope cs
        JOIN brand_knowledge_sources bks
          ON bks.study_corpus_id = cs.corpus_id
          OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
        JOIN knowledge_assertions ka ON ka.knowledge_source_id = bks.id
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS link_count
          FROM knowledge_assertion_links kal
          WHERE kal.knowledge_assertion_id = ka.id
        ) link_counts ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS usage_event_count
          FROM knowledge_usage_events kue
          WHERE kue.knowledge_assertion_id = ka.id
        ) usage_counts ON true
        LEFT JOIN LATERAL (
          SELECT kare.action, kare.notes, kare.created_at
          FROM knowledge_assertion_review_events kare
          WHERE kare.knowledge_assertion_id = ka.id
          ORDER BY kare.created_at DESC
          LIMIT 1
        ) latest_review ON true
        WHERE ($2::text IS NULL OR ka.status = $2)
          AND ($3::text IS NULL OR ka.confidence = $3)
          AND jsonb_typeof(ka.evidence) = 'array'
          AND jsonb_array_length(ka.evidence) > 0
      )
      SELECT *
      FROM scoped_assertions
      ORDER BY
        CASE status WHEN 'candidate' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        CASE confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        created_at DESC,
        id
      LIMIT $4 OFFSET $5
    `,
    [corpusId, assertionStatus, filters.confidence ?? null, limit, offset]
  );

  const summaryRow = summary.rows[0] ?? {};
  return {
    corpus_id: corpusId,
    summary: {
      ...summaryRow,
      ready_for_human_review:
        Number(summaryRow.record_tags_total ?? 0) > 0 &&
        Number(summaryRow.record_tags_with_evidence ?? 0) >= Number(summaryRow.record_tags_total ?? 0) &&
        Number(summaryRow.record_tag_taxonomies ?? 0) >= 5 &&
        Number(summaryRow.knowledge_assertions_candidate ?? 0) > 0 &&
        Number(summaryRow.knowledge_assertions_with_evidence ?? 0) >= Number(summaryRow.knowledge_assertions_candidate ?? 0),
      required_before_client_visible: true
    },
    tags: tagItems.rows.map((row) => {
      const tag = { ...row };
      delete tag.total_count;
      return tag;
    }),
    assertions: assertions.rows.map((row) => {
      const assertion = { ...row };
      delete assertion.total_count;
      return assertion;
    }),
    pagination: {
      limit,
      offset,
      tag_count: tagItems.rowCount ?? tagItems.rows.length,
      tag_total: Number(tagItems.rows[0]?.total_count ?? 0),
      assertion_count: assertions.rowCount ?? assertions.rows.length,
      assertion_total: Number(assertions.rows[0]?.total_count ?? 0)
    }
  };
}

export async function reviewDataOsTag(corpusId: string, input: DataOsTagReviewInput) {
  const nextReviewStatus = TAG_REVIEW_STATUS_BY_ACTION[input.action];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `
        SELECT
          rt.id,
          rt.subject_type,
          rt.subject_id,
          rt.value,
          rt.score,
          rt.confidence,
          rt.source,
          rt.review_status,
          rt.evidence,
          rt.created_at,
          tx.taxonomy_key,
          tt.term_key,
          tt.label AS term_label
        FROM record_tags rt
        JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
        JOIN taxonomies tx ON tx.id = tt.taxonomy_id
        WHERE rt.id = $1
          AND rt.study_corpus_id = $2
        FOR UPDATE
      `,
      [input.tagId, corpusId]
    );

    const current = existing.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }

    const previousValue = {
      confidence: current.confidence,
      review_status: current.review_status,
      taxonomy_key: current.taxonomy_key,
      term_key: current.term_key,
      value: current.value
    };
    const nextValue = {
      ...previousValue,
      review_status: nextReviewStatus
    };

    const updated = await client.query(
      `
        UPDATE record_tags
        SET review_status = $3
        WHERE id = $1
          AND study_corpus_id = $2
        RETURNING id, subject_type, subject_id, value, score, confidence, source,
                  review_status, evidence, created_at
      `,
      [input.tagId, corpusId, nextReviewStatus]
    );

    const event = await client.query(
      `
        INSERT INTO tag_review_events (
          record_tag_id,
          reviewer_user_id,
          action,
          previous_value,
          next_value,
          notes
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
        RETURNING id, record_tag_id, reviewer_user_id, action, previous_value,
                  next_value, notes, created_at
      `,
      [
        input.tagId,
        input.reviewerUserId ?? null,
        input.action,
        JSON.stringify(previousValue),
        JSON.stringify(nextValue),
        input.notes?.trim() || null
      ]
    );

    await client.query("COMMIT");
    return {
      corpus_id: corpusId,
      review_event: event.rows[0],
      tag: {
        ...updated.rows[0],
        taxonomy_key: current.taxonomy_key,
        term_key: current.term_key,
        term_label: current.term_label
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewDataOsAssertion(corpusId: string, input: DataOsAssertionReviewInput) {
  const nextStatus = ASSERTION_STATUS_BY_ACTION[input.action];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `
        WITH corpus_scope AS (
          SELECT sc.id AS corpus_id, sc.brand_id
          FROM study_corpora sc
          WHERE sc.id = $2
        )
        SELECT
          ka.id,
          ka.knowledge_source_id,
          bks.title AS knowledge_source_title,
          ka.assertion_text,
          ka.assertion_type,
          ka.valid_from,
          ka.valid_to,
          ka.confidence,
          ka.status,
          ka.evidence,
          ka.metadata,
          ka.created_at,
          ka.updated_at
        FROM corpus_scope cs
        JOIN brand_knowledge_sources bks
          ON bks.study_corpus_id = cs.corpus_id
          OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
        JOIN knowledge_assertions ka ON ka.knowledge_source_id = bks.id
        WHERE ka.id = $1
        FOR UPDATE OF ka
      `,
      [input.assertionId, corpusId]
    );

    const current = existing.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }

    const previousValue = {
      assertion_type: current.assertion_type,
      confidence: current.confidence,
      knowledge_source_id: current.knowledge_source_id,
      status: current.status
    };
    const nextValue = {
      ...previousValue,
      status: nextStatus
    };

    const updated = await client.query(
      `
        UPDATE knowledge_assertions
        SET status = $2,
            updated_at = now()
        WHERE id = $1
        RETURNING id, knowledge_source_id, assertion_text, assertion_type,
                  valid_from, valid_to, confidence, status, evidence,
                  metadata, created_at, updated_at
      `,
      [input.assertionId, nextStatus]
    );

    const event = await client.query(
      `
        INSERT INTO knowledge_assertion_review_events (
          knowledge_assertion_id,
          reviewer_user_id,
          action,
          previous_value,
          next_value,
          notes
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
        RETURNING id, knowledge_assertion_id, reviewer_user_id, action,
                  previous_value, next_value, notes, created_at
      `,
      [
        input.assertionId,
        input.reviewerUserId ?? null,
        input.action,
        JSON.stringify(previousValue),
        JSON.stringify(nextValue),
        input.notes?.trim() || null
      ]
    );

    await client.query("COMMIT");
    return {
      assertion: {
        ...updated.rows[0],
        knowledge_source_title: current.knowledge_source_title
      },
      corpus_id: corpusId,
      review_event: event.rows[0]
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getDataOsBrandOs(corpusId: string) {
  const profilesResult = await pool.query(
    `
      WITH corpus_scope AS (
        SELECT
          sc.id AS corpus_id,
          sc.brand_id,
          sc.theme_id,
          COALESCE(b.organization_id, t.organization_id) AS organization_id,
          COALESCE(b.display_name, b.name, t.name, sc.name) AS subject_name
        FROM study_corpora sc
        LEFT JOIN brands b ON b.id = sc.brand_id
        LEFT JOIN themes t ON t.id = sc.theme_id
        WHERE sc.id = $1
      )
      SELECT
        bop.id,
        bop.organization_id,
        bop.brand_id,
        bop.theme_id,
        bop.name,
        bop.status,
        bop.version,
        bop.metadata,
        bop.created_at,
        bop.updated_at,
        cs.subject_name,
        cs.corpus_id
      FROM brand_os_profiles bop
      JOIN corpus_scope cs
        ON (cs.brand_id IS NOT NULL AND bop.brand_id = cs.brand_id)
        OR (cs.theme_id IS NOT NULL AND bop.theme_id = cs.theme_id)
      WHERE bop.status = 'active'
      ORDER BY bop.version DESC, bop.updated_at DESC
    `,
    [corpusId]
  );

  const profiles = profilesResult.rows.map((profile) => ({
    ...profile,
    objectives: [],
    briefs: [],
    audiences: [],
    products: [],
    claims: [],
    campaigns: [],
    competitors: [],
    events: [],
    seed_sets: [],
    links: []
  }));
  const profileIds = profiles.map((profile) => profile.id);

  if (profileIds.length === 0) {
    return {
      corpus_id: corpusId,
      profiles: [],
      counts: {
        profiles: 0,
        objectives: 0,
        briefs: 0,
        audiences: 0,
        seed_sets: 0,
        seed_terms: 0
      }
    };
  }

  const [
    objectives,
    briefs,
    audiences,
    products,
    claims,
    campaigns,
    competitors,
    events,
    seedSets,
    links
  ] = await Promise.all([
    pool.query(
      `
        SELECT id, brand_os_profile_id, objective_type, name, description,
               success_criteria, priority, active_from, active_to, status, created_at
        FROM brand_os_objectives
        WHERE brand_os_profile_id = ANY($1::uuid[])
          AND status = 'active'
        ORDER BY priority NULLS LAST, created_at
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, study_corpus_id, objective_id,
               knowledge_source_id, brief_type, title, summary, source_kind,
               status, metadata, received_at, created_at, updated_at
        FROM brand_os_briefs
        WHERE brand_os_profile_id = ANY($1::uuid[])
          AND status = 'active'
        ORDER BY received_at DESC, title
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, name, description, attributes, status, created_at
        FROM brand_os_audiences
        WHERE brand_os_profile_id = ANY($1::uuid[])
          AND status = 'active'
        ORDER BY name
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, name, product_type, description, metadata, status, created_at
        FROM brand_os_products
        WHERE brand_os_profile_id = ANY($1::uuid[])
          AND status = 'active'
        ORDER BY name
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, claim_text, claim_type, status, valid_from, valid_to, metadata, created_at
        FROM brand_os_claims
        WHERE brand_os_profile_id = ANY($1::uuid[])
          AND status = 'active'
        ORDER BY claim_type NULLS LAST, created_at
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, name, external_id, campaign_type,
               channel_mix, active_from, active_to, metadata, created_at
        FROM brand_os_campaigns
        WHERE brand_os_profile_id = ANY($1::uuid[])
        ORDER BY active_from NULLS LAST, name
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, competitor_name, competitor_brand_seed_id,
               role, priority, metadata, created_at
        FROM brand_os_competitors
        WHERE brand_os_profile_id = ANY($1::uuid[])
        ORDER BY priority NULLS LAST, competitor_name
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, name, event_type, event_date,
               starts_at, ends_at, metadata, created_at
        FROM brand_os_events
        WHERE brand_os_profile_id = ANY($1::uuid[])
        ORDER BY event_date NULLS LAST, name
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT
          boss.id,
          boss.brand_os_profile_id,
          boss.name,
          boss.seed_set_type,
          boss.objective_id,
          boss.status,
          boss.metadata,
          boss.created_at,
          COALESCE(seed_terms.terms, '[]'::jsonb) AS terms
        FROM brand_os_seed_sets boss
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bost.id,
              'term', bost.term,
              'term_type', bost.term_type,
              'brand_seed_id', bost.brand_seed_id,
              'weight', bost.weight,
              'metadata', bost.metadata,
              'created_at', bost.created_at
            )
            ORDER BY bost.weight DESC NULLS LAST, bost.term
          ) AS terms
          FROM brand_os_seed_terms bost
          WHERE bost.seed_set_id = boss.id
        ) seed_terms ON true
        WHERE boss.brand_os_profile_id = ANY($1::uuid[])
          AND boss.status = 'active'
        ORDER BY boss.seed_set_type, boss.name
      `,
      [profileIds]
    ),
    pool.query(
      `
        SELECT id, brand_os_profile_id, source_type, source_id, target_type,
               target_id, relation_type, metadata, created_at
        FROM brand_os_links
        WHERE brand_os_profile_id = ANY($1::uuid[])
        ORDER BY created_at DESC
      `,
      [profileIds]
    )
  ]);

  attachByProfile(profiles, objectives.rows, "objectives");
  attachByProfile(profiles, briefs.rows, "briefs");
  attachByProfile(profiles, audiences.rows, "audiences");
  attachByProfile(profiles, products.rows, "products");
  attachByProfile(profiles, claims.rows, "claims");
  attachByProfile(profiles, campaigns.rows, "campaigns");
  attachByProfile(profiles, competitors.rows, "competitors");
  attachByProfile(profiles, events.rows, "events");
  attachByProfile(profiles, seedSets.rows, "seed_sets");
  attachByProfile(profiles, links.rows, "links");

  const seedTermCount = seedSets.rows.reduce((sum, row) => {
    const terms = Array.isArray(row.terms) ? row.terms : [];
    return sum + terms.length;
  }, 0);

  return {
    corpus_id: corpusId,
    profiles,
    counts: {
      profiles: profiles.length,
      objectives: objectives.rowCount ?? objectives.rows.length,
      briefs: briefs.rowCount ?? briefs.rows.length,
      audiences: audiences.rowCount ?? audiences.rows.length,
      products: products.rowCount ?? products.rows.length,
      claims: claims.rowCount ?? claims.rows.length,
      campaigns: campaigns.rowCount ?? campaigns.rows.length,
      competitors: competitors.rowCount ?? competitors.rows.length,
      events: events.rowCount ?? events.rows.length,
      seed_sets: seedSets.rowCount ?? seedSets.rows.length,
      seed_terms: seedTermCount,
      links: links.rowCount ?? links.rows.length
    }
  };
}

export async function getDataOsKnowledge(corpusId: string, options: DataOsListOptions = {}) {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const sources = await pool.query(
    `
      WITH corpus_scope AS (
        SELECT
          sc.id AS corpus_id,
          sc.brand_id,
          COALESCE(b.organization_id, t.organization_id) AS organization_id
        FROM study_corpora sc
        LEFT JOIN brands b ON b.id = sc.brand_id
        LEFT JOIN themes t ON t.id = sc.theme_id
        WHERE sc.id = $1
      )
      SELECT
        bks.id,
        bks.organization_id,
        bks.brand_id,
        bks.study_corpus_id,
        bks.source_kind,
        bks.title,
        bks.original_file_name,
        bks.mime_type,
        bks.file_size_bytes,
        bks.file_hash,
        bks.source_period_start,
        bks.source_period_end,
        bks.status,
        bks.created_at,
        bks.updated_at,
        COALESCE(chunk_counts.chunk_count, 0)::int AS chunk_count,
        COALESCE(assertion_counts.assertion_count, 0)::int AS assertion_count
      FROM brand_knowledge_sources bks
      JOIN corpus_scope cs
        ON bks.study_corpus_id = cs.corpus_id
        OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS chunk_count
        FROM knowledge_chunks kc
        WHERE kc.knowledge_source_id = bks.id
      ) chunk_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS assertion_count
        FROM knowledge_assertions ka
        WHERE ka.knowledge_source_id = bks.id
      ) assertion_counts ON true
      ORDER BY bks.created_at DESC, bks.title
      LIMIT $2 OFFSET $3
    `,
    [corpusId, limit, offset]
  );

  const sourceIds = sources.rows.map((source) => source.id);
  if (sourceIds.length === 0) {
    return {
      corpus_id: corpusId,
      sources: [],
      chunks: [],
      assertions: [],
      counts: { sources: 0, chunks: 0, assertions: 0, assertion_links: 0, usage_events: 0 },
      pagination: { limit, offset, count: 0 }
    };
  }

  const [chunks, assertions, usageEvents] = await Promise.all([
    pool.query(
      `
        SELECT
          id,
          knowledge_source_id,
          chunk_index,
          left(chunk_text, 500) AS chunk_preview,
          token_count,
          embedding_status,
          metadata,
          created_at
        FROM knowledge_chunks
        WHERE knowledge_source_id = ANY($1::uuid[])
        ORDER BY knowledge_source_id, chunk_index
        LIMIT 200
      `,
      [sourceIds]
    ),
    pool.query(
      `
        SELECT
          ka.id,
          ka.knowledge_source_id,
          ka.assertion_text,
          ka.assertion_type,
          ka.valid_from,
          ka.valid_to,
          ka.confidence,
          ka.status,
          ka.evidence,
          ka.metadata,
          ka.created_at,
          ka.updated_at,
          COALESCE(link_counts.link_count, 0)::int AS link_count
        FROM knowledge_assertions ka
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS link_count
          FROM knowledge_assertion_links kal
          WHERE kal.knowledge_assertion_id = ka.id
        ) link_counts ON true
        WHERE ka.knowledge_source_id = ANY($1::uuid[])
        ORDER BY ka.status, ka.assertion_type, ka.created_at DESC
        LIMIT 200
      `,
      [sourceIds]
    ),
    pool.query(
      `
        SELECT count(*)::int AS usage_event_count
        FROM knowledge_usage_events
        WHERE knowledge_source_id = ANY($1::uuid[])
      `,
      [sourceIds]
    )
  ]);

  const assertionLinkCount = assertions.rows.reduce((sum, row) => sum + Number(row.link_count ?? 0), 0);

  return {
    corpus_id: corpusId,
    sources: sources.rows,
    chunks: chunks.rows,
    assertions: assertions.rows,
    counts: {
      sources: sources.rowCount ?? sources.rows.length,
      chunks: chunks.rowCount ?? chunks.rows.length,
      assertions: assertions.rowCount ?? assertions.rows.length,
      assertion_links: assertionLinkCount,
      usage_events: Number(usageEvents.rows[0]?.usage_event_count ?? 0)
    },
    pagination: { limit, offset, count: sources.rowCount ?? sources.rows.length }
  };
}

export async function listPulseLiveCorpus(corpusId: string, filters: DataOsCorpusFilters = {}) {
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const result = await pool.query(
    `
      WITH filtered_mentions AS (
        SELECT
          m.id,
          m.external_id,
          m.source_system,
          m.source_file_id,
          m.text_clean,
          m.text_snippet,
          m.title,
          m.language,
          m.published_at,
          m.platform,
          m.resolved_platform,
          m.content_type,
          m.url,
          m.country,
          m.engagement,
          m.sentiment_source,
          m.sentiment_score,
          m.quality_score,
          m.inclusion_status,
          m.quality_flags,
          m.raw_metadata,
          count(*) OVER()::int AS total_count
        FROM mentions m
        WHERE m.study_corpus_id = $1
          AND ($2::text IS NULL OR m.platform = $2 OR m.resolved_platform = $2)
          AND ($3::text IS NULL OR m.source_system = $3 OR m.content_type = $3)
          AND ($4::text IS NULL OR m.inclusion_status = $4)
          AND (
            $5::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM report_periods rp
              WHERE rp.id::text = $5
                AND rp.study_corpus_id = m.study_corpus_id
                AND m.published_at::date >= rp.period_start
                AND m.published_at::date <= rp.period_end
            )
          )
          AND (
            $6::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM signal_observation_evidence soe
              JOIN signal_observations so ON so.id = soe.signal_observation_id
              WHERE soe.mention_id = m.id
                AND so.study_corpus_id = m.study_corpus_id
                AND so.canonical_signal_id::text = $6
            )
          )
          AND (
            $7::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM record_tags rt
              JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
              JOIN taxonomies tx ON tx.id = tt.taxonomy_id
              WHERE rt.study_corpus_id = $1
                AND rt.subject_type = 'mention'
                AND rt.subject_id = m.id
                AND tx.taxonomy_key = $7
                AND ($8::text IS NULL OR tt.term_key = $8 OR tt.label = $8 OR rt.value = $8)
            )
          )
          AND (
            $8::text IS NULL
            OR $7::text IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM record_tags rt
              JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
              WHERE rt.study_corpus_id = $1
                AND rt.subject_type = 'mention'
                AND rt.subject_id = m.id
                AND (tt.term_key = $8 OR tt.label = $8 OR rt.value = $8)
            )
          )
          AND (
            $9::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM record_tags rt
              JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
              JOIN taxonomies tx ON tx.id = tt.taxonomy_id
              WHERE rt.study_corpus_id = $1
                AND rt.subject_type = 'mention'
                AND rt.subject_id = m.id
                AND tx.taxonomy_key = 'signal_lifecycle'
                AND (tt.term_key = $9 OR tt.label = $9 OR rt.value = $9)
            )
          )
          AND (
            $10::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM record_tags rt
              JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
              JOIN taxonomies tx ON tx.id = tt.taxonomy_id
              WHERE rt.study_corpus_id = $1
                AND rt.subject_type = 'mention'
                AND rt.subject_id = m.id
                AND tx.taxonomy_key = 'audience'
                AND (tt.term_key = $10 OR tt.label = $10 OR rt.value = $10)
            )
          )
          AND (
            $11::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM record_tags rt
              JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
              JOIN taxonomies tx ON tx.id = tt.taxonomy_id
              WHERE rt.study_corpus_id = $1
                AND rt.subject_type = 'mention'
                AND rt.subject_id = m.id
                AND tx.taxonomy_key = 'journey_stage'
                AND (tt.term_key = $11 OR tt.label = $11 OR rt.value = $11)
            )
          )
          AND (
            $12::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM record_tags rt
              JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
              JOIN taxonomies tx ON tx.id = tt.taxonomy_id
              WHERE rt.study_corpus_id = $1
                AND rt.subject_type = 'mention'
                AND rt.subject_id = m.id
                AND tx.taxonomy_key = 'demographic'
                AND (tt.term_key = $12 OR tt.label = $12 OR rt.value = $12)
            )
          )
          AND (
            $13::text IS NULL
            OR m.text_clean ILIKE '%' || $13 || '%'
            OR COALESCE(m.text_snippet, '') ILIKE '%' || $13 || '%'
            OR COALESCE(m.title, '') ILIKE '%' || $13 || '%'
          )
        ORDER BY m.published_at DESC, m.id
        LIMIT $14 OFFSET $15
      )
      SELECT
        fm.id,
        fm.external_id,
        fm.source_system,
        fm.source_file_id,
        fm.text_clean,
        fm.text_snippet,
        fm.title,
        fm.language,
        fm.published_at,
        fm.platform,
        fm.resolved_platform,
        fm.content_type,
        fm.url,
        fm.country,
        fm.engagement,
        fm.sentiment_source,
        fm.sentiment_score,
        fm.quality_score,
        fm.inclusion_status,
        fm.quality_flags,
        fm.raw_metadata,
        fm.total_count,
        COALESCE(tags.tags, '[]'::jsonb) AS tags,
        COALESCE(signals.signals, '[]'::jsonb) AS signals
      FROM filtered_mentions fm
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'tag_id', rt.id,
            'taxonomy_key', tx.taxonomy_key,
            'term_key', tt.term_key,
            'label', tt.label,
            'value', rt.value,
            'score', rt.score,
            'confidence', rt.confidence,
            'source', rt.source,
            'review_status', rt.review_status
          )
          ORDER BY tx.taxonomy_key, tt.sort_order NULLS LAST, tt.label
        ) AS tags
        FROM record_tags rt
        JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
        JOIN taxonomies tx ON tx.id = tt.taxonomy_id
        WHERE rt.study_corpus_id = $1
          AND rt.subject_type = 'mention'
          AND rt.subject_id = fm.id
      ) tags ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT jsonb_build_object(
          'canonical_signal_id', cs.id,
          'signal_type', cs.signal_type,
          'canonical_title', cs.canonical_title,
          'semantic_key', cs.semantic_key
        )) AS signals
        FROM signal_observation_evidence soe
        JOIN signal_observations so ON so.id = soe.signal_observation_id
        JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
        WHERE soe.mention_id = fm.id
          AND so.study_corpus_id = $1
      ) signals ON true
      ORDER BY fm.published_at DESC, fm.id
    `,
    [
      corpusId,
      filters.platform ?? null,
      filters.sourceType ?? null,
      filters.inclusionStatus ?? null,
      filters.period ?? null,
      filters.signalId ?? null,
      filters.taxonomy ?? null,
      filters.term ?? null,
      filters.lifecycle ?? null,
      filters.audience ?? null,
      filters.journeyStage ?? null,
      filters.demographic ?? null,
      filters.query ?? null,
      limit,
      offset
    ]
  );

  return {
    corpus_id: corpusId,
    mentions: result.rows.map((row) => {
      const mention = { ...row };
      delete mention.total_count;
      return mention;
    }),
    pagination: {
      limit,
      offset,
      count: result.rowCount ?? result.rows.length,
      total: Number(result.rows[0]?.total_count ?? 0)
    }
  };
}

export async function getPulseLiveData(outputId: string, corpusId: string, options: PulseLiveVisibilityOptions = {}) {
  const periods = await pool.query(
    `
      SELECT id, granularity, period_start, period_end, label, coverage, comparable,
             comparability_reasons, confidence, known_gaps, computed_at
      FROM report_periods
      WHERE study_corpus_id = $1
      ORDER BY period_start
    `,
    [corpusId]
  );
  const signals = await pool.query(
    `
      SELECT
        cs.id,
        cs.methodology_slug,
        cs.signal_type,
        cs.canonical_title,
        cs.semantic_key,
        cs.description,
        cs.dimensions,
        cs.status,
        cs.first_seen_at,
        cs.last_seen_at,
        latest_metrics.period_id,
        latest_metrics.volume,
        latest_metrics.engagement,
        latest_metrics.impact_v1,
        latest_metrics.sentiment_score,
        latest_metrics.polarity_bucket,
        latest_metrics.dominant_emotion,
        latest_metrics.source_mix,
        latest_metrics.evidence_count,
        latest_metrics.delta_prev,
        latest_metrics.delta_window_avg,
        latest_metrics.rank,
        latest_metrics.lifecycle_state,
        latest_metrics.confidence
      FROM canonical_signals cs
      LEFT JOIN LATERAL (
        SELECT spm.*
        FROM signal_period_metrics spm
        JOIN report_periods rp ON rp.id = spm.period_id
        WHERE spm.canonical_signal_id = cs.id
        ORDER BY rp.period_start DESC
        LIMIT 1
      ) latest_metrics ON true
      WHERE cs.study_corpus_id = $1
        AND cs.methodology_slug = 'signal-pulse'
      ORDER BY latest_metrics.impact_v1 DESC NULLS LAST, cs.updated_at DESC
      LIMIT 200
    `,
    [corpusId]
  );
  const refs = await pool.query(
    `
      SELECT id, ref_key, source_type, source_id, filters, visibility, created_at
      FROM dashboard_data_refs
      WHERE output_id = $1
      ORDER BY ref_key
    `,
    [outputId]
  );
  const health = await getDataOsSourceHealth(corpusId);

  const live = {
    output_id: outputId,
    corpus_id: corpusId,
    mode: "live",
    periods: periods.rows,
    signals: signals.rows,
    dashboard_data_refs: refs.rows,
    source_health: health.summary
  };

  return options.visibility ? applyPulseLiveVisibility(live, options.visibility) : live;
}

export async function listPulseLiveMetrics(corpusId: string, filters: DataOsMetricFilters = {}) {
  const limit = filters.limit ?? 200;
  const offset = filters.offset ?? 0;
  const result = await pool.query(
    `
      SELECT
        spm.id,
        spm.canonical_signal_id,
        cs.canonical_title,
        cs.signal_type,
        spm.period_id,
        rp.label AS period_label,
        rp.period_start,
        spm.volume,
        spm.engagement,
        spm.impact_v1,
        spm.sentiment_score,
        spm.polarity_bucket,
        spm.dominant_emotion,
        spm.source_mix,
        spm.evidence_count,
        spm.confidence,
        spm.delta_prev,
        spm.delta_window_avg,
        spm.rank,
        spm.lifecycle_state,
        spm.computed_at
      FROM signal_period_metrics spm
      JOIN canonical_signals cs ON cs.id = spm.canonical_signal_id
      JOIN report_periods rp ON rp.id = spm.period_id
      WHERE spm.study_corpus_id = $1
        AND ($2::text IS NULL OR spm.period_id::text = $2)
        AND ($3::text IS NULL OR spm.canonical_signal_id::text = $3)
      ORDER BY rp.period_start DESC, spm.rank NULLS LAST, spm.impact_v1 DESC NULLS LAST
      LIMIT $4 OFFSET $5
    `,
    [corpusId, filters.period ?? null, filters.signalId ?? null, limit, offset]
  );

  return {
    corpus_id: corpusId,
    metrics: result.rows,
    pagination: { limit, offset, count: result.rowCount ?? result.rows.length }
  };
}
