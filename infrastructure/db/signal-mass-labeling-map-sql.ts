import { SignalLabelingError } from "./signal-labeling-runs";
import type { PoolClient } from "pg";

const ROOT_BATCH_SIZE = 1000;
const itemColumns = "workspace_id,map_id,root_id,ordinal,input_digest,root_fingerprint,chunk_index,chunk_sha256,text,candidates";
type Client = Pick<PoolClient, "query">;
type Range = { first: string; last: string; count: number };

async function rootRanges(client: Client, total: number) {
  return (await client.query<Range>(`SELECT first.root_id first,last.root_id last,
    (least(start+$2::int-1,$1::int)-start+1)::int count
    FROM generate_series(1,$1::int,$2::int) start
    JOIN mass_map_roots first ON first.ordinal=start
    JOIN mass_map_roots last ON last.ordinal=least(start+$2::int-1,$1::int)
    ORDER BY start`, [total,ROOT_BATCH_SIZE])).rows;
}

/** The caller owns the authorized transaction. Only UUID keys, global ordinals and the unchanged
 * root-vector aggregate are prepared for the whole population. Subsequent distance and packet queries use
 * indexed UUID ranges; no batch rescans the corpus or carries all candidate JSON. */
export async function prepareMassLabelingMapScoresV1(client: Client, mapId: string) {
  await client.query("SET LOCAL enable_hashagg=off");
  // Preserve the original unbounded AVG plan and accumulation traversal. Pushing
  // UUID predicates into that aggregate can change float rounding under
  // cancellation. Only its vector result is frozen; localized JSON stays batched.
  const aggregateStarted = performance.now();
  await client.query(`CREATE TEMP TABLE mass_root_vectors ON COMMIT DROP AS ${MASS_LABELING_MAP_ROOT_VECTORS_SQL_V1} WITH NO DATA`);
  await client.query("ALTER TABLE mass_root_vectors ALTER COLUMN root_vector SET STORAGE PLAIN");
  await client.query(`INSERT INTO mass_root_vectors ${MASS_LABELING_MAP_ROOT_VECTORS_SQL_V1}`);
  await client.query("CREATE UNIQUE INDEX mass_root_vectors_root ON mass_root_vectors(root_id)");
  await client.query("ANALYZE mass_root_vectors");
  const aggregateMs = Math.round(performance.now()-aggregateStarted);
  await client.query(`CREATE TEMP TABLE mass_map_roots ON COMMIT DROP AS
    SELECT root_id,row_number() OVER(ORDER BY root_id)::int ordinal FROM mass_root_vectors`);
  await client.query("CREATE UNIQUE INDEX mass_map_roots_ordinal ON mass_map_roots(ordinal)");
  await client.query("CREATE UNIQUE INDEX mass_map_roots_root ON mass_map_roots(root_id)");
  await client.query(`CREATE TEMP TABLE mass_topic_vectors ON COMMIT DROP AS
    SELECT topic_key,centroid FROM signal_mass_labeling_topics WHERE map_id=$1 WITH NO DATA`, [mapId]);
  await client.query("ALTER TABLE mass_topic_vectors ALTER COLUMN centroid SET STORAGE PLAIN");
  await client.query("INSERT INTO mass_topic_vectors SELECT topic_key,centroid FROM signal_mass_labeling_topics WHERE map_id=$1", [mapId]);
  await client.query("CREATE UNIQUE INDEX mass_topic_vectors_key ON mass_topic_vectors(topic_key)");
  await client.query("ANALYZE mass_topic_vectors");
  await client.query("CREATE TEMP TABLE mass_scores(root_id uuid,topic_key text,similarity float8,position int) ON COMMIT DROP");
  const total = (await client.query<{count:number}>("SELECT count(*)::int count FROM mass_map_roots")).rows[0]!.count;
  const candidates = Math.min(8,(await client.query<{count:number}>("SELECT count(*)::int count FROM mass_topic_vectors")).rows[0]!.count);
  let batches = 0, maximumBatchMs = 0;
  for (const range of await rootRanges(client,total)) {
    const started = performance.now();
    const scored = await client.query(`INSERT INTO mass_scores ${MASS_LABELING_MAP_SCORES_SQL_V1}`, [range.first, range.last]);
    maximumBatchMs = Math.max(maximumBatchMs,performance.now()-started);
    if (scored.rowCount !== range.count*candidates) throw new SignalLabelingError("mass_labeling_map_items_incomplete");
    batches++;
  }
  await client.query("CREATE INDEX mass_scores_root ON mass_scores(root_id,position)");
  // Narrow lookup statistics do not change the order fed to avg(embedding).
  await client.query("ANALYZE mass_scores; ANALYZE mass_map_roots");
  return {root_count: total, batch_count: batches, maximum_batch_ms: Math.round(maximumBatchMs), aggregate_ms:aggregateMs};
}

const MASS_LABELING_MAP_ROOT_VECTORS_SQL_V1 = "SELECT root_id,avg(embedding) root_vector FROM mass_chunks GROUP BY root_id";

export const MASS_LABELING_MAP_SCORES_SQL_V1 = `WITH topic_vectors AS MATERIALIZED (SELECT topic_key,centroid FROM mass_topic_vectors)
  SELECT root.root_id,topic.topic_key,topic.similarity,topic.position
  FROM (SELECT root_id,root_vector FROM mass_root_vectors
    WHERE root_id >= $1::uuid AND root_id <= $2::uuid) root
  CROSS JOIN LATERAL (
    SELECT nearest.topic_key,greatest(-1.0,least(1.0,1-nearest.distance)) similarity,
      row_number() OVER(ORDER BY greatest(-1.0,least(1.0,1-nearest.distance)) DESC,nearest.topic_key)::int position
    FROM (SELECT topic_key,centroid<=>root.root_vector distance FROM topic_vectors
      ORDER BY distance,topic_key LIMIT 8) nearest
  ) topic`;

// Detach the catalog from its one-row table's TOAST reference once per batch.
// Its flat materialized datum stays in InitPlans, outside root/position sorts.
// All CTEs that touch the corpus are explicitly bounded by the same UUID range.
export const MASS_LABELING_MAP_ITEM_INPUT_SQL_V1 = `WITH candidate_catalog AS MATERIALIZED (SELECT payloads || '{}'::jsonb payloads FROM mass_candidate_catalog), best_chunk AS MATERIALIZED (
    SELECT DISTINCT ON(chunk.root_id) chunk.root_id,chunk.chunk_index
    FROM mass_batch_chunks chunk JOIN mass_scores score ON score.root_id=chunk.root_id
      AND score.root_id >= $4::uuid AND score.root_id <= $5::uuid
    JOIN mass_topic_vectors topic ON topic.topic_key=score.topic_key
    ORDER BY chunk.root_id,chunk.embedding<=>topic.centroid,chunk.chunk_index,topic.topic_key
  ), candidates AS (
    SELECT root_id,jsonb_agg(((SELECT payloads FROM candidate_catalog)->ranked.topic_key)
      ||jsonb_build_object('similarity',similarity) ORDER BY position) candidate_list
    FROM mass_scores ranked WHERE root_id >= $4::uuid AND root_id <= $5::uuid
      AND (SELECT payloads FROM candidate_catalog) ? ranked.topic_key GROUP BY root_id
  ) SELECT $1::uuid workspace_id,$2::uuid map_id,chunk.root_id,roots.ordinal,
    signal_labeling_digest_v1(jsonb_build_object('root_fingerprint',chunk.fingerprint,'chunk_sha256',chunk.chunk_sha256,
      'map_digest',$3::text)) input_digest,chunk.fingerprint root_fingerprint,chunk.chunk_index,chunk.chunk_sha256,
    signal_topic_utf16_fragment_v1(chunk.full_text,chunk.start_offset,chunk.end_offset) text,candidates.candidate_list candidates
  FROM best_chunk best JOIN mass_batch_chunks chunk USING(root_id,chunk_index) JOIN candidates USING(root_id)
  JOIN mass_map_roots roots USING(root_id)
  WHERE roots.root_id >= $4::uuid AND roots.root_id <= $5::uuid ORDER BY roots.ordinal`;

export const MASS_LABELING_MAP_BATCH_CHUNKS_SQL_V1 = `SELECT * FROM mass_chunks
  WHERE root_id >= $1::uuid AND root_id <= $2::uuid ORDER BY root_id,chunk_index`;

/** Assemble and INSERT one packet batch, with all existing guards/projections,
 * in the caller's single transaction. Cache the exact PostgreSQL character sum
 * from inserted rows, avoiding a later read/serialization of the entire map. */
export async function insertMassLabelingMapItemsV1(client: Client, args: {
  workspace_id: string; map_id: string; catalog: unknown; map_digest: string; expected_roots: number;
}) {
  const prepared = (await client.query<{count:number;last:number}>("SELECT count(*)::int count,COALESCE(max(ordinal),0)::int last FROM mass_map_roots")).rows[0]!;
  if (prepared.count !== args.expected_roots || prepared.last !== args.expected_roots)
    throw new SignalLabelingError("mass_labeling_map_items_incomplete");
  await client.query(`CREATE TEMP TABLE mass_candidate_catalog ON COMMIT DROP AS SELECT jsonb_object_agg(catalog->>'topic_key',
    jsonb_build_object('topic_key',catalog->>'topic_key',
      'name',COALESCE(catalog#>>'{localization,original,name}',catalog->>'name'),
      'definition',COALESCE(catalog#>>'{localization,original,definition}',catalog->>'definition'),
      'localization',catalog->'localization')) payloads FROM jsonb_array_elements($1::jsonb) catalog`,
    [JSON.stringify(args.catalog)]);
  // Detoast each chunk vector once per batch, rather than once for each of its
  // eight distance comparisons. The temporary payload is bounded by root keys.
  await client.query("CREATE TEMP TABLE mass_batch_chunks (LIKE mass_chunks) ON COMMIT DROP");
  await client.query("ALTER TABLE mass_batch_chunks ALTER COLUMN embedding SET STORAGE PLAIN");
  await client.query("CREATE UNIQUE INDEX mass_batch_chunks_root ON mass_batch_chunks(root_id,chunk_index)");
  let inserted = 0, batches = 0, maximumBatchMs = 0, maximumPrepareMs = 0, inputCharacters = 0n;
  for (const range of await rootRanges(client,prepared.last)) {
    const prepareStarted = performance.now();
    await client.query("TRUNCATE mass_batch_chunks");
    await client.query(`INSERT INTO mass_batch_chunks ${MASS_LABELING_MAP_BATCH_CHUNKS_SQL_V1}`, [range.first,range.last]);
    await client.query("ANALYZE mass_batch_chunks");
    maximumPrepareMs = Math.max(maximumPrepareMs,performance.now()-prepareStarted);
    const started = performance.now();
    const result = (await client.query<{count:number;characters:string}>(`WITH written AS (
      INSERT INTO signal_mass_labeling_items(${itemColumns}) ${MASS_LABELING_MAP_ITEM_INPUT_SQL_V1}
      RETURNING length(text)::bigint+length(candidates::text) characters
    ) SELECT count(*)::int count,COALESCE(sum(characters),0)::text characters FROM written`,
      [args.workspace_id,args.map_id,args.map_digest,range.first,range.last])).rows[0]!;
    maximumBatchMs = Math.max(maximumBatchMs,performance.now()-started);
    if (result.count !== range.count) throw new SignalLabelingError("mass_labeling_map_items_incomplete");
    inserted += result.count; batches++; inputCharacters += BigInt(result.characters);
  }
  await client.query(`INSERT INTO signal_mass_labeling_product_estimates(workspace_id,map_id,root_count,input_characters)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [args.workspace_id,args.map_id,inserted,inputCharacters.toString()]);
  return {root_count: inserted, batch_count: batches, maximum_batch_ms: Math.round(maximumBatchMs),
    maximum_prepare_ms: Math.round(maximumPrepareMs), input_characters: inputCharacters.toString()};
}
