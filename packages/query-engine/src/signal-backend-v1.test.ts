import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_BACKEND_CONTRACT_VERSION,
  SignalBackendContractError,
  canonicalSignalFilterQueryV1,
  canonicalSignalFilterJsonV1,
  dataWatermarkHashV1,
  decodeSignalDrillDownCursorV1,
  encodeSignalDrillDownCursorV1,
  normalizeSignalFilterV1,
  normalizeSignalMetricQueryV1,
  normalizeSignalWorkspaceLocatorV1,
  parseSignalFilterQueryParamsV1,
  signalFiltersHashV1,
  validateDataFreshnessV1,
  validateDataWatermarkV1,
  validateInterpretationFreshnessV1,
  validateSignalBackendErrorV1,
  validateSignalBreakdownV1,
  validateSignalTimeSeriesV1,
  validateSignalWorkspaceIdentityV1,
  type DataWatermarkV1,
  type SignalFilterV1
} from "./index";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000002";
const CORPUS_ID = "30000000-0000-4000-8000-000000000003";
const SYNC_A = "40000000-0000-4000-8000-000000000004";
const SYNC_B = "50000000-0000-4000-8000-000000000005";
const SUBJECT_ID = "60000000-0000-4000-8000-000000000006";

const BASE_FILTER = {
  date_range: { start: "2026-05-01", end: "2026-05-31" },
  timezone: "America/Mexico_City",
  granularity: "day",
  dimensions: {
    platform: ["TikTok", " instagram ", "tiktok"],
    sentiment_polarity: ["Positive", "negative"]
  }
};

function expectContractError(
  callback: () => unknown,
  code: SignalBackendContractError["code"]
): SignalBackendContractError {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof SignalBackendContractError);
    assert.equal(error.code, code);
    assert.equal(error.toJSON().contract_version, SIGNAL_BACKEND_CONTRACT_VERSION);
    return true;
  });
  try {
    callback();
  } catch (error) {
    return error as SignalBackendContractError;
  }
  throw new Error("Expected callback to throw.");
}

test("normalizes semantic aliases, empty values, duplicates, casing and array order", () => {
  const normalized = normalizeSignalFilterV1({
    dateRange: { from: "2026-05-01", to: "2026-05-31" },
    tz: "america/mexico_city",
    grain: "daily",
    dimensions: {
      platforms: [" TikTok ", "", null, "instagram", "TIKTOK"],
      sentiment: ["POSITIVE", " negative "],
      content_type: "Video, image,video",
      campaign: []
    }
  });

  assert.deepEqual(normalized, {
    contract_version: "signal-backend-v1",
    date_range: { start: "2026-05-01", end: "2026-05-31" },
    timezone: "America/Mexico_City",
    granularity: "day",
    dimensions: {
      platform: ["instagram", "tiktok"],
      sentiment_polarity: ["negative", "positive"],
      content_format: ["image", "video"]
    }
  } satisfies SignalFilterV1);
});

test("semantically equivalent filters produce the same canonical JSON and hash", () => {
  const equivalent = {
    date_range: { start: "2026-05-01", end: "2026-05-31" },
    timezone: "america/mexico_city",
    granularity: "daily",
    dimensions: {
      sentiment: ["negative", "positive", "positive"],
      platforms: ["instagram", "tiktok"]
    }
  };

  assert.equal(signalFiltersHashV1(BASE_FILTER), signalFiltersHashV1(equivalent));
  assert.equal(canonicalSignalFilterJsonV1(BASE_FILTER), canonicalSignalFilterJsonV1(equivalent));
  assert.equal(
    signalFiltersHashV1(BASE_FILTER),
    "sha256:7d6586513c509b03e9510f201bb750fc6667f21208d18e0fee12b80762564a50"
  );
});

test("different filter scopes produce different hashes", () => {
  const differentDate = { ...BASE_FILTER, date_range: { start: "2026-06-01", end: "2026-06-30" } };
  const differentDimension = {
    ...BASE_FILTER,
    dimensions: { ...BASE_FILTER.dimensions, platform: ["youtube"] }
  };

  assert.notEqual(signalFiltersHashV1(BASE_FILTER), signalFiltersHashV1(differentDate));
  assert.notEqual(signalFiltersHashV1(BASE_FILTER), signalFiltersHashV1(differentDimension));
});

test("query-param order, aliases, repeated values and comma lists do not change the hash", () => {
  const first = parseSignalFilterQueryParamsV1(
    "?from=2026-05-01&to=2026-05-31&tz=America%2FMexico_City&grain=daily&platform=TikTok&platform=instagram&sentiment=positive,negative"
  );
  const second = parseSignalFilterQueryParamsV1(
    "?sentiment_polarity=negative&dimensions.platform=instagram,tiktok&granularity=day&timezone=america%2Fmexico_city&end=2026-05-31&start=2026-05-01&sentiment_polarity=positive"
  );

  assert.deepEqual(first, second);
  assert.equal(signalFiltersHashV1(first), signalFiltersHashV1(second));
  assert.equal(
    canonicalSignalFilterQueryV1(first),
    "start=2026-05-01&end=2026-05-31&timezone=America%2FMexico_City&granularity=day&dimension.platform=instagram&dimension.platform=tiktok&dimension.sentiment_polarity=negative&dimension.sentiment_polarity=positive"
  );
});

test("unknown dimensions and invalid date ranges fail with typed errors", () => {
  expectContractError(
    () => normalizeSignalFilterV1({ ...BASE_FILTER, dimensions: { algorithm_guess: ["x"] } }),
    "unsupported_dimension"
  );
  expectContractError(
    () => normalizeSignalFilterV1({ ...BASE_FILTER, date_range: { start: "2026-05-32", end: "2026-06-01" } }),
    "invalid_filter"
  );
  expectContractError(
    () => normalizeSignalFilterV1({ ...BASE_FILTER, date_range: { start: "2026-06-01", end: "2026-05-01" } }),
    "invalid_filter"
  );
  expectContractError(
    () => normalizeSignalFilterV1({ ...BASE_FILTER, contract_version: "signal-backend-v2" }),
    "invalid_filter"
  );
});

test("workspace locator and identity enforce stable organization and subject scope", () => {
  assert.deepEqual(normalizeSignalWorkspaceLocatorV1({
    organizationId: ORGANIZATION_ID.toUpperCase(),
    workspaceSlug: " Brand-Home "
  }), {
    contract_version: "signal-backend-v1",
    organization_id: ORGANIZATION_ID,
    workspace_slug: "brand-home"
  });

  assert.deepEqual(validateSignalWorkspaceIdentityV1({
    workspace_id: WORKSPACE_ID,
    organization_id: ORGANIZATION_ID,
    workspace_slug: "brand-home",
    subject: { type: "brand", id: SUBJECT_ID },
    timezone: "America/Mexico_City"
  }).subject, { type: "brand", id: SUBJECT_ID });

  expectContractError(() => normalizeSignalWorkspaceLocatorV1({
    organization_id: ORGANIZATION_ID,
    workspace_id: WORKSPACE_ID,
    workspace_slug: "brand-home"
  }), "invalid_filter");
});

test("metric queries derive the hash and reject mismatched or incompatible scopes", () => {
  const query = normalizeSignalMetricQueryV1({
    workspace: { organization_id: ORGANIZATION_ID, workspace_id: WORKSPACE_ID },
    metric_key: "conversation.volume",
    metric_version: 1,
    filter: BASE_FILTER,
    comparison_date_range: { start: "2026-03-31", end: "2026-04-30" },
    breakdown_dimension: "platforms"
  });
  assert.equal(query.filters_hash, signalFiltersHashV1(BASE_FILTER));
  assert.equal(query.breakdown_dimension, "platform");

  expectContractError(() => normalizeSignalMetricQueryV1({
    workspace: { organization_id: ORGANIZATION_ID, workspace_id: WORKSPACE_ID },
    metric_key: "conversation.volume",
    filter: BASE_FILTER,
    filters_hash: `sha256:${"0".repeat(64)}`
  }), "invalid_filter");

  expectContractError(() => normalizeSignalMetricQueryV1({
    workspace: { organization_id: ORGANIZATION_ID, workspace_id: WORKSPACE_ID },
    metric_key: "conversation.volume",
    filter: BASE_FILTER,
    comparison_date_range: { start: "2026-05-15", end: "2026-06-14" }
  }), "invalid_filter");
});

test("watermarks canonicalize instants and sync identifiers deterministically", () => {
  const watermark = validateDataWatermarkV1({
    workspace_id: WORKSPACE_ID,
    corpus_id: CORPUS_ID,
    corpus_revision: 7,
    source_sync_run_ids: [SYNC_B, SYNC_A, SYNC_B],
    data_through_at: "2026-05-31T18:00:00-06:00",
    accepted_at: "2026-06-01T00:00:00Z",
    materialized_at: "2026-06-01T00:05:00Z"
  });

  assert.deepEqual(watermark.source_sync_run_ids, [SYNC_A, SYNC_B]);
  assert.equal(watermark.data_through_at, "2026-06-01T00:00:00.000Z");
  assert.equal(dataWatermarkHashV1(watermark), dataWatermarkHashV1({
    ...watermark,
    source_sync_run_ids: [SYNC_B, SYNC_A]
  }));
});

test("data and interpretation freshness stay separate and validate their own scope", () => {
  const watermark = makeWatermark();
  const hash = signalFiltersHashV1(BASE_FILTER);
  const watermarkHash = dataWatermarkHashV1(watermark);

  assert.equal(validateDataFreshnessV1({
    state: "fresh",
    evaluated_at: "2026-06-01T00:06:00Z",
    stale_after: "2026-06-02T00:00:00Z",
    watermark,
    reason: null
  }).state, "fresh");

  assert.equal(validateInterpretationFreshnessV1({
    state: "stale",
    evaluated_at: "2026-06-01T00:06:00Z",
    filters_hash: hash,
    data_watermark_hash: watermarkHash,
    interpretation_watermark_hash: `sha256:${"1".repeat(64)}`,
    reason: "interpretation_watermark_behind"
  }).state, "stale");

  expectContractError(() => validateDataFreshnessV1({
    state: "not_available",
    evaluated_at: "2026-06-01T00:06:00Z",
    stale_after: null,
    watermark,
    reason: "missing"
  }), "invalid_filter");
});

test("time-series and breakdown validators preserve null semantics and reject ambiguity", () => {
  const watermark = makeWatermark();
  const freshness = makeFreshness(watermark);
  const filtersHash = signalFiltersHashV1(BASE_FILTER);
  const series = validateSignalTimeSeriesV1({
    metric_key: "conversation.volume",
    metric_version: 1,
    filters_hash: filtersHash,
    granularity: "daily",
    watermark,
    freshness,
    points: [
      { period_start: "2026-05-01", period_end: "2026-05-01", value: 12, denominator: 20, sample_size: 20, state: "available" },
      { period_start: "2026-05-02", period_end: "2026-05-02", value: null, denominator: null, sample_size: 0, state: "not_available" }
    ]
  });
  assert.equal(series.points[1]?.value, null);

  expectContractError(() => validateSignalTimeSeriesV1({
    ...series,
    points: [
      { period_start: "2026-05-01", period_end: "2026-05-01", value: null, denominator: 20, sample_size: 20, state: "available" }
    ]
  }), "invalid_filter");

  const breakdown = validateSignalBreakdownV1({
    metric_key: "conversation.volume",
    metric_version: 1,
    filters_hash: filtersHash,
    dimension: "platforms",
    watermark,
    freshness,
    buckets: [
      { key: "TikTok", label: "TikTok", value: 12, denominator: 20, sample_size: 20, state: "partial" }
    ]
  });
  assert.equal(breakdown.buckets[0]?.key, "tiktok");

  expectContractError(() => validateSignalBreakdownV1({
    ...breakdown,
    buckets: [...breakdown.buckets, { ...breakdown.buckets[0], label: "Duplicate" }]
  }), "invalid_filter");
});

test("drill-down cursors round-trip and remain bound to metric and filter scope", () => {
  const cursor = {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: "conversation.volume",
    filters_hash: signalFiltersHashV1(BASE_FILTER),
    direction: "next",
    sort: { occurred_at: "2026-05-30T12:34:56-06:00", subject_id: SUBJECT_ID }
  };
  const encoded = encodeSignalDrillDownCursorV1(cursor);
  const decoded = decodeSignalDrillDownCursorV1(encoded);
  assert.equal(decoded.metric_key, cursor.metric_key);
  assert.equal(decoded.filters_hash, cursor.filters_hash);
  assert.equal(decoded.sort.occurred_at, "2026-05-30T18:34:56.000Z");
  expectContractError(() => decodeSignalDrillDownCursorV1("not-a-cursor"), "invalid_filter");
});

test("all public error codes validate through the shared package surface", () => {
  for (const code of ["invalid_filter", "unsupported_dimension", "stale", "partial", "not_available"] as const) {
    assert.equal(validateSignalBackendErrorV1({
      error: code,
      message: `Typed ${code}`,
      details: { retryable: false }
    }).error, code);
  }
});

function makeWatermark(): DataWatermarkV1 {
  return validateDataWatermarkV1({
    workspace_id: WORKSPACE_ID,
    corpus_id: CORPUS_ID,
    corpus_revision: 7,
    source_sync_run_ids: [SYNC_A],
    data_through_at: "2026-05-31T23:59:59Z",
    accepted_at: "2026-06-01T00:00:00Z",
    materialized_at: "2026-06-01T00:05:00Z"
  });
}

function makeFreshness(watermark: DataWatermarkV1) {
  return validateDataFreshnessV1({
    state: "fresh",
    evaluated_at: "2026-06-01T00:06:00Z",
    stale_after: "2026-06-02T00:00:00Z",
    watermark,
    reason: null
  });
}
