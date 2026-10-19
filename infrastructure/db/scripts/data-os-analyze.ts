import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const ANALYZE_TABLES = [
  "data_sources",
  "source_sync_runs",
  "performance_records",
  "report_periods",
  "canonical_signals",
  "signal_observations",
  "signal_observation_evidence",
  "signal_period_metrics",
  "chart_aggregates",
  "data_assets",
  "data_asset_fields",
  "data_contracts",
  "data_quality_results",
  "brand_os_profiles",
  "brand_os_objectives",
  "brand_os_briefs",
  "brand_os_seed_sets",
  "brand_os_seed_terms",
  "brand_knowledge_sources",
  "knowledge_chunks",
  "knowledge_assertions",
  "taxonomies",
  "taxonomy_terms",
  "tagging_rule_sets",
  "tagging_model_versions",
  "record_tags",
  "record_feature_values",
  "lineage_edges",
  "analysis_artifacts",
  "analysis_evidence_groups",
  "analysis_evidence_links",
  "analysis_artifact_relations",
  "analysis_artifact_review_events",
  "published_output_artifacts",
  "metric_definitions",
  "semantic_models",
  "metric_materializations",
  "dashboard_data_refs",
  "published_outputs",
  "mentions"
];

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = process.env.NOISIA_DATA_OS_BACKFILL_CORPUS_ID?.trim() || null;

  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "data-os:analyze",
    allowRemoteEnv: "NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  const analyzedTables: string[] = [];
  const startedAt = Date.now();
  await client.connect();
  try {
    for (const table of ANALYZE_TABLES) {
      await client.query(`ANALYZE ${quoteIdentifier(table)}`);
      analyzedTables.push(table);
    }
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    ok: true,
    corpus_id: corpusId,
    operation: "data-os:analyze",
    analyzed_tables: analyzedTables,
    tables_analyzed: analyzedTables.length,
    duration_ms: Date.now() - startedAt,
    ready_for_serving_reads: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
