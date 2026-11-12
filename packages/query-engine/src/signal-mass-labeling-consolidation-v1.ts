import { createHash } from "node:crypto";
import { z } from "zod";
import { signalTopicLocalizationSchemaV1 } from "./signal-topic-localization-v1";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";
import {
  SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as configuration,
  SIGNAL_WORKSPACE_MASS_LABELING_CONSOLIDATION_PROMPT_V1 as prompt,
  SIGNAL_WORKSPACE_MASS_LABELING_CONSOLIDATION_SCHEMA_V1 as schema,
  SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONFIGURATION_V1,
  SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONSOLIDATION_PROMPT_V1,
  SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONSOLIDATION_SCHEMA_V1,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONSOLIDATION_LEGACY_PROMPT_V2,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONSOLIDATION_PROMPT_V2,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONSOLIDATION_SCHEMA_V2,
  parseSignalWorkspaceInterpretationConfigurationV1,
  signalWorkspaceInterpretationCostV1,
  type SignalWorkspaceInterpretationConfigurationV1,
  type SignalWorkspaceInterpretationUsageV1,
} from "./signal-workspace-interpretation-v1";

export const MASS_LABELING_CONSOLIDATION_CONTRACT_V1 =
  "workspace-mass-labeling-consolidation-v1" as const;
const groupId = z.string().regex(/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u);
const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0);
const sourceGroup = z
  .object({
    group_id: groupId,
    cluster_digest: sha,
    name: text(160).nullable(),
    definition: text(1200).nullable(),
    localization: signalTopicLocalizationSchemaV1.nullable().optional(),
    status: z.enum(["coherent", "mixed", "insufficient"]),
    source_artifact_id: z.string().uuid(),
  })
  .strict();
export const massLabelingCategoryContextSchemaV2 = z.object({ category: text(160), terms: z.array(text(160)).min(1).max(200) }).strict();
export type MassLabelingCategoryContextV2 = z.infer<typeof massLabelingCategoryContextSchemaV2>;
const catalog = z
  .object({
    topics: z
      .array(
        z
          .object({
            topic_key: z
              .string()
              .max(120)
              .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u),
            name: text(160),
            definition: text(1200),
            localization: signalTopicLocalizationSchemaV1.optional(),
            group_ids: z.array(groupId).min(1).max(200),
          })
          .strict(),
      )
      .max(200),
    category_lexicon: massLabelingCategoryContextSchemaV2.optional(),
    excluded_groups: z
      .array(z.object({ group_id: groupId, reason: text(300) }).strict())
      .max(200),
  })
  .strict();
export type MassLabelingSourceGroupV1 = z.infer<typeof sourceGroup>;
export type MassLabelingConsolidationOutputV1 = z.infer<typeof catalog>;
export type MassLabelingConsolidationBatchV1 = {
  workspace_id: string;
  source_engine_execution_id: string;
  source_groups: MassLabelingSourceGroupV1[];
  source_groups_digest: string;
  request_digest: string;
  request_body: string;
  configuration: typeof configuration | typeof SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONFIGURATION_V1 | typeof SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2 | typeof SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2;
  category_context?: MassLabelingCategoryContextV2;
  reserved_micro_usd: number;
};
const fail = (): never => {
  throw new Error("mass_consolidation_contract_invalid");
};

/** Only generated group summaries cross this boundary. Canonical mention text,
 * roots, examples and the delivered-study taxonomy have no input field. */
export function buildMassLabelingConsolidationRequestV1(args: {
  workspace_id: string;
  source_engine_execution_id: string;
  source_groups: MassLabelingSourceGroupV1[];
  configuration?: SignalWorkspaceInterpretationConfigurationV1;
  category_context?: MassLabelingCategoryContextV2;
}): MassLabelingConsolidationBatchV1 {
  const parsedConfiguration = parseSignalWorkspaceInterpretationConfigurationV1(args.configuration ?? configuration);
  if (parsedConfiguration !== configuration && parsedConfiguration !== SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONFIGURATION_V1 && parsedConfiguration !== SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2
    && parsedConfiguration !== SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2) return fail();
  const selected = parsedConfiguration as MassLabelingConsolidationBatchV1["configuration"];
  const multilingual = "localization_contract_version" in selected;
  const product = "category_lexicon_contract_version" in selected;
  if (product && !massLabelingCategoryContextSchemaV2.safeParse(args.category_context).success) return fail();
  const parsed = z
    .object({
      workspace_id: z.string().uuid(),
      source_engine_execution_id: z.string().uuid(),
      source_groups: z.array(sourceGroup).min(1).max(200),
      configuration: z.unknown().optional(),
      category_context: massLabelingCategoryContextSchemaV2.optional(),
    })
    .strict()
    .safeParse(args);
  if (!parsed.success) return fail();
  const groups = parsed.data.source_groups.sort((left, right) =>
    left.group_id.localeCompare(right.group_id),
  );
  if (new Set(groups.map((group) => group.group_id)).size !== groups.length)
    return fail();
  const source_groups_digest = digest(groups);
  const productPrompt = selected === SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2
    ? SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONSOLIDATION_LEGACY_PROMPT_V2
    : SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONSOLIDATION_PROMPT_V2;
  const request_body = JSON.stringify({
    model: selected.model,
    max_tokens: selected.consolidation_max_output_tokens,
    stream: false,
    thinking: { type: "disabled" },
    system: product ? productPrompt : multilingual ? SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONSOLIDATION_PROMPT_V1 : prompt,
    output_config: { effort: "high", format: { type: "json_schema", schema: product ? SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONSOLIDATION_SCHEMA_V2 : multilingual ? SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONSOLIDATION_SCHEMA_V1 : schema } },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          contract_version: MASS_LABELING_CONSOLIDATION_CONTRACT_V1,
          stage: "global-consolidation-v1",
          workspace_id: args.workspace_id,
          source_engine_execution_id: args.source_engine_execution_id,
          output_locale: multilingual ? "en-US" : "pt-BR",
          source_groups_digest,
          ...(product ? { category_context: args.category_context } : {}),
          groups,
        }),
      },
    ],
  });
  const bytes = Buffer.byteLength(request_body);
  if (bytes > 786_432)
    throw new Error("mass_consolidation_request_capacity_exceeded");
  return {
    ...parsed.data,
    source_groups: groups,
    source_groups_digest,
    request_body,
    configuration: selected,
    request_digest: digest({
      stage: "global-consolidation-v1",
      request_body,
      configuration: selected,
    }),
    reserved_micro_usd: signalWorkspaceInterpretationCostV1(
      {
        input_tokens: bytes * 4 + 8192,
        output_tokens: selected.consolidation_max_output_tokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      selected,
    ),
  };
}

export function validateMassLabelingConsolidationOutputV1(
  groups: MassLabelingSourceGroupV1[],
  value: unknown,
): MassLabelingConsolidationOutputV1 {
  const parsed = catalog.safeParse(value);
  if (!parsed.success) return fail();
  const expected = new Set(groups.map((group) => group.group_id));
  const insufficient = new Set(groups.filter(group => group.status === "insufficient").map(group => group.group_id));
  const seen = new Set<string>(),
    keys = new Set<string>();
  const accept = (id: string) => {
    if (!expected.has(id) || seen.has(id)) return fail();
    seen.add(id);
  };
  for (const topic of parsed.data.topics) {
    if (topic.localization && (topic.name !== topic.localization.en.name || topic.definition !== topic.localization.en.definition)) return fail();
    if (keys.has(topic.topic_key) || topic.group_ids.some(id => insufficient.has(id))) return fail();
    keys.add(topic.topic_key);
    topic.group_ids.forEach(accept);
    topic.group_ids.sort();
  }
  parsed.data.excluded_groups.forEach((group) => accept(group.group_id));
  if (seen.size !== expected.size) return fail();
  return {
    ...(parsed.data.category_lexicon ? { category_lexicon: parsed.data.category_lexicon } : {}),
    topics: parsed.data.topics.sort((left, right) =>
      left.topic_key.localeCompare(right.topic_key),
    ),
    excluded_groups: parsed.data.excluded_groups.sort((left, right) =>
      left.group_id.localeCompare(right.group_id),
    ),
  };
}

/** Reparse the exact stored provider bytes when adopting the final map. */
export function parseMassLabelingConsolidationResponseV1(
  batch: MassLabelingConsolidationBatchV1, raw: string,
): { output: MassLabelingConsolidationOutputV1; usage: SignalWorkspaceInterpretationUsageV1 } {
  const parsed = parseMassLabelingConsolidationEnvelopeV1(raw);
  const output = validateMassLabelingConsolidationOutputV1(batch.source_groups, parsed.value);
  if ("localization_contract_version" in batch.configuration && output.topics.some(topic => !topic.localization)) return fail();
  if ("category_lexicon_contract_version" in batch.configuration
    && (!output.category_lexicon || output.category_lexicon.category !== batch.category_context?.category)) return fail();
  return { output, usage: parsed.usage };
}

function parseMassLabelingConsolidationEnvelopeV1(raw: string): {
  value: unknown; usage: SignalWorkspaceInterpretationUsageV1;
} {
  if (Buffer.byteLength(raw) > 1_048_576)
    throw new Error("mass_consolidation_response_capacity_exceeded");
  const response = z
    .object({
      model: z.literal(configuration.model),
      type: z.literal("message"),
      role: z.literal("assistant"),
      stop_reason: z.literal("end_turn"),
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative().safe(),
          output_tokens: z.number().int().nonnegative().safe(),
          cache_read_input_tokens: z
            .number()
            .int()
            .nonnegative()
            .safe()
            .default(0),
          cache_creation_input_tokens: z
            .number()
            .int()
            .nonnegative()
            .safe()
            .default(0),
          cache_creation: z
            .object({ ephemeral_1h_input_tokens: z.literal(0).optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
      content: z.array(
        z
          .object({ type: z.string(), text: z.string().optional() })
          .passthrough(),
      ),
    })
    .passthrough()
    .safeParse(JSON.parse(raw));
  if (!response.success) return fail();
  const blocks = response.data.content.filter((block) => block.type === "text");
  if (
    blocks.length !== 1 ||
    !blocks[0]?.text ||
    response.data.content.some(
      (block) =>
        !["text", "thinking", "redacted_thinking"].includes(block.type),
    )
  )
    return fail();
  const {
    input_tokens,
    output_tokens,
    cache_read_input_tokens,
    cache_creation_input_tokens,
  } = response.data.usage;
  return {
    value: JSON.parse(blocks[0].text),
    usage: {
      input_tokens,
      output_tokens,
      cache_read_input_tokens,
      cache_creation_input_tokens,
    },
  };
}

/** Known metering can be settled even when the structured result is invalid. */
export function massLabelingConsolidationUsageV1(
  raw: string,
): SignalWorkspaceInterpretationUsageV1 | null {
  try {
    const body = JSON.parse(raw);
    if (body?.model !== configuration.model || !body.usage) return null;
    const usage = {
      input_tokens: body.usage.input_tokens,
      output_tokens: body.usage.output_tokens,
      cache_read_input_tokens: body.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: body.usage.cache_creation_input_tokens ?? 0,
    };
    if (
      Object.values(usage).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      ) ||
      (body.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) !== 0
    )
      return null;
    return usage;
  } catch {
    return null;
  }
}


const receiptRecoveryDecision = z.object({
  contract_version: z.literal("workspace-mass-labeling-receipt-recovery-v1"),
  workspace_id: z.string().uuid(), execution_id: z.string().uuid(), call_id: z.string().uuid(),
  request_digest: sha, response_sha256: sha, source_groups_digest: sha,
  topic_key_changes: z.array(z.object({ from: text(120), to: catalog.shape.topics.element.shape.topic_key }).strict()).length(3),
  assignment_resolution: z.object({
    method: z.literal("source_segments_and_exact_remaining_summary"), group_id: groupId,
    keep_topic_key: text(120), remove_topic_key: text(120),
    definition_omission: z.object({ unit: z.literal("unicode_code_points"),
      prefix_length: z.number().int().positive().max(1200), removed_length: z.number().int().positive().max(1200),
      suffix_length: z.number().int().positive().max(1200) }).strict(),
  }).strict(),
}).strict();
const receiptRecoveryDecisionV2 = z.object({
  contract_version: z.literal("workspace-mass-labeling-receipt-recovery-v2"),
  workspace_id: z.string().uuid(), execution_id: z.string().uuid(), call_id: z.string().uuid(),
  request_digest: sha, response_sha256: sha, source_groups_digest: sha,
  singleton_exclusions: z.array(z.object({ group_id: groupId,
    topic_key: catalog.shape.topics.element.shape.topic_key, reason_sha256: sha }).strict()).min(1).max(2),
  english_definition_reconciliations: z.array(z.object({
    topic_key: catalog.shape.topics.element.shape.topic_key,
    original_definition_sha256: sha, english_definition_sha256: sha,
  }).strict()).length(1),
}).strict();
export type MassLabelingConsolidationRecoveryDecisionV2 = z.infer<typeof receiptRecoveryDecisionV2>;
export type MassLabelingConsolidationRecoveryDecisionV1 = z.infer<typeof receiptRecoveryDecision> | MassLabelingConsolidationRecoveryDecisionV2;

export function parseMassLabelingConsolidationRecoveryDecisionV1(value: unknown): MassLabelingConsolidationRecoveryDecisionV1 {
  const parsed = z.union([receiptRecoveryDecision, receiptRecoveryDecisionV2]).safeParse(value);
  if (!parsed.success) return fail();
  return parsed.data;
}

/** Replay a single explicitly authorized global receipt. The original envelope
 * and strict historical parser remain the source of metering and validation. */
export function recoverMassLabelingConsolidationResponseV1(
  batch: MassLabelingConsolidationBatchV1, raw: string, decisionValue: unknown,
): { output: MassLabelingConsolidationOutputV1; usage: SignalWorkspaceInterpretationUsageV1 } {
  const decision = parseMassLabelingConsolidationRecoveryDecisionV1(decisionValue);
  if (decision.contract_version === "workspace-mass-labeling-receipt-recovery-v2") {
    const expected = buildMassLabelingConsolidationRecoveryDecisionV2({ batch, raw_response: raw, call_id: decision.call_id });
    if (digest(expected) !== digest(decision)) return fail();
    return recoverNativeConsolidationV2(batch, raw).parsed;
  }
  const rebuilt = buildMassLabelingConsolidationRequestV1({ workspace_id: batch.workspace_id,
    source_engine_execution_id: batch.source_engine_execution_id, source_groups: batch.source_groups });
  if (digest(rebuilt) !== digest(batch) || decision.workspace_id !== batch.workspace_id
    || decision.execution_id !== batch.source_engine_execution_id || decision.request_digest !== batch.request_digest
    || decision.source_groups_digest !== batch.source_groups_digest
    || decision.response_sha256 !== `sha256:${createHash("sha256").update(raw).digest("hex")}`) return fail();
  const parsed = parseMassLabelingConsolidationEnvelopeV1(raw);
  const recoverable = catalog.extend({ topics: z.array(catalog.shape.topics.element.extend({ topic_key: text(120) })).max(200) })
    .safeParse(parsed.value);
  if (!recoverable.success) return fail();
  const output = recoverable.data;
  if (new Set(output.topics.map(topic => topic.topic_key)).size !== output.topics.length) return fail();
  const changes = new Map<string, string>();
  for (const change of decision.topic_key_changes) {
    const decomposed = change.from.normalize("NFKD"), marks = decomposed.match(/\p{M}/gu) ?? [];
    if (changes.has(change.from) || marks.length !== 1 || decomposed !== change.from.normalize("NFD")
      || change.from === change.to || decomposed.replace(/\p{M}/gu, "") !== change.to
      || output.topics.filter(topic => topic.topic_key === change.from).length !== 1) return fail();
    changes.set(change.from, change.to);
  }
  const resolution = decision.assignment_resolution;
  const keep = output.topics.find(topic => topic.topic_key === resolution.keep_topic_key);
  const remove = output.topics.find(topic => topic.topic_key === resolution.remove_topic_key);
  if (!keep || !remove || keep === remove || keep.group_ids.length !== 1 || remove.group_ids.length !== 2
    || keep.group_ids[0] !== resolution.group_id || !remove.group_ids.includes(resolution.group_id)) return fail();
  const memberships = new Map<string, string[]>();
  for (const topic of output.topics) for (const group of topic.group_ids) {
    const keys = memberships.get(group) ?? []; keys.push(topic.topic_key); memberships.set(group, keys);
  }
  const duplicated = [...memberships].filter(([, keys]) => keys.length > 1);
  if (duplicated.length !== 1 || duplicated[0]![0] !== resolution.group_id || duplicated[0]![1].length !== 2) return fail();
  const source = batch.source_groups.find(group => group.group_id === resolution.group_id);
  const remainingId = remove.group_ids.find(group => group !== resolution.group_id);
  const remaining = batch.source_groups.find(group => group.group_id === remainingId);
  if (!source || source.status === "insufficient" || source.name !== keep.name || source.definition === null
    || !remaining || remaining.status === "insufficient" || remaining.name !== remove.name || remaining.definition !== remove.definition)
    return fail();
  const original = Array.from(source.definition), omitted = resolution.definition_omission;
  if (original.length !== omitted.prefix_length + omitted.removed_length + omitted.suffix_length
    || original.slice(0, omitted.prefix_length).join("") + original.slice(-omitted.suffix_length).join("") !== keep.definition)
    return fail();
  remove.group_ids = remove.group_ids.filter(group => group !== resolution.group_id);
  for (const topic of output.topics) topic.topic_key = changes.get(topic.topic_key) ?? topic.topic_key;
  return { output: validateMassLabelingConsolidationOutputV1(batch.source_groups, output), usage: parsed.usage };
}

const receiptShaV2 = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** This bounded rule uses only already-paid wording and explicit exclusions.
 * It cannot add a topic, group, reason, translation or provider authority. */
function recoverNativeConsolidationV2(batch: MassLabelingConsolidationBatchV1, raw: string) {
  const rebuilt = buildMassLabelingConsolidationRequestV1({ workspace_id: batch.workspace_id,
    source_engine_execution_id: batch.source_engine_execution_id, source_groups: batch.source_groups,
    configuration: batch.configuration, category_context: batch.category_context });
  if (digest(rebuilt) !== digest(batch) || !("category_lexicon_contract_version" in batch.configuration)) return fail();
  const envelope = parseMassLabelingConsolidationEnvelopeV1(raw);
  const checked = catalog.safeParse(envelope.value);
  if (!checked.success) return fail();
  const output = checked.data;
  const original = structuredClone(output);
  if (new Set(output.topics.map(t => t.topic_key)).size !== output.topics.length
    || new Set(output.excluded_groups.map(g => g.group_id)).size !== output.excluded_groups.length) return fail();
  const exclusions: MassLabelingConsolidationRecoveryDecisionV2["singleton_exclusions"] = [];
  for (const excluded of output.excluded_groups) {
    const overlapping = output.topics.filter(topic => topic.group_ids.includes(excluded.group_id));
    if (!overlapping.length) continue;
    const topic = overlapping[0]!;
    const source = batch.source_groups.find(group => group.group_id === excluded.group_id);
    if (overlapping.length !== 1 || topic.group_ids.length !== 1 || source?.status !== "mixed"
      || source.name !== topic.name || source.definition !== topic.definition
      || !/\bmix(?:ed|es|ture)?\b/iu.test(excluded.reason)
      || !/overlap|already|redundan|limited|weak|thin|sparse|fragment|insufficien|few/iu.test(excluded.reason)) return fail();
    exclusions.push({ group_id: excluded.group_id, topic_key: topic.topic_key, reason_sha256: receiptShaV2(excluded.reason) });
  }
  if (exclusions.length < 1 || exclusions.length > 2) return fail();
  const reconciliations: MassLabelingConsolidationRecoveryDecisionV2["english_definition_reconciliations"] = [];
  for (const topic of output.topics) {
    if (!topic.localization || topic.name !== topic.localization.en.name) return fail();
    const english = topic.localization.en.definition;
    if (topic.definition === english) continue;
    const a = Array.from(topic.definition), b = Array.from(english);
    let prefix = 0; while (prefix < b.length && a[prefix] === b[prefix]) prefix++;
    // A single pre-existing role/comparison marker may be absent in the paid
    // English localization. Negation, arbitrary edits and insertions fail closed.
    if (a.length - b.length !== 3 || a.slice(prefix, prefix + 3).join("") !== "as "
      || a.slice(prefix + 3).join("") !== b.slice(prefix).join("")) return fail();
    reconciliations.push({ topic_key: topic.topic_key, original_definition_sha256: receiptShaV2(topic.definition),
      english_definition_sha256: receiptShaV2(english) });
    topic.definition = english;
  }
  if (reconciliations.length !== 1) return fail();
  const removedKeys = new Set(exclusions.map(e => e.topic_key));
  if (reconciliations.some(r => removedKeys.has(r.topic_key))) return fail();
  output.topics = output.topics.filter(topic => !removedKeys.has(topic.topic_key));
  const validated = validateMassLabelingConsolidationOutputV1(batch.source_groups, output);
  if (!validated.category_lexicon || validated.category_lexicon.category !== batch.category_context?.category) return fail();
  // Strict envelope parsing is shared with the ordinary path; the original raw
  // is retained by callers, while this candidate is validated and never sent.
  const normalizedEnvelope = JSON.parse(raw);
  normalizedEnvelope.content.find((block: {type:string}) => block.type === "text").text = JSON.stringify(validated);
  const parsed = parseMassLabelingConsolidationResponseV1(batch, JSON.stringify(normalizedEnvelope));
  if (digest(parsed.output.excluded_groups) !== digest(original.excluded_groups.sort((a,b) => a.group_id.localeCompare(b.group_id)))) return fail();
  return { parsed, exclusions: exclusions.sort((a,b) => a.group_id.localeCompare(b.group_id)),
    reconciliations: reconciliations.sort((a,b) => a.topic_key.localeCompare(b.topic_key)) };
}

/** A server derives this disposition from the exact signed inputs. There are no
 * user-supplied editorial choices or replacement strings in the decision. */
export function buildMassLabelingConsolidationRecoveryDecisionV2(args: {
  batch: MassLabelingConsolidationBatchV1; raw_response: string; call_id: string;
}): MassLabelingConsolidationRecoveryDecisionV2 {
  const recovered = recoverNativeConsolidationV2(args.batch, args.raw_response);
  const decision = { contract_version: "workspace-mass-labeling-receipt-recovery-v2" as const,
    workspace_id: args.batch.workspace_id, execution_id: args.batch.source_engine_execution_id, call_id: args.call_id,
    request_digest: args.batch.request_digest, response_sha256: receiptShaV2(args.raw_response), source_groups_digest: args.batch.source_groups_digest,
    singleton_exclusions: recovered.exclusions, english_definition_reconciliations: recovered.reconciliations };
  const checked = receiptRecoveryDecisionV2.safeParse(decision);
  if (!checked.success) return fail();
  return checked.data;
}
