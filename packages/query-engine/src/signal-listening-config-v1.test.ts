import test from "node:test";
import assert from "node:assert/strict";
import { compileSignalListeningConfigurationV1, selectSignalListeningPendingV1, signalListeningBaseConfigurationV1,
  signalListeningConfigurationDigestV1, signalListeningConsumerVoiceV1, validateSignalListeningConfigurationV1,
  type SignalListeningConfigurationV1 } from "./signal-listening-config-v1";
import { describeSignalListeningRequestV1 } from "./signal-listening-questions-v1";
import { buildMassLabelingJevRequestV2 } from "./signal-mass-labeling-jev-v2";

const base = () => signalListeningBaseConfigurationV1({ category: "sparkling water", lexicon_terms: ["seltzer", "bubbles"], candidate_language: "en",
  defined_topics: [{ key: "price", name: "Price", definition: "Mentions what it costs.", active: true },
    { key: "retired", name: "Old", definition: "No longer asked.", active: false }] });
const withQuestion = (scope: "all" | "consumer_category" = "consumer_category"): SignalListeningConfigurationV1 => ({ ...base(), questions: [{
  key: "comment_type", text: "What kind of comment is this?", scope, active: true, origin: "brand_os", human_locked: false,
  options: [{ key: "praise", definition: "Praises." }, { key: "complaint", definition: "Complains." }, { key: "other", definition: "Anything else." }] }] });

test("the base is voice and promotion only, and trigger_barrier is not part of it", () => {
  const compiled = compileSignalListeningConfigurationV1(base());
  assert.deepEqual(Object.keys(compiled.base).sort(), ["promotion", "voice"]);
  assert.deepEqual(compiled.defined.map(question => question.label), ["interest:price"]);
  assert.equal(compiled.choices.length, 0);
  assert.throws(() => validateSignalListeningConfigurationV1({ ...base(), questions: [{ ...withQuestion().questions[0]!, key: "trigger_barrier" }] }), /listening_configuration_invalid/);
  assert.throws(() => validateSignalListeningConfigurationV1({ ...base(), base: ["voice"] }), /listening_configuration_invalid/);
});

test("base, defined and discovered topics keep the identity of the R15 request", () => {
  const compiled = compileSignalListeningConfigurationV1(base());
  const legacy = describeSignalListeningRequestV1(buildMassLabelingJevRequestV2({ root_id: "r", input_digest: `sha256:${"a".repeat(64)}`, text: "text",
    title: null, platform: null, content_type: null, author: null, published_at: null, language: null, map_id: "m", map_digest: "d", chunk_index: 0,
    candidates: [{ topic_key: "taste", name: "Taste", definition: "How it tastes.", similarity: 0.9, definition_digest: "x",
      localization: { original_language: "en", original: { name: "Taste", definition: "How it tastes." }, en: { name: "Taste", definition: "How it tastes." }, es: { name: "Sabor", definition: "A qué sabe." } } }] } as never,
    { version_no: 0, entities: [] } as never, { category: "sparkling water", candidate_language: "en",
      interests: [{ key: "price", name: "Price", definition: "Mentions what it costs." }] }));
  const identity = (key: string) => legacy.find(question => question.request_key === key)!.question_digest;
  assert.equal(compiled.base.voice.question_digest, identity("voice"));
  assert.equal(compiled.base.promotion.question_digest, identity("promotion"));
  assert.equal(compiled.defined[0]!.question_digest, identity("interest_price"));
  assert.equal(compiled.topic("taste", { name: "Taste", definition: "How it tastes." }).question_digest, identity("topic_0"));
});

test("a root is asked only what its cache does not hold", () => {
  const compiled = compileSignalListeningConfigurationV1(withQuestion("all"));
  const topics = [compiled.topic("taste", { name: "Taste", definition: "How it tastes." })];
  const unknown = { voice_choice: null, promotion: null, hashtag_only: false };
  const fresh = selectSignalListeningPendingV1({ compiled, topics, answered: new Set(), base: unknown, category_match: false });
  assert.deepEqual(fresh.map(question => question.label).sort(), ["interest:price", "promotion", "question:comment_type", "topic:taste", "voice"]);
  const cached = new Set(fresh.filter(question => question.label !== "question:comment_type").map(question => question.question_digest));
  const onlyNew = selectSignalListeningPendingV1({ compiled, topics, answered: cached, base: unknown, category_match: false });
  assert.deepEqual(onlyNew.map(question => question.label), ["question:comment_type"]);
  assert.deepEqual(selectSignalListeningPendingV1({ compiled, topics, answered: new Set([...cached, onlyNew[0]!.question_digest]), base: unknown, category_match: false }), []);
});

test("a consumer question waits for the base and is asked only inside the cut", () => {
  const compiled = compileSignalListeningConfigurationV1(withQuestion("consumer_category"));
  const answered = new Set([compiled.base.voice, compiled.base.promotion, ...compiled.defined].map(question => question.question_digest));
  const ask = (base: Parameters<typeof signalListeningConsumerVoiceV1>[0], category_match: boolean) =>
    selectSignalListeningPendingV1({ compiled, topics: [], answered, base, category_match }).map(question => question.label);
  assert.deepEqual(ask({ voice_choice: null, promotion: null, hashtag_only: false }, true), []);
  assert.deepEqual(ask({ voice_choice: "individual", promotion: 0.2, hashtag_only: false }, true), ["question:comment_type"]);
  assert.deepEqual(ask({ voice_choice: "individual", promotion: 0.2, hashtag_only: false }, false), []);
  assert.deepEqual(ask({ voice_choice: "media", promotion: 0.2, hashtag_only: false }, true), []);
  assert.deepEqual(ask({ voice_choice: "individual", promotion: 0.9, hashtag_only: false }, true), []);
  assert.deepEqual(ask({ voice_choice: "individual", promotion: 0.2, hashtag_only: true }, true), []);
});

test("changing a definition changes that question's identity and nothing else", () => {
  const before = compileSignalListeningConfigurationV1(withQuestion());
  const edited = withQuestion(); edited.questions[0]!.options[0]!.definition = "Says something good.";
  const after = compileSignalListeningConfigurationV1(edited);
  assert.notEqual(after.choices[0]!.question_digest, before.choices[0]!.question_digest);
  assert.equal(after.base.voice.question_digest, before.base.voice.question_digest);
  assert.equal(after.defined[0]!.question_digest, before.defined[0]!.question_digest);
  assert.notEqual(signalListeningConfigurationDigestV1(edited), signalListeningConfigurationDigestV1(withQuestion()));
  const reordered = withQuestion(); reordered.questions[0]!.options.reverse(); reordered.lexicon_terms.reverse();
  assert.equal(signalListeningConfigurationDigestV1(reordered), signalListeningConfigurationDigestV1(withQuestion()));
});
