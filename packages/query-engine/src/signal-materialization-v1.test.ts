import assert from "node:assert/strict";
import test from "node:test";

import { SIGNAL_METRIC_DEFINITIONS_V1 } from "./signal-metric-catalog-v1";
import {
  buildSignalMentionDrillDownPlanV1,
  buildSignalAdHocMaterializationJobV1,
  buildSignalMentionPredicateV1,
  buildSignalMentionReadPredicateV1,
  buildSignalPopulationMentionReadPredicateV1,
  buildSignalWorkspaceCanonicalMentionReadPredicateV1,
  buildSignalMetricMaterializationPlanV1,
  buildSignalPrecomputedFiltersV1,
  classifySignalFilterCacheScopeV1,
  evaluateSignalMetricQualityV1,
  materializeSignalFixtureV1,
  materializeSignalTaxonomyFixtureV1,
  previousSignalBucketStartV1,
  SIGNAL_MATERIALIZATION_MAX_PRECOMPUTED_FILTERS,
  signalMetricMaterializationKeyV1,
  splitSignalMaterializationDateRangeV1
} from "./signal-materialization-v1";

const corpusId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const populationId = "20000000-0000-4000-8000-000000000002";
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
  assert.match(drillDown.sql, /record_tags tag/u);
  assert.match(drillDown.sql, /record_entity_links relation/u);
  assert.match(drillDown.sql, /record_feature_values feature/u);
  assert.match(drillDown.sql, /mention_query_sources source/u);
  assert.match(drillDown.sql, /COALESCE\(attribution\.items, '\[\]'::jsonb\) AS attribution/u);
  assert.match(drillDown.sql, /feature\.feature_key = 'tb_coding'/u);
  assert.match(
    drillDown.sql,
    /analysis\.status IN \('approved_by_im', 'approved_by_kam'\)/u
  );
  assert.match(drillDown.sql, /count\(\*\) OVER\(\)::int AS total_count/u);
  assert.match(drillDown.sql, /tag\.review_status = 'approved'/u);
  assert.doesNotMatch(drillDown.sql, /canonical_mention_id/u);
});

test("population drill-down reads active canonical membership without a corpus owner", () => {
  const predicate = buildSignalPopulationMentionReadPredicateV1(
    baseFilter,
    populationId,
    workspaceId
  );
  const drillDown = buildSignalMentionDrillDownPlanV1({
    filter: baseFilter,
    population_id: populationId,
    workspace_id: workspaceId
  });

  assert.equal(drillDown.predicate.fingerprint, predicate.fingerprint);
  assert.match(predicate.sql, /signal_population_memberships population_membership/u);
  assert.match(predicate.sql, /population_membership\.removed_at IS NULL/u);
  assert.match(predicate.sql, /m\.canonical_mention_id = m\.id/u);
  assert.doesNotMatch(predicate.sql, /m\.study_corpus_id/u);
  assert.ok(predicate.params.includes(populationId));
  assert.ok(predicate.params.includes(workspaceId));
  assert.match(drillDown.sql, /tagged_mention\.canonical_mention_id/u);
});

test("workspace canonical drill-down reads every canonical mention without operational membership", () => {
  const predicate = buildSignalWorkspaceCanonicalMentionReadPredicateV1(baseFilter, workspaceId);
  const drillDown = buildSignalMentionDrillDownPlanV1({
    filter: baseFilter,
    workspace_canonical: true,
    workspace_id: workspaceId
  });

  assert.equal(drillDown.predicate.fingerprint, predicate.fingerprint);
  assert.match(predicate.sql, /m\.workspace_id = \$1::uuid/u);
  assert.match(predicate.sql, /m\.canonical_mention_id = m\.id/u);
  assert.doesNotMatch(predicate.sql, /signal_population_memberships/u);
  assert.doesNotMatch(predicate.sql, /m\.inclusion_status = 'included'/u);
  assert.doesNotMatch(predicate.sql, /m\.study_corpus_id/u);
  assert.match(drillDown.sql, /tagged_mention\.canonical_mention_id/u);
  assert.match(drillDown.sql, /WITH scoped_mentions AS MATERIALIZED/u);
  assert.match(drillDown.sql, /page_mentions AS \(/u);
  assert.match(drillDown.sql, /FROM page_mentions m/u);
  assert.match(drillDown.sql, /\(SELECT count\(\*\)::int FROM scoped_mentions\) AS total_count/u);
  assert.match(drillDown.sql, /tag\.subject_id = ANY\(ARRAY\(/u);
  assert.doesNotMatch(drillDown.sql, /count\(\*\) OVER\(\)::int AS total_count/u);
});

test("workspace canonical drill-down rejects a second ownership source", () => {
  assert.throws(
    () => buildSignalMentionDrillDownPlanV1({
      filter: baseFilter,
      workspace_canonical: true,
      workspace_id: workspaceId,
      population_id: populationId
    }),
    /exactly one ownership source/u
  );
});

test("governed materialization identity includes population version and definition hash", () => {
  const populationDefinitionHash = `sha256:${"a".repeat(64)}`;
  const plan = buildSignalMetricMaterializationPlanV1({
    metric_key: "conversation.volume",
    filter: { ...baseFilter, dimensions: {} },
    population_id: populationId,
    workspace_id: workspaceId
  });
  assert.match(plan.predicate.sql, /signal_population_memberships/u);
  assert.doesNotMatch(plan.predicate.sql, /m\.study_corpus_id/u);
  const key = signalMetricMaterializationKeyV1({
    workspace_id: workspaceId,
    population_id: populationId,
    population_version: 3,
    population_definition_hash: populationDefinitionHash,
    metric_key: "conversation.volume",
    metric_version: 1,
    granularity: "day",
    period_start: "2026-06-01",
    period_end: "2026-06-01",
    filters_hash: plan.predicate.filters_hash
  });
  const revised = signalMetricMaterializationKeyV1({
    workspace_id: workspaceId,
    population_id: populationId,
    population_version: 4,
    population_definition_hash: `sha256:${"b".repeat(64)}`,
    metric_key: "conversation.volume",
    metric_version: 1,
    granularity: "day",
    period_start: "2026-06-01",
    period_end: "2026-06-01",
    filters_hash: plan.predicate.filters_hash
  });
  assert.notEqual(key, revised);
  assert.throws(() => buildSignalMetricMaterializationPlanV1({
    metric_key: "conversation.volume",
    filter: baseFilter,
    population_id: populationId,
    study_corpus_ids: [corpusId],
    workspace_id: workspaceId
  }), /exactly one operational ownership scope/u);
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
    study_corpus_ids: [corpusId],
    workspace_id: workspaceId
  });
  assert.match(engagement.sql, /jsonb_typeof\(m\.engagement->'likes'\) = 'number'/u);
  assert.match(topic.sql, /record_tags tag/u);
  assert.match(topic.sql, /signal_taxonomy_profiles profile/u);
  assert.match(topic.sql, /profile\.kind = 'topic'/u);
  assert.match(topic.sql, /tagged_mention\.id = m\.id/u);
  assert.doesNotMatch(topic.sql, /canonical_mention_id/u);
  assert.doesNotMatch(topic.sql, /LIKE '%topic%'/u);
});

test("term-filtered taxonomy drill-down does not repeat the same accepted-tag existence scan", () => {
  const topic = buildSignalMentionDrillDownPlanV1({
    metric_key: "topic.volume",
    filter: {
      ...baseFilter,
      dimensions: { topic: ["battery"] }
    },
    study_corpus_ids: [corpusId],
    workspace_id: workspaceId
  });
  assert.equal(topic.sql.match(/SELECT 1 FROM record_tags tag/gu)?.length, 1);
  assert.match(topic.sql, /term\.term_key/u);
  assert.match(topic.sql, /tag\.review_status = 'approved'/u);
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

test("mention drill-down keeps enriched filters, sorting and offset server-side", () => {
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: {
      ...baseFilter,
      dimensions: {
        corpus_scope: ["brand"],
        conversation_role: ["comment"],
        tb_polarity: ["barrier"],
        tb_layer: ["personal"],
        observed_signal: ["la promo no era lo que decía"]
      }
    },
    limit: 50,
    offset: 100,
    order_by: { field: "conversation_role", direction: "asc" },
    study_corpus_ids: [corpusId]
  });

  assert.match(plan.sql, /mention_query_sources source/u);
  assert.match(plan.sql, /feature\.feature_key = 'tb_coding'/u);
  assert.match(plan.sql, /ORDER BY CASE[\s\S]*lower\(COALESCE\([\s\S]*m\.content_type/u);
  assert.match(plan.sql, /LIMIT \$\d+::int/u);
  assert.match(plan.sql, /OFFSET \$\d+::int/u);
  assert.ok(plan.params.includes(51));
  assert.ok(plan.params.includes(100));
});

test("mention drill-down can resolve a stable enriched mention without weakening corpus filters", () => {
  const mentionId = "30000000-0000-4000-8000-000000000001";
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: baseFilter,
    limit: 1,
    study_corpus_ids: [corpusId],
    subject_ids: [mentionId, mentionId]
  });

  assert.match(plan.sql, /m\.id = ANY\(\$\d+::uuid\[\]\)/u);
  assert.match(plan.sql, /m\.study_corpus_id = ANY\(\$\d+::uuid\[\]\)/u);
  assert.ok(plan.params.some((value) => (
    Array.isArray(value)
    && value.length === 1
    && value[0] === mentionId
  )));
  assert.doesNotMatch(plan.sql, new RegExp(mentionId, "u"));
});

test("mention engagement sorting accepts numeric JSON values and numeric strings", () => {
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: baseFilter,
    limit: 25,
    offset: 0,
    order_by: { field: "engagement", direction: "desc" },
    study_corpus_ids: [corpusId]
  });

  assert.match(plan.sql, /COALESCE\(m\.engagement->>'likes', ''\) ~/u);
  assert.match(plan.sql, /\(m\.engagement->>'likes'\)::numeric/u);
  assert.match(plan.sql, /ORDER BY \([\s\S]*\) DESC, m\.published_at DESC, m\.id DESC/u);
});

test("planner parameterizes escaped client search across governed mention text", () => {
  const predicate = buildSignalMentionPredicateV1({
    ...baseFilter,
    search_query: "precio_50%"
  }, [corpusId]);

  assert.match(predicate.sql, /concat_ws\(/u);
  assert.match(predicate.sql, /ILIKE \$\d+ ESCAPE/u);
  assert.ok(predicate.params.includes("%precio\\_50\\%%"));
  assert.doesNotMatch(predicate.sql, /precio_50%/u);
});

test("text search is parameterized and shared by aggregate, facets and drill-down predicates", () => {
  const filter = { ...baseFilter, text_search: "Entrega rápida" };
  const materialization = buildSignalMetricMaterializationPlanV1({
    metric_key: "conversation.volume",
    filter,
    study_corpus_ids: [corpusId]
  });
  const drillDown = buildSignalMentionDrillDownPlanV1({
    filter,
    study_corpus_ids: [corpusId]
  });

  assert.equal(materialization.predicate.fingerprint, drillDown.predicate.fingerprint);
  assert.equal(materialization.predicate.filters_hash, drillDown.predicate.filters_hash);
  assert.match(materialization.predicate.sql, /websearch_to_tsquery\('simple', \$\d+\)/u);
  assert.ok(materialization.predicate.params.includes("entrega rápida"));
  assert.doesNotMatch(materialization.predicate.sql, /Entrega rápida/u);
});

test("topic and narrative filters bind exact active workspace profiles", () => {
  const narrative = buildSignalMentionPredicateV1({
    ...baseFilter,
    dimensions: { narrative: ["care-is-prevention"] }
  }, [corpusId], workspaceId);
  assert.match(narrative.sql, /signal_taxonomy_profiles profile/u);
  assert.match(narrative.sql, /profile\.kind = 'narrative'/u);
  assert.match(narrative.sql, /profile\.workspace_id = \$\d+::uuid/u);
  assert.match(narrative.sql, /tag\.review_status = 'approved'/u);
  assert.match(narrative.sql, /tagged_mention\.id = m\.id/u);
  assert.doesNotMatch(narrative.sql, /canonical_mention_id/u);
  const governedNarrative = buildSignalPopulationMentionReadPredicateV1({
    ...baseFilter,
    dimensions: { narrative: ["care-is-prevention"] }
  }, populationId, workspaceId);
  assert.match(governedNarrative.sql, /tagged_mention\.canonical_mention_id/u);
  assert.doesNotMatch(narrative.sql, /LIKE '%narrative%'/u);
  assert.throws(
    () => buildSignalMentionPredicateV1({
      ...baseFilter,
      dimensions: { topic: ["nutrition"] }
    }, [corpusId]),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "invalid_filter"
  );
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
        study_corpus_ids: [corpusId],
        workspace_id: workspaceId
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
  const legacyPlan = buildSignalMetricMaterializationPlanV1({
    metric_key: "topic.volume",
    filter: { ...baseFilter, dimensions: {} },
    study_corpus_ids: [corpusId],
    workspace_id: workspaceId
  });
  const governedPlan = buildSignalMetricMaterializationPlanV1({
    metric_key: "topic.volume",
    filter: { ...baseFilter, dimensions: {} },
    population_id: populationId,
    workspace_id: workspaceId
  });
  const plan = governedPlan;
  assert.match(plan.sql, /tag\.review_status = 'approved'/u);
  assert.match(plan.sql, /signal_taxonomy_profiles profile/u);
  assert.match(plan.sql, /'included_mentions'/u);
  assert.match(plan.sql, /'classified_mentions'/u);
  assert.match(plan.sql, /'unclassified_mentions'/u);
  assert.match(plan.sql, /'tag_assertions'/u);
  assert.match(plan.sql, /'share_of_included'/u);
  assert.match(plan.sql, /'share_of_classified'/u);
  assert.match(plan.sql, /'cooccurrences'/u);
  assert.match(plan.sql, /classification_review_pending/u);
  assert.match(plan.sql, /tagged_mention\.canonical_mention_id = b\.id/u);
  assert.match(legacyPlan.sql, /tagged_mention\.id = b\.id/u);
  assert.doesNotMatch(legacyPlan.sql, /canonical_mention_id/u);
  assert.doesNotMatch(plan.sql, /LIKE '%topic%'/u);
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
      typed_payload: { pending_mentions: 1, processed_mentions: 2 }
    }
  });
  assert.equal(evaluation.state, "partial");
  assert.equal(evaluation.results.find((item) => item.key === "review_pending")?.state, "partial");
  assert.notEqual(evaluation.state, "pass");
});

test("planner rejects excessive ranges and dimension cardinality with typed errors", () => {
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
  assert.doesNotThrow(() => buildSignalMetricMaterializationPlanV1({
    metric_key: "platform.share",
    filter: { ...baseFilter, dimensions: { topic: ["service"] } },
    study_corpus_ids: [corpusId],
    workspace_id: workspaceId
  }));
});

test("historical read predicates accept ranges that materializations must split", () => {
  const historicalFilter = {
    date_range: { start: "2025-07-14", end: "2026-07-25" },
    timezone: "America/Mexico_City",
    granularity: "month",
    dimensions: {}
  };
  assert.throws(
    () => buildSignalMentionPredicateV1(historicalFilter, [corpusId]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_filter"
  );
  const predicate = buildSignalMentionReadPredicateV1(historicalFilter, [corpusId]);
  assert.equal(predicate.normalized_filter.date_range.start, "2025-07-14");
  assert.equal(predicate.normalized_filter.date_range.end, "2026-07-25");
  assert.equal(predicate.normalized_filter.granularity, "month");
  assert.match(predicate.sql, /published_at/u);
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

test("topic aggregate, denominator, buckets, cooccurrences and mention ids reconcile exactly", () => {
  const result = materializeSignalTaxonomyFixtureV1({
    kind: "topic",
    filter: { ...baseFilter, dimensions: {} },
    mentions: [
      {
        id: "m1",
        published_at: "2026-06-02T01:00:00Z",
        dimensions: { platform: ["x"] },
        processed_profiles: ["topic"],
        taxonomy_assignments: [
          { kind: "topic", term_key: "nutrition", review_status: "approved" },
          { kind: "topic", term_key: "digestion", review_status: "approved" }
        ]
      },
      {
        id: "m2",
        published_at: "2026-06-03T01:00:00Z",
        dimensions: { platform: ["x"] },
        processed_profiles: ["topic"],
        taxonomy_assignments: [
          { kind: "topic", term_key: "nutrition", review_status: "approved" },
          { kind: "topic", term_key: "price", review_status: "pending" }
        ]
      },
      {
        id: "m3",
        published_at: "2026-06-04T01:00:00Z",
        dimensions: { platform: ["x"] },
        processed_profiles: ["topic"],
        taxonomy_assignments: [
          { kind: "topic", term_key: "availability", review_status: "rejected" }
        ]
      }
    ]
  });
  assert.equal(result.included_mentions, 3);
  assert.equal(result.classified_mentions, result.classified_mention_ids.length);
  assert.deepEqual(result.classified_mention_ids, ["m1", "m2"]);
  assert.equal(result.tag_assertions, 3);
  assert.equal(result.buckets.find((bucket) => bucket.key === "nutrition")?.value, 2);
  assert.deepEqual(
    result.cooccurrences.find((pair) => pair.left_term_key === "digestion"),
    {
      left_term_key: "digestion",
      right_term_key: "nutrition",
      mention_count: 1,
      mention_ids: ["m1"]
    }
  );
  assert.equal(result.pending_mentions, 1);
  assert.equal(result.rejected_mentions, 1);
  assert.equal(result.quality_state, "partial");
});

test("explicitly processed small windows can report observed zero without an arbitrary minimum", () => {
  const result = materializeSignalTaxonomyFixtureV1({
    kind: "narrative",
    filter: { ...baseFilter, dimensions: {} },
    mentions: [{
      id: "m1",
      published_at: "2026-06-02T01:00:00Z",
      dimensions: { platform: ["x"] },
      processed_profiles: ["narrative"],
      taxonomy_assignments: []
    }]
  });
  assert.equal(result.included_mentions, 1);
  assert.equal(result.classified_mentions, 0);
  assert.equal(result.quality_state, "ready");
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
