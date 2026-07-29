import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSignalAnalyticsQueryV1,
  parseSignalAnalyticsQueryParamsV1,
  resolveSignalComparisonV1,
  type SignalFilterV1
} from "./index";

const FILTER = {
  contract_version: "signal-backend-v1",
  date_range: { start: "2026-07-14", end: "2026-07-23" },
  timezone: "America/Mexico_City",
  granularity: "day",
  dimensions: { platform: ["instagram", "tiktok"] }
} satisfies SignalFilterV1;

test("derives an equal non-overlapping previous period", () => {
  assert.deepEqual(resolveSignalComparisonV1({
    filter: FILTER,
    mode: "previous_period"
  }), {
    mode: "previous_period",
    date_range: { start: "2026-07-04", end: "2026-07-13" }
  });
});

test("supports calendar-year and weekday-aligned year comparisons", () => {
  const leapFilter = {
    ...FILTER,
    date_range: { start: "2024-02-29", end: "2024-03-02" }
  };
  assert.deepEqual(resolveSignalComparisonV1({
    filter: leapFilter,
    mode: "previous_year"
  }).date_range, {
    start: "2023-02-28",
    end: "2023-03-02"
  });
  assert.deepEqual(resolveSignalComparisonV1({
    filter: {
      ...FILTER,
      date_range: { start: "2024-02-28", end: "2024-03-01" }
    },
    mode: "previous_year"
  }).date_range, {
    start: "2023-02-28",
    end: "2023-03-02"
  });
  assert.deepEqual(resolveSignalComparisonV1({
    filter: FILTER,
    mode: "previous_year_same_weekday"
  }).date_range, {
    start: "2025-07-15",
    end: "2025-07-24"
  });
});

test("round trips canonical filters and custom comparison through URL state", () => {
  const parsed = parseSignalAnalyticsQueryParamsV1(
    "?start=2026-07-14&end=2026-07-23&timezone=America%2FMexico_City&granularity=day"
      + "&dimension.platform=tiktok&dimension.platform=instagram"
      + "&compare=custom&compareStart=2026-06-01&compareEnd=2026-06-10"
  );
  assert.equal(
    canonicalSignalAnalyticsQueryV1(parsed),
    "start=2026-07-14&end=2026-07-23&timezone=America%2FMexico_City&granularity=day"
      + "&dimension.platform=instagram&dimension.platform=tiktok"
      + "&compare=custom&compareStart=2026-06-01&compareEnd=2026-06-10"
  );
});

test("ignores serving pagination and sorting controls when parsing filters", () => {
  const parsed = parseSignalAnalyticsQueryParamsV1(
    "?start=2026-07-14&end=2026-07-23&timezone=America%2FMexico_City&granularity=day"
      + "&dimension.platform=facebook&compare=previous_period"
      + "&limit=50&offset=50&sort=interaction_count&direction=desc"
  );

  assert.deepEqual(parsed.filter.dimensions, { platform: ["facebook"] });
  assert.equal(parsed.comparison.mode, "previous_period");
});

test("rejects overlapping and mismatched custom comparison windows", () => {
  assert.throws(() => resolveSignalComparisonV1({
    filter: FILTER,
    mode: "custom",
    custom_date_range: { start: "2026-07-01", end: "2026-07-14" }
  }), /overlap/);
  assert.throws(() => resolveSignalComparisonV1({
    filter: FILTER,
    mode: "custom",
    custom_date_range: { start: "2026-06-01", end: "2026-06-02" }
  }), /same number/);
});
