import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSignalTaxonomyClassificationV1,
  normalizeSignalTaxonomyProposalV1,
  signalTaxonomyAssignmentDispositionV1,
  signalTaxonomyContextHashV1,
  signalTaxonomyCoverageV1,
  signalTaxonomyEnrichmentIdempotencyKeyV1,
  signalTaxonomyProfileKeyV1,
  signalTopicsNarrativesOverviewContentHashV1,
  type SignalTopicsNarrativesOverviewV1
} from "./signal-topics-narratives-v1";

const contextRefs = [
  {
    source_type: "brand_os_brief" as const,
    source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: "1",
    content_hash: `sha256:${"1".repeat(64)}`
  },
  {
    source_type: "mention_sample" as const,
    source_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    version: "corpus:3",
    content_hash: `sha256:${"2".repeat(64)}`
  }
];

test("normalizes a topic proposal and hashes context independently of ref order", () => {
  const hash = signalTaxonomyContextHashV1(contextRefs);
  assert.equal(hash, signalTaxonomyContextHashV1([...contextRefs].reverse()));
  const proposal = normalizeSignalTaxonomyProposalV1({
    kind: "topic",
    provider: "operator",
    model_version: "operator-reviewed-v1",
    prompt_hash: `sha256:${"3".repeat(64)}`,
    context_refs: [...contextRefs].reverse(),
    context_hash: hash,
    terms: [{
      term_key: "promotion_clarity",
      label: "Promotion clarity",
      definition: "Conversation about whether a promotion is understandable.",
      examples: ["The discount terms are unclear."],
      exclusions: ["General price sensitivity."]
    }]
  });
  assert.equal(proposal.context_hash, hash);
  assert.equal(proposal.terms[0]?.statement, null);
});

test("requires narratives to be propositions and rejects T&B concepts", () => {
  assert.throws(() => normalizeSignalTaxonomyProposalV1({
    kind: "narrative",
    provider: "operator",
    model_version: "v1",
    prompt_hash: `sha256:${"3".repeat(64)}`,
    context_refs: contextRefs,
    terms: [{
      term_key: "trigger",
      label: "Trigger",
      definition: "Wrong semantic domain.",
      examples: ["Example"],
      exclusions: []
    }]
  }), /cannot be taxonomy terms/);

  assert.throws(() => normalizeSignalTaxonomyProposalV1({
    kind: "narrative",
    provider: "operator",
    model_version: "v1",
    prompt_hash: `sha256:${"3".repeat(64)}`,
    context_refs: contextRefs,
    terms: [{
      term_key: "digital_discount_friction",
      label: "Digital discount friction",
      definition: "A recurring claim.",
      examples: ["Online discounts are not honored."],
      exclusions: []
    }]
  }), /propositional statement/);
});

test("classification accepts only governed terms and requires evidence", () => {
  const valid = normalizeSignalTaxonomyClassificationV1({
    mention_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    assignments: [{
      term_key: "promotion_clarity",
      score: 0.91,
      confidence: "high",
      evidence: [{ quote: "the offer was impossible to understand", start: 4, end: 42 }]
    }],
    unclassified_reason: null
  }, ["promotion_clarity"]);
  assert.equal(valid.assignments.length, 1);
  assert.throws(() => normalizeSignalTaxonomyClassificationV1({
    mention_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    assignments: [{
      term_key: "unknown",
      score: 0.5,
      confidence: "medium",
      evidence: [{ quote: "text" }]
    }]
  }, ["promotion_clarity"]), /Unknown taxonomy term/);
});

test("coverage keeps small windows valid and exposes incomplete review", () => {
  assert.deepEqual(signalTaxonomyCoverageV1({
    included_mentions: 3,
    processed_mentions: 2,
    classified_mentions: 2,
    tag_assertions: 4,
    pending_mentions: 1
  }), {
    included_mentions: 3,
    classified_mentions: 2,
    unclassified_mentions: 1,
    tag_assertions: 4,
    pending_mentions: 1,
    rejected_mentions: 0,
    coverage: 2 / 3,
    quality_state: "partial",
    limitations: ["classification_review_pending", "classification_coverage_incomplete"]
  });
});

test("coverage treats reviewed unclassified mentions as processed without inventing a minimum", () => {
  const coverage = signalTaxonomyCoverageV1({
    included_mentions: 1,
    processed_mentions: 1,
    classified_mentions: 0,
    tag_assertions: 0
  });
  assert.equal(coverage.quality_state, "ready");
  assert.equal(coverage.coverage, 0);
  assert.deepEqual(coverage.limitations, []);
});

test("score and confidence only prioritize review and never autoapprove", () => {
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 0.9,
    confidence: "high",
    evidence: [{ quote: "salud digestiva", start: 0, end: 16 }]
  }), "pending");
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 0.99,
    confidence: "medium",
    evidence: [{ quote: "salud digestiva", start: 0, end: 16 }]
  }), "pending");
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 0.89,
    confidence: "high",
    evidence: [{ quote: "salud digestiva", start: 0, end: 16 }]
  }), "pending");
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 0.64,
    confidence: "high",
    evidence: [{ quote: "salud", start: 0, end: 5 }]
  }), "rejected");
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 0.99,
    confidence: "low",
    evidence: [{ quote: "salud", start: 0, end: 5 }]
  }), "rejected");
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 1,
    confidence: "high",
    evidence: []
  }), "abstained");
});

test("profile and enrichment identities are deterministic", () => {
  assert.equal(
    signalTaxonomyProfileKeyV1({
      workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "narrative",
      version: 2
    }),
    "signal_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa_narrative_v2"
  );
  const input = {
    workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    study_corpus_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    profile_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    corpus_revision: 7
  };
  assert.equal(
    signalTaxonomyEnrichmentIdempotencyKeyV1(input),
    signalTaxonomyEnrichmentIdempotencyKeyV1({ ...input })
  );
});

test("overview content identity changes with membership semantics but not rematerialization time", () => {
  const before = taxonomyOverviewFixture();
  const beforeHash = signalTopicsNarrativesOverviewContentHashV1(before);
  const readThrough = {
    ...before,
    topics: {
      ...before.topics,
      coverage: { ...before.topics.coverage, included_mentions: 106 },
      terms: []
    },
    narratives: {
      ...before.narratives,
      coverage: { ...before.narratives.coverage, included_mentions: 106 },
      terms: []
    }
  } satisfies SignalTopicsNarrativesOverviewV1;
  const readThroughHash = signalTopicsNarrativesOverviewContentHashV1(readThrough);
  assert.notEqual(readThroughHash, beforeHash);
  assert.equal(
    signalTopicsNarrativesOverviewContentHashV1({
      ...readThrough,
      topics: { ...readThrough.topics, computed_at: "2026-08-03T12:05:00.000Z" },
      narratives: { ...readThrough.narratives, computed_at: "2026-08-03T12:05:01.000Z" }
    }),
    readThroughHash
  );
});

function taxonomyOverviewFixture(): SignalTopicsNarrativesOverviewV1 {
  const coverage = {
    included_mentions: 107,
    processed_mentions: 1,
    classified_mentions: 1,
    unclassified_mentions: 106,
    tag_assertions: 1,
    pending_mentions: 0,
    rejected_mentions: 0,
    coverage: 1 / 107,
    quality_state: "partial" as const,
    limitations: ["classification_coverage_incomplete"]
  };
  const section = {
    state: "partial" as const,
    coverage,
    series: [{
      period_start: "2026-01-01",
      period_end: "2026-01-01",
      mention_count: 1,
      denominator: 107,
      share_of_included: 1 / 107,
      state: "partial" as const
    }],
    cooccurrences: [],
    data_watermark_hashes: [`sha256:${"a".repeat(64)}`],
    computed_at: "2026-08-03T12:00:00.000Z"
  };
  return {
    contract_version: "signal-topics-narratives-v1",
    workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    corpus_id: null,
    filters_hash: `sha256:${"b".repeat(64)}`,
    comparison_filters_hash: null,
    profiles: [],
    topics: {
      ...section,
      kind: "topic",
      metric_key: "topic.volume",
      terms: [{
        term_key: "module_topic",
        label: "Module topic",
        mention_count: 1,
        denominator: 107,
        share_of_included: 1 / 107,
        share_of_classified: 1,
        comparison_mention_count: null,
        delta: null,
        comparison_share_of_included: null,
        share_delta: null,
        state: "partial"
      }]
    },
    narratives: {
      ...section,
      kind: "narrative",
      metric_key: "narrative.volume",
      terms: [{
        term_key: "module_narrative",
        label: "Module narrative",
        mention_count: 1,
        denominator: 107,
        share_of_included: 1 / 107,
        share_of_classified: 1,
        comparison_mention_count: null,
        delta: null,
        comparison_share_of_included: null,
        share_delta: null,
        state: "partial"
      }]
    },
    state: "partial",
    limitations: ["classification_coverage_incomplete"],
    visibility: { internal: true, classification_details: true }
  };
}
