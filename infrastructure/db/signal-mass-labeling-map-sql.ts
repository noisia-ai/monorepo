import { SignalLabelingError } from "./signal-labeling-runs";
import type { PoolClient } from "pg";

/** The caller owns the authorized map-adoption transaction. Copy the exact
 * centroids inline once: rescanning external TOAST references per root makes a
 * small topic catalog disproportionately expensive at corpus scale. */
export async function prepareMassLabelingMapScoresV1(client: Pick<PoolClient, "query">, mapId: string) {
  await client.query(`CREATE TEMP TABLE mass_topic_vectors ON COMMIT DROP AS
    SELECT topic_key,centroid FROM signal_mass_labeling_topics WHERE map_id=$1 WITH NO DATA`, [mapId]);
  await client.query("ALTER TABLE mass_topic_vectors ALTER COLUMN centroid SET STORAGE PLAIN");
  await client.query("INSERT INTO mass_topic_vectors SELECT topic_key,centroid FROM signal_mass_labeling_topics WHERE map_id=$1", [mapId]);
  await client.query("ANALYZE mass_topic_vectors");
  await client.query("SET LOCAL enable_hashagg=off");
  await client.query(MASS_LABELING_MAP_SCORES_SQL_V1);
  await client.query("CREATE INDEX mass_scores_root ON mass_scores(root_id)");
}

export const MASS_LABELING_MAP_SCORES_SQL_V1 = `CREATE TEMP TABLE mass_scores ON COMMIT DROP AS
  WITH topic_vectors AS MATERIALIZED (SELECT topic_key,centroid FROM mass_topic_vectors)
  SELECT root.root_id,topic.topic_key,topic.similarity,topic.position
  FROM (SELECT root_id,avg(embedding) root_vector FROM mass_chunks GROUP BY root_id) root
  CROSS JOIN LATERAL (
    SELECT nearest.topic_key,greatest(-1.0,least(1.0,1-nearest.distance)) similarity,
      row_number() OVER(ORDER BY greatest(-1.0,least(1.0,1-nearest.distance)) DESC,nearest.topic_key)::int position
    FROM (SELECT topic_key,centroid<=>root.root_vector distance FROM topic_vectors
      ORDER BY distance,topic_key LIMIT 8) nearest
  ) topic`;

// Keep catalog payloads in InitPlan parameters, outside the root/position sort.
// Carrying the multilingual JSONB on every score turns it into a gigabyte sort.
export const MASS_LABELING_MAP_ITEM_INPUT_SQL_V1 = `CREATE TEMP TABLE mass_map_items ON COMMIT DROP AS
  WITH candidate_catalog AS MATERIALIZED (
    SELECT jsonb_object_agg(catalog->>'topic_key',jsonb_build_object('topic_key',catalog->>'topic_key',
      'name',COALESCE(catalog#>>'{localization,original,name}',catalog->>'name'),
      'definition',COALESCE(catalog#>>'{localization,original,definition}',catalog->>'definition'),
      'localization',catalog->'localization')) payloads
    FROM jsonb_array_elements($3::jsonb) catalog
  ), best_chunk AS MATERIALIZED (
    SELECT DISTINCT ON(chunk.root_id) chunk.root_id,chunk.chunk_index
    FROM mass_chunks chunk JOIN mass_scores score ON score.root_id=chunk.root_id
    JOIN mass_topic_vectors topic ON topic.topic_key=score.topic_key
    ORDER BY chunk.root_id,chunk.embedding<=>topic.centroid,chunk.chunk_index,topic.topic_key
  ), candidates AS (
    SELECT root_id,jsonb_agg(((SELECT payloads FROM candidate_catalog)->ranked.topic_key)
      ||jsonb_build_object('similarity',similarity) ORDER BY position) candidate_list
    FROM mass_scores ranked WHERE (SELECT payloads FROM candidate_catalog) ? ranked.topic_key GROUP BY root_id
  ) SELECT $1::uuid workspace_id,$2::uuid map_id,chunk.root_id,row_number() OVER(ORDER BY chunk.root_id)::int ordinal,
    signal_labeling_digest_v1(jsonb_build_object('root_fingerprint',chunk.fingerprint,'chunk_sha256',chunk.chunk_sha256,
      'map_digest',$4::text)) input_digest,chunk.fingerprint root_fingerprint,chunk.chunk_index,chunk.chunk_sha256,
    signal_topic_utf16_fragment_v1(chunk.full_text,chunk.start_offset,chunk.end_offset) text,candidates.candidate_list candidates
  FROM best_chunk best JOIN mass_chunks chunk USING(root_id,chunk_index) JOIN candidates USING(root_id)`;


const ITEM_BATCH_SIZE = 1000;
const itemColumns = "workspace_id,map_id,root_id,ordinal,input_digest,root_fingerprint,chunk_index,chunk_sha256,text,candidates";

/** Compute the global ordinal and candidate packet once, then keep each guarded
 * INSERT bounded. All batches remain in the caller's single transaction: a
 * failure rolls back the map, prior batches and every derived projection. */
export async function insertMassLabelingMapItemsV1(client: Pick<PoolClient, "query">, args: {
  workspace_id: string; map_id: string; catalog: unknown; map_digest: string; expected_roots: number;
}) {
  await client.query(MASS_LABELING_MAP_ITEM_INPUT_SQL_V1,
    [args.workspace_id, args.map_id, JSON.stringify(args.catalog), args.map_digest]);
  await client.query("CREATE UNIQUE INDEX mass_map_items_ordinal ON mass_map_items(ordinal)");
  const prepared = (await client.query<{count:number;last:number}>("SELECT count(*)::int count,COALESCE(max(ordinal),0)::int last FROM mass_map_items")).rows[0]!;
  if (prepared.count !== args.expected_roots || prepared.last !== args.expected_roots)
    throw new SignalLabelingError("mass_labeling_map_items_incomplete");
  let inserted = 0, batches = 0, maximumBatchMs = 0;
  for (let after = 0; after < prepared.last; after += ITEM_BATCH_SIZE) {
    const started = performance.now();
    const result = await client.query(`INSERT INTO signal_mass_labeling_items(${itemColumns})
      SELECT ${itemColumns} FROM mass_map_items WHERE ordinal>$1 AND ordinal<=$2 ORDER BY ordinal`,
    [after, Math.min(after+ITEM_BATCH_SIZE, prepared.last)]);
    maximumBatchMs = Math.max(maximumBatchMs, performance.now()-started);
    if (result.rowCount !== Math.min(ITEM_BATCH_SIZE, prepared.last-after))
      throw new SignalLabelingError("mass_labeling_map_items_incomplete");
    inserted += result.rowCount; batches++;
  }
  return { root_count: inserted, batch_count: batches, maximum_batch_ms: Math.round(maximumBatchMs) };
}
