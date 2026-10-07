import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anthropicUsageV1, buildHybridClaudeRequestV1, buildHybridJevQuestionV1,
  llmCostMicroUsdV1, llmPriceV1, mapHybridJevAnswerV1, parseAnthropicResponseV1,
  parseHybridClaudeAnswerV1, signalWorkspaceEmbeddingDigestV1,
  type HybridClaudeDecisionV1, type HybridJevDecisionV1, type LlmUsageV1,
} from "@noisia/query-engine";
import { createHybridMembershipStageStoreV1, reconcileHybridDuplicateJevReceiptV1, type HybridStageInputV1,
  type HybridStageResultV1, type HybridMembershipStageV1, type LabelingRunV1,
  type LabelingCallV1 } from "@noisia/db";
import { createTypesafeJevClientV1, validateJevResponseV1, jevProviderErrorV1 } from "../providers/typesafe-jev";
import { createHybridAnthropicMessagesClientV1 } from "../providers/anthropic-hybrid-messages";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { readSignalLabelingReceiptV1 } from "./signal-labeling-receipt-storage";

const zeroUsage = ():LlmUsageV1 => ({input_tokens:0,output_tokens:0,cache_read_input_tokens:0,
  cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
const errorJev = ():HybridJevDecisionV1 => ({verdict:"error",probability:null,citation:null});
const errorClaude = ():HybridClaudeDecisionV1 => ({verdict:"error",citation:null});
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
type Raw = {body:string;http_status:number;latency_ms:number};
const digest = (value:unknown)=>signalWorkspaceEmbeddingDigestV1(value);
export function hybridStageCallProposalV1(stage:HybridMembershipStageV1,run:LabelingRunV1,
  input:HybridStageInputV1,concept:HybridStageInputV1["evaluated_concepts"][number],jevPrice:number) {
  const item={...input,evaluated_concepts:[concept]};
  const request=stage==="jev" ? buildHybridJevQuestionV1(item,concept)
    : buildHybridClaudeRequestV1(item,concept,run.context);
  const request_digest=digest({stage,run_id:run.id,root_id:input.root_id,
    input_digest:input.input_digest,concept_key:concept.concept_key,definition_digest:concept.definition_digest,
    entity_context_digest:input.entity_context_digest,effective_entities_digest:input.effective_entities_digest,request});
  const reserve=stage==="jev"
    ? llmCostMicroUsdV1({...zeroUsage(),input_tokens:Math.ceil(JSON.stringify(request).length/3.5)},
      llmPriceV1("typesafe","jev-1.13.0","sync",jevPrice))
    : llmCostMicroUsdV1({...zeroUsage(),input_tokens:Math.ceil(JSON.stringify(request).length/3.5),output_tokens:4096},
      llmPriceV1("anthropic","claude-sonnet-5-5","sync"));
  return {custom_id:`h1_${request_digest.slice(7,67)}`,request_digest,request,
    inputs:[item],reserved_micro_usd:reserve,retry_depth:0};
}
function stageResult(stage:HybridMembershipStageV1,call:LabelingCallV1<HybridStageInputV1>,
  jev:HybridJevDecisionV1,claude:HybridClaudeDecisionV1|null):HybridStageResultV1 {
  const input=call.inputs[0]!,concept=input.evaluated_concepts[0]!;
  const prior=input.jev_by_concept?.[concept.concept_key];
  if (stage==="claude" && (!prior || prior.decision.verdict!=="belongs")) throw new Error("hybrid_prior_jev_missing");
  return {root_id:input.root_id,root_fingerprint:input.root_fingerprint,concept_key:concept.concept_key,
    definition_digest:concept.definition_digest,entity_context_digest:input.entity_context_digest,
    effective_entities_digest:input.effective_entities_digest,
    jev:stage==="jev"?jev:prior!.decision,jev_call_id:stage==="jev"?call.id:prior!.call_id,
    claude:stage==="claude"?claude:null,claude_call_id:stage==="claude"?call.id:null,rationale:null};
}
async function applyRaw(stage:HybridMembershipStageV1,store:HybridStore,run:LabelingRunV1,
  call:LabelingCallV1<HybridStageInputV1>,raw:Raw,jevPrice:number) {
  const input=call.inputs[0]!,concept=input.evaluated_concepts[0]!;
  let usage:LlmUsageV1=zeroUsage(),jev=errorJev(),claude=errorClaude();
  if (stage==="jev") {
    try {
      const parsed=validateJevResponseV1(call.request as ReturnType<typeof buildHybridJevQuestionV1>,raw);
      usage={...zeroUsage(),...parsed.usage}; jev=mapHybridJevAnswerV1(input,parsed);
    } catch(error) {
      const failure=jevProviderErrorV1(error);
      if (!failure.evidence.usage) throw error;
      usage={...zeroUsage(),...failure.evidence.usage};
    }
  } else {
    if (raw.http_status!==200) throw new Error("hybrid_claude_http_unsettled");
    const message=JSON.parse(raw.body);
    usage=anthropicUsageV1(message);
    const parsed=parseAnthropicResponseV1(message);
    claude=parsed.status==="ok" ? parseHybridClaudeAnswerV1(input,parsed.text!)
      : parsed.status==="refused" ? {verdict:"refused",citation:null}:errorClaude();
  }
  const price=stage==="jev"?llmPriceV1("typesafe","jev-1.13.0","sync",jevPrice)
    :llmPriceV1("anthropic","claude-sonnet-5-5","sync");
  await store.settle(run,call,{usage,settled_micro_usd:llmCostMicroUsdV1(usage,price)});
  await store.apply(run,[{call,results:[stageResult(stage,call,jev,stage==="claude"?claude:null)]}]);
}

/** Verify the private raw object, then account for an already served duplicate without another provider call. */
export async function reconcileHybridDuplicateRawReceiptV1(args:{
  database:Parameters<typeof createHybridMembershipRuntimeStoreV1>[1];
  workspace_id:string;idempotency_key:string;jevPrice:number;
}) {
  if(!Number.isFinite(args.jevPrice)||args.jevPrice<=0) throw new Error("hybrid_jev_price_required");
  const matches=(await args.database.query<{run_id:string;id:string;request:unknown;
    inputs:HybridStageInputV1[];raw_storage_key:string;raw_sha256:string;raw_size_bytes:number}>(`
    SELECT call.run_id,call.id,call.request,call.inputs,call.raw_storage_key,call.raw_sha256,
      call.raw_size_bytes FROM signal_labeling_calls call
    JOIN signal_labeling_runs run ON run.id=call.run_id AND run.workspace_id=call.workspace_id
    WHERE run.workspace_id=$1 AND run.idempotency_key=$2 AND run.kind='membership'
      AND run.status='failed' AND run.error_code='hybrid_raw_receipt_needs_review'
      AND run.membership_snapshot->>'hybrid_stage'='jev' AND call.status='failed'
      AND call.raw_storage_key IS NOT NULL AND call.raw_sha256 IS NOT NULL
      AND call.raw_size_bytes IS NOT NULL AND NOT call.results_applied`,
    [args.workspace_id,args.idempotency_key])).rows;
  if(matches.length!==1) throw new Error("hybrid_duplicate_raw_receipt_count_invalid");
  const call=matches[0]!;
  if(call.inputs.length!==1||call.inputs[0]?.evaluated_concepts.length!==1)
    throw new Error("hybrid_duplicate_raw_input_invalid");
  const rawText=await readSignalLabelingReceiptV1({storage:createWorkspaceEngineStorageV1(),
    workspace_id:args.workspace_id,run_id:call.run_id,storage_key:call.raw_storage_key,
    raw_sha256:call.raw_sha256,size_bytes:call.raw_size_bytes});
  const raw=JSON.parse(rawText) as Raw;
  const parsed=validateJevResponseV1(call.request as ReturnType<typeof buildHybridJevQuestionV1>,raw);
  const usage={...zeroUsage(),...parsed.usage};
  const jev=mapHybridJevAnswerV1(call.inputs[0]!,parsed);
  if(jev.verdict!=="not_belongs") throw new Error("hybrid_duplicate_raw_verdict_invalid");
  const result=stageResult("jev",{id:call.id,inputs:call.inputs} as LabelingCallV1<HybridStageInputV1>,jev,null);
  return reconcileHybridDuplicateJevReceiptV1({database:args.database,workspace_id:args.workspace_id,
    idempotency_key:args.idempotency_key,call_id:call.id,raw_sha256:call.raw_sha256,usage,
    settled_micro_usd:llmCostMicroUsdV1(usage,llmPriceV1("typesafe","jev-1.13.0","sync",args.jevPrice)),
    result});
}

/** One sequential, leased sync tick; ambiguous submissions are never resent. */
export async function runHybridMembershipTickV1(args:{run_id:string;stage:HybridMembershipStageV1;
  store:HybridStore;jevPrice:number;jev?:ReturnType<typeof createTypesafeJevClientV1>;
  claude?:ReturnType<typeof createHybridAnthropicMessagesClientV1>}) {
  const {store,stage}=args,run=await store.claim(args.run_id);
  if (!run) return {status:"not_claimed" as const};
  try {
    if (!Number.isFinite(args.jevPrice)||args.jevPrice<=0) throw new Error("hybrid_jev_price_required");
    let calls=await store.calls(run);
    if (calls.some(call=>call.status==="unknown"&&!call.raw_body)) {
      await store.fail(run,"labeling_outcome_unknown");
      return {status:"outcome_unknown" as const};
    }
    for (const call of calls.filter(call=>call.raw_body&&!call.results_applied)) {
      await applyRaw(stage,store,run,call,JSON.parse(call.raw_body!),args.jevPrice);
    }
    calls=await store.calls(run);
    if (!calls.some(call=>["reserved","submitting","submitted","unknown"].includes(call.status))) {
      const inputs=await store.inputs(run);
      const proposals=inputs.flatMap(input=>input.evaluated_concepts.map(concept=>
        hybridStageCallProposalV1(stage,run,input,concept,args.jevPrice)));
      if (proposals.length) await store.reserve(run,proposals);
      calls=await store.calls(run);
    }
    for (const call of calls.filter(call=>call.status==="reserved").slice(0,10)) {
      await store.renew(run);
      await store.markSubmitting(run,[call]);
      let raw:Raw;
      try {
        raw=stage==="jev" ? await (args.jev??createTypesafeJevClientV1()).evaluate(
          call.request as ReturnType<typeof buildHybridJevQuestionV1>)
          :await (args.claude??createHybridAnthropicMessagesClientV1()).evaluate(call.request);
      } catch(error) {
        const outcome=stage==="jev"?jevProviderErrorV1(error).outcome
          :error && typeof error==="object"&&"outcome" in error?error.outcome:"outcome_unknown";
        await store.markFailed(run,[call],outcome!=="definitely_not_sent");
        await store.fail(run,outcome==="definitely_not_sent"?"hybrid_not_sent":"labeling_outcome_unknown");
        throw error;
      }
      try { await store.persistRaw(run,call,JSON.stringify(raw)); }
      catch (error) {
        // The provider may already have billed this response. No raw receipt means no resend.
        await store.markFailed(run,[call],true);
        await store.fail(run,"labeling_outcome_unknown");
        throw error;
      }
      try { await applyRaw(stage,store,run,call,raw,args.jevPrice); }
      catch (error) { await store.fail(run,"hybrid_raw_receipt_needs_review"); throw error; }
    }
    return await store.finish(run);
  } finally { await store.release(run); }
}

export function startHybridMembershipDrainerV1() {
  let running=false;
  const tick=async()=>{
    if (running || process.env.NOISIA_MFP_HYBRID_ENABLED!=="true" ||
      process.env.NOISIA_MFP_HYBRID_LEDGER_READY!=="true" ||
      process.env.NOISIA_JEV_PROVIDER_ENABLED!=="true" ||
      process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED!=="true") return;
    running=true;
    try {
      const {pool}=await import("../db/client");
      const rows=(await pool.query<{id:string;stage:HybridMembershipStageV1}>(`
        SELECT run.id,run.membership_snapshot->>'hybrid_stage' stage
        FROM signal_labeling_runs run JOIN signal_hybrid_membership_routes route ON route.workspace_id=run.workspace_id
          AND route.route_digest=run.membership_snapshot->>'route_digest'
        WHERE run.kind='membership' AND run.status IN('queued','running')
          AND run.membership_snapshot->>'hybrid_stage' IN('jev','claude')
          AND NOT run.waiting_full_confirmation AND run.next_poll_at<=now()
          AND (run.lease_until IS NULL OR run.lease_until<now())
        ORDER BY run.created_at LIMIT 2`)).rows;
      for (const row of rows) {
        const store=createHybridMembershipRuntimeStoreV1(row.stage,pool);
        await runHybridMembershipTickV1({run_id:row.id,stage:row.stage,store,
          jevPrice:Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK)}).catch(error=>
          console.warn("[hybrid-membership] tick unavailable",{name:error instanceof Error?error.name:"Error"}));
      }
    } finally { running=false; }
  };
  const timer=setInterval(()=>void tick(),30_000); timer.unref(); void tick();
  return {async close(){clearInterval(timer);}};
}
