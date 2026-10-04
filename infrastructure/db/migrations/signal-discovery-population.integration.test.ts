import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { loadSignalDiscoveryPopulationV1 } from "../signal-workspace-discovery-population";

// Run only on the shared private MFP runner; temporary fixtures never alter corpus data.
test("MFP discovery SQL: relevant overrides, strata, reproducibility and chunks", {
 skip: process.env.NOISIA_MFP_DISCOVERY_PG_TEST !== "true"
}, async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL}); const client=await pool.connect();
 try {
  assert.equal((await client.query("SELECT current_database() name")).rows[0].name,"noisia_mfp");
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path=pg_temp,public,extensions");
  await client.query(`CREATE TEMP TABLE signal_corpus_preparation_items(workspace_id uuid,run_id uuid,root_id uuid,asset_sha256 text,chunk_policy_version text,disposition text);
    CREATE TEMP TABLE signal_corpus_text_assets(workspace_id uuid,text_sha256 text,chunk_policy_version text,chunks jsonb);
    CREATE TEMP TABLE signal_mention_facets_current_v1(workspace_id uuid,preparation_run_id uuid,root_id uuid,published_at timestamptz,platform text,relevance text,status text)`);
  assert.equal((await client.query(`SELECT to_regclass('signal_corpus_preparation_items')=
    to_regclass('pg_temp.signal_corpus_preparation_items') isolated`)).rows[0].isolated,true);
  const workspace="10000000-0000-4000-8000-000000000001";
  await client.query(`INSERT INTO signal_corpus_preparation_items SELECT $1::uuid,$1::uuid,
    ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n::text,'v1',CASE WHEN n=8 THEN 'excluded' ELSE 'eligible' END FROM generate_series(1,8)n;
  `,[workspace]);
  await client.query(`INSERT INTO signal_corpus_text_assets SELECT workspace_id,asset_sha256,chunk_policy_version,
    jsonb_build_object('chunks',CASE WHEN asset_sha256='1' THEN '[{},{}]'::jsonb ELSE '[{}]'::jsonb END) FROM signal_corpus_preparation_items`);
  await client.query(`INSERT INTO signal_mention_facets_current_v1 SELECT workspace_id,run_id,root_id,
    CASE WHEN asset_sha256::int%2=0 THEN '2026-10-04'::timestamptz ELSE '2026-10-03'::timestamptz END,
    CASE WHEN asset_sha256::int%2=0 THEN 'forum' ELSE 'news' END,
    CASE WHEN asset_sha256::int<=4 OR asset_sha256='8' THEN 'relevant' WHEN asset_sha256='5' THEN 'unrelated' WHEN asset_sha256='6' THEN 'spam' ELSE 'unknown' END,
    CASE WHEN asset_sha256='1' THEN 'pending' WHEN asset_sha256='2' THEN 'error' WHEN asset_sha256='3' THEN 'abstained' ELSE 'labeled' END
    FROM signal_corpus_preparation_items`);
  const args={queryable:client,workspace_id:workspace,preparation_run_id:workspace};
  const full=await loadSignalDiscoveryPopulationV1(args);
  assert.equal(full.population.root_ids.length,4);assert.equal(full.population.eligible_relevant_roots,4);assert.equal(full.expected_chunks,5);
  const sample=await loadSignalDiscoveryPopulationV1({...args,sample_cap:2,seed:"fixture"});
  assert.equal(sample.population.root_ids.length,2);assert.equal(sample.population.eligible_relevant_roots,4);
  assert.deepEqual(sample,await loadSignalDiscoveryPopulationV1({...args,sample_cap:2,seed:"fixture"}));
  assert.deepEqual(new Set(sample.population.root_ids.map(id=>Number(id.slice(-1))%2)),new Set([0,1]));
 } finally {await client.query("ROLLBACK");client.release();await pool.end();}
});
