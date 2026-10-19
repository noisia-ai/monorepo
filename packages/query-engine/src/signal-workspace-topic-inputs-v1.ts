import { createHash } from "node:crypto";
import { z } from "zod";
import {
  signalTopicDefinitionDigestV1, signalTopicDefinitionSchemaV1, type SignalTopicDefinitionV1
} from "./signal-topic-catalog-v1";
import {
  prepareWorkspaceCorpusTextChunksV1, WORKSPACE_CORPUS_TEXT_CHUNK_POLICY_V1
} from "./signal-workspace-corpus-preparation-chunks";
import {
  assertSignalWorkspaceEmbeddingProfileV1, boundSignalWorkspaceEmbeddingInputTokensV1,
  signalWorkspaceEmbeddingDigestV1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  type SignalWorkspaceEmbeddingProfileV1
} from "./signal-workspace-embeddings-v1";

export const SIGNAL_WORKSPACE_TOPIC_INPUTS_CONTRACT_V1 = "signal-workspace-topic-inputs-v1" as const;
export type SignalWorkspaceTopicInputRoleV1 =
  | "topic_positive" | "topic_negative" | "scope_positive" | "scope_negative";
export type SignalWorkspaceTopicContextRefV1 = {
  source_type: string; source_id: string; version: string; content_hash: string;
};
export type SignalWorkspaceTopicInputContextV1 = {
  context_digest: string;
  positive_text: string;
  negative_text: string;
  context_refs?: readonly SignalWorkspaceTopicContextRefV1[];
};
export type SignalWorkspaceTopicInputV1 = {
  role: SignalWorkspaceTopicInputRoleV1;
  input_digest: string;
  text: string;
  text_sha256: string;
  source_key: string;
  chunk_index: number;
  /** Half-open UTF-16 offsets within the original individual source field. */
  start: number;
  end: number;
};
export type SignalWorkspaceTopicInputsV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_TOPIC_INPUTS_CONTRACT_V1;
  definition_digest: string;
  definition_revision: number;
  context_digest: string;
  embedding_config_digest: string;
  compiler_digest: string;
  inputs: SignalWorkspaceTopicInputV1[];
};

export class SignalWorkspaceTopicInputsError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SignalWorkspaceTopicInputsError"; }
}
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const refSchema = z.object({
  source_type: z.string().min(1), source_id: z.string().min(1), version: z.string().min(1),
  content_hash: digestSchema
}).strict();
const contextSchema = z.object({
  context_digest: digestSchema, positive_text: z.string(), negative_text: z.string(),
  context_refs: z.array(refSchema).optional()
}).strict();

/** Compile evidence inputs, never a classifier, threshold, provider call or execution authority.
 * Topic fields and scope guidance retain separate roles and sources; guidance is not a
 * positive Topic match or a hard negative veto. Every source is covered without truncation.
 * Cache reusable vectors by the exact text hash plus the complete embedding configuration;
 * input_digest/compiler_digest additionally bind semantic provenance and Topic revision.
 */
export function compileSignalWorkspaceTopicInputsV1(args: {
  topic: SignalTopicDefinitionV1;
  context: SignalWorkspaceTopicInputContextV1;
  profile?: SignalWorkspaceEmbeddingProfileV1;
}): SignalWorkspaceTopicInputsV1 {
  const profile = args.profile ?? SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1;
  assertSignalWorkspaceEmbeddingProfileV1(profile);
  const parsedTopic = signalTopicDefinitionSchemaV1.safeParse(args.topic);
  if (!parsedTopic.success) throw new SignalWorkspaceTopicInputsError("workspace_topic_definition_invalid");
  if (signalTopicDefinitionDigestV1(parsedTopic.data) !== parsedTopic.data.definition_digest) {
    throw new SignalWorkspaceTopicInputsError("workspace_topic_definition_digest_mismatch");
  }
  const parsedContext = contextSchema.safeParse(args.context);
  if (!parsedContext.success) throw new SignalWorkspaceTopicInputsError("workspace_topic_context_invalid");
  const context = parsedContext.data;
  const refs = (context.context_refs ?? []).map((ref) => signalWorkspaceEmbeddingDigestV1(ref)).sort();
  const identity = {
    contract_version: SIGNAL_WORKSPACE_TOPIC_INPUTS_CONTRACT_V1,
    definition_digest: parsedTopic.data.definition_digest,
    definition_revision: parsedTopic.data.definition_revision,
    context_digest: context.context_digest,
    context_refs_digest: signalWorkspaceEmbeddingDigestV1(refs),
    embedding_config_digest: profile.config_digest,
    chunk_policy_version: WORKSPACE_CORPUS_TEXT_CHUNK_POLICY_V1
  };
  const inputs: SignalWorkspaceTopicInputV1[] = [];
  const addSource = (role: SignalWorkspaceTopicInputRoleV1, source_key: string, text: string) => {
    if (text.includes("\u0000")) throw new SignalWorkspaceTopicInputsError("workspace_topic_text_invalid");
    const source_text_sha256 = sha256(text);
    const manifest = prepareWorkspaceCorpusTextChunksV1(text, source_text_sha256);
    manifest.chunks.forEach((chunk, chunk_index) => {
      const part = text.slice(chunk.start, chunk.end);
      // Enforce the provider input contract, including Unicode, without invoking a provider.
      boundSignalWorkspaceEmbeddingInputTokensV1(part);
      const provenance = { role, source_key, chunk_index, start: chunk.start, end: chunk.end,
        text_sha256: chunk.sha256 };
      inputs.push({ ...provenance, text: part,
        input_digest: signalWorkspaceEmbeddingDigestV1({ ...identity, source_text_sha256, ...provenance }) });
    });
  };
  // Validation may trim strings; compilation deliberately uses the original source bytes.
  addSource("topic_positive", "topic.definition", args.topic.definition);
  (args.topic.inclusion ?? parsedTopic.data.inclusion).forEach((text, index) => addSource("topic_positive", `topic.inclusion.${index}`, text));
  (args.topic.positive_examples ?? parsedTopic.data.positive_examples).forEach((text, index) => addSource("topic_positive", `topic.positive_examples.${index}`, text));
  (args.topic.exclusion ?? parsedTopic.data.exclusion).forEach((text, index) => addSource("topic_negative", `topic.exclusion.${index}`, text));
  (args.topic.negative_examples ?? parsedTopic.data.negative_examples).forEach((text, index) => addSource("topic_negative", `topic.negative_examples.${index}`, text));
  addSource("scope_positive", "context.positive_text", context.positive_text);
  addSource("scope_negative", "context.negative_text", context.negative_text);
  return {
    contract_version: identity.contract_version,
    definition_digest: identity.definition_digest,
    definition_revision: identity.definition_revision,
    context_digest: identity.context_digest,
    embedding_config_digest: identity.embedding_config_digest,
    compiler_digest: signalWorkspaceEmbeddingDigestV1({ ...identity,
      inputs: inputs.map(({ text: _text, ...input }) => input) }),
    inputs
  };
}

function sha256(text: string) { return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`; }
