import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalDataOsTimeline } from "./signal-timeline-model";

test("builds a governed cross-source timeline and prioritizes sales", () => {
  const model = buildSignalDataOsTimeline([
    point("2026-01", "mentions", "mentions_monthly", 100, "listening_mentions"),
    point("2026-02", "mentions", "mentions_monthly", 120, "listening_mentions"),
    point("2026-01", "search", "search_volume_monthly", 500, "data_observations"),
    point("2026-02", "search", "search_volume_monthly", 700, "data_observations"),
    point("2026-01", "sales", "sales_monthly", 40_000, "data_observations"),
    point("2026-02", "sales", "sales_monthly", 48_000, "data_observations")
  ]);

  assert.ok(model);
  assert.equal(model.metrics[0]?.key, "sales_monthly");
  assert.equal(model.overlappingMonths, 2);
  assert.deepEqual(model.points[1], {
    month: "2026-02",
    mentions: 120,
    values: { sales_monthly: 48_000, search_volume_monthly: 700 }
  });
});

test("does not expose a comparison without real monthly overlap", () => {
  assert.equal(buildSignalDataOsTimeline([
    point("2026-01", "mentions", "mentions_monthly", 100, "listening_mentions"),
    point("2025-12", "sales", "sales_monthly", 40_000, "data_observations")
  ]), null);
});

function point(
  month: string,
  metricFamily: string,
  metricKey: string,
  value: number,
  source: "data_observations" | "listening_mentions"
) {
  return {
    month,
    metricFamily,
    metricKey,
    unit: metricKey === "sales_monthly" ? "MXN" : "count",
    value,
    observations: 1,
    source
  } as const;
}
