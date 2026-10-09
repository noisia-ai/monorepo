import { setMaxListeners } from "node:events";
import { llmCostMicroUsdV1, type FacetInput, type LlmPriceV1, type LlmUsageV1 } from "@noisia/query-engine";
import type { createSignalLabelingStoreV1, LabelingRunV1, LabelingCallV1, LabelingCallProposalV1 } from "@noisia/db";
import { validateJevResponseV1, jevProviderErrorV1, type JevProviderV1, type JevRawResponseV1,
  type JevRequestV1, type JevResponseV1, type JevProviderErrorV1 } from "../providers/typesafe-jev";

export const jevUsageV1 = (usage:JevResponseV1["usage"]):LlmUsageV1 => ({...usage,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
/** Shared page transport: one lease, durable raw before settlement, multi-row application.
 * JEV requests remain individual; its existing provider owns concurrency/cancellation. */
export async function processJevLabelingPageV1<Input extends FacetInput,Result>(args:{
  run_id:string;store:ReturnType<typeof createSignalLabelingStoreV1<Input,Result>>;provider:JevProviderV1;
  lease_renewal_ms?:number;hooks:{
    price(run:LabelingRunV1):LlmPriceV1;
    propose(run:LabelingRunV1,inputs:Input[]):LabelingCallProposalV1<Input>[];
    map(run:LabelingRunV1,call:LabelingCallV1<Input>,parsed:JevResponseV1):Result[];
    error(run:LabelingRunV1,call:LabelingCallV1<Input>,code:string,unknown:boolean):Result[];
    labeled(result:Result):boolean;
    invalidUsage?(failure:JevProviderErrorV1):JevResponseV1["usage"]|undefined;
    fail_on_error?:boolean;
  };
}){
  const {store,provider,hooks}=args,run=await store.claim(args.run_id);
  if(!run)return {status:"not_claimed"};
  const cancellation=new AbortController();setMaxListeners(201,cancellation.signal);
  let leaseError:unknown,renewal:Promise<void>|undefined;
  const interval=args.lease_renewal_ms??60_000;
  if(!Number.isSafeInteger(interval)||interval<1||interval>60_000){await store.release(run);throw new Error("jev_renewal_interval_invalid");}
  const heartbeat=setInterval(()=>{
    if(renewal||cancellation.signal.aborted)return;
    renewal=store.renew(run).catch(error=>{leaseError=error;cancellation.abort();}).finally(()=>{renewal=undefined;});
  },interval);heartbeat.unref?.();
  try{
    const price=hooks.price(run);
    let calls=(await store.calls(run)).filter(call=>!call.results_applied).slice(0,200);
    if(hooks.fail_on_error&&calls.some(call=>call.status==="unknown"&&!call.raw_body)){
      await store.fail(run,"labeling_outcome_unknown");return {status:"outcome_unknown"};
    }
    if(!calls.length&&!run.error_code){
      const proposals=hooks.propose(run,await store.inputs(run));
      if(proposals.length)calls=(await store.reserve(run,proposals)).slice(0,200);
    }
    const reserved=run.error_code?[]:calls.filter(call=>call.status==="reserved"&&!call.raw_body);
    if(reserved.length)await store.markSubmitting(run,reserved);
    const rawPage:Array<{call:LabelingCallV1<Input>;raw:string}>=[];
    const errors:Array<{call:LabelingCallV1<Input>;unknown:boolean;code:string;transport?:boolean}>=[];
    await Promise.all(reserved.map(async call=>{
      try{const raw=await provider.evaluate(call.request as JevRequestV1,{signal:cancellation.signal});
        rawPage.push({call,raw:JSON.stringify(raw)});}
      catch(error){const failure=jevProviderErrorV1(error);errors.push({call,unknown:failure.outcome!=="definitely_not_sent",code:failure.code,transport:true});}
    }));
    try{if(rawPage.length)await store.persistRawPage(run,rawPage);}
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
        const failure=jevProviderErrorV1(error),observed=hooks.invalidUsage?.(failure)??failure.evidence.usage;
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
  }catch(error){
    const code=error&&typeof error==="object"&&"code"in error?String(error.code):"";
    if(["labeling_forbidden","labeling_policy_changed","labeling_preparation_changed","labeling_context_changed",
      "labeling_cap_exhausted","labeling_daily_cap_exhausted","labeling_raw_receipt_invalid"].includes(code))await store.fail(run,code);
    throw error;
  }finally{clearInterval(heartbeat);if(renewal)await renewal;await store.release(run);}
}
