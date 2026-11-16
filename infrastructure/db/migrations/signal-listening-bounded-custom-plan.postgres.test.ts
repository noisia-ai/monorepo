import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import * as human from '../signal-listening-human-edits';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
import {installBoundedCustomPlanOracleV1 as references,assertBoundedCustomPlanOracleV1 as equal} from './signal-listening-bounded-custom-plan.oracle';
const enabled=process.env.NOISIA_R16_LISTENING_BOUNDED_CUSTOM_PLAN_PG==='true';
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
  const repeated=await equal(c,scope,[f.roots[0]!,null,f.roots[0]!]);assert.equal(repeated.length,raw.filter(r=>r.root_id===f.roots[0]).length,'bounded duplicate/NULL roots do not multiply completed cache answers');
  assert.ok(repeated.some(row=>row.answer!==null&&row.cache_call_id!==null));
  await equal(c,scope,[f.roots[0]!,null,f.roots[0]!],'client-derived-metrics',true);
  const otherContext=await equal(c,[...scope.slice(0,3),'sha256:'+'0'.repeat(64)],null,'llm-processing');
  assert.ok(otherContext.every(row=>row.answer===null&&row.cache_call_id===null),'another entity context cannot reuse cached answers');
  await equal(c,scope,null,'llm-processing');
  await c.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);assert.equal((await equal(c,scope,null,'client-derived-metrics',true)).length,0);
 }finally{await c.query('ROLLBACK');c.release();}
},{complete_listening:true,additional_defined_topic:true}));
