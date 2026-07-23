import "dotenv/config";

import {
  buildSignalMentionDrillDownPlanV1,
  buildSignalMetricMaterializationPlanV1,
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
  value: string | null;
  denominator: string | null;
  sample_size: number;
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
    const stored = await pool.query<StoredRow>(
      `SELECT DISTINCT ON (materialization.metric_key, materialization.metric_version)
         materialization.metric_key,
         materialization.metric_version,
         materialization.study_corpus_id::text,
         materialization.period_start::text,
         materialization.period_end::text,
         materialization.normalized_filter,
         materialization.value::text,
         materialization.denominator::text,
         materialization.sample_size
       FROM metric_materializations materialization
       WHERE materialization.workspace_id = $1::uuid
         AND materialization.cache_scope = 'default'
         AND materialization.materialization_state <> 'pending'
       ORDER BY materialization.metric_key, materialization.metric_version,
         materialization.computed_at DESC, materialization.period_end DESC`,
      [workspaceId]
    );
    if (!stored.rows.length) throw new Error("No default Signal materializations are available.");

    const checks = [];
    for (const row of stored.rows) {
      const plan = buildSignalMetricMaterializationPlanV1({
        metric_key: row.metric_key,
        metric_version: row.metric_version,
        filter: row.normalized_filter,
        study_corpus_ids: [row.study_corpus_id]
      });
      const base = await pool.query<{
        period_start: string;
        period_end: string;
        value: string | null;
        denominator: string | null;
        sample_size: number | string;
      }>(plan.sql, plan.params);
      const baseRow = base.rows.find((item) =>
        item.period_start === row.period_start && item.period_end === row.period_end
      );
      const filter: SignalFilterV1 = {
        ...row.normalized_filter,
        date_range: { start: row.period_start, end: row.period_end }
      };
      const drillDown = buildSignalMentionDrillDownPlanV1({
        filter,
        study_corpus_ids: [row.study_corpus_id],
        metric_key: row.metric_key,
        limit: 100
      });
      const drill = await pool.query(drillDown.sql, drillDown.params);
      const valueMatches = numericEqual(row.value, baseRow?.value ?? null);
      const denominatorMatches = numericEqual(row.denominator, baseRow?.denominator ?? null);
      const sampleMatches = Number(row.sample_size) === Number(baseRow?.sample_size ?? -1);
      const drillDownMatches = drill.rows.length === Math.min(Number(row.sample_size), 101);
      checks.push({
        metric_key: row.metric_key,
        metric_version: row.metric_version,
        base_value_matches: valueMatches,
        denominator_matches: denominatorMatches,
        sample_size_matches: sampleMatches,
        drill_down_matches_bounded_page: drillDownMatches
      });
    }
    const failures = checks.filter((check) =>
      !check.base_value_matches
      || !check.denominator_matches
      || !check.sample_size_matches
      || !check.drill_down_matches_bounded_page
    );
    console.log(JSON.stringify({
      ok: failures.length === 0,
      identifiers_redacted: true,
      metrics_checked: checks.length,
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

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
