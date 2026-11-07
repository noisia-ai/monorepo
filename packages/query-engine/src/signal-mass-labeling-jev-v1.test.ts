import assert from "node:assert/strict";
import test from "node:test";
import { buildMassLabelingJevRequestV1, mapMassLabelingJevResponseV1, massLabelingProbabilityDispositionV1,
  type MassLabelingInputV1 } from "./signal-mass-labeling-jev-v1";
import type { JevResponseV1 } from "./signal-mention-facets-jev-v1";

const context = { entities: [{ entity_id: "category", kind: "category" as const,
  name: "cerveja", aliases: [], disambiguation: null }] };
const input: MassLabelingInputV1 = { root_id: "root", input_digest: "input", map_id: "map", map_digest: "digest", chunk_index: 2,
  text: "Texto sintético sobre cerveja", title: null, platform: null, author: null, content_type: null, language: "pt", published_at: "2026-01-01",
  candidates: Array.from({ length: 8 }, (_, index) => ({ topic_key: `topic-${index}`, name: `Tema ${index}`,
    definition: `Definição do tema ${index}`, similarity: 0.8 - index * 0.01 })) };

test("one root sends one selected fragment with thirteen atomic parallel questions", () => {
  const request = buildMassLabelingJevRequestV1(input, context);
  assert.equal(request.state, input.text);
  assert.equal(Object.keys(request.questions).length, 13);
  assert.equal(request.questions.voice?.type, "choice");
  assert.equal(request.questions.trigger_barrier?.type, "choice");
  assert.ok(["relevance", "promotion", "spam", ...input.candidates.map((_, index) => `topic_${index}`)]
    .every(key => request.questions[key]?.type === "noul"));
  assert.equal(JSON.stringify(request).includes("root_id"), false);
  assert.equal(JSON.stringify(request).includes("input_digest"), false);
  assert.throws(() => buildMassLabelingJevRequestV1({ ...input, candidates: [...input.candidates, input.candidates[0]!] }, context), /input_invalid/u);
});

test("threshold endpoints abstain and complete distributions are retained", () => {
  for (const probability of [0.3, 0.5, 0.7]) assert.equal(massLabelingProbabilityDispositionV1(probability), "unclassified");
  assert.equal(massLabelingProbabilityDispositionV1(0.70001), "belongs");
  assert.equal(massLabelingProbabilityDispositionV1(0.29999), "excluded");
  const request = buildMassLabelingJevRequestV1(input, context);
  const response: JevResponseV1 = { model: request.model, usage: { input_tokens: 10, output_tokens: 0 }, answers: Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => [key, question.type === "noul" ? { type: "noul", noul: 0.5 }
      : { type: "choice", choice: Object.keys(question.criteria)[0], confidence: 0.8,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map((key, index, all) => [key, index === 0 ? 0.8 : 0.2 / (all.length - 1)])) }])) };
  const result = mapMassLabelingJevResponseV1(input, context, response);
  assert.deepEqual(result.probabilities, response.answers);
  assert.notEqual(result.probabilities, response.answers);
  assert.equal(result.status, "labeled");
  assert.throws(() => mapMassLabelingJevResponseV1(input, context, { ...response, answers: {} }), /response_invalid/u);
});
