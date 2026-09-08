import { createHash } from "node:crypto";
import { buildSignalWorkspaceTopicPrototypePlanV1, prepareWorkspaceCorpusTextChunksV1,
  signalWorkspaceEmbeddingDigestV1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, type SignalWorkspaceAutonomousContextInputV1 } from "@noisia/query-engine";
import { loadSignalTopicInheritedContextStoreV1 } from "./signal-topic-catalog";
import { loadSignalWorkspaceTopicInputSnapshotWithQueryableV1,
  type SignalWorkspaceTopicQueryableV1 } from "./signal-workspace-topic-computation";

/** The catalog may be empty. Brand OS context has its own semantic aliases and
 * shares physical text cache/call receipts with interest and corpus embeddings. */
export async function loadSignalWorkspaceTopicPrototypePlanV1(args: {
  queryable: SignalWorkspaceTopicQueryableV1; workspace_id: string; actor_user_id: string; input_interests_only?: boolean;
}) {
  const snapshot = await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({ ...args, allow_empty: true, input_interests_only: args.input_interests_only ?? true });
  const autonomous = await loadSignalWorkspaceAutonomousContextInputsV1(args);
  return buildSignalWorkspaceTopicPrototypePlanV1({ taxonomy_profile_id: snapshot.profile_id,
    embedding_profile: snapshot.input.embedding_profile, context_digest: snapshot.input.context_digest,
    topics: snapshot.input.topics, texts: { ...snapshot.input.texts, ...autonomous.texts }, context_inputs: autonomous.context_inputs });
}
/** Brand OS can be compiled before a catalog is explicitly created. Read-only. */
export async function loadSignalWorkspaceAutonomousContextInputsV1(args: {
  queryable: SignalWorkspaceTopicQueryableV1; workspace_id: string;
}) {
  const context = await loadSignalTopicInheritedContextStoreV1({ queryable: args.queryable,
    workspace_id: args.workspace_id, complete_context: true });
  const texts: Record<string,string> = {};
  const context_inputs: SignalWorkspaceAutonomousContextInputV1[] = [];
  for (const scope of ["primary_brand", "competitor", "category"] as const) {
    const scoped = context.embedding_contexts[scope];
    for (const role of ["scope_positive", "scope_negative"] as const) {
      const text = role === "scope_positive" ? scoped.positive_text : scoped.negative_text;
      const hash = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
      const chunks = prepareWorkspaceCorpusTextChunksV1(text, hash);
      chunks.chunks.forEach((chunk, chunk_index) => {
        texts[chunk.sha256] = text.slice(chunk.start, chunk.end);
        context_inputs.push({ guide_key: `scope:${scope}`, role, text_sha256: chunk.sha256,
          input_digest: signalWorkspaceEmbeddingDigestV1({ contract_version: "workspace-brand-context-input-v1",
            context_digest: scoped.context_digest, role, scope, chunk_index, ...chunk,
            embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest }) });
      });
    }
  }
  return { context, texts, context_inputs };
}
