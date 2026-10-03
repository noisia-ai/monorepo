import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceMaterializationContract,
  evaluateSourceMaterialization
} from "./source-materialization-contract";

test("accepts a complete static catalog without fabricating numeric observations", () => {
    const contract = buildSourceMaterializationContract([
      {
        datasetKey: "catalog",
        datasetRole: "product_catalog",
        sourceRows: 2,
        materializedRows: 2,
        hasEntityKey: true,
        hasTimeAxis: false,
        metricFamilies: []
      }
    ]);

    const result = evaluateSourceMaterialization(contract, {
      insertedRecords: 2,
      acceptedRecords: 2,
      reviewRecords: 0,
      rejectedRecords: 0,
      temporalRecords: 0,
      snapshotRecords: 0,
      catalogRecords: 2,
      acceptedCatalogIdentityRecords: 2,
      insertedObservations: 0,
      acceptedObservations: 0,
      reviewObservations: 0,
      rejectedObservations: 0,
      temporalObservations: 0,
      snapshotObservations: 0
    });

    assert.deepEqual(contract.canonicalTargets, ["data_asset_records"]);
    assert.deepEqual({ status: result.status, blockers: result.blockers }, { status: "passed", blockers: [] });
  });

test("blocks partially profiled sources", () => {
    const contract = buildSourceMaterializationContract([
      {
        datasetKey: "sales",
        datasetRole: "ecommerce_sales",
        sourceRows: 60_000,
        materializedRows: 50_000,
        hasEntityKey: true,
        hasTimeAxis: true,
        metricFamilies: ["sales"]
      }
    ]);

    const result = evaluateSourceMaterialization(contract, {
      insertedRecords: 50_000,
      acceptedRecords: 50_000,
      reviewRecords: 0,
      rejectedRecords: 0,
      temporalRecords: 50_000,
      snapshotRecords: 0,
      catalogRecords: 0,
      acceptedCatalogIdentityRecords: 0,
      insertedObservations: 50_000,
      acceptedObservations: 50_000,
      reviewObservations: 0,
      rejectedObservations: 0,
      temporalObservations: 50_000,
      snapshotObservations: 0
    });

    assert.equal(result.status, "failed");
    assert.ok(result.blockers.includes("source_rows_not_fully_profiled:sales"));
  });

test("blocks a metric source that produced no accepted observations", () => {
    const contract = buildSourceMaterializationContract([
      {
        datasetKey: "sales",
        datasetRole: "ecommerce_sales",
        sourceRows: 2,
        materializedRows: 2,
        hasEntityKey: true,
        hasTimeAxis: true,
        metricFamilies: ["sales"]
      }
    ]);

    const result = evaluateSourceMaterialization(contract, {
      insertedRecords: 2,
      acceptedRecords: 2,
      reviewRecords: 0,
      rejectedRecords: 0,
      temporalRecords: 2,
      snapshotRecords: 0,
      catalogRecords: 0,
      acceptedCatalogIdentityRecords: 0,
      insertedObservations: 2,
      acceptedObservations: 0,
      reviewObservations: 2,
      rejectedObservations: 0,
      temporalObservations: 2,
      snapshotObservations: 0
    });

    assert.equal(result.status, "failed");
    assert.ok(result.blockers.includes("no_accepted_numeric_observations"));
  });

test("surfaces review rows as a warning without discarding usable records", () => {
    const contract = buildSourceMaterializationContract([
      {
        datasetKey: "context",
        datasetRole: "uploaded_context",
        sourceRows: 3,
        materializedRows: 3,
        hasEntityKey: false,
        hasTimeAxis: false,
        metricFamilies: []
      }
    ]);

    const result = evaluateSourceMaterialization(contract, {
      insertedRecords: 3,
      acceptedRecords: 2,
      reviewRecords: 1,
      rejectedRecords: 0,
      temporalRecords: 0,
      snapshotRecords: 0,
      catalogRecords: 0,
      acceptedCatalogIdentityRecords: 0,
      insertedObservations: 0,
      acceptedObservations: 0,
      reviewObservations: 0,
      rejectedObservations: 0,
      temporalObservations: 0,
      snapshotObservations: 0
    });

    assert.equal(result.status, "warning");
    assert.ok(result.warnings.includes("source_records_need_mapping_review"));
  });

test("requires periods for a temporal domain even when profiling missed the time field", () => {
    const contract = buildSourceMaterializationContract([
      {
        datasetKey: "orders",
        datasetRole: "ecommerce_sales",
        sourceRows: 2,
        materializedRows: 2,
        hasEntityKey: true,
        hasTimeAxis: false,
        metricFamilies: ["sales"]
      }
    ]);

    const result = evaluateSourceMaterialization(contract, {
      insertedRecords: 2,
      acceptedRecords: 2,
      reviewRecords: 0,
      rejectedRecords: 0,
      temporalRecords: 0,
      snapshotRecords: 0,
      catalogRecords: 0,
      acceptedCatalogIdentityRecords: 0,
      insertedObservations: 2,
      acceptedObservations: 2,
      reviewObservations: 0,
      rejectedObservations: 0,
      temporalObservations: 0,
      snapshotObservations: 0
    });

    assert.equal(contract.expectsTemporalRecords, true);
    assert.equal(result.status, "failed");
    assert.ok(result.blockers.includes("temporal_records_missing_period"));
  });

test("requires governed capture semantics for numeric snapshots", () => {
  const contract = buildSourceMaterializationContract([
    {
      datasetKey: "keyword-export",
      datasetRole: "search_demand",
      sourceRows: 2,
      materializedRows: 2,
      hasEntityKey: true,
      hasTimeAxis: false,
      metricFamilies: ["search_volume"]
    }
  ]);

  const missingCapture = evaluateSourceMaterialization(contract, {
    insertedRecords: 2,
    acceptedRecords: 2,
    reviewRecords: 0,
    rejectedRecords: 0,
    temporalRecords: 0,
    snapshotRecords: 0,
    catalogRecords: 0,
    acceptedCatalogIdentityRecords: 0,
    insertedObservations: 2,
    acceptedObservations: 2,
    reviewObservations: 0,
    rejectedObservations: 0,
    temporalObservations: 0,
    snapshotObservations: 0
  });

  assert.equal(contract.expectsTemporalRecords, false);
  assert.equal(contract.expectsSnapshotRecords, true);
  assert.equal(contract.expectsSnapshotObservations, true);
  assert.equal(missingCapture.status, "failed");
  assert.ok(missingCapture.blockers.includes("snapshot_records_missing_capture_date"));
  assert.ok(missingCapture.blockers.includes("snapshot_observations_missing_capture_date"));
});

test("keeps product identity static while requiring governed snapshot attributes", () => {
  const contract = buildSourceMaterializationContract([
    {
      datasetKey: "product-catalog",
      datasetRole: "product_catalog",
      sourceRows: 2,
      materializedRows: 2,
      hasEntityKey: true,
      hasTimeAxis: false,
      metricFamilies: ["price", "cost"]
    }
  ]);

  const result = evaluateSourceMaterialization(contract, {
    insertedRecords: 2,
    acceptedRecords: 2,
    reviewRecords: 0,
    rejectedRecords: 0,
    temporalRecords: 0,
    snapshotRecords: 0,
    catalogRecords: 2,
    acceptedCatalogIdentityRecords: 2,
    insertedObservations: 4,
    acceptedObservations: 4,
    reviewObservations: 0,
    rejectedObservations: 0,
    temporalObservations: 0,
    snapshotObservations: 4
  });

  assert.equal(contract.version, 3);
  assert.equal(contract.expectsSnapshotRecords, false);
  assert.equal(contract.expectsSnapshotObservations, true);
  assert.deepEqual({ status: result.status, blockers: result.blockers }, { status: "passed", blockers: [] });
});

test("declares temporal and snapshot evidence independently in a mixed workbook", () => {
  const contract = buildSourceMaterializationContract([
    {
      datasetKey: "monthly-sales",
      datasetRole: "ecommerce_sales",
      sourceRows: 8,
      materializedRows: 8,
      hasEntityKey: true,
      hasTimeAxis: true,
      metricFamilies: ["sales", "margin"]
    },
    {
      datasetKey: "product-catalog",
      datasetRole: "product_catalog",
      sourceRows: 20,
      materializedRows: 20,
      hasEntityKey: true,
      hasTimeAxis: false,
      metricFamilies: ["price", "cost"]
    }
  ]);

  const result = evaluateSourceMaterialization(contract, {
    insertedRecords: 28,
    acceptedRecords: 28,
    reviewRecords: 0,
    rejectedRecords: 0,
    temporalRecords: 8,
    snapshotRecords: 0,
    catalogRecords: 20,
    acceptedCatalogIdentityRecords: 20,
    insertedObservations: 56,
    acceptedObservations: 56,
    reviewObservations: 0,
    rejectedObservations: 0,
    temporalObservations: 16,
    snapshotObservations: 40
  });

  assert.equal(contract.expectsTemporalRecords, true);
  assert.equal(contract.expectsSnapshotRecords, false);
  assert.equal(contract.expectsSnapshotObservations, true);
  assert.deepEqual({ status: result.status, blockers: result.blockers }, { status: "passed", blockers: [] });
});
