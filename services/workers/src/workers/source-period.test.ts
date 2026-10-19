import assert from "node:assert/strict";
import test from "node:test";

import type { SourceObservation, SourceRecord } from "@noisia/query-engine";

import {
  applySourcePeriodInference,
  applySourceRecordPeriodInference,
  inferSourceSnapshotPeriod
} from "./source-period";

const BASE_SOURCE = {
  title: "Source",
  original_file_name: null,
  source_period_start: null,
  source_period_end: null,
  created_at: "2026-07-11T10:30:00.000Z"
};

test("uses an explicit source period before file or ingestion dates", () => {
  assert.deepEqual(
    inferSourceSnapshotPeriod({
      ...BASE_SOURCE,
      original_file_name: "report_6_24_2026.csv",
      source_period_start: "2026-05-01",
      source_period_end: "2026-05-31"
    }),
    {
      start: "2026-05-01",
      end: "2026-05-31",
      grain: "month",
      inference: "declared_source_period"
    }
  );
});

test("recognizes month-day-year snapshot dates in uploaded file names", () => {
  assert.deepEqual(
    inferSourceSnapshotPeriod({
      ...BASE_SOURCE,
      original_file_name: "laika_google_6_24_2026.csv"
    }),
    {
      start: "2026-06-24",
      end: "2026-06-24",
      grain: "day",
      inference: "file_name"
    }
  );
});

test("recognizes year-month-day snapshot dates in uploaded file names", () => {
  assert.deepEqual(
    inferSourceSnapshotPeriod({
      ...BASE_SOURCE,
      original_file_name: "search-export-2026-06-24.csv"
    }),
    {
      start: "2026-06-24",
      end: "2026-06-24",
      grain: "day",
      inference: "file_name"
    }
  );
});

test("uses ingestion time only as a governed source capture fallback", () => {
  assert.deepEqual(
    inferSourceSnapshotPeriod({
      ...BASE_SOURCE,
      original_file_name: "search-export-2_31_2026.csv"
    }),
    {
      start: "2026-07-11",
      end: "2026-07-11",
      grain: "day",
      inference: "source_created_at_snapshot"
    }
  );
});

test("rejects an invalid capture timestamp when no declared or filename date exists", () => {
  assert.equal(
    inferSourceSnapshotPeriod({
      ...BASE_SOURCE,
      original_file_name: "search-export.csv",
      created_at: "not-a-date"
    }),
    null
  );
});

function observation(metricFamily: string): SourceObservation {
  return {
    datasetKey: "dataset",
    datasetName: "Dataset",
    datasetRole: "uploaded_context",
    rowIndex: 0,
    recordHash: "hash",
    periodStart: null,
    periodEnd: null,
    periodGrain: "unknown",
    periodSemantics: "unknown",
    entityType: null,
    entityKey: null,
    entityLabel: null,
    metricKey: `${metricFamily}_observed`,
    metricFamily,
    metricVariant: metricFamily,
    metricValue: "10",
    metricUnit: metricFamily === "price" ? "currency" : "count",
    metricCurrencyCode: metricFamily === "price" ? "MXN" : null,
    dimensions: {},
    rawRecord: {},
    lineage: {},
    qualityStatus: "needs_mapping_review",
    qualityIssues: ["measurement_period_missing", "snapshot_date_missing"]
  };
}

test("never assigns a source date to static master data", () => {
  const declaredPeriod = inferSourceSnapshotPeriod({
    ...BASE_SOURCE,
    source_period_start: "2026-06-01",
    source_period_end: "2026-06-30"
  });
  const catalog: SourceObservation = {
    ...observation("price"),
    datasetRole: "product_catalog",
    periodSemantics: "static",
    qualityStatus: "accepted",
    qualityIssues: []
  };

  assert.deepEqual(applySourcePeriodInference(catalog, declaredPeriod), catalog);
});

test("uses filename dates for snapshot metrics without fabricating sales time", () => {
  const filePeriod = inferSourceSnapshotPeriod({
    ...BASE_SOURCE,
    original_file_name: "catalog_6_24_2026.csv"
  });

  const price = applySourcePeriodInference(
    { ...observation("price"), datasetRole: "product_catalog" },
    filePeriod
  );
  assert.equal(price.periodStart, "2026-06-24");
  assert.equal(price.periodSemantics, "snapshot");
  assert.equal(price.metricKey, "price_snapshot");
  assert.equal(price.qualityStatus, "accepted");

  const sales = applySourcePeriodInference(observation("sales"), filePeriod);
  assert.equal(sales.periodStart, null);
  assert.equal(sales.metricKey, "sales_observed");
  assert.equal(sales.qualityStatus, "needs_mapping_review");
});

test("uses source capture for catalog prices but never for undated ecommerce sales", () => {
  const capturePeriod = inferSourceSnapshotPeriod({
    ...BASE_SOURCE,
    original_file_name: "product-master.xlsx"
  });

  const price = applySourcePeriodInference(
    { ...observation("price"), datasetRole: "product_catalog" },
    capturePeriod
  );
  assert.equal(price.periodStart, "2026-07-11");
  assert.equal(price.periodSemantics, "snapshot");
  assert.equal(price.lineage.period_inference, "source_created_at_snapshot");
  assert.equal(price.qualityStatus, "accepted");

  const sales = applySourcePeriodInference(
    { ...observation("sales"), datasetRole: "ecommerce_sales" },
    capturePeriod
  );
  assert.equal(sales.periodStart, null);
  assert.equal(sales.qualityStatus, "needs_mapping_review");
});

test("uses an explicitly declared source period for undated measurements", () => {
  const declaredPeriod = inferSourceSnapshotPeriod({
    ...BASE_SOURCE,
    source_period_start: "2025-11-01",
    source_period_end: "2025-11-30"
  });
  const sales = applySourcePeriodInference(observation("sales"), declaredPeriod);

  assert.equal(sales.periodStart, "2025-11-01");
  assert.equal(sales.periodEnd, "2025-11-30");
  assert.equal(sales.periodGrain, "month");
  assert.equal(sales.periodSemantics, "measurement");
  assert.equal(sales.metricKey, "sales_monthly");
  assert.equal(sales.qualityStatus, "accepted");
});

function sourceRecord(datasetRole: string, periodSemantics: SourceRecord["periodSemantics"]): SourceRecord {
  return {
    datasetKey: "dataset",
    datasetName: "Dataset",
    datasetRole,
    rowIndex: 0,
    recordHash: "record-hash",
    periodStart: null,
    periodEnd: null,
    periodGrain: "unknown",
    periodSemantics,
    entityType: datasetRole === "product_catalog" ? "product" : null,
    entityKey: datasetRole === "product_catalog" ? "sku-1" : null,
    entityLabel: null,
    dimensions: {},
    rawRecord: {},
    lineage: {},
    qualityStatus: "needs_mapping_review",
    qualityIssues: ["period_field_missing"]
  };
}

test("applies filename capture dates to snapshot records but not catalog or undated sales", () => {
  const filePeriod = inferSourceSnapshotPeriod({
    ...BASE_SOURCE,
    original_file_name: "source_6_24_2026.csv"
  });

  const search = applySourceRecordPeriodInference(sourceRecord("search_demand", "unknown"), filePeriod);
  assert.equal(search.periodStart, "2026-06-24");
  assert.equal(search.periodSemantics, "snapshot");
  assert.equal(search.qualityStatus, "accepted");

  const sales = sourceRecord("ecommerce_sales", "unknown");
  assert.deepEqual(applySourceRecordPeriodInference(sales, filePeriod), sales);

  const catalog = sourceRecord("product_catalog", "static");
  assert.deepEqual(applySourceRecordPeriodInference(catalog, filePeriod), catalog);
});

test("applies declared coverage to temporal canonical rows", () => {
  const declaredPeriod = inferSourceSnapshotPeriod({
    ...BASE_SOURCE,
    source_period_start: "2025-11-01",
    source_period_end: "2025-11-30"
  });
  const record = applySourceRecordPeriodInference(
    sourceRecord("ecommerce_sales", "unknown"),
    declaredPeriod
  );

  assert.equal(record.periodStart, "2025-11-01");
  assert.equal(record.periodEnd, "2025-11-30");
  assert.equal(record.periodSemantics, "measurement");
  assert.equal(record.qualityStatus, "accepted");
});
