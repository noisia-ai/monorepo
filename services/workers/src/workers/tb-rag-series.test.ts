import assert from "node:assert/strict";
import test from "node:test";

import { selectTbRagMonthlySeries, type TbRagSeriesRow } from "./tb-rag-series";

const commercial: TbRagSeriesRow[] = [
  {
    month: "2026-01",
    metric_family: "sales",
    metric_key: "sales_monthly",
    metric_unit: "currency",
    metric_value: "12500",
    observations: "1"
  }
];
const canonicalListening: TbRagSeriesRow[] = [
  {
    month: "2026-01",
    metric_family: "mentions",
    metric_key: "mentions_monthly",
    metric_unit: "count",
    metric_value: "250",
    observations: "250"
  }
];
const fallbackListening: TbRagSeriesRow[] = [
  {
    month: "2026-01",
    metric_family: "mentions",
    metric_key: "mentions_monthly",
    metric_unit: "count",
    metric_value: "999",
    observations: "999"
  }
];

test("uses governed listening once and ignores the raw fallback", () => {
  const result = selectTbRagMonthlySeries({
    commercial,
    canonicalListening,
    rawListeningFallback: fallbackListening
  });
  assert.equal(result.listeningSource, "listening_data_os");
  assert.equal(result.monthlySeries.length, 2);
  assert.equal(result.monthlySeries.find((row) => row.metric_key === "mentions_monthly")?.value, 250);
  assert.equal(result.overlappingMonths, 1);
});

test("uses raw mentions only when governed listening is unavailable", () => {
  const result = selectTbRagMonthlySeries({
    commercial: [],
    canonicalListening: [],
    rawListeningFallback: fallbackListening
  });
  assert.equal(result.listeningSource, "listening_mentions_fallback");
  assert.equal(result.monthlySeries.length, 1);
  assert.equal(result.monthlySeries[0]?.value, 999);
  assert.equal(result.observationMonths, 0);
  assert.equal(result.overlappingMonths, 0);
});

test("does not accept a non-mention listening metric as proof of canonical coverage", () => {
  const result = selectTbRagMonthlySeries({
    commercial,
    canonicalListening: [
      { ...canonicalListening[0]!, metric_key: "sentiment_monthly", metric_family: "sentiment" }
    ],
    rawListeningFallback: fallbackListening
  });
  assert.equal(result.listeningSource, "listening_mentions_fallback");
  assert.equal(result.monthlySeries.length, 2);
});
