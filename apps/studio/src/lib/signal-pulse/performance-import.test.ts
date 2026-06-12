import assert from "node:assert/strict";
import test from "node:test";

import { parsePerformanceCsv } from "./performance-import";

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
