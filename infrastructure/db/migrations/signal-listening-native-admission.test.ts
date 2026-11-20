import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {signalListeningBaseTemplateV1,signalListeningJevIdentityV1,buildSignalListeningJevRequestV1,
 signalListeningRequestDigestV1,signalListeningCalibrationShapeV1,type SignalListeningInputV1} from '@noisia/query-engine';
import type {LabelingRunV1,LabelingCallProposalV1,LabelingCallV1} from '../signal-labeling-runs';
import {planNativeListeningAdmissionPacketV1,nativeListeningAdmissionCoveredV1,nativeListeningAdmissionPacketBodyV1,
 validateNativeListeningAdmissionRowsV1,nativeListeningAdmissionWorkspaceBoundV1} from '../signal-listening-native-admission';

function fixture(){
 const configuration=signalListeningBaseTemplateV1({category:'synthetic bicycles',lexicon_terms:['synthetic']});
 const identity=signalListeningJevIdentityV1(configuration);
 const run={id:randomUUID(),workspace_id:randomUUID(),actor_user_id:randomUUID(),kind:'mass_labeling',identity,
  labeler_digest:'sha256:'+'a'.repeat(64),entity_context_digest:'sha256:'+'b'.repeat(64),lease_token:randomUUID()}as LabelingRunV1;
 const inputs=Array.from({length:3},(_,i)=>({root_id:randomUUID(),input_digest:'sha256:'+String(i+1).repeat(64),
  text:`Synthetic "\n\t☕ ${i} \u2028 \u001f`,title:null,platform:'synthetic',content_type:null,author:null,
  published_at:'2026-11-20T00:00:00.000Z',language:null,map_id:randomUUID(),
  configuration_digest:String(identity.params.configuration_digest),question_keys:['promotion','voice'],
  question_digests:{promotion:'sha256:'+'c'.repeat(64),voice:'sha256:'+'d'.repeat(64)},scope_basis:{}} satisfies SignalListeningInputV1));
 inputs.forEach(i=>{i.map_id=inputs[0]!.map_id;});
 const proposals=inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
  return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:37,retry_depth:0} satisfies LabelingCallProposalV1<SignalListeningInputV1>;});
 const shape=signalListeningCalibrationShapeV1(configuration,inputs[0]!);
 const bytes=proposals.map(p=>Buffer.byteLength(JSON.stringify(p.request)));
 const profile={scope:{workspace_id:run.workspace_id,configuration_digest:String(identity.params.configuration_digest),model:configuration.model,
  compiler_version:'listening-jev-v1',shape_digest:shape.shape_digest,phase:shape.phase},scope_digest:'sha256:'+'e'.repeat(64),
  source_digest:'sha256:'+'f'.repeat(64),source_call_ids:Array.from({length:32},()=>randomUUID()),source_run_id:run.id,
  request_min_bytes:Math.min(...bytes),request_max_bytes:Math.max(...bytes),max_input_tokens_per_byte:2,sample_count:32,status:'measured'};
 return{run,inputs,proposals,profile};
}

test('native admission compact packet preserves compiler requests, input text once, order and exact JS quote',()=>{
 const f=fixture(),plan=planNativeListeningAdmissionPacketV1(f.run,f.proposals,1024);assert.ok(plan);
 const packet=JSON.parse(nativeListeningAdmissionPacketBodyV1(plan,f.proposals));
 assert.equal(packet.rows.length,3);assert.equal(Object.keys(packet.questions).length,2);
 for(let i=0;i<packet.rows.length;i++){
  const row=packet.rows[i],expected=f.proposals[i]!;
  const request={model:packet.model,state:row.inputs[0].text,questions:Object.fromEntries(row.question_keys.map((k:string)=>[k,packet.questions[k]]))};
  assert.deepEqual(request,expected.request);assert.deepEqual(row.inputs,expected.inputs);
  assert.equal(row.custom_id,expected.custom_id);assert.equal(row.request_digest,expected.request_digest);assert.equal(row.reserved_micro_usd,37);
  assert.equal(signalListeningRequestDigestV1(f.run,row.inputs[0],request),expected.request_digest);
 }
 assert.ok(Buffer.byteLength(nativeListeningAdmissionPacketBodyV1(plan,f.proposals))<Buffer.byteLength(JSON.stringify(f.proposals)));
});

test('native admission finite JSON numbers keep original quote and digest; ambiguity falls back before DML',()=>{
 const f=fixture();const request=f.proposals[0]!.request as Record<string,unknown>;
 const questions=request.questions as Record<string,Record<string,unknown>>;questions.promotion={...questions.promotion,extra:[1e-7,1e20,-0,0.25]};
 const p=f.proposals[0]!;p.request_digest=signalListeningRequestDigestV1(f.run,p.inputs[0]!,p.request as never);p.custom_id='listening_'+p.request_digest.slice(7,67);
 assert.equal(planNativeListeningAdmissionPacketV1(f.run,f.proposals,1024),null,'same key with a different wire is not merged');
 const valid=fixture();const only=planNativeListeningAdmissionPacketV1(valid.run,[valid.proposals[0]!],1024);assert.ok(only);
 assert.equal(JSON.parse(nativeListeningAdmissionPacketBodyV1(only,[valid.proposals[0]!])).rows[0].reserved_micro_usd,37);
});

for(const defect of ['zero_inputs','multiple_inputs','retry','duplicate_custom','duplicate_root','wrong_model','non_json','wrong_text','wrong_custom','unknown_question']as const)
test('native admission unsupported '+defect+' selects the complete legacy path',()=>{
 const f=fixture(),p=f.proposals[0]!;
 if(defect==='zero_inputs')p.inputs=[];
 if(defect==='multiple_inputs')p.inputs.push(f.inputs[1]!);
 if(defect==='retry')p.retry_depth=1;
 if(defect==='duplicate_custom')f.proposals[1]!.custom_id=p.custom_id;
 if(defect==='duplicate_root')f.proposals[1]!.inputs=[f.inputs[0]!];
 if(defect==='wrong_model')(p.request as Record<string,unknown>).model='other';
 if(defect==='non_json')(p.request as Record<string,unknown>).extra=BigInt(1);
 if(defect==='wrong_text')(p.request as Record<string,unknown>).state='changed';
 if(defect==='wrong_custom')p.custom_id='arbitrary';
 if(defect==='unknown_question')p.inputs[0]!.question_keys.push('missing');
 assert.equal(planNativeListeningAdmissionPacketV1(f.run,f.proposals,1024),null);
});

test('only an actual full32 measured profile with matching scope and byte range is covered',()=>{
 const f=fixture(),plan=planNativeListeningAdmissionPacketV1(f.run,f.proposals,1024);assert.ok(plan);
 assert.equal(nativeListeningAdmissionCoveredV1(plan,[f.profile]),true);
 for(const change of [{sample_count:7},{sample_count:31},{sample_count:33},{status:'estimated'},{source_run_id:randomUUID()},
  {source_call_ids:f.profile.source_call_ids.slice(0,31)},{source_call_ids:Array(32).fill(f.profile.source_call_ids[0])},
  {request_min_bytes:f.profile.request_max_bytes+1},{request_max_bytes:f.profile.request_min_bytes-1},
  {scope:{...f.profile.scope,workspace_id:randomUUID()}},{scope:{...f.profile.scope,configuration_digest:'different'}},
  {scope:{...f.profile.scope,model:'different'}},{scope:{...f.profile.scope,shape_digest:'different'}},
  {scope:{...f.profile.scope,compiler_version:'different'}},{scope:{...f.profile.scope,phase:'different'}}])
  assert.equal(nativeListeningAdmissionCoveredV1(plan,[{...f.profile,...change}]),false,JSON.stringify(change));
 assert.equal(nativeListeningAdmissionCoveredV1(plan,[]),false);
});

test('selected packet is a bounded identity-preserving prefix and cannot expand or substitute late inputs',()=>{
 const f=fixture(),plan=planNativeListeningAdmissionPacketV1(f.run,f.proposals,1024);assert.ok(plan);
 assert.equal(JSON.parse(nativeListeningAdmissionPacketBodyV1(plan,f.proposals.slice(0,1))).rows.length,1);
 assert.equal(JSON.parse(nativeListeningAdmissionPacketBodyV1(plan,[])).rows.length,0);
 for(const rows of [[f.proposals[1]!],[f.proposals[0]!,f.proposals[0]!],[structuredClone(f.proposals[0]!)],[...f.proposals,...f.proposals]])
  assert.throws(()=>nativeListeningAdmissionPacketBodyV1(plan,rows));
});

test('return validation checks the complete selected cohort before COMMIT, independent of SQL row order',()=>{
 const f=fixture(),selected=f.proposals.slice(0,2),rows=selected.map(p=>({...structuredClone(p),id:randomUUID(),run_id:f.run.id,
  workspace_id:f.run.workspace_id,status:'submitting',provider:'typesafe',model:'jev-1.13.0',transport:'sync',raw_body:null,
  request_storage_key:null,raw_sha256:null,raw_storage_key:null,raw_size_bytes:null,raw_storage_verified_at:null,raw_storage_verified_key:null,
  provider_batch_id:null,usage:null,results:null,settled_micro_usd:null,terminal_exposure_micro_usd:'0',stop_reason:null,refusal_category:null,
  results_applied:false})as LabelingCallV1<SignalListeningInputV1>);
 assert.deepEqual(validateNativeListeningAdmissionRowsV1(f.run,selected,[rows[1]!,rows[0]!],'submitting').map(c=>c.id),rows.map(c=>c.id));
 assert.deepEqual(validateNativeListeningAdmissionRowsV1(f.run,[],[],'submitting'),[]);
 // Real INSERT/UPDATE RETURNING * has no raw_body column since 0255.
 // Do not fabricate that virtual property in the regression input.
 const persisted=structuredClone(rows)as Array<LabelingCallV1<SignalListeningInputV1>&Record<string,unknown>>;
 for(const row of persisted)delete (row as Record<string,unknown>).raw_body;
 const normalized=validateNativeListeningAdmissionRowsV1(f.run,selected,persisted,'submitting');
 assert.ok(normalized.every(row=>Object.hasOwn(row,'raw_body')&&row.raw_body===null));
 assert.ok(persisted.every(row=>!Object.hasOwn(row,'raw_body')),'normalization does not mutate SQL rows');
 assert.deepEqual(normalized,rows);
 const undefinedRaw=structuredClone(rows);Object.assign(undefinedRaw[0]!,{raw_body:undefined});
 assert.throws(()=>validateNativeListeningAdmissionRowsV1(f.run,selected,undefinedRaw,'submitting'));
 for(const change of [{status:'reserved'},{status:'unknown'},{request_digest:'changed'},{custom_id:'changed'},{reserved_micro_usd:38},
  {request:{changed:true}},{inputs:[]},{raw_body:'raw'},{raw_storage_key:'raw'},{raw_sha256:'raw'},{raw_size_bytes:1},
  {terminal_exposure_micro_usd:null},{terminal_exposure_micro_usd:''},{terminal_exposure_micro_usd:'1'},
  {results_applied:true},{run_id:randomUUID()},{workspace_id:randomUUID()}]){
  const bad=structuredClone(rows);Object.assign(bad[0]!,change);assert.throws(()=>validateNativeListeningAdmissionRowsV1(f.run,selected,bad,'submitting'));
 }
 assert.throws(()=>validateNativeListeningAdmissionRowsV1(f.run,selected,rows.slice(0,1),'submitting'));
 const duplicate=structuredClone(rows);duplicate[1]!.id=duplicate[0]!.id;assert.throws(()=>validateNativeListeningAdmissionRowsV1(f.run,selected,duplicate,'submitting'));
 for(const key of ['request_storage_key','raw_sha256','raw_storage_key','raw_size_bytes','raw_storage_verified_at','raw_storage_verified_key',
  'provider_batch_id','usage','results','settled_micro_usd','stop_reason','refusal_category','terminal_exposure_micro_usd']){
  const missing=structuredClone(rows)as Array<LabelingCallV1<SignalListeningInputV1>&Record<string,unknown>>;delete missing[0]![key];
  assert.throws(()=>validateNativeListeningAdmissionRowsV1(f.run,selected,missing,'submitting'),key+' missing');
  const occupied=structuredClone(rows)as Array<LabelingCallV1<SignalListeningInputV1>&Record<string,unknown>>;occupied[0]![key]='occupied';
  assert.throws(()=>validateNativeListeningAdmissionRowsV1(f.run,selected,occupied,'submitting'),key+' occupied');
 }
});


test('native workspace quote precedes allocation and charges repeated payload occurrences without deduplication',()=>{
 const f=fixture(),one=nativeListeningAdmissionWorkspaceBoundV1(f.run,[f.proposals[0]!]);
 const repeated=nativeListeningAdmissionWorkspaceBoundV1(f.run,[f.proposals[0]!,f.proposals[0]!]);
 assert.ok(Number.isSafeInteger(one)&&one>0);assert.ok(repeated>one);
 const large=structuredClone(f.proposals[0]!);large.inputs[0]!.text+='x'.repeat(8192);
 assert.ok(nativeListeningAdmissionWorkspaceBoundV1(f.run,[large])>one+8192*2);
 const poisoned=structuredClone(f.proposals[0]!)as LabelingCallProposalV1<SignalListeningInputV1>;
 Object.defineProperty(poisoned.request,'notJson',{get(){throw Error('getter must not run');},enumerable:true});
 assert.throws(()=>nativeListeningAdmissionWorkspaceBoundV1(f.run,[poisoned]),/workspace_invalid/);
 const cycle:Record<string,unknown>={};cycle.self=cycle;poisoned.request=cycle;
 assert.throws(()=>nativeListeningAdmissionWorkspaceBoundV1(f.run,[poisoned]),/workspace_invalid/);
 assert.throws(()=>nativeListeningAdmissionWorkspaceBoundV1(f.run,Array(1025).fill(f.proposals[0]!)),/workspace_invalid/);
});
