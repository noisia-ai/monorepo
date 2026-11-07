import { signalWorkspaceEmbeddingDigestV1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
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
  return { context_digest, seeds };
}

/** Derive guidance in Voyage's original space from current eligible fragments.
 * Matching seed text is retrieval evidence. It grants no topic membership. */
export async function loadSignalWorkspaceMassLabelingGuidesV1(args: {
  queryable: SignalWorkspaceTopicQueryableV1; workspace_id: string;
}) {
  const seeds = await loadSignalWorkspaceMassLabelingSeedsV1(args);
  const rows = (await args.queryable.query<{ scope: string; vector: string; members_digest: string }>(`
    WITH embedded AS MATERIALIZED (
      SELECT run.id,run.preparation_run_id,run.config_digest FROM signal_workspace_embedding_runs run
      JOIN signal_corpus_preparation_input_state state USING(workspace_id)
      WHERE run.workspace_id=$1::uuid AND run.input_contract='corpus' AND run.status='completed'
        AND run.input_revision=state.input_revision AND run.config_digest=$2
        AND (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp())
      ORDER BY run.completed_at DESC,run.id DESC LIMIT 1
    ), fragments AS MATERIALIZED (
      SELECT DISTINCT chunk.value->>'sha256' chunk_sha256,
        signal_topic_utf16_fragment_v1(asset.full_text,(chunk.value->>'start')::int,(chunk.value->>'end')::int) text,
        cache.embedding
      FROM embedded JOIN signal_corpus_preparation_items item ON item.run_id=embedded.preparation_run_id
        AND item.workspace_id=$1::uuid AND item.disposition='eligible'
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
        AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') chunk(value)
      JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$1::uuid
        AND cache.config_digest=embedded.config_digest AND cache.chunk_sha256=chunk.value->>'sha256'
    ), matched AS (
      SELECT seed.scope,fragment.chunk_sha256,fragment.embedding
      FROM jsonb_to_recordset($3::jsonb) seed(scope text,names text[]) CROSS JOIN fragments fragment
      WHERE EXISTS(SELECT 1 FROM unnest(seed.names) name WHERE length(name)>=3
        AND strpos(lower(fragment.text),lower(name))>0)
    ) SELECT scope,avg(embedding)::text vector,
      'sha256:'||encode(sha256(convert_to(string_agg(chunk_sha256,'' ORDER BY chunk_sha256),'UTF8')),'hex') members_digest
      FROM matched GROUP BY scope ORDER BY scope`,
    [args.workspace_id, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest, JSON.stringify(seeds.seeds)])).rows;
  const guides = rows.map(row => {
    const vector = JSON.parse(row.vector) as number[];
    const norm = Math.hypot(...vector);
    if (vector.length !== 1024 || !Number.isFinite(norm) || norm <= 0)
      throw new Error("workspace_engine_seed_vector_invalid");
    const normalized = vector.map(value => value / norm);
    return { guide_key: `scope:${row.scope}`, role: "scope_positive" as const,
      text_sha256: signalWorkspaceEmbeddingDigestV1(seeds.seeds.find(seed => seed.scope === row.scope)!.names),
      input_digest: signalWorkspaceEmbeddingDigestV1({ contract_version: "workspace-brand-seed-corpus-centroid-v1",
        context_digest: seeds.context_digest, scope: row.scope, members_digest: row.members_digest,
        embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest, vector: normalized }),
      vector: normalized };
  });
  return { ...seeds, guides };
}
