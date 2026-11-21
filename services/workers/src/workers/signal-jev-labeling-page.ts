import type{SignalListeningPreparationObservationV1}from'./signal-listening-preparation-observation';
import {jevResponseInitialHeadroomV3,selectJevPhaseInitialBindingV3} from './signal-jev-phase-profile-v3';
import type {JevPhaseClosedBindingV3} from './signal-jev-response-budget-v3';
import { assertJevStreamingExecutionV2, jevCallWorkingBytesV2, processJevStreamingWindowV2, type JevStreamingExecutionV2, type JevStreamingMetricsV2, type JevFeedAdmissionHintV1, type JevFeedResultV1, type JevNativeWorkspaceQuoteV1 } from './signal-jev-streaming-window';
import { setMaxListeners } from "node:events";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { llmCostMicroUsdV1, type FacetInput, type LlmPriceV1, type LlmUsageV1 } from "@noisia/query-engine";
import type { createSignalLabelingStoreV1, LabelingRunV1, LabelingCallV1, LabelingCallProposalV1 } from "@noisia/db";
import { validateJevResponseV1, jevProviderErrorV1, type JevProviderV1, type JevRawResponseV1,
  type JevRequestV1, type JevResponseV1, type JevProviderErrorV1 } from "../providers/typesafe-jev";

export type JevPreparedExecutionV1 = {provider:JevProviderV1;execution:JevStreamingExecutionV2;max_windows?:number;recovery_only?:boolean;continuous_windows?:boolean;
  /** One complete ordinary calibration cohort, including its byte extrema.
   * This changes reservation order, never the shared send/memory limits. */
  bootstrap_initial_calls?:number};
function validatePreparedExecution(value:JevPreparedExecutionV1){
  if(!value||typeof value.provider?.evaluate!=='function'||!value.execution||value.recovery_only!==undefined&&typeof value.recovery_only!=='boolean'||value.continuous_windows!==undefined&&typeof value.continuous_windows!=='boolean')throw Error('jev_preparation_invalid');
  const e=value.execution;
  if(Object.keys(e).length!==6||Object.values(e).some(v=>!Number.isSafeInteger(v)||v<1)
    ||e.max_in_flight>4096||e.max_flushes>64||e.flush_size>4096||e.window_size>4096||e.flush_interval_ms>60000)
    throw Error('jev_stream_configuration_invalid');
  if(value.max_windows!==undefined&&(!Number.isSafeInteger(value.max_windows)||value.max_windows<1||value.max_windows>4096))
    throw Error('jev_window_limit_invalid');
  if(value.bootstrap_initial_calls!==undefined&&(!Number.isSafeInteger(value.bootstrap_initial_calls)
    ||value.bootstrap_initial_calls<1||value.bootstrap_initial_calls>32||value.bootstrap_initial_calls>e.window_size
    ||value.continuous_windows!==true||value.recovery_only===true||value.max_windows!==undefined))throw Error('jev_bootstrap_initial_invalid');
}
export type JevNextInputReadV3<Input>=Input[]|{inputs:Input[];byte_limited?:boolean;admission_deferred?:true};
export type JevNextInputBoundsV2={max_rows:number;max_working_bytes:number;
  /** Private synchronous notice from the canonical bounded prefix only. */
  on_byte_limit?:()=>void};
/** Native draft transport owns this fresh graph. Freeze it before creating a
 * reusable numeric quote; the quote never authenticates the later DB write. */
function freezeNativeDraft(value:unknown,budget:number,seen=new Set<object>(),cost={retained:0,temporary:0}):void{
 if(!value||typeof value!=='object'||seen.has(value))return;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==Array.prototype&&prototype!==null)throw Error('jev_native_draft_invalid');
 // One retained Set entry/object reference and bounded DFS/key/descriptor
 // scratch; bodies and the two future numeric vectors are charged separately.
 if(cost.retained+cost.temporary+64>budget)throw Error('jev_native_draft_memory_bound');
 cost.retained+=64;seen.add(value);
 const keys=Reflect.ownKeys(value),temporary=128+16*keys.length;
 if(cost.retained+cost.temporary+temporary>budget)throw Error('jev_native_draft_memory_bound');
 cost.temporary+=temporary;
 try{for(const key of keys){
  if(typeof key!=='string')throw Error('jev_native_draft_invalid');
  const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
  if(!('value'in descriptor))throw Error('jev_native_draft_invalid');
  freezeNativeDraft(descriptor.value,budget,seen,cost);
 }}finally{cost.temporary-=temporary;}
 Object.freeze(value);
}
async function withReleasedSelection<T>(body:()=>Promise<T>,release:()=>void):Promise<T>{
 let failed=false,primary:unknown,result:T|undefined;
 try{result=await body();}catch(error){failed=true;primary=error;}
 try{release();}catch(secondary){if(failed)throw new AggregateError([primary,secondary],'jev_selection_primary_and_release_failed',{cause:primary});throw secondary;}
 if(failed)throw primary;return result as T;
}
export const jevUsageV1 = (usage:JevResponseV1["usage"]):LlmUsageV1 => ({...usage,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
/** Shared page transport: one lease, durable raw before settlement, multi-row application.
 * JEV requests remain individual. A consumer may bound work through durable persistence. */
export async function processJevLabelingPageV1<Input extends FacetInput,Result>(args:{
  run_id:string;signal?:AbortSignal;store:ReturnType<typeof createSignalLabelingStoreV1<Input,Result>>;provider:JevProviderV1;
  prepare?(run:Readonly<LabelingRunV1>):Promise<JevPreparedExecutionV1>;
  /** DB-owned metadata/ID selection can enforce a byte bound before hydration. */
  read_next_inputs?(run:LabelingRunV1,bounds:JevNextInputBoundsV2,admission_signal:AbortSignal):Promise<JevNextInputReadV3<Input>>;
  /** Native continuous admission intentionally permits paid prefix progress
   * before a later budget/revocation failure. This is not cached authority. */
  initial_reservation?:{max_calls:1024;release_selection:()=>void};
  lease_renewal_ms?:number; execution?:JevStreamingExecutionV2;max_windows?:number;hooks:{
    price(run:LabelingRunV1):LlmPriceV1;
    propose(run:LabelingRunV1,inputs:Input[]):LabelingCallProposalV1<Input>[];
    map(run:LabelingRunV1,call:LabelingCallV1<Input>,parsed:JevResponseV1):Result[];
    error(run:LabelingRunV1,call:LabelingCallV1<Input>,code:string,unknown:boolean):Result[];
    labeled(result:Result):boolean;
    invalidUsage?(failure:JevProviderErrorV1):JevResponseV1["usage"]|undefined;
    response_budget_binding?(provider:JevProviderV1,execution:JevStreamingExecutionV2,recovery:boolean):JevPhaseClosedBindingV3|undefined;
    fail_on_error?:boolean;
    durable_raw_per_response?:boolean;
    recovery_only?:boolean;
    /** Only native adapters whose inputs exclude reserved identities opt in. */
    continuous_windows?(run:LabelingRunV1):boolean;
    prepare_next?(run:LabelingRunV1,inputs:Input[]):Promise<boolean|'wait_for_apply'>;
    /** Local immutable preparation revision only, never a permission decision. */
    preparation_valid?():boolean;
    observe_preparation?(event:SignalListeningPreparationObservationV1):void;
    /** Preserve a native calibration cohort's anchor order without compiling a
     * second request page. Its minimum must fit wholly before reservation. */
    select_next_inputs?(inputs:Input[]):{inputs:Input[];minimum_calls:number};
    /** Server-native Listening only; empty eligibility can advance after apply. */
    revisit_empty_after_apply?:boolean;
    /** Supplied by the native Listening continuation, never by identity JSON. */
    next_admission_hint?():JevFeedAdmissionHintV1;
    /** Constructor-only native adapter. No identity/configuration flag grants it. */
    native_admission?:{
      workspace_bound(run:LabelingRunV1,proposals:LabelingCallProposalV1<Input>[]):number;
      workspace_quote?(run:LabelingRunV1,proposals:LabelingCallProposalV1<Input>[]):JevNativeWorkspaceQuoteV1|null;
      committed?(hint:JevFeedAdmissionHintV1|undefined,ids:ReadonlyArray<string>,proposals:ReadonlyArray<LabelingCallProposalV1<Input>>):void;
    };
    max_in_flight?(run:LabelingRunV1):number|undefined;
  };
  observe_stream?(metrics:JevStreamingMetricsV2):void;
}): Promise<{status:string; roots?:number; labeled?:number; unresolved_billing_requests?:number;
  settled_micro_usd?:number; p50_ms?:number|null; p95_ms?:number|null}> {
  if(args.max_windows!==undefined&&(!args.execution||!Number.isSafeInteger(args.max_windows)||args.max_windows<1||args.max_windows>4096))
    throw new Error("jev_window_limit_invalid");
  if(args.initial_reservation&&(args.initial_reservation.max_calls!==1024||typeof args.initial_reservation.release_selection!=='function'))throw Error('jev_initial_reservation_invalid');
  if(args.signal?.aborted)return{status:'stopped'};
  if(args.signal&&!args.execution&&!args.prepare)throw Error('jev_external_signal_requires_streaming');
  const {store,hooks}=args;let provider=args.provider,execution=args.execution,maxWindows=args.max_windows,recoveryOnly=hooks.recovery_only===true,continuous=false,bootstrapInitialCalls:number|undefined;
  const run=await store.claim(args.run_id);
  if(!run)return {status:"not_claimed"};
  const cancellation=new AbortController();setMaxListeners(Math.max(201,(args.execution?.max_in_flight??0)*2+64),cancellation.signal);
  let leaseError:unknown,renewal:Promise<void>|undefined;
  const interval=args.lease_renewal_ms??60_000;
  if(!Number.isSafeInteger(interval)||interval<1||interval>60_000){await store.release(run);throw new Error("jev_renewal_interval_invalid");}
  const externalAbort=()=>cancellation.abort(args.signal?.reason);
  args.signal?.addEventListener('abort',externalAbort,{once:true});if(args.signal?.aborted)externalAbort();
  const heartbeat=setInterval(()=>{
    if(renewal||cancellation.signal.aborted)return;
    renewal=store.renew(run).catch(error=>{leaseError=error;cancellation.abort();}).finally(()=>{renewal=undefined;});
  },interval);heartbeat.unref?.();
  try{
    if(args.prepare){
      // Preparation may inspect server-owned inputs under this lease, never reserve
      // money or send requests. Selection is local and leaves caller arguments intact.
      const prepared=await args.prepare(Object.freeze({...run}));validatePreparedExecution(prepared);
      if(renewal)await renewal;if(leaseError)throw leaseError;
      if(cancellation.signal.aborted){if(args.signal?.aborted)return{status:'stopped'};throw Error('labeling_lease_lost');}
      provider=prepared.provider;execution=Object.freeze({...prepared.execution});maxWindows=prepared.max_windows;recoveryOnly||=prepared.recovery_only===true;continuous=prepared.continuous_windows===true;
      bootstrapInitialCalls=prepared.bootstrap_initial_calls;
      if(bootstrapInitialCalls!==undefined&&!args.initial_reservation)throw Error('jev_bootstrap_initial_invalid');
      setMaxListeners(Math.max(201,execution.max_in_flight*2+64),cancellation.signal);
    }
    continuous ||= hooks.continuous_windows?.(run)===true;
    const price=hooks.price(run);
    const maxInFlight=execution?.max_in_flight??hooks.max_in_flight?.(run);
    if(maxInFlight!==undefined&&(!Number.isSafeInteger(maxInFlight)||maxInFlight<1||maxInFlight>(execution?4096:200)))throw new Error("jev_page_concurrency_invalid");
    // Resolve prepare first, then validate the actual stream before hydration
    // or headroom arithmetic can mask its canonical configuration error.
    if(execution)assertJevStreamingExecutionV2(execution,provider);
    let windows=0;
    let aggregate: Awaited<ReturnType<typeof processJevStreamingWindowV2<Input,Result>>> | undefined;
    for (;;) {
      const pending=(await store.calls(run)).filter(call=>!call.results_applied);
      if(hooks.fail_on_error&&pending.some(call=>call.status==="unknown"&&!call.raw_body)
        &&!(recoveryOnly&&pending.some(call=>Boolean(call.raw_body)))){
        await store.fail(run,"labeling_outcome_unknown",execution?{preserve_reserved:true}:undefined);return {status:"outcome_unknown"};
      }
      if(execution&&run.error_code==="labeling_outcome_unknown"&&!pending.some(call=>Boolean(call.raw_body))){
        await store.finish(run);const refreshed=await store.refresh(run);run.error_code=refreshed.error_code;
        if(run.error_code==="labeling_outcome_unknown"){
          await store.fail(run,"labeling_outcome_unknown",{preserve_reserved:true});return {status:"outcome_unknown"};
        }
      }
      let responseBinding=execution&&!recoveryOnly&&!pending.some(call=>Boolean(call.raw_body))?hooks.response_budget_binding?.(provider,execution,recoveryOnly):undefined;
      const incrementalInitial=Boolean(args.initial_reservation&&execution&&continuous&&maxWindows===undefined&&args.max_windows===undefined&&windows===0
        &&hooks.revisit_empty_after_apply===true&&!pending.length&&!run.error_code&&!recoveryOnly&&!cancellation.signal.aborted);
      let calls=(recoveryOnly?pending.filter(call=>Boolean(call.raw_body)):pending).slice(0,execution?.window_size??200);
      if(recoveryOnly&&!calls.length)return {status:"recovery_unavailable"};
      if(!calls.length&&!run.error_code&&!recoveryOnly&&!cancellation.signal.aborted){
        // Native continuous consumers reserve room for at least one response
        // before hydrating input text or compiling copied request bodies.
        const inputBudget=execution&&continuous?execution.max_buffered_bytes-jevResponseInitialHeadroomV3(provider,execution,undefined,Boolean(responseBinding)):undefined;
        if(inputBudget!==undefined&&inputBudget<1)throw Error('jev_stream_input_memory_budget_exceeded');
        if(incrementalInitial){
          calls=await withReleasedSelection(async()=>{
            // Read/calibrate the original selection and anchors; only this new
            // reservation's proposals are bounded. The remainder is read fresh.
            const inputs=await store.inputs(run,{max_rows:execution!.window_size,max_working_bytes:inputBudget!,on_oversize:'error'});
            // Ordinary measured work retains the existing small paid prefix.
            // Bootstrap must retain ALL <=32 anchors even with one HTTP slot;
            // otherwise releasing the original page can strand a far extreme.
            const limit=bootstrapInitialCalls??Math.min(args.initial_reservation!.max_calls,execution!.window_size,execution!.max_in_flight,provider.max_concurrency??execution!.max_in_flight);
            const proposals=hooks.propose(run,inputs.slice(0,limit)).slice(0,limit);
            if(bootstrapInitialCalls!==undefined&&proposals.length!==bootstrapInitialCalls)throw Error('jev_bootstrap_initial_incomplete');
            return proposals.length?(await store.reserve(run,proposals)).slice(0,limit):[];
          },args.initial_reservation!.release_selection);
        }else{
          const inputs=await store.inputs(run,inputBudget===undefined?undefined:{max_rows:execution!.window_size,max_working_bytes:inputBudget,on_oversize:'error'});
          const proposals=hooks.propose(run,inputs).slice(0,execution?.window_size??200);
          if(proposals.length)calls=(await store.reserve(run,proposals)).slice(0,execution?.window_size??200);
        }
      }
      if(execution)responseBinding=selectJevPhaseInitialBindingV3(responseBinding,provider,execution,hooks.map,calls,calls.reduce((sum,call)=>sum+Buffer.byteLength(call.raw_body??'')+jevCallWorkingBytesV2(call),0));
      const reserved=run.error_code?[]:calls.filter(call=>call.status==="reserved"&&!call.raw_body);
      if(execution)assertJevStreamingExecutionV2(execution,provider);
      if(!execution&&reserved.length)await store.markSubmitting(run,reserved);
      if(execution) {
        // Opt-in native inputs exclude call_roots/question digests as soon as
        // reserve commits. Never prefetch through pending recovery or unknown.
        let fedWindows=1;
        const feed=continuous&&!pending.length&&!recoveryOnly&&!run.error_code&&(maxWindows??Infinity)>windows+1
          ?async(available:number,maxCalls:number,admissionSignal:AbortSignal):Promise<JevFeedResultV1<Input>>=>{
            let failed=false,primary:unknown;
            const clip:Extract<SignalListeningPreparationObservationV1,{kind:'compile_clip'}>|undefined=hooks.observe_preparation?{
              kind:'compile_clip',outcome:'closed',read_calls:null,selected_calls:null,compiled_calls:null,returned_calls:null,workspace_clip:false,limit_calls:null,max_calls:maxCalls,
              minimum_calls:null,covered_limit:null,native_prefix:null,available_bytes:available,compiled_bytes:null,quote_metadata_bytes:null,
              window_tie:false,physical_tie:false,provider_tie:false,native_tie:false,bootstrap_tie:false,stop:'unreached'}:undefined;
            try{
              if(renewal)await renewal;if(leaseError)throw leaseError;
              if(admissionSignal.aborted||cancellation.signal.aborted||windows+fedWindows>=(maxWindows??Infinity))return{closed:true};
              const beforeRead=hooks.next_admission_hint?.();
              if(beforeRead?.kind==='closed'){if(clip)clip.stop='closed';return{closed:true};}
              if(beforeRead?.kind==='bootstrap'&&beforeRead.wait_for_apply){if(clip){clip.outcome='deferred';clip.stop='preparation_deferred';}return{calls:[],byte_limited:false,admission_deferred:true};}
              let byteLimited=false;
              const bounds={max_rows:maxCalls,max_working_bytes:available,on_byte_limit:()=>{byteLimited=true;}};
              const read=await(args.read_next_inputs?args.read_next_inputs(run,bounds,admissionSignal):store.inputs(run,{...bounds,on_oversize:'empty'}));
              if(admissionSignal.aborted||cancellation.signal.aborted){if(clip)clip.stop='aborted';return{closed:true};}
              const inputs=(Array.isArray(read)?read:read.inputs).slice(0,maxCalls);if(clip)clip.read_calls=inputs.length;
              if(!Array.isArray(read)){byteLimited||=read.byte_limited===true;if(read.admission_deferred){if(clip){clip.outcome='deferred';clip.stop='preparation_deferred';}return{calls:[],byte_limited:byteLimited,admission_deferred:true};}}
              if(admissionSignal.aborted||cancellation.signal.aborted){if(clip)clip.stop='aborted';return{closed:true};}
              const afterRead=hooks.next_admission_hint?.();
              if(afterRead?.kind==='closed'){if(clip)clip.stop='closed';return{closed:true};}
              if(afterRead?.kind==='bootstrap'&&afterRead.wait_for_apply){if(clip){clip.outcome='deferred';clip.stop='preparation_deferred';}return{calls:[],byte_limited:false,admission_deferred:true};}
              if(!inputs.length){if(clip){clip.outcome='empty';clip.stop='input_exhausted';}return byteLimited?{calls:[],byte_limited:true}:[];}
              if(hooks.prepare_next){
                const prepared=await hooks.prepare_next(run,inputs);
                if(prepared==='wait_for_apply'){if(clip){clip.outcome='deferred';clip.stop='preparation_deferred';}return{calls:[],byte_limited:false,admission_deferred:true};}
                if(prepared===false){if(clip)clip.stop='closed';return{closed:true};}
                if(prepared!==true)throw Error('jev_preparation_invalid');
              }
              if(admissionSignal.aborted||cancellation.signal.aborted){if(clip)clip.stop='aborted';return{closed:true};}
              if(hooks.preparation_valid?.()===false){if(clip){clip.outcome='deferred';clip.stop='invalidated';}return{calls:[],byte_limited:false,admission_deferred:true};}
              const priority=hooks.next_admission_hint?.();
              if(priority?.kind==='closed'){if(clip)clip.stop='closed';return{closed:true};}
              if(priority?.kind==='bootstrap'&&priority.wait_for_apply){if(clip){clip.outcome='deferred';clip.stop='preparation_deferred';}return{calls:[],byte_limited:false,admission_deferred:true};}
              // Compile incrementally: never retain a second full request page
              // merely to discover that its copied bodies exceed free memory.
              const selected=hooks.select_next_inputs?.(inputs)??{inputs,minimum_calls:0};
              if(!Number.isSafeInteger(selected.minimum_calls)||selected.minimum_calls<0||selected.minimum_calls>32
                ||selected.minimum_calls>selected.inputs.length||selected.inputs.length>inputs.length)throw Error('jev_bootstrap_next_invalid');
              // A bootstrap/filter can intentionally admit fewer roots than
              // the reader returned. That is not a byte-limited reservation.
              byteLimited&&=selected.minimum_calls===0&&selected.inputs.length===inputs.length;
              // Reserve the complete selected anchors before covered work. The
              // native return order is not their survey order; covered inputs
              // are read fresh after this intentionally smaller paid prefix.
              const coveredLimit=priority?.kind==='bootstrap'&&selected.minimum_calls===0?priority.covered_call_limit:undefined;
              if(coveredLimit!==undefined&&(!Number.isSafeInteger(coveredLimit)||coveredLimit<1||coveredLimit>32))throw Error('jev_bootstrap_overlap_invalid');
              let physicalLimit:number|undefined,providerLimit:number|undefined;
              let nativePrefix=Boolean(hooks.native_admission&&store.admitAndMarkSelected&&selected.minimum_calls===0),
                anchorPrefix=selected.minimum_calls>0,coveredPrefix=coveredLimit!==undefined,
                limit=Math.min(maxCalls,selected.minimum_calls||coveredLimit||(nativePrefix?Math.min(1024,(physicalLimit=execution!.max_in_flight),(providerLimit=provider.max_concurrency??execution!.max_in_flight)):maxCalls));
              const bounded:LabelingCallProposalV1<Input>[]=[];let bytes=0;
              if(clip){clip.selected_calls=selected.inputs.length;clip.minimum_calls=selected.minimum_calls;clip.covered_limit=coveredLimit??null;
                clip.limit_calls=limit;clip.native_prefix=nativePrefix;clip.compiled_calls=0;clip.compiled_bytes=0;clip.stop='input_exhausted';
                clip.window_tie=limit===maxCalls;clip.physical_tie=nativePrefix&&limit===physicalLimit;
                clip.provider_tie=nativePrefix&&limit===providerLimit;clip.native_tie=nativePrefix&&limit===1024;
                clip.bootstrap_tie=(anchorPrefix&&limit===selected.minimum_calls)||(coveredPrefix&&limit===coveredLimit);}

              outer:for(const input of selected.inputs){
               if((anchorPrefix||coveredPrefix||nativePrefix)&&bounded.length>=limit){if(clip)clip.stop='call_limit';break;}
               const proposals=hooks.propose(run,[input]);
               // Native anchors map one-to-one to calls. A generic hook can
               // emit zero/many; retain its legacy window without re-proposing
               // inputs or cutting that group at an assumed anchor boundary.
               if((anchorPrefix||coveredPrefix||nativePrefix)&&proposals.length!==1){anchorPrefix=false;coveredPrefix=false;nativePrefix=false;limit=maxCalls;if(clip){clip.native_prefix=false;clip.limit_calls=limit;clip.window_tie=true;clip.physical_tie=false;clip.provider_tie=false;clip.native_tie=false;clip.bootstrap_tie=false;}}
               for(const proposal of proposals){
                const cost=jevCallWorkingBytesV2(proposal)+8192;
                if(bounded.length>=limit){if(clip)clip.stop='call_limit';break outer;}
                const quoteMetadata=nativePrefix&&hooks.native_admission?.workspace_quote?2*(256+8*(bounded.length+2)):0;
                if(clip)clip.quote_metadata_bytes=quoteMetadata;
                if(bytes+cost+quoteMetadata>available){if(clip)clip.stop='compile_memory';byteLimited=true;break outer;}
                bytes+=cost;bounded.push(proposal);if(clip){clip.compiled_calls=bounded.length;clip.compiled_bytes=bytes;}
                // Compile outside the native reservation transaction without
                // monopolizing the event loop while other HTTP timers run.
                if(bounded.length%64===0){
                  await yieldToEventLoop();
                  if(admissionSignal.aborted||cancellation.signal.aborted){if(clip)clip.stop='aborted';return{closed:true};}
                  if(hooks.preparation_valid?.()===false){if(clip){clip.outcome='deferred';clip.stop='invalidated';}return{calls:[],byte_limited:false,admission_deferred:true};}
                }
               }
              }
              if(!bounded.length||bounded.length<selected.minimum_calls||admissionSignal.aborted||cancellation.signal.aborted)return{closed:true};
              if(nativePrefix){
                if(hooks.native_admission!.workspace_quote){
                  // Preparation is bounded independently of the earlier free
                  // snapshot. Pure O(1) prefix queries will be used by the ONE
                  // coordinator against its current custody, not this `available`.
                  const metadataBeforeFreeze=2*(256+8*(bounded.length+1)),bodyBeforeFreeze=bounded.reduce((n,p)=>n+jevCallWorkingBytesV2(p)+8192,0);
                  const freezeBudget=available-metadataBeforeFreeze-bodyBeforeFreeze;
                  if(freezeBudget<0)throw Error('jev_native_draft_memory_bound');
                  for(let index=0;index<bounded.length;index++){
                    freezeNativeDraft(bounded[index],freezeBudget);
                    if((index+1)%64===0){await yieldToEventLoop();if(admissionSignal.aborted||cancellation.signal.aborted){if(clip)clip.stop='aborted';return{closed:true};}if(hooks.preparation_valid?.()===false){if(clip){clip.outcome='deferred';clip.stop='invalidated';}return{calls:[],byte_limited:false,admission_deferred:true};}}
                  }
                  const expectedMetadata=256+8*(bounded.length+1),returnedPrefix=[0];
                  for(const proposal of bounded)returnedPrefix.push(returnedPrefix.at(-1)!+jevCallWorkingBytesV2(proposal));
                  const retained=returnedPrefix.at(-1)!+8192*bounded.length;
                  if(retained+2*expectedMetadata>available)throw Error('jev_native_draft_memory_bound');
                  const workspaceQuote=hooks.native_admission!.workspace_quote(run,bounded);
                  if(workspaceQuote){
                    if(workspaceQuote.length!==bounded.length||workspaceQuote.retained_bytes!==expectedMetadata)throw Error('jev_native_quote_invalid');
                    const workspace=workspaceQuote.quote(bounded.length);
                    if(!Number.isSafeInteger(workspace)||workspace<0)throw Error('jev_native_workspace_invalid');
                    Object.freeze(bounded);
                    if(clip){clip.outcome='native';clip.returned_calls=bounded.length;}
                    fedWindows++;return{proposals:bounded,workspace_bytes:workspace,workspace_quote:workspaceQuote,call_working_prefix:Object.freeze(returnedPrefix),byte_limited:byteLimited,
                      on_committed:(ids,admitted)=>hooks.native_admission!.committed?.(priority,ids,admitted)};
                  }
                }
                // The 4096-row survey is intact. Only the fresh native draft is
                // smaller; skipped identities remain pending for a fresh RR.
                const reservation=assertJevStreamingExecutionV2(execution!,provider);
                // Quote is monotone for JSON prefixes: configuration is fixed,
                // and every added proposal contributes nonnegative units/nodes.
                // Cache request costs once and search the largest fitting prefix;
                // repeatedly requoting every removed row would be quadratic.
                const returnedCosts=[0];
                for(const proposal of bounded)returnedCosts.push(returnedCosts.at(-1)!+jevCallWorkingBytesV2(proposal));
                const quote=(count:number)=>{
                  const value=hooks.native_admission!.workspace_bound(run,bounded.slice(0,count));
                  if(!Number.isSafeInteger(value)||value<0)throw Error('jev_native_workspace_invalid');
                  return value;
                };
                // Existing escrows already belong to the shared stream counter;
                // do not charge them again to this unpaid preparation quote.
                // Fresh selectFresh/Mark recomputes exact growth before COMMIT.
                const fits=(count:number,value:number)=>returnedCosts[count]!*2+8192*count+value+reservation*count<=available;
                let workspace:number|undefined;
                try{
                  const full=quote(bounded.length);
                  if(fits(bounded.length,full))workspace=full;
                  else{
                    let low=1,high=bounded.length-1,best=0;
                    while(low<=high){
                      const mid=Math.floor((low+high)/2),value=quote(mid);
                      if(fits(mid,value)){best=mid;workspace=value;low=mid+1;}
                      else high=mid-1;
                    }
                    bounded.length=best||1;if(clip)clip.workspace_clip=true;bytes=returnedCosts[bounded.length]!+8192*bounded.length;
                  }
                }catch{workspace=undefined;}
                if(workspace!==undefined&&bounded.length){
                  if(clip){clip.outcome='native';clip.returned_calls=bounded.length;}
                  fedWindows++;return{proposals:bounded,workspace_bytes:workspace,byte_limited:byteLimited,
                    on_committed:(ids,admitted)=>hooks.native_admission!.committed?.(priority,ids,admitted)};
                }
                // Invalid/too-large native workspace never invokes native DML.
                // If a fitting draft is impossible, retain the old protocol.
                if(!bounded.length)return{closed:true};
              }
              const next=await store.reserve(run,bounded);if(clip){clip.outcome='legacy';clip.returned_calls=next.length;}fedWindows++;
              return next.length?{calls:next,byte_limited:byteLimited&&selected.minimum_calls===0}:{closed:true};
            }catch(error){if(clip)clip.outcome='threw';failed=true;primary=error;throw error;}finally{
              if(clip)try{hooks.observe_preparation?.(clip);}catch{/* A diagnostic never replaces the first error or release. */}
              if(incrementalInitial)try{args.initial_reservation!.release_selection();}catch(secondary){if(failed)throw new AggregateError([primary,secondary],'jev_selection_primary_and_release_failed',{cause:primary});throw secondary;}
            }
          }:undefined;
        const outcome = await processJevStreamingWindowV2({run,calls,send_calls:reserved,store,provider,execution:execution,price,cancellation,hooks,observe_stream:args.observe_stream,feed_next:feed,next_admission_hint:hooks.next_admission_hint,revisit_empty_after_apply:Boolean(feed)&&hooks.revisit_empty_after_apply===true,defer_initial_prefetch_until_handoff:incrementalInitial&&reserved.length>0,preparation_valid:hooks.preparation_valid,observe_preparation:hooks.observe_preparation,response_budget_binding:responseBinding});
        aggregate = { ...outcome, roots:(aggregate?.roots??0)+outcome.roots,
          labeled:(aggregate?.labeled??0)+outcome.labeled,
          settled_micro_usd:(aggregate?.settled_micro_usd??0)+outcome.settled_micro_usd,
          unresolved_billing_requests:(aggregate?.unresolved_billing_requests??0)+outcome.unresolved_billing_requests };
        windows+=fedWindows;
        if(run.error_code){const refreshed=await store.refresh(run);run.error_code=refreshed.error_code;}
        if(leaseError)throw leaseError;
        if(args.signal?.aborted&&!outcome.unresolved_billing_requests)return{...aggregate,status:'stopped'};
        if(feed||cancellation.signal.aborted||outcome.status!=="running"||!calls.length||outcome.unresolved_billing_requests||recoveryOnly||windows>=(maxWindows??Infinity))return aggregate;
        continue;
      }
    const rawPage:Array<{call:LabelingCallV1<Input>;raw:string}>=[];
    const errors:Array<{call:LabelingCallV1<Input>;unknown:boolean;code:string;transport?:boolean}>=[];
    let nextCall=0;
    const workerCount=Math.min(reserved.length,maxInFlight??reserved.length);
    await Promise.all(Array.from({length:workerCount},async()=>{
      for(;;){
        const call=reserved[nextCall++];
        if(!call)return;
        try{const raw=await provider.evaluate(call.request as JevRequestV1,{signal:cancellation.signal});
          const encoded=JSON.stringify(raw);
          if(hooks.durable_raw_per_response)await store.persistRaw(run,call,encoded);
          rawPage.push({call,raw:encoded});}
        catch(error){const failure=jevProviderErrorV1(error);errors.push({call,unknown:failure.outcome!=="definitely_not_sent",code:failure.code,transport:true});}
      }
    }));
    try{if(rawPage.length&&!hooks.durable_raw_per_response)await store.persistRawPage(run,rawPage);}
    catch(error){if(hooks.fail_on_error){await store.markFailed(run,rawPage.map(page=>page.call),true);
      await store.fail(run,"labeling_outcome_unknown");}throw error;}
    if(renewal)await renewal;
    if(leaseError){
      for(const unknown of [false,true]){const group=errors.filter(error=>error.unknown===unknown);
        if(group.length)await store.markFailed(run,group.map(error=>error.call),unknown);}
      throw leaseError;
    }
    const results:Array<{call:LabelingCallV1<Input>;results:Result[]}>=[];
    const settlement:Array<{call:LabelingCallV1<Input>;usage:LlmUsageV1;settled_micro_usd:number;stop_reason:string}>=[];
    const latencies:number[]=[];
    for(const call of calls){
      const rawText=rawPage.find(page=>page.call.id===call.id)?.raw??call.raw_body;
      if(!rawText){if(!errors.some(error=>error.call.id===call.id))errors.push({call,unknown:call.status!=="failed",
        code:call.status==="failed"?"jev_definitely_not_sent":"jev_outcome_unknown"});continue;}
      try{
        const raw=JSON.parse(rawText) as JevRawResponseV1,parsed=validateJevResponseV1(call.request as JevRequestV1,raw);
        const mapped=hooks.map(run,call,parsed),usage=jevUsageV1(parsed.usage);
        settlement.push({call,usage,settled_micro_usd:llmCostMicroUsdV1(usage,price),stop_reason:"completed"});
        results.push({call,results:mapped});latencies.push(raw.latency_ms);
      }catch(error){
        const failure=jevProviderErrorV1(error),observed=failure.outcome==='outcome_unknown'?undefined:hooks.invalidUsage?.(failure)??failure.evidence.usage;
        if(observed){const usage=jevUsageV1(observed);settlement.push({call,usage,settled_micro_usd:llmCostMicroUsdV1(usage,price),stop_reason:failure.code});
          results.push({call,results:hooks.error(run,call,failure.code,false)});
          if(hooks.fail_on_error)errors.push({call,unknown:false,code:failure.code});
        }else errors.push({call,unknown:true,code:failure.code});
      }
    }
    if(settlement.length)await store.settlePage(run,settlement);
    for(const unknown of [false,true]){
      const group=errors.filter(error=>error.unknown===unknown&&!settlement.some(page=>page.call.id===error.call.id));
      if(group.length)await store.markFailed(run,group.map(error=>error.call),unknown);
      for(const error of group){const mapped=hooks.error(run,error.call,error.code,unknown);if(mapped.length)results.push({call:error.call,results:mapped});}
    }
    if(results.length)await store.apply(run,results);
    if(hooks.fail_on_error&&errors.length)await store.fail(run,errors.some(error=>error.unknown)?"labeling_outcome_unknown":errors[0]!.code);
    if(hooks.fail_on_error&&errors.some(error=>error.transport))throw new Error(errors.find(error=>error.transport)!.code);
    latencies.sort((a,b)=>a-b);
    return {status:await store.finish(run),roots:calls.length,labeled:results.filter(page=>page.results.some(hooks.labeled)).length,
      unresolved_billing_requests:errors.filter(error=>error.unknown).length,
      settled_micro_usd:settlement.reduce((sum,page)=>sum+page.settled_micro_usd,0),
      p50_ms:latencies[Math.ceil(latencies.length*0.5)-1]??null,p95_ms:latencies[Math.ceil(latencies.length*0.95)-1]??null};
    }
  }catch(error){
    const code=error&&typeof error==="object"&&"code"in error?String(error.code):"";
    if(["labeling_forbidden","labeling_policy_changed","labeling_preparation_changed","labeling_context_changed",
      "labeling_cap_exhausted","labeling_daily_cap_exhausted","labeling_raw_receipt_invalid"].includes(code))await store.fail(run,code,execution?{preserve_reserved:true}:undefined);
    throw error;
  }finally{args.signal?.removeEventListener('abort',externalAbort);clearInterval(heartbeat);if(renewal)await renewal;await store.release(run,execution?{immediate:true}:undefined);}
}
