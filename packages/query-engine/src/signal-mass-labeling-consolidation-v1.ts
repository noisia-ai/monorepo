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
  const seen = new Set<string>(),
    keys = new Set<string>();
  const accept = (id: string) => {
    if (!expected.has(id) || seen.has(id)) return fail();
    seen.add(id);
  };
  for (const topic of parsed.data.topics) {
    if (keys.has(topic.topic_key)) return fail();
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
  batch: MassLabelingConsolidationBatchV1,
  raw: string,
): {
  output: MassLabelingConsolidationOutputV1;
  usage: SignalWorkspaceInterpretationUsageV1;
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
    output: validateMassLabelingConsolidationOutputV1(
      batch.source_groups,
      JSON.parse(blocks[0].text),
    ),
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
