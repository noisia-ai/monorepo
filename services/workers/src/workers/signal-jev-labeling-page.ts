import { assertJevStreamingExecutionV2, jevCallWorkingBytesV2, processJevStreamingWindowV2, type JevStreamingExecutionV2, type JevStreamingMetricsV2 } from './signal-jev-streaming-window';
import { setMaxListeners } from "node:events";
import { llmCostMicroUsdV1, type FacetInput, type LlmPriceV1, type LlmUsageV1 } from "@noisia/query-engine";
import type { createSignalLabelingStoreV1, LabelingRunV1, LabelingCallV1, LabelingCallProposalV1 } from "@noisia/db";
import { validateJevResponseV1, jevProviderErrorV1, type JevProviderV1, type JevRawResponseV1,
  type JevRequestV1, type JevResponseV1, type JevProviderErrorV1 } from "../providers/typesafe-jev";

export type JevPreparedExecutionV1 = {provider:JevProviderV1;execution:JevStreamingExecutionV2;max_windows?:number;recovery_only?:boolean;continuous_windows?:boolean};
function validatePreparedExecution(value:JevPreparedExecutionV1){
  if(!value||typeof value.provider?.evaluate!=='function'||!value.execution||value.recovery_only!==undefined&&typeof value.recovery_only!=='boolean'||value.continuous_windows!==undefined&&typeof value.continuous_windows!=='boolean')throw Error('jev_preparation_invalid');
  const e=value.execution;
  if(Object.keys(e).length!==6||Object.values(e).some(v=>!Number.isSafeInteger(v)||v<1)
    ||e.max_in_flight>4096||e.max_flushes>64||e.flush_size>4096||e.window_size>4096||e.flush_interval_ms>60000)
    throw Error('jev_stream_configuration_invalid');
  if(value.max_windows!==undefined&&(!Number.isSafeInteger(value.max_windows)||value.max_windows<1||value.max_windows>4096))
    throw Error('jev_window_limit_invalid');
}
export type JevNextInputBoundsV2={max_rows:number;max_working_bytes:number};
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
  read_next_inputs?(run:LabelingRunV1,bounds:JevNextInputBoundsV2):Promise<Input[]>;
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
    fail_on_error?:boolean;
    durable_raw_per_response?:boolean;
    recovery_only?:boolean;
    /** Only native adapters whose inputs exclude reserved identities opt in. */
    continuous_windows?(run:LabelingRunV1):boolean;
    prepare_next?(run:LabelingRunV1,inputs:Input[]):Promise<boolean>;
    /** Server-native Listening only; empty eligibility can advance after apply. */
    revisit_empty_after_apply?:boolean;
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
  const {store,hooks}=args;let provider=args.provider,execution=args.execution,maxWindows=args.max_windows,recoveryOnly=hooks.recovery_only===true,continuous=false;
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
      setMaxListeners(Math.max(201,execution.max_in_flight*2+64),cancellation.signal);
    }
    continuous ||= hooks.continuous_windows?.(run)===true;
    const price=hooks.price(run);
    const maxInFlight=execution?.max_in_flight??hooks.max_in_flight?.(run);
    if(maxInFlight!==undefined&&(!Number.isSafeInteger(maxInFlight)||maxInFlight<1||maxInFlight>(execution?4096:200)))throw new Error("jev_page_concurrency_invalid");
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
      const incrementalInitial=Boolean(args.initial_reservation&&execution&&continuous&&maxWindows===undefined&&args.max_windows===undefined&&windows===0
        &&hooks.revisit_empty_after_apply===true&&!pending.length&&!run.error_code&&!recoveryOnly&&!cancellation.signal.aborted);
      let calls=(recoveryOnly?pending.filter(call=>Boolean(call.raw_body)):pending).slice(0,execution?.window_size??200);
      if(recoveryOnly&&!calls.length)return {status:"recovery_unavailable"};
      if(!calls.length&&!run.error_code&&!recoveryOnly&&!cancellation.signal.aborted){
        // Native continuous consumers reserve room for at least one response
        // before hydrating input text or compiling copied request bodies.
        const inputBudget=execution&&continuous?execution.max_buffered_bytes-assertJevStreamingExecutionV2(execution,provider):undefined;
        if(inputBudget!==undefined&&inputBudget<1)throw Error('jev_stream_input_memory_budget_exceeded');
        if(incrementalInitial){
          calls=await withReleasedSelection(async()=>{
            // Read/calibrate the original selection and anchors; only this new
            // reservation's proposals are bounded. The remainder is read fresh.
            const inputs=await store.inputs(run,{max_rows:execution!.window_size,max_working_bytes:inputBudget!,on_oversize:'error'});
            const limit=Math.min(args.initial_reservation!.max_calls,execution!.window_size,execution!.max_in_flight,provider.max_concurrency??execution!.max_in_flight);
            const proposals=hooks.propose(run,inputs.slice(0,limit)).slice(0,limit);
            return proposals.length?(await store.reserve(run,proposals)).slice(0,limit):[];
          },args.initial_reservation!.release_selection);
        }else{
          const inputs=await store.inputs(run,inputBudget===undefined?undefined:{max_rows:execution!.window_size,max_working_bytes:inputBudget,on_oversize:'error'});
          const proposals=hooks.propose(run,inputs).slice(0,execution?.window_size??200);
          if(proposals.length)calls=(await store.reserve(run,proposals)).slice(0,execution?.window_size??200);
        }
      }
      const reserved=run.error_code?[]:calls.filter(call=>call.status==="reserved"&&!call.raw_body);
      if(execution)assertJevStreamingExecutionV2(execution,provider);
      if(!execution&&reserved.length)await store.markSubmitting(run,reserved);
      if(execution) {
        // Opt-in native inputs exclude call_roots/question digests as soon as
        // reserve commits. Never prefetch through pending recovery or unknown.
        let fedWindows=1;
        const feed=continuous&&!pending.length&&!recoveryOnly&&!run.error_code&&(maxWindows??Infinity)>windows+1
          ?async(available:number,maxCalls:number,admissionSignal:AbortSignal):Promise<LabelingCallV1<Input>[]|{closed:true}>=>{
            let failed=false,primary:unknown;
            try{
              if(renewal)await renewal;if(leaseError)throw leaseError;
              if(admissionSignal.aborted||cancellation.signal.aborted||windows+fedWindows>=(maxWindows??Infinity))return{closed:true};
              const inputs=(await(args.read_next_inputs?args.read_next_inputs(run,{max_rows:maxCalls,max_working_bytes:available}):store.inputs(run,{max_rows:maxCalls,max_working_bytes:available,on_oversize:'empty'}))).slice(0,maxCalls);
              if(admissionSignal.aborted||cancellation.signal.aborted)return{closed:true};
              if(!inputs.length)return[];
              if(hooks.prepare_next&&!await hooks.prepare_next(run,inputs))return{closed:true};
              if(admissionSignal.aborted||cancellation.signal.aborted)return{closed:true};
              // Compile incrementally: never retain a second full request page
              // merely to discover that its copied bodies exceed free memory.
              const bounded:LabelingCallProposalV1<Input>[]=[];let bytes=0;
              outer:for(const input of inputs)for(const proposal of hooks.propose(run,[input])){
                const cost=jevCallWorkingBytesV2(proposal)+8192;
                if(bytes+cost>available||bounded.length>=maxCalls)break outer;
                bytes+=cost;bounded.push(proposal);
              }
              if(!bounded.length||admissionSignal.aborted||cancellation.signal.aborted)return{closed:true};
              const next=await store.reserve(run,bounded);fedWindows++;
              return next.length?next:{closed:true};
            }catch(error){failed=true;primary=error;throw error;}finally{
              if(incrementalInitial)try{args.initial_reservation!.release_selection();}catch(secondary){if(failed)throw new AggregateError([primary,secondary],'jev_selection_primary_and_release_failed',{cause:primary});throw secondary;}
            }
          }:undefined;
        const outcome = await processJevStreamingWindowV2({run,calls,send_calls:reserved,store,provider,execution:execution,price,cancellation,hooks,observe_stream:args.observe_stream,feed_next:feed,revisit_empty_after_apply:Boolean(feed)&&hooks.revisit_empty_after_apply===true,defer_initial_prefetch_until_handoff:incrementalInitial&&reserved.length>0});
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
