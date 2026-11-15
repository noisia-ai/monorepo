import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {loadSignalMentionListeningLabelsV1,type SignalListeningMentionLabelDependenciesV1} from './signal-listening-mention-labels';
const workspace='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',root='10000000-0000-4000-8000-000000000003',sha='sha256:'+'a'.repeat(64);
const scope={workspace_id:workspace,actor_user_id:id};
function harness(){
 const template=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 const configuration={...template,questions:[...template.questions,...Array.from({length:10},(_,i)=>({key:'topic_'+i,type:'noul' as const,text:'Topic '+i,positive:'Definition '+i,negative:'Other topics',
  scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const,domain:i===9?'outside' as const:'category' as const}))]};
 const binding={id,configuration_id:id,generation_id:id,map_id:id,snapshot_digest:sha,human_snapshot_id:null,classification_run_id:id,revision:0,binding_kind:'native' as const,configuration_is_latest:true};
 const cfg={id,workspace_id:workspace,revision:1,configuration,configuration_digest:sha,provenance:'human' as const,source_digest:null,state:'published' as const,created_at:'2026-01-01T00:00:00.000Z'};
 const calls:Array<{roots:string[];keys:string[]}>=[];let snapshots=0;
 const deps:SignalListeningMentionLabelDependenciesV1={snapshot:async actual=>{assert.deepEqual(actual,scope);snapshots++;return binding;},configuration:async(actual,configuration_id)=>{
  assert.deepEqual(actual,scope);assert.equal(configuration_id,id);return cfg;
 },labels:async(actual,args)=>{assert.deepEqual(actual,scope);assert.equal(args.configuration_id,id);assert.equal(args.map_id,id);calls.push({roots:args.root_ids,keys:args.question_keys});
  return args.root_ids.flatMap(root_id=>args.question_keys.map(question_key=>({root_id,question_key,question_digest:sha,input_digest:sha,
   answer:{type:'noul',noul:.95},cache_call_id:id,effective_belongs:false,human_belongs:false,human_decision_id:id,legacy_manual_id:null,label_source:'human',human_edit_revision:'1'})));
 }};
 return{deps,binding,cfg,calls,snapshots:()=>snapshots};
}
test('mention labels use the sealed configuration, bounded question batches and separate human decisions from JEV probability',async()=>{
 const f=harness(),labels=await loadSignalMentionListeningLabelsV1(scope,[root],f.deps);
 assert.deepEqual(f.calls.map(c=>c.keys.length),[8,1]);assert.equal(f.snapshots(),2);
 const value=labels.get(root)!;assert.equal(value.binding.configuration_id,id);assert.equal(value.labels.length,9);
 assert.equal(value.labels[0]?.probability,.95);assert.equal(value.labels[0]?.effective_belongs,false);assert.equal(value.labels[0]?.human_belongs,false);
 assert.equal(value.labels[0]?.human_decision_id,id);assert.ok(value.labels.every(row=>row.domain!=='outside'));
});
test('absent initial snapshots add no historical reinterpretation while revoked access and stale source errors remain failures',async()=>{
 const f=harness();f.deps.snapshot=async()=>{throw Object.assign(Error('no snapshot'),{code:'listening_human_snapshot_unavailable',status:404});};
 assert.equal((await loadSignalMentionListeningLabelsV1(scope,[root],f.deps)).size,0);assert.equal(f.calls.length,0);
 for(const [code,status]of [['listening_forbidden',403],['listening_human_source_stale',409]]as const){
  f.deps.snapshot=async()=>{throw Object.assign(Error('native guard'),{code,status});};
  await assert.rejects(loadSignalMentionListeningLabelsV1(scope,[root],f.deps),{code,status});
 }
});
test('a human revision race or mismatched configuration cannot attach labels from different snapshots',async()=>{
 const f=harness();let reads=0;f.deps.snapshot=async()=>++reads===1?f.binding:{...f.binding,id:root,human_snapshot_id:root,binding_kind:'human'};
 await assert.rejects(loadSignalMentionListeningLabelsV1(scope,[root],f.deps),{code:'workspace_mentions_listening_source_changed',status:409});
 const wrong=harness();wrong.deps.configuration=async()=>({...wrong.cfg,workspace_id:root});
 await assert.rejects(loadSignalMentionListeningLabelsV1(scope,[root],wrong.deps),{code:'workspace_mentions_listening_source_changed'});assert.equal(wrong.calls.length,0);
});
test('foreign roots, duplicate labels and oversized reads fail before returning a partial enrichment',async()=>{
 for(const duplicate of [false,true]){
  const f=harness(),read=f.deps.labels;f.deps.labels=async(...args)=>{const rows=await read(...args);return duplicate?[...rows,rows[0]!]:rows.map(row=>({...row,root_id:id}));};
  await assert.rejects(loadSignalMentionListeningLabelsV1(scope,[root],f.deps),{code:'workspace_mentions_listening_source_changed'});
 }
 const f=harness();await assert.rejects(loadSignalMentionListeningLabelsV1(scope,Array(201).fill(root),f.deps),{status:409});assert.equal(f.snapshots(),0);
});
