import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSignalTaxonomyClassificationV1,
  normalizeSignalTaxonomyProposalV1,
  signalTaxonomyAssignmentDispositionV1,
  signalTaxonomyContextHashV1,
  signalTaxonomyCoverageV1,
  signalTaxonomyEnrichmentIdempotencyKeyV1,
  signalTaxonomyProfileKeyV1
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

test("acceptance keeps qualifying tags pending for human review and rejects weak assignments", () => {
  assert.equal(signalTaxonomyAssignmentDispositionV1({
    term_key: "pet_health",
    score: 0.9,
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
