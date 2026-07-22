import "dotenv/config";

import { buildSignalMetricMaterializationPlanV1 } from "@noisia/query-engine";
import { Pool } from "pg";

import { getDatabaseSslConfig, isLocalDatabaseUrl, requireSafeDatabaseReadTarget } from "../seeds/connection.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for signal:materialization:explain.");
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "signal:materialization:explain",
    allowRemoteEnv: "NOISIA_SIGNAL_EXPLAIN_ALLOW_REMOTE"
  });
  const analyze = process.env.NOISIA_SIGNAL_EXPLAIN_ANALYZE === "true";
  if (analyze && !isLocalDatabaseUrl(databaseUrl)) {
    throw new Error("NOISIA_SIGNAL_EXPLAIN_ANALYZE=true is allowed only for a local Postgres target.");
  }
  const pool = new Pool({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });
  try {
    const fixture = await pool.query<{
      corpus_id: string;
      timezone: string;
      date_from: string;
      date_through: string;
    }>(`
      SELECT membership.study_corpus_id::text AS corpus_id, workspace.timezone,
        GREATEST(MAX((mention.published_at AT TIME ZONE workspace.timezone)::date) - 29, MIN((mention.published_at AT TIME ZONE workspace.timezone)::date))::text AS date_from,
        MAX((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_through
      FROM signal_workspaces workspace
      JOIN signal_workspace_corpora membership
        ON membership.workspace_id = workspace.id AND membership.valid_to IS NULL
       AND membership.role IN ('operational', 'legacy')
      JOIN mentions mention
        ON mention.study_corpus_id = membership.study_corpus_id
       AND mention.inclusion_status = 'included'
      WHERE workspace.status = 'active'
      GROUP BY membership.study_corpus_id, workspace.timezone
      ORDER BY MAX(mention.published_at) DESC
      LIMIT 1
    `);
    const selected = fixture.rows[0];
    if (!selected) throw new Error("No active Signal workspace with included mentions is available for EXPLAIN.");
    const plan = buildSignalMetricMaterializationPlanV1({
      metric_key: "conversation.volume",
      study_corpus_ids: [selected.corpus_id],
      filter: {
        date_range: { start: selected.date_from, end: selected.date_through },
        timezone: selected.timezone,
        granularity: "day",
        dimensions: {}
      }
    });
    const explain = await pool.query(
      `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) ${plan.sql}`,
      plan.params
    );
    const root = explain.rows[0]?.["QUERY PLAN"]?.[0];
    console.log(JSON.stringify({
      ok: true,
      analyze,
      metric_key: plan.metric.key,
      filters_hash: plan.predicate.filters_hash,
      plan: redactPlan(root?.Plan ?? root ?? null),
      identifiers_redacted: true
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function redactPlan(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, "[redacted-uuid]");
  }
  if (Array.isArray(value)) return value.map(redactPlan);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPlan(item)]));
  }
  return value;
}
