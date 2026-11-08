import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMassLabelingConsolidationRequestV1,
  parseMassLabelingConsolidationResponseV1,
  validateMassLabelingConsolidationOutputV1,
  massLabelingConsolidationUsageV1,
  type MassLabelingSourceGroupV1,
} from "./signal-mass-labeling-consolidation-v1";

const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const groups: MassLabelingSourceGroupV1[] = Array.from(
  { length: 200 },
  (_, index) => ({
    group_id: `guided:group-${index}`,
    cluster_digest: `sha256:${"a".repeat(64)}`,
    name: `Conversa ${index}`,
    definition: `Descrição editorial sintética ${index}`,
    status: "coherent",
    source_artifact_id: id(index),
  }),
);
const input = {
  workspace_id: id(900),
  source_engine_execution_id: id(901),
  source_groups: groups,
};

test("global consolidation accepts two hundred summaries, excludes mention inputs and seals ordering", () => {
  const batch = buildMassLabelingConsolidationRequestV1(input);
  assert.equal(batch.source_groups.length, 200);
  assert.equal(
    batch.request_digest,
    buildMassLabelingConsolidationRequestV1({
      ...input,
      source_groups: [...groups].reverse(),
    }).request_digest,
  );
  const encoded = JSON.parse(batch.request_body);
  assert.equal(encoded.max_tokens, 32768);
  assert.equal(JSON.stringify(encoded).includes("representatives"), false);
  assert.throws(
    () =>
      buildMassLabelingConsolidationRequestV1({
        ...input,
        source_groups: [{ ...groups[0]!, mention: "private text" }],
      } as never),
    /contract_invalid/u,
  );
  assert.throws(
    () =>
      buildMassLabelingConsolidationRequestV1({
        ...input,
        source_groups: [...groups, groups[0]!],
      }),
    /contract_invalid/u,
  );
});

test("global map accounts for every group once across topics and explicit exclusions", () => {
  const output = {
    topics: [
      {
        topic_key: "consumo",
        name: "Consumo",
        definition: "Motivos de consumo.",
        group_ids: groups.slice(0, 150).map((group) => group.group_id),
      },
    ],
    excluded_groups: groups.slice(150).map((group) => ({
      group_id: group.group_id,
      reason: "Evidência insuficiente",
    })),
  };
  assert.equal(
    validateMassLabelingConsolidationOutputV1(groups, output).excluded_groups
      .length,
    50,
  );
  assert.throws(
    () =>
      validateMassLabelingConsolidationOutputV1(groups, {
        ...output,
        excluded_groups: [],
      }),
    /contract_invalid/u,
  );
  assert.throws(
    () =>
      validateMassLabelingConsolidationOutputV1(groups, {
        ...output,
        excluded_groups: [
          ...output.excluded_groups,
          { group_id: groups[0]!.group_id, reason: "duplicado" },
        ],
      }),
    /contract_invalid/u,
  );
  assert.throws(
    () =>
      validateMassLabelingConsolidationOutputV1(groups, {
        ...output,
        topics: [{ ...output.topics[0]!, group_ids: ["guided:unknown"] }],
      }),
    /contract_invalid/u,
  );
});

test("stored provider bytes must match the sealed model and complete structured output", () => {
  const batch = buildMassLabelingConsolidationRequestV1({
    ...input,
    source_groups: groups.slice(0, 1),
  });
  const output = {
    topics: [
      {
        topic_key: "consumo",
        name: "Consumo",
        definition: "Motivos de consumo.",
        group_ids: [groups[0]!.group_id],
      },
    ],
    excluded_groups: [],
  };
  const raw = {
    model: batch.configuration.model,
    type: "message",
    role: "assistant",
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 80 },
    content: [{ type: "text", text: JSON.stringify(output) }],
  };
  assert.deepEqual(
    parseMassLabelingConsolidationResponseV1(batch, JSON.stringify(raw)).output,
    output,
  );
  assert.throws(
    () =>
      parseMassLabelingConsolidationResponseV1(
        batch,
        JSON.stringify({ ...raw, stop_reason: "max_tokens" }),
      ),
    /contract_invalid/u,
  );
  assert.throws(
    () =>
      parseMassLabelingConsolidationResponseV1(
        batch,
        JSON.stringify({ ...raw, model: "other" }),
      ),
    /contract_invalid/u,
  );
});


test("insufficient source groups remain excluded when stored provider bytes are parsed for adoption", () => {
  const source = [groups[0]!, { ...groups[1]!, status: "insufficient" as const, name: null, definition: null }];
  const batch = buildMassLabelingConsolidationRequestV1({ ...input, source_groups: source });
  const topic = { topic_key: "consumo", name: "Consumo", definition: "Motivos de consumo.", group_ids: [source[0]!.group_id] };
  const output = { topics: [topic], excluded_groups: [{ group_id: source[1]!.group_id, reason: "Evidência insuficiente" }] };
  const raw = (value: unknown) => JSON.stringify({ model: batch.configuration.model, type: "message", role: "assistant",
    stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 80 },
    content: [{ type: "text", text: JSON.stringify(value) }] });
  const validRaw = raw(output);
  assert.deepEqual(parseMassLabelingConsolidationResponseV1(batch, validRaw).output, output);
  assert.deepEqual(parseMassLabelingConsolidationResponseV1(batch, validRaw).output, output);
  for (const invalid of [
    { topics: [{ ...topic, group_ids: source.map(group => group.group_id) }], excluded_groups: [] },
    { topics: [topic, { ...topic, topic_key: "outro", group_ids: [source[1]!.group_id] }], excluded_groups: [] },
    { topics: [topic], excluded_groups: [] },
  ]) {
    const storedRaw = raw(invalid);
    assert.throws(() => validateMassLabelingConsolidationOutputV1(source, invalid), /contract_invalid/u);
    assert.throws(() => parseMassLabelingConsolidationResponseV1(batch, storedRaw), /contract_invalid/u);
    assert.throws(() => parseMassLabelingConsolidationResponseV1(batch, storedRaw), /contract_invalid/u);
    assert.deepEqual(massLabelingConsolidationUsageV1(storedRaw), {
      input_tokens: 100, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    });
  }
});

test("new consolidation retains translated originals and seals the multilingual configuration independently of legacy requests", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONFIGURATION_V1: multilingual } = await import("./signal-workspace-interpretation-v1");
  const selected = groups.slice(0, 1), historical = buildMassLabelingConsolidationRequestV1({ ...input, source_groups: selected });
  const localization = { original_language: "pt-BR", original: { name: "Encontros sociais", definition: "Conversas sobre encontros sociais." },
    en: { name: "Social gatherings", definition: "Conversations about social gatherings." },
    es: { name: "Encuentros sociales", definition: "Conversaciones sobre encuentros sociales." } };
  const source_groups = selected.map(group => ({ ...group, name: localization.en.name, definition: localization.en.definition, localization }));
  const batch = buildMassLabelingConsolidationRequestV1({ ...input, source_groups, configuration: multilingual });
  const output = { topics: [{ topic_key: "social_gatherings", name: localization.en.name, definition: localization.en.definition,
    localization, group_ids: [selected[0]!.group_id] }], excluded_groups: [] };
  const envelope = (value: unknown) => JSON.stringify({ model: multilingual.model, type: "message", role: "assistant", stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 100, output_tokens: 100 } });
  const { parseMassLabelingConsolidationResponseV1 } = await import("./signal-mass-labeling-consolidation-v1");
  assert.deepEqual(parseMassLabelingConsolidationResponseV1(batch, envelope(output)).output.topics[0]!.localization, localization);
  assert.throws(() => parseMassLabelingConsolidationResponseV1(batch, envelope({ ...output,
    topics: [{ ...output.topics[0], localization: undefined }] })), /contract_invalid/);
  assert.throws(() => validateMassLabelingConsolidationOutputV1(selected, { ...output,
    topics: [{ ...output.topics[0], name: localization.original.name }] }), /contract_invalid/);
  assert.equal(JSON.parse(batch.request_body).max_tokens, 65536);
  assert.equal(JSON.parse(batch.request_body).messages[0].content.includes('"original_language":"pt-BR"'), true);
  assert.equal(JSON.parse(historical.request_body).max_tokens, 32768);
  assert.equal(buildMassLabelingConsolidationRequestV1({ ...input, source_groups: selected }).request_body, historical.request_body);
});
