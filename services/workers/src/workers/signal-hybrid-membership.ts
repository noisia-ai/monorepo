import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHybridJevQuestionV1, llmCostMicroUsdV1, llmPriceV1, mapHybridJevAnswerV1,
  signalWorkspaceEmbeddingDigestV1 as digest, type MembershipResultV1, type LlmUsageV1,
} from "@noisia/query-engine";
import { createHybridMembershipStageStoreV1, type HybridStageInputV1, type HybridStageResultV1,
  type HybridMembershipStageV1, type LabelingRunV1, type ConceptMembershipStoreV1 } from "@noisia/db";
import { createTypesafeJevClientV1 } from "../providers/typesafe-jev";
import { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";
import { processJevLabelingPageV1 } from "./signal-jev-labeling-page";
import { runConceptMembershipTickV1 } from "./signal-concept-membership-batch";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { readSignalLabelingReceiptV1 } from "./signal-labeling-receipt-storage";

const zeroUsage = ():LlmUsageV1 => ({input_tokens:0,output_tokens:0,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
export const hybridReceiptFilenameV1 = (callId:string) => `hybrid-${callId}.json`;
export function createHybridMembershipRuntimeStoreV1(stage:HybridMembershipStageV1,
  database:Parameters<typeof createHybridMembershipStageStoreV1>[1]["database"]) {
  const storage=createWorkspaceEngineStorageV1();
  return createHybridMembershipStageStoreV1(stage,{database,
    assertRawReady:async()=>{await storage.assertReady?.();},
    storeRaw:async args=>{
      const directory=await mkdtemp(join(tmpdir(),"noisia-hybrid-"));
      try {
        const file=join(directory,hybridReceiptFilenameV1(args.call_id));
        await writeFile(file,args.raw_text,{mode:0o600});
        const stored=await storage.put({workspace_id:args.workspace_id,execution_id:args.run_id,file,
          sha256:args.raw_sha256,size_bytes:Buffer.byteLength(args.raw_text),media_type:"application/json"});
        return stored.storage_key;
      } finally { await rm(directory,{recursive:true,force:true}); }
    },
    loadRaw:async args=>readSignalLabelingReceiptV1({storage,workspace_id:args.workspace_id,
      run_id:args.run_id,storage_key:args.storage_key,raw_sha256:args.raw_sha256,size_bytes:args.size_bytes}),
  });
}
type HybridStore = ReturnType<typeof createHybridMembershipRuntimeStoreV1>;
export function hybridJevCallProposalV1(run:LabelingRunV1,input:HybridStageInputV1,
  concept:HybridStageInputV1["evaluated_concepts"][number],jevPrice:number) {
  const item={...input,evaluated_concepts:[concept]},request=buildHybridJevQuestionV1(item,concept);
  const request_digest=digest({run_id:run.id,input:item,request});
  return {custom_id:`h1_${request_digest.slice(7,67)}`,request_digest,request,inputs:[item],retry_depth:0,
    reserved_micro_usd:llmCostMicroUsdV1({...zeroUsage(),input_tokens:Math.ceil(JSON.stringify(request).length/3.5)},
      llmPriceV1("typesafe","jev-1.13.0","sync",jevPrice))};
}
/** Adapt the existing batch judge's results; its transport, cache, parser and retry policy are shared. */
export function hybridClaudeBatchStoreV1(store:HybridStore):ConceptMembershipStoreV1 {
  return {...store,async apply(run,pages){
    await store.apply(run,pages.map(page=>({...page,results:page.results.map((result:MembershipResultV1)=>{
      const input=page.call.inputs.find(root=>root.root_id===result.root_id) as HybridStageInputV1|undefined;
      const prior=input?.jev_by_concept?.[result.concept_key];
      if(!input||!prior||prior.decision.verdict!=="belongs")throw new Error("hybrid_prior_jev_missing");
      const citation=result.citations[0];
      return {...result,jev:prior.decision,jev_call_id:prior.call_id,claude_call_id:page.call.id,
        claude:{verdict:result.verdict,citation:citation?{quote:citation.quote,start:citation.quote_start,end:citation.quote_end}:null},
        rationale:result.rationale??(result.verdict==="not_belongs"?"The judge did not find evidence establishing this concept.":null)};
    })})));
  }};
}
function runJevTick(args:{run_id:string;store:HybridStore;jevPrice:number;lease_renewal_ms?:number;jev?:ReturnType<typeof createTypesafeJevClientV1>}) {
  const result=(call:Parameters<HybridStore["apply"]>[1][number]["call"],jev:HybridStageResultV1["jev"],rationale:string|null):HybridStageResultV1=>{
    const input=call.inputs[0]!,concept=input.evaluated_concepts[0]!;
    return {root_id:input.root_id,root_fingerprint:input.root_fingerprint,concept_key:concept.concept_key,
      definition_digest:concept.definition_digest,entity_context_digest:input.entity_context_digest,
      effective_entities_digest:input.effective_entities_digest,jev,jev_call_id:call.id,claude:null,claude_call_id:null,rationale};
  };
  return processJevLabelingPageV1({...args,provider:args.jev??createTypesafeJevClientV1(),hooks:{
    price:()=>{if(!Number.isFinite(args.jevPrice)||args.jevPrice<=0)throw new Error("hybrid_jev_price_required");return llmPriceV1("typesafe","jev-1.13.0","sync",args.jevPrice);},
    propose:(run,inputs)=>inputs.flatMap(input=>input.evaluated_concepts.map(concept=>hybridJevCallProposalV1(run,input,concept,args.jevPrice))),
    map:(_run,call,parsed)=>[result(call,mapHybridJevAnswerV1(call.inputs[0]!,parsed),null)],
    error:(_run,call,code,unknown)=>unknown||!call.raw_body?[]:[result(call,{verdict:"error",probability:null,citation:null},code)],
    invalidUsage:failure=>failure.evidence.usage??([429,529].includes(failure.evidence.http_status??0)?{input_tokens:0,output_tokens:0}:undefined),
    labeled:()=>false,fail_on_error:true,
  }});
}
export async function runHybridMembershipTickV1(args:{run_id:string;stage:HybridMembershipStageV1;
  store:HybridStore;jevPrice:number;lease_renewal_ms?:number;jev?:ReturnType<typeof createTypesafeJevClientV1>;
  claude?:ReturnType<typeof createAnthropicMessageBatchesClient>}){
  if(args.stage==="jev")return runJevTick(args);
  return runConceptMembershipTickV1({run_id:args.run_id,store:hybridClaudeBatchStoreV1(args.store),
    provider:args.claude??createAnthropicMessageBatchesClient({apiKey:process.env.ANTHROPIC_API_KEY??""})});
}
export function startHybridMembershipDrainerV1(){
  let running=false;
  const tick=async()=>{
    if(running||process.env.NOISIA_MFP_HYBRID_ENABLED!=="true"||process.env.NOISIA_MFP_HYBRID_LEDGER_READY!=="true")return;
    running=true;
    try{
      const {pool}=await import("../db/client");
      const rows=(await pool.query<{id:string;stage:HybridMembershipStageV1}>(`SELECT id,membership_snapshot->>'hybrid_stage' stage
        FROM signal_labeling_runs WHERE kind='membership' AND status IN('queued','running')
        AND membership_snapshot->>'hybrid_stage' IN('jev','claude') AND NOT waiting_full_confirmation
        AND next_poll_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 2`)).rows;
      for(const row of rows){
        const enabled=row.stage==="jev"?process.env.NOISIA_JEV_PROVIDER_ENABLED:process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED;
        if(enabled!=="true")continue;
        await runHybridMembershipTickV1({run_id:row.id,stage:row.stage,store:createHybridMembershipRuntimeStoreV1(row.stage,pool),
          jevPrice:Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK)}).catch(error=>
          console.warn("[hybrid-membership] tick unavailable",{name:error instanceof Error?error.name:"Error"}));
      }
    }finally{running=false;}
  };
  const timer=setInterval(()=>void tick(),30_000);timer.unref();void tick();
  return{async close(){clearInterval(timer);}};
}
