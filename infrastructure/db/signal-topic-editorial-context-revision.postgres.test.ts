import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import pg from 'pg';
const file=process.env.NOISIA_EDITORIAL_PG_URL_FILE;
const sql=readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql',import.meta.url),'utf8');
const start=sql.indexOf('CREATE FUNCTION signal_topic_editorial_context_revision_v1');
const end=sql.indexOf('REVOKE ALL ON FUNCTION signal_topic_editorial_context_revision_v1',start);
const helper=sql.slice(start,end).replace('CREATE FUNCTION signal_topic_editorial_context_revision_v1','CREATE FUNCTION pg_temp.editorial_context_revision_fixture').replace('SET search_path=public,extensions,pg_temp','SET search_path=pg_temp,public,extensions');
test('SQL source revision invalidates for every scoped family, insertion/deletion and locale', {skip:!file,timeout:60000},async t=>{
 const pool=new pg.Pool({connectionString:readFileSync(file!,'utf8').trim(),ssl:process.env.NOISIA_EDITORIAL_PG_TLS==='1'?{rejectUnauthorized:false}:undefined,max:1});
 const c=await pool.connect();const id='00000000-0000-4000-8000-000000000001';
 const families:Record<string,string[]>={signal_workspaces:['brand_id'],brands:[],brand_os_profiles:['brand_id'],brand_os_objectives:['brand_os_profile_id'],brand_os_briefs:['brand_os_profile_id'],brand_os_audiences:['brand_os_profile_id'],brand_os_products:['brand_os_profile_id'],brand_os_claims:['brand_os_profile_id'],brand_knowledge_sources:['brand_id'],knowledge_chunks:['knowledge_source_id'],knowledge_assertions:['knowledge_source_id'],competitors:['brand_id','competitor_brand_seed_id'],brand_seeds:[],intelligence_entities:['brand_id'],entity_aliases:['entity_id'],signal_acquisition_plans:['workspace_id'],signal_semantic_context_generations:['workspace_id','artifact_id'],signal_semantic_context_element_versions:['workspace_id'],analysis_artifacts:[]};
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'");
  // Compile the entire actual migration against the actual schema; it remains rolled back.
  await c.query(sql);
  const started=performance.now();const live=(await c.query('SELECT signal_topic_editorial_context_revision_v1($1) revision',['979b8f96-3366-463d-8ee8-8c0cce460a71'])).rows[0].revision;
  assert.match(live,/^sha256:/u);t.diagnostic(`actual scoped fingerprint: ${Math.round(performance.now()-started)} ms`);
  for(const [table,columns]of Object.entries(families))await c.query(`CREATE TEMP TABLE ${table}(id uuid,${columns.map(col=>`${col} uuid,`).join('')}value text,timezone text)`);
  await c.query(helper);
  for(const [table,columns]of Object.entries(families))await c.query(`INSERT INTO pg_temp.${table}(id,${columns.map(col=>`${col},`).join('')}value,timezone) VALUES(${Array(columns.length+1).fill('$1').join(',')},'original','America/Mexico_City')`,[id]);
  const revision=async()=>String((await c.query('SELECT pg_temp.editorial_context_revision_fixture($1) revision',[id])).rows[0].revision);
  const initial=await revision();assert.equal(initial,await revision());
  for(const table of Object.keys(families)){
   await c.query(`UPDATE pg_temp.${table} SET value='changed'`);assert.notEqual(await revision(),initial,table);
   await c.query(`UPDATE pg_temp.${table} SET value='original'`);assert.equal(await revision(),initial,table);
  }
  await c.query("UPDATE pg_temp.signal_workspaces SET timezone='Asia/Tokyo'");assert.notEqual(await revision(),initial);
  await c.query("UPDATE pg_temp.signal_workspaces SET timezone='America/Mexico_City'");
  await c.query('SAVEPOINT deletion');await c.query('DELETE FROM pg_temp.entity_aliases');assert.notEqual(await revision(),initial);await c.query('ROLLBACK TO SAVEPOINT deletion');
  await c.query("INSERT INTO pg_temp.knowledge_assertions(id,knowledge_source_id,value) VALUES(gen_random_uuid(),$1,'new knowledge')",[id]);assert.notEqual(await revision(),initial);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
