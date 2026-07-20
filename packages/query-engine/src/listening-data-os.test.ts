import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateListeningDataQuality,
  LISTENING_NUMERIC_SENTIMENT_SQL
} from "./listening-data-os";

test("listening monthly SQL treats the governed sentiment column as numeric", () => {
  assert.equal(LISTENING_NUMERIC_SENTIMENT_SQL, "m.sentiment_score::numeric");
  assert.equal(LISTENING_NUMERIC_SENTIMENT_SQL.includes("~"), false);
});

test("listening quality passes a complete listening-only corpus", () => {
  const result = evaluateListeningDataQuality({
    totalRecords: 4581,
    includedRecords: 3331,
    excludedRecords: 1250,
    duplicateRecords: 20,
    missingTextRecords: 0,
    missingDateRecords: 0,
    missingPlatformRecords: 0,
    coveredMonths: 13
  });

  assert.equal(result.status, "passed");
  assert.equal(result.readyForAnalysis, true);
  assert.equal(result.blockers.length, 0);
  assert.ok(result.metrics.duplicateRate < 0.02);
});

test("listening quality fails when the records cannot support temporal analysis", () => {
  const result = evaluateListeningDataQuality({
    totalRecords: 100,
    includedRecords: 80,
    excludedRecords: 20,
    duplicateRecords: 0,
    missingTextRecords: 7,
    missingDateRecords: 30,
    missingPlatformRecords: 0,
    coveredMonths: 0
  });

  assert.equal(result.status, "failed");
  assert.equal(result.readyForAnalysis, false);
  assert.match(result.blockers.join(" "), /95%/);
  assert.match(result.blockers.join(" "), /80%/);
  assert.match(result.blockers.join(" "), /month/);
});

test("missing commercial data is not a listening quality failure", () => {
  const result = evaluateListeningDataQuality({
    totalRecords: 25,
    includedRecords: 25,
    excludedRecords: 0,
    duplicateRecords: 0,
    missingTextRecords: 0,
    missingDateRecords: 0,
    missingPlatformRecords: 0,
    coveredMonths: 1
  });

  assert.equal(result.status, "passed");
  assert.equal(result.readyForAnalysis, true);
  assert.equal(result.warnings.some((warning) => warning.includes("commercial")), false);
});
