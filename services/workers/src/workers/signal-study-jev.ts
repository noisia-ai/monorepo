import {createHash} from 'node:crypto';
import {
 validateSignalStudyJevBindingV1,validateSignalStudyJevRequestV1,signalStudyJevIdentityV1,signalStudyJevTargetDigestV1,signalStudyJevQuestionDigestV1,
 labelerDigestV1,llmPriceV1,llmCostMicroUsdV1,signalListeningCalibrationShapeV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalStudyJevBindingV1,type SignalListeningInputV1,type SignalListeningResultV1,type SignalListeningCalibrationProfileV1,
} from '@noisia/query-engine';
import type {createSignalLabelingStoreV1,LabelingRunV1,LabelingCallV1} from '@noisia/db';
import {processJevLabelingPageV1,jevUsageV1,type JevPreparedExecutionV1} from './signal-jev-labeling-page';
import {assertJevStreamingExecutionV2,type JevStreamingExecutionV2,type JevStreamingMetricsV2} from './signal-jev-streaming-window';
import {jevStreamingExecutionFromEnvV2,createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1,type JevRequestV1} from '../providers/typesafe-jev';
import {createSignalListeningCalibratedProviderV1,planSignalListeningCalibrationV1} from './signal-listening-calibration';
import {listeningHasRawV1,selectSignalListeningRecoveryV1,createSignalListeningRecoveryProviderV1} from './signal-listening-recovery';
import {createLabelingRawPagesStorageV1} from './signal-labeling-receipt-storage';
import type {WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import type {StudyRuntimeDriversV1,StudyRuntimeLeaseV1} from './signal-study-runtime';

export type StudyJevInputV1=SignalListeningInputV1&{scope:'study';batch_id:string;plan_digest:string;request_sha256:string;request_body:string;target_digest:string};
export type StudyJevResultV1=SignalListeningResultV1&{scope:'study';batch_id:string;plan_digest:string;request_sha256:string;target_digest:string};
export type StudyJevStoreV1=ReturnType<typeof createSignalLabelingStoreV1<StudyJevInputV1,StudyJevResultV1>>;
export type StudyJevNativeAdapterV1={
 /** Native FK batch→run and current parent lease/actor/policy/human/source. Read
  * never creates a run, calls, credit authority, or an implicit configuration. */
 load(args:{lease:StudyRuntimeLeaseV1;batch_id:string;plan_digest:string}):Promise<SignalStudyJevBindingV1|null>;
 /** Every CAS verifies immutable owner/source/call lineage. New admission and
  * final apply additionally check current policy/human/parent validity; observed
  * raw custody and money settlement must remain reconcilable after revocation
  * without authorizing another physical send. inputs
  * reads IDs/octet lengths BEFORE hydration, excludes cached/reserved identities,
  * calls(metadata_only) exposes unknown/planned raw globally without loading it.
  * persistRawPage must use the supplied verified page writer; persistRaw is forbidden. */
 createStore(args:{binding:SignalStudyJevBindingV1;raw_pages:ReturnType<typeof createLabelingRawPagesStorageV1>}):StudyJevStoreV1;
 /** STUDY-specific settled+applied+verified receipt lineage, never H2 DB helpers
  * (their owner/identity guards differ), env profiles or browser estimates. */
 loadCalibration(args:{binding:SignalStudyJevBindingV1;run:Readonly<LabelingRunV1>;shape_digest:string}):Promise<SignalListeningCalibrationProfileV1|null>;
 deriveCalibration(args:{binding:SignalStudyJevBindingV1;run:Readonly<LabelingRunV1>;shape_digest:string}):Promise<void>;
};
function fail(code:string):never{throw Error('study_jev_'+code);}
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
const inputKey=(i:StudyJevInputV1)=>digest({root_id:i.root_id,input_digest:i.input_digest,question_digests:i.question_digests});

/** Actual H1 page coroutine driver. The still-required native Study adapter owns
 * admission, cache, durable pages, money and final source/human/policy CAS. There
 * is deliberately no default DB adapter, registration, provider override or new
 * per-root blob/ledger implementation in this module. */
export function createSignalStudyJevDriverV1(options:{adapter:StudyJevNativeAdapterV1;storage:WorkspaceEngineStorageV1;
 execution?:JevStreamingExecutionV2;env?:NodeJS.ProcessEnv;lease_renewal_ms?:number;
 provider_factory?:typeof createCalibratedJevRuntimeProviderV2;observe_stream?:(metrics:JevStreamingMetricsV2)=>void}):StudyRuntimeDriversV1['runJevBatch']{
 return async args=>{
  const binding=await options.adapter.load(args);if(!binding)return;
  validateSignalStudyJevBindingV1(binding);
  const p=binding.plan,lease=args.lease;
  if(binding.batch_id!==args.batch_id||p.plan_digest!==args.plan_digest||p.execution_id!==lease.execution_id||p.workspace_id!==lease.workspace_id
   ||p.source_digest!==lease.source_digest||digest(binding.configuration)!==lease.configuration_digest||binding.human_revision_digest!==lease.human_revision_digest)fail('owner_changed');
  const env=options.env??process.env,execution=options.execution??jevStreamingExecutionFromEnvV2(env);if(!execution)fail('streaming_required');
  const store=options.adapter.createStore({binding,raw_pages:createLabelingRawPagesStorageV1(options.storage)});
  const configuration=binding.stage_configuration,target=signalStudyJevTargetDigestV1(binding.configuration),identity=signalStudyJevIdentityV1(binding);
  function guard(run:LabelingRunV1){
   if(run.id!==binding!.run_id||run.workspace_id!==p.workspace_id||run.actor_user_id!==binding!.actor_user_id||run.kind!=='mass_labeling'
    ||run.entity_context_digest!==binding!.entity_context_digest||run.labeler_digest!==binding!.labeler_digest
    ||labelerDigestV1(run.identity)!==labelerDigestV1(identity))fail('identity_invalid');
  }
  function request(input:StudyJevInputV1):JevRequestV1{
   if(input.scope!=='study'||input.batch_id!==binding!.batch_id||input.plan_digest!==p.plan_digest
    ||input.configuration_digest!==digest(configuration)||input.target_digest!==target||sha(input.request_body)!==input.request_sha256)fail('input_binding_invalid');
   const value=validateSignalStudyJevRequestV1(binding!,{root_id:input.root_id,request_body:input.request_body,request_sha256:input.request_sha256});
   if(value.state!==input.text||Object.keys(value.questions).sort().join(',')!==[...input.question_keys].sort().join(',')
    ||input.question_keys.some(key=>input.question_digests[key]!==signalStudyJevQuestionDigestV1(binding!,key)))fail('input_binding_invalid');
   return value;
  }
  let selection:StudyJevInputV1[]|undefined,selectionPending=false,windowSize=execution.window_size,metadata:LabelingCallV1<StudyJevInputV1>[]|undefined;
  let recovery:ReturnType<typeof selectSignalListeningRecoveryV1>,hydrated:LabelingCallV1<StudyJevInputV1>[]|undefined;
  let calibrated:ReturnType<typeof createSignalListeningCalibratedProviderV1>|undefined,recoveryProvider:JevProviderV1|undefined;
  let calibrationRun:Readonly<LabelingRunV1>|undefined,shapes:string[]=[];
  const unavailable:JevProviderV1={max_response_bytes:16384,async evaluate(){throw new JevProviderErrorV1('study_jev_preparation_required','definitely_not_sent');}};
  const shutdown=new AbortController(),stoppedError=Error('study_jev_stopped');
  const externalSignal=AbortSignal.any([args.signal,shutdown.signal]);
  const stopped=()=>externalSignal.aborted||args.should_stop();
  const stopTimer=setInterval(()=>{if(args.should_stop())shutdown.abort();},20);stopTimer.unref?.();
  const select=(inputs:StudyJevInputV1[])=>{
   if(stopped())return[];const available=new Map(inputs.map(i=>[inputKey(i),i]));
   return(selection??inputs).flatMap(i=>{const found=available.get(inputKey(i));return found?[found]:[];}).slice(0,windowSize);
  };
  const boundedStore:StudyJevStoreV1={...store,
   async calls(run,query){
    guard(run);
    if(query)return store.calls(run,query);
    let rows:LabelingCallV1<StudyJevInputV1>[];
    if(recovery){
     rows=await store.calls(run,{call_ids:recovery.calls.map(c=>c.id)});
     shapes=[...new Set(rows.filter(c=>{try{return c.raw_body&&JSON.parse(c.raw_body).rate_calibration?.kind==='official_context_bound';}catch{return false;}})
      .flatMap(c=>c.inputs).map(i=>signalListeningCalibrationShapeV1(configuration,i).shape_digest))];
     rows=[...rows,...(metadata??[]).filter(c=>c.status==='unknown'&&!listeningHasRawV1(c)&&!rows.some(row=>row.id===c.id))];
    }else rows=hydrated??metadata??await store.calls(run,{metadata_only:true});
    if(!selection)return rows;
    const keys=new Set(selection.map(inputKey));return rows.filter(c=>listeningHasRawV1(c)||c.status==='unknown'||c.inputs.some(i=>keys.has(inputKey(i))));
   },
   async inputs(run,bounds){guard(run);if(selectionPending){selectionPending=false;return selection??[];}return store.inputs(run,bounds??{max_rows:windowSize,max_working_bytes:execution.max_buffered_bytes-assertJevStreamingExecutionV2(execution,unavailable),on_oversize:'error'});},
   async reserve(run,proposals){guard(run);if(stopped()){shutdown.abort();return[];}return store.reserve(run,proposals);},
   async markSubmitting(run,calls){guard(run);if(stopped()){shutdown.abort();throw stoppedError;}return store.markSubmitting(run,calls);},
   async persistRaw(){throw Error('study_jev_page_writer_required');},
  };
  try{
   await processJevLabelingPageV1<StudyJevInputV1,StudyJevResultV1>({run_id:binding.run_id,signal:externalSignal,store:boundedStore,provider:unavailable,execution,
    lease_renewal_ms:options.lease_renewal_ms,observe_stream:options.observe_stream,
    read_next_inputs:(run,bounds)=>{guard(run);return stopped()?(shutdown.abort(),Promise.resolve([])):store.inputs(run,{...bounds,on_oversize:'empty'});},
    prepare:async run=>{
     guard(run);calibrationRun=run;metadata=await store.calls(run,{metadata_only:true});recovery=selectSignalListeningRecoveryV1(metadata,execution);
     if(recovery||metadata.some(c=>c.status==='unknown')||run.error_code==='labeling_outcome_unknown'||stopped()||env.NOISIA_JEV_PROVIDER_ENABLED==='false'||!env.TYPESAFE_API_KEY?.trim()){
      selection=[];recoveryProvider=createSignalListeningRecoveryProviderV1({execution:recovery?.execution??execution,env,factory:options.provider_factory});
      return{provider:recoveryProvider,execution:recovery?.execution??execution,max_windows:1,recovery_only:true};
     }
     if(metadata.length){
      const sorted=[...metadata].sort((a,b)=>Number(a.request_size_bytes??0)-Number(b.request_size_bytes??0)),priority=[sorted[0]!,sorted.at(-1)!,...metadata];
      const ids:string[]=[],seen=new Set<string>();let bytes=0;
      for(const call of priority){if(seen.has(call.id))continue;seen.add(call.id);
       const working=(Number(call.request_size_bytes)+Number(call.input_size_bytes))*4+4096;
       if(!Number.isSafeInteger(working)||working<4096)fail('call_metadata_invalid');if(bytes+working>execution.max_buffered_bytes)continue;
       ids.push(call.id);bytes+=working;if(ids.length>=execution.window_size)break;
      }
      if(!ids.length)fail('recovery_memory_bound');hydrated=await store.calls(run,{call_ids:ids});
     }
     const inputs=metadata.length?hydrated!.flatMap(c=>c.inputs):await store.inputs(run,{max_rows:execution.window_size,
      max_working_bytes:execution.max_buffered_bytes-assertJevStreamingExecutionV2(execution,unavailable),on_oversize:'error'});
     const plan=await planSignalListeningCalibrationV1({workspace_id:run.workspace_id,configuration_digest:digest(configuration),configuration,inputs,execution,
      compile_request:input=>request(input as StudyJevInputV1),loadProfile:shape_digest=>options.adapter.loadCalibration({binding,run,shape_digest})});
     selection=plan.selected_inputs as StudyJevInputV1[];selectionPending=true;windowSize=plan.execution.window_size;shapes=plan.calibration_shapes;
     if(!options.storage.assertReady)fail('storage_preflight_required');await options.storage.assertReady();
     calibrated=createSignalListeningCalibratedProviderV1({plan,env,factory:options.provider_factory});calibrated.prepareRequests(selection.map(request));
     const prepared:JevPreparedExecutionV1={provider:calibrated.provider,execution:plan.execution,...(plan.warmup||metadata.length?{max_windows:1}:{continuous_windows:true})};return prepared;
    },hooks:{
     price:run=>{guard(run);return llmPriceV1('typesafe',run.identity.model,'sync',Number(run.identity.params.input_usd_per_mtok));},
     propose:(run,inputs)=>{guard(run);return select(inputs).map(input=>{
      const value=request(input),request_digest=digest({labeler_digest:run.labeler_digest,root_id:input.root_id,input_digest:input.input_digest,
       request_sha256:input.request_sha256,question_digests:input.question_digests,target_digest:input.target_digest});
      return{custom_id:'study_'+request_digest.slice(7,67),request_digest,request:value,inputs:[input],
       reserved_micro_usd:llmCostMicroUsdV1(jevUsageV1({input_tokens:Buffer.byteLength(JSON.stringify(value))*4+8192,output_tokens:0}),llmPriceV1('typesafe',run.identity.model,'sync',Number(run.identity.params.input_usd_per_mtok)))};
     });},
     map:(run,call,parsed)=>{guard(run);if(call.inputs.length!==1)fail('call_input_invalid');const i=call.inputs[0]!;request(i);
      return[{scope:'study',root_id:i.root_id,input_digest:i.input_digest,entity_context_digest:run.entity_context_digest,status:'labeled',answers:parsed.answers,
       question_digests:{...i.question_digests},batch_id:binding.batch_id,plan_digest:p.plan_digest,request_sha256:i.request_sha256,target_digest:target}];},
     error:(run,call,code)=>{guard(run);return call.inputs.map(i=>({scope:'study',root_id:i.root_id,input_digest:i.input_digest,entity_context_digest:run.entity_context_digest,
      status:'error',answers:{},question_digests:{...i.question_digests},error_code:code,batch_id:binding.batch_id,plan_digest:p.plan_digest,request_sha256:i.request_sha256,target_digest:target}));},
     labeled:r=>r.status==='labeled',fail_on_error:true,
     prepare_next:async(run,inputs)=>{guard(run);if(stopped())return false;const next=inputs.slice(0,execution.window_size);
      function* requests(){for(const input of next)yield request(input);}
      if(!calibrated?.prepareMeasuredRequests(requests()))return false;selection=next;return true;},
    }});
  }catch(error){if(error!==stoppedError)throw error;}finally{
   clearInterval(stopTimer);
   try{if(calibrationRun)for(const shape_digest of shapes)await options.adapter.deriveCalibration({binding,run:calibrationRun,shape_digest});}
   finally{await calibrated?.provider.close?.();await recoveryProvider?.close?.();}
  }
 };
}
