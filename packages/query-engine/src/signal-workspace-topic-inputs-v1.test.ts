import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalTopicDefinitionDigestV1, type SignalTopicDefinitionV1 } from "./signal-topic-catalog-v1";
import { prepareWorkspaceCorpusTextChunksV1 } from "./signal-workspace-corpus-preparation-chunks";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "./signal-workspace-embeddings-v1";
import {
  compileSignalWorkspaceTopicInputsV1, type SignalWorkspaceTopicInputContextV1
} from "./signal-workspace-topic-inputs-v1";

const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
function topic(changes: Partial<SignalTopicDefinitionV1> = {}): SignalTopicDefinitionV1 {
  const value: SignalTopicDefinitionV1 = {
    term_key: "service_delays", label: "Demoras del servicio", definition: "Demoras después de contratar el servicio.",
    scope: "primary_brand", inclusion: [], exclusion: [], positive_examples: [], negative_examples: [],
    origin: "manual", lifecycle: "draft", source: null, definition_revision: 1,
    definition_digest: hash("pending"), created_at: "2026-09-08T12:00:00.000Z", updated_at: "2026-09-08T12:00:00.000Z",
    ...changes
  };
  return { ...value, definition_digest: signalTopicDefinitionDigestV1(value) };
}
function context(changes: Partial<SignalWorkspaceTopicInputContextV1> = {}): SignalWorkspaceTopicInputContextV1 {
  return { context_digest: hash("context"), positive_text: "", negative_text: "", ...changes };
}

test("an interest before import compiles its definition without provider, corpus or mandatory examples", () => {
  const definition = topic();
  const result = compileSignalWorkspaceTopicInputsV1({ topic: definition, context: context() });
  assert.equal(result.contract_version, "signal-workspace-topic-inputs-v1");
  assert.equal(result.definition_digest, definition.definition_digest);
  assert.equal(result.embedding_config_digest, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest);
  assert.equal(result.inputs.length, 1);
  assert.equal(result.inputs[0]!.role, "topic_positive");
  assert.equal(result.inputs[0]!.text, definition.definition);
  assert.equal(result.inputs[0]!.source_key, "topic.definition");
});

test("positive and negative Topic sources remain separate from scope guidance and preserve each item", () => {
  const definition = topic({ inclusion: ["Entrega tardía", "Falta de respuesta"], exclusion: ["Avisos de promociones"],
    positive_examples: ["Mi entrega sigue pendiente"], negative_examples: ["Servicio disponible desde mañana"] });
  const result = compileSignalWorkspaceTopicInputsV1({ topic: definition,
    context: context({ positive_text: "Identidad y mercado de la marca", negative_text: "Homónimo ajeno al sector" }) });
  assert.deepEqual(result.inputs.map(({ role, source_key, text }) => ({ role, source_key, text })), [
    { role: "topic_positive", source_key: "topic.definition", text: definition.definition },
    { role: "topic_positive", source_key: "topic.inclusion.0", text: "Entrega tardía" },
    { role: "topic_positive", source_key: "topic.inclusion.1", text: "Falta de respuesta" },
    { role: "topic_positive", source_key: "topic.positive_examples.0", text: "Mi entrega sigue pendiente" },
    { role: "topic_negative", source_key: "topic.exclusion.0", text: "Avisos de promociones" },
    { role: "topic_negative", source_key: "topic.negative_examples.0", text: "Servicio disponible desde mañana" },
    { role: "scope_positive", source_key: "context.positive_text", text: "Identidad y mercado de la marca" },
    { role: "scope_negative", source_key: "context.negative_text", text: "Homónimo ajeno al sector" }
  ]);
});

test("scope text beyond 80 chunks is intact with UTF16 offsets, whitespace and decomposed Unicode", () => {
  const positive = "  contexto\tcon\r\nespacios e\u0301 🌎 \n".repeat(5_000);
  const negative = "x".repeat(1_399) + "🌎" + "y".repeat(6_000) + "🚙\n  ";
  const result = compileSignalWorkspaceTopicInputsV1({ topic: topic(),
    context: context({ positive_text: positive, negative_text: negative }) });
  assert.ok(result.inputs.filter((input) => input.role === "scope_positive").length > 80);
  for (const [role, text] of [["scope_positive", positive], ["scope_negative", negative]] as const) {
    const inputs = result.inputs.filter((input) => input.role === role);
    const existingPolicy = prepareWorkspaceCorpusTextChunksV1(text, hash(text));
    assert.deepEqual(inputs.map(({ start, end, text_sha256 }) => ({ start, end, sha256: text_sha256 })), existingPolicy.chunks);
    assert.equal(inputs.map((input) => input.text).join(""), text);
    for (const [index, input] of inputs.entries()) {
      assert.equal(input.chunk_index, index);
      assert.equal(input.text, text.slice(input.start, input.end));
      assert.equal(input.text_sha256, hash(input.text));
      assert.ok(input.text.length <= 1_400);
      assert.equal(Buffer.from(input.text).toString("utf8"), input.text);
    }
  }
});

test("definition and individual editor items retain original bytes despite schema trim transforms", () => {
  const definition = topic({ definition: `  ${"d".repeat(1_500)}\n`,
    inclusion: ["  e\u0301 y é\t"], positive_examples: ["\nTardó demasiado.  "] });
  const result = compileSignalWorkspaceTopicInputsV1({ topic: definition, context: context() });
  const source = (key: string) => result.inputs.filter((input) => input.source_key === key).map((input) => input.text).join("");
  assert.equal(source("topic.definition"), definition.definition);
  assert.equal(source("topic.inclusion.0"), definition.inclusion[0]);
  assert.equal(source("topic.positive_examples.0"), definition.positive_examples[0]);
});

test("label and timestamps are editorial and do not invalidate compiled semantics", () => {
  const value = topic();
  const original = compileSignalWorkspaceTopicInputsV1({ topic: value, context: context() });
  const renamed = compileSignalWorkspaceTopicInputsV1({ topic: { ...value,
    label: "Nuevo título editorial", created_at: "2026-09-07T00:00:00.000Z", updated_at: "2026-09-09T00:00:00.000Z" }, context: context() });
  assert.deepEqual(renamed, original);
});

test("semantic changes, revisions and scope invalidate provenance while exact text remains cacheable", () => {
  const current = topic({ inclusion: ["Entrega"] });
  const original = compileSignalWorkspaceTopicInputsV1({ topic: current, context: context() });
  for (const changed of [topic({ ...current, scope: "category" }), topic({ ...current, definition_revision: 2 }),
    topic({ ...current, negative_examples: ["Promoción de entrega"] })]) {
    const result = compileSignalWorkspaceTopicInputsV1({ topic: changed, context: context() });
    assert.notEqual(result.compiler_digest, original.compiler_digest);
    assert.notEqual(result.inputs[0]!.input_digest, original.inputs[0]!.input_digest);
    assert.equal(result.inputs[0]!.text_sha256, original.inputs[0]!.text_sha256);
  }
});

test("identical text can reuse vectors but never merges positive, negative or source evidence", () => {
  const text = "El servicio tarda";
  const result = compileSignalWorkspaceTopicInputsV1({ topic: topic({ definition: text, inclusion: [text], negative_examples: [text] }),
    context: context({ positive_text: text, negative_text: text }) });
  assert.equal(result.inputs.length, 5);
  assert.equal(new Set(result.inputs.map((input) => input.text_sha256)).size, 1);
  assert.equal(new Set(result.inputs.map((input) => input.input_digest)).size, 5);
});

test("context refs are deterministic independent of SQL order and changes invalidate provenance", () => {
  const refs = [
    { source_type: "brand_os_objective", source_id: "objective-one", version: "1", content_hash: hash("one") },
    { source_type: "semantic_context_element", source_id: "element-two", version: "2", content_hash: hash("two") }
  ];
  const compile = (ctx: SignalWorkspaceTopicInputContextV1) => compileSignalWorkspaceTopicInputsV1({ topic: topic(), context: ctx });
  const base = compile(context({ context_refs: refs }));
  assert.deepEqual(compile(context({ context_refs: [...refs].reverse() })), base);
  for (const changed of [context({ context_digest: hash("changed"), context_refs: refs }),
    context({ context_refs: [{ ...refs[0]!, version: "2" }, refs[1]!] }),
    context({ context_refs: [{ ...refs[0]!, content_hash: hash("updated") }, refs[1]!] })]) {
    assert.notEqual(compile(changed).compiler_digest, base.compiler_digest);
    assert.notEqual(compile(changed).inputs[0]!.input_digest, base.inputs[0]!.input_digest);
  }
});

test("exact changed context bytes invalidate compilation even if a caller reuses the context digest", () => {
  const make = (positive_text: string) => compileSignalWorkspaceTopicInputsV1({ topic: topic(), context: context({ positive_text }) });
  const before = make("First context"), after = make("Changed context");
  assert.equal(before.context_digest, after.context_digest);
  assert.notEqual(before.compiler_digest, after.compiler_digest);
  assert.notEqual(before.inputs[1]!.input_digest, after.inputs[1]!.input_digest);
});

test("legacy query prototypes and other profile variations cannot enter the document cache", () => {
  for (const changes of [{ input_type: "query" }, { model: "voyage-3-large" }, { dimensions: 512 },
    { truncation: true }, { chunk_policy_version: "other" }, { config_digest: hash("other") }]) {
    assert.throws(() => compileSignalWorkspaceTopicInputsV1({ topic: topic(), context: context(),
      profile: { ...SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, ...changes } as typeof SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 }),
    { code: "workspace_embedding_profile_unsupported" });
  }
});

test("invalid semantic identity or unsafe text fails before yielding provider inputs", () => {
  assert.throws(() => compileSignalWorkspaceTopicInputsV1({ topic: { ...topic(), definition: "" }, context: context() }),
    { code: "workspace_topic_definition_invalid" });
  assert.throws(() => compileSignalWorkspaceTopicInputsV1({ topic: { ...topic(), definition: "Changed but not resealed" }, context: context() }),
    { code: "workspace_topic_definition_digest_mismatch" });
  assert.throws(() => compileSignalWorkspaceTopicInputsV1({ topic: topic(), context: context({ context_digest: "not-a-digest" }) }),
    { code: "workspace_topic_context_invalid" });
  assert.throws(() => compileSignalWorkspaceTopicInputsV1({ topic: topic(), context: context({ positive_text: "\u0000" }) }),
    { code: "workspace_topic_text_invalid" });
  for (const positive_text of ["\ud800", "\udc00", "x".repeat(1_399) + "\ud800 "]) {
    assert.throws(() => compileSignalWorkspaceTopicInputsV1({ topic: topic(), context: context({ positive_text }) }),
      { code: "workspace_embedding_invalid_unicode" });
  }
});

test("compilation does not mutate frozen input or attach inferred labels, gates or scores", () => {
  const value = topic();
  Object.freeze(value.inclusion); Object.freeze(value.exclusion);
  Object.freeze(value.positive_examples); Object.freeze(value.negative_examples); Object.freeze(value);
  const ctx = Object.freeze(context());
  const result = compileSignalWorkspaceTopicInputsV1({ topic: value, context: ctx });
  assert.deepEqual(result, compileSignalWorkspaceTopicInputsV1({ topic: value, context: ctx }));
  assert.deepEqual(Object.keys(result).sort(), ["contract_version", "definition_digest", "definition_revision",
    "context_digest", "embedding_config_digest", "compiler_digest", "inputs"].sort());
  assert.ok(result.inputs.every((input) => !Object.hasOwn(input, "score") && !Object.hasOwn(input, "approved")));
});
