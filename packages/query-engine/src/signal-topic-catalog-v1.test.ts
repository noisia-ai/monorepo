import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalTopicEmbeddingTextV1,
  buildSignalTopicNegativeEmbeddingTextV1,
  calibrateSignalTopicThresholdV1,
  decideSignalTopicCandidateV1,
  estimateSignalTopicEmbeddingCostMicroUsdV1,
  signalTopicContrastScoreV1,
  signalTopicDefinitionDigestV1,
  signalTopicEmbeddingCacheDigestV1,
  signalTopicItemStateV1,
  signalTopicLexicalMatchV1,
  signalTopicTermKeyV1
} from "./signal-topic-catalog-v1";

test("topic keys are stable serving keys rather than candidate labels", () => {
  assert.equal(signalTopicTermKeyV1("Audio en Español / México"), "audio_en_espanol_mexico");
  assert.equal(signalTopicTermKeyV1("2027 roadmap"), "topic_2027_roadmap");
  assert.equal(signalTopicTermKeyV1(`${"a".repeat(79)} b`), "a".repeat(79));
});

test("positive and negative semantic queries stay separate", () => {
  const topic = {
    term_key: "delivery", label: "Delivery", definition: "Delivery delays and logistics",
    scope: "primary_brand" as const, inclusion: ["late package"], exclusion: ["music delivery"],
    positive_examples: ["my order arrived late"], negative_examples: ["album delivery"],
    lifecycle: "draft" as const, origin: "manual" as const, source: null,
    definition_revision: 1, definition_digest: `sha256:${"a".repeat(64)}`,
    created_at: "2026-09-07T00:00:00.000Z", updated_at: "2026-09-07T00:00:00.000Z"
  };
  const positive = buildSignalTopicEmbeddingTextV1(topic, "Brand operates in Mexico");
  const negative = buildSignalTopicNegativeEmbeddingTextV1(topic);
  assert.match(positive, /Brand operates in Mexico/u);
  assert.doesNotMatch(positive, /music delivery|album delivery/u);
  assert.match(negative, /music delivery/u);
  const contrast = signalTopicContrastScoreV1(0.7, 0.8);
  assert.equal(contrast.excluded_by_negative, true);
  assert.ok(Math.abs(contrast.score - 0.5) < Number.EPSILON);
});

test("embedding cache and conservative cost are sealed before provider dispatch", () => {
  const definition = `sha256:${"a".repeat(64)}`;
  assert.notEqual(
    signalTopicEmbeddingCacheDigestV1({ definition_digest: definition,
      context_digest: `sha256:${"b".repeat(64)}`, role: "negative" }),
    signalTopicEmbeddingCacheDigestV1({ definition_digest: definition,
      context_digest: `sha256:${"c".repeat(64)}`, role: "negative" })
  );
  const estimate = estimateSignalTopicEmbeddingCostMicroUsdV1({
    provider: "voyage", model: "voyage-4-large", texts: ["a".repeat(1_000)]
  });
  assert.equal(estimate.estimated_micro_usd, 120);
  assert.equal(estimate.input_bytes, 1_000);
  assert.throws(() => estimateSignalTopicEmbeddingCostMicroUsdV1({
    provider: "voyage", model: "unknown", texts: ["hello"]
  }), /topic_embedding_pricing_unsupported/u);
});

test("definition digest changes with meaning but not display label", () => {
  const base = {
    term_key: "privacy",
    label: "Privacidad",
    definition: "Conversaciones sobre privacidad de voz",
    scope: "primary_brand" as const,
    inclusion: ["datos de voz"], exclusion: [], positive_examples: [], negative_examples: [],
    lifecycle: "draft" as const, origin: "manual" as const, source: null
  };
  assert.equal(signalTopicDefinitionDigestV1(base), signalTopicDefinitionDigestV1({ ...base, label: "Privacy" }));
  assert.notEqual(signalTopicDefinitionDigestV1(base), signalTopicDefinitionDigestV1({ ...base, definition: "Precio" }));
});

test("lexical rules normalize accents and keep exclusions separate", () => {
  assert.deepEqual(signalTopicLexicalMatchV1("La grabación de VOZ es privada", ["grabacion de voz"], ["música"]), {
    matched: true,
    excluded: false
  });
  assert.deepEqual(signalTopicLexicalMatchV1("Música con grabación de voz", ["grabacion de voz"], ["musica"]), {
    matched: true,
    excluded: true
  });
});

test("semantic results stay pending until a separate validation split supports approval", () => {
  const unavailable = calibrateSignalTopicThresholdV1([
    { mention_id: "a", score: 0.92, disposition: "belongs" },
    { mention_id: "b", score: 0.18, disposition: "excluded" }
  ]);
  assert.equal(unavailable.available, false);
  assert.equal(decideSignalTopicCandidateV1({ score: 0.91, lexical_match: false,
    excluded_by_rule: false, calibration: unavailable }).disposition, "pending");
});

test("one unseen positive and negative cannot authorize broad automatic publication", () => {
  const unavailable = calibrateSignalTopicThresholdV1([
    { mention_id: "id-1", score: 0.90, disposition: "belongs" },
    { mention_id: "id-3", score: 0.85, disposition: "belongs" },
    { mention_id: "id-4", score: 0.80, disposition: "belongs" },
    { mention_id: "id-5", score: 0.40, disposition: "excluded" },
    { mention_id: "id-6", score: 0.30, disposition: "excluded" },
    { mention_id: "id-7", score: 0.20, disposition: "excluded" },
    { mention_id: "id-0", score: 0.88, disposition: "belongs" },
    { mention_id: "id-9", score: 0.42, disposition: "excluded" }
  ]);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reason, "insufficient_validation");
  assert.deepEqual(unavailable.validation, {
    positives: 1, negatives: 1, precision: null, recall: null,
    false_positives: 0, false_negatives: 0
  });
});

test("two unseen positives and negatives can validate a precise threshold", () => {
  const ready = calibrateSignalTopicThresholdV1([
    { mention_id: "id-1", score: 0.90, disposition: "belongs" },
    { mention_id: "id-3", score: 0.85, disposition: "belongs" },
    { mention_id: "id-4", score: 0.80, disposition: "belongs" },
    { mention_id: "id-5", score: 0.40, disposition: "excluded" },
    { mention_id: "id-6", score: 0.30, disposition: "excluded" },
    { mention_id: "id-7", score: 0.20, disposition: "excluded" },
    { mention_id: "id-0", score: 0.88, disposition: "belongs" },
    { mention_id: "id-2", score: 0.82, disposition: "belongs" },
    { mention_id: "id-9", score: 0.42, disposition: "excluded" },
    { mention_id: "id-10", score: 0.31, disposition: "excluded" }
  ]);
  assert.equal(ready.available, true);
  assert.equal(ready.reason, "ready");
  assert.equal(ready.threshold, 0.8);
  assert.equal(ready.validation.precision, 1);
  assert.equal(ready.validation.recall, 1);
});

test("human corrections override model scores and multilabel item state remains aggregate", () => {
  const approved = decideSignalTopicCandidateV1({ score: 0.1, lexical_match: false,
    excluded_by_rule: false, correction: "belongs" });
  const pending = decideSignalTopicCandidateV1({ score: 0.7, lexical_match: false,
    excluded_by_rule: false });
  assert.deepEqual(approved, { disposition: "approved", method: "human", score: 0.1 });
  assert.equal(signalTopicItemStateV1([approved, pending]), "pending");
  assert.equal(decideSignalTopicCandidateV1({ score: 0.99, lexical_match: true,
    excluded_by_rule: false, correction: "excluded" }).disposition, "none");
});
