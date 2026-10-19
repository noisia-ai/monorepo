import { createHash } from "node:crypto";
import {
  assertSignalWorkspaceEmbeddingProfileV1, boundSignalWorkspaceEmbeddingInputTokensV1,
  signalWorkspaceEmbeddingDigestV1, type SignalWorkspaceEmbeddingProfileV1
} from "./signal-workspace-embeddings-v1";
import { SIGNAL_WORKSPACE_TOPIC_INPUTS_CONTRACT_V1, type SignalWorkspaceTopicInputsV1,
  type SignalWorkspaceTopicInputV1 } from "./signal-workspace-topic-inputs-v1";

export type SignalWorkspaceAutonomousContextInputV1 = {
  guide_key: string; role: "scope_positive" | "scope_negative";
  input_digest: string; text_sha256: string;
};
export type SignalWorkspaceTopicPrototypePlanV1 = {
  contract_version: "signal-workspace-topic-prototype-plan-v1";
  taxonomy_profile_id: string;
  embedding_profile: SignalWorkspaceEmbeddingProfileV1;
  context_digest: string;
  topics: Array<{ taxonomy_term_id: string; definition_digest: string; definition_revision: number;
    compiler_digest: string; context_digest: string; input_digests: string[] }>;
  context_inputs?: SignalWorkspaceAutonomousContextInputV1[];
  inputs: Array<{ input_digest: string; text_sha256: string }>;
  texts: Record<string, string>;
  plan_digest: string;
};
export class SignalWorkspaceTopicPrototypePlanError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SignalWorkspaceTopicPrototypePlanError"; }
}
const fail = (): never => { throw new SignalWorkspaceTopicPrototypePlanError("workspace_topic_prototype_plan_invalid"); };
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);

/** Seal server-compiled inputs. Semantic aliases retain their own identity, while
 * identical text is embedded only once for the complete workspace/provider profile.
 * No corpus, external transport, calibrated classification or publication is implied.
 */
export function buildSignalWorkspaceTopicPrototypePlanV1(args: {
  taxonomy_profile_id: string;
  embedding_profile: SignalWorkspaceEmbeddingProfileV1;
  context_digest: string;
  topics: Array<{ taxonomy_term_id: string;
    compiled: Omit<SignalWorkspaceTopicInputsV1, "inputs"> & { inputs: Array<Omit<SignalWorkspaceTopicInputV1, "text">> } }>;
  texts: Record<string, string>;
  context_inputs?: SignalWorkspaceAutonomousContextInputV1[];
}): SignalWorkspaceTopicPrototypePlanV1 {
  assertSignalWorkspaceEmbeddingProfileV1(args.embedding_profile);
  if (!isId(args.taxonomy_profile_id) || !isDigest(args.context_digest)) return fail();
  const aliases = new Map<string, string>();
  const texts = new Map<string, string>();
  const topicIds = new Set<string>();
  const topics = args.topics.map(({ taxonomy_term_id, compiled }) => {
    if (!isId(taxonomy_term_id) || topicIds.has(taxonomy_term_id)) return fail();
    topicIds.add(taxonomy_term_id);
    if (compiled.contract_version !== SIGNAL_WORKSPACE_TOPIC_INPUTS_CONTRACT_V1
      || !isDigest(compiled.context_digest)
      || compiled.embedding_config_digest !== args.embedding_profile.config_digest
      || !isDigest(compiled.definition_digest) || !isDigest(compiled.compiler_digest)
      || !Number.isSafeInteger(compiled.definition_revision) || compiled.definition_revision < 1 || !compiled.inputs.length) return fail();
    const inputDigests = new Set<string>();
    for (const input of compiled.inputs) {
      if (!isDigest(input.input_digest) || !isDigest(input.text_sha256) || inputDigests.has(input.input_digest)) return fail();
      const text = args.texts[input.text_sha256];
      if (typeof text !== "string" || text.includes("\u0000")
        || `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}` !== input.text_sha256) return fail();
      if (!texts.has(input.text_sha256)) boundSignalWorkspaceEmbeddingInputTokensV1(text);
      if (aliases.has(input.input_digest) && aliases.get(input.input_digest) !== input.text_sha256) return fail();
      aliases.set(input.input_digest, input.text_sha256);
      texts.set(input.text_sha256, text);
      inputDigests.add(input.input_digest);
    }
    return { taxonomy_term_id, definition_digest: compiled.definition_digest,
      definition_revision: compiled.definition_revision, compiler_digest: compiled.compiler_digest, context_digest: compiled.context_digest,
      input_digests: [...inputDigests].sort() };
  }).sort((a, b) => a.taxonomy_term_id.localeCompare(b.taxonomy_term_id));
  const contextInputs = (args.context_inputs ?? []).map(input => {
    if (!/^scope:(primary_brand|competitor|category)$/u.test(input.guide_key)
      || !["scope_positive", "scope_negative"].includes(input.role)
      || !isDigest(input.input_digest) || !isDigest(input.text_sha256)) return fail();
    const text = args.texts[input.text_sha256];
    if (typeof text !== "string" || text.includes("\u0000")
      || `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}` !== input.text_sha256) return fail();
    if (!texts.has(input.text_sha256)) boundSignalWorkspaceEmbeddingInputTokensV1(text);
    if (aliases.has(input.input_digest) && aliases.get(input.input_digest) !== input.text_sha256) return fail();
    aliases.set(input.input_digest, input.text_sha256); texts.set(input.text_sha256, text);
    return { ...input };
  }).sort((a, b) => a.input_digest.localeCompare(b.input_digest));
  if (new Set(contextInputs.map(input => input.input_digest)).size !== contextInputs.length) return fail();
  // Reject unreferenced text rather than putting unrelated context in a durable paid-input snapshot.
  if (Object.keys(args.texts).length !== texts.size) return fail();
  const sealed = { contract_version: "signal-workspace-topic-prototype-plan-v1" as const,
    taxonomy_profile_id: args.taxonomy_profile_id, embedding_profile: args.embedding_profile,
    context_digest: args.context_digest, topics, ...(args.context_inputs ? { context_inputs: contextInputs } : {}),
    inputs: [...aliases].sort(([a], [b]) => a.localeCompare(b)).map(([input_digest, text_sha256]) => ({ input_digest, text_sha256 })),
    texts: Object.fromEntries([...texts].sort(([a], [b]) => a.localeCompare(b))) };
  return { ...sealed, plan_digest: signalWorkspaceEmbeddingDigestV1(sealed) };
}
