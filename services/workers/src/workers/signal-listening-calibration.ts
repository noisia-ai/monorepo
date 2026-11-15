import {
  buildSignalListeningJevRequestV1,signalListeningCalibrationShapeV1,signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalListeningConfigurationV1,type SignalListeningInputV1,type SignalListeningCalibrationProfileV1,
} from '@noisia/query-engine';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1,type JevRequestV1} from '../providers/typesafe-jev';
import type {JevStreamingExecutionV2} from './signal-jev-streaming-window';
import {assertSignalListeningRequestTransportV1,assertSignalListeningMeasuredContextV1,
  signalListeningResponseBoundV1,SIGNAL_LISTENING_HTTP_BODY_BYTES_V1} from './signal-listening-request-limits';
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
  selected_inputs:SignalListeningInputV1[];calibration_shapes:string[];
  profiles:Map<string,Profile|null>;execution:JevStreamingExecutionV2;warmup:boolean;response_bound_bytes:number};
/** Only committed, verified receipt profiles can unlock concurrency. Missing or
 * out-of-coverage shapes use normal reusable labels in one bounded warmup window. */
export async function planSignalListeningCalibrationV1(args:Access&{configuration:SignalListeningConfigurationV1;
  inputs:SignalListeningInputV1[];execution:JevStreamingExecutionV2;loadProfile:LoadProfile}):Promise<SignalListeningCalibrationPlanV1>{
  if(digest(args.configuration)!==args.configuration_digest||args.inputs.some(input=>input.configuration_digest!==args.configuration_digest))fail('listening_calibration_configuration_invalid');
  const shapes=new Map(args.inputs.map(input=>{const shape=signalListeningCalibrationShapeV1(args.configuration,input);return[shape.shape_digest,shape];}));
  const profiles=new Map<string,Profile|null>();
  await Promise.all([...shapes].map(async([id,shape])=>{const profile=await args.loadProfile(id);if(profile)validateProfile(profile,args,shape);profiles.set(id,profile);}));
  // A short finite phase may use its measured N. A newly expanded phase with
  // at least 32 pending roots finishes a full warmup window before concurrency.
  const pendingByShape=new Map<string,number>();
  for(const input of args.inputs){const key=signalListeningCalibrationShapeV1(args.configuration,input).shape_digest;
    pendingByShape.set(key,(pendingByShape.get(key)??0)+1);}
  for(const [key,profile]of profiles)if(profile&&profile.sample_count<32&&profile.sample_count+(pendingByShape.get(key)??0)>=32)profiles.set(key,null);
  const rows=args.inputs.map((input,index)=>{
    const request=buildSignalListeningJevRequestV1(input,args.configuration),bytes=assertSignalListeningRequestTransportV1(request);
    const shape=signalListeningCalibrationShapeV1(args.configuration,input),profile=profiles.get(shape.shape_digest);
    if(profile)assertSignalListeningMeasuredContextV1(request,profile.max_input_tokens_per_byte);
    return{input,index,request,bytes,shape:shape.shape_digest,covered:Boolean(profile&&bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes)};
  });
  const firstUncovered=rows.find(row=>!row.covered),warmup=Boolean(firstUncovered);
  const execution=warmup?{...args.execution,max_in_flight:1,window_size:Math.min(32,args.execution.window_size),
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
  return{scope:{workspace_id:args.workspace_id,configuration_digest:args.configuration_digest},configuration:args.configuration,
    profiles,execution,warmup,selected_inputs,calibration_shapes,response_bound_bytes};
}
/** Each factory receives an immutable env copy. Account quotas remain shared;
 * a profile's scope digest, not a new app tenant or key, identifies its TPS model. */
export function createSignalListeningCalibratedProviderV1(args:{plan:SignalListeningCalibrationPlanV1;env?:NodeJS.ProcessEnv;
  factory?:typeof createCalibratedJevRuntimeProviderV2}){
  const {plan}=args,baseEnv=args.env??process.env,clients=new Map<string,JevProviderV1>(),clientsByScope=new Map<string,JevProviderV1>(),usedShapes=new Set<string>();
  let warmupTail=Promise.resolve();
  async function serialWarmup<T>(fn:()=>Promise<T>){
    const previous=warmupTail;let unlock!:()=>void;warmupTail=new Promise<void>(resolve=>{unlock=resolve;});
    await previous;try{return await fn();}finally{unlock();}
  }
  function client(request:JevRequestV1){
    const bytes=assertSignalListeningRequestTransportV1(request),shape=signalListeningCalibrationShapeV1(plan.configuration,{question_keys:Object.keys(request.questions)});
    if(request.model!==shape.model||signalListeningResponseBoundV1(request)>plan.response_bound_bytes)fail('listening_request_plan_changed');
    const profile=plan.profiles.get(shape.shape_digest);
    if(profile){validateProfile(profile,plan.scope,shape);assertSignalListeningMeasuredContextV1(request,profile.max_input_tokens_per_byte);}
    const measured=profile&&bytes>=profile.request_min_bytes&&bytes<=profile.request_max_bytes?profile:null;
    const id=measured?.scope_digest??digest({...plan.scope,model:shape.model,compiler_version:shape.compiler_version,
      shape_digest:shape.shape_digest,phase:shape.phase,kind:'official_context_bound'});
    const calibration=measured?{kind:'measured',source:`verified-ledger:${measured.source_digest}`,model:shape.model,
      fixed_input_tokens:0,input_tokens_per_utf8_byte:measured.max_input_tokens_per_byte,max_request_bytes:measured.request_max_bytes}
      :{kind:'official_context_bound',source:'Official default request context; not measured or tokenized',source_url:'https://docs.typesafe.ai/models',
        model:'jev-1.13.0',fixed_input_tokens:65536,input_tokens_per_utf8_byte:0,max_request_bytes:SIGNAL_LISTENING_HTTP_BODY_BYTES_V1};
    const cacheKey=`${id}:${measured?.source_digest??'bootstrap'}`;
    if(!clients.has(cacheKey))clients.set(cacheKey,(args.factory??createCalibratedJevRuntimeProviderV2)({labeler_digest:id,
      execution:measured?plan.execution:{...plan.execution,max_in_flight:1},env:{...baseEnv,
        NOISIA_JEV_MAX_RESPONSE_BYTES:String(plan.response_bound_bytes),NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[id]:calibration})}}));
    clientsByScope.set(id,clients.get(cacheKey)!);
    usedShapes.add(shape.shape_digest);
    return{provider:clients.get(cacheKey)!,warmup:!measured};
  }
  const provider:JevProviderV1={max_concurrency:plan.execution.max_in_flight,max_response_bytes:plan.response_bound_bytes,
    async evaluate(request,options){
      const item=client(request);return item.warmup?serialWarmup(()=>item.provider.evaluate(request,options)):item.provider.evaluate(request,options);
    },
    async observeUsage(raw,tokens){
      const inner=raw.rate_calibration?clientsByScope.get(raw.rate_calibration.labeler_digest):undefined;
      if(inner)await inner.observeUsage?.(raw,tokens);
    },
    async close(){await warmupTail;await Promise.all([...clients.values()].map(provider=>provider.close?.()));},
  };
  return{provider,usedShapes:()=>[...usedShapes],prepareRequests:(requests:JevRequestV1[])=>{for(const request of requests)client(request);},
    /** Continuity may reuse only the original measured coverage and response
     * bound. A new shape/byte extreme yields to the next ordinary warmup job. */
    prepareMeasuredRequests:(requests:Iterable<JevRequestV1>)=>{
      if(plan.warmup)return false;
      for(const request of requests){
        const bytes=assertSignalListeningRequestTransportV1(request),shape=signalListeningCalibrationShapeV1(plan.configuration,{question_keys:Object.keys(request.questions)});
        const profile=plan.profiles.get(shape.shape_digest);
        if(!profile||profile.sample_count<32||request.model!==shape.model||bytes<profile.request_min_bytes||bytes>profile.request_max_bytes
          ||signalListeningResponseBoundV1(request)>plan.response_bound_bytes)return false;
        validateProfile(profile,plan.scope,shape);assertSignalListeningMeasuredContextV1(request,profile.max_input_tokens_per_byte);
      }
      return true;
    }};
}
