import "dotenv/config";

import {
  buildSignalMentionDrillDownPlanV1,
  buildSignalMetricMaterializationPlanV1,
  signalDefaultWorkspaceHomeFilterV1,
  signalFiltersHashV1,
  type SignalFilterV1
} from "@noisia/query-engine";
import pg from "pg";

import {
  getDatabaseSslConfig,
  requireSafeDatabaseReadTarget
} from "../seeds/connection.js";

type StoredRow = {
  metric_key: string;
  metric_version: number;
  study_corpus_id: string;
  period_start: string;
  period_end: string;
  normalized_filter: SignalFilterV1;
  typed_payload: Record<string, unknown>;
  value: string | null;
  denominator: string | null;
  sample_size: number;
  materialization_state: string;
};

type ScopeRow = {
  study_corpus_id: string;
  timezone: string;
  date_from: string | null;
  date_through: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const workspaceId = required("NOISIA_SIGNAL_WORKSPACE_ID");
  if (!UUID.test(workspaceId)) throw new Error("NOISIA_SIGNAL_WORKSPACE_ID must be a UUID.");
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "signal:v2:reconcile",
    allowRemoteEnv: "NOISIA_SIGNAL_V2_RECONCILE_ALLOW_REMOTE"
  });
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });
  try {
    const scope = await pool.query<ScopeRow>(
      `SELECT membership.study_corpus_id::text,
         workspace.timezone,
         MIN((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_from,
         MAX((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_through
       FROM signal_workspaces workspace
       JOIN signal_workspace_corpora membership
         ON membership.workspace_id = workspace.id
        AND membership.role = 'operational'
        AND membership.valid_to IS NULL
       LEFT JOIN mentions mention
         ON mention.study_corpus_id = membership.study_corpus_id
        AND mention.inclusion_status = 'included'
       WHERE workspace.id = $1::uuid
         AND workspace.status = 'active'
       GROUP BY membership.study_corpus_id, workspace.timezone`,
      [workspaceId]
    );
    if (scope.rows.length !== 1) {
      throw new Error("Signal workspace must have exactly one active operational corpus.");
    }
    const workspaceScope = scope.rows[0] as ScopeRow;
    const filter = signalDefaultWorkspaceHomeFilterV1(
      workspaceScope.date_from,
      workspaceScope.date_through,
      workspaceScope.timezone
    );
    if (!filter) throw new Error("Signal workspace has no included mentions for the canonical home filter.");
    const filtersHash = signalFiltersHashV1(filter);
    const stored = await pool.query<StoredRow>(
      `SELECT materialization.metric_key,
         materialization.metric_version,
         materialization.study_corpus_id::text,
         materialization.period_start::text,
         materialization.period_end::text,
         materialization.normalized_filter,
         materialization.typed_payload,
         materialization.value::text,
         materialization.denominator::text,
         materialization.sample_size,
         materialization.materialization_state
       FROM metric_materializations materialization
       WHERE materialization.workspace_id = $1::uuid
         AND materialization.study_corpus_id = $2::uuid
         AND materialization.filters_hash = $3
         AND materialization.cache_scope = 'default'
         AND materialization.granularity = $4
       ORDER BY materialization.metric_key, materialization.metric_version,
         materialization.period_start, materialization.period_end`,
      [workspaceId, workspaceScope.study_corpus_id, filtersHash, filter.granularity]
    );
    if (!stored.rows.length) throw new Error("No canonical home Signal materializations are available.");

    const checks = [];
    for (const rows of groupStoredRows(stored.rows).values()) {
      const first = rows[0] as StoredRow;
      const plan = buildSignalMetricMaterializationPlanV1({
        metric_key: first.metric_key,
        metric_version: first.metric_version,
        filter,
        study_corpus_ids: [workspaceScope.study_corpus_id]
      });
      const base = await pool.query<{
        period_start: string;
        period_end: string;
        value: string | null;
        denominator: string | null;
        sample_size: number | string;
        typed_payload: Record<string, unknown>;
      }>(plan.sql, plan.params);
      const baseByPeriod = new Map(base.rows.map((row) => [periodKey(row), row]));
      const storedByPeriod = new Map(rows.map((row) => [periodKey(row), row]));
      const seriesShapeMatches =
        rows.length === base.rows.length
        && rows.every((row) => baseByPeriod.has(periodKey(row)))
        && base.rows.every((row) => storedByPeriod.has(periodKey(row)));
      const valuesMatch = rows.every((row) => {
        const baseRow = baseByPeriod.get(periodKey(row));
        return numericEqual(row.value, baseRow?.value ?? null);
      });
      const denominatorsMatch = rows.every((row) => {
        const baseRow = baseByPeriod.get(periodKey(row));
        return numericEqual(row.denominator, baseRow?.denominator ?? null);
      });
      const sampleSizesMatch = rows.every((row) => {
        const baseRow = baseByPeriod.get(periodKey(row));
        return Number(row.sample_size) === Number(baseRow?.sample_size ?? -1);
      });
      const breakdownRows = rows.filter((row) => Array.isArray(row.typed_payload?.buckets));
      const breakdownPayloadsMatch = breakdownRows.every((row) => {
        const baseRow = baseByPeriod.get(periodKey(row));
        return canonicalJson(row.typed_payload.buckets)
          === canonicalJson(baseRow?.typed_payload?.buckets);
      });
      const drillDownPeriod = rows.at(-1) as StoredRow;
      const periodFilter: SignalFilterV1 = {
        ...filter,
        date_range: {
          start: drillDownPeriod.period_start,
          end: drillDownPeriod.period_end
        }
      };
      const drillDown = buildSignalMentionDrillDownPlanV1({
        filter: periodFilter,
        study_corpus_ids: [workspaceScope.study_corpus_id],
        metric_key: first.metric_key,
        limit: 100
      });
      const drill = await pool.query(drillDown.sql, drillDown.params);
      const drillDownMatches = drill.rows.length === Math.min(Number(drillDownPeriod.sample_size), 101);
      checks.push({
        metric_key: first.metric_key,
        metric_version: first.metric_version,
        series_periods_checked: rows.length,
        series_shape_matches: seriesShapeMatches,
        base_values_match: valuesMatch,
        denominators_match: denominatorsMatch,
        sample_sizes_match: sampleSizesMatch,
        breakdown_periods_checked: breakdownRows.length,
        breakdown_payloads_match: breakdownPayloadsMatch,
        no_pending_materializations: rows.every((row) => row.materialization_state !== "pending"),
        drill_down_matches_bounded_page: drillDownMatches
      });
    }
    const failures = checks.filter((check) =>
      !check.series_shape_matches
      || !check.base_values_match
      || !check.denominators_match
      || !check.sample_sizes_match
      || !check.breakdown_payloads_match
      || !check.no_pending_materializations
      || !check.drill_down_matches_bounded_page
    );
    console.log(JSON.stringify({
      ok: failures.length === 0,
      identifiers_redacted: true,
      metrics_checked: checks.length,
      series_periods_checked: checks.reduce((sum, check) => sum + check.series_periods_checked, 0),
      breakdown_periods_checked: checks.reduce((sum, check) => sum + check.breakdown_periods_checked, 0),
      drill_down_pages_checked: checks.length,
      checks,
      failures: failures.map((failure) => `${failure.metric_key}@${failure.metric_version}`)
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function numericEqual(left: string | number | null, right: string | number | null) {
  if (left == null || right == null) return left == null && right == null;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;
}

function groupStoredRows(rows: StoredRow[]) {
  const groups = new Map<string, StoredRow[]>();
  for (const row of rows) {
    const key = `${row.metric_key}@${row.metric_version}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function periodKey(row: { period_start: string; period_end: string }) {
  return `${row.period_start}:${row.period_end}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
