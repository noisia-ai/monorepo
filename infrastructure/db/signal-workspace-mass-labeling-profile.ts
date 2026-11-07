import { createHash } from "node:crypto";
import { prepareWorkspaceCorpusTextChunksV1, signalWorkspaceEmbeddingDigestV1,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, type SignalWorkspaceAutonomousContextInputV1 } from "@noisia/query-engine";
import { loadSignalSemanticResolutionGovernedContextV1 } from "./signal-semantic-resolution";
import { signalWorkspaceFeatureEnabledV1 } from "./signal-workspace-features";
import type { SignalWorkspaceTopicQueryableV1 } from "./signal-workspace-topic-computation";

/** One kill switch and durable workspace opt-in, shared with the classifier. */
export async function signalWorkspaceMassLabelingEnabledV1(args: {
  queryable: SignalWorkspaceTopicQueryableV1; workspace_id: string;
}): Promise<boolean> {
  return signalWorkspaceFeatureEnabledV1({ ...args, feature: "mass_labeling" });
}

/** The pilot never reads a taxonomy, research brief or delivered-study labels.
 * Each seed consists solely of the governed identity names and aliases. */
export async function loadSignalWorkspaceMassLabelingSeedsV1(args: {
  queryable: SignalWorkspaceTopicQueryableV1; workspace_id: string;
}) {
  const governed = await loadSignalSemanticResolutionGovernedContextV1(args.queryable, args.workspace_id);
  const seeds = (["primary_brand", "competitor", "category"] as const).map(scope => ({
    scope,
    names: [...new Set([
      ...(scope === "primary_brand" ? [governed.workspace.brand_name] : []),
      ...(scope === "category" ? [governed.workspace.industry, governed.workspace.industry_sub] : []),
      ...governed.identities.filter(identity => identity.scope === scope)
        .flatMap(identity => [identity.entity_label, ...identity.aliases]),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(value => value.trim()))].sort(),
  })).filter(seed => seed.names.length > 0);
  const context_digest = signalWorkspaceEmbeddingDigestV1({ contract_version: "workspace-mass-labeling-seeds-v1", seeds });
  const texts: Record<string, string> = {}, context_inputs: SignalWorkspaceAutonomousContextInputV1[] = [];
  for (const seed of seeds) {
    const text = seed.names.join("\n");
    const hash = `sha256:${createHash("sha256").update(text).digest("hex")}`;
    for (const [chunk_index, chunk] of prepareWorkspaceCorpusTextChunksV1(text, hash).chunks.entries()) {
      texts[chunk.sha256] = text.slice(chunk.start, chunk.end);
      context_inputs.push({ guide_key: `scope:${seed.scope}`, role: "scope_positive", text_sha256: chunk.sha256,
        input_digest: signalWorkspaceEmbeddingDigestV1({ contract_version: "workspace-mass-labeling-seed-input-v1",
          context_digest, scope: seed.scope, chunk_index, ...chunk,
          embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest }) });
    }
  }
  return { context_digest, texts, context_inputs, seeds };
}
