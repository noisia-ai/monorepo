import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDataOsSourceInventory,
  type DataOsSourceInventoryRow
} from "./tb-data-os-source-inventory";

function inventoryRow(overrides: Partial<DataOsSourceInventoryRow> = {}): DataOsSourceInventoryRow {
  return {
    asset_id: "asset-1",
    knowledge_source_id: "knowledge-1",
    file_name: "source.csv",
    source_kind: "spreadsheet_archive",
    provider: "file_upload",
    connection_method: "file_upload",
    knowledge_source_status: "processed",
    data_source_status: "active",
    asset_status: "active",
    asset_kind: "canonical_records",
    canonical_record_table: "data_asset_records",
    asset_reported_rows: 10,
    active_contracts: 1,
    field_count: 4,
    expected_source_rows: 10,
    expected_materialized_rows: 10,
    expects_numeric_observations: false,
    expects_temporal_records: false,
    expects_snapshot_records: false,
    expects_snapshot_observations: false,
    canonical_records: 10,
    accepted_records: 10,
    review_records: 0,
    rejected_records: 0,
    temporal_records: 0,
    snapshot_records: 0,
    record_period_start: null,
    record_period_end: null,
    record_snapshot_start: null,
    record_snapshot_end: null,
    accepted_observations: 0,
    review_observations: 0,
    rejected_observations: 0,
    temporal_observations: 0,
    snapshot_observations: 0,
    observation_period_start: null,
    observation_period_end: null,
    observation_snapshot_start: null,
    observation_snapshot_end: null,
    listening_mentions: 0,
    listening_included_mentions: 0,
    listening_excluded_mentions: 0,
    listening_period_start: null,
    listening_period_end: null,
    dataset_roles: ["product_catalog"],
    metric_families: [],
    metric_keys: [],
    entity_types: ["product"],
    entity_labels_sample: ["SKU 1"],
    quality_status: "passed",
    quality_blockers: [],
    quality_warnings: [],
    knowledge_source_lineage: 1,
    source_asset_lineage: 1,
    sync_asset_lineage: 1,
    sync_status: "completed",
    sync_records_total: 10,
    sync_records_valid: 10,
    ...overrides
  };
}

test("keeps a governed static catalog ready without inventing observations or a period", () => {
  const [item] = buildDataOsSourceInventory([inventoryRow()]);

  assert.ok(item);
  assert.equal(item.status, "ready");
  assert.equal(item.canonical_record_store, "data_asset_records");
  assert.equal(item.rows.accepted, 10);
  assert.equal(item.observations.accepted, 0);
  assert.equal(item.semantic.period_start, null);
  assert.deepEqual(item.semantic.entity_types, ["product"]);
});

test("blocks a temporal numeric source when governed observations are missing", () => {
  const [item] = buildDataOsSourceInventory([
    inventoryRow({
      dataset_roles: ["ecommerce_sales"],
      expects_numeric_observations: true,
      expects_temporal_records: true
    })
  ]);

  assert.ok(item);
  assert.equal(item.status, "blocked");
  assert.equal(item.observations.accepted, 0);
  assert.equal(item.rows.temporal, 0);
});

test("keeps a governed numeric snapshot separate from longitudinal coverage", () => {
  const [item] = buildDataOsSourceInventory([
    inventoryRow({
      dataset_roles: ["search_demand"],
      metric_families: ["search_volume"],
      expects_numeric_observations: true,
      expects_snapshot_records: true,
      expects_snapshot_observations: true,
      snapshot_records: 10,
      record_snapshot_start: "2026-06-24",
      record_snapshot_end: "2026-06-24",
      accepted_observations: 10,
      snapshot_observations: 10,
      observation_snapshot_start: "2026-06-24",
      observation_snapshot_end: "2026-06-24"
    })
  ]);

  assert.ok(item);
  assert.equal(item.status, "ready");
  assert.equal(item.rows.temporal, 0);
  assert.equal(item.rows.snapshot, 10);
  assert.equal(item.observations.temporal, 0);
  assert.equal(item.observations.snapshot, 10);
  assert.equal(item.semantic.period_start, null);
  assert.equal(item.semantic.snapshot_start, "2026-06-24");
});

test("keeps static product identity separate from governed snapshot attributes", () => {
  const [item] = buildDataOsSourceInventory([
    inventoryRow({
      dataset_roles: ["product_catalog"],
      metric_families: ["price", "cost"],
      expects_numeric_observations: true,
      expects_snapshot_records: false,
      expects_snapshot_observations: true,
      snapshot_records: 0,
      accepted_observations: 20,
      snapshot_observations: 20,
      observation_snapshot_start: "2026-07-08",
      observation_snapshot_end: "2026-07-08"
    })
  ]);

  assert.ok(item);
  assert.equal(item.status, "ready");
  assert.equal(item.rows.snapshot, 0);
  assert.equal(item.observations.snapshot, 20);
  assert.equal(item.contract.expects_snapshot_records, false);
});

test("uses mentions as the canonical listening record store and reconciles its full period", () => {
  const [item] = buildDataOsSourceInventory([
    inventoryRow({
      knowledge_source_id: null,
      source_kind: "social_listening",
      provider: "portable_listening_import",
      knowledge_source_status: null,
      canonical_record_table: "mentions",
      asset_reported_rows: 4_581,
      expected_source_rows: 0,
      expected_materialized_rows: 0,
      canonical_records: 0,
      accepted_records: 0,
      rejected_records: 0,
      listening_mentions: 4_581,
      listening_included_mentions: 3_331,
      listening_excluded_mentions: 1_250,
      listening_period_start: "2025-06-01T00:00:00.000Z",
      listening_period_end: "2026-06-30T23:59:59.000Z",
      dataset_roles: ["social_listening"],
      quality_status: "warning",
      quality_warnings: ["Some listening records are missing a canonical platform."],
      knowledge_source_lineage: 0,
      sync_asset_lineage: 1,
      sync_records_total: 4_581,
      sync_records_valid: 4_581
    })
  ]);

  assert.ok(item);
  assert.equal(item.status, "review_required");
  assert.equal(item.canonical_record_store, "mentions");
  assert.equal(item.rows.canonical, 4_581);
  assert.equal(item.rows.accepted, 3_331);
  assert.equal(item.rows.rejected, 1_250);
  assert.equal(item.semantic.period_start, "2025-06-01T00:00:00.000Z");
  assert.equal(item.lineage.complete, true);
});

test("marks warning-only uploaded evidence for review without discarding it", () => {
  const [item] = buildDataOsSourceInventory([
    inventoryRow({
      quality_status: "warning",
      quality_warnings: ["Two rows need a category mapping."],
      review_records: 2,
      accepted_records: 8
    })
  ]);

  assert.ok(item);
  assert.equal(item.status, "review_required");
  assert.equal(item.rows.accepted, 8);
  assert.deepEqual(item.quality.warnings, ["Two rows need a category mapping."]);
});
