import type { PoolClient } from "pg";

export type SignalDiscoveryPopulationV1 = {
  root_ids: string[];
  eligible_relevant_roots: number;
  sample_cap: number | null;
  seed: string;
  stratification: "utc_day_platform";
};

export function discoverySamplingOptionsV1(cap?: number | null, seed?: string) {
  if (cap != null && (!Number.isSafeInteger(cap) || cap < 1)
    || seed !== undefined && (typeof seed !== "string" || seed.length < 1 || seed.length > 120))
    throw new Error("workspace_engine_discovery_sample_invalid");
  return { sample_cap: cap ?? null, seed: seed ?? "discovery-v1" };
}

/** One population feeds counts, cache validation and the immutable execution snapshot.
 * Round-robin UTC-day/platform strata give each stratum a turn; a recorded seed orders
 * roots within each stratum. Sampling proposes concepts, never corpus membership.
 */
export async function loadSignalDiscoveryPopulationV1(args: {
  queryable: Pick<PoolClient, "query">; workspace_id: string; preparation_run_id: string;
  sample_cap?: number | null; seed?: string;
}): Promise<{ population: SignalDiscoveryPopulationV1; expected_chunks: number }> {
  const options = discoverySamplingOptionsV1(args.sample_cap, args.seed);
  const result = (await args.queryable.query<{ root_ids: string[]; total: string; chunks: string }>(`
    WITH relevant AS MATERIALIZED (
      SELECT item.root_id,jsonb_array_length(asset.chunks->'chunks') chunk_count,
        (facet.published_at AT TIME ZONE 'UTC')::date day,COALESCE(facet.platform,'') platform
      FROM signal_corpus_preparation_items item
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
        AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      JOIN signal_mention_facets_current_v1 facet ON facet.workspace_id=item.workspace_id
        AND facet.preparation_run_id=item.run_id AND facet.root_id=item.root_id
      WHERE item.workspace_id=$1::uuid AND item.run_id=$2::uuid
        AND item.disposition='eligible' AND facet.relevance='relevant'
    ), ranked AS (
      SELECT *,row_number() OVER (PARTITION BY day,platform ORDER BY md5($4||root_id::text),root_id) stratum_rank
      FROM relevant
    ), selected AS (
      SELECT * FROM ranked ORDER BY stratum_rank,md5($4||COALESCE(day::text,'')||platform),root_id LIMIT $3
    ) SELECT COALESCE(array_agg(root_id ORDER BY root_id),'{}'::uuid[]) root_ids,
      (SELECT count(*)::text FROM relevant) total,COALESCE(sum(chunk_count),0)::text chunks FROM selected`,
  [args.workspace_id,args.preparation_run_id,options.sample_cap,options.seed])).rows[0]!;
  return { population: { root_ids: result.root_ids, eligible_relevant_roots: Number(result.total), ...options,
    stratification: "utc_day_platform" }, expected_chunks: Number(result.chunks) };
}
