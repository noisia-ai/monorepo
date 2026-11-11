import assert from "node:assert/strict";

/** Invented PostgreSQL inputs and the former exact SQL as a parity oracle. */
export const mapParitySetupSqlV1 = `CREATE TEMP TABLE mass_chunks AS
 SELECT md5('root'||r)::uuid root_id,'sha256:'||md5('finger'||r)||md5('finger2'||r) fingerprint,
 '😀ABC🧪DEF漢é synthetic fragment for parity' full_text,c chunk_index,md5('chunk'||r||':'||c) chunk_sha256,
 CASE c WHEN 0 THEN 0 WHEN 1 THEN 2 WHEN 2 THEN 7 ELSE 10 END start_offset,
 CASE c WHEN 0 THEN 7 WHEN 1 THEN 10 WHEN 2 THEN 12 ELSE 16 END end_offset,
 (SELECT array_agg(CASE WHEN r=1 THEN 0 WHEN r=2 THEN -1 WHEN r=3 THEN 1 ELSE (sin((r*17+c*13+d*7)::float8)/10)::real END ORDER BY d)::vector
 FROM generate_series(1,1024) d) embedding
 FROM generate_series(1,32) r CROSS JOIN LATERAL generate_series(0,r%4) c;
CREATE UNIQUE INDEX ON mass_chunks(root_id,chunk_index);
CREATE TEMP TABLE topics(topic_key text PRIMARY KEY,centroid vector(1024));
INSERT INTO topics SELECT 'topic_'||lpad(t::text,3,'0'),
 (SELECT array_agg(CASE WHEN t IN(1,2) THEN 1 WHEN t=3 THEN -1 WHEN t=4 THEN 0 ELSE (sin((t*11+d*3)::float8)/10)::real END ORDER BY d)::vector
 FROM generate_series(1,1024) d) FROM generate_series(1,111) t;
CREATE TEMP TABLE catalog AS SELECT jsonb_agg(jsonb_build_object('topic_key',topic_key,'name',topic_key||' en',
 'definition',repeat('Synthetic definition. ',50),'localization',CASE WHEN right(topic_key,1)='0' THEN NULL ELSE
 jsonb_build_object('original_language','pt','original',jsonb_build_object('name',topic_key||' origem','definition',repeat('Descrição sintética 😀 ',45)),
 'en',jsonb_build_object('name',topic_key||' en','definition',repeat('English synthetic. ',50)),
 'es',jsonb_build_object('name',topic_key||' es','definition',repeat('Descripción sintética. ',50))) END) ORDER BY topic_key) body FROM topics;
`;
export const mapOriginalScoresSqlV1 = `CREATE TEMP TABLE scores_old AS
 SELECT root.root_id,topic.topic_key,topic.similarity,topic.position FROM
 (SELECT root_id,avg(embedding) root_vector FROM mass_chunks GROUP BY root_id) root CROSS JOIN LATERAL (
 SELECT ranked.topic_key,ranked.similarity,row_number() OVER(ORDER BY ranked.similarity DESC,ranked.topic_key)::int position
 FROM (SELECT topic_key,greatest(-1.0,least(1.0,1-(centroid<=>root.root_vector))) similarity FROM topics
 ORDER BY centroid<=>root.root_vector,topic_key LIMIT 8) ranked) topic;
`;
export const mapOriginalItemsSqlV1 = `INSERT INTO items_original(workspace_id,map_id,root_id,ordinal,input_digest,root_fingerprint,chunk_index,chunk_sha256,text,candidates) WITH best_chunk AS MATERIALIZED(SELECT DISTINCT ON(chunk.root_id) chunk.root_id,chunk.chunk_index
 FROM mass_chunks chunk JOIN scores_old score ON score.root_id=chunk.root_id JOIN topics topic ON topic.topic_key=score.topic_key
 ORDER BY chunk.root_id,chunk.embedding<=>topic.centroid,chunk.chunk_index,topic.topic_key),candidates AS(SELECT root_id,jsonb_agg(jsonb_build_object('topic_key',ranked.topic_key,
 'name',COALESCE(cat#>>'{localization,original,name}',cat->>'name'),
 'definition',COALESCE(cat#>>'{localization,original,definition}',cat->>'definition'),'similarity',similarity,
 'localization',cat->'localization') ORDER BY position) candidate_list
 FROM scores_old ranked CROSS JOIN LATERAL jsonb_array_elements($3::jsonb) cat
 WHERE cat->>'topic_key'=ranked.topic_key GROUP BY root_id)
 SELECT $1::uuid,$2::uuid,chunk.root_id,row_number() OVER(ORDER BY chunk.root_id)::int ordinal,
 signal_labeling_digest_v1(jsonb_build_object('root_fingerprint',chunk.fingerprint,'chunk_sha256',chunk.chunk_sha256,'map_digest',$4::text)) input_digest,
 chunk.fingerprint,chunk.chunk_index,chunk.chunk_sha256,signal_topic_utf16_fragment_v1(chunk.full_text,chunk.start_offset,chunk.end_offset) text,
 candidates.candidate_list FROM best_chunk best JOIN mass_chunks chunk USING(root_id,chunk_index) JOIN candidates USING(root_id);
`;

/** Own the physical connection before building any nested fixture. A Node test
 * deadline alone does not cancel PostgreSQL or close its transaction. */
export async function withMapAdoptionPostgresFixtureV1<T>(
  signal: AbortSignal,
  work: (fixture: import("./signal-client-workspace-entry.synthetic.fixture").SyntheticTransactionV1) => Promise<T>,
): Promise<T> {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.NOISIA_MFP_PG_CI, "true");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(target.search, ""); assert.equal(target.hash, "");
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const pool: import("pg").Pool = await openDatabase();
  let client: import("pg").PoolClient | undefined;
  let released = false, sequence = 0;
  const stack: string[] = [];
  const abort = () => { if (client && !released) { released = true; client.release(true); } };
  signal.addEventListener("abort", abort, { once: true });
  try {
    client = await pool.connect();
    const physical = client;
    if (signal.aborted) { abort(); throw new Error("synthetic_map_test_aborted"); }
    await physical.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await physical.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='5s'; SET LOCAL client_connection_check_interval='100ms'");
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("BEGIN")) {
        const key = `map_fixture_${++sequence}`; stack.push(key);
        await physical.query(`SAVEPOINT ${key}`);
        const separator = sql.indexOf(";"), remainder = separator < 0 ? "" : sql.slice(separator + 1).trim();
        return remainder ? physical.query(remainder, values) : { rows: [], rowCount: null };
      }
      if (sql === "COMMIT") return physical.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") {
        const key = stack.pop()!; await physical.query(`ROLLBACK TO SAVEPOINT ${key}`);
        return physical.query(`RELEASE SAVEPOINT ${key}`);
      }
      return physical.query(sql, values);
    };
    const scoped = Object.assign(Object.create(physical), { query, release() {} }) as import("pg").PoolClient;
    const database = Object.assign(Object.create(pool), { query, connect: async () => scoped }) as import("pg").Pool;
    return await work({ database, scoped, query: query as never, cleanup: async () => {} });
  } finally {
    try {
      if (client && !released) {
        try { await client.query("ROLLBACK"); }
        finally { if (!released) { released = true; client.release(); } }
      }
    } finally { signal.removeEventListener("abort", abort); await pool.end(); }
  }
}
