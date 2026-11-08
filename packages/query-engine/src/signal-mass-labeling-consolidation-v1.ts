import { createHash } from "node:crypto";
import { z } from "zod";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";
import {
  SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as configuration,
  SIGNAL_WORKSPACE_MASS_LABELING_CONSOLIDATION_PROMPT_V1 as prompt,
  SIGNAL_WORKSPACE_MASS_LABELING_CONSOLIDATION_SCHEMA_V1 as schema,
  signalWorkspaceInterpretationCostV1,
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
    status: z.enum(["coherent", "mixed", "insufficient"]),
    source_artifact_id: z.string().uuid(),
  })
  .strict();
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
            group_ids: z.array(groupId).min(1).max(200),
          })
          .strict(),
      )
      .max(200),
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
  configuration: typeof configuration;
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
}): MassLabelingConsolidationBatchV1 {
  const parsed = z
    .object({
      workspace_id: z.string().uuid(),
      source_engine_execution_id: z.string().uuid(),
      source_groups: z.array(sourceGroup).min(1).max(200),
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
  const request_body = JSON.stringify({
    model: configuration.model,
    max_tokens: configuration.consolidation_max_output_tokens,
    stream: false,
    thinking: { type: "disabled" },
    system: prompt,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          contract_version: MASS_LABELING_CONSOLIDATION_CONTRACT_V1,
          stage: "global-consolidation-v1",
          workspace_id: args.workspace_id,
          source_engine_execution_id: args.source_engine_execution_id,
          output_locale: "pt-BR",
          source_groups_digest,
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
    configuration,
    request_digest: digest({
      stage: "global-consolidation-v1",
      request_body,
      configuration,
    }),
    reserved_micro_usd: signalWorkspaceInterpretationCostV1(
      {
        input_tokens: bytes * 4 + 8192,
        output_tokens: configuration.consolidation_max_output_tokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      configuration,
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
    if (keys.has(topic.topic_key) || topic.group_ids.some(id => insufficient.has(id))) return fail();
    keys.add(topic.topic_key);
    topic.group_ids.forEach(accept);
    topic.group_ids.sort();
  }
  parsed.data.excluded_groups.forEach((group) => accept(group.group_id));
  if (seen.size !== expected.size) return fail();
  return {
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
  return { output: validateMassLabelingConsolidationOutputV1(batch.source_groups, parsed.value), usage: parsed.usage };
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
export type MassLabelingConsolidationRecoveryDecisionV1 = z.infer<typeof receiptRecoveryDecision>;

export function parseMassLabelingConsolidationRecoveryDecisionV1(value: unknown): MassLabelingConsolidationRecoveryDecisionV1 {
  const parsed = receiptRecoveryDecision.safeParse(value);
  if (!parsed.success) return fail();
  return parsed.data;
}

/** Replay a single explicitly authorized global receipt. The original envelope
 * and strict historical parser remain the source of metering and validation. */
export function recoverMassLabelingConsolidationResponseV1(
  batch: MassLabelingConsolidationBatchV1, raw: string, decisionValue: unknown,
): { output: MassLabelingConsolidationOutputV1; usage: SignalWorkspaceInterpretationUsageV1 } {
  const decision = parseMassLabelingConsolidationRecoveryDecisionV1(decisionValue);
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
