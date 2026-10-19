import assert from "node:assert/strict";
import test from "node:test";

import {
  dataOsMetricDefinition,
  dataOsMetricValueRangeIssue
} from "./data-os-metric-catalog";

test("declares metric-specific bounds instead of one generic ratio range", () => {
  assert.deepEqual(dataOsMetricDefinition("margin")?.validRange, { max: 1 });
  assert.deepEqual(dataOsMetricDefinition("conversion_rate")?.validRange, { min: 0, max: 1 });
});

test("accepts loss-making margins and rejects impossible bounded rates", () => {
  assert.equal(dataOsMetricValueRangeIssue("margin", -1.25), null);
  assert.equal(dataOsMetricValueRangeIssue("margin", 1.01), "metric_value_above_maximum");
  assert.equal(dataOsMetricValueRangeIssue("conversion_rate", -0.01), "metric_value_below_minimum");
  assert.equal(dataOsMetricValueRangeIssue("share_of_search", 1.01), "metric_value_above_maximum");
  assert.equal(dataOsMetricValueRangeIssue("retention_rate", 0.45), null);
  assert.equal(dataOsMetricValueRangeIssue("sentiment", 7), null);
});
