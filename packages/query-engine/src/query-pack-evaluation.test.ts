import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompactBooleanQuery,
  buildQueryPackEvaluatorPrompt,
  buildQueryValidationCandidates,
  computeQueryPackMetrics,
  isBalancedBooleanQuery,
  isQueryPackReady,
  QUERY_PACK_MIN_DIAGNOSTIC_SAMPLE_SIZE,
  QUERY_PACK_IMPORTED_SAMPLE_SIZE,
  QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE,
  QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
  normalizeBooleanListeningQuery,
  type QueryPackClassification,
  type QueryPackMention
} from "./query-pack-evaluation";

test("keeps a smaller diagnostic floor than the approval evidence floor", () => {
  assert.equal(QUERY_PACK_MIN_DIAGNOSTIC_SAMPLE_SIZE, 10);
  assert.equal(QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE, 25);
});

test("uses imported evidence for the Studio query-pack contract", () => {
  assert.equal(QUERY_PACK_IMPORTED_SAMPLE_SIZE, 100);
  assert.equal(QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE, 25);
  assert.match(QUERY_PACK_EVALUATOR_PIPELINE_VERSION, /imported-evidence/);
});

const sample: QueryPackMention[] = Array.from({ length: 10 }, (_, index) => ({
  id: `m-${index}`,
  text_snippet: `Mention ${index}`,
  platform: "x",
  language: index === 9 ? "en" : "es",
  country: index === 8 ? "US" : "MX",
  sentiment_source: null
}));

test("keeps evidence classification separate from governed query refinement", () => {
  const prompt = buildQueryPackEvaluatorPrompt({
    pack: {
      scope: "brand",
      signalIntent: "decision signal",
      objective: "Understand purchase barriers",
      queryText: '("Laika Mascotas") AND NOT ("Laika Studios")'
    },
    study: {
      methodologySlug: "triggers-barriers",
      businessQuestion: "What prevents repurchase?",
      audienceSegment: "Pet owners in Mexico",
      geoFocus: ["Mexico (MX)"]
    },
    subject: { name: "Laika Mascotas" },
    sample: sample.slice(0, 2)
  });

  assert.match(prompt, /No calcules scores/i);
  assert.match(prompt, /cada mention_id recibido, exactamente una vez/i);
  assert.match(prompt, /No reescribas la query/i);
  assert.doesNotMatch(prompt, /refined_query_text/i);
  assert.doesNotMatch(prompt, /menor o igual a 250/i);
});

test("computes deterministic pack metrics from classifications", () => {
  const classifications: QueryPackClassification[] = sample.map((mention, index) => ({
    mention_id: mention.id,
    relevance: index < 7 ? "relevant" : index < 9 ? "partial" : "noise",
    signal_types: [],
    reason: "test"
  }));

  const metrics = computeQueryPackMetrics({
    sample,
    classifications,
    targetLanguages: ["es"],
    targetCountries: ["Mexico (MX)"]
  });

  assert.equal(metrics.quality_score, 7.7);
  assert.equal(metrics.density_score, 9);
  assert.equal(metrics.noise_score, 1);
  assert.equal(metrics.language_target_pct, 90);
  assert.equal(metrics.geo_target_pct, 90);
  assert.equal(isQueryPackReady(metrics), true);
});

test("rejects incomplete evaluator classifications", () => {
  assert.throws(
    () => computeQueryPackMetrics({
      sample,
      classifications: [],
      targetLanguages: ["es"],
      targetCountries: ["MX"]
    }),
    /omitted 10 mention/
  );
});

test("builds a compact balanced query without slicing boolean syntax", () => {
  const query = buildCompactBooleanQuery({
    scopeSeeds: ["Laika Mascotas", "Laika Member", "laikamascotas"],
    phraseHints: ["vale la pena", "no vale la pena", "me convenció", "me frena"],
    maxLength: 120
  });

  assert.ok(query.length <= 120);
  assert.equal(isBalancedBooleanQuery(query), true);
  assert.match(query, /Laika Mascotas/);
});

test("preserves the boolean semantics of a valid refined query", () => {
  const refined = '("Laika Mascotas" OR "Laika Member") AND ("recompra" OR "entrega") AND NOT ("Laika Studios" OR "astronauta")';

  const query = buildCompactBooleanQuery({ queryText: refined });

  assert.equal(query, refined);
  assert.equal(isBalancedBooleanQuery(query), true);
  assert.match(query, /\) AND \(/);
  assert.match(query, /\) AND NOT \(/);
});

test("normalizes the portable exclusion form", () => {
  const legacy = '("Laika Mascotas") AND ("recompra") NOT ("Laika Studios")';

  const query = normalizeBooleanListeningQuery(legacy);

  assert.equal(query, '("Laika Mascotas") AND ("recompra") AND NOT ("Laika Studios")');
  assert.equal(isBalancedBooleanQuery(query), true);
});

test("builds portable fallback candidates for an overlong query", () => {
  const queryText = `(${Array.from({ length: 30 }, (_, index) => `"category ${index}"`).join(" OR ")}) AND (${Array.from({ length: 20 }, (_, index) => `"signal ${index}"`).join(" OR ")})`;
  const candidates = buildQueryValidationCandidates({
    queryText,
    scopeSeeds: ["Laika Mascotas", "Laika Member", "Universo Peludo"],
    phraseHints: ["recompra", "entrega", "membresía", "no volvió"]
  });

  assert.ok(candidates.length >= 2);
  assert.ok(candidates.every((candidate) => candidate.length <= 250));
  assert.ok(candidates.every(isBalancedBooleanQuery));
  assert.match(candidates[0] ?? "", /Laika Mascotas/);
  assert.notEqual(candidates[0], candidates[1]);
});
