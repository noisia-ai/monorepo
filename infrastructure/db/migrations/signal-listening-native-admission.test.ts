import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {signalListeningBaseTemplateV1,signalListeningJevIdentityV1,buildSignalListeningJevRequestV1,
 signalListeningRequestDigestV1,signalListeningCalibrationShapeV1,type SignalListeningInputV1} from '@noisia/query-engine';
import {signalListeningInputSurveyStorageBoundV1} from '../signal-listening-runs';
import type {LabelingRunV1,LabelingCallProposalV1,LabelingCallV1} from '../signal-labeling-runs';
import {planNativeListeningAdmissionPacketV1,nativeListeningAdmissionCoveredV1,nativeListeningAdmissionPacketBodyV1,
 validateNativeListeningAdmissionRowsV1,reconstructNativeListeningAdmissionRowsV1,nativeListeningAdmissionWorkspaceBoundV1,createNativeListeningAdmissionWorkspaceQuoteV1} from '../signal-listening-native-admission';

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


// Prefix quote is a numeric snapshot only. The production worker owns an
// immutable draft while retaining this handle; no DB decision is cached.
test('prefix workspace quotes equal the complete original bound for every prefix, Unicode and repeated graph occurrences',()=>{
 const f=fixture(),rows=[...f.proposals,f.proposals[0]!,f.proposals[0]!];
 const quote=createNativeListeningAdmissionWorkspaceQuoteV1(f.run,rows);assert.ok(quote);
 assert.equal(quote.length,rows.length);assert.equal(quote.retained_bytes,256+8*(rows.length+1));
 assert.ok(Object.isFrozen(quote));
 for(let i=0;i<=rows.length;i++)assert.equal(quote.quote(i),nativeListeningAdmissionWorkspaceBoundV1(f.run,rows.slice(0,i)));
 // Array keys are not charged by index length: suffix reindexing preserves
 // the exact additive model, so an unconsumed draft needs no second DFS.
 for(let offset=0;offset<=rows.length;offset++)for(let n=0;n<=rows.length-offset;n++)
  assert.equal(quote.quote(offset+n)-quote.quote(offset)+quote.quote(0),nativeListeningAdmissionWorkspaceBoundV1(f.run,rows.slice(offset,offset+n)));
 const full=Array(1024).fill(f.proposals[0]!),fullQuote=createNativeListeningAdmissionWorkspaceQuoteV1(f.run,full);assert.ok(fullQuote);
 for(const [offset,n]of [[1000,24],[511,512],[1024,0],[0,1024]]as const)
  assert.equal(fullQuote.quote(offset+n)-fullQuote.quote(offset)+fullQuote.quote(0),nativeListeningAdmissionWorkspaceBoundV1(f.run,full.slice(offset,offset+n)));
 const empty=createNativeListeningAdmissionWorkspaceQuoteV1(f.run,[]);assert.ok(empty);
 assert.equal(empty.quote(0),nativeListeningAdmissionWorkspaceBoundV1(f.run,[]));
 assert.ok(quote.quote(5)-quote.quote(4)>53952,'the same proposal alias still pays its full graph again');
 for(const n of [-1,rows.length+1,NaN,Infinity,.5])assert.throws(()=>quote.quote(n),/workspace_invalid/);
});

test('prefix quote reads each graph once and later binary-search probes never revisit request/configuration objects',()=>{
 const f=fixture();let descriptors=0;
 f.proposals[0]!.request=new Proxy(f.proposals[0]!.request,{getOwnPropertyDescriptor(target,key){descriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 const quote=createNativeListeningAdmissionWorkspaceQuoteV1(f.run,f.proposals);assert.ok(quote);assert.ok(descriptors>0);
 const afterBuild=descriptors;
 for(let i=0;i<32;i++)for(let n=0;n<=f.proposals.length;n++)quote.quote(n);
 assert.equal(descriptors,afterBuild,'no request traversal per prefix probe');
});

for(const defect of ['cycle','accessor','nonfinite','prototype','undefined','bigint','symbol']as const)
test('prefix workspace quote preserves the original graph rejection for '+defect,()=>{
 const f=fixture(),request=f.proposals[0]!.request as Record<string,unknown>;
 if(defect==='cycle')request.extra=request;
 if(defect==='accessor')Object.defineProperty(request,'extra',{get(){throw Error('getter must not be invoked');},enumerable:true});
 if(defect==='nonfinite')request.extra=Infinity;
 if(defect==='prototype')request.extra=new Date(0);
 if(defect==='undefined')request.extra=undefined;
 if(defect==='bigint')request.extra=1n;
 if(defect==='symbol')request.extra=Symbol('not JSON');
 assert.throws(()=>nativeListeningAdmissionWorkspaceBoundV1(f.run,f.proposals),/workspace_invalid/);
 assert.throws(()=>createNativeListeningAdmissionWorkspaceQuoteV1(f.run,f.proposals),/workspace_invalid/);
});

test('unusual top-level arrays retain the complete original quote path without invoking accessors',()=>{
 const f=fixture(),hole=f.proposals.slice();delete (hole as unknown as Record<string,unknown>)['1'];
 assert.equal(createNativeListeningAdmissionWorkspaceQuoteV1(f.run,hole),null);
 const extra=f.proposals.slice()as typeof f.proposals&{extra?:number};extra.extra=7;
 assert.equal(createNativeListeningAdmissionWorkspaceQuoteV1(f.run,extra),null);
 assert.ok(nativeListeningAdmissionWorkspaceBoundV1(f.run,extra)>nativeListeningAdmissionWorkspaceBoundV1(f.run,f.proposals));
 const accessor=f.proposals.slice();let invoked=0;
 Object.defineProperty(accessor,'1',{get(){invoked++;throw Error('getter must not run');},enumerable:true});
 assert.equal(createNativeListeningAdmissionWorkspaceQuoteV1(f.run,accessor),null);assert.equal(invoked,0);
 assert.throws(()=>nativeListeningAdmissionWorkspaceBoundV1(f.run,accessor),/workspace_invalid/);assert.equal(invoked,0);
 const species=f.proposals.slice();let speciesRead=0;
 Object.defineProperty(species,'constructor',{get(){speciesRead++;throw Error('constructor getter must not run');}});
 assert.equal(createNativeListeningAdmissionWorkspaceQuoteV1(f.run,species),null);assert.equal(speciesRead,0);
 const ownSlice=f.proposals.slice();Object.defineProperty(ownSlice,'slice',{get(){throw Error('slice getter must not run');}});
 assert.equal(createNativeListeningAdmissionWorkspaceQuoteV1(f.run,ownSlice),null);
 const customSpecies=f.proposals.slice();Object.defineProperty(customSpecies,'constructor',{value:{[Symbol.species]:class extends Array{extra=1;}}});
 assert.equal(createNativeListeningAdmissionWorkspaceQuoteV1(f.run,customSpecies),null);
 assert.throws(()=>createNativeListeningAdmissionWorkspaceQuoteV1(f.run,Array(1025).fill(f.proposals[0]!)),/workspace_invalid/);
});


test('complete cohort validation retains exact reordered identities without quadratic custom-id searches',()=>{
 const f=fixture(),selected=Array.from({length:64},(_,i)=>({...structuredClone(f.proposals[0]!),custom_id:'listening_'+i.toString(16).padStart(60,'0')}));
 let reads=0;
 const rows=selected.map(p=>{const row={...structuredClone(p),id:randomUUID(),run_id:f.run.id,workspace_id:f.run.workspace_id,status:'submitting' as const satisfies LabelingCallV1<SignalListeningInputV1>['status'],provider:'typesafe',model:'jev-1.13.0',transport:'sync',
  request_storage_key:null,raw_sha256:null,raw_storage_key:null,raw_size_bytes:null,raw_storage_verified_at:null,raw_storage_verified_key:null,
  provider_batch_id:null,usage:null,results:null,settled_micro_usd:null,terminal_exposure_micro_usd:'0',stop_reason:null,refusal_category:null,results_applied:false};
  Object.defineProperty(row,'custom_id',{get(){reads++;return p.custom_id;},enumerable:true});return row satisfies Omit<LabelingCallV1<SignalListeningInputV1>,'raw_body'>;
 }).reverse();
 const normalized=validateNativeListeningAdmissionRowsV1(f.run,selected,rows,'submitting');
 assert.deepEqual(normalized.map(row=>row.id),rows.slice().reverse().map(row=>row.id));
 assert.ok(reads<=5*selected.length,'linear identity reads even with a reversed complete cohort');
});


test('survey storage is a separate bounded metadata model and does not retain definition text or share repeated hints for free',()=>{
 const f=fixture(),one=signalListeningInputSurveyStorageBoundV1(f.run,1),full=signalListeningInputSurveyStorageBoundV1(f.run,4096);
 assert.ok(Number.isSafeInteger(one)&&one>0);assert.ok(full>one*1000&&full<512*1024*1024);
 const changed=structuredClone(f.run);const configuration=changed.identity.params.configuration as {instructions:string};configuration.instructions+=' Additional unchanged-schema instructions.';
 assert.equal(signalListeningInputSurveyStorageBoundV1(changed,4096),full,'only bounded hint fields, never question definitions/instructions');
 const metadataOnly=structuredClone(f.run),raw=metadataOnly.identity.params.configuration as {questions:Array<{key:string;text:string}>};
 Object.defineProperty(raw.questions[0]!,'text',{get(){throw Error('pricing must not traverse or clone definitions');},enumerable:true});
 assert.equal(signalListeningInputSurveyStorageBoundV1(metadataOnly,4096),full);
 let invoked=0;Object.defineProperty(raw.questions[0]!,'key',{get(){invoked++;return 'poison';},enumerable:true});
 assert.throws(()=>signalListeningInputSurveyStorageBoundV1(metadataOnly,4096),/bounds_invalid/);assert.equal(invoked,0);
 for(const n of [0,-1,4097,1.5,NaN])assert.throws(()=>signalListeningInputSurveyStorageBoundV1(f.run,n),/bounds_invalid/);
});


function compactReturnFixture(){
 const f=fixture(),selected=f.proposals.slice(0,2),plan=planNativeListeningAdmissionPacketV1(f.run,selected,1024);assert.ok(plan);
 const rows=selected.map(p=>({id:randomUUID(),custom_id:p.custom_id,request_digest:p.request_digest,reserved_micro_usd:'37',retry_depth:0,
  run_id:f.run.id,workspace_id:f.run.workspace_id,status:'submitting',provider:'typesafe',model:'jev-1.13.0',transport:'sync',payload_matches:true,
  request_storage_key:null,raw_sha256:null,raw_storage_key:null,raw_size_bytes:null,raw_storage_verified_at:null,raw_storage_verified_key:null,
  provider_batch_id:null,usage:null,results:null,settled_micro_usd:null,terminal_exposure_micro_usd:'0',stop_reason:null,refusal_category:null,results_applied:false,
  created_at:new Date('2026-11-20T00:00:00.000Z'),updated_at:new Date('2026-11-20T00:00:00.000Z')}));
 return{...f,selected,plan,rows};
}
test('compact RETURNING proves full original packet equality before reconstructing private immutable provider bodies',()=>{
 const f=compactReturnFixture(),calls=reconstructNativeListeningAdmissionRowsV1(f.run,f.plan,f.selected,f.rows.slice().reverse(),'submitting');
 assert.deepEqual(calls.map(c=>c.id),f.rows.map(r=>r.id));assert.deepEqual(calls.map(c=>c.request),f.selected.map(p=>p.request));
 assert.notEqual(calls[0]!.request,f.selected[0]!.request);assert.notEqual(calls[0]!.inputs,f.selected[0]!.inputs);
 assert.ok(calls.every(c=>c.raw_body===null&&c.created_at instanceof Date&&!Object.hasOwn(c,'payload_matches')));
 for(const flag of [false,undefined,null,'true',1]){const bad=structuredClone(f.rows);Object.assign(bad[0]!,{payload_matches:flag});assert.throws(()=>reconstructNativeListeningAdmissionRowsV1(f.run,f.plan,f.selected,bad,'submitting'));}
 for(const key of ['request','inputs']){const bad=structuredClone(f.rows)as Array<Record<string,unknown>>;bad[0]![key]={poison:true};assert.throws(()=>reconstructNativeListeningAdmissionRowsV1(f.run,f.plan,f.selected,bad,'submitting'));}
 // Original packet's SQL true flag cannot authorize a mutation during await.
 f.selected[0]!.request.state='poison after SQL';assert.throws(()=>reconstructNativeListeningAdmissionRowsV1(f.run,f.plan,f.selected,f.rows,'submitting'),/selection_invalid/);
});

test('compact reconstruction preserves PG JSONB key ordering and numeric round trips before JSON.stringify transport',()=>{
 const f=fixture(),original=f.proposals[0]!;
 const input={...original.inputs[0]!,extra:{'zz':1e-7,'a':-0,'é':1e20,'z':.25,'10':'ten','2':'two'}};
 const proposal={...original,inputs:[input]};
 const plan=planNativeListeningAdmissionPacketV1(f.run,[proposal],1024);assert.ok(plan);
 const baseline=compactReturnFixture().rows[0]!;const row={...baseline,custom_id:proposal.custom_id,request_digest:proposal.request_digest,run_id:f.run.id,workspace_id:f.run.workspace_id};
 const call=reconstructNativeListeningAdmissionRowsV1(f.run,plan,[proposal],[row],'submitting')[0]!;
 assert.deepEqual(Object.keys(call.inputs[0]!.extra),['2','10','a','z','zz','é']);
 assert.equal(Object.is(call.inputs[0]!.extra.a,-0),false);
 assert.deepEqual(Object.keys(call.request),['model','state','questions']);
 assert.deepEqual(call.inputs,JSON.parse(JSON.stringify([input])));
});
