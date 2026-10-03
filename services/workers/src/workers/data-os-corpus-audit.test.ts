import assert from "node:assert/strict";
import test from "node:test";

import type { DataOsCorpusAudit } from "@noisia/query-engine";
import {
  assertCorpusDataOsAuditReady,
  dataOsAuditGateName,
  summarizeCorpusDataOsAudit
} from "./data-os-audit-gate";

function audit(overrides: Partial<DataOsCorpusAudit> = {}): DataOsCorpusAudit {
  return {
    contract: "noisia_data_os_corpus_audit_v1",
    stage: "post_coding",
    status: "ready",
    ready_for_claude: true,
    blockers: [],
    warnings: [],
    corpus: {
      exists: true,
      total_records: 1,
      included_records: 1,
      excluded_records: 0,
      other_records: 0,
      completed_imports: 1,
      duplicate_records: 0,
      ingestion_deduplicated_records: 0,
      covered_months: 1,
      platforms: 1,
      coverage_start: "2026-01-01",
      coverage_end: "2026-01-31"
    },
    catalog: {
      listening_sources: 1,
      listening_assets: 1,
      listening_asset_rows: 1,
      active_contracts: 1,
      canonical_fields: 1,
      active_quality_rules: 1,
      quality_results: 1,
      failed_quality_results: 0,
      warning_quality_results: 0,
      source_asset_lineage: 1,
      source_sync_lineage: 1,
      import_asset_lineage: 1,
      import_source_lineage: 1,
      tb_taxonomy_terms: 1,
      tb_required_bindings: 1
    },
    observations: {
      total: 1,
      accepted: 1,
      review_required: 0,
      rejected: 0,
      listening: 1,
      represented_listening_records: 1,
      represented_listening_value: 1,
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
    source_materializations: {
      uploaded_sources: 0,
      processed_sources: 0,
      pending_sources: 0,
      failed_sources: 0,
      canonical_records: 0,
      accepted_records: 0,
      review_records: 0,
      rejected_records: 0,
      accepted_observations: 0,
      warning_quality_results: 0,
      failed_quality_results: 0,
      sources: []
    },
    capabilities: [],
    tb_bridge: {
      analysis_found: true,
      counts: {
        codings: 1,
        coded_mentions: 1,
        non_irrelevant_mentions: 1,
        ambiguous_mentions: 0,
        missing_layer_mentions: 0,
        missing_emergent_tag_mentions: 0,
        unlinked_finding_mentions: 0,
        record_tags: 2,
        record_features: 1,
        polarity_tagged_mentions: 1,
        layer_tagged_mentions: 1,
        emergent_candidate_tags: 1,
        tag_lineage_edges: 2,
        feature_lineage_edges: 1,
        lineage_edges: 3
      },
      quality: { status: "accepted", ready: true, warnings: [] }
    },
    ...overrides
  };
}

test("uses a distinct quality gate for every Data OS audit stage", () => {
  assert.equal(dataOsAuditGateName("pre_analysis"), "data_os_pre_analysis");
  assert.equal(dataOsAuditGateName("post_coding"), "data_os_post_coding");
  assert.equal(dataOsAuditGateName("release"), "data_os_release");
});

test("summarizes stage evidence without copying the full audit into pipeline results", () => {
  assert.deepEqual(summarizeCorpusDataOsAudit(audit()), {
    contract: "noisia_data_os_corpus_audit_v1",
    stage: "post_coding",
    status: "ready",
    ready: true,
    blocker_codes: [],
    warning_codes: []
  });
});

test("fails closed when a post-coding Data OS audit is blocked", () => {
  const blocked = audit({
    status: "blocked",
    ready_for_claude: false,
    blockers: [{ code: "tb_coding_bridge", message: "Generic coding rows are incomplete." }]
  });
  assert.throws(
    () => assertCorpusDataOsAuditReady(blocked, "T&B coding bridge"),
    /T&B coding bridge blocked \(post_coding\).*tb_coding_bridge/
  );
});
