import assert from 'node:assert/strict';
import test from 'node:test';
import {cacheSignalTopicEditorialPlanV1 as putPlan,readSignalTopicEditorialPlanCacheV1 as getPlan} from './signal-topic-editorial-plan-cache';
import { readFileSync } from 'node:fs';
import { verifySignalTopicEditorialContextRevisionV1 as verify } from './signal-topic-editorial-context-cache';
import { reserveSignalTopicEditorialCallV1,markSentSignalTopicEditorialCallV1 } from './signal-topic-consolidation-editorial';

test('lease/source digest cache reuses only a fully validated stable revision', async () => {
 const database = {}, key = 'lease:context-digest'; let validations = 0, reads = 0;
 const check = (revision: string | null, final = revision, valid = true, targetKey = key) => verify({ database, key: targetKey, revision,
  validate: async () => { validations++; if (!valid) throw Error('topic_editorial_source_stale'); },
  reread: async () => { reads++; return final; } });
 await check('one'); await check('one'); assert.equal(validations, 1); assert.equal(reads, 1);
 for (const family of ['brand', 'identity', 'category', 'aliases', 'profile', 'objectives', 'briefs', 'audiences', 'products', 'claims', 'knowledge_source', 'knowledge_chunk', 'knowledge_assertion', 'competitor', 'locale', 'generation', 'elements', 'artifact']) {
  await check(family); assert.equal(validations, reads);
 }
 await assert.rejects(check('race', 'changed'), /source_stale/u);
 await assert.rejects(check('bad', 'bad', false), /source_stale/u);
 const before=validations; await check('artifact'); assert.equal(validations,before+1,'failed revalidation invalidates prior success');
 await check('artifact','artifact',true,'different-lease'); assert.equal(validations,before+2);
 await assert.rejects(check(null),/source_stale/u);
});
test('reserve/send revalidate live scoped authority even on cache hit; revocation prevents send', async () => {
 const lease={execution_id:'e',execution_token:'token',workspace_id:'w',actor_user_id:'actor',numeric_run_id:'run',source_execution_id:'source',worker_job_id:'job'};
 const trace:string[]=[];let revoked=false;
 const client={query:async(sql:string,params?:unknown[])=>{
  trace.push(sql);
  if(sql.includes("SELECT source_binding->>'context_digest'")){
   assert.match(sql,/signal_topic_editorial_assert_lease_v1\(id,\$6,false\)/u);
   assert.deepEqual(params,['e','w','actor','run','source','token']);
   return{rows:[{context_digest:'digest',revision:'revision'}]};
  }
  if(sql.includes('SELECT mark_sent_signal_topic_editorial_call_v1')){if(revoked)throw Error('topic_editorial_permission_revoked');return{rows:[{value:true}]};}
  if(sql.includes('reserve_signal_topic_editorial_call_v1'))return{rows:[{value:{call_id:'call',attempt_token:'attempt',status:'reserved',reserved_micro_usd:'1'}}]};
  return{rows:[],rowCount:1};
 },release:()=>undefined};
 const database={connect:async()=>client} as unknown as Parameters<typeof reserveSignalTopicEditorialCallV1>[0]['database'];
 // Prime only the pure cache; actual operations still must pass scoped SQL authority.
 await verify({database,key:JSON.stringify(['e','token','w','actor','run','source','digest']),revision:'revision',validate:async()=>{},reread:async()=>'revision'});
 const identity=JSON.stringify(['e','token','w','actor','run','source']);putPlan(database,identity,'sealed-plan',{verified:true});
 await reserveSignalTopicEditorialCallV1({database,lease,request_digest:'request',provider_available:true});
 revoked=true;
 await assert.rejects(markSentSignalTopicEditorialCallV1({database,lease,call_id:'call',attempt_token:'attempt',provider_available:true}),/permission_revoked/u);
 assert.equal(getPlan(database,identity,'sealed-plan'),null,'observed revocation removes the verified snapshot');
 assert.equal(trace.filter(sql=>sql.includes('SELECT mark_sent_signal')).length,1,'final SQL guard rejects revoked permission before marking sent');
 const migration=readFileSync(new URL('./migrations/0176_signal_topic_consolidation_editorial.sql',import.meta.url),'utf8');
 for(const name of ['reserve_signal_topic_editorial_call_v1','mark_sent_signal_topic_editorial_call_v1']){
  const body=migration.slice(migration.indexOf(`CREATE FUNCTION ${name}`));
  assert.match(body.slice(0,body.indexOf('END;$$;')),/signal_topic_editorial_assert_lease_v1\([^;]+,true\)/u);
 }
 assert.equal(trace.some(sql=>sql.startsWith('SELECT plan,')),false);
 assert.equal(trace.filter(sql=>sql.includes("SELECT source_binding->>'context_digest'")).length,2);
});
test('fingerprint covers every mutable context family and remains private',()=>{
 const sql=readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql',import.meta.url),'utf8');
 const helper=sql.slice(sql.indexOf('CREATE FUNCTION signal_topic_editorial_context_revision_v1'),sql.indexOf('-- Expand every sealed'));
 for(const table of ['signal_workspaces','brands','brand_os_profiles','brand_os_objectives','brand_os_briefs','brand_os_audiences','brand_os_products','brand_os_claims','brand_knowledge_sources','knowledge_chunks','knowledge_assertions','competitors','brand_seeds','intelligence_entities','entity_aliases','signal_acquisition_plans','signal_semantic_context_generations','signal_semantic_context_element_versions','analysis_artifacts'])assert.ok(helper.includes(table),table);
 assert.match(helper,/statement_timestamp\(\) AT TIME ZONE 'UTC'/u);
 assert.match(helper,/REVOKE ALL ON FUNCTION signal_topic_editorial_context_revision_v1\(uuid\) FROM PUBLIC/u);
});
