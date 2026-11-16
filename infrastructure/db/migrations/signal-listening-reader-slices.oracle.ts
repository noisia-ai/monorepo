import type {LabelingDatabaseV1} from '../signal-mention-facets';
import type {PoolClient,QueryResult} from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Frozen pre-0325 SELECTs; only the population name is rebound to its old
// private function. Importing this module never registers tests or opens PG.
const unansweredScope=`p.candidate AND p.scope_state='included' AND p.answer IS NULL
 AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)`;
const pendingScope=`${unansweredScope} AND NOT EXISTS(SELECT 1 FROM signal_listening_call_questions sent
 WHERE sent.run_id=$5 AND sent.workspace_id=$1 AND sent.root_id=p.root_id AND sent.question_digest=p.question_digest)`;

export function oldListeningMetadataSqlV1(){return `/* labeling_listening_input_metadata_v1 */ WITH pending AS MATERIALIZED(
   SELECT p.root_id,p.question_key,octet_length(p.body)::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,
    (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,
    octet_length(COALESCE(p.platform,''))::bigint platform_bytes,row_number() OVER(PARTITION BY p.root_id ORDER BY p.question_key) n
   FROM pg_temp.r16_reader_population_before_0325($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE ${pendingScope})
   SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes
   FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6`;}
export function oldListeningHydrateSqlV1(bounded:boolean){const hydratePopulation=bounded?`pg_temp.r16_reader_population_before_0325($1::uuid,$2::uuid,$3::uuid,$4::text,$7::uuid[],'llm-processing')`:`pg_temp.r16_reader_population_before_0325($1::uuid,$2::uuid,$3::uuid,$4::text,NULL::uuid[],'llm-processing')`;return `WITH pending AS MATERIALIZED(
  SELECT p.*,row_number() OVER(PARTITION BY root_id ORDER BY question_key) n FROM ${hydratePopulation} p
  WHERE ${pendingScope})
  SELECT root_id,input_digest,body,published_at,platform,array_agg(question_key ORDER BY question_key) question_keys,
   jsonb_object_agg(question_key,question_digest) question_digests,
   COALESCE(jsonb_object_agg(question_key,scope_basis) FILTER(WHERE scope_basis IS NOT NULL),'{}'::jsonb) scope_basis
  FROM pending WHERE n<=256 GROUP BY root_id,input_digest,body,published_at,platform ORDER BY root_id LIMIT $6`;}
async function install(c:PoolClient){
 // Called before the store begins its RR READ ONLY transaction. Never install
 // functions from inside a reader or replace the live public implementation.
 const found=(await c.query("SELECT to_regprocedure('pg_temp.r16_reader_population_before_0325(uuid,uuid,uuid,text,uuid[],text)') present")).rows[0].present;
 if(!found){
  await c.query('CREATE TEMP TABLE IF NOT EXISTS r16_reader_slice_probe(probe boolean)');
  const source=await readFile(new URL('./0321_signal_listening_bounded_custom_plan.sql',import.meta.url),'utf8');
  await c.query(source.slice(source.indexOf('CREATE OR REPLACE FUNCTION')).replace(
   'CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(',
   'CREATE OR REPLACE FUNCTION pg_temp.r16_reader_population_before_0325('));
 }
}
async function compare(c:PoolClient,sql:string,params:unknown[]|undefined,result:QueryResult){
 const metadata=sql.startsWith('/* labeling_listening_input_metadata_v1 */'),hydrate=sql.startsWith('/* labeling_listening_inputs_v1 */');
 if(!metadata&&!hydrate)return;
 assert.ok(params);const previous=metadata?oldListeningMetadataSqlV1():oldListeningHydrateSqlV1(params.length===7);
 const before=await c.query(previous,params);assert.deepEqual(result.rows,before.rows,'reader fields, byte prefixes and root/question order match frozen pre-0325 SQL');
 // Keep timestamp serialization in PostgreSQL; node-pg Date truncates micros.
 const json=(text:string)=>`SELECT to_jsonb(r) value FROM (${text}) r`;
 const oldJson=await c.query(json(previous),params),newJson=await c.query(json(sql),params);
 assert.deepEqual(newJson.rows,oldJson.rows,'metadata/hydrate SQL retains exact timestamp precision and all values');
}
export function withListeningReaderSliceOracleV1(database:LabelingDatabaseV1,counters={unbounded:0}):LabelingDatabaseV1{
 return {query:async(sql:string,params?:unknown[])=>{
  if(typeof sql!=='string'||!sql.startsWith('/* labeling_listening_inputs_v1 */'))return database.query(sql,params);
  // The unbounded adapter uses pool.query, not connect. Give only this marked
  // SELECT an owned client/snapshot for comparison; production is unchanged.
  assert.equal(params?.length,6);const c=await database.connect();let inTx=false;
  try{
   await install(c); // CREATE FUNCTION must precede the read-only transaction.
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');inTx=true;
   const mode=(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
   assert.deepEqual(mode,{isolation:'repeatable read',readonly:'on'});
   const result=await c.query(sql,params);await compare(c,sql,params,result);
   await c.query('COMMIT');inTx=false;counters.unbounded++;return result;
  }catch(error){if(inTx)await c.query('ROLLBACK').catch(()=>{});throw error;}
  finally{c.release();}
 },connect:async()=>{
  const c=await database.connect();try{await install(c);}catch(error){c.release();throw error;}
  return new Proxy(c,{get(target,key){
   if(key==='query')return async(sql:string,params?:unknown[])=>{
    const result:QueryResult=await target.query(sql,params);if(typeof sql==='string')await compare(target,sql,params,result);return result;
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
 }} as LabelingDatabaseV1;
}
