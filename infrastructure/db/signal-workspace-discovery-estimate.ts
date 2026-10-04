import type { PoolClient } from "pg";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,
  SIGNAL_WORKSPACE_INTERPRETATION_LIMITS_V1, signalWorkspaceInterpretationCostV1 } from "@noisia/query-engine";

/** Planning heuristic, never a bound, reservation or permission. Clusters, output
 * length, batch splitting and repairs are unknown until discovery/interpretation.
 * Uses the existing synchronous Sonnet tariff; no batch discount is assumed. */
export function estimateSignalDiscoveryInterpretationV1(population: { roots: number; chunks: number; text_bytes: number }) {
  if (!Object.values(population).every(value => Number.isSafeInteger(value) && value >= 0))
    throw new Error("workspace_discovery_estimate_population_invalid");
  const groups = population.chunks === 0 ? 0 : Math.ceil(population.chunks / SIGNAL_WORKSPACE_ENGINE_CONFIG_V1.hdbscan_min_cluster_size);
  const batches = Math.ceil(groups / SIGNAL_WORKSPACE_INTERPRETATION_LIMITS_V1.batch_clusters);
  const averageExcerptBytes = population.chunks === 0 ? 0 : Math.min(5600, Math.ceil(population.text_bytes / population.chunks));
  const inputTokens = Math.ceil((batches * 16_000 + groups * (1536 + SIGNAL_WORKSPACE_INTERPRETATION_LIMITS_V1.representatives * averageExcerptBytes)) / 3);
  const outputTokens = groups * 1024;
  return { method: "population-text-heuristic-v1" as const, estimated_micro_usd: signalWorkspaceInterpretationCostV1({
    input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    roots: population.roots, chunks: population.chunks, text_bytes: population.text_bytes, assumed_groups: groups,
    assumed_input_tokens: inputTokens, assumed_output_tokens: outputTokens,
    pricing_version: SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1.pricing_version };
}

/** Same eligible/current relevant population as the default (uncapped) discovery.
 * Aggregate only: no text or root identifiers leave the database. */
export async function loadSignalDiscoveryEstimateV1(args: { queryable: Pick<PoolClient,"query">; workspace_id: string; preparation_run_id: string }) {
  const row=(await args.queryable.query<{roots:string;chunks:string;text_bytes:string}>(`SELECT count(*)::text roots,
    COALESCE(sum(jsonb_array_length(asset.chunks->'chunks')),0)::text chunks,
    COALESCE(sum(octet_length(asset.full_text)),0)::text text_bytes
    FROM signal_corpus_preparation_items item
    JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256
      AND asset.chunk_policy_version=item.chunk_policy_version
    JOIN signal_mention_facets_current_v1 facet ON facet.workspace_id=item.workspace_id
      AND facet.preparation_run_id=item.run_id AND facet.root_id=item.root_id
    WHERE item.workspace_id=$1::uuid AND item.run_id=$2::uuid AND item.disposition='eligible' AND facet.relevance='relevant'`,
  [args.workspace_id,args.preparation_run_id])).rows[0]!;
  return estimateSignalDiscoveryInterpretationV1({roots:Number(row.roots),chunks:Number(row.chunks),text_bytes:Number(row.text_bytes)});
}
