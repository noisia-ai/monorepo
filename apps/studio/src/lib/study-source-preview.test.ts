import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { buildStudySourcePreviewFromBuffer } from "./study-source-preview";

test("profiles spreadsheet sources for Data OS intake", () => {
  const workbook = XLSX.utils.book_new();
  const sales = XLSX.utils.aoa_to_sheet([
    ["AÑO", "MES", "SUPERCATEGORIA", "VENTA REAL", "MARGEN"],
    [2026, "enero", "Pet food", 120000, 0.42],
    [2026, "febrero", "Accessories", 82000, 0.35]
  ]);
  const catalog = XLSX.utils.aoa_to_sheet([
    ["SKU", "DESCRIPCIÓN", "PRECIO PUBLICO"],
    ["LAIKA-1", "Alimento premium perro", 499]
  ]);
  XLSX.utils.book_append_sheet(workbook, sales, "R1");
  XLSX.utils.book_append_sheet(workbook, catalog, "CATALOGO");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const preview = buildStudySourcePreviewFromBuffer({
    name: "reporte-maestro.xlsx",
    kind: "spreadsheet_archive",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: buffer.byteLength,
    buffer
  });

  assert.equal(preview.status, "ready");
  assert.equal(preview.sheet_count, 2);
  assert.equal(preview.row_count, 3);
  assert.match(preview.summary, /2 hojas/);
  assert.ok(preview.dataset_inventory.some((item) => item.includes("VENTA REAL")));
  assert.ok(preview.text.includes("Fuente estructurada"));
  assert.equal(preview.source_profile?.canonical_status, "profiled");
  assert.equal(preview.source_profile?.chart_readiness.time_series, true);
  assert.ok(preview.source_profile?.source_metrics.some((metric) => metric.metric_family === "sales"));
  assert.ok(preview.source_profile?.source_metrics.some((metric) => metric.metric_family === "margin"));
  assert.ok(preview.source_profile?.source_time_axes.some((axis) => axis.grain === "month"));
  assert.ok(preview.source_profile?.datasets.some((dataset) => dataset.semantic_role === "commercial_performance"));
  assert.ok(preview.source_profile?.datasets.some((dataset) => dataset.semantic_role === "product_catalog"));
});

test("profiles CSV sources with metrics and time axes for later chart materialization", () => {
  const csv = [
    "month,brand,mentions,sentiment_score",
    "2025-11,Laika,1240,0.42",
    "2025-12,Laika,1530,0.38"
  ].join("\n");
  const preview = buildStudySourcePreviewFromBuffer({
    name: "mentions-monthly.csv",
    kind: "social_listening_export",
    mimeType: "text/csv",
    sizeBytes: Buffer.byteLength(csv),
    buffer: Buffer.from(csv)
  });

  assert.equal(preview.status, "ready");
  assert.equal(preview.source_profile?.chart_readiness.time_series, true);
  assert.ok(preview.source_profile?.source_metrics.some((metric) => metric.metric_family === "listening"));
  assert.ok(preview.source_profile?.source_time_axes.some((axis) => axis.grain === "month"));
  assert.equal(preview.source_profile?.datasets[0]?.semantic_role, "social_listening");
});
