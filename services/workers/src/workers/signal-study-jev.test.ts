import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {
 SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1,buildSignalStudyExecutionConfigurationV1,
 buildSignalStudyConfiguredAxesRequestV1,signalListeningBaseTemplateV1,signalStudyJevAxesConfigurationV1,signalStudyJevIdentityV1,
 validateSignalStudyJevBindingV1,validateSignalStudyJevRequestV1,signalStudyJevQuestionDigestV1,signalStudyJevTargetDigestV1,
 signalListeningCalibrationShapeV1,labelerDigestV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalStudyV1,type SignalStudyJevBindingV1,type SignalListeningCalibrationProfileV1,
} from '@noisia/query-engine';
import {buildLabelingRawPageV1,parseLabelingRawPageV1,LABELING_INPUT_MAX_WORKING_BYTES_V1,type LabelingRunV1,type LabelingCallV1} from '@noisia/db';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {buildWorkspaceEngineStorageKeyV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {createSignalStudyJevDriverV1,type StudyJevInputV1,type StudyJevResultV1,type StudyJevStoreV1,type StudyJevNativeAdapterV1} from './signal-study-jev';
const sha=(text:string|Buffer)=>'sha256:'+createHash('sha256').update(text).digest('hex');
function fixture(count=12,measured=true,streamBytes=8*1024*1024){
 const workspace_id=randomUUID(),execution_id=randomUUID(),run_id=randomUUID(),batch_id=randomUUID(),actor_user_id=randomUUID();
 const template={...structuredClone(SIGNAL_STUDY_TB_TEMPLATE_V1),version:'saved-driver-v2',instructions:'  Exact saved café ☕ instructions.  '};
 const snapshot=createSignalStudyTemplateSnapshotV1({template,roles:SIGNAL_STUDY_TB_ROLES_V1,provenance:'human',revision:2,human_locked:true});
 const listening=signalListeningBaseTemplateV1({category:'synthetic bicycles',lexicon_terms:['bicycle']});
 const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id,corpus_id:randomUUID(),listening_configuration_id:randomUUID(),listening_configuration_digest:digest(listening),
  methodology:{key:'triggers_barriers',version:template.version,template_digest:snapshot.template_digest},subject:{kind:'category',name:'synthetic bicycles',category:'synthetic bicycles',own_brand:'Synthetic',competitors:[],alternatives:[]},
  business_question:'Synthetic force?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:2};
 const configuration=buildSignalStudyExecutionConfigurationV1({study,template_snapshot:snapshot,source_listening:{configuration_id:study.listening_configuration_id,configuration_digest:study.listening_configuration_digest,configuration:listening}});
 const stage_configuration=signalStudyJevAxesConfigurationV1(configuration),requests=Array.from({length:count},(_,i)=>{
  const root_id=randomUUID(),text=`row_${String(i).padStart(3,'0')} I enjoy a bicycle ☕`,request_body=JSON.stringify(buildSignalStudyConfiguredAxesRequestV1({text},configuration));return{root_id,request_body,request_sha256:sha(request_body)};
 });
 const full={contract_version:'signal-study-jev-batch-v1',execution_id,workspace_id,source_digest:digest('sealed-source'),stage:'axes',model:'jev-1.13.0',stage_configuration,stage_configuration_digest:digest(stage_configuration),stage_dependencies:[],requests};
 const binding:SignalStudyJevBindingV1={contract_version:'signal-study-jev-native-binding-v1',scope:'study',batch_id,run_id,actor_user_id,configuration,stage_configuration,
  plan:{contract_version:'signal-study-jev-plan-header-v1',execution_id,workspace_id,source_digest:full.source_digest,stage:'axes',model:'jev-1.13.0',stage_configuration_digest:digest(stage_configuration),stage_dependencies:[],request_count:count,plan_digest:digest(full)},
  human_revision_digest:digest('human-revision'),policy_version_id:randomUUID(),entity_context_digest:digest('context'),stage_checkpoint:{id:randomUUID(),digest:digest('persisted-stage')},labeler_digest:''};
 binding.labeler_digest=labelerDigestV1(signalStudyJevIdentityV1(binding));
 const inputs:StudyJevInputV1[]=requests.map(row=>{const request=JSON.parse(row.request_body);return{scope:'study',root_id:row.root_id,input_digest:sha(request.state),text:request.state,
  title:null,platform:'synthetic',content_type:'post',author:null,published_at:'2026-01-01T00:00:00Z',language:'en',map_id:randomUUID(),question_keys:Object.keys(request.questions),
  question_digests:Object.fromEntries(Object.keys(request.questions).map(key=>[key,signalStudyJevQuestionDigestV1(binding,key)])),scope_basis:{},configuration_digest:digest(stage_configuration),
  batch_id,plan_digest:binding.plan.plan_digest,request_body:row.request_body,request_sha256:row.request_sha256,target_digest:signalStudyJevTargetDigestV1(configuration)};});
 const run:LabelingRunV1={id:run_id,workspace_id,actor_user_id,kind:'mass_labeling',labeler_digest:binding.labeler_digest,identity:signalStudyJevIdentityV1(binding),entity_context_digest:binding.entity_context_digest,
  entity_context_version_no:1,context:{}as never,lease_token:randomUUID(),cursor_root_id:null,cap_micro_usd:'100000000',processing_admission_id:randomUUID(),status:'running',error_code:null};
 const calls:LabelingCallV1<StudyJevInputV1>[]=[],results:StudyJevResultV1[]=[],pages:ReturnType<typeof buildLabelingRawPageV1>[]=[],objects=new Map<string,Buffer>(),http:string[]=[],events:string[]=[],memory:number[]=[],readBounds:unknown[]=[];
 let onHttp:(()=>void)|undefined,errorObserved:number|undefined;
 let active=0,peak=0,truncatedResponse=false,failResponse=false,rawAck=false,applyAck=false,revoked=false,derived=0,claims=0,profile:SignalListeningCalibrationProfileV1|null=null;
 const shape=signalListeningCalibrationShapeV1(stage_configuration,inputs[0]!),bytes=Buffer.byteLength(requests[0]!.request_body);
 const profileOf=(ids:string[],min=bytes,max=bytes):SignalListeningCalibrationProfileV1=>({scope:{workspace_id,configuration_digest:digest(stage_configuration),model:shape.model,compiler_version:shape.compiler_version,phase:shape.phase,shape_digest:shape.shape_digest},
  scope_digest:digest({workspace_id,stage:'study',shape:shape.shape_digest}),source_digest:digest(ids),source_call_ids:ids,source_run_id:run_id,request_min_bytes:min,request_max_bytes:max,max_input_tokens_per_byte:.25,sample_count:ids.length,status:'measured'});
 if(measured)profile=profileOf(Array.from({length:32},()=>randomUUID()));
 const storage:WorkspaceEngineStorageV1={assertReady:async()=>{events.push('storage-ready');},put:async args=>{
  const value=await readFile(args.file);assert.equal(sha(value),args.sha256);assert.equal(value.length,args.size_bytes);
  const storage_key=buildWorkspaceEngineStorageKeyV1(args.workspace_id,args.execution_id,basename(args.file),args.sha256);objects.set(storage_key,value);events.push('upload');
  return{storage_key,sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};},
  get:async args=>{const value=objects.get(args.stored.storage_key);assert.ok(value);await writeFile(args.destination,value);events.push('readback');}};
 const authority=()=>{if(revoked)throw Object.assign(Error('labeling_context_changed'),{code:'labeling_context_changed'});};
 let rawPages:Parameters<StudyJevNativeAdapterV1['createStore']>[0]['raw_pages'];
 const hydrate=async(call:typeof calls[number])=>{
  if(call.raw_page_id&&!call.results_applied){const page=pages.find(p=>p.page_id===call.raw_page_id)!;
   const raw_text=await rawPages.load({workspace_id,run_id,page_id:page.page_id,storage_key:rawPages.reference({workspace_id,run_id,page_id:page.page_id,name:page.name,raw_sha256:page.raw_sha256,size_bytes:page.size_bytes}).storage_key,sha256:page.raw_sha256,size_bytes:page.size_bytes});
   call.raw_body=parseLabelingRawPageV1({workspace_id,run_id,raw_text,raw_sha256:page.raw_sha256,size_bytes:page.size_bytes,members:page.members}).get(call.id)!;
  }return call;
 };
 const store={claim:async()=>{claims++;return run;},renew:async()=>{authority();},release:async()=>{events.push('release');},
  calls:async(_run:unknown,query?:{metadata_only?:boolean;call_ids?:string[]})=>{
   const selected=calls.filter(c=>!c.results_applied&&(!query?.call_ids||query.call_ids.includes(c.id)));
   if(query?.metadata_only)return selected.map(c=>({...c,request:{},inputs:[],raw_body:null,has_raw:Boolean(c.raw_page_id),request_size_bytes:Buffer.byteLength(JSON.stringify(c.request)),input_size_bytes:Buffer.byteLength(JSON.stringify(c.inputs))}));
   return Promise.all(selected.map(hydrate));
  },
  inputs:async(_run:unknown,bounds:{max_rows:number;max_working_bytes:number})=>{authority();assert.ok(bounds&&bounds.max_rows>0&&bounds.max_working_bytes>0);
   if(bounds.max_working_bytes>LABELING_INPUT_MAX_WORKING_BYTES_V1)throw Error('labeling_input_bounds_invalid');readBounds.push(bounds);
   const selected=inputs.filter(i=>!calls.some(c=>c.inputs[0]!.root_id===i.root_id));let bytes=0;return selected.slice(0,bounds.max_rows).filter(i=>{bytes+=Buffer.byteLength(JSON.stringify(i))*8+8192;return bytes<=bounds.max_working_bytes;});},
  reserve:async(_run:unknown,proposals:Array<Record<string,unknown>>)=>{authority();events.push('reserve');const rows=proposals.map(p=>({...p,id:randomUUID(),status:'reserved',raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0}))as typeof calls;calls.push(...rows);return rows;},
  markSubmitting:async(_run:unknown,rows:typeof calls)=>{authority();events.push('mark');for(const c of rows)c.status='submitting';},
  requeueUnsent:async(_run:unknown,rows:typeof calls)=>{for(const c of rows)c.status='reserved';},
  persistRaw:async()=>{throw Error('per-root blob forbidden');},persistRawPage:async(_run:unknown,rows:Array<{call:typeof calls[number];raw:string}>)=>{
   const built=buildLabelingRawPageV1({workspace_id,run_id,receipts:rows.map(r=>({call_id:r.call.id,request_digest:r.call.request_digest,raw:r.raw}))});pages.push(built);
   const stored=await rawPages.store({workspace_id,run_id,page_id:built.page_id,name:built.name,raw_sha256:built.raw_sha256,size_bytes:built.size_bytes,raw_text:built.raw_text});
   const text=await rawPages.load({workspace_id,run_id,page_id:built.page_id,storage_key:stored.storage_key,sha256:stored.sha256,size_bytes:stored.size_bytes});
   const decoded=parseLabelingRawPageV1({workspace_id,run_id,raw_text:text,raw_sha256:built.raw_sha256,size_bytes:built.size_bytes,members:built.members});
   for(const r of rows){r.call.raw_body=decoded.get(r.call.id)!;r.call.raw_page_id=built.page_id;r.call.raw_page_size_bytes=built.size_bytes;r.call.has_raw=true;}
   events.push('durable-page');if(rawAck){rawAck=false;throw Error('lost raw ACK');}
  },
  settlePage:async(_run:unknown,rows:Array<{call:typeof calls[number]}>)=>{authority();if(failResponse&&errorObserved===undefined)errorObserved=http.length;events.push('settle-page');for(const r of rows){assert.ok(r.call.raw_page_id);r.call.status='settled';}},
  apply:async(_run:unknown,rows:Array<{call:typeof calls[number];results:StudyJevResultV1[]}>)=>{authority();events.push('apply-page');for(const r of rows){results.push(...r.results);r.call.results_applied=true;}if(applyAck){applyAck=false;throw Error('lost apply ACK');}},
  markFailed:async(_run:unknown,rows:typeof calls,unknown:boolean)=>{for(const c of rows)if(c.status!=='settled')c.status=unknown?'unknown':'failed';},
  fail:async(_run:unknown,code:string)=>{run.error_code=code;run.status='failed';},refresh:async()=>run,
  finish:async()=>{run.status=calls.some(c=>c.status==='unknown'&&!c.results_applied)?'failed':results.filter(r=>r.status==='labeled').length===inputs.length?'completed':'running';return run.status;},
 }as unknown as StudyJevStoreV1;
 const adapter:StudyJevNativeAdapterV1={load:async()=>binding,createStore:args=>{rawPages=args.raw_pages;return store;},loadCalibration:async()=>profile,
  deriveCalibration:async()=>{derived++;const valid=calls.filter(c=>c.status==='settled'&&c.results_applied);if(valid.length){const sizes=valid.map(c=>Buffer.byteLength(JSON.stringify(c.request)));profile=profileOf(valid.map(c=>c.id).slice(0,32),Math.min(...sizes),Math.max(...sizes));}}};
 const env={TYPESAFE_API_KEY:'synthetic',NOISIA_JEV_STREAMING_V2_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_TYPESAFE_ACCOUNT_ID:'synthetic-study-account',NOISIA_TYPESAFE_ACCOUNT_RPS:'80',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'100000',NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:'must-not-be-authority'};
 const redisKeys:string[]=[];
 const driver=createSignalStudyJevDriverV1({adapter,storage,env,execution:{max_in_flight:4,window_size:4,flush_size:4,max_flushes:2,max_buffered_bytes:streamBytes,flush_interval_ms:60000},
  observe_stream:m=>memory.push(m.reserved_working_bytes),provider_factory:args=>createCalibratedJevRuntimeProviderV2({...args,
   evaluateRedis:async(_script,keys,values)=>{redisKeys.push(...keys);return['acquire','observe','throttle'].includes(values[0]!)?[1,0]:'0';},fetch:async(_url,init)=>{
    const body=String(init?.body);assert.ok(requests.some(r=>r.request_body===body));assert.ok(events.includes('storage-ready'));http.push(body);onHttp?.();active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));active--;const request=JSON.parse(body);
    if(truncatedResponse)return new Response('{"model":"jev-1.13.0","usage":',{status:200});
    if(failResponse)return Response.json({model:request.model,usage:{input_tokens:10,output_tokens:0},answers:{}});
    return Response.json({model:request.model,usage:{input_tokens:10,output_tokens:0},answers:Object.fromEntries(Object.entries(request.questions as Record<string,{type:string;criteria:Record<string,unknown>}>).map(([key,q])=>{
     if(q.type==='noul')return[key,{type:'noul',noul:.9}];const options=Object.keys(q.criteria),selected=options[0]!;return[key,{type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(options.map(k=>[k,k===selected?1:0]))}];}))});
   }})});
 const lease={execution_id,workspace_id,execution_token:randomUUID(),source_digest:full.source_digest,configuration_digest:digest(configuration),human_revision_digest:binding.human_revision_digest};
 const args={lease,batch_id,plan_digest:binding.plan.plan_digest,signal:new AbortController().signal,should_stop:()=>false};
 return{binding,inputs,requests,run,adapter,storage,driver,args,calls,results,pages,http,events,memory,readBounds,redisKeys,env,
  get errorObserved(){return errorObserved;},set onHttp(fn:(()=>void)|undefined){onHttp=fn;},get peak(){return peak;},get derived(){return derived;},get claims(){return claims;},set rawAck(v:boolean){rawAck=v;},set applyAck(v:boolean){applyAck=v;},set failResponse(v:boolean){failResponse=v;},set truncatedResponse(v:boolean){truncatedResponse=v;},set revoked(v:boolean){revoked=v;}};
}

test('real shared H1 coroutines use one native lease, account factory, bounded continuation and verified codec pages',async()=>{
 const f=fixture();await f.driver(f.args);assert.equal(f.results.length,12);assert.ok(f.peak>=2);assert.ok(f.peak<=4);assert.equal(f.claims,1);
 assert.ok(f.pages.some(p=>p.members.length>1));assert.ok(f.pages.length<12);assert.ok(f.memory.every(m=>m>=0&&m<=8*1024*1024));assert.equal(f.memory.at(-1),0);
 assert.ok(f.readBounds.length>=2);assert.ok(f.redisKeys.some(k=>k.startsWith('noisia:jev-account:{')));assert.equal(f.env.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON,'must-not-be-authority');
 for(const body of f.http){assert.match(body,/  Exact saved café ☕ instructions\.  /u);const keys=Object.keys(JSON.parse(body).questions);assert.equal(keys.includes('voice'),false);assert.equal(keys.includes('promotion'),false);}
 assert.ok(f.events.indexOf('durable-page')<f.events.indexOf('settle-page'));assert.ok(f.events.indexOf('settle-page')<f.events.indexOf('apply-page'));
 const paid=f.http.length;await f.driver(f.args);assert.equal(f.http.length,paid);assert.equal('requests'in f.binding.plan,false,'driver binding never retains the corpus request roster');
});
test('missing calibration uses only ordinary pending labels, then verified receipts unlock shared concurrency',async()=>{
 const f=fixture(8,false);await f.driver(f.args);assert.equal(f.http.length,4);assert.ok(f.peak>=2);assert.ok(f.peak<=4);assert.equal(f.derived,1);
 await f.driver(f.args);assert.equal(f.results.length,8);assert.ok(f.peak>=2);assert.equal(new Set(f.http).size,8);
});
test('native source/identity/plan/input/target mismatches stop before physical requests',async()=>{
 for(const mutation of [
  (f:ReturnType<typeof fixture>)=>{f.binding.labeler_digest=digest('wrong');},
  (f:ReturnType<typeof fixture>)=>{f.args.plan_digest=digest('caller-plan');},
  (f:ReturnType<typeof fixture>)=>{f.run.identity.model='other';},
  (f:ReturnType<typeof fixture>)=>{f.inputs[0]!.request_sha256=digest('wrong-row');},
  (f:ReturnType<typeof fixture>)=>{f.inputs[0]!.target_digest=digest('different-target');},
 ]){const f=fixture();mutation(f);await assert.rejects(f.driver(f.args),/study_jev_/);assert.equal(f.http.length,0);}
 const f=fixture();f.revoked=true;await assert.rejects(f.driver(f.args),/labeling_context_changed/);assert.equal(f.http.length,0);
});
test('page upload ACK loss recovers codec bytes without a provider key or a second physical attempt',async()=>{
 const f=fixture(4);f.rawAck=true;await assert.rejects(f.driver(f.args),/lost raw ACK/);const physical=f.http.length;assert.ok(physical>0);
 f.env.TYPESAFE_API_KEY='';await f.driver(f.args);assert.equal(f.http.length,physical);assert.equal(f.results.length,4);assert.equal(f.pages.length,1);
});
test('unknown semantic response preserves usage and page custody, closes feed and never retries',async()=>{
 const f=fixture(40);f.failResponse=true;await f.driver(f.args);const physical=f.http.length;assert.equal(physical,f.errorObserved,'no new physical sends after semantic rejection is observed');assert.ok(f.pages.length>0);assert.equal(f.results.filter(r=>r.status==='labeled').length,0);
 await f.driver(f.args);assert.equal(f.http.length,physical);
});
test('axes stage is exact persisted data; base questions and byte/SHA or question tampering are rejected',()=>{
 const f=fixture(1);assert.equal(validateSignalStudyJevBindingV1(f.binding),f.binding);
 const row=f.requests[0]!;assert.equal(JSON.stringify(validateSignalStudyJevRequestV1(f.binding,row)),row.request_body);
 const stage=structuredClone(f.binding);stage.stage_configuration.instructions='Replacement defaults';stage.labeler_digest=labelerDigestV1(signalStudyJevIdentityV1(stage));assert.throws(()=>validateSignalStudyJevBindingV1(stage),/binding_invalid/);
 const altered=JSON.parse(row.request_body);altered.questions.voice=altered.questions.study_direction;const body=JSON.stringify(altered);
 assert.throws(()=>validateSignalStudyJevRequestV1(f.binding,{...row,request_body:body,request_sha256:sha(body)}),/binding_invalid/);
 assert.throws(()=>validateSignalStudyJevRequestV1(f.binding,{...row,request_sha256:digest('different')}),/binding_invalid/);
});

test('H1 external cancellation requeues genuinely unsent calls and drains the physical sibling without a resend',async()=>{
 const f=fixture(4),control=new AbortController();f.args.signal=control.signal;f.onHttp=()=>{if(f.http.length===1)control.abort();};
 await f.driver(f.args);assert.equal(f.http.length,1);assert.equal(f.results.filter(r=>r.status==='labeled').length,1);assert.equal(f.results.filter(r=>r.status==='error').length,0);
 assert.ok(f.calls.some(c=>c.status==='reserved'));f.onHttp=undefined;f.args.signal=new AbortController().signal;await f.driver(f.args);
 assert.equal(f.results.length,4);assert.equal(f.http.length,4);assert.equal(new Set(f.http).size,4);
});
test('lost page application ACK reuses settled applied results; no duplicate HTTP or per-root blob',async()=>{
 const f=fixture(4);f.applyAck=true;await assert.rejects(f.driver(f.args),/lost apply ACK/);const paid=f.http.length;
 await f.driver(f.args);assert.equal(f.http.length,paid);assert.equal(f.results.length,4);assert.equal(f.pages.length,1);
});

test('incomplete provider JSON is durable in the native page codec and never authorizes another HTTP attempt',async()=>{
 const f=fixture(4);f.truncatedResponse=true;await f.driver(f.args);const paid=f.http.length;assert.ok(paid>0);assert.ok(f.pages.length>0);
 const p=f.pages[0]!,decoded=parseLabelingRawPageV1({workspace_id:f.binding.plan.workspace_id,run_id:f.binding.run_id,raw_text:p.raw_text,raw_sha256:p.raw_sha256,size_bytes:p.size_bytes,members:p.members});
 for(const wrapper of decoded.values())assert.equal(JSON.parse(wrapper).body,'{"model":"jev-1.13.0","usage":');
 await f.driver(f.args);assert.equal(f.http.length,paid);assert.equal(f.results.filter(r=>r.status==='labeled').length,0);
});


test('Study separates larger stream custody from native initial and feed read budgets without changing request bytes or raw settlement',async()=>{
 const f=fixture(12,true,2*1024**3);await f.driver(f.args);
 assert.equal(f.run.status,'completed');assert.equal(f.http.length,12);assert.equal(f.calls.length,12);assert.equal(f.results.length,12);
 assert.deepEqual(f.http,f.requests.map(r=>r.request_body));assert.ok(f.calls.every(c=>c.status==='settled'&&c.results_applied&&c.raw_page_id));
 const reads=f.readBounds as Array<{max_rows:number;max_working_bytes:number;on_oversize?:string}>;
 assert.ok(reads.length>1);assert.equal(reads[0]!.max_rows,4);assert.equal(reads[0]!.max_working_bytes,LABELING_INPUT_MAX_WORKING_BYTES_V1);
 assert.equal(reads[0]!.on_oversize,'error');assert.ok(reads.slice(1).some(r=>r.on_oversize==='empty'));
 assert.ok(reads.every(r=>r.max_rows<=4&&r.max_working_bytes<=LABELING_INPUT_MAX_WORKING_BYTES_V1));
 assert.ok(f.events.indexOf('durable-page')<f.events.indexOf('settle-page'));
 assert.ok(f.events.indexOf('settle-page')<f.events.indexOf('apply-page'));
});
