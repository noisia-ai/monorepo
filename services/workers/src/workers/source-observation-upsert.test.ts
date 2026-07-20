import assert from "node:assert/strict";
import test from "node:test";

import type { SourceObservation } from "@noisia/query-engine";

import { prepareSourceObservationsForUpsert } from "./source-observation-upsert";

function observation(overrides: Partial<SourceObservation> = {}): SourceObservation {
  return {
    datasetKey: "animall",
    datasetName: "ANIMALL",
    datasetRole: "product_catalog",
    rowIndex: 0,
    recordHash: "hash",
    periodStart: "2026-06-24",
    periodEnd: "2026-06-24",
    periodGrain: "day",
    periodSemantics: "snapshot",
    entityType: "product",
    entityKey: "SKU-1",
    entityLabel: "SKU-1",
    metricKey: "selling_price_snapshot",
    metricFamily: "price",
    metricVariant: "selling_price",
    metricValue: "1800",
    metricUnit: "currency",
    metricCurrencyCode: "MXN",
    dimensions: { brand: "Laika" },
    rawRecord: { SKU: "SKU-1", "PRECIO VENTA": 1800 },
    lineage: { source_field: "PRECIO VENTA" },
    qualityStatus: "accepted",
    qualityIssues: [],
    ...overrides
  };
}

test("collapses only exact duplicate observations", () => {
  const rows = prepareSourceObservationsForUpsert(
    [observation(), observation()],
    "source-1",
    "asset-1"
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.lineage.deduplicated_before_upsert, true);
  assert.equal(rows[0]?.lineage.exact_duplicate_observation_count, 2);
});

test("fails closed when distinct source fields share an observation key", () => {
  assert.throws(
    () => prepareSourceObservationsForUpsert(
      [
        observation(),
        observation({
          metricValue: "1700",
          rawRecord: { SKU: "SKU-1", "PRECIO PUBLICO": 1700 },
          lineage: { source_field: "PRECIO PUBLICO" }
        })
      ],
      "source-1",
      "asset-1"
    ),
    /Data OS observation key collision/
  );
});

test("preserves distinct governed metric variants", () => {
  const rows = prepareSourceObservationsForUpsert(
    [
      observation(),
      observation({
        metricKey: "supplier_suggested_retail_price_snapshot",
        metricVariant: "supplier_suggested_retail_price",
        metricValue: "1900",
        rawRecord: { SKU: "SKU-1", "PRECIO PUBLICO SUGERIDO PROV": 1900 },
        lineage: { source_field: "PRECIO PUBLICO SUGERIDO PROV" }
      })
    ],
    "source-1",
    "asset-1"
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    new Set(rows.map((row) => row.metricVariant)),
    new Set(["selling_price", "supplier_suggested_retail_price"])
  );
});
