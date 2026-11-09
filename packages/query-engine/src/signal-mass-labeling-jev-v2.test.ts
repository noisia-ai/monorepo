import assert from "node:assert/strict";
import test from "node:test";
import { buildMassLabelingJevRequestV2, massLabelingJevIdentityV2, massLabelingConfigurationV2, mapMassLabelingJevResponseV2 } from "./signal-mass-labeling-jev-v2";
import type { MassLabelingInputV1 } from "./signal-mass-labeling-jev-v1";
const context = { entities: [{ entity_id: "category", kind: "category" as const, name: "Tea", aliases: [], disambiguation: null }] };
const candidates = Array.from({ length: 8 }, (_, i) => ({ topic_key: `topic-${i}`, name: `Original ${i}`, definition: `Original definition ${i}`, similarity: 1 - i / 10,
  localization: { original_language: "pt", original: { name: `Original ${i}`, definition: `Original definition ${i}` }, en: { name: `English ${i}`, definition: `English definition ${i}` }, es: { name: `Spanish ${i}`, definition: `Spanish definition ${i}` } } }));
const item: MassLabelingInputV1 = { root_id: "root", input_digest: "digest", text: "I want a cup of tea", title: null, platform: null, content_type: null, author: null, language: "en", published_at: "", map_id: "map", map_digest: "map-digest", chunk_index: 0, candidates };
const configuration = { category: "tea", candidate_language: "en" as const, interests: [{ key: "travel", name: "Travel", definition: "Travel and tourism" }] };
test("default request unifies category, voice, promotion, four nearest topics and every active interest", () => {
  const request = buildMassLabelingJevRequestV2(item, context, configuration);
  assert.equal(request.state, item.text);
  assert.deepEqual(Object.keys(request.questions), ["promotion", "voice", "trigger_barrier", "topic_0", "topic_1", "topic_2", "topic_3", "interest_travel"]);
  assert.match(JSON.stringify(request.questions.trigger_barrier), /consume or buy tea/u);
  assert.match(JSON.stringify(request.questions.topic_0), /English 0/u);
  assert.doesNotMatch(JSON.stringify(request), /Original definition|relevance|spam/u);
  assert.equal(massLabelingJevIdentityV2(configuration).params.top_candidates, 4);
});
test("measured original policy uses original topic definitions and keeps all question instructions English", () => {
  const request = buildMassLabelingJevRequestV2(item, context, { ...configuration, candidate_language: "original" });
  assert.match(JSON.stringify(request.questions.topic_0), /Original definition 0/u);
  assert.match(JSON.stringify(request.questions.topic_0), /Does the text address this topic/u);
  assert.throws(() => buildMassLabelingJevRequestV2({ ...item, candidates: candidates.map(c => ({ ...c, localization: undefined })) }, context, configuration), /translation_required/u);
});
test("frozen identities bind category, active interests and language, and retain every probability", () => {
  assert.notEqual(massLabelingJevIdentityV2(configuration).prompt_digest, massLabelingJevIdentityV2({ ...configuration, category: "coffee" }).prompt_digest);
  assert.throws(() => massLabelingConfigurationV2({ ...configuration, interests: [configuration.interests[0], configuration.interests[0]] }), /configuration_invalid/u);
  const request = buildMassLabelingJevRequestV2(item, context, configuration);
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, q]) => [key, q.type === "noul" ? { type: "noul" as const, noul: .5 } : { type: "choice" as const, choice: Object.keys(q.criteria)[0]!, confidence: .5, probabilities: { a: .5, b: .5 } }]));
  const response = { model: request.model, answers, usage: { input_tokens: 10, output_tokens: 2 } };
  assert.deepEqual(mapMassLabelingJevResponseV2(item, context, configuration, response).probabilities, answers);
  assert.throws(() => mapMassLabelingJevResponseV2(item, context, configuration, { ...response, answers: {} }), /response_invalid/u);
});
