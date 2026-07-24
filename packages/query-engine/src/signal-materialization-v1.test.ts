import assert from "node:assert/strict";
import test from "node:test";

import { SIGNAL_METRIC_DEFINITIONS_V1 } from "./signal-metric-catalog-v1";
import {
  buildSignalMentionDrillDownPlanV1,
  buildSignalAdHocMaterializationJobV1,
  buildSignalMentionPredicateV1,
  buildSignalMetricMaterializationPlanV1,
  buildSignalPrecomputedFiltersV1,
  classifySignalFilterCacheScopeV1,
  evaluateSignalMetricQualityV1,
  materializeSignalFixtureV1,
  previousSignalBucketStartV1,
  SIGNAL_MATERIALIZATION_MAX_PRECOMPUTED_FILTERS,
  signalMetricMaterializationKeyV1,
  splitSignalMaterializationDateRangeV1
} from "./signal-materialization-v1";

const corpusId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const baseFilter = {
  date_range: { start: "2026-06-01", end: "2026-06-30" },
  timezone: "America/Mexico_City",
  granularity: "daily",
  dimensions: { platforms: [" X ", "x"] }
};

test("materialization and drill-down use the exact same canonical predicate", () => {
  const materialization = buildSignalMetricMaterializationPlanV1({
    metric_key: "conversation.volume",
    filter: baseFilter,
    study_corpus_ids: [corpusId]
  });
  const drillDown = buildSignalMentionDrillDownPlanV1({
    filter: baseFilter,
    study_corpus_ids: [corpusId]
  });

  assert.equal(materialization.predicate.fingerprint, drillDown.predicate.fingerprint);
  assert.equal(materialization.predicate.filters_hash, drillDown.predicate.filters_hash);
  assert.deepEqual(materialization.predicate.params, drillDown.predicate.params);
  assert.match(materialization.sql, /FROM mentions m/u);
  assert.doesNotMatch(materialization.sql, /published_outputs|chart_aggregates/u);
});

test("metric drill-down adds the same governed constituent rule used by aggregation", () => {
  const engagement = buildSignalMentionDrillDownPlanV1({
    metric_key: "engagement.total",
    filter: baseFilter,
    study_corpus_ids: [corpusId]
  });
  const topic = buildSignalMentionDrillDownPlanV1({
    metric_key: "topic.volume",
    filter: baseFilter,
    study_corpus_ids: [corpusId]
  });
  assert.match(engagement.sql, /jsonb_typeof\(m\.engagement->'likes'\) = 'number'/u);
  assert.match(topic.sql, /record_tags tag/u);
  assert.match(topic.sql, /taxonomy\.taxonomy_key\) LIKE '%topic%'/u);
});

test("planner parameterizes dimension values and is stable for equivalent filters", () => {
  const left = buildSignalMentionPredicateV1(baseFilter, [corpusId]);
  const right = buildSignalMentionPredicateV1({
    contract_version: "signal-backend-v1",
    date_range: { start: "2026-06-01", end: "2026-06-30" },
    timezone: "America/Mexico_City",
    granularity: "day",
    dimensions: { platform: ["x"] }
  }, [corpusId]);
  assert.equal(left.fingerprint, right.fingerprint);
  assert.equal(left.filters_hash, right.filters_hash);
  assert.ok(left.params.some((value) => Array.isArray(value) && value.includes("x")));
  assert.doesNotMatch(left.sql, /\bX\b/u);
});

test("all five catalog groups produce deterministic daily, weekly and monthly SQL plans", () => {
  const groups = new Set<string>();
  for (const metric of SIGNAL_METRIC_DEFINITIONS_V1) {
    groups.add(metric.group);
    for (const granularity of ["day", "week", "month"] as const) {
      const plan = buildSignalMetricMaterializationPlanV1({
        metric_key: metric.key,
        metric_version: metric.version,
        filter: { ...baseFilter, granularity, dimensions: {} },
        study_corpus_ids: [corpusId]
      });
      assert.match(plan.sql, /period_start/u);
      assert.match(plan.sql, /typed_payload/u);
      assert.match(plan.sql, /materialization_state/u);
      if (metric.key.endsWith(".share")) {
        assert.match(plan.sql, /COUNT\(DISTINCT id\)::numeric AS period_denominator/u);
      }
      assert.equal(plan.metric.key, metric.key);
    }
  }
  assert.equal(groups.size, 5);
});

test("conversation velocity reads one real preceding bucket but only emits the visible range", () => {
  const daily = buildSignalMetricMaterializationPlanV1({
    metric_key: "conversation.velocity",
    filter: { ...baseFilter, dimensions: {}, granularity: "day" },
    study_corpus_ids: [corpusId]
  });
  assert.equal(daily.predicate.normalized_filter.date_range.start, "2026-06-01");
  assert.ok(daily.params.includes("2026-05-31"));
  assert.match(daily.sql, /WHERE period_start >= '2026-06-01'::date/u);
  assert.match(daily.sql, /generate_series\(/u);
  assert.match(daily.sql, /'2026-05-31'::date/u);
  assert.match(daily.sql, /'previous_count', previous_count/u);
  assert.equal(previousSignalBucketStartV1("2026-06-15", "month"), "2026-05-01");
  assert.equal(previousSignalBucketStartV1("2026-06-03", "week"), "2026-05-25");
});

test("conversation velocity permits its derived lookback at the maximum visible range", () => {
  const plan = buildSignalMetricMaterializationPlanV1({
    metric_key: "conversation.velocity",
    filter: {
      contract_version: "signal-backend-v1",
      date_range: { start: "2025-01-01", end: "2026-01-01" },
      timezone: "UTC",
      granularity: "day",
      dimensions: {}
    },
    study_corpus_ids: [corpusId]
  });

  assert.equal(plan.predicate.normalized_filter.date_range.start, "2025-01-01");
  assert.ok(plan.params.includes("2024-12-31"));
});

test("governed classification SQL excludes unreviewed evidence and marks provisional periods partial", () => {
  const plan = buildSignalMetricMaterializationPlanV1({
    metric_key: "topic.volume",
    filter: { ...baseFilter, dimensions: {} },
    study_corpus_ids: [corpusId]
  });
  assert.match(plan.sql, /tag\.review_status = 'approved'/u);
  assert.match(plan.sql, /tag\.review_status NOT IN \('approved', 'rejected'\)/u);
  assert.match(plan.sql, /'pending_review_count', pending_count/u);
  assert.match(plan.sql, /WHEN pending_count > 0 THEN 'partial'/u);
});

test("catalog quality rules execute and pending governed evidence cannot pass", () => {
  const metric = SIGNAL_METRIC_DEFINITIONS_V1.find((item) => item.key === "topic.volume");
  assert.ok(metric);
  const evaluation = evaluateSignalMetricQualityV1({
    metric,
    data_freshness: "fresh",
    row: {
      denominator: null,
      sample_size: 2,
      materialization_state: "partial",
      quality_state: "partial",
      typed_payload: { pending_review_count: 1 }
    }
  });
  assert.equal(evaluation.state, "partial");
  assert.equal(evaluation.results.find((item) => item.key === "review_pending")?.state, "partial");
  assert.notEqual(evaluation.state, "pass");
});

test("planner rejects excessive ranges, cardinality and unsupported metric dimensions with typed errors", () => {
  assert.throws(
    () => buildSignalMentionPredicateV1({
      date_range: { start: "2025-01-01", end: "2026-12-31" },
      timezone: "UTC",
      granularity: "day",
      dimensions: {}
    }, [corpusId]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_filter"
  );
  assert.throws(
    () => buildSignalMentionPredicateV1({
      date_range: { start: "2026-01-01", end: "2026-01-31" },
      timezone: "UTC",
      granularity: "day",
      dimensions: { platform: Array.from({ length: 51 }, (_, index) => `platform-${index}`) }
    }, [corpusId]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_filter"
  );
  assert.throws(
    () => buildSignalMetricMaterializationPlanV1({
      metric_key: "platform.share",
      filter: { ...baseFilter, dimensions: { topic: ["service"] } },
      study_corpus_ids: [corpusId]
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "unsupported_dimension"
  );
});

test("default, bounded precomputed and ad hoc cache scopes cannot expand silently", () => {
  assert.equal(classifySignalFilterCacheScopeV1({ ...baseFilter, dimensions: {} }), "default");
  assert.equal(classifySignalFilterCacheScopeV1(baseFilter), "precomputed");
  assert.equal(classifySignalFilterCacheScopeV1({ ...baseFilter, dimensions: { platform: ["x"], country: ["mx"] } }), "ad_hoc");
  const filters = buildSignalPrecomputedFiltersV1(
    { ...baseFilter, dimensions: {} },
    { platform: ["x", "facebook", "instagram"], source_type: ["organic", "paid"], country: ["mx"], language: ["es", "en"] }
  );
  assert.equal(filters.length, SIGNAL_MATERIALIZATION_MAX_PRECOMPUTED_FILTERS);
  assert.equal(filters[0]?.dimensions && Object.keys(filters[0].dimensions).length, 0);
  assert.ok(filters.slice(1).every((filter) => Object.keys(filter.dimensions).length === 1));
  assert.deepEqual(splitSignalMaterializationDateRangeV1({ start: "2025-01-01", end: "2026-01-02" }), [
    { start: "2025-01-01", end: "2026-01-01" },
    { start: "2026-01-02", end: "2026-01-02" }
  ]);
});

test("fixture aggregate, breakdown and drill-down constituents reconcile under one filter", () => {
  const fixture = [
    { id: "m1", published_at: "2026-06-02T01:00:00Z", dimensions: { platform: ["x"], country: ["mx"] }, engagement: 3 },
    { id: "m2", published_at: "2026-06-03T01:00:00Z", dimensions: { platform: ["x"], country: ["mx"] }, engagement: 5 },
    { id: "m3", published_at: "2026-06-04T01:00:00Z", dimensions: { platform: ["facebook"], country: ["mx"] }, engagement: null },
    { id: "m4", published_at: "2026-06-05T01:00:00Z", included: false, dimensions: { platform: ["x"] }, engagement: 99 }
  ];
  const volume = materializeSignalFixtureV1("conversation.volume", { ...baseFilter, dimensions: {} }, fixture);
  assert.equal(volume.value, volume.constituent_ids.length);
  assert.equal(volume.value, volume.breakdown.reduce((total, bucket) => total + bucket.value, 0));

  const filtered = materializeSignalFixtureV1("conversation.volume", baseFilter, fixture);
  assert.deepEqual(filtered.constituent_ids, ["m1", "m2"]);
  assert.equal(filtered.value, 2);

  const average = materializeSignalFixtureV1("engagement.average_per_mention", { ...baseFilter, dimensions: {} }, fixture);
  assert.equal(average.value, 4);
  assert.equal(average.denominator, average.constituent_ids.length);
  assert.deepEqual(average.constituent_ids, ["m1", "m2"]);
});

test("materialization identities are deterministic and exclude the watermark so invalidation updates in place", () => {
  const input = {
    workspace_id: workspaceId,
    study_corpus_id: corpusId,
    metric_key: "conversation.volume",
    metric_version: 1,
    granularity: "month" as const,
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    filters_hash: buildSignalMentionPredicateV1({ ...baseFilter, granularity: "month" }, [corpusId]).filters_hash
  };
  assert.equal(signalMetricMaterializationKeyV1(input), signalMetricMaterializationKeyV1({ ...input }));
  assert.match(signalMetricMaterializationKeyV1(input), /^sha256:[0-9a-f]{64}$/u);
});

test("ad hoc jobs are bounded, normalized and deduplicated by filter plus metric set", () => {
  const left = buildSignalAdHocMaterializationJobV1({
    workspace_id: workspaceId,
    study_corpus_id: corpusId,
    filter: baseFilter,
    metric_keys: ["conversation.volume", "engagement.total", "conversation.volume"]
  });
  const right = buildSignalAdHocMaterializationJobV1({
    workspace_id: workspaceId,
    study_corpus_id: corpusId,
    filter: { ...baseFilter, granularity: "day", dimensions: { platform: ["x"] } },
    metric_keys: ["engagement.total", "conversation.volume"]
  });
  assert.equal(left.job_id, right.job_id);
  assert.equal(left.data.trigger, "ad_hoc");
  assert.deepEqual(left.data.trigger === "ad_hoc" ? left.data.metric_keys : [], ["conversation.volume", "engagement.total"]);
  assert.throws(
    () => buildSignalAdHocMaterializationJobV1({
      workspace_id: workspaceId,
      study_corpus_id: corpusId,
      filter: baseFilter,
      metric_keys: ["one", "two", "three", "four", "five", "six"]
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_filter"
  );
});
