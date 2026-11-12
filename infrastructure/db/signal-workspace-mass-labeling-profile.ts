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
    ), eligible_assets AS MATERIALIZED (
      -- Roots can share an immutable text asset. Expand and decode it once,
      -- before any 1024-dimensional vectors enter a sort or materialized CTE.
      SELECT DISTINCT item.asset_sha256,item.chunk_policy_version
      FROM embedded JOIN signal_corpus_preparation_items item ON item.run_id=embedded.preparation_run_id
        AND item.workspace_id=$1::uuid AND item.disposition='eligible'
    ), asset_offsets AS MATERIALIZED (
      -- Each supplementary code point adds one extra UTF-16 unit. Compute
      -- its end position once per asset, rather than rescanning the complete
      -- text and counting characters again for every fragment.
      SELECT item.asset_sha256,item.chunk_policy_version,char_length(asset.full_text) character_count,
        ARRAY(SELECT (sum(char_length(piece)) OVER (ORDER BY ordinal)+2*ordinal)::int
          FROM unnest(parts.pieces) WITH ORDINALITY segment(piece,ordinal)
          WHERE ordinal<cardinality(parts.pieces) ORDER BY ordinal) astral_ends
      FROM eligible_assets item
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=$1::uuid
        AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      CROSS JOIN LATERAL (SELECT regexp_split_to_array(asset.full_text,U&'[\\+010000-\\+10FFFF]') pieces OFFSET 0) parts
    ), fragments AS MATERIALIZED (
      SELECT DISTINCT chunk.value->>'sha256' chunk_sha256,
        CASE WHEN bounds.start0>=0 AND bounds.end0>=bounds.start0 AND bounds.end0::bigint-bounds.start0<=1400
          AND bounds.end0::bigint<=offsets.character_count::bigint+cardinality(offsets.astral_ends)
          AND array_position(offsets.astral_ends,bounds.start0::bigint+1) IS NULL
          AND array_position(offsets.astral_ends,bounds.end0::bigint+1) IS NULL
          THEN substring(asset.full_text FROM bounds.start0-width_bucket(bounds.start0,offsets.astral_ends)+1
            FOR bounds.end0-width_bucket(bounds.end0,offsets.astral_ends)
              -(bounds.start0-width_bucket(bounds.start0,offsets.astral_ends)))
          ELSE signal_topic_utf16_fragment_v1(asset.full_text,(chunk.value->>'start')::int,(chunk.value->>'end')::int)
        END text
      FROM asset_offsets offsets
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=$1::uuid
        AND asset.text_sha256=offsets.asset_sha256 AND asset.chunk_policy_version=offsets.chunk_policy_version
      CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') chunk(value)
      CROSS JOIN LATERAL (SELECT (chunk.value->>'start')::int start0,(chunk.value->>'end')::int end0) bounds
    ), matched AS MATERIALIZED (
      SELECT seed.scope,fragment.chunk_sha256,fragment.text
      FROM jsonb_to_recordset($3::jsonb) seed(scope text,names text[]) CROSS JOIN fragments fragment
      WHERE EXISTS(SELECT 1 FROM unnest(seed.names) name WHERE length(name)>=3
        AND strpos(lower(fragment.text),lower(name))>0)
    ) SELECT matched.scope,avg(cache.embedding ORDER BY matched.chunk_sha256,matched.text)::text vector,
      'sha256:'||encode(sha256(convert_to(string_agg(matched.chunk_sha256,'' ORDER BY matched.chunk_sha256),'UTF8')),'hex') members_digest
      FROM matched
      -- matched is already narrow and filtered. Keep the vector lookup after
      -- that boundary even when a new workspace has stale cache statistics.
      JOIN LATERAL (SELECT embedding FROM signal_workspace_chunk_embeddings cache
        WHERE cache.workspace_id=$1::uuid AND cache.config_digest=$2 AND cache.chunk_sha256=matched.chunk_sha256
        OFFSET 0) cache ON true
      GROUP BY matched.scope ORDER BY matched.scope`,
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
