import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import * as human from '../signal-listening-human-edits';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
const enabled=process.env.NOISIA_R16_LISTENING_BOUNDED_CUSTOM_PLAN_PG==='true';
async function references(c:PoolClient){
 await c.query('CREATE TEMP TABLE r16_bounded_custom_plan_probe(probe boolean) ON COMMIT DROP');
 const raw=(await readFile(new URL('./0317_signal_listening_bounded_provenance_plan.sql',import.meta.url),'utf8'))
  .replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(','CREATE FUNCTION pg_temp.r16_population_before_0321(');
 await c.query(raw);
 const source=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(');
 assert.ok(start>=0);const end=source.indexOf('$$;',source.indexOf('AS $$',start))+3;
 await c.query(source.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',
  'CREATE FUNCTION pg_temp.r16_effective_before_0321(').replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',
   'pg_temp.r16_population_before_0321(w,cid,mid,ctx,roots,purpose)'));
}
async function equal(c:PoolClient,scope:unknown[],roots:Array<string|null>|null=null,purpose='client-derived-metrics',effective=false){
 // Keep timestamptz JSON serialization inside PostgreSQL: Date parsing loses microseconds.
 const params=[...scope,roots,purpose];const read=(fn:string)=>c.query(`SELECT to_jsonb(p) value FROM ${fn}($1,$2,$3,$4,$5::uuid[],$6) p ORDER BY root_id,question_key`,params);
 const before=(await read(effective?'pg_temp.r16_effective_before_0321':'pg_temp.r16_population_before_0321')).rows.map(r=>r.value);
 const after=(await read(effective?'signal_listening_effective_population_roots_v2':'signal_listening_population_roots_v1')).rows.map(r=>r.value);
 assert.deepEqual(after,before,'custom bounded dispatch preserves every raw/effective field including SQL timestamp microseconds');
 if(after.length)assert.equal(Object.keys(after[0]!).length,effective?20:14);return after;
}
test('custom bounded plans preserve fourteen fields, microseconds, both scopes and current source denial',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 const cfg=await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,
  expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await references(c);const scope=[f.workspace_id,cfg.id,f.map_id,context];
  await c.query("UPDATE mentions SET published_at='2026-01-01 00:00:00.123456+00'::timestamptz WHERE workspace_id=$1",[f.workspace_id]);
  const all=await equal(c,scope);assert.equal(all.length,12);assert.ok(all.every(row=>row.published_at.includes('.123456')),'JSON must preserve microseconds that node-pg Date would truncate');
  assert.ok(all.filter(r=>r.definition.scope==='all').every(r=>r.scope_state==='included'));
  assert.ok(all.filter(r=>r.definition.scope==='consumer_category').every(r=>r.scope_state==='awaiting_base'));
  await equal(c,scope,[all[0]!.root_id,null,all[0]!.root_id]);await equal(c,scope,null,'llm-processing');await equal(c,scope,null,'client-derived-metrics',true);
  for(const roots of [[],[randomUUID()],Array(4097).fill(all[0]!.root_id)])assert.equal((await equal(c,scope,roots)).length,0);
  assert.equal((await equal(c,[randomUUID(),...scope.slice(1)])).length,0);
  assert.equal((await equal(c,[scope[0],randomUUID(),...scope.slice(2)])).length,0);
  assert.equal((await equal(c,[scope[0],scope[1],randomUUID(),scope[3]])).length,0);
  await equal(c,[...scope.slice(0,3),'sha256:'+'0'.repeat(64)],[all[0]!.root_id]);
  assert.equal((await equal(c,scope,null,'invalid-purpose')).length,0);
  await c.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
  assert.equal((await equal(c,scope)).length,0);assert.equal((await equal(c,scope,[all[0]!.root_id])).length,0);
 }finally{await c.query('ROLLBACK');c.release();}
}}));
test('official voice with a newly missing promotion answer remains awaiting base before lexical exclusion',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const cfg=await saveSignalListeningConfigurationV1({...f,expected_revision:f.cfg.revision,provenance:'human',configuration:{...f.cfg.configuration,
  questions:[...f.cfg.configuration.questions.map(q=>q.key==='promotion'?{...q,text:q.text+' New version.'}:q),
   {key:'consumer_scope_probe',type:'noul',text:'Does the configured consumer discuss maintenance?',positive:'Consumer maintenance',negative:'Other conversation',
    scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined'}]}});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await references(c);const scope=[f.workspace_id,cfg.id,f.map_id,context];
  const all=await equal(c,scope);assert.ok(all.some(r=>r.question_key==='voice'&&r.answer?.choice==='brand_official'&&r.cache_call_id));
  assert.ok(all.filter(r=>r.question_key==='promotion').every(r=>r.answer===null));
  const scoped=all.filter(r=>r.definition.scope==='consumer_category');assert.ok(scoped.length>0);assert.ok(scoped.every(r=>r.scope_state==='awaiting_base'));
  await equal(c,scope,[all[0]!.root_id]);await equal(c,scope,null,'llm-processing');await equal(c,scope,null,'client-derived-metrics',true);
 }finally{await c.query('ROLLBACK');c.release();}
},{no_category:true}));
test('custom bounded plans preserve completed cache and real H5 overlays without changing provider answers',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const ctx=await human.getSignalListeningHumanEditContextV1(access);assert.equal(ctx.can_edit,true);
 const key=ctx.configuration.questions.find(q=>q.topic_source)?.key;assert.ok(key);
 const changed=await human.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:f.roots[0]!,from_question_key:key,idempotency_key:randomUUID()});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await references(c);const scope=[f.workspace_id,changed.configuration_id,f.map_id,context];
  const raw=await equal(c,scope),effective=await equal(c,scope,null,'client-derived-metrics',true);
  assert.ok(raw.some(r=>r.question_key==='promotion'&&r.answer?.noul===.1&&r.cache_call_id));
  const overridden=effective.find(r=>r.root_id===f.roots[0]&&r.question_key===key);assert.ok(overridden);
  assert.equal(overridden.human_belongs,false);assert.equal(overridden.effective_belongs,false);assert.equal(overridden.answer.noul,.9);
  assert.equal(overridden.label_source,'human');assert.ok(overridden.cache_call_id);await equal(c,scope,[f.roots[0]!], 'client-derived-metrics',true);
  await equal(c,scope,null,'llm-processing');
  await c.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);assert.equal((await equal(c,scope,null,'client-derived-metrics',true)).length,0);
 }finally{await c.query('ROLLBACK');c.release();}
},{complete_listening:true,additional_defined_topic:true}));

// The fixture enters its owned native lab only when ROOT enables this acceptance
// in CI. No provider transport is used; fixture preparation is synthetic.
test('bounded dispatch survives 32-root warmups, repeated4096 roots and a return to small/full queries',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:4096,execution_cap_micro_usd:1000000,import_batch_size:256,beforeProcessing:async f=>{
 const cfg=await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,
  expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='60s'");await references(c);
  const scope=[f.workspace_id,cfg.id,f.map_id,context];
  const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);
  assert.equal(roots.length,4096);
  for(let n=0;n<6;n++)assert.equal((await equal(c,scope,roots.slice(0,32))).length,128);
  const observations:Array<{phase:string;roots:number;rows:number;wall_ms:number}>=[];
  for(let n=0;n<4;n++){const started=performance.now(),rows=await equal(c,scope,roots);assert.equal(rows.length,16384);
   observations.push({phase:'old_new_oracle',roots:4096,rows:rows.length,wall_ms:performance.now()-started});}
  const full=await equal(c,scope,null,'llm-processing');assert.equal(full.length,16384);
  assert.deepEqual(await equal(c,scope,roots,'llm-processing'),full,'full and bounded outputs retain all14 fields');
  const small=roots.slice(0,3);assert.deepEqual(await equal(c,scope,small),full.filter(row=>small.includes(row.root_id)));
  assert.equal((await equal(c,scope,[])).length,0);assert.equal((await equal(c,scope,[randomUUID()])).length,0);
  assert.equal((await equal(c,scope,Array(4097).fill(roots[0]))).length,0);
  // Report actual aggregate plans after the same cardinality sequence. Times and
  // buffers are evidence, never a timing or join-shape assertion on noisy CI.
  for(const [version,fn]of [['0317','pg_temp.r16_population_before_0321'],['0321','signal_listening_population_roots_v1']]){
   const result=await c.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM ${fn}($1,$2,$3,$4,$5::uuid[],$6)`,[...scope,roots,'llm-processing']);
   const actual=result.rows[0]['QUERY PLAN'][0],plan=actual.Plan;assert.equal(plan['Actual Rows'],16384);
   console.log('# bounded custom plan '+JSON.stringify({version,roots:4096,rows:plan['Actual Rows'],execution_ms:actual['Execution Time'],estimated_rows:plan['Plan Rows'],total_cost:plan['Total Cost'],temp_read_blocks:plan['Temp Read Blocks']??0,temp_written_blocks:plan['Temp Written Blocks']??0}));
  }
  console.log('# bounded custom oracle '+JSON.stringify(observations));
 }finally{await c.query('ROLLBACK');c.release();}
}}}));
