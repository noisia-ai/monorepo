import assert from "node:assert/strict";
import test from "node:test";

import type { DataOsCapability } from "./data-os-capabilities";
import {
  evaluateDataOsCorpusAudit,
  type DataOsCorpusAuditEvidence,
  type DataOsCorpusAuditStage
} from "./data-os-corpus-audit";

test("listening-only evidence is ready with explicit coverage warnings", () => {
  const result = evaluateDataOsCorpusAudit(evidence());

  assert.equal(result.ready_for_claude, true);
  assert.equal(result.status, "ready_with_warnings");
  assert.equal(result.blockers.length, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "optional_capabilities_missing"));
});

test("missing optional commercial data never becomes zero evidence or a blocker", () => {
  const input = evidence();
  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, true);
  assert.equal(result.capabilities.find((item) => item.key === "ecommerce_sales")?.status, "missing");
  assert.equal(result.blockers.some((blocker) => blocker.code === "optional_capabilities_missing"), false);
});

test("listening records and governed observations must reconcile exactly", () => {
  const input = evidence();
  input.observations.represented_listening_records = 3_300;

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "listening_observation_reconciliation"));
});

test("semantic unit, currency, ratio, period, and catalog failures block Claude", () => {
  const input = evidence();
  input.observations.invalid_currency_contract = 2;
  input.observations.invalid_unit_contract = 3;
  input.observations.invalid_ratio_value = 1;
  input.observations.invalid_period_contract = 4;
  input.observations.invalid_metric_mapping = 1;
  input.observations.invalid_product_catalog_time = 6;

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.deepEqual(
    new Set(result.blockers.map((blocker) => blocker.code)),
    new Set([
      "observation_currency_contract",
      "observation_unit_contract",
      "observation_ratio_contract",
      "observation_period_contract",
      "observation_metric_mapping",
      "product_catalog_time_contract"
    ])
  );
});

test("post-coding audit blocks an incomplete generic taxonomy bridge", () => {
  const input = evidence("post_coding");
  input.tb_bridge = {
    analysis_found: true,
    counts: bridgeCounts({ record_features: 90 }),
    quality: {
      status: "blocked",
      ready: false,
      warnings: ["Only 90/100 coded mentions have a governed feature record."]
    }
  };

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "tb_coding_bridge"));
});

test("post-coding audit accepts a complete analysis-scoped bridge", () => {
  const input = evidence("post_coding");
  input.tb_bridge = {
    analysis_found: true,
    counts: bridgeCounts(),
    quality: { status: "accepted", ready: true, warnings: [] }
  };

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, true);
  assert.equal(result.blockers.length, 0);
});

test("a complete uploaded source is reconciled without becoming an optional-data blocker", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([completeUploadedSource()]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, true);
  assert.equal(result.source_materializations.uploaded_sources, 1);
  assert.equal(result.source_materializations.canonical_records, 120);
  assert.equal(result.blockers.some((blocker) => blocker.code.startsWith("uploaded_source_")), false);
});

test("an uploaded source with missing canonical rows blocks Claude with a file-level cause", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([
    completeUploadedSource({
      file_name: "sales.csv",
      expected_source_rows: 120,
      expected_materialized_rows: 120,
      active_asset_rows: 80,
      canonical_records: 80,
      accepted_records: 80,
      complete_record_lineage: 80
    })
  ]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.ok(result.blockers.some((blocker) =>
    blocker.code === "uploaded_source_record_reconciliation"
      && blocker.message.startsWith("sales.csv:")
  ));
});

test("an optional source that was never uploaded remains unknown instead of failing readiness", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, true);
  assert.equal(result.source_materializations.uploaded_sources, 0);
  assert.equal(result.capabilities.find((item) => item.key === "ecommerce_sales")?.status, "missing");
});

test("uploaded temporal evidence without a canonical period blocks Claude", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([
    completeUploadedSource({
      file_name: "search.csv",
      expects_temporal_records: true,
      temporal_records: 0
    })
  ]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "uploaded_source_temporal_contract"));
});

test("a longitudinal numeric source without accepted measurement observations blocks Claude", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([
    completeUploadedSource({
      file_name: "sales.csv",
      expects_numeric_observations: true,
      expects_temporal_records: true,
      requires_catalog_identity: false,
      catalog_records: 0,
      accepted_catalog_identity_records: 0,
      temporal_records: 120,
      accepted_observations: 120,
      temporal_observations: 0
    })
  ]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "uploaded_source_temporal_observations"));
});

test("a numeric snapshot without governed capture evidence blocks Claude", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([
    completeUploadedSource({
      file_name: "search-demand.csv",
      expects_numeric_observations: true,
      expects_snapshot_records: true,
      expects_snapshot_observations: true,
      requires_catalog_identity: false,
      catalog_records: 0,
      accepted_catalog_identity_records: 0,
      accepted_observations: 120,
      snapshot_records: 0,
      snapshot_observations: 0
    })
  ]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "uploaded_source_snapshot_records"));
  assert.ok(result.blockers.some((blocker) => blocker.code === "uploaded_source_snapshot_observations"));
});

test("a governed product catalog snapshot passes without pretending to be longitudinal", () => {
  const input = evidence();
  input.source_materializations = sourceMaterializations([
    completeUploadedSource({
      file_name: "product-catalog.xlsx",
      expects_numeric_observations: true,
      expects_snapshot_records: false,
      expects_snapshot_observations: true,
      snapshot_records: 0,
      accepted_observations: 300,
      snapshot_observations: 300
    })
  ]);

  const result = evaluateDataOsCorpusAudit(input);

  assert.equal(result.ready_for_claude, true);
  assert.equal(result.blockers.some((blocker) => blocker.code.startsWith("uploaded_source_")), false);
});

function evidence(stage: DataOsCorpusAuditStage = "pre_analysis"): DataOsCorpusAuditEvidence & { stage: DataOsCorpusAuditStage } {
  return {
    stage,
    corpus: {
      exists: true,
      total_records: 4_581,
      included_records: 3_331,
      excluded_records: 1_250,
      other_records: 0,
      completed_imports: 1,
      duplicate_records: 0,
      ingestion_deduplicated_records: 1_250,
      covered_months: 13,
      platforms: 16,
      coverage_start: "2025-07-01",
      coverage_end: "2026-07-15"
    },
    catalog: {
      listening_sources: 1,
      listening_assets: 1,
      listening_asset_rows: 4_581,
      active_contracts: 1,
      canonical_fields: 14,
      active_quality_rules: 6,
      quality_results: 6,
      failed_quality_results: 0,
      warning_quality_results: 0,
      source_asset_lineage: 1,
      source_sync_lineage: 1,
      import_asset_lineage: 1,
      import_source_lineage: 1,
      tb_taxonomy_terms: 6,
      tb_required_bindings: 3
    },
    observations: {
      total: 40,
      accepted: 40,
      review_required: 0,
      rejected: 0,
      listening: 40,
      represented_listening_records: 3_331,
      represented_listening_value: 3_331,
      invalid_currency_contract: 0,
      invalid_unit_contract: 0,
      unknown_metric_family: 0,
      invalid_count_value: 0,
      invalid_ratio_value: 0,
      invalid_duration_value: 0,
      invalid_period_contract: 0,
      invalid_metric_mapping: 0,
      invalid_product_catalog_time: 0
    },
    source_materializations: sourceMaterializations([]),
    capabilities: capabilities(),
    tb_bridge: {
      analysis_found: false,
      counts: bridgeCounts({
        codings: 0,
        coded_mentions: 0,
        non_irrelevant_mentions: 0,
        record_tags: 0,
        record_features: 0,
        polarity_tagged_mentions: 0,
        layer_tagged_mentions: 0,
        emergent_candidate_tags: 0,
        tag_lineage_edges: 0,
        feature_lineage_edges: 0,
        lineage_edges: 0
      }),
      quality: null
    }
  };
}

function capabilities(): DataOsCapability[] {
  const keys: DataOsCapability["key"][] = [
    "social_listening",
    "ecommerce_sales",
    "product_catalog",
    "web_analytics",
    "search_demand",
    "customer_service",
    "organic_social",
    "paid_media",
    "crm_marketing",
    "reviews_ratings",
    "pricing_inventory",
    "competitive_intelligence"
  ];
  return keys.map((key) => ({
    key,
    label: key.replaceAll("_", " "),
    status: key === "social_listening" ? "available" : "missing",
    evidence_source: key === "social_listening" ? "data_observations" : "none",
    accepted_observations: key === "social_listening" ? 40 : 0,
    review_observations: 0,
    rejected_observations: 0,
    temporal_observations: key === "social_listening" ? 40 : 0,
    snapshot_observations: 0,
    accepted_records: 0,
    review_records: 0,
    rejected_records: 0,
    temporal_records: 0,
    snapshot_records: 0,
    months: key === "social_listening" ? 13 : 0,
    assets: key === "social_listening" ? 1 : 0,
    period_start: key === "social_listening" ? "2025-07-01" : null,
    period_end: key === "social_listening" ? "2026-07-01" : null,
    snapshot_start: null,
    snapshot_end: null,
    metric_families: key === "social_listening" ? ["mentions", "engagement", "sentiment"] : []
  }));
}

function completeUploadedSource(
  overrides: Partial<DataOsCorpusAuditEvidence["source_materializations"]["sources"][number]> = {}
): DataOsCorpusAuditEvidence["source_materializations"]["sources"][number] {
  return {
    source_id: "11111111-1111-4111-8111-111111111111",
    file_name: "catalog.csv",
    source_status: "processed",
    source_error: null,
    active_data_sources: 1,
    active_assets: 1,
    active_asset_rows: 120,
    active_contracts: 1,
    current_quality_results: 1,
    passed_quality_results: 1,
    warning_quality_results: 0,
    failed_quality_results: 0,
    expected_source_rows: 120,
    expected_materialized_rows: 120,
    expects_numeric_observations: false,
    expects_temporal_records: false,
    expects_snapshot_records: false,
    expects_snapshot_observations: false,
    requires_catalog_identity: true,
    canonical_records: 120,
    accepted_records: 120,
    review_records: 0,
    rejected_records: 0,
    temporal_records: 0,
    snapshot_records: 0,
    catalog_records: 120,
    accepted_catalog_identity_records: 120,
    complete_record_lineage: 120,
    accepted_observations: 0,
    review_observations: 0,
    rejected_observations: 0,
    temporal_observations: 0,
    snapshot_observations: 0,
    knowledge_source_lineage: 1,
    source_asset_lineage: 1,
    sync_asset_lineage: 1,
    ...overrides
  };
}

function sourceMaterializations(
  sources: DataOsCorpusAuditEvidence["source_materializations"]["sources"]
): DataOsCorpusAuditEvidence["source_materializations"] {
  return {
    uploaded_sources: sources.length,
    processed_sources: sources.filter((source) => source.source_status === "processed").length,
    pending_sources: sources.filter((source) => ["pending", "processing", "profiled"].includes(source.source_status)).length,
    failed_sources: sources.filter((source) => source.source_status === "failed" || Boolean(source.source_error)).length,
    canonical_records: sources.reduce((total, source) => total + source.canonical_records, 0),
    accepted_records: sources.reduce((total, source) => total + source.accepted_records, 0),
    review_records: sources.reduce((total, source) => total + source.review_records, 0),
    rejected_records: sources.reduce((total, source) => total + source.rejected_records, 0),
    accepted_observations: sources.reduce((total, source) => total + source.accepted_observations, 0),
    warning_quality_results: sources.reduce((total, source) => total + source.warning_quality_results, 0),
    failed_quality_results: sources.reduce((total, source) => total + source.failed_quality_results, 0),
    sources
  };
}

function bridgeCounts(overrides: Partial<DataOsCorpusAuditEvidence["tb_bridge"]["counts"]> = {}) {
  return {
    codings: 100,
    coded_mentions: 100,
    non_irrelevant_mentions: 80,
    ambiguous_mentions: 0,
    missing_layer_mentions: 0,
    missing_emergent_tag_mentions: 0,
    unlinked_finding_mentions: 0,
    record_tags: 160,
    record_features: 100,
    polarity_tagged_mentions: 80,
    layer_tagged_mentions: 80,
    emergent_candidate_tags: 80,
    tag_lineage_edges: 160,
    feature_lineage_edges: 100,
    lineage_edges: 1,
    ...overrides
  };
}
