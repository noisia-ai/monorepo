import type { Job } from "bullmq";
import type { QueryResult } from "pg";

import {
  buildSignalMetricMaterializationPlanV1,
  buildSignalPrecomputedFiltersV1,
  dataWatermarkHashV1,
  evaluateSignalMetricQualityV1,
  normalizeSignalFilterV1,
  SIGNAL_METRIC_DEFINITIONS_V1,
  SIGNAL_INTERPRETATION_CONTRACT_VERSION,
  SIGNAL_INTERPRETATION_JOB_NAME,
  SIGNAL_INTERPRETATION_PROMPT_VERSION,
  SIGNAL_MATERIALIZATION_MAX_CACHED_FILTERS_PER_RUN,
  signalDefaultWorkspaceHomeFilterV1,
  signalMetricMaterializationKeyV1,
  signalInterpretationIdempotencyKeyV1,
  splitSignalMaterializationDateRangeV1,
  validateDataWatermarkV1,
  type DataWatermarkV1,
  type SignalFilterV1,
  type SignalGranularityV1,
  type SignalMaterializationRowV1,
  type SignalMaterializeJobDataV1
} from "@noisia/query-engine";

import { pool } from "../db/client";
import { prioritizeSignalMaterializationFiltersV1 } from "./signal-materialization-filters";

type WorkspaceScope = {
  workspace_id: string;
  study_corpus_id: string;
  timezone: string;
};

type WatermarkRow = {
  id: string;
  corpus_revision: number;
  last_source_sync_run_id: string | null;
  last_import_batch_id: string | null;
  max_observed_at: Date | null;
  accepted_at: Date;
  data_freshness_state: "fresh" | "stale" | "partial" | "not_available";
  stale_after: Date | null;
};

const MATERIALIZATION_WRITE_BATCH_SIZE = 100;

export async function signalMaterializationJob(job: Job<SignalMaterializeJobDataV1>) {
  const client = await pool.connect();
  const lockKey = `signal-materialize:${job.data.workspace_id}:${job.data.study_corpus_id}`;
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [lockKey]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) throw new Error("signal_materialization_lock_unavailable");

    const scopeResult = await client.query<WorkspaceScope>(`
      SELECT workspace.id::text AS workspace_id,
        membership.study_corpus_id::text,
        workspace.timezone
      FROM signal_workspaces workspace
      JOIN signal_workspace_corpora membership
        ON membership.workspace_id = workspace.id
       AND membership.valid_to IS NULL
      WHERE workspace.id = $1::uuid
        AND membership.study_corpus_id = $2::uuid
        AND membership.role IN ('operational', 'legacy')
        AND workspace.status = 'active'
      LIMIT 1
    `, [job.data.workspace_id, job.data.study_corpus_id]);
    const scope = scopeResult.rows[0];
    if (!scope) return { state: "not_available", reason: "workspace_corpus_scope_not_available" };

    const requestedFilter = job.data.trigger === "ad_hoc" ? normalizeSignalFilterV1(job.data.filter) : null;
    const affectedFrom = requestedFilter?.date_range.start ?? (job.data.trigger === "invalidation" ? job.data.affected_from : null);
    const affectedThrough = requestedFilter?.date_range.end ?? (job.data.trigger === "invalidation" ? job.data.affected_through : null);
    const windowResult = await client.query<{ date_from: string | null; date_through: string | null }>(`
      SELECT
        COALESCE($3::date, MIN((published_at AT TIME ZONE $2)::date))::text AS date_from,
        COALESCE($4::date, MAX((published_at AT TIME ZONE $2)::date))::text AS date_through
      FROM mentions
      WHERE study_corpus_id = $1::uuid
        AND inclusion_status = 'included'
        AND ($3::date IS NULL OR (published_at AT TIME ZONE $2)::date >= $3::date)
        AND ($4::date IS NULL OR (published_at AT TIME ZONE $2)::date <= $4::date)
    `, [scope.study_corpus_id, scope.timezone, affectedFrom, affectedThrough]);
    const window = windowResult.rows[0];
    if (!window?.date_from || !window.date_through || window.date_from > window.date_through) {
      return { state: "not_available", reason: "no_included_mentions_in_window" };
    }

    const watermarkRows = await client.query<WatermarkRow>(`
      SELECT id::text, corpus_revision, last_source_sync_run_id::text,
        last_import_batch_id::text, max_observed_at, accepted_at,
        data_freshness_state, stale_after
      FROM signal_data_watermarks
      WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
      ORDER BY accepted_at DESC, id
    `, [scope.workspace_id, scope.study_corpus_id]);
    if (watermarkRows.rows.length === 0) {
      return { state: "not_available", reason: "data_watermark_not_available" };
    }
    const now = new Date();
    const watermark = combinedWatermark(scope, watermarkRows.rows, now);
    const watermarkHash = dataWatermarkHashV1(watermark);
    const latestWatermarkId = watermarkRows.rows[0]?.id as string;
    const freshness = combinedFreshness(watermarkRows.rows, now);
    const staleAfter = earliestStaleAfter(watermarkRows.rows);

    const coverageResult = await client.query<{ date_from: string | null; date_through: string | null }>(`
      SELECT
        MIN((published_at AT TIME ZONE $2)::date)::text AS date_from,
        MAX((published_at AT TIME ZONE $2)::date)::text AS date_through
      FROM mentions
      WHERE study_corpus_id = $1::uuid
        AND inclusion_status = 'included'
    `, [scope.study_corpus_id, scope.timezone]);
    const coverage = coverageResult.rows[0];

    const facetsResult = await client.query<{
      platforms: string[] | null;
      source_types: string[] | null;
      countries: string[] | null;
      languages: string[] | null;
    }>(`
      SELECT
        (SELECT array_agg(value ORDER BY value) FROM (
          SELECT DISTINCT lower(COALESCE(resolved_platform, platform)) AS value
          FROM mentions WHERE study_corpus_id = $1::uuid AND inclusion_status = 'included'
            AND (published_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
          ORDER BY value LIMIT 20
        ) values) AS platforms,
        (SELECT array_agg(value ORDER BY value) FROM (
          SELECT DISTINCT lower(source_system) AS value
          FROM mentions WHERE study_corpus_id = $1::uuid AND inclusion_status = 'included'
            AND (published_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
          ORDER BY value LIMIT 20
        ) values) AS source_types,
        (SELECT array_agg(value ORDER BY value) FROM (
          SELECT DISTINCT lower(country) AS value
          FROM mentions WHERE study_corpus_id = $1::uuid AND inclusion_status = 'included' AND country IS NOT NULL
            AND (published_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
          ORDER BY value LIMIT 20
        ) values) AS countries,
        (SELECT array_agg(value ORDER BY value) FROM (
          SELECT DISTINCT lower(language) AS value
          FROM mentions WHERE study_corpus_id = $1::uuid AND inclusion_status = 'included' AND language IS NOT NULL
            AND (published_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
          ORDER BY value LIMIT 20
        ) values) AS languages
    `, [scope.study_corpus_id, scope.timezone, window.date_from, window.date_through]);
    const facets = facetsResult.rows[0];
    const homeFilter = signalDefaultWorkspaceHomeFilterV1(
      coverage?.date_from ?? null,
      coverage?.date_through ?? null,
      scope.timezone
    );
    const dateWindows = requestedFilter
      ? [requestedFilter.date_range]
      : Array.from(new Map([
          homeFilter?.date_range,
          ...splitSignalMaterializationDateRangeV1({
            start: window.date_from,
            end: window.date_through
          })
        ].filter((range): range is { start: string; end: string } => Boolean(range))
          .map((range) => [`${range.start}:${range.end}`, range])).values());

    const definitions = await client.query<{ id: string; metric_key: string; version: number }>(`
      SELECT id::text, metric_key, version
      FROM metric_definitions
      WHERE status = 'active' AND (metric_key, version) IN (
        SELECT metric_key, MAX(version) FROM metric_definitions
        WHERE metric_group_key IS NOT NULL GROUP BY metric_key
      )
    `);
    const definitionIds = new Map(definitions.rows.map((row) => [`${row.metric_key}@${row.version}`, row.id]));
    const semanticModel = await client.query<{ id: string }>(`
      SELECT id::text FROM semantic_models
      WHERE model_key = 'signal_social_listening_v1' AND status = 'active'
      LIMIT 1
    `);
    const semanticModelId = semanticModel.rows[0]?.id ?? null;

    const cachedFilters = requestedFilter ? [] : (await client.query<{ normalized_filter: SignalFilterV1 }>(`
      SELECT normalized_filter
      FROM (
        SELECT DISTINCT normalized_filter
        FROM metric_materializations
        WHERE workspace_id = $1::uuid
          AND study_corpus_id = $2::uuid
          AND materialization_state <> 'pending'
          AND normalized_filter IS NOT NULL
          AND ($3::date IS NULL OR period_end >= $3::date)
          AND ($4::date IS NULL OR period_start <= $4::date)
          AND (cache_scope <> 'ad_hoc' OR expires_at > now())
      ) cached
      ORDER BY cached.normalized_filter::text
      LIMIT $5::int
    `, [
      scope.workspace_id,
      scope.study_corpus_id,
      affectedFrom,
      affectedThrough,
      SIGNAL_MATERIALIZATION_MAX_CACHED_FILTERS_PER_RUN
    ])).rows.map((row) => normalizeSignalFilterV1(row.normalized_filter));

    const generatedFilters = dateWindows.flatMap((dateRange) => {
      const baseFilter: SignalFilterV1 = {
        contract_version: "signal-backend-v1",
        date_range: dateRange,
        timezone: scope.timezone,
        granularity: "day",
        dimensions: {}
      };
      const filters = buildSignalPrecomputedFiltersV1(baseFilter, {
        platform: facets?.platforms ?? [],
        source_type: facets?.source_types ?? [],
        country: facets?.countries ?? [],
        language: facets?.languages ?? []
      });
      return (["day", "week", "month"] as SignalGranularityV1[])
        .flatMap((granularity) => filters.map((filter) => ({ ...filter, granularity })));
    });
    const uniqueFilters = requestedFilter
      ? [requestedFilter]
      : prioritizeSignalMaterializationFiltersV1({
          home_filter: homeFilter,
          cached_filters: cachedFilters,
          generated_filters: generatedFilters
        });

    await client.query("BEGIN");
    let rowsWritten = 0;
    let plansExecuted = 0;
    const interpretationScopes = new Map<string, { metricGroupKey: string; filter: SignalFilterV1; filtersHash: string }>();
    const requestedMetricKeys = new Set(job.data.trigger === "ad_hoc" ? job.data.metric_keys : []);
    for (const normalizedFilter of uniqueFilters) {
        const granularity = normalizedFilter.granularity;
        const requestedDimensions = new Set(Object.keys(normalizedFilter.dimensions));
        for (const metric of SIGNAL_METRIC_DEFINITIONS_V1) {
          if (requestedMetricKeys.size > 0 && !requestedMetricKeys.has(metric.key)) continue;
          if (Array.from(requestedDimensions).some((dimension) => !metric.dimensions.some((item) => item.key === dimension))) {
            continue;
          }
          const definitionId = definitionIds.get(`${metric.key}@${metric.version}`);
          if (!definitionId) throw new Error(`signal_metric_definition_missing:${metric.key}@${metric.version}`);
          const plan = buildSignalMetricMaterializationPlanV1({
            metric_key: metric.key,
            metric_version: metric.version,
            filter: normalizedFilter,
            study_corpus_ids: [scope.study_corpus_id]
          });
          interpretationScopes.set(`${metric.group}:${plan.predicate.filters_hash}`, {
            metricGroupKey: metric.group,
            filter: plan.predicate.normalized_filter,
            filtersHash: plan.predicate.filters_hash
          });
          let result: QueryResult<SignalMaterializationRowV1>;
          try {
            result = await client.query<SignalMaterializationRowV1>(plan.sql, plan.params);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(
              `signal_materialization_plan_failed:${metric.key}:${granularity}:${plan.predicate.filters_hash}:${detail}`
            );
          }
          plansExecuted += 1;
          const materializationRows = result.rows.map((row) => {
            const quality = evaluateSignalMetricQualityV1({
              metric,
              row,
              data_freshness: freshness
            });
            const state = effectiveState(row.materialization_state, freshness, quality.state);
            const qualityState = quality.state;
            const typedPayload = {
              ...row.typed_payload,
              quality_rule_results: quality.results
            };
            const materializationKey = signalMetricMaterializationKeyV1({
              workspace_id: scope.workspace_id,
              study_corpus_id: scope.study_corpus_id,
              metric_key: metric.key,
              metric_version: metric.version,
              granularity,
              period_start: row.period_start,
              period_end: row.period_end,
              filters_hash: plan.predicate.filters_hash
            });
            return {
              workspace_id: scope.workspace_id,
              materialization_key: materializationKey,
              metric_definition_id: definitionId,
              metric_key: metric.key,
              metric_version: metric.version,
              metric_group_key: metric.group,
              semantic_model_id: semanticModelId,
              study_corpus_id: scope.study_corpus_id,
              granularity,
              period_start: row.period_start,
              period_end: row.period_end,
              normalized_filter: plan.predicate.normalized_filter,
              filters_hash: plan.predicate.filters_hash,
              typed_payload: typedPayload,
              value: row.value,
              denominator: row.denominator,
              sample_size: Number(row.sample_size),
              quality_state: qualityState,
              data_watermark_id: latestWatermarkId,
              data_watermark: watermark,
              data_watermark_hash: watermarkHash,
              materialization_state: state,
              cache_scope: plan.cache_scope,
              stale_after: staleAfter?.toISOString() ?? null
            };
          });
          for (let offset = 0; offset < materializationRows.length; offset += MATERIALIZATION_WRITE_BATCH_SIZE) {
            const batch = materializationRows.slice(offset, offset + MATERIALIZATION_WRITE_BATCH_SIZE);
            await client.query(`
              INSERT INTO metric_materializations (
                workspace_id, materialization_key, metric_definition_id,
                metric_key, metric_version, metric_group_key, semantic_model_id,
                study_corpus_id, granularity, period_start, period_end,
                normalized_filter, filters_hash, payload, typed_payload,
                value, denominator, sample_size, quality_state,
                data_watermark_id, data_watermark, data_watermark_hash,
                materialization_state, cache_scope, computed_at, stale_after, expires_at
              )
              SELECT
                item.workspace_id, item.materialization_key, item.metric_definition_id,
                item.metric_key, item.metric_version, item.metric_group_key, item.semantic_model_id,
                item.study_corpus_id, item.granularity, item.period_start, item.period_end,
                item.normalized_filter, item.filters_hash, item.typed_payload, item.typed_payload,
                item.value, item.denominator, item.sample_size, item.quality_state,
                item.data_watermark_id, item.data_watermark, item.data_watermark_hash,
                item.materialization_state, item.cache_scope, now(), item.stale_after,
                CASE WHEN item.cache_scope = 'ad_hoc' THEN now() + interval '15 minutes' ELSE NULL END
              FROM jsonb_to_recordset($1::jsonb) AS item(
                workspace_id uuid,
                materialization_key text,
                metric_definition_id uuid,
                metric_key text,
                metric_version integer,
                metric_group_key text,
                semantic_model_id uuid,
                study_corpus_id uuid,
                granularity text,
                period_start date,
                period_end date,
                normalized_filter jsonb,
                filters_hash text,
                typed_payload jsonb,
                value numeric,
                denominator numeric,
                sample_size integer,
                quality_state text,
                data_watermark_id uuid,
                data_watermark jsonb,
                data_watermark_hash text,
                materialization_state text,
                cache_scope text,
                stale_after timestamptz
              )
              ON CONFLICT (materialization_key) WHERE materialization_key IS NOT NULL DO UPDATE SET
                metric_definition_id = EXCLUDED.metric_definition_id,
                semantic_model_id = EXCLUDED.semantic_model_id,
                normalized_filter = EXCLUDED.normalized_filter,
                filters_hash = EXCLUDED.filters_hash,
                payload = EXCLUDED.payload,
                typed_payload = EXCLUDED.typed_payload,
                value = EXCLUDED.value,
                denominator = EXCLUDED.denominator,
                sample_size = EXCLUDED.sample_size,
                quality_state = EXCLUDED.quality_state,
                data_watermark_id = EXCLUDED.data_watermark_id,
                data_watermark = EXCLUDED.data_watermark,
                data_watermark_hash = EXCLUDED.data_watermark_hash,
                materialization_state = EXCLUDED.materialization_state,
                cache_scope = EXCLUDED.cache_scope,
                computed_at = now(), stale_after = EXCLUDED.stale_after,
                expires_at = EXCLUDED.expires_at
            `, [JSON.stringify(batch)]);
          }
          rowsWritten += materializationRows.length;
        }
    }
    await client.query(`
      UPDATE signal_data_watermarks
      SET materialized_at = $3::timestamptz, updated_at = now()
      WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
    `, [scope.workspace_id, scope.study_corpus_id, now.toISOString()]);
    if (job.data.trigger === "invalidation") {
      await client.query(`
        UPDATE signal_data_invalidations
        SET scope = scope || jsonb_build_object(
          'materialization_plans_executed', $2::int,
          'materialization_rows_written', $3::int,
          'materialization_watermark_hash', $4::text
        )
        WHERE id = $1::uuid
      `, [job.data.invalidation_id, plansExecuted, rowsWritten, watermarkHash]);
    }
    await client.query("COMMIT");
    if (process.env.NOISIA_SIGNAL_INTERPRETATIONS_ENABLED === "true") {
      const { getSignalRefreshQueue } = await import("../queues/signal-refresh");
      const modelVersion = process.env.NOISIA_SIGNAL_INTERPRETATION_MODEL ?? "claude-sonnet-4-5";
      const budgetCap = finiteBudget(process.env.NOISIA_SIGNAL_INTERPRETATION_BUDGET_CAP_USD);
      for (const interpretationScope of interpretationScopes.values()) {
        const idempotencyKey = signalInterpretationIdempotencyKeyV1({
          workspace_id: scope.workspace_id,
          metric_group_key: interpretationScope.metricGroupKey,
          metric_group_version: 1,
          filters_hash: interpretationScope.filtersHash,
          data_watermark_hash: watermarkHash,
          prompt_version: SIGNAL_INTERPRETATION_PROMPT_VERSION,
          model_version: modelVersion
        });
        await getSignalRefreshQueue().add(SIGNAL_INTERPRETATION_JOB_NAME, {
          contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
          workspace_id: scope.workspace_id,
          study_corpus_id: scope.study_corpus_id,
          metric_group_key: interpretationScope.metricGroupKey,
          metric_group_version: 1,
          filter: interpretationScope.filter,
          filters_hash: interpretationScope.filtersHash,
          data_watermark_hash: watermarkHash,
          prompt_version: SIGNAL_INTERPRETATION_PROMPT_VERSION,
          model_version: modelVersion,
          budget_cap_usd: budgetCap,
          idempotency_key: idempotencyKey
        }, {
          jobId: `signal-interpretation-${idempotencyKey.slice(-40)}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 604_800, count: 2_000 }
        });
      }
    }
    return { state: freshness, plans_executed: plansExecuted, rows_written: rowsWritten, watermark_hash: watermarkHash };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey]).catch(() => undefined);
    client.release();
  }
}

function finiteBudget(value: string | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.min(number, 100) : 0;
}

function combinedWatermark(scope: WorkspaceScope, rows: WatermarkRow[], materializedAt: Date): DataWatermarkV1 {
  const acceptedAt = new Date(Math.max(...rows.map((row) => row.accepted_at.getTime())));
  const observed = rows.flatMap((row) => row.max_observed_at ? [row.max_observed_at.getTime()] : []);
  const maxObserved = observed.length ? new Date(Math.min(Math.max(...observed), acceptedAt.getTime())) : null;
  return validateDataWatermarkV1({
    contract_version: "signal-backend-v1",
    workspace_id: scope.workspace_id,
    corpus_id: scope.study_corpus_id,
    corpus_revision: Math.max(...rows.map((row) => row.corpus_revision)),
    source_sync_run_ids: Array.from(new Set(rows.flatMap((row) => [row.last_source_sync_run_id, row.last_import_batch_id]).filter((id): id is string => Boolean(id)))),
    data_through_at: maxObserved?.toISOString() ?? null,
    accepted_at: acceptedAt.toISOString(),
    materialized_at: materializedAt.toISOString()
  });
}

function combinedFreshness(rows: WatermarkRow[], now: Date): "fresh" | "stale" | "partial" {
  if (rows.some((row) => row.data_freshness_state === "stale" || (row.stale_after && row.stale_after <= now))) return "stale";
  if (rows.some((row) => row.data_freshness_state === "partial" || row.data_freshness_state === "not_available")) return "partial";
  return "fresh";
}

function effectiveState(
  metricState: SignalMaterializationRowV1["materialization_state"],
  freshness: "fresh" | "stale" | "partial",
  quality: "pass" | "partial" | "failed" | "unknown"
) {
  if (metricState === "not_available") return metricState;
  if (quality === "failed") return "not_available" as const;
  if (freshness === "stale") return "stale" as const;
  if (freshness === "partial" || metricState === "partial" || quality === "partial") return "partial" as const;
  return "fresh" as const;
}

function earliestStaleAfter(rows: WatermarkRow[]) {
  const values = rows.flatMap((row) => row.stale_after ? [row.stale_after.getTime()] : []);
  return values.length ? new Date(Math.min(...values)) : null;
}
