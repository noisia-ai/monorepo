import {setImmediate as yieldToEventLoop} from 'node:timers/promises';
import {
  signalListeningCalibrationShapeV1,signalWorkspaceEmbeddingDigestV1 as digest,
  compileSignalListeningSnapshotV1,readSignalListeningSnapshotV1,buildSignalListeningCompiledRequestV1,createSignalListeningShapeCompilerV1,type SignalListeningCompiledSnapshotV1,
  type SignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningCalibrationProfileV1,
} from '@noisia/query-engine';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1,type JevRequestV1} from '../providers/typesafe-jev';
import {assertJevStreamingExecutionV2,jevCallWorkingBytesV2,type JevStreamingExecutionV2,type JevFeedAdmissionHintV1} from './signal-jev-streaming-window';
import {assertSignalListeningRequestTransportV1,assertSignalListeningMeasuredContextV1,
  signalListeningResponseBoundV1,SIGNAL_LISTENING_HTTP_BODY_BYTES_V1,SIGNAL_LISTENING_CONTEXT_TOKENS_V1,SIGNAL_LISTENING_QUESTION_CONTEXT_TOKENS_V1} from './signal-listening-request-limits';
import type {LabelingCallV1,LabelingInputBoundsV1,SignalListeningInputHintV1,SignalListeningInputSurveyV1} from '@noisia/db';
import type {SignalListeningResultV1} from '@noisia/query-engine';
type Access={workspace_id:string;configuration_digest:string};
type Profile=SignalListeningCalibrationProfileV1;
type LoadProfile=(shape_digest:string)=>Promise<Profile|null>;
const fail=(code:string):never=>{throw new JevProviderErrorV1(code,'definitely_not_sent');};
function validateProfile(profile:Profile,scope:Access,shape:ReturnType<typeof signalListeningCalibrationShapeV1>){
  if(profile.status!=='measured'||profile.scope.workspace_id!==scope.workspace_id
    ||profile.scope.configuration_digest!==scope.configuration_digest||profile.scope.model!==shape.model
    ||profile.scope.compiler_version!==shape.compiler_version||profile.scope.shape_digest!==shape.shape_digest||profile.scope.phase!==shape.phase
    ||!/^sha256:[0-9a-f]{64}$/.test(profile.scope_digest)||!/^sha256:[0-9a-f]{64}$/.test(profile.source_digest)
    ||!Number.isSafeInteger(profile.sample_count)||profile.sample_count<1||profile.sample_count>32
    ||profile.source_call_ids.length!==profile.sample_count||new Set(profile.source_call_ids).size!==profile.sample_count
    ||!Number.isSafeInteger(profile.request_min_bytes)||profile.request_min_bytes<1
    ||!Number.isSafeInteger(profile.request_max_bytes)||profile.request_max_bytes<profile.request_min_bytes
    ||profile.request_max_bytes>SIGNAL_LISTENING_HTTP_BODY_BYTES_V1
    ||!Number.isFinite(profile.max_input_tokens_per_byte)||profile.max_input_tokens_per_byte<=0)
    fail('listening_calibration_profile_invalid');
}
export type SignalListeningCalibrationPlanV1={scope:Access;configuration:SignalListeningConfigurationV1;
  snapshot:SignalListeningCompiledSnapshotV1;selected_inputs:SignalListeningInputV1[];calibration_shapes:string[];
  profiles:Map<string,Profile|null>;execution:JevStreamingExecutionV2;warmup:boolean;response_bound_bytes:number};
/** Only committed, verified receipt profiles can unlock full measured coverage. Missing or
 * out-of-coverage shapes use normal reusable labels in one bounded parallel warmup window. */
export async function planSignalListeningCalibrationV1(args:Access&{configuration:SignalListeningConfigurationV1;
  inputs:SignalListeningInputV1[];execution:JevStreamingExecutionV2;loadProfile:LoadProfile;snapshot?:SignalListeningCompiledSnapshotV1;compile_request?:(input:SignalListeningInputV1)=>JevRequestV1}):Promise<SignalListeningCalibrationPlanV1>{
  if(args.compile_request!==undefined&&typeof args.compile_request!=='function')fail('listening_calibration_compiler_invalid');
  if(digest(args.configuration)!==args.configuration_digest||args.inputs.some(input=>input.configuration_digest!==args.configuration_digest))fail('listening_calibration_configuration_invalid');
  const snapshot=args.snapshot??compileSignalListeningSnapshotV1(args.configuration),state=readSignalListeningSnapshotV1(snapshot);
  if(args.snapshot&&state.configuration_digest!==args.configuration_digest)fail('listening_calibration_configuration_invalid');
  const shapeCompiler=createSignalListeningShapeCompilerV1(snapshot);
  const shapes=new Map(args.inputs.map(input=>{const shape=shapeCompiler.shape(input);return[shape.shape_digest,shape];}));
  const profiles=new Map<string,Profile|null>();
  await Promise.all([...shapes].map(async([id,shape])=>{const profile=await args.loadProfile(id);if(profile)validateProfile(profile,args,shape);profiles.set(id,profile);}));
  // A short finite phase may use its measured N. A newly expanded phase with
  // at least 32 pending roots finishes a full warmup window before concurrency.
  const pendingByShape=new Map<string,number>();
  for(const input of args.inputs){const key=shapeCompiler.shape(input).shape_digest;
    pendingByShape.set(key,(pendingByShape.get(key)??0)+1);}
  for(const [key,profile]of profiles)if(profile&&profile.sample_count<32&&profile.sample_count+(pendingByShape.get(key)??0)>=32)profiles.set(key,null);
  const rows=args.inputs.map((input,index)=>{
    const request=(args.compile_request??(input=>buildSignalListeningCompiledRequestV1(input,snapshot)))(input);
    if(request.model!==args.configuration.model||request.state!==input.text||Object.keys(request.questions).sort().join(',')!==[...input.question_keys].sort().join(','))fail('listening_calibration_compiler_invalid');
    const bytes=assertSignalListeningRequestTransportV1(request);
    const shape=shapeCompiler.shape(input),profile=profiles.get(shape.shape_digest);
    if(profile)assertSignalListeningMeasuredContextV1(request,profile.max_input_tokens_per_byte);
    return{input,index,request,bytes,shape:shape.shape_digest,covered:Boolean(profile&&bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes)};
  });
  const firstUncovered=rows.find(row=>!row.covered),warmup=Boolean(firstUncovered);
  const execution=warmup?{...args.execution,max_in_flight:Math.min(32,args.execution.max_in_flight),window_size:Math.min(32,args.execution.window_size),
    flush_size:Math.min(32,args.execution.flush_size),max_flushes:1}:args.execution;
  let selected=rows.slice(0,execution.window_size);
  if(firstUncovered){
    // Warm one shape at a time. Include pending byte extrema explicitly rather
    // than repeatedly warming a covered prefix while an outlier waits at33.
    // Every anchor is an ordinary pending label, never a probe of cached roots.
    const candidates=rows.filter(row=>row.shape===firstUncovered.shape);
    const sorted=[...candidates].sort((a,b)=>a.bytes-b.bytes||a.index-b.index);
    const priority=[sorted[0]!,sorted[sorted.length-1]!,...candidates.filter(row=>!row.covered),...candidates];
    const seen=new Set<number>();selected=[];
    for(const row of priority){if(seen.has(row.index))continue;seen.add(row.index);selected.push(row);if(selected.length>=execution.window_size)break;}
  }
  const selected_inputs=selected.map(row=>row.input),calibration_shapes=firstUncovered?[firstUncovered.shape]:[];
  const response_bound_bytes=Math.max(16384,...selected.map(row=>signalListeningResponseBoundV1(row.request)));
  if(warmup){
    // Retained requests/inputs remain charged while every outstanding raw body
    // reserves the full serialization/page-codec bound. TPS is still reserved
    // separately per request by the shared account limiter (65536, never learned).
    const rawBytes=assertJevStreamingExecutionV2(execution,{evaluate:async()=>{throw Error('unreachable');},max_response_bytes:response_bound_bytes});
    const retained=selected.reduce((sum,row)=>sum+jevCallWorkingBytesV2({request:row.request,inputs:[row.input]})+8192,0);
    const slots=Math.floor((execution.max_buffered_bytes-retained)/rawBytes);
    if(slots<1)fail('listening_selection_memory_bound');
    execution.max_in_flight=Math.min(execution.max_in_flight,slots);
  }
  const plan={scope:{workspace_id:args.workspace_id,configuration_digest:args.configuration_digest},configuration:state.configuration,snapshot,
    profiles,execution,warmup,selected_inputs,calibration_shapes,response_bound_bytes};
  return plan;
}
/** Each factory receives an immutable env copy. Account quotas remain shared;
 * a profile's scope digest, not a new app tenant or key, identifies its TPS model. */
export function createSignalListeningCalibratedProviderV1(args:{plan:SignalListeningCalibrationPlanV1;env?:NodeJS.ProcessEnv;
  factory?:typeof createCalibratedJevRuntimeProviderV2;
  /** Listening-only continuation. These are transport checks, never authority. */
  continuation?:{warmingShape():string|undefined;allowsOfficial(request:JevRequestV1):boolean;consumeOfficial(request:JevRequestV1):void}}){
  // Runtime clients must not keep a planned page's selected_inputs alive
  // after its committed prefix transfers to the stream. Do not capture args.
  const {scope,configuration,snapshot,profiles,execution,warmup,response_bound_bytes}=args.plan;
  const plan={scope,configuration,snapshot,profiles,execution,warmup,response_bound_bytes};
  const factory=args.factory??createCalibratedJevRuntimeProviderV2,baseEnv=args.env??process.env;
  const continuation=args.continuation;
  const clients=new Map<string,JevProviderV1>(),clientsByScope=new Map<string,JevProviderV1>(),usedShapes=new Set<string>();
  const state=readSignalListeningSnapshotV1(plan.snapshot);
  if(state.configuration_digest!==digest(plan.configuration))fail('listening_request_plan_changed');
  const shapeCompiler=createSignalListeningShapeCompilerV1(plan.snapshot);
  const active=new Set<Promise<unknown>>();let closing=false;
  type OfficialPreparation={shape:string;requests:ReadonlyMap<string,number>};
  function clientInfo(request:JevRequestV1,official?:OfficialPreparation){
    const bytes=assertSignalListeningRequestTransportV1(request),shape=shapeCompiler.shape({question_keys:Object.keys(request.questions)});
    if(request.model!==shape.model||signalListeningResponseBoundV1(request)>plan.response_bound_bytes)fail('listening_request_plan_changed');
    const profile=plan.profiles.get(shape.shape_digest);
    if(profile){validateProfile(profile,plan.scope,shape);assertSignalListeningMeasuredContextV1(request,profile.max_input_tokens_per_byte);}
    const measured=profile&&bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes
      &&(!continuation||profile.sample_count>=32&&(official?.shape??continuation.warmingShape())!==shape.shape_digest)?profile:null;
    if(!measured&&continuation&&!(official?(official.requests.get(digest(request))??0)>0:continuation.allowsOfficial(request)))fail('listening_calibration_unprepared_request');
    const id=measured?.scope_digest??digest({...plan.scope,model:shape.model,compiler_version:shape.compiler_version,
      shape_digest:shape.shape_digest,phase:shape.phase,kind:'official_context_bound'});
    const calibration=measured?{kind:'measured',source:`verified-ledger:${measured.source_digest}`,model:shape.model,
      fixed_input_tokens:0,input_tokens_per_utf8_byte:measured.max_input_tokens_per_byte,max_request_bytes:measured.request_max_bytes}
      :{kind:'official_context_bound',source:'Official default request context; not measured or tokenized',source_url:'https://docs.typesafe.ai/models',
        model:'jev-1.13.0',fixed_input_tokens:65536,input_tokens_per_utf8_byte:0,max_request_bytes:SIGNAL_LISTENING_HTTP_BODY_BYTES_V1};
    const cacheKey=`${id}:${measured?.source_digest??'bootstrap'}`;
    return{shape,id,calibration,cacheKey,warmup:!measured};
  }
  function clientFromInfo({shape,id,calibration,cacheKey,warmup}:ReturnType<typeof clientInfo>){
    if(!clients.has(cacheKey))clients.set(cacheKey,factory({labeler_digest:id,
      execution:continuation&&warmup?{...plan.execution,max_in_flight:Math.min(32,plan.execution.max_in_flight)}:plan.execution,env:{...baseEnv,
        NOISIA_JEV_MAX_RESPONSE_BYTES:String(plan.response_bound_bytes),NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[id]:calibration})}}));
    clientsByScope.set(id,clients.get(cacheKey)!);
    usedShapes.add(shape.shape_digest);
    return{provider:clients.get(cacheKey)!,warmup};
  }
  const client=(request:JevRequestV1)=>clientFromInfo(clientInfo(request));
  const provider:JevProviderV1={max_concurrency:plan.execution.max_in_flight,max_response_bytes:plan.response_bound_bytes,
    async evaluate(request,options){
      if(closing)fail('listening_provider_closed');
      const inner=client(request);if(inner.warmup)continuation?.consumeOfficial(request);
      const pending=inner.provider.evaluate(request,options);active.add(pending);
      try{return await pending;}finally{active.delete(pending);}
    },
    async observeUsage(raw,tokens){
      const inner=raw.rate_calibration?clientsByScope.get(raw.rate_calibration.labeler_digest):undefined;
      if(inner)await inner.observeUsage?.(raw,tokens);
    },
    async close(){closing=true;await Promise.allSettled([...active]);await Promise.all([...clients.values()].map(provider=>provider.close?.()));},
  };
  function coveredMeasuredRequest(request:JevRequestV1,shape:ReturnType<typeof signalListeningCalibrationShapeV1>,bytes:number,profile:Profile|null|undefined){
    if(!profile||profile.sample_count<32||request.model!==shape.model||bytes<profile.request_min_bytes||bytes>profile.request_max_bytes
      ||signalListeningResponseBoundV1(request)>plan.response_bound_bytes)return false;
    validateProfile(profile,plan.scope,shape);assertSignalListeningMeasuredContextV1(request,profile.max_input_tokens_per_byte);return true;
  }
  type Descriptors=Map<string,ReturnType<typeof clientInfo>>;
  function activateDescriptors(descriptors:Descriptors,valid:()=>boolean):'ready'|'stale'|'metadata_bound'{
    if(!valid())return'stale';
    let additions=0;for(const key of descriptors.keys())if(!clients.has(key))additions++;
    if(clients.size+additions>plan.execution.window_size)return'metadata_bound';
    // No await: scheduling state remains valid through all client construction.
    for(const info of descriptors.values())clientFromInfo(info);
    descriptors.clear();return'ready';
  }
  return{provider,usedShapes:()=>[...usedShapes],prepareRequests:(requests:JevRequestV1[])=>{for(const request of requests)client(request);},
    /** Keep all clients until post-APPLY usage feedback has drained. If their
     * bounded metadata no longer fits this invocation, use the ordinary next job. */
    prepareContinuationRequests:(requests:JevRequestV1[])=>{
      if(!continuation)fail('listening_continuation_not_enabled');
      // One validation per request in this synchronous preparation. Retain only
      // one small descriptor per distinct client, never the request page. HTTP
      // evaluate still calls clientInfo afresh after any later request mutation.
      const descriptors=new Map<string,ReturnType<typeof clientInfo>>();
      for(const request of requests){const info=clientInfo(request);if(!descriptors.has(info.cacheKey))descriptors.set(info.cacheKey,info);}
      return activateDescriptors(descriptors,()=>true)==='ready';
    },
    /** Listening prepares descriptors cooperatively, then transfers a one-shot
     * activation to its coordinator. A stale epoch builds NO definitive client
     * and publishes NO provisional bootstrap. Send-time checks remain fresh. */
    prepareContinuationRequestsAsync:async(requests:JevRequestV1[],options:{valid():boolean;official?:OfficialPreparation})=>{
      if(!continuation)fail('listening_continuation_not_enabled');
      const descriptors:Descriptors=new Map();
      for(let index=0;index<requests.length;index++){
        if(!options.valid())return{kind:'stale' as const};
        const info=clientInfo(requests[index]!,options.official);if(!descriptors.has(info.cacheKey))descriptors.set(info.cacheKey,info);
        if((index+1)%64===0){await yieldToEventLoop();if(!options.valid())return{kind:'stale' as const};}
      }
      if(!options.valid())return{kind:'stale' as const};
      let activated=false;
      return{kind:'prepared' as const,activate:()=>{
        if(activated)fail('listening_preparation_already_transferred');activated=true;
        return activateDescriptors(descriptors,options.valid);
      }};
    },
    /** Continuity may reuse only the original measured coverage and response
     * bound. A new shape/byte extreme yields to the next ordinary warmup job. */
    prepareMeasuredRequests:(requests:Iterable<JevRequestV1>)=>{
      if(plan.warmup)return false;
      for(const request of requests){
        const bytes=assertSignalListeningRequestTransportV1(request),shape=shapeCompiler.shape({question_keys:Object.keys(request.questions)});
        if(!coveredMeasuredRequest(request,shape,bytes,plan.profiles.get(shape.shape_digest)))return false;
      }
      return true;
    },
    /** A different phase may already have its own measured native ledger profile.
     * Load only missing shapes, then validate the entire page before extending
     * this invocation's Map. No client/probe, new warmup or larger bound is made. */
    prepareMeasuredRequestsWithProfiles:async(requests:Iterable<JevRequestV1>,loadProfile:LoadProfile)=>{
      if(plan.warmup)return false;
      const additions=new Map<string,Profile>();
      for(const request of requests){
        const bytes=assertSignalListeningRequestTransportV1(request),shape=shapeCompiler.shape({question_keys:Object.keys(request.questions)});
        if(request.model!==shape.model||signalListeningResponseBoundV1(request)>plan.response_bound_bytes)return false;
        let profile=plan.profiles.get(shape.shape_digest)??additions.get(shape.shape_digest);
        if(!plan.profiles.has(shape.shape_digest)&&!additions.has(shape.shape_digest)){
          // Retain no more profile metadata than the original bounded input
          // window could supply. Keep profiles needed by active/reserved sends.
          if(plan.profiles.size+additions.size>=plan.execution.window_size)return false;
          const loaded=await loadProfile(shape.shape_digest);if(!loaded)return false;
          validateProfile(loaded,plan.scope,shape);
          profile=structuredClone(loaded);additions.set(shape.shape_digest,profile);
        }
        if(!coveredMeasuredRequest(request,shape,bytes,profile))return false;
      }
      for(const [shape,profile]of additions)plan.profiles.set(shape,profile);
      return true;

    }};
}

export type SignalListeningCalibrationEventV1={warmup:boolean;selected_roots:number;max_in_flight:number;shape_digests:string[];
  transition?:'bootstrap_start'|'bootstrap_end'|'measured';bootstrap_id?:number;
  outcome?:'measured'|'partial'|'unavailable'|'failed'};
const continuationInputKey=(input:Pick<SignalListeningInputV1,'root_id'|'input_digest'|'question_digests'>)=>digest({root_id:input.root_id,input_digest:input.input_digest,question_digests:input.question_digests});
type BootstrapV1={id:number;shape:string;descriptor:ReturnType<typeof signalListeningCalibrationShapeV1>;order:string[];unreserved:Set<string>;pending:Set<string>;sources:Set<string>;
  requests:Map<string,number>;lo:number;hi:number;deriving:boolean;covered_acknowledged:boolean;covered_ids:Set<string>};
type ContinuationSelectionV1={selected:SignalListeningInputV1[];decision:true}|{selected:[];decision:false|'wait_for_apply'};
type ContinuationRowV1={input:SignalListeningInputV1;key:string;index:number;compiled:JevRequestV1;shape:string;bytes:number;covered:boolean};
/** One Listening invocation owns the global stream. Calibration is a bounded
 * admission lane, not a second stream/lease or an authorization cache. Study
 * continues to use the original finite planner/provider above. */
export async function createSignalListeningContinuationV1({run_id,
  initial_plan:{scope,configuration,snapshot,profiles:initialProfiles,warmup},initial_inputs,
  execution:requestedExecution,loadProfile,deriveProfile,env,factory,observe,
}:{run_id:string;initial_plan:SignalListeningCalibrationPlanV1;
  initial_inputs:SignalListeningInputV1[];execution:JevStreamingExecutionV2;loadProfile:LoadProfile;deriveProfile:LoadProfile;
  env?:NodeJS.ProcessEnv;factory?:typeof createCalibratedJevRuntimeProviderV2;observe?:(event:SignalListeningCalibrationEventV1)=>void}){
  // Destructure the plan in the parameter itself: no retained args/plan object
  // can alias its original selected_inputs or the full hydrated input page.
  const execution=Object.freeze({...requestedExecution}),profiles=new Map(initialProfiles),shapeCompiler=createSignalListeningShapeCompilerV1(snapshot);
  const request=(input:SignalListeningInputV1)=>buildSignalListeningCompiledRequestV1(input,snapshot);
  // This allowance is fixed before the FIRST reserve and shared by bootstrap,
  // measured responses and both flushes. A wider future shape uses a new job.
  const response_bound_bytes=Math.max(16384,...initial_inputs.map(input=>signalListeningResponseBoundV1(request(input))));
  let bootstrap:BootstrapV1|undefined,sequence=0,stopped=false,reason:string|undefined,failed=false,failure:unknown,preparationEpoch=0,surveyBusy=false;
  const baseQuestionKeys=new Set(configuration.questions.filter(q=>q.origin==='base').map(q=>q.key));
  // Before building a temporary dummy wire, reserve its repeated definition
  // strings, object/key nodes and all JSON/UTF16 scratch. Repeated instructions
  // receive no sharing credit. The established14/384 conservatism is retained.
  let headerUnits=512+6*(configuration.model.length+64),headerNodes=64;
  for(const question of configuration.questions){
    headerUnits+=512+6*(question.key.length+configuration.instructions.length+question.text.length);headerNodes+=32;
    if(question.type==='choice')for(const option of question.options){headerUnits+=32+6*(option.key.length+option.definition.length);headerNodes+=4;}
    else{headerUnits+=64+6*(question.positive.length+question.negative.length);headerNodes+=8;}
  }
  const headerTemporaryBytes=14*headerUnits+384*headerNodes;
  if(!Number.isSafeInteger(headerTemporaryBytes)||headerTemporaryBytes<0)fail('listening_selection_memory_bound');
  function event(value:SignalListeningCalibrationEventV1){try{observe?.({...value,shape_digests:[...value.shape_digests]});}catch{/* Observation cannot change admission. */}}
  function endBootstrap(current:BootstrapV1,outcome:NonNullable<SignalListeningCalibrationEventV1['outcome']>){
    event({warmup:true,selected_roots:current.order.length,max_in_flight:Math.min(32,execution.max_in_flight),shape_digests:[current.shape],
      transition:'bootstrap_end',bootstrap_id:current.id,outcome});
    if(bootstrap===current){bootstrap=undefined;preparationEpoch++;}
  }
  function nextAdmissionHint():JevFeedAdmissionHintV1{
    if(stopped)return{kind:'closed'};
    const current=bootstrap;if(!current)return{kind:'open'};
    return{kind:'bootstrap',bootstrap_id:current.id,covered_call_limit:Math.min(32,current.order.length),
      acknowledged_covered_calls:current.covered_ids.size,
      wait_for_apply:current.covered_acknowledged&&!current.unreserved.size&&Boolean(current.pending.size||current.deriving)};
  }
  /** Scheduling notification only. Prevalidated Native handoffs may call this
   * synchronously after ACK; it performs no validation, IO or admission gate. */
  function acknowledgeCoveredReservation(generation:number,ids:ReadonlyArray<string>){
    const current=bootstrap;if(!current||current.id!==generation||!ids.length)return;
    const limit=Math.min(32,current.order.length);
    for(const id of ids){if(current.covered_ids.size>=limit)break;current.covered_ids.add(id);}
    current.covered_acknowledged=true;preparationEpoch++;
  }
  const runtime=createSignalListeningCalibratedProviderV1({plan:{scope,configuration,snapshot,profiles,execution,warmup,response_bound_bytes,
      selected_inputs:[],calibration_shapes:[]},
    ...(env?{env}:{}),...(factory?{factory}:{}),continuation:{
      warmingShape:()=>bootstrap?.shape,
      allowsOfficial:value=>Boolean(bootstrap&&(bootstrap.requests.get(digest(value))??0)>0),
      consumeOfficial:value=>{const key=digest(value),left=bootstrap?.requests.get(key)??0;if(left<1)fail('listening_calibration_unprepared_request');bootstrap!.requests.set(key,left-1);},
    }});
  async function select(inputs:SignalListeningInputV1[],initial=false,signal?:AbortSignal):Promise<ContinuationSelectionV1>{
    const epoch=preparationEpoch;
    const valid=()=>!stopped&&!signal?.aborted&&epoch===preparationEpoch;
    if(stopped)return{selected:[],decision:false};
    if(inputs.some(input=>input.configuration_digest!==scope.configuration_digest))fail('listening_calibration_configuration_invalid');
    const rows:ContinuationRowV1[]=[];
    for(const [index,input]of inputs.entries()){
      const compiled=request(input),shape=shapeCompiler.shape(input),bytes=assertSignalListeningRequestTransportV1(compiled);
      if(signalListeningResponseBoundV1(compiled)>response_bound_bytes){stopped=true;reason='listening_calibration_response_bound_changed';return{selected:[],decision:false};}
      if(!profiles.has(shape.shape_digest)){
        if(profiles.size>=execution.window_size){stopped=true;reason='listening_calibration_metadata_bound';return{selected:[],decision:false};}
        const loaded=await loadProfile(shape.shape_digest);if(loaded)validateProfile(loaded,scope,shape);
        profiles.set(shape.shape_digest,loaded?structuredClone(loaded):null);
        if(!valid())return{selected:[],decision:'wait_for_apply'};
      }
      const profile=profiles.get(shape.shape_digest);
      if(profile){validateProfile(profile,scope,shape);assertSignalListeningMeasuredContextV1(compiled,profile.max_input_tokens_per_byte);}
      rows.push({input,key:continuationInputKey(input),index,compiled,shape:shape.shape_digest,bytes,covered:Boolean(profile&&profile.sample_count>=32
        &&bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes)});
      if((index+1)%64===0){await yieldToEventLoop();if(!valid())return{selected:[],decision:'wait_for_apply'};}
    }
    if(!valid())return{selected:[],decision:'wait_for_apply'};
    return finalizeRows(rows,initial,undefined,valid);
  }
  async function finalizeRows(rows:ContinuationRowV1[],initial=false,preparedBootstrap?:BootstrapV1,valid=()=>true):Promise<ContinuationSelectionV1>{
    const original=bootstrap;let candidate=preparedBootstrap??original;
    if(!candidate){
      const first=rows.find(row=>!row.covered);
      if(first){
        const candidates=rows.filter(row=>row.shape===first.shape),sorted=[...candidates].sort((a,b)=>a.bytes-b.bytes||a.index-b.index);
        const priority=[sorted[0]!,sorted[sorted.length-1]!,...candidates.filter(row=>!row.covered),...candidates];
        const anchors:typeof rows=[];const seen=new Set<string>();
        for(const row of priority){if(seen.has(row.key))continue;seen.add(row.key);anchors.push(row);if(anchors.length>=Math.min(32,execution.window_size))break;}
        const requests=new Map<string,number>();for(const row of anchors){const key=digest(row.compiled);requests.set(key,(requests.get(key)??0)+1);}
        candidate={id:sequence+1,shape:first.shape,descriptor:shapeCompiler.shape(first.input),order:anchors.map(row=>row.key),unreserved:new Set(seen),pending:new Set(),sources:new Set(),requests,
          lo:Math.min(...anchors.map(row=>row.bytes)),hi:Math.max(...anchors.map(row=>row.bytes)),deriving:false,covered_acknowledged:false,covered_ids:new Set()};
      }
    }
    // A warming shape is entirely frozen: measured requests of that same shape
    // would otherwise displace its new extrema from native recent32 evidence.
    const byKey=new Map(rows.map(row=>[row.key,row]));
    const selected=candidate?[
      ...candidate.order.flatMap(key=>{const row=candidate!.unreserved.has(key)?byKey.get(key):undefined;return row?[row]:[];}),
      ...(initial?[]:rows.filter(row=>row.covered&&row.shape!==candidate!.shape)),
    ].slice(0,execution.window_size):rows.slice(0,execution.window_size);
    // The final APPLY ACK empties pending before native derivation/reload can
    // publish coverage. Keep admission waiting through both asynchronous steps.
    if(!selected.length)return{selected:[],decision:candidate&&(candidate.pending.size||candidate.deriving)?'wait_for_apply':false};
    if(initial){
      const rawBytes=assertJevStreamingExecutionV2(execution,runtime.provider),retained=selected.reduce((sum,row)=>sum+jevCallWorkingBytesV2({request:row.compiled,inputs:[row.input]})+8192,0);
      if(retained+rawBytes>execution.max_buffered_bytes)fail('listening_selection_memory_bound');
    }
    const compiled=selected.map(row=>row.compiled);
    const stillValid=()=>valid()&&bootstrap===original;
    const staged=await runtime.prepareContinuationRequestsAsync(compiled,{valid:stillValid,
      ...(candidate?{official:{shape:candidate.shape,requests:candidate.requests}}:{})});
    if(staged.kind==='stale'||!stillValid())return{selected:[],decision:'wait_for_apply'};
    const activated=staged.activate();
    if(activated==='stale')return{selected:[],decision:'wait_for_apply'};
    if(activated==='metadata_bound'){
      stopped=true;reason='listening_calibration_metadata_bound';return{selected:[],decision:false};
    }
    // Descriptor validation and its yields are complete. Publish and hand off
    // synchronously; no stale preparation can register an anchor generation.
    if(candidate&&candidate!==original){
      bootstrap={...candidate,id:++sequence};
      event({warmup:true,selected_roots:bootstrap.order.length,max_in_flight:Math.min(32,execution.max_in_flight),shape_digests:[bootstrap.shape],transition:'bootstrap_start',bootstrap_id:bootstrap.id});
    }
    return{selected:selected.map(row=>row.input),decision:true};

  }
  /** Fresh metadata cursor lives ONLY inside one read-only RR. No bodies,
   * hints or consumed-position cache survive between paid cohorts. The ledger
   * alone excludes identities after durable reservation; UNKNOWN never advances
   * a local cursor. Missing profiles are loaded after RR/client release. */
  async function selectSurvey(args:{available_bytes:number;max_calls:number;storage_bound:number;signal:AbortSignal;
    read<T>(bounds:LabelingInputBoundsV1,body:(survey:SignalListeningInputSurveyV1)=>Promise<T>):Promise<T>}):Promise<ContinuationSelectionV1&{
      preparation_epoch:number;byte_limited?:boolean;admission_deferred?:boolean;fallback_legacy?:true}>{
    if(initialSelection!==undefined)fail('listening_selection_not_transferred');
    if(surveyBusy)fail('listening_preparation_reentrant');surveyBusy=true;
    const deferred=()=>({selected:[]as[],decision:'wait_for_apply'as const,preparation_epoch:preparationEpoch,admission_deferred:true});
    type Shape=ReturnType<typeof signalListeningCalibrationShapeV1>;
    type Meta={hint:SignalListeningInputHintV1;key:string;index:number;shape:string;bytes:number;covered:boolean};
    type Plan={kind:'ready';rows:ContinuationRowV1[];bootstrap?:BootstrapV1;byte_limited:boolean}
      |{kind:'profile';shape:Shape}|{kind:'stale'}|{kind:'deferred'}|{kind:'legacy'}|{kind:'closed';reason:string};
    const legacy=()=>({...deferred(),fallback_legacy:true as const});
    let staleReads=0;
    try{for(;;){
      if(stopped||args.signal.aborted)return{selected:[],decision:false,preparation_epoch:preparationEpoch};
      if(!Number.isSafeInteger(args.available_bytes)||args.available_bytes<0||!Number.isSafeInteger(args.max_calls)||args.max_calls<1
        ||!Number.isSafeInteger(args.storage_bound)||args.storage_bound<0)fail('listening_selection_memory_bound');
      if(args.storage_bound+8192>args.available_bytes)return legacy();
      const epoch=preparationEpoch,current=bootstrap;let surveyByteLimited=false;
      const valid=()=>!args.signal.aborted&&!stopped&&epoch===preparationEpoch&&bootstrap===current;
      const plan=await args.read<Plan>({max_rows:execution.window_size,max_working_bytes:args.available_bytes,on_oversize:'empty',on_byte_limit:()=>{surveyByteLimited=true;}},async survey=>{
        if(!valid())return{kind:'stale'};
        if(survey.hints.length>execution.window_size||!Number.isSafeInteger(survey.retained_bytes)||survey.retained_bytes<0||survey.retained_bytes>args.storage_bound)
          fail('listening_survey_metadata_invalid');
        if(!survey.hints.length)return surveyByteLimited?{kind:'deferred'}:{kind:'ready',rows:[],byte_limited:false};
        // Scalar rows (no input bodies), transient index/sort arrays, at most64
        // immutable descriptor/header entries, and preparation bookkeeping.
        // A scalar row is <=4096 logical bytes; each cached question descriptor
        // has <=1024 logical bytes. These are not heap/RSS measurements.
        const scalarBytes=8192+(survey.hints.length+1)*4096+64*1024*(configuration.questions.length+1);
        const room=args.available_bytes-survey.retained_bytes-scalarBytes-headerTemporaryBytes;
        if(room<3*8192)return{kind:'legacy'};
        const placeholder='R16 bounded request byte placeholder',placeholderBytes=Buffer.byteLength(JSON.stringify(placeholder));
        const headers=new Map<string,{shape:Shape;fixed:number;single:number[];response:number}>(),validated=new Set<string>();
        const header=(hint:SignalListeningInputHintV1)=>{
          const keys=[...hint.question_keys].sort(),cacheKey=JSON.stringify(keys);let value=headers.get(cacheKey);if(value)return value;
          const compiled=buildSignalListeningCompiledRequestV1({text:placeholder,question_keys:keys},snapshot),shape=shapeCompiler.shape({question_keys:keys});
          value={shape,fixed:assertSignalListeningRequestTransportV1(compiled)-placeholderBytes,
            single:Object.entries(compiled.questions).map(([key,question])=>Buffer.byteLength(JSON.stringify({model:compiled.model,state:placeholder,questions:{[key]:question}}))-placeholderBytes),
            response:signalListeningResponseBoundV1(compiled)};
          if(headers.size===64)headers.delete(headers.keys().next().value!);headers.set(cacheKey,value);return value;
        };
        const covered=(bytes:number,shape:Shape,h:ReturnType<typeof header>,stateBytes:number)=>{
          const profile=profiles.get(shape.shape_digest);
          if(profile){
            if(!validated.has(shape.shape_digest)){validateProfile(profile,scope,shape);validated.add(shape.shape_digest);}
            if(Math.ceil(bytes*profile.max_input_tokens_per_byte)>SIGNAL_LISTENING_CONTEXT_TOKENS_V1)fail('listening_request_context_estimate_exceeded');
            if(h.single.some(fixed=>Math.ceil((fixed+stateBytes)*profile.max_input_tokens_per_byte)>SIGNAL_LISTENING_QUESTION_CONTEXT_TOKENS_V1))fail('listening_question_context_estimate_exceeded');
          }
          return Boolean(profile&&profile.sample_count>=32&&bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes);
        };
        const rows:Meta[]=[];
        for(const[index,hint]of survey.hints.entries()){
          const h=header(hint);if(h.response>response_bound_bytes)return{kind:'closed',reason:'listening_calibration_response_bound_changed'};
          if(!profiles.has(h.shape.shape_digest))return{kind:'profile',shape:h.shape};
          if(!Number.isSafeInteger(hint.state_json_bytes)||hint.state_json_bytes<2)fail('listening_survey_metadata_invalid');
          const bytes=h.fixed+hint.state_json_bytes;if(!Number.isSafeInteger(bytes)||bytes<1)fail('listening_survey_metadata_invalid');
          if(bytes>SIGNAL_LISTENING_HTTP_BODY_BYTES_V1)fail('listening_request_body_exceeded');
          rows.push({hint,index,key:continuationInputKey({root_id:hint.root_id,input_digest:hint.input_digest,question_digests:{...hint.question_digests}}),
            shape:h.shape.shape_digest,bytes,covered:covered(bytes,h.shape,h,hint.state_json_bytes)});
          if((index+1)%64===0){await yieldToEventLoop();if(!valid())return{kind:'stale'};}
        }
        const selectMetadata=():{rows:Meta[];anchors:boolean}=>{
          if(current){
            if(current.unreserved.size){
              const byKey=new Map(rows.map(row=>[row.key,row]));
              const anchors=current.order.filter(key=>current.unreserved.has(key)).map(key=>byKey.get(key));
              if(anchors.some(row=>!row))return{rows:[],anchors:true};
              return{rows:anchors as Meta[],anchors:true};
            }
            return{rows:rows.filter(row=>row.covered&&row.shape!==current.shape).slice(0,Math.min(args.max_calls,32,current.order.length)),anchors:false};
          }
          const first=rows.find(row=>!row.covered);
          if(!first)return{rows:rows.slice(0,Math.min(1024,args.max_calls)),anchors:false};
          const candidates=rows.filter(row=>row.shape===first.shape),sorted=[...candidates].sort((a,b)=>a.bytes-b.bytes||a.index-b.index),seen=new Set<string>(),anchors:Meta[]=[];
          for(const row of[sorted[0]!,sorted.at(-1)!,...candidates.filter(row=>!row.covered),...candidates]){
            if(seen.has(row.key))continue;seen.add(row.key);anchors.push(row);if(anchors.length>=Math.min(32,execution.window_size))break;
          }
          return{rows:anchors,anchors:true};
        };
        const working=(row:Meta)=>{const bytes=Number(row.hint.working_bytes);if(!Number.isSafeInteger(bytes)||bytes<8192)fail('listening_survey_metadata_invalid');return bytes;};
        const fitting=(candidates:Meta[])=>{
          let hydration=0,prepared=0,count=0;
          for(const row of candidates){
            const h=working(row),nextPrepared=4*row.bytes+h+16384;
            if(!Number.isSafeInteger(nextPrepared)||nextPrepared<0)fail('listening_selection_memory_bound');
            if(hydration+h+prepared+nextPrepared>room)break;
            hydration+=h;prepared+=nextPrepared;count++;
          }
          return{count,hydration};
        };
        const compileHydrated=async(chosen:Meta[],exact:boolean,integral:boolean):Promise<{kind:'ready';rows:ContinuationRowV1[];byte_limited?:boolean}|{kind:'stale'}|{kind:'deferred'}|{kind:'legacy'}|{kind:'mismatch'}>=>{
          if(!chosen.length)return{kind:'ready',rows:[]};
          if(chosen.length>1024||chosen.length>args.max_calls)return{kind:'deferred'};
          const estimate=fitting(chosen);if(estimate.count!==chosen.length)return{kind:'legacy'};
          const hydrateBudget=estimate.hydration;
          const hydrated=await survey.hydrate(chosen.map(row=>row.hint.root_id),{max_rows:1024,max_working_bytes:hydrateBudget,on_oversize:'empty'});
          if(!valid()||hydrated.kind==='stale')return{kind:'stale'};
          if(!Number.isSafeInteger(hydrated.retained_bytes)||hydrated.retained_bytes<8192*chosen.length||hydrated.retained_bytes>hydrateBudget||hydrated.inputs.length!==chosen.length)
            fail('listening_survey_metadata_invalid');
          const prepared:ContinuationRowV1[]=[];let kept=0;
          for(let index=0;index<hydrated.inputs.length;index++){
            const input=hydrated.inputs[index]!,meta=chosen[index]!;
            if(input.configuration_digest!==scope.configuration_digest||input.root_id!==meta.hint.root_id||continuationInputKey(input)!==meta.key||digest(input.scope_basis)!==digest(meta.hint.scope_basis)||[...input.question_keys].sort().join(',')!==[...meta.hint.question_keys].sort().join(','))return{kind:'stale'};
            // Reserve one fresh body/serialization scratch bound before cloning
            // the next request; no paid-response or future-flush credit is used.
            const nextBound=4*meta.bytes+working(meta)+16384;
            if(kept+hydrated.retained_bytes+nextBound>room){
              if(!integral&&prepared.length){hydrated.inputs=[];return{kind:'ready',rows:prepared,byte_limited:true};}
              return{kind:'legacy'};
            }
            const compiled=request(input),bytes=assertSignalListeningRequestTransportV1(compiled),shape=shapeCompiler.shape(input),h=header(meta.hint);
            if(exact&&(bytes!==meta.bytes||Buffer.byteLength(JSON.stringify(input.text))!==meta.hint.state_json_bytes))return{kind:'mismatch'};
            if(shape.shape_digest!==meta.shape) return{kind:'stale'};
            const profile=profiles.get(shape.shape_digest);if(profile)assertSignalListeningMeasuredContextV1(compiled,profile.max_input_tokens_per_byte);
            const cost=jevCallWorkingBytesV2({request:compiled,inputs:[input]})+8192;
            if(cost>nextBound)fail('listening_selection_memory_bound');kept+=cost;
            if(kept+hydrated.retained_bytes>room)fail('listening_selection_memory_bound');
            prepared.push({input,compiled,key:meta.key,index:meta.index,shape:meta.shape,bytes,covered:meta.covered});
            if((index+1)%64===0){await yieldToEventLoop();if(!valid())return{kind:'stale'};}
          }
          return{kind:'ready',rows:prepared};
        };
        let chosen=selectMetadata(),requestedBeforeBudget=chosen.rows.length;
        if(chosen.anchors&&(!chosen.rows.length||chosen.rows.length>args.max_calls))return{kind:'stale'};
        // Hint bytes guide read admission only. They cannot authorize or price
        // a call. The SAME RR recomputes actual body/eligibility/bytes again.
        const prefix=fitting(chosen.rows);
        if(chosen.anchors&&prefix.count!==chosen.rows.length)return{kind:'legacy'};
        if(!chosen.anchors)chosen={...chosen,rows:chosen.rows.slice(0,prefix.count)};
        if(!chosen.rows.length&&rows.length&&!current)return{kind:'legacy'};
        let prepared=await compileHydrated(chosen.rows,true,chosen.anchors);
        if(prepared.kind==='mismatch'){
          // Encoder drift is never a coverage/anchor approximation. Recompute
          // EVERY row in bounded chunks under this SAME RR before reselecting.
          for(let offset=0;offset<rows.length;){
            const next=fitting(rows.slice(offset,offset+1024)),count=next.count,hydrateBudget=next.hydration;
            if(!count)return{kind:'legacy'};
            const chunk=rows.slice(offset,offset+count),body=await survey.hydrate(chunk.map(row=>row.hint.root_id),{max_rows:1024,max_working_bytes:hydrateBudget,on_oversize:'empty'});
            if(!valid()||body.kind==='stale')return{kind:'stale'};
            if(!Number.isSafeInteger(body.retained_bytes)||body.retained_bytes<8192*chunk.length||body.retained_bytes>hydrateBudget||body.inputs.length!==chunk.length)fail('listening_survey_metadata_invalid');
            for(let index=0;index<body.inputs.length;index++){
              const input=body.inputs[index]!,meta=chunk[index]!;if(continuationInputKey(input)!==meta.key||input.root_id!==meta.hint.root_id||digest(input.scope_basis)!==digest(meta.hint.scope_basis)||[...input.question_keys].sort().join(',')!==[...meta.hint.question_keys].sort().join(','))return{kind:'stale'};
              const maximum=4*meta.bytes+working(meta)+16384;if(body.retained_bytes+maximum>room)return{kind:'legacy'};
              const compiled=request(input),actual=assertSignalListeningRequestTransportV1(compiled),h=header(meta.hint),stateBytes=Buffer.byteLength(JSON.stringify(input.text));
              if(jevCallWorkingBytesV2({request:compiled,inputs:[input]})+8192>maximum)fail('listening_selection_memory_bound');
              meta.bytes=actual;meta.covered=covered(actual,h.shape,h,stateBytes);
              if((index+1)%64===0){await yieldToEventLoop();if(!valid())return{kind:'stale'};}
            }
            body.inputs=[];offset+=count;
          }
          chosen=selectMetadata();requestedBeforeBudget=chosen.rows.length;const fresh=fitting(chosen.rows);
          if(chosen.anchors&&fresh.count!==chosen.rows.length)return{kind:'legacy'};
          if(!chosen.anchors)chosen={...chosen,rows:chosen.rows.slice(0,fresh.count)};
          prepared=await compileHydrated(chosen.rows,false,chosen.anchors);
        }
        if(prepared.kind==='mismatch'||prepared.kind==='stale')return{kind:'stale'};
        if(prepared.kind==='deferred')return{kind:'deferred'};
        if(prepared.kind==='legacy')return{kind:'legacy'};
        let nextBootstrap:BootstrapV1|undefined;
        if(!current&&chosen.anchors&&prepared.rows.length){
          const first=prepared.rows[0]!,requests=new Map<string,number>();for(const row of prepared.rows){const key=digest(row.compiled);requests.set(key,(requests.get(key)??0)+1);}
          nextBootstrap={id:sequence+1,shape:first.shape,descriptor:shapeCompiler.shape(first.input),order:prepared.rows.map(row=>row.key),unreserved:new Set(prepared.rows.map(row=>row.key)),pending:new Set(),sources:new Set(),requests,
            lo:Math.min(...prepared.rows.map(row=>row.bytes)),hi:Math.max(...prepared.rows.map(row=>row.bytes)),deriving:false,covered_acknowledged:false,covered_ids:new Set()};
        }
        return{kind:'ready',rows:prepared.rows,...(nextBootstrap?{bootstrap:nextBootstrap}:{}),byte_limited:surveyByteLimited||prepared.byte_limited===true||!chosen.anchors&&chosen.rows.length<requestedBeforeBudget};
      });
      if(!valid())return deferred();
      if(plan.kind==='profile'){
        if(profiles.size>=execution.window_size){stopped=true;reason='listening_calibration_metadata_bound';return{selected:[],decision:false,preparation_epoch:preparationEpoch};}
        const loaded=await loadProfile(plan.shape.shape_digest);if(loaded)validateProfile(loaded,scope,plan.shape);
        profiles.set(plan.shape.shape_digest,loaded?structuredClone(loaded):null);preparationEpoch++;continue;
      }
      if(plan.kind==='closed'){stopped=true;reason=plan.reason;return{selected:[],decision:false,preparation_epoch:preparationEpoch};}
      if(plan.kind==='stale'){if(++staleReads<2)continue;return deferred();}
      if(plan.kind==='deferred')return deferred();
      if(plan.kind==='legacy')return legacy();
      // RR is closed and its client released. This is the sole place that may
      // publish bootstrap state or construct final runtime clients. No DB await.
      const selected=await finalizeRows(plan.rows,false,plan.bootstrap,valid);plan.rows=[];
      return{...selected,preparation_epoch:epoch,byte_limited:plan.byte_limited};
    }}finally{surveyBusy=false;}
  }
  let initialSelection:SignalListeningInputV1[]|undefined;
  try{
    const initial=await select(initial_inputs,true);
    initialSelection=initial.selected;
    // A resolved preparation result must not keep a second alias after the
    // one-shot transfer below. This also clears the resolved Promise's value.
    initial.selected=[];
    if(initial.decision===true&&!bootstrap)event({warmup:false,selected_roots:initialSelection.length,max_in_flight:execution.max_in_flight,shape_digests:[],transition:'measured'});
  }
  catch(error){
    if(bootstrap)endBootstrap(bootstrap,'failed');
    try{await runtime.provider.close?.();}catch(secondary){throw new AggregateError([error,secondary],'listening_calibration_prepare_and_close_failed',{cause:error});}
    throw error;
  }finally{initial_inputs=[];}
  return{runtime,execution,response_bound_bytes,
    /** Transfer, never share: the caller then owns reservation/release. The
     * controller keeps only bootstrap IDs, scalar bounds and profile metadata. */
    takeInitialSelection():SignalListeningInputV1[]{
      const selected=initialSelection;
      if(selected===undefined)fail('listening_selection_already_transferred');
      initialSelection=undefined;return selected!;
    },
    bootstrap_initial_calls:bootstrap?.order.length,
    minimumNextCalls:()=>bootstrap?.unreserved.size??0,
    nextAdmissionHint,acknowledgeCoveredReservation,selectNextSurvey:selectSurvey,
    preparationEpoch:()=>preparationEpoch,preparationValid:(epoch:number)=>!stopped&&epoch===preparationEpoch,
    selectNext:async(inputs:SignalListeningInputV1[],signal?:AbortSignal)=>{
      if(initialSelection!==undefined)fail('listening_selection_not_transferred');
      return select(inputs,false,signal);
    },
    reserved(calls:LabelingCallV1<SignalListeningInputV1>[]){
      const current=bootstrap;if(!current)return;
      const coveredIds:string[]=[];
      for(const call of calls){
        if(call.inputs.length!==1)fail('listening_calibration_reservation_invalid');
        const key=continuationInputKey(call.inputs[0]!);
        if(current.unreserved.delete(key)){current.pending.add(call.id);current.sources.add(call.id);}
        else if(shapeCompiler.shape(call.inputs[0]!).shape_digest===current.shape)fail('listening_calibration_reservation_invalid');
        else coveredIds.push(call.id);
      }
      preparationEpoch++;acknowledgeCoveredReservation(current.id,coveredIds);
    },
    async applied(rows:Array<{call:LabelingCallV1<SignalListeningInputV1>;results:SignalListeningResultV1[]}>){
      // A BASE APPLY can enable an earlier consumer root. No preparation may
      // carry its previous snapshot through the next Native selector.
      if(rows.some(row=>row.call.inputs.some(input=>input.question_keys.some(key=>baseQuestionKeys.has(key)))))preparationEpoch++;
      const current=bootstrap;if(!current||current.deriving)return;
      for(const row of rows)if(current.pending.has(row.call.id)){
        if(row.results.length!==1||!['labeled','abstained'].includes(row.results[0]!.status)){
          stopped=true;reason='listening_calibration_results_invalid';endBootstrap(current,'failed');return;
        }
        current.pending.delete(row.call.id);preparationEpoch++;
      }
      if(current.pending.size||current.unreserved.size||!current.sources.size)return;
      current.deriving=true;
      // APPLY has already committed. A calibration error must not turn that ACK
      // into a fabricated persistence failure; stop new admission and propagate
      // it only after the shared transport has drained all existing custody.
      try{
        const derived=await deriveProfile(current.shape);
        if(!derived){stopped=true;reason='listening_calibration_profile_unavailable';endBootstrap(current,'unavailable');return;}
        const loaded=await loadProfile(current.shape);
        validateProfile(derived,scope,current.descriptor);
        if(!loaded||digest(loaded)!==digest(derived)||derived.source_run_id!==run_id
          ||derived.sample_count<current.sources.size||[...current.sources].some(id=>!derived.source_call_ids.includes(id))
          ||derived.request_min_bytes>current.lo||derived.request_max_bytes<current.hi)fail('listening_calibration_evidence_invalid');
        profiles.set(current.shape,structuredClone(derived));preparationEpoch++;
        endBootstrap(current,derived.sample_count>=32?'measured':'partial');
      }catch(error){failed=true;failure=error;stopped=true;reason='listening_calibration_failed';endBootstrap(current,'failed');}
    },
    failure:()=>({failed,error:failure}),stopReason:()=>reason,
    closeObservation(){initialSelection=undefined;if(bootstrap)endBootstrap(bootstrap,'failed');},
  };
}
