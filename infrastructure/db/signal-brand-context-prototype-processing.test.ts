import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {advanceSignalBrandContextComposedProcessingV1} from "./signal-brand-context-prototype-processing";

const adapter=readFileSync(new URL("./signal-brand-context-prototype-processing.ts",import.meta.url),"utf8");
const preparation=readFileSync(new URL("./signal-brand-context-preparation.ts",import.meta.url),"utf8");
const embeddings=readFileSync(new URL("./signal-workspace-embeddings.ts",import.meta.url),"utf8");
const capabilities=readFileSync(new URL("./signal-workspace-capabilities.ts",import.meta.url),"utf8");
const catalog=readFileSync(new URL("./signal-topic-catalog.ts",import.meta.url),"utf8");
const semantic=readFileSync(new URL("./signal-semantic-context-proposal.ts",import.meta.url),"utf8");
const body=(source:string,name:string)=>{
  const start=source.indexOf(`function ${name}(`);if(start<0)return"";
  const candidates=[source.indexOf("\nexport ",start+1),source.indexOf("\nasync function ",start+1),
    source.indexOf("\nfunction ",start+1)].filter(index=>index>start);
  return source.slice(start,candidates.length?Math.min(...candidates):source.length);
};

test("typed catalog errors preserve their fail-closed HTTP status",()=>{
  const mapped=body(adapter,"mapError");
  assert.match(mapped,/error instanceof SignalTopicCatalogError/u);
  assert.match(mapped,/fail\(error\.code,error\.status\)/u);
});

test("Stage2 accepts only identity, intent, confirmation and server runtime health",()=>{
  const start=body(adapter,"startSignalBrandContextPrototypeProcessingV1");
  assert.match(start,/database:Database;parent_receipt_id:string;\s*actor_user_id:string;idempotency_key:string;confirmation\?/u);
  assert.match(start,/provider_available:boolean/u);
  assert.doesNotMatch(start.split("}):Promise")[0]??"",/workspace_id|plan:|profile:|provider:|model:|cap|quote_digest/u);
  assert.match(start,/BEGIN ISOLATION LEVEL READ COMMITTED/u);
  const fresh=start.slice(start.indexOf("}else{"));
  const order=["publishSignalBrandContextComposedGenerationWithQueryableV1",
    "ensureSignalBrandContextPrototypeCatalogStoreV1","loadSignalWorkspaceTopicPrototypePlanV1",
    "quote_signal_brand_context_prototypes_v1","result=await authorize(client"];
  let at=-1;for(const marker of order){const next=fresh.indexOf(marker);assert.ok(next>at,marker);at=next;}
  assert.match(start,/requiresProvider&&!args\.provider_available/u);
  assert.match(start,/brand_context_prototype_runtime_unavailable/u);
});

test("a new brand gets only a receipt-bound canonical empty catalog before Stage2 planning",()=>{
  const ensure=body(catalog,"ensureSignalBrandContextPrototypeCatalogStoreV1");
  for(const marker of ["signal_brand_context_processing_receipts","receipt.id=$1::uuid",
    "receipt.workspace_id=$2::uuid","receipt.actor_user_id=$3::uuid","receipt.generation_id=$4::uuid",
    "signal_brand_context_processing_actor_v1","signal_brand_context_processing_source_current_v1",
    "signal_brand_context_composed_generation_valid_v1","publication_schema_version='signal-semantic-context-publication-v2'",
    "semantic_context_pack_digest=$5","supersedes_generation_id=generation.id","signal-taxonomy:",
    "require_current_semantic_authority: true","insertTopicCatalogDraft","topics: []","catalog_role: \"working\""])
    assert.ok(ensure.includes(marker),marker);
  assert.doesNotMatch(ensure,/can_execute_topics|signal_processing_capacity_v1|provider|outbox/u);
  const start=body(adapter,"startSignalBrandContextPrototypeProcessingV1");
  assert.ok(start.indexOf("publishSignalBrandContextComposedGenerationWithQueryableV1")
    <start.indexOf("ensureSignalBrandContextPrototypeCatalogStoreV1"));
  assert.ok(start.indexOf("ensureSignalBrandContextPrototypeCatalogStoreV1")
    <start.indexOf("loadSignalWorkspaceTopicPrototypePlanV1"));
});

test("replay uses the immutable child receipt and never rebuilds authority from browser bytes",()=>{
  const start=body(adapter,"startSignalBrandContextPrototypeProcessingV1");
  const replay=start.slice(start.indexOf("if(prior)"),start.indexOf("}else{"));
  for(const marker of ["prior.pack_digest","prior.plan","prior.quote_digest","prior.confirmation","authorize(client"])
    assert.ok(replay.includes(marker),marker);
  assert.doesNotMatch(replay,/publishSignalBrandContext|loadSignalWorkspaceTopicPrototypePlan/u);
  assert.match(start,/receipt\.parent_receipt_id!==args\.parent_receipt_id/u);
  assert.match(start,/run\.processing_admission_id!==receipt\.admission_id/u);
});

test("publication is direct-parent receipt proof before any automatic transition",()=>{
  const publish=body(preparation,"publishSignalBrandContextComposedGenerationWithQueryableV1");
  const proof=publish.indexOf("signal_brand_context_composed_generation_valid_v1");
  const transition=publish.indexOf("await activate");
  assert.ok(proof>=0&&transition>proof);
  assert.match(publish,/receipt\.id=\$1::uuid AND receipt\.actor_user_id=\$2::uuid/u);
  assert.match(publish,/brand_context_semantic_result_not_ready/u);
  assert.match(publish,/brand_context_source_stale/u);
  assert.doesNotMatch(publish,/activateSignalBrandContextGenerationWithQueryableV1|workspace\(.*true/u);
});

test("receipt-bound Voyage keeps can_execute_topics false and fences every new-work seam",()=>{
  const exact=body(embeddings,"composedPrototypeReceiptExact");
  for(const marker of ["signal_brand_context_prototype_receipts","signal_processing_admissions",
    "signal_brand_context_processing_receipts","brand_context_prototype_receipt_id","brand_context_processing_receipt_id",
    "topic_prototype_embeddings"])assert.ok(exact.includes(marker),marker);
  const authority=body(embeddings,"requireRunAuthority");
  assert.match(authority,/run\.processing_admission_id===null/u);
  assert.ok(authority.indexOf("run.processing_admission_id===null")
    <authority.indexOf(")).can_execute_topics"));
  assert.match(authority,/signal_processing_capacity_v1/u);
  assert.match(authority,/ARRAY\['topic_prototype_embeddings'\]/u);
  for(const name of ["readSignalWorkspaceEmbeddingBatchV1","reserveSignalWorkspaceEmbeddingCallV1",
    "markSignalWorkspaceEmbeddingCallSentV1"])
    assert.match(body(embeddings,name),/requireLease\(client,args\.lease\)(?!,false)/u,name);
  assert.match(body(embeddings,"claimSignalWorkspaceEmbeddingRunV1"),/requireRunAuthority\(client,run,true\)/u);
  assert.doesNotMatch(capabilities,/client_admin[\s\S]{0,200}can_execute_topics:\s*true/u);
});

test("paid Voyage recovery is exact-receipt only and cannot reserve or send again",()=>{
  for(const name of ["commitSignalWorkspaceEmbeddingBatchV1","finishSignalWorkspaceEmbeddingsV1"])
    assert.match(body(embeddings,name),/requireLease\(client,args\.lease,false\)/u,name);
  assert.match(body(embeddings,"requireLease"),/requireRunAuthority\(client,run,newWork\)/u);
  assert.match(body(embeddings,"requireRunAuthority"),/composedPrototypeReceiptExact/u);
  assert.match(body(embeddings,"reserveSignalWorkspaceEmbeddingCallV1"),/requireLease\(client,args\.lease\)/u);
  assert.match(body(embeddings,"markSignalWorkspaceEmbeddingCallSentV1"),/requireLease\(client,args\.lease\)/u);
});

test("Stage1 retry is one original receipt-bound unspent run under live capacity",()=>{
  const retry=body(adapter,"retrySignalBrandContextComposedSemanticRunV1");
  for(const marker of ["signal_brand_context_processing_receipts","signal_processing_admissions",
    "run.processing_admission_id=admission.id","run.brand_context_preparation_operation_id IS NULL",
    "signal_processing_capacity_v1","provider_call_state!==\"not_started\"","provider_call_count!==0",
    "provider_response_private!==null","lease_token!==null","brand_context_semantic_authorization_expired"])
    assert.ok(retry.includes(marker),marker);
  assert.doesNotMatch(retry,/INSERT INTO signal_semantic_context_(?:proposal_runs|budget_reservations|proposal_outbox)/u);
  assert.match(retry,/UPDATE signal_semantic_context_proposal_outbox SET status='pending'/u);
});

test("paid Claude response append survives revocation only through exact receipt evidence",()=>{
  const begin=body(semantic,"beginComposedPaidResponseOperationV1");
  for(const marker of ["signal_brand_context_processing_receipts","signal_processing_admissions",
    "admission.brand_context_processing_receipt_id=receipt.id","run.processing_admission_id=admission.id",
    "run.provider_call_state='response_persisted'","run.provider_call_count=1",
    "run.provider_response_private IS NOT NULL","reservation.status='reserved'",
    "reservation.reservation_micro_usd=run.reservation_micro_usd",
    "signal_brand_context_composed_append_actor_v1","brand_context_paid_response_receipt_invalid"])
    assert.ok(begin.includes(marker),marker);
  assert.doesNotMatch(begin,/signal_processing_capacity_v1|provider_call_state='in_flight'|INSERT INTO signal_processing_admissions/u);
  const append=body(semantic,"appendSignalSemanticContextProposalsInternalV1");
  assert.match(append,/beginComposedPaidResponseOperationV1/u);
  assert.match(append,/args\.automatic_run_authority && authorityInput/u);
});

test("settled Stage1 advances automatically with DB-owned actor and deterministic recovery",()=>{
  const exact=body(adapter,"loadCompletedSemanticParentV1");
  for(const marker of ["signal_brand_context_processing_receipts","signal_processing_admissions",
    "run.status='completed'","run.provider_call_state='settled'","run.provider_call_count=1",
    "reservation.status='settled'","reservation.actual_micro_usd=run.settled_micro_usd"])
    assert.ok(exact.includes(marker),marker);
  const advance=body(adapter,"advanceSignalBrandContextComposedProcessingV1");
  assert.match(advance,/brand-context-prototypes:\$\{parent\.parent_receipt_id\}/u);
  assert.match(advance,/actor_user_id:parent\.actor_user_id/u);
  assert.match(advance,/prepareSignalBrandContextPrototypeQuoteV1/u);
  assert.match(advance,/quote\.requires_confirmation/u);
  assert.match(advance,/state:"awaiting_authorization"/u);
  assert.match(advance,/confirmation:undefined/u);
  assert.doesNotMatch(advance,/idempotency_key:idempotencyKey,confirmation,provider_available/u);
  assert.match(advance,/state:"runtime_unavailable"/u);
  const pending=body(adapter,"advancePendingSignalBrandContextComposedProcessingV1");
  assert.match(pending,/NOT EXISTS\(SELECT 1 FROM signal_brand_context_prototype_receipts child/u);
  assert.match(pending,/advanceSignalBrandContextComposedProcessingV1/u);
});

test("Stage2 quote preparation is receipt-bound and creates no paid authority",()=>{
  const prepare=body(adapter,"prepareSignalBrandContextPrototypeQuoteV1");
  for(const marker of ["signal_brand_context_processing_receipts","actor_user_id=$2::uuid",
    "publishSignalBrandContextComposedGenerationWithQueryableV1","ensureSignalBrandContextPrototypeCatalogStoreV1",
    "loadSignalWorkspaceTopicPrototypePlanV1","quotePreparedPrototypePlanV1","COMMIT"])
    assert.ok(prepare.includes(marker),marker);
  assert.doesNotMatch(prepare,/authorize\(|INSERT INTO signal_processing_admissions|reserve|provider_call/u);
  const read=body(adapter,"loadSignalBrandContextPrototypeQuoteV1");
  assert.match(read,/BEGIN READ ONLY/u);
  assert.doesNotMatch(read,/publishSignalBrandContext|ensureSignalBrandContextPrototypeCatalogStore/u);
});

test("an expired Stage1 parent stops before Stage2 admission until the user confirms",async()=>{
  const semanticRun=randomUUID(),parentReceipt=randomUUID(),workspace=randomUUID(),actor=randomUUID();
  let starts=0;
  const result=await advanceSignalBrandContextComposedProcessingV1({
    database:{} as never,semantic_run_id:semanticRun,provider_available:true,
    load_parent:async()=>({parent_receipt_id:parentReceipt,workspace_id:workspace,actor_user_id:actor,
      child_receipt_id:null,child_run_id:null,child_status:null,child_idempotency_key:null}),
    prepare_quote:async()=>({contract_version:"brand-context-prototype-quote-v1",parent_receipt_id:parentReceipt,
      workspace_id:workspace,quote_digest:`sha256:${"a".repeat(64)}`,quoted_at:"2026-09-11T12:00:00.000Z",
      quote_expires_at:"2026-09-11T12:05:00.000Z",maximum_micro_usd:"100000",
      available_today_micro_usd:"900000",requires_provider:true,requires_confirmation:true,
      authorization_state:"awaiting_authorization"}),
    start_processing:async()=>{starts+=1;throw new Error("must_not_start");}
  });
  assert.deepEqual(result,{contract_version:"brand-context-composed-advance-v1",state:"awaiting_authorization",
    semantic_run_id:semanticRun,replayed:false});
  assert.equal(starts,0,"no Stage2 admission, reservation or provider work may start without a fresh confirmation");
});
