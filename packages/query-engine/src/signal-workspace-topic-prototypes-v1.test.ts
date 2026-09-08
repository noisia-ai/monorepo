import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalTopicDefinitionDigestV1, type SignalTopicDefinitionV1 } from "./signal-topic-catalog-v1";
import { compileSignalWorkspaceTopicInputsV1 } from "./signal-workspace-topic-inputs-v1";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";
import { buildSignalWorkspaceTopicPrototypePlanV1 } from "./signal-workspace-topic-prototypes-v1";
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
function definition(revision = 1): SignalTopicDefinitionV1 {
  const value: SignalTopicDefinitionV1 = { term_key: "service", label: "Servicio", definition: "Demoras en la entrega del vehículo.",
    scope: "primary_brand", inclusion: ["Demoras en la entrega del vehículo."], exclusion: [], positive_examples: [], negative_examples: [],
    origin: "manual", lifecycle: "draft", source: null, definition_revision: revision, definition_digest: hash("pending"),
    created_at: "2026-09-08T00:00:00.000Z", updated_at: "2026-09-08T00:00:00.000Z" };
  return { ...value, definition_digest: signalTopicDefinitionDigestV1(value) };
}
function args() {
  const texts: Record<string, string> = {};
  const topics = [1, 2].map(i => {
    const compiled = compileSignalWorkspaceTopicInputsV1({ topic: definition(i),
      context: { context_digest: hash(`scoped-context-${i}`), positive_text: "Contexto de la marca", negative_text: "Homónimo" } });
    return { taxonomy_term_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, compiled: { ...compiled,
      inputs: compiled.inputs.map(({ text, ...input }) => { texts[input.text_sha256] = text; return input; }) } };
  });
  return { taxonomy_profile_id: "10000000-0000-4000-8000-000000000000", embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
    context_digest: hash("global-context"), topics, texts };
}
test("pre-import plan retains aliases/revisions/scoped context while deduplicating physical text across Topics and roles", () => {
  const plan = buildSignalWorkspaceTopicPrototypePlanV1(args());
  assert.equal(plan.topics.length, 2);
  assert.equal(plan.inputs.length, 8);
  assert.equal(Object.keys(plan.texts).length, 3);
  assert.notEqual(plan.topics[0]!.context_digest, plan.context_digest);
  assert.notEqual(plan.topics[0]!.input_digests[0], plan.topics[1]!.input_digests[0]);
  const { plan_digest, ...sealed } = plan;
  assert.equal(plan_digest, signalWorkspaceEmbeddingDigestV1(sealed));
});
test("collection insertion order never changes payment-input identity", () => {
  const original = args();
  const reversed = { ...original, topics: [...original.topics].reverse().map(topic => ({ ...topic,
    compiled: { ...topic.compiled, inputs: [...topic.compiled.inputs].reverse() } })),
    texts: Object.fromEntries(Object.entries(original.texts).reverse()) };
  assert.deepEqual(buildSignalWorkspaceTopicPrototypePlanV1(reversed), buildSignalWorkspaceTopicPrototypePlanV1(original));
});
test("reject text substitution, unreferenced text, duplicate topics and conflicting aliases before creating any paid intent", () => {
  const wrongText = args(); wrongText.texts[Object.keys(wrongText.texts)[0]!] = "different text";
  assert.throws(() => buildSignalWorkspaceTopicPrototypePlanV1(wrongText), /workspace_topic_prototype_plan_invalid/u);
  const extraText = args(); extraText.texts[hash("secret unrelated")] = "secret unrelated";
  assert.throws(() => buildSignalWorkspaceTopicPrototypePlanV1(extraText), /workspace_topic_prototype_plan_invalid/u);
  const duplicate = args(); duplicate.topics.push(duplicate.topics[0]!);
  assert.throws(() => buildSignalWorkspaceTopicPrototypePlanV1(duplicate), /workspace_topic_prototype_plan_invalid/u);
  const conflict = args(); const first = conflict.topics[0]!.compiled.inputs[0]!;
  conflict.topics[1]!.compiled.inputs[3]!.input_digest = first.input_digest;
  assert.throws(() => buildSignalWorkspaceTopicPrototypePlanV1(conflict), /workspace_topic_prototype_plan_invalid/u);
});
test("empty catalog and incompatible complete profile cannot masquerade as ready prototypes", () => {
  assert.throws(() => buildSignalWorkspaceTopicPrototypePlanV1({ ...args(), topics: [], texts: {} }), /workspace_topic_catalog_empty/u);
  const invalid = args(); invalid.topics[0]!.compiled.embedding_config_digest = hash("legacy-query-profile");
  assert.throws(() => buildSignalWorkspaceTopicPrototypePlanV1(invalid), /workspace_topic_prototype_plan_invalid/u);
});
