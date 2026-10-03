import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseReadTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type EvidenceRow = {
  output_id: string;
  output_title: string;
  output_status: string;
  output_kind: string;
  output_methodology_slug: string;
  output_published_at: string | null;
  output_updated_at: string;
  output_corpus_id: string;
  corpus_id: string;
  corpus_name: string | null;
  corpus_status: string;
  brand_id: string | null;
  brand_name: string | null;
  theme_id: string | null;
  theme_name: string | null;
  payload_periods: number;
  payload_signals: number;
  payload_chart_refs: number;
  total_mentions: number;
  included_mentions: number;
  data_sources: number;
  active_data_sources: number;
  performance_records: number;
  report_periods: number;
  canonical_signals: number;
  signal_period_metrics: number;
  chart_aggregates: number;
  data_assets: number;
  data_asset_fields: number;
  data_assets_without_fields: number;
  data_contracts: number;
  data_quality_results: number;
  data_quality_failed: number;
  data_quality_warnings: number;
  lineage_edges: number;
  source_lineage_edges: number;
  asset_lineage_edges: number;
  dashboard_lineage_edges: number;
  taxonomies: number;
  taxonomy_terms: number;
  tagging_rule_sets: number;
  tagging_model_versions_with_rule_set: number;
  record_tags: number;
  record_tags_unreviewed: number;
  record_tags_with_evidence: number;
  record_tags_low_confidence: number;
  record_tag_taxonomies: number;
  record_tags_demographic: number;
  tag_review_events: number;
  record_feature_values: number;
  brand_os_profiles: number;
  brand_os_objectives: number;
  brand_os_audiences: number;
  brand_os_briefs: number;
  brand_os_seed_terms: number;
  brand_os_links: number;
  knowledge_chunks: number;
  knowledge_assertions: number;
  knowledge_assertions_candidate: number;
  knowledge_assertions_with_evidence: number;
  knowledge_assertion_links: number;
  knowledge_assertion_review_events: number;
  knowledge_usage_events: number;
  dashboard_refs_with_source_id: number;
  dashboard_refs: string[];
};

const REQUIRED_DASHBOARD_REFS = ["chart_aggregates", "corpus", "metrics", "sources"];
const ARCHITECTURE_DECISION = {
  benchmark_doc: "docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md",
  product_category: "customer_intelligence_lakehouse_cdp_like",
  primary_store_cut_1: "supabase_postgres_drizzle",
  cdp_boundary: "not_customer_360_identity_resolution_or_reverse_etl",
  serving_contract: "live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback"
};

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function statusIcon(ok: boolean) {
  return ok ? "pass" : "fail";
}

function addMinimumFailure(failures: string[], label: string, actual: number, minimum: number) {
  if (actual < minimum) failures.push(`${label} expected >= ${minimum}, found ${actual}`);
}

async function loadEvidenceRow(client: pg.Client, corpusId: string, outputId: string) {
  const result = await client.query<EvidenceRow>(
    `
      SELECT
        po.id AS output_id,
        po.title AS output_title,
        po.status AS output_status,
        po.kind AS output_kind,
        po.methodology_slug AS output_methodology_slug,
        po.published_at::text AS output_published_at,
        po.updated_at::text AS output_updated_at,
        po.study_corpus_id AS output_corpus_id,
        sc.id AS corpus_id,
        sc.name AS corpus_name,
        sc.status AS corpus_status,
        po.brand_id,
        COALESCE(b.display_name, b.name) AS brand_name,
        po.theme_id,
        t.name AS theme_name,
        jsonb_array_length(
          CASE WHEN jsonb_typeof(po.payload->'periods') = 'array' THEN po.payload->'periods' ELSE '[]'::jsonb END
        )::int AS payload_periods,
        jsonb_array_length(
          CASE WHEN jsonb_typeof(po.payload->'signals') = 'array' THEN po.payload->'signals' ELSE '[]'::jsonb END
        )::int AS payload_signals,
        (
          SELECT count(*)::int
          FROM jsonb_object_keys(
            CASE WHEN jsonb_typeof(po.payload->'chart_refs') = 'object' THEN po.payload->'chart_refs' ELSE '{}'::jsonb END
          )
        ) AS payload_chart_refs,
        (SELECT count(*)::int FROM mentions m WHERE m.study_corpus_id = sc.id) AS total_mentions,
        (
          SELECT count(*)::int
          FROM mentions m
          WHERE m.study_corpus_id = sc.id
            AND m.inclusion_status = 'included'
        ) AS included_mentions,
        (SELECT count(*)::int FROM data_sources ds WHERE ds.study_corpus_id = sc.id) AS data_sources,
        (
          SELECT count(*)::int
          FROM data_sources ds
          WHERE ds.study_corpus_id = sc.id
            AND ds.status = 'active'
        ) AS active_data_sources,
        (SELECT count(*)::int FROM performance_records pr WHERE pr.study_corpus_id = sc.id) AS performance_records,
        (SELECT count(*)::int FROM report_periods rp WHERE rp.study_corpus_id = sc.id) AS report_periods,
        (
          SELECT count(*)::int
          FROM canonical_signals cs
          WHERE cs.study_corpus_id = sc.id
            AND cs.methodology_slug = 'signal-pulse'
        ) AS canonical_signals,
        (SELECT count(*)::int FROM signal_period_metrics spm WHERE spm.study_corpus_id = sc.id) AS signal_period_metrics,
        (SELECT count(*)::int FROM chart_aggregates ca WHERE ca.study_corpus_id = sc.id) AS chart_aggregates,
        (SELECT count(*)::int FROM data_assets da WHERE da.study_corpus_id = sc.id) AS data_assets,
        (
          SELECT count(*)::int
          FROM data_asset_fields daf
          JOIN data_assets da ON da.id = daf.data_asset_id
          WHERE da.study_corpus_id = sc.id
        ) AS data_asset_fields,
        (
          SELECT count(*)::int
          FROM data_assets da
          WHERE da.study_corpus_id = sc.id
            AND NOT EXISTS (
              SELECT 1
              FROM data_asset_fields daf
              WHERE daf.data_asset_id = da.id
            )
        ) AS data_assets_without_fields,
        (
          SELECT count(*)::int
          FROM data_contracts dc
          JOIN data_assets da ON da.id = dc.data_asset_id
          WHERE da.study_corpus_id = sc.id
        ) AS data_contracts,
        (
          SELECT count(*)::int
          FROM data_quality_results dqr
          JOIN data_assets da ON da.id = dqr.data_asset_id
          WHERE da.study_corpus_id = sc.id
        ) AS data_quality_results,
        (
          SELECT count(*)::int
          FROM data_quality_results dqr
          JOIN data_assets da ON da.id = dqr.data_asset_id
          WHERE da.study_corpus_id = sc.id
            AND dqr.status = 'failed'
        ) AS data_quality_failed,
        (
          SELECT count(*)::int
          FROM data_quality_results dqr
          JOIN data_assets da ON da.id = dqr.data_asset_id
          WHERE da.study_corpus_id = sc.id
            AND dqr.status = 'warning'
        ) AS data_quality_warnings,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          JOIN data_assets da ON da.id = le.target_id
          WHERE le.target_type = 'data_asset'
            AND da.study_corpus_id = sc.id
        ) AS lineage_edges,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          JOIN data_assets da ON da.id = le.target_id
          WHERE le.target_type = 'data_asset'
            AND da.study_corpus_id = sc.id
            AND le.source_type IN ('data_source', 'source_sync_run', 'import_batch', 'brand_knowledge_source')
        ) AS source_lineage_edges,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          JOIN data_assets source_asset ON source_asset.id = le.source_id
          JOIN data_assets target_asset ON target_asset.id = le.target_id
          WHERE le.source_type = 'data_asset'
            AND le.target_type = 'data_asset'
            AND source_asset.study_corpus_id = sc.id
            AND target_asset.study_corpus_id = sc.id
        ) AS asset_lineage_edges,
        (
          SELECT count(*)::int
          FROM lineage_edges le
          WHERE (
              le.source_type = 'data_asset'
              AND le.target_type = 'dashboard_data_ref'
              AND EXISTS (
                SELECT 1 FROM dashboard_data_refs ddr
                WHERE ddr.id = le.target_id AND ddr.study_corpus_id = sc.id
              )
            )
            OR (
              le.source_type = 'dashboard_data_ref'
              AND le.target_type = 'published_output'
              AND EXISTS (
                SELECT 1 FROM dashboard_data_refs ddr
                WHERE ddr.id = le.source_id AND ddr.study_corpus_id = sc.id
              )
            )
        ) AS dashboard_lineage_edges,
        (SELECT count(*)::int FROM taxonomies tx WHERE tx.status = 'active') AS taxonomies,
        (
          SELECT count(*)::int
          FROM taxonomy_terms tt
          JOIN taxonomies tx ON tx.id = tt.taxonomy_id
          WHERE tx.status = 'active'
            AND tt.status = 'active'
        ) AS taxonomy_terms,
        (
          SELECT count(*)::int
          FROM tagging_rule_sets trs
          WHERE trs.rule_set_key = 'data_os_cut_1_deterministic_mentions'
            AND trs.version = 1
            AND trs.status = 'active'
        ) AS tagging_rule_sets,
        (
          SELECT count(*)::int
          FROM tagging_model_versions tmv
          JOIN tagging_rule_sets trs ON trs.id = tmv.tagging_rule_set_id
          WHERE tmv.model_key = 'data_os_backfill'
            AND tmv.version = 'v1'
            AND trs.rule_set_key = 'data_os_cut_1_deterministic_mentions'
            AND trs.version = 1
            AND trs.status = 'active'
        ) AS tagging_model_versions_with_rule_set,
        (SELECT count(*)::int FROM record_tags rt WHERE rt.study_corpus_id = sc.id) AS record_tags,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = sc.id
            AND rt.review_status = 'unreviewed'
        ) AS record_tags_unreviewed,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = sc.id
            AND jsonb_typeof(rt.evidence) = 'array'
            AND jsonb_array_length(rt.evidence) > 0
        ) AS record_tags_with_evidence,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = sc.id
            AND rt.confidence = 'low'
        ) AS record_tags_low_confidence,
        (
          SELECT count(DISTINCT tx.taxonomy_key)::int
          FROM record_tags rt
          JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
          JOIN taxonomies tx ON tx.id = tt.taxonomy_id
          WHERE rt.study_corpus_id = sc.id
        ) AS record_tag_taxonomies,
        (
          SELECT count(*)::int
          FROM tag_review_events tre
          JOIN record_tags rt ON rt.id = tre.record_tag_id
          WHERE rt.study_corpus_id = sc.id
        ) AS tag_review_events,
        (
          SELECT count(*)::int
          FROM record_tags rt
          JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
          JOIN taxonomies tx ON tx.id = tt.taxonomy_id
          WHERE rt.study_corpus_id = sc.id
            AND rt.subject_type = 'mention'
            AND tx.taxonomy_key = 'demographic'
        ) AS record_tags_demographic,
        (SELECT count(*)::int FROM record_feature_values rfv WHERE rfv.study_corpus_id = sc.id) AS record_feature_values,
        (
          SELECT count(*)::int
          FROM brand_os_profiles bop
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS brand_os_profiles,
        (
          SELECT count(*)::int
          FROM brand_os_objectives boo
          JOIN brand_os_profiles bop ON bop.id = boo.brand_os_profile_id
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS brand_os_objectives,
        (
          SELECT count(*)::int
          FROM brand_os_audiences boa
          JOIN brand_os_profiles bop ON bop.id = boa.brand_os_profile_id
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS brand_os_audiences,
        (
          SELECT count(*)::int
          FROM brand_os_briefs bob
          JOIN brand_os_profiles bop ON bop.id = bob.brand_os_profile_id
          WHERE bob.study_corpus_id = sc.id
            AND (
              (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
              OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
            )
        ) AS brand_os_briefs,
        (
          SELECT count(*)::int
          FROM brand_os_seed_terms bost
          JOIN brand_os_seed_sets boss ON boss.id = bost.seed_set_id
          JOIN brand_os_profiles bop ON bop.id = boss.brand_os_profile_id
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS brand_os_seed_terms,
        (
          SELECT count(*)::int
          FROM brand_os_links bol
          JOIN brand_os_profiles bop ON bop.id = bol.brand_os_profile_id
          WHERE (po.brand_id IS NOT NULL AND bop.brand_id = po.brand_id)
             OR (po.theme_id IS NOT NULL AND bop.theme_id = po.theme_id)
        ) AS brand_os_links,
        (
          SELECT count(*)::int
          FROM knowledge_chunks kc
          JOIN brand_knowledge_sources bks ON bks.id = kc.knowledge_source_id
          WHERE bks.study_corpus_id = sc.id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS knowledge_chunks,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = sc.id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS knowledge_assertions,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE ka.status = 'candidate'
            AND (
              bks.study_corpus_id = sc.id
              OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS knowledge_assertions_candidate,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE jsonb_typeof(ka.evidence) = 'array'
            AND jsonb_array_length(ka.evidence) > 0
            AND (
              bks.study_corpus_id = sc.id
              OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS knowledge_assertions_with_evidence,
        (
          SELECT count(*)::int
          FROM knowledge_assertion_links kal
          JOIN knowledge_assertions ka ON ka.id = kal.knowledge_assertion_id
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = sc.id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS knowledge_assertion_links,
        (
          SELECT count(*)::int
          FROM knowledge_assertion_review_events kare
          JOIN knowledge_assertions ka ON ka.id = kare.knowledge_assertion_id
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = sc.id
             OR (po.brand_id IS NOT NULL AND bks.brand_id = po.brand_id AND bks.study_corpus_id IS NULL)
        ) AS knowledge_assertion_review_events,
        (
          SELECT count(*)::int
          FROM knowledge_usage_events kue
          WHERE kue.metadata->>'corpus_id' = sc.id::text
        ) AS knowledge_usage_events,
        ARRAY(
          SELECT ddr.ref_key
          FROM dashboard_data_refs ddr
          WHERE ddr.output_id = po.id
          ORDER BY ddr.ref_key
        ) AS dashboard_refs,
        (
          SELECT count(*)::int
          FROM dashboard_data_refs ddr
          WHERE ddr.output_id = po.id
            AND ddr.source_id IS NOT NULL
        ) AS dashboard_refs_with_source_id
      FROM published_outputs po
      JOIN study_corpora sc ON sc.id = po.study_corpus_id
      LEFT JOIN brands b ON b.id = po.brand_id
      LEFT JOIN themes t ON t.id = po.theme_id
      WHERE po.id = $1
        AND sc.id = $2
    `,
    [outputId, corpusId]
  );

  return result.rows[0] ?? null;
}

function buildReport(row: EvidenceRow, generatedAt: string) {
  const counts = {
    payload_periods: numberValue(row.payload_periods),
    payload_signals: numberValue(row.payload_signals),
    payload_chart_refs: numberValue(row.payload_chart_refs),
    total_mentions: numberValue(row.total_mentions),
    included_mentions: numberValue(row.included_mentions),
    data_sources: numberValue(row.data_sources),
    active_data_sources: numberValue(row.active_data_sources),
    performance_records: numberValue(row.performance_records),
    report_periods: numberValue(row.report_periods),
    canonical_signals: numberValue(row.canonical_signals),
    signal_period_metrics: numberValue(row.signal_period_metrics),
    chart_aggregates: numberValue(row.chart_aggregates),
    data_assets: numberValue(row.data_assets),
    data_asset_fields: numberValue(row.data_asset_fields),
    data_assets_without_fields: numberValue(row.data_assets_without_fields),
    data_contracts: numberValue(row.data_contracts),
    data_quality_results: numberValue(row.data_quality_results),
    data_quality_failed: numberValue(row.data_quality_failed),
    data_quality_warnings: numberValue(row.data_quality_warnings),
    lineage_edges: numberValue(row.lineage_edges),
    source_lineage_edges: numberValue(row.source_lineage_edges),
    asset_lineage_edges: numberValue(row.asset_lineage_edges),
    dashboard_lineage_edges: numberValue(row.dashboard_lineage_edges),
    taxonomies: numberValue(row.taxonomies),
    taxonomy_terms: numberValue(row.taxonomy_terms),
    tagging_rule_sets: numberValue(row.tagging_rule_sets),
    tagging_model_versions_with_rule_set: numberValue(row.tagging_model_versions_with_rule_set),
    record_tags: numberValue(row.record_tags),
    record_tags_unreviewed: numberValue(row.record_tags_unreviewed),
    record_tags_with_evidence: numberValue(row.record_tags_with_evidence),
    record_tags_low_confidence: numberValue(row.record_tags_low_confidence),
    record_tag_taxonomies: numberValue(row.record_tag_taxonomies),
    record_tags_demographic: numberValue(row.record_tags_demographic),
    tag_review_events: numberValue(row.tag_review_events),
    record_feature_values: numberValue(row.record_feature_values),
    brand_os_profiles: numberValue(row.brand_os_profiles),
    brand_os_objectives: numberValue(row.brand_os_objectives),
    brand_os_audiences: numberValue(row.brand_os_audiences),
    brand_os_briefs: numberValue(row.brand_os_briefs),
    brand_os_seed_terms: numberValue(row.brand_os_seed_terms),
    brand_os_links: numberValue(row.brand_os_links),
    knowledge_chunks: numberValue(row.knowledge_chunks),
    knowledge_assertions: numberValue(row.knowledge_assertions),
    knowledge_assertions_candidate: numberValue(row.knowledge_assertions_candidate),
    knowledge_assertions_with_evidence: numberValue(row.knowledge_assertions_with_evidence),
    knowledge_assertion_links: numberValue(row.knowledge_assertion_links),
    knowledge_assertion_review_events: numberValue(row.knowledge_assertion_review_events),
    knowledge_usage_events: numberValue(row.knowledge_usage_events),
    dashboard_refs_with_source_id: numberValue(row.dashboard_refs_with_source_id),
    dashboard_refs: row.dashboard_refs.length
  };

  const failures: string[] = [];
  const warnings: string[] = [];
  if (row.output_corpus_id !== row.corpus_id) failures.push("Output and corpus id do not match.");
  if (row.output_kind !== "signal_pulse" || row.output_methodology_slug !== "signal-pulse") {
    failures.push(`Output must be Signal Pulse; found kind=${row.output_kind}, methodology=${row.output_methodology_slug}.`);
  }
  if (!["published", "ready", "draft"].includes(row.output_status)) {
    warnings.push(`Output status is ${row.output_status}; expected published/ready/draft.`);
  }

  addMinimumFailure(failures, "included_mentions", counts.included_mentions, 1);
  addMinimumFailure(failures, "report_periods", counts.report_periods, 1);
  addMinimumFailure(failures, "canonical_signals", counts.canonical_signals, 1);
  addMinimumFailure(failures, "signal_period_metrics", counts.signal_period_metrics, 1);
  addMinimumFailure(failures, "data_assets", counts.data_assets, 10);
  addMinimumFailure(failures, "data_asset_fields", counts.data_asset_fields, 50);
  addMinimumFailure(failures, "data_contracts", counts.data_contracts, 10);
  addMinimumFailure(failures, "data_quality_results", counts.data_quality_results, 10);
  addMinimumFailure(failures, "lineage_edges", counts.lineage_edges, 9);
  addMinimumFailure(failures, "source_lineage_edges", counts.source_lineage_edges, 1);
  addMinimumFailure(failures, "asset_lineage_edges", counts.asset_lineage_edges, 1);
  addMinimumFailure(failures, "dashboard_lineage_edges", counts.dashboard_lineage_edges, 4);
  addMinimumFailure(failures, "taxonomies", counts.taxonomies, 10);
  addMinimumFailure(failures, "taxonomy_terms", counts.taxonomy_terms, 1);
  addMinimumFailure(failures, "tagging_rule_sets", counts.tagging_rule_sets, 1);
  addMinimumFailure(failures, "tagging_model_versions_with_rule_set", counts.tagging_model_versions_with_rule_set, 1);
  addMinimumFailure(failures, "record_tags", counts.record_tags, 1);
  addMinimumFailure(failures, "record_tags_with_evidence", counts.record_tags_with_evidence, counts.record_tags);
  addMinimumFailure(failures, "record_tag_taxonomies", counts.record_tag_taxonomies, 5);
  addMinimumFailure(failures, "record_feature_values", counts.record_feature_values, 1);
  addMinimumFailure(failures, "brand_os_profiles", counts.brand_os_profiles, 1);
  addMinimumFailure(failures, "brand_os_objectives", counts.brand_os_objectives, 1);
  addMinimumFailure(failures, "brand_os_briefs", counts.brand_os_briefs, 1);
  addMinimumFailure(failures, "brand_os_links", counts.brand_os_links, 3);
  addMinimumFailure(failures, "knowledge_assertion_links", counts.knowledge_assertion_links, 3);
  addMinimumFailure(failures, "knowledge_assertions_with_evidence", counts.knowledge_assertions_with_evidence, counts.knowledge_assertions);
  addMinimumFailure(failures, "knowledge_usage_events", counts.knowledge_usage_events, 3);

  if (counts.data_quality_failed > 0) failures.push(`Data quality has ${counts.data_quality_failed} failed result(s).`);
  if (counts.data_assets_without_fields > 0) failures.push(`Data catalog has ${counts.data_assets_without_fields} asset(s) without field catalog rows.`);
  if (counts.report_periods < counts.payload_periods) {
    failures.push(`Live report periods are behind published payload: ${counts.report_periods}/${counts.payload_periods}.`);
  }
  if (counts.canonical_signals < counts.payload_signals) {
    failures.push(`Live canonical signals are behind published payload: ${counts.canonical_signals}/${counts.payload_signals}.`);
  }
  if (counts.dashboard_refs < counts.payload_chart_refs) {
    failures.push(`Live dashboard refs are behind published payload chart refs: ${counts.dashboard_refs}/${counts.payload_chart_refs}.`);
  }
  if (counts.data_quality_warnings > 0) warnings.push(`Data quality has ${counts.data_quality_warnings} warning result(s).`);
  if (counts.data_sources === 0) warnings.push("No data_sources rows are registered for this corpus.");
  if (counts.active_data_sources === 0) warnings.push("No active data_sources rows are registered for this corpus.");
  if (counts.performance_records === 0) warnings.push("No structured performance_records exist for this corpus.");
  if (counts.knowledge_chunks === 0) warnings.push("Knowledge Catalog has no chunks for this output scope.");
  if (counts.knowledge_assertions === 0) warnings.push("Knowledge Catalog has no assertions for this output scope.");
  if (counts.brand_os_audiences === 0) warnings.push("Brand OS has no audiences for this output scope.");
  if (counts.brand_os_seed_terms === 0) warnings.push("Brand OS has no seed terms for this output scope.");

  const dashboardRefs = new Set(row.dashboard_refs);
  const missingDashboardRefs = REQUIRED_DASHBOARD_REFS.filter((ref) => !dashboardRefs.has(ref));
  if (missingDashboardRefs.length > 0) failures.push(`Missing dashboard_data_refs: ${missingDashboardRefs.join(", ")}.`);
  addMinimumFailure(failures, "dashboard_refs_with_source_id", counts.dashboard_refs_with_source_id, REQUIRED_DASHBOARD_REFS.length);

  const gates = {
    signal_pulse_output: row.output_kind === "signal_pulse" && row.output_methodology_slug === "signal-pulse",
    corpus_match: row.output_corpus_id === row.corpus_id,
    live_signal_tables: counts.report_periods > 0 && counts.canonical_signals > 0 && counts.signal_period_metrics > 0,
    data_catalog:
      counts.data_assets >= 10
      && counts.data_asset_fields >= 50
      && counts.data_assets_without_fields === 0
      && counts.data_contracts >= 10,
    quality_clean: counts.data_quality_results >= 10 && counts.data_quality_failed === 0,
    lineage_present:
      counts.lineage_edges >= 9
      && counts.source_lineage_edges > 0
      && counts.asset_lineage_edges > 0
      && counts.dashboard_lineage_edges >= 4,
    taxonomy_catalog: counts.taxonomies >= 10 && counts.taxonomy_terms > 0,
    tagging_present:
      counts.tagging_rule_sets > 0
      && counts.tagging_model_versions_with_rule_set > 0
      && counts.record_tags > 0
      && counts.record_feature_values > 0,
    tag_assertion_review_queue:
      counts.record_tags > 0
      && counts.record_tags_with_evidence >= counts.record_tags
      && counts.record_tag_taxonomies >= 5
      && counts.knowledge_assertions > 0
      && counts.knowledge_assertions_with_evidence >= counts.knowledge_assertions,
    brand_os_present:
      counts.brand_os_profiles > 0
      && counts.brand_os_objectives > 0
      && counts.brand_os_briefs > 0
      && counts.brand_os_links >= 3,
    knowledge_catalog_linked:
      counts.knowledge_assertions > 0
      && counts.knowledge_assertion_links >= 3
      && counts.knowledge_usage_events >= 3,
    dashboard_refs_complete: missingDashboardRefs.length === 0 && counts.dashboard_refs_with_source_id >= REQUIRED_DASHBOARD_REFS.length,
    live_payload_parity:
      counts.report_periods >= counts.payload_periods
      && counts.canonical_signals >= counts.payload_signals
      && counts.dashboard_refs >= counts.payload_chart_refs,
    payload_fallback_required: true
  };

  const readyForPrReview = failures.length === 0;
  const readyForInternalShadow = failures.length === 0 && warnings.length === 0;

  return {
    ok: readyForPrReview,
    generated_at: generatedAt,
    output: {
      id: row.output_id,
      title: row.output_title,
      status: row.output_status,
      kind: row.output_kind,
      methodology_slug: row.output_methodology_slug,
      published_at: row.output_published_at,
      updated_at: row.output_updated_at
    },
    corpus: {
      id: row.corpus_id,
      name: row.corpus_name,
      status: row.corpus_status
    },
    subject: {
      brand_id: row.brand_id,
      brand_name: row.brand_name,
      theme_id: row.theme_id,
      theme_name: row.theme_name
    },
    counts,
    dashboard_refs: row.dashboard_refs,
    missing_dashboard_refs: missingDashboardRefs,
    architecture_decision: ARCHITECTURE_DECISION,
    review_queue: {
      ready_for_human_review: failures.length === 0
        && counts.record_tags_with_evidence >= counts.record_tags
        && counts.knowledge_assertions_with_evidence >= counts.knowledge_assertions,
      required_before_client_visible: true,
      record_tags_total: counts.record_tags,
      record_tags_with_evidence: counts.record_tags_with_evidence,
      record_tags_unreviewed: counts.record_tags_unreviewed,
      record_tags_low_confidence: counts.record_tags_low_confidence,
      record_tag_taxonomies: counts.record_tag_taxonomies,
      tag_review_events: counts.tag_review_events,
      knowledge_assertions_total: counts.knowledge_assertions,
      knowledge_assertions_candidate: counts.knowledge_assertions_candidate,
      knowledge_assertions_with_evidence: counts.knowledge_assertions_with_evidence,
      knowledge_assertion_review_events: counts.knowledge_assertion_review_events,
      note: "Deterministic tags and candidate knowledge assertions must be sampled by a human before client-visible activation."
    },
    gates,
    failures,
    warnings,
    ready_for_pr_review: readyForPrReview,
    ready_for_internal_shadow: readyForInternalShadow,
    required_attached_outputs: [
      "corepack pnpm data-os:verify",
      "corepack pnpm data-os:candidates",
      "corepack pnpm data-os:shadow-run",
      "corepack pnpm data-os:analyze",
      "corepack pnpm data-os:serving-smoke"
    ],
    next_flags: {
      NOISIA_DATA_OS_ENABLED: "true",
      NOISIA_DATA_OS_SERVING_ENABLED: "true",
      NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
      NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
      NOISIA_DATA_OS_SHADOW_MODE: "true"
    },
    rollback_flags: {
      NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
      NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "false",
      NOISIA_DATA_OS_SERVING_ENABLED: "false",
      NOISIA_DATA_OS_ENABLED: "false",
      NOISIA_DATA_OS_SHADOW_MODE: "true"
    }
  };
}

function formatMarkdown(report: ReturnType<typeof buildReport>) {
  const gateRows = Object.entries(report.gates)
    .map(([gate, value]) => `| ${gate} | ${statusIcon(Boolean(value))} |`)
    .join("\n");
  const countRows = Object.entries(report.counts)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
  const failures = report.failures.length > 0 ? report.failures.map((item) => `- ${item}`).join("\n") : "- none";
  const warnings = report.warnings.length > 0 ? report.warnings.map((item) => `- ${item}`).join("\n") : "- none";

  return [
    "# Noisia Data OS PR Evidence",
    "",
    `Generated at: ${report.generated_at}`,
    `Output: ${report.output.title} (id redacted)`,
    `Corpus: ${report.corpus.name ?? "untitled"} (id redacted)`,
    "Identifiers: redacted for PR; use local `evidence.json` in the `.data` evidence pack for audit only.",
    `Ready for PR review: ${report.ready_for_pr_review}`,
    `Ready for internal shadow: ${report.ready_for_internal_shadow}`,
    "",
    "## Architecture Decision",
    "",
    `Benchmark: \`${report.architecture_decision.benchmark_doc}\``,
    `Product category: \`${report.architecture_decision.product_category}\``,
    `Primary store Cut 1: \`${report.architecture_decision.primary_store_cut_1}\``,
    `CDP boundary: \`${report.architecture_decision.cdp_boundary}\``,
    `Serving contract: \`${report.architecture_decision.serving_contract}\``,
    "",
    "## Review Queue",
    "",
    `Ready for human review: ${report.review_queue.ready_for_human_review}`,
    `Required before client-visible activation: ${report.review_queue.required_before_client_visible}`,
    `Record tags with evidence: ${report.review_queue.record_tags_with_evidence}/${report.review_queue.record_tags_total}`,
    `Record tags unreviewed: ${report.review_queue.record_tags_unreviewed}`,
    `Low-confidence record tags: ${report.review_queue.record_tags_low_confidence}`,
    `Tag taxonomies covered: ${report.review_queue.record_tag_taxonomies}`,
    `Tag review events: ${report.review_queue.tag_review_events}`,
    `Knowledge assertions with evidence: ${report.review_queue.knowledge_assertions_with_evidence}/${report.review_queue.knowledge_assertions_total}`,
    `Candidate knowledge assertions: ${report.review_queue.knowledge_assertions_candidate}`,
    `Knowledge assertion review events: ${report.review_queue.knowledge_assertion_review_events}`,
    "",
    "## Gates",
    "",
    "| Gate | Status |",
    "|---|---|",
    gateRows,
    "",
    "## Counts",
    "",
    "| Metric | Count |",
    "|---|---:|",
    countRows,
    "",
    "## Failures",
    "",
    failures,
    "",
    "## Warnings",
    "",
    warnings,
    "",
    "## Required Attached Outputs",
    "",
    ...report.required_attached_outputs.map((item) => `- \`${item}\``),
    "",
    "## Next Flags",
    "",
    "```json",
    JSON.stringify(report.next_flags, null, 2),
    "```",
    "",
    "## Rollback Flags",
    "",
    "```json",
    JSON.stringify(report.rollback_flags, null, 2),
    "```"
  ].join("\n");
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = requireEnv("NOISIA_DATA_OS_BACKFILL_CORPUS_ID");
  const outputId = requireEnv("NOISIA_DATA_OS_SHADOW_OUTPUT_ID");
  const format = process.env.NOISIA_DATA_OS_EVIDENCE_FORMAT === "markdown" ? "markdown" : "json";
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "data-os:evidence",
    allowRemoteEnv: "NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    const row = await loadEvidenceRow(client, corpusId, outputId);
    if (!row) throw new Error(`Signal Pulse output/corpus pair not found: output=${outputId}, corpus=${corpusId}`);
    const report = buildReport(row, new Date().toISOString());
    if (format === "markdown") {
      console.log(formatMarkdown(report));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }

    if (!report.ready_for_pr_review) {
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
