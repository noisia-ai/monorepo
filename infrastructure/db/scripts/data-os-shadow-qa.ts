import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseReadTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type OutputRow = {
  id: string;
  study_corpus_id: string;
  brand_id: string | null;
  theme_id: string | null;
  methodology_slug: string;
  kind: string;
  status: string;
  title: string;
  payload: unknown;
  live_periods: number;
  live_signals: number;
  live_metrics: number;
  live_marketing_moves: number;
  live_chart_aggregates: number;
  live_included_mentions: number;
  live_data_assets: number;
  live_data_asset_fields: number;
  live_data_assets_without_fields: number;
  live_quality_results: number;
  live_quality_failed: number;
  live_quality_warnings: number;
  live_lineage_edges: number;
  live_source_lineage_edges: number;
  live_asset_lineage_edges: number;
  live_dashboard_lineage_edges: number;
  live_record_tags: number;
  live_record_feature_values: number;
  live_brand_os_profiles: number;
  live_brand_os_objectives: number;
  live_brand_os_briefs: number;
  live_brand_os_links: number;
  live_knowledge_chunks: number;
  live_knowledge_assertions: number;
  live_knowledge_assertion_links: number;
  live_knowledge_usage_events: number;
  live_taxonomies: number;
  live_tagging_rule_sets: number;
  live_tagging_model_versions_with_rule_set: number;
  live_dashboard_refs_with_source_id: number;
  live_dashboard_refs: string[];
};

const REQUIRED_DASHBOARD_REFS = ["chart_aggregates", "corpus", "metrics", "sources"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function chartRefCount(payload: Record<string, unknown>) {
  return Object.keys(asRecord(payload.chart_refs)).length;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function addMinimumFailure(failures: string[], label: string, actual: number, minimum: number) {
  if (actual < minimum) failures.push(`${label} expected >= ${minimum}, found ${actual}`);
}

async function loadOutput(client: pg.Client, outputId: string) {
  const result = await client.query<OutputRow>(
    `
      SELECT
        po.id,
        po.study_corpus_id,
        po.brand_id,
        po.theme_id,
        po.methodology_slug,
        po.kind,
        po.status,
        po.title,
        po.payload,
        (SELECT count(*)::int FROM report_periods rp WHERE rp.study_corpus_id = po.study_corpus_id) AS live_periods,
        (
          SELECT count(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = po.study_corpus_id
            AND cs.methodology_slug = 'signal-pulse'
        ) AS live_signals,
        (
          SELECT count(*)::int
          FROM signal_period_metrics spm
          WHERE spm.study_corpus_id = po.study_corpus_id
        ) AS live_metrics,
        (
          SELECT count(*)::int
          FROM marketing_moves mm
          WHERE mm.study_corpus_id = po.study_corpus_id
        ) AS live_marketing_moves,
        (
          SELECT count(*)::int
          FROM chart_aggregates ca
          WHERE ca.study_corpus_id = po.study_corpus_id
        ) AS live_chart_aggregates,
        (
          SELECT count(*)::int
          FROM mentions m
          WHERE m.study_corpus_id = po.study_corpus_id
            AND m.inclusion_status = 'included'
        ) AS live_included_mentions,
        (
          SELECT count(*)::int
          FROM data_assets da
          WHERE da.study_corpus_id = po.study_corpus_id
        ) AS live_data_assets,
        (
          SELECT count(*)::int
          FROM data_asset_fields daf
          JOIN data_assets da ON da.id = daf.data_asset_id
          WHERE da.study_corpus_id = po.study_corpus_id
        ) AS live_data_asset_fields,
        (
          SELECT count(*)::int
          FROM data_assets da
          WHERE da.study_corpus_id = po.study_corpus_id
            AND NOT EXISTS (
              SELECT 1
              FROM data_asset_fields daf
              WHERE daf.data_asset_id = da.id
            )
        ) AS live_data_assets_without_fields,
        (
          SELECT count(*)::int
          FROM data_quality_results dqr
          JOIN data_assets da ON da.id = dqr.data_asset_id
          WHERE da.study_corpus_id = po.study_corpus_id
        ) AS live_quality_results,
        (
          SELECT count(*)::int
          FROM data_quality_results dqr
          JOIN data_assets da ON da.id = dqr.data_asset_id
          WHERE da.study_corpus_id = po.study_corpus_id
            AND dqr.status = 'failed'
        ) AS live_quality_failed,
        (
          SELECT count(*)::int
          FROM data_quality_results dqr
          JOIN data_assets da ON da.id = dqr.data_asset_id
          WHERE da.study_corpus_id = po.study_corpus_id
            AND dqr.status = 'warning'
        ) AS live_quality_warnings,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          JOIN data_assets da ON da.id = le.target_id
          WHERE le.target_type = 'data_asset'
            AND da.study_corpus_id = po.study_corpus_id
        ) AS live_lineage_edges,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          JOIN data_assets da ON da.id = le.target_id
          WHERE le.target_type = 'data_asset'
            AND da.study_corpus_id = po.study_corpus_id
            AND le.source_type IN ('data_source', 'source_sync_run', 'import_batch', 'brand_knowledge_source')
        ) AS live_source_lineage_edges,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          JOIN data_assets source_asset ON source_asset.id = le.source_id
          JOIN data_assets target_asset ON target_asset.id = le.target_id
          WHERE le.source_type = 'data_asset'
            AND le.target_type = 'data_asset'
            AND source_asset.study_corpus_id = po.study_corpus_id
            AND target_asset.study_corpus_id = po.study_corpus_id
        ) AS live_asset_lineage_edges,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          WHERE (
              le.source_type = 'data_asset'
              AND le.target_type = 'dashboard_data_ref'
              AND EXISTS (
                SELECT 1 FROM dashboard_data_refs ddr
                WHERE ddr.id = le.target_id AND ddr.study_corpus_id = po.study_corpus_id
              )
            )
            OR (
              le.source_type = 'dashboard_data_ref'
              AND le.target_type = 'published_output'
              AND EXISTS (
                SELECT 1 FROM dashboard_data_refs ddr
                WHERE ddr.id = le.source_id AND ddr.study_corpus_id = po.study_corpus_id
              )
            )
        ) AS live_dashboard_lineage_edges,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = po.study_corpus_id
        ) AS live_record_tags,
        (
          SELECT count(*)::int
          FROM record_feature_values rfv
          WHERE rfv.study_corpus_id = po.study_corpus_id
        ) AS live_record_feature_values,
        (
          SELECT count(*)::int
          FROM brand_os_profiles bop
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS live_brand_os_profiles,
        (
          SELECT count(*)::int
          FROM brand_os_objectives boo
          JOIN brand_os_profiles bop ON bop.id = boo.brand_os_profile_id
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS live_brand_os_objectives,
        (
          SELECT count(*)::int
          FROM brand_os_briefs bob
          JOIN brand_os_profiles bop ON bop.id = bob.brand_os_profile_id
          WHERE bob.study_corpus_id = po.study_corpus_id
            AND (
              (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
              OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
            )
        ) AS live_brand_os_briefs,
        (
          SELECT count(*)::int
          FROM brand_os_links bol
          JOIN brand_os_profiles bop ON bop.id = bol.brand_os_profile_id
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS live_brand_os_links,
        (
          SELECT count(*)::int
          FROM knowledge_chunks kc
          JOIN brand_knowledge_sources bks ON bks.id = kc.knowledge_source_id
          WHERE bks.study_corpus_id = po.study_corpus_id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS live_knowledge_chunks,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = po.study_corpus_id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS live_knowledge_assertions,
        (
          SELECT count(*)::int
          FROM knowledge_assertion_links kal
          JOIN knowledge_assertions ka ON ka.id = kal.knowledge_assertion_id
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = po.study_corpus_id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS live_knowledge_assertion_links,
        (
          SELECT count(*)::int
          FROM knowledge_usage_events kue
          WHERE kue.metadata->>'corpus_id' = po.study_corpus_id::text
        ) AS live_knowledge_usage_events,
        (
          SELECT count(*)::int
          FROM taxonomies tx
          WHERE tx.status = 'active'
        ) AS live_taxonomies,
        (
          SELECT count(*)::int
          FROM tagging_rule_sets trs
          WHERE trs.rule_set_key = 'data_os_cut_1_deterministic_mentions'
            AND trs.version = 1
            AND trs.status = 'active'
        ) AS live_tagging_rule_sets,
        (
          SELECT count(*)::int
          FROM tagging_model_versions tmv
          JOIN tagging_rule_sets trs ON trs.id = tmv.tagging_rule_set_id
          WHERE tmv.model_key = 'data_os_backfill'
            AND tmv.version = 'v1'
            AND trs.rule_set_key = 'data_os_cut_1_deterministic_mentions'
            AND trs.version = 1
            AND trs.status = 'active'
        ) AS live_tagging_model_versions_with_rule_set,
        ARRAY(
          SELECT ddr.ref_key
          FROM dashboard_data_refs ddr
          WHERE ddr.output_id = po.id
          ORDER BY ddr.ref_key
        ) AS live_dashboard_refs,
        (
          SELECT count(*)::int
          FROM dashboard_data_refs ddr
          WHERE ddr.output_id = po.id
            AND ddr.source_id IS NOT NULL
        ) AS live_dashboard_refs_with_source_id
      FROM published_outputs po
      WHERE po.id = $1
    `,
    [outputId]
  );

  return result.rows[0] ?? null;
}

function audit(row: OutputRow) {
  const payload = asRecord(row.payload);
  const payloadCounts = {
    periods: arrayCount(payload.periods),
    signals: arrayCount(payload.signals),
    marketing_moves: arrayCount(payload.marketing_moves),
    chart_refs: chartRefCount(payload)
  };
  const liveCounts = {
    periods: numberValue(row.live_periods),
    signals: numberValue(row.live_signals),
    metrics: numberValue(row.live_metrics),
    marketing_moves: numberValue(row.live_marketing_moves),
    chart_aggregates: numberValue(row.live_chart_aggregates),
    included_mentions: numberValue(row.live_included_mentions),
    data_assets: numberValue(row.live_data_assets),
    data_asset_fields: numberValue(row.live_data_asset_fields),
    data_assets_without_fields: numberValue(row.live_data_assets_without_fields),
    quality_results: numberValue(row.live_quality_results),
    quality_failed: numberValue(row.live_quality_failed),
    quality_warnings: numberValue(row.live_quality_warnings),
    lineage_edges: numberValue(row.live_lineage_edges),
    source_lineage_edges: numberValue(row.live_source_lineage_edges),
    asset_lineage_edges: numberValue(row.live_asset_lineage_edges),
    dashboard_lineage_edges: numberValue(row.live_dashboard_lineage_edges),
    record_tags: numberValue(row.live_record_tags),
    record_feature_values: numberValue(row.live_record_feature_values),
    brand_os_profiles: numberValue(row.live_brand_os_profiles),
    brand_os_objectives: numberValue(row.live_brand_os_objectives),
    brand_os_briefs: numberValue(row.live_brand_os_briefs),
    brand_os_links: numberValue(row.live_brand_os_links),
    knowledge_chunks: numberValue(row.live_knowledge_chunks),
    knowledge_assertions: numberValue(row.live_knowledge_assertions),
    knowledge_assertion_links: numberValue(row.live_knowledge_assertion_links),
    knowledge_usage_events: numberValue(row.live_knowledge_usage_events),
    taxonomies: numberValue(row.live_taxonomies),
    tagging_rule_sets: numberValue(row.live_tagging_rule_sets),
    tagging_model_versions_with_rule_set: numberValue(row.live_tagging_model_versions_with_rule_set),
    dashboard_refs_with_source_id: numberValue(row.live_dashboard_refs_with_source_id),
    dashboard_refs: row.live_dashboard_refs.length
  };

  const failures: string[] = [];
  const warnings: string[] = [];
  if (row.methodology_slug !== "signal-pulse" || row.kind !== "signal_pulse") {
    failures.push(`Output must be Signal Pulse; found methodology=${row.methodology_slug}, kind=${row.kind}`);
  }
  if (!["published", "draft", "ready"].includes(row.status)) {
    warnings.push(`Output status is ${row.status}; expected published/draft/ready for shadow comparison.`);
  }

  addMinimumFailure(failures, "report_periods", liveCounts.periods, 1);
  addMinimumFailure(failures, "canonical_signals", liveCounts.signals, 1);
  addMinimumFailure(failures, "signal_period_metrics", liveCounts.metrics, 1);
  addMinimumFailure(failures, "included_mentions", liveCounts.included_mentions, 1);
  addMinimumFailure(failures, "data_assets", liveCounts.data_assets, 10);
  addMinimumFailure(failures, "data_asset_fields", liveCounts.data_asset_fields, 50);
  addMinimumFailure(failures, "data_quality_results", liveCounts.quality_results, 10);
  addMinimumFailure(failures, "lineage_edges", liveCounts.lineage_edges, 9);
  addMinimumFailure(failures, "source_lineage_edges", liveCounts.source_lineage_edges, 1);
  addMinimumFailure(failures, "asset_lineage_edges", liveCounts.asset_lineage_edges, 1);
  addMinimumFailure(failures, "dashboard_lineage_edges", liveCounts.dashboard_lineage_edges, 4);
  addMinimumFailure(failures, "brand_os_profiles", liveCounts.brand_os_profiles, 1);
  addMinimumFailure(failures, "brand_os_objectives", liveCounts.brand_os_objectives, 1);
  addMinimumFailure(failures, "brand_os_briefs", liveCounts.brand_os_briefs, 1);
  addMinimumFailure(failures, "brand_os_links", liveCounts.brand_os_links, 3);
  addMinimumFailure(failures, "knowledge_assertion_links", liveCounts.knowledge_assertion_links, 3);
  addMinimumFailure(failures, "knowledge_usage_events", liveCounts.knowledge_usage_events, 3);
  addMinimumFailure(failures, "taxonomies", liveCounts.taxonomies, 10);
  addMinimumFailure(failures, "tagging_rule_sets", liveCounts.tagging_rule_sets, 1);
  addMinimumFailure(failures, "tagging_model_versions_with_rule_set", liveCounts.tagging_model_versions_with_rule_set, 1);
  addMinimumFailure(failures, "record_tags", liveCounts.record_tags, 1);
  addMinimumFailure(failures, "record_feature_values", liveCounts.record_feature_values, 1);

  if (liveCounts.quality_failed > 0) failures.push(`Data quality has ${liveCounts.quality_failed} failed result(s).`);
  if (liveCounts.data_assets_without_fields > 0) failures.push(`Data catalog has ${liveCounts.data_assets_without_fields} asset(s) without field catalog rows.`);
  if (liveCounts.quality_warnings > 0) warnings.push(`Data quality has ${liveCounts.quality_warnings} warning result(s).`);
  if (liveCounts.knowledge_chunks === 0) warnings.push("Knowledge Base has no live chunks for this output scope.");
  if (liveCounts.knowledge_assertions === 0) warnings.push("Knowledge Base has no live assertions for this output scope.");

  const refs = new Set(row.live_dashboard_refs);
  const missingRefs = REQUIRED_DASHBOARD_REFS.filter((ref) => !refs.has(ref));
  if (missingRefs.length > 0) failures.push(`Missing dashboard_data_refs: ${missingRefs.join(", ")}`);
  addMinimumFailure(failures, "dashboard_refs_with_source_id", liveCounts.dashboard_refs_with_source_id, REQUIRED_DASHBOARD_REFS.length);

  if (payloadCounts.periods > 0 && liveCounts.periods < payloadCounts.periods) {
    warnings.push(`Live periods (${liveCounts.periods}) are fewer than payload periods (${payloadCounts.periods}).`);
  }
  if (payloadCounts.signals > 0 && liveCounts.signals < payloadCounts.signals) {
    warnings.push(`Live signals (${liveCounts.signals}) are fewer than payload signals (${payloadCounts.signals}).`);
  }
  if (payloadCounts.chart_refs > 0 && liveCounts.chart_aggregates < payloadCounts.chart_refs) {
    warnings.push(`Live chart aggregates (${liveCounts.chart_aggregates}) are fewer than payload chart refs (${payloadCounts.chart_refs}).`);
  }
  if (payloadCounts.periods === 0) warnings.push("Published payload has no periods; comparison is one-sided.");
  if (payloadCounts.signals === 0) warnings.push("Published payload has no signals; comparison is one-sided.");

  return {
    payload: payloadCounts,
    live: liveCounts,
    dashboard_refs: row.live_dashboard_refs,
    missing_dashboard_refs: missingRefs,
    warnings,
    failures,
    ready_for_shadow: failures.length === 0,
    ready_for_live_switch: failures.length === 0 && warnings.length === 0
  };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const outputId = requireEnv("NOISIA_DATA_OS_SHADOW_OUTPUT_ID");
  const strict = process.env.NOISIA_DATA_OS_SHADOW_STRICT === "true";
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "data-os:shadow-qa",
    allowRemoteEnv: "NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    const output = await loadOutput(client, outputId);
    if (!output) throw new Error(`Published output not found: ${outputId}`);
    const result = audit(output);
    console.log(JSON.stringify({
      ok: result.failures.length === 0 && (!strict || result.warnings.length === 0),
      output: {
        id: output.id,
        title: output.title,
        status: output.status,
        corpus_id: output.study_corpus_id,
        brand_id: output.brand_id,
        theme_id: output.theme_id
      },
      ...result
    }, null, 2));

    if (result.failures.length > 0 || (strict && result.warnings.length > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
