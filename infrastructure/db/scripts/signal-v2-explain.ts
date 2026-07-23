import "dotenv/config";

import {
  buildSignalMentionDrillDownPlanV1,
  buildSignalMetricMaterializationPlanV1,
  type SignalFilterV1
} from "@noisia/query-engine";
import pg from "pg";

import {
  getDatabaseSslConfig,
  isLocalDatabaseUrl,
  requireSafeDatabaseReadTarget
} from "../seeds/connection.js";

const MAX_TOTAL_COST = 500_000;
const MAX_EXECUTION_MS = 2_000;

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const workspaceId = required("NOISIA_SIGNAL_WORKSPACE_ID");
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "signal:v2:explain",
    allowRemoteEnv: "NOISIA_SIGNAL_V2_EXPLAIN_ALLOW_REMOTE"
  });
  const analyze = process.env.NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE === "true";
  if (
    analyze
    && !isLocalDatabaseUrl(databaseUrl)
    && process.env.NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED !== "true"
  ) {
    throw new Error(
      "NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=true is required for remote timing."
    );
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });
  try {
    const scope = await pool.query<{
      corpus_id: string;
      normalized_filter: SignalFilterV1;
      included_mentions: number;
    }>(
      `SELECT materialization.study_corpus_id::text AS corpus_id,
         materialization.normalized_filter,
         (
           SELECT COUNT(*)::integer FROM mentions mention
           WHERE mention.study_corpus_id = materialization.study_corpus_id
             AND mention.inclusion_status = 'included'
         ) AS included_mentions
       FROM metric_materializations materialization
       WHERE materialization.workspace_id = $1::uuid
         AND materialization.cache_scope = 'default'
       ORDER BY materialization.computed_at DESC
       LIMIT 1`,
      [workspaceId]
    );
    const selected = scope.rows[0];
    if (!selected) throw new Error("No default Signal materialization exists for EXPLAIN.");
    const metricPlan = buildSignalMetricMaterializationPlanV1({
      metric_key: "conversation.volume",
      filter: selected.normalized_filter,
      study_corpus_ids: [selected.corpus_id]
    });
    const drill = buildSignalMentionDrillDownPlanV1({
      metric_key: "conversation.volume",
      filter: selected.normalized_filter,
      study_corpus_ids: [selected.corpus_id],
      limit: 50
    });
    const queries = [
      { key: "materialization", sql: metricPlan.sql, params: metricPlan.params },
      { key: "drill_down", sql: drill.sql, params: drill.params },
      {
        key: "series_serving",
        sql: `SELECT metric_key, metric_version, period_start, period_end, value,
            denominator, sample_size, materialization_state
          FROM metric_materializations
          WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
            AND filters_hash = $3 AND granularity = $4
          ORDER BY period_start`,
        params: [
          workspaceId,
          selected.corpus_id,
          metricPlan.predicate.filters_hash,
          selected.normalized_filter.granularity
        ]
      },
      {
        key: "facets",
        sql: `SELECT COALESCE(resolved_platform, platform) AS platform,
            COUNT(*)::integer AS mentions
          FROM mentions
          WHERE study_corpus_id = $1::uuid
            AND inclusion_status = 'included'
            AND published_at >= $2::date
            AND published_at < ($3::date + 1)
          GROUP BY COALESCE(resolved_platform, platform)
          ORDER BY mentions DESC, platform
          LIMIT 100`,
        params: [
          selected.corpus_id,
          selected.normalized_filter.date_range.start,
          selected.normalized_filter.date_range.end
        ]
      },
      {
        key: "release_history",
        sql: `SELECT id, status, period_start, period_end, published_at
          FROM signal_workspace_releases
          WHERE workspace_id = $1::uuid
          ORDER BY period_end DESC, created_at DESC
          LIMIT 50`,
        params: [workspaceId]
      }
    ];
    const plans = [];
    for (const query of queries) {
      const explained = await pool.query(
        `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) ${query.sql}`,
        query.params
      );
      const root = explained.rows[0]?.["QUERY PLAN"]?.[0] ?? {};
      const plan = root.Plan ?? {};
      const totalCost = Number(plan["Total Cost"] ?? 0);
      const executionMs = analyze ? Number(root["Execution Time"] ?? 0) : null;
      plans.push({
        key: query.key,
        total_cost: totalCost,
        plan_rows: Number(plan["Plan Rows"] ?? 0),
        execution_ms: executionMs,
        within_budget:
          totalCost <= MAX_TOTAL_COST
          && (executionMs === null || executionMs <= MAX_EXECUTION_MS),
        node_types: collectNodeTypes(plan)
      });
    }
    const indexes = await pool.query<{ indexrelname: string }>(
      `SELECT indexrelname
       FROM pg_stat_user_indexes
       WHERE indexrelname = ANY($1::text[])
       ORDER BY indexrelname`,
      [[
        "idx_metric_materializations_signal_facade",
        "idx_mentions_signal_facets",
        "idx_record_tags_signal_approved_subject"
      ]]
    );
    const indexNames = indexes.rows.map((row) => row.indexrelname);
    const representativeVolume = Number(selected.included_mentions) >= 1_000;
    const ok =
      analyze
      && representativeVolume
      && plans.every((plan) => plan.within_budget)
      && indexNames.length === 3;
    console.log(JSON.stringify({
      ok,
      identifiers_redacted: true,
      analyze,
      representative_volume: representativeVolume,
      included_mentions: Number(selected.included_mentions),
      budgets: { max_total_cost: MAX_TOTAL_COST, max_execution_ms: MAX_EXECUTION_MS },
      indexes_present: indexNames,
      plans
    }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function collectNodeTypes(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const value = input as Record<string, unknown>;
  const own = typeof value["Node Type"] === "string" ? [value["Node Type"]] : [];
  const nested = Array.isArray(value.Plans)
    ? value.Plans.flatMap((plan) => collectNodeTypes(plan))
    : [];
  return Array.from(new Set([...own, ...nested])).sort();
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
