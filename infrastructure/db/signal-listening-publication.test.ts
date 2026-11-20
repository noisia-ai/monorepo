import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,signalListeningQuestionDigestV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {saveSignalListeningConfigurationWithClientV1,type SignalListeningConfigurationRecordV1} from './signal-listening-configuration';
const base=()=>signalListeningBaseTemplateV1({category:'synthetic bikes',lexicon_terms:['bike']});
const topic={key:'repair',type:'noul' as const,text:'Is repair discussed?',positive:'Repair experiences',negative:'Other matters',scope:'all' as const,
 origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const};
const localization={original_language:'en',original:{name:'Repairs',definition:'Repair experiences'},en:{name:'Repairs',definition:'Repair experiences'},es:{name:'Reparaciones',definition:'Experiencias de reparación'}};
function fixture(configuration:SignalListeningConfigurationV1|null=base(),options:{denied?:boolean}={}){
 let saved:SignalListeningConfigurationRecordV1|null=null;const events:string[]=[];
 const current=configuration?{id:'current',workspace_id:'workspace',revision:1,configuration,configuration_digest:'sha256:old',provenance:'human',source_digest:null,state:'published',created_at:'2026-01-01'}:null;
 const client={query:async(sql:string,params:unknown[]=[])=>{
  sql=sql.trim();events.push(sql);
  if(sql.includes('workspace.status workspace_status'))return{rows:options.denied?[]:[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin',same_organization:true,brand_access_level:null,organization_status:'active',brand_same_organization:true}]};
  if(sql.includes('SELECT EXISTS(SELECT 1 FROM signal_workspace_features'))return{rows:[{enabled:true}]};
  if(sql.startsWith('SELECT * FROM signal_listening_configurations'))return{rows:current?[current]:[]};
  if(sql.startsWith('SELECT COALESCE(max(revision),0)+1'))return{rows:[{revision:current?2:1}]};
  if(sql.startsWith('INSERT INTO signal_listening_configurations')){saved={id:'saved',workspace_id:'workspace',revision:Number(params[1]),configuration:JSON.parse(params[2] as string),configuration_digest:params[3] as string,provenance:params[4] as 'human'|'agent',source_digest:params[5] as string|null,state:params[6] as 'published'|'proposal',created_at:'2026-01-02'};return{rows:[saved]};}
  if(sql.startsWith('SELECT question_key,question_digest'))return{rows:saved!.configuration.questions.map(q=>({question_key:q.key,question_digest:signalListeningQuestionDigestV1(saved!.configuration,q)}))};
  if(sql.startsWith('SELECT ')||sql.startsWith('INSERT INTO signal_listening_questions'))return{rows:[]};
  assert.fail('unexpected test query');
 },release(){}} as unknown as PoolClient;
 const save=(next:SignalListeningConfigurationV1,overrides:Record<string,unknown>={})=>saveSignalListeningConfigurationWithClientV1(client,{database:{} as never,workspace_id:'workspace',actor_user_id:'actor',expected_revision:current?1:0,provenance:'human',configuration:next,...overrides});
 return{save,events};
}
test('the shared product writer rejects a newly published incomplete topic before any INSERT',async()=>{
 for(const provenance of ['human','agent']as const){const f=fixture(),next={...base(),questions:[...base().questions,topic]};
  await assert.rejects(f.save(next,{provenance,source_digest:provenance==='agent'?'sha256:'+'a'.repeat(64):null}),error=>{
   assert.equal((error as any).code,'listening_topic_localization_required');assert.equal((error as any).status,422);return true;});
  assert.equal(f.events.some(sql=>sql.startsWith('INSERT')),false);assert.ok(f.events[0]!.includes('pg_advisory_xact_lock'));
 }
});
test('the writer publishes valid localizations and leaves original request wires and cache identities intact',async()=>{
 const f=fixture(),next={...base(),questions:[...base().questions,{...topic,localization}]},saved=await f.save(next);
 assert.deepEqual(saved.configuration.questions.find(q=>q.key===topic.key)!.localization,localization);
 assert.equal(signalListeningQuestionDigestV1(next,topic),signalListeningQuestionDigestV1(saved.configuration,saved.configuration.questions.find(q=>q.key===topic.key)!));
});
test('legacy carry-forward and membership locks remain publishable, but semantic edits require localization',async()=>{
 const legacy={...base(),questions:[...base().questions,topic]},f=fixture(legacy);
 await f.save({...legacy,questions:legacy.questions.map(q=>({...q,human_locked:true}))});
 await assert.rejects(f.save({...legacy,questions:legacy.questions.map(q=>q.key===topic.key?{...q,positive:'Changed meaning'}:q)}),/listening_topic_localization_required/);
});
test('proposals may remain incomplete; auth, CAS and human precedence still reject before publication validation',async()=>{
 const next={...base(),questions:[...base().questions,topic]};await fixture().save(next,{state:'proposal'});
 await assert.rejects(fixture(base(),{denied:true}).save(next),/listening_forbidden/);
 await assert.rejects(fixture().save(next,{expected_revision:0}),/listening_configuration_conflict/);
 const frozen={...base(),questions:[...base().questions,{...topic,human_locked:true}]};
 await assert.rejects(fixture(frozen).save({...frozen,questions:frozen.questions.map(q=>q.key===topic.key?{...q,positive:'Changed'}:q)},
  {provenance:'agent',source_digest:'sha256:'+'a'.repeat(64)}),/listening_human_edit_frozen/);
});
