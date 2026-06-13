import assert from "node:assert/strict";
import test from "node:test";

import { decodePerformanceCsvInput, parsePerformanceCsv } from "./performance-import";

test("performance CSV parser maps Meta-like exports into structured records", () => {
  const csv = [
    "Day,Campaign ID,Campaign name,Platform,Amount spent,Impressions,Reach,Link clicks,CTR,CPM,Ad text",
    "2026-01-01,camp_1,Picante Enero,Meta,123.45,10000,8200,321,3.21%,12.34,\"Claim picante con prueba\"",
    "2026-01-02,camp_1,Picante Enero,Meta,0,0,0,0,0%,0,\"fila sin metrica util\"",
    "2026-01-01,camp_1,Picante Enero,Meta,123.45,10000,8200,321,3.21%,12.34,\"duplicada\""
  ].join("\n");

  const result = parsePerformanceCsv(csv, { defaultChannel: "paid", sourceFileName: "meta.csv" });

  assert.equal(result.stats.records_total, 3);
  assert.equal(result.stats.records_valid, 1);
  assert.equal(result.stats.records_failed, 1);
  assert.equal(result.stats.duplicate_keys, 1);
  assert.equal(result.stats.coverage_start, "2026-01-01");
  assert.equal(result.mapping.record_date, "day");
  assert.equal(result.records[0]?.externalId, "camp_1");
  assert.equal(result.records[0]?.platform, "meta");
  assert.equal(result.records[0]?.channel, "paid");
  assert.equal(result.records[0]?.spend, 123.45);
  assert.equal(result.records[0]?.impressions, 10000);
  assert.equal(result.records[0]?.ctr, 0.0321);
  assert.equal(result.records[0]?.creativeText, "Claim picante con prueba");
});

test("performance CSV parser creates stable IDs when exports omit external ids", () => {
  const result = parsePerformanceCsv("Date,Campaign,Spend,Impressions\n2026-03-02,Orgánico Snack,9.5,300", {
    mapping: { entity_name: "campaign", record_date: "date", spend: "spend", impressions: "impressions" },
    defaultPlatform: "tiktok",
    defaultChannel: "organic"
  });

  assert.equal(result.records.length, 1);
  assert.match(result.records[0]?.externalId ?? "", /^perf_[a-f0-9]{24}$/);
  assert.equal(result.records[0]?.entityKind, "campaign");
  assert.equal(result.records[0]?.channel, "organic");
});

test("performance CSV parser detects Meta single-metric UTF-16 exports", () => {
  const csv = [
    "sep=,",
    "\"Clics en el enlace de Facebook\"",
    "\"Fecha\",\"Primary\"",
    "\"2025-01-01T00:00:00\",\"249\"",
    "\"2025-01-02T00:00:00\",\"0\""
  ].join("\n");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")]);

  const result = parsePerformanceCsv(utf16, { defaultPlatform: "file", sourceFileName: "Clics en el enlace.csv" });

  assert.equal(decodePerformanceCsvInput(utf16).includes("Clics en el enlace"), true);
  assert.equal(result.diagnostics.format, "single_metric_timeseries");
  assert.deepEqual(result.diagnostics.detected_metrics, ["clicks"]);
  assert.equal(result.stats.records_total, 2);
  assert.equal(result.stats.records_valid, 2);
  assert.equal(result.records[0]?.platform, "social");
  assert.equal(result.records[0]?.channel, "organic");
  assert.equal(result.records[0]?.entityKind, "account");
  assert.equal(result.records[0]?.metrics.clicks, 249);
  assert.equal(result.records[1]?.metrics.clicks, 0);
});

test("single-metric social exports share stable grain for multi-file merge", () => {
  const clicks = [
    "sep=,",
    "\"Clics en el enlace de Facebook\"",
    "\"Fecha\",\"Primary\"",
    "\"2025-01-01T00:00:00\",\"249\""
  ].join("\n");
  const engagement = [
    "sep=,",
    "\"Interacciones con el contenido\"",
    "\"Fecha\",\"Primary\"",
    "\"2025-01-01T00:00:00\",\"90\""
  ].join("\n");

  const clicksResult = parsePerformanceCsv(clicks, { defaultPlatform: "file", sourceFileName: "Clics en el enlace.csv" });
  const engagementResult = parsePerformanceCsv(engagement, { defaultPlatform: "file", sourceFileName: "Interacciones.csv" });

  assert.equal(clicksResult.records[0]?.externalId, engagementResult.records[0]?.externalId);
  assert.equal(clicksResult.records[0]?.recordDate, engagementResult.records[0]?.recordDate);
  assert.deepEqual(clicksResult.diagnostics.present_metrics, ["clicks"]);
  assert.deepEqual(engagementResult.diagnostics.present_metrics, ["engagement"]);
});

test("single-metric social exports keep custom metrics in metrics json", () => {
  const csv = [
    "sep=,",
    "\"Seguidores de Facebook\"",
    "\"Fecha\",\"Primary\"",
    "\"2025-01-01T00:00:00\",\"4\""
  ].join("\n");

  const result = parsePerformanceCsv(csv, { defaultPlatform: "file", sourceFileName: "Seguidores (1).csv" });

  assert.deepEqual(result.diagnostics.detected_metrics, ["followers"]);
  assert.equal(result.records[0]?.metrics.followers, 4);
  assert.equal(result.records[0]?.clicks, null);
  assert.match(result.diagnostics.messages.join(" "), /Faltan metricas recomendadas/);
});
