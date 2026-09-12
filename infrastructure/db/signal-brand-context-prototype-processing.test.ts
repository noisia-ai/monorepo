import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {loadSignalBrandContextPrototypePlanStateV1,advanceSignalBrandContextComposedProcessingV1,startSignalBrandContextPrototypeProcessingV1} from "./signal-brand-context-prototype-processing";
import type {Pool} from "pg";

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
  const input=start.slice(0,start.indexOf("},dependencies"));
  assert.match(input,/expected_quote_digest\?:string/u);
  assert.doesNotMatch(input,/workspace_id|plan:|profile:|provider:|model:|cap/u);
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
    "signal_brand_context_semantic_renewals",
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
  assert.match(pending,/signal_brand_context_prototype_retry_safe_v1\(child\.run_id\)/u);
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
      workspace_id:workspace,supersedes_receipt_id:null,quote_digest:`sha256:${"a".repeat(64)}`,quoted_at:"2026-09-11T12:00:00.000Z",
      quote_expires_at:"2026-09-11T12:05:00.000Z",maximum_micro_usd:"100000",
      available_today_micro_usd:"900000",requires_provider:true,requires_confirmation:true,
      authorization_state:"awaiting_authorization"}),
    start_processing:async()=>{starts+=1;throw new Error("must_not_start");}
  });
  assert.deepEqual(result,{contract_version:"brand-context-composed-advance-v1",state:"awaiting_authorization",
    semantic_run_id:semanticRun,replayed:false});
  assert.equal(starts,0,"no Stage2 admission, reservation or provider work may start without a fresh confirmation");
});

test("a DNC Stage2 leaf advances from cache without engineering or another confirmation",async()=>{
  const semanticRun=randomUUID(),parentReceipt=randomUUID(),childReceipt=randomUUID();
  const childRun=randomUUID(),workspace=randomUUID(),actor=randomUUID();
  const quoteDigest=`sha256:${"a".repeat(64)}`;const starts:Record<string,unknown>[]=[];
  const result=await advanceSignalBrandContextComposedProcessingV1({database:{} as never,
    semantic_run_id:semanticRun,provider_available:false,
    load_parent:async()=>({parent_receipt_id:parentReceipt,workspace_id:workspace,actor_user_id:actor,
      child_receipt_id:childReceipt,child_run_id:childRun,child_status:"failed",child_idempotency_key:"old-key"}),
    prepare_quote:async()=>({contract_version:"brand-context-prototype-quote-v1",parent_receipt_id:parentReceipt,
      workspace_id:workspace,supersedes_receipt_id:childReceipt,quote_digest:quoteDigest,
      quoted_at:"2026-09-11T12:00:00.000Z",quote_expires_at:"2026-09-11T12:05:00.000Z",
      maximum_micro_usd:"0",available_today_micro_usd:"900000",requires_provider:false,
      requires_confirmation:false,authorization_state:"automatic_ready"}),
    start_processing:async input=>{starts.push(input);return{contract_version:"brand-context-prototype-processing-v1",
      workspace_id:workspace,generation_id:randomUUID(),run_id:randomUUID(),receipt_id:randomUUID(),
      state:"queued",replayed:false,requires_provider:false};}
  });
  assert.equal(result.state,"queued");assert.equal(starts.length,1);
  assert.equal(starts[0]!.confirmation,undefined);assert.equal(starts[0]!.provider_available,false);
  assert.equal(starts[0]!.expected_quote_digest,quoteDigest);
  assert.equal(starts[0]!.idempotency_key,`brand-context-prototypes:${parentReceipt}:${childReceipt}`);
});

test("a DNC Stage2 leaf with uncached inputs remains an explicit authorization",async()=>{
  const semanticRun=randomUUID(),parentReceipt=randomUUID(),childReceipt=randomUUID();let starts=0;
  const result=await advanceSignalBrandContextComposedProcessingV1({database:{} as never,
    semantic_run_id:semanticRun,provider_available:true,
    load_parent:async()=>({parent_receipt_id:parentReceipt,workspace_id:randomUUID(),actor_user_id:randomUUID(),
      child_receipt_id:childReceipt,child_run_id:randomUUID(),child_status:"canceled",child_idempotency_key:"old-key"}),
    prepare_quote:async()=>({contract_version:"brand-context-prototype-quote-v1",parent_receipt_id:parentReceipt,
      workspace_id:randomUUID(),supersedes_receipt_id:childReceipt,quote_digest:`sha256:${"a".repeat(64)}`,
      quoted_at:"2026-09-11T12:00:00.000Z",quote_expires_at:"2026-09-11T12:05:00.000Z",
      maximum_micro_usd:"100",available_today_micro_usd:"900000",requires_provider:true,
      requires_confirmation:true,authorization_state:"awaiting_authorization"}),
    start_processing:async()=>{starts++;throw new Error("must_not_start");}
  });
  assert.equal(result.state,"awaiting_authorization");assert.equal(starts,0);
});

// Adapter tests only: PostgreSQL remains the authority for the DNC predicate,
// live permissions and the atomic bundle. These doubles expose those decisions
// without opening a socket or manufacturing provider/cost history.
function recoveryAdapterFixture(){
  const parent=randomUUID(),workspace=randomUUID(),generation=randomUUID(),actor=randomUUID();
  const predecessor=randomUUID(),profile=randomUUID(),pack=`sha256:${"a".repeat(64)}`,quoteDigest=`sha256:${"b".repeat(64)}`;
  const plan={contract_version:"signal-workspace-topic-prototype-plan-v1",taxonomy_profile_id:profile,
    texts:{},embedding_profile:{config_digest:`sha256:${"c".repeat(64)}`}};
  const confirmation="prepare_brand_context_prototypes_within_shown_cap" as const;
  type Row={id:string;parent_receipt_id:string;workspace_id:string;generation_id:string;actor_user_id:string;
    admission_id:string;run_id:string;pack_digest:string;plan:typeof plan;quote_digest:string;confirmation:string|null};
  const receipts=new Map<string,Row>();const states=new Map<string,string>();
  const counters={quotes:0,authorizations:0,creates:0,publish:0,catalog:0,plan:0,rollbacks:0};
  let sqlDenial:string|null=null,actorAllowed=true,ackLost=false,uncached=true;
  let latestChild:string|null=predecessor;let refreshCompleted=false;
  let snapshot:{receipts:Array<[string,Row]>;states:Array<[string,string]>;creates:number}|null=null;
  const query=async(sql:string,values:unknown[]=[])=>{
    if(sql.startsWith("BEGIN")){snapshot={receipts:structuredClone([...receipts]),states:[...states],creates:counters.creates};return{rows:[]};}
    if(sql==="COMMIT"){snapshot=null;if(ackLost){ackLost=false;throw new Error("synthetic_commit_ack_lost");}return{rows:[]};}
    if(sql==="ROLLBACK"){counters.rollbacks++;if(snapshot){receipts.clear();states.clear();snapshot.receipts.forEach(([k,v])=>receipts.set(k,v));
      snapshot.states.forEach(([k,v])=>states.set(k,v));counters.creates=snapshot.creates;snapshot=null;}return{rows:[]};}
    if(sql.includes("SELECT pg_advisory_xact_lock"))return{rows:[]};
    if(sql.includes("FROM signal_brand_context_processing_receipts WHERE")){
      assert.deepEqual(values,[parent,actor]);return{rows:[{workspace_id:workspace,generation_id:generation}]};}
    if(sql.includes("SELECT receipt.* FROM signal_brand_context_prototype_receipts")){
      assert.deepEqual(values.slice(0,2),[workspace,actor]);const prior=receipts.get(String(values[2]));return{rows:prior?[prior]:[]};}
    if(sql.includes("quote_signal_brand_context_prototypes_v1")){
      counters.quotes++;assert.deepEqual(values.slice(0,2),[parent,actor]);
      if(sqlDenial)throw new Error(sqlDenial);
      return{rows:[{value:{quote_digest:quoteDigest,quote_snapshot:{pack_digest:pack,
        supersedes_receipt_id:latestChild,refreshes_completed_plan:refreshCompleted,requires_provider:uncached,requires_confirmation:refreshCompleted||uncached&&latestChild!==null}}}]};}
    if(sql.includes("authorize_signal_brand_context_prototypes_v1")){
      counters.authorizations++;assert.equal(values[0],parent);assert.equal(values[1],actor);
      if(!actorAllowed)throw new Error("processing_forbidden");
      const key=String(values[2]),prior=receipts.get(key);
      if(prior)return{rows:[{result:{replayed:true,run_id:prior.run_id,receipt:prior}}]};
      assert.equal(values[5],quoteDigest);
      if(uncached&&latestChild!==null&&values[6]!==confirmation)throw new Error("brand_context_prototype_awaiting_authorization");
      if(receipts.size)throw new Error("brand_context_prototype_prior_run_unresolved");
      const receipt:Row={id:randomUUID(),parent_receipt_id:parent,workspace_id:workspace,generation_id:generation,
        actor_user_id:actor,admission_id:randomUUID(),run_id:randomUUID(),pack_digest:pack,plan,
        quote_digest:quoteDigest,confirmation:values[6] as string|null};
      receipts.set(key,receipt);states.set(receipt.run_id,"queued");counters.creates++;
      return{rows:[{result:{replayed:false,run_id:receipt.run_id,receipt}}]};}
    if(sql.includes("SELECT EXISTS(SELECT 1 FROM jsonb_object_keys"))return{rows:[{required:uncached}]};
    if(sql.includes("SELECT status,processing_admission_id::text")){
      const receipt=[...receipts.values()].find(value=>value.run_id===values[0]);assert.ok(receipt);
      return{rows:[{status:states.get(receipt.run_id),processing_admission_id:receipt.admission_id}]};}
    throw new Error("unexpected_adapter_query");
  };
  const database={connect:async()=>({query,release:()=>{}})} as unknown as Pool;
  const dependencies={
    publish:async()=>{counters.publish++;return{workspace_id:workspace,organization_id:randomUUID(),brand_id:randomUUID(),generation_id:generation,pack_digest:pack};},
    ensure_catalog:async()=>{counters.catalog++;return{taxonomy_profile_id:profile,created:false};},
    load_plan:async()=>{counters.plan++;return plan as never;}
  };
  const args={database,parent_receipt_id:parent,actor_user_id:actor,idempotency_key:randomUUID(),confirmation,
    expected_quote_digest:quoteDigest,provider_available:true};
  return{args,dependencies,counters,receipts,states,quoteDigest,predecessor,
    deny:(code:string)=>{sqlDenial=code;},revoke:()=>{actorAllowed=false;},loseAck:()=>{ackLost=true;},cache:()=>{uncached=false;},
    refresh:()=>{refreshCompleted=true;},initial:()=>{latestChild=null;}};
}

test("DNC successor uses the current server quote and one new decision key",async()=>{
  const f=recoveryAdapterFixture();const first=await startSignalBrandContextPrototypeProcessingV1(f.args,f.dependencies);
  assert.equal(first.replayed,false);assert.equal(first.state,"queued");assert.equal(f.counters.creates,1);
  const before=structuredClone(f.counters);
  const replay=await startSignalBrandContextPrototypeProcessingV1({...f.args,provider_available:false},f.dependencies);
  assert.deepEqual(replay,{...first,replayed:true});assert.equal(f.counters.creates,1);
  assert.equal(f.counters.quotes,before.quotes);assert.equal(f.counters.publish,before.publish);
  assert.equal(f.counters.catalog,before.catalog);assert.equal(f.counters.plan,before.plan);
  await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1({...f.args,idempotency_key:randomUUID()},f.dependencies),
    {message:"brand_context_prototype_prior_run_unresolved"});assert.equal(f.counters.creates,1);
});

test("DNC successor requires the exact expected quote even if displayed amounts are unchanged",async()=>{
  for(const expected_quote_digest of [undefined,`sha256:${"d".repeat(64)}`]){
    const f=recoveryAdapterFixture();await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1(
      {...f.args,expected_quote_digest},f.dependencies),{message:"brand_context_prototype_quote_changed"});
    assert.equal(f.counters.authorizations,0);assert.equal(f.receipts.size,0);
  }
});

test("exact replay returns historical terminal status after a fast failure without another admission",async()=>{
  for(const state of ["failed","canceled","stale","outcome_unknown","completed"]){
    const f=recoveryAdapterFixture();const first=await startSignalBrandContextPrototypeProcessingV1(f.args,f.dependencies);
    f.states.set(first.run_id,state);const prior=structuredClone([...f.receipts]);const quoteCalls=f.counters.quotes;
    f.deny("brand_context_prototype_authorization_expired");
    const replay=await startSignalBrandContextPrototypeProcessingV1({...f.args,provider_available:false},f.dependencies);
    assert.equal(replay.state,state);assert.equal(replay.replayed,true);assert.equal(replay.receipt_id,first.receipt_id);
    assert.deepEqual([...f.receipts],prior);assert.equal(f.counters.creates,1);assert.equal(f.counters.quotes,quoteCalls);
  }
});

test("COMMIT ACK loss followed by fast failure replays the one accepted successor",async()=>{
  const f=recoveryAdapterFixture();f.loseAck();
  await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1(f.args,f.dependencies),/synthetic_commit_ack_lost/u);
  const accepted=f.receipts.get(f.args.idempotency_key)!;assert.ok(accepted);f.states.set(accepted.run_id,"failed");
  const replay=await startSignalBrandContextPrototypeProcessingV1({...f.args,provider_available:false},f.dependencies);
  assert.equal(replay.receipt_id,accepted.id);assert.equal(replay.state,"failed");assert.equal(replay.replayed,true);
  assert.equal(f.counters.creates,1);
});

test("replay rejects a changed confirmation or expected quote and still enforces SQL actor scope",async()=>{
  const f=recoveryAdapterFixture();await startSignalBrandContextPrototypeProcessingV1(f.args,f.dependencies);
  for(const changed of [{confirmation:undefined},{expected_quote_digest:`sha256:${"d".repeat(64)}`}]){
    await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1({...f.args,...changed},f.dependencies),
      {message:"processing_idempotency_conflict"});
  }
  f.revoke();await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1(f.args,f.dependencies),
    (error:unknown)=>error instanceof Error&&error.message==="processing_forbidden"&&"status" in error&&error.status===403);
  assert.equal(f.counters.creates,1);
});

test("unsafe previous call, revoked policy and stale publication remain SQL denials before a successor",async()=>{
  for(const code of ["brand_context_prototype_prior_run_unresolved","brand_context_prototype_prior_call_unresolved",
    "brand_context_prototype_authorization_expired","brand_context_prototype_publication_required"]){
    const f=recoveryAdapterFixture();f.deny(code);
    await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1(f.args,f.dependencies),{message:code});
    assert.equal(f.receipts.size,0);assert.equal(f.counters.authorizations,0);
  }
});

test("provider off blocks a new paid successor but preserves a server-proven cached continuation",async()=>{
  const f=recoveryAdapterFixture();await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1(
    {...f.args,provider_available:false},f.dependencies),{message:"brand_context_prototype_runtime_unavailable"});
  assert.equal(f.counters.creates,0);assert.equal(f.counters.authorizations,0);
  f.cache();const free=await startSignalBrandContextPrototypeProcessingV1(
    {...f.args,confirmation:undefined,provider_available:false},f.dependencies);
  assert.equal(free.requires_provider,false);assert.equal(f.counters.creates,1);
});

test("initial automatic Stage2 is unchanged, but a paid DNC successor still needs confirmation",async()=>{
  const initial=recoveryAdapterFixture();initial.initial();
  const accepted=await startSignalBrandContextPrototypeProcessingV1(
    {...initial.args,confirmation:undefined,expected_quote_digest:undefined},initial.dependencies);
  assert.equal(accepted.state,"queued");assert.equal(initial.counters.creates,1);
  const retry=recoveryAdapterFixture();await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1(
    {...retry.args,confirmation:undefined},retry.dependencies),{message:"brand_context_prototype_awaiting_authorization"});
  assert.equal(retry.receipts.size,0);assert.equal(retry.counters.creates,0);
});


test("completed-plan refresh requires explicit confirmation even with full cache and provider off", async () => {
  const f=recoveryAdapterFixture();f.refresh();f.cache();
  await assert.rejects(()=>startSignalBrandContextPrototypeProcessingV1({...f.args,
    confirmation:undefined,provider_available:false},f.dependencies),{message:"brand_context_prototype_awaiting_authorization"});
  assert.equal(f.counters.creates,0);assert.equal(f.counters.authorizations,0);
  const first=await startSignalBrandContextPrototypeProcessingV1({...f.args,provider_available:false},f.dependencies);
  assert.equal(first.requires_provider,false);assert.equal(first.state,"queued");
  const replay=await startSignalBrandContextPrototypeProcessingV1({...f.args,provider_available:false},f.dependencies);
  assert.equal(replay.receipt_id,first.receipt_id);assert.equal(replay.replayed,true);assert.equal(f.counters.creates,1);
});

test("guide readiness compares the current server plan without asking for policy or provider", async () => {
  const parent=randomUUID(),actor=randomUUID(),workspace=randomUUID(),queries:string[]=[];
  let current="new-plan";
  const database={connect:async()=>({release:()=>{},query:async(sql:string,params:unknown[]=[])=>{
    queries.push(sql);
    if(sql.includes("SELECT parent.workspace_id")){
      assert.deepEqual(params,[parent,actor]);return{rows:[{workspace_id:workspace,plan_digest:"old-plan",status:"completed"}]};}
    return{rows:[]};
  }})} as unknown as Pool;
  const dependencies={load_plan:async(args:{workspace_id:string;actor_user_id:string})=>{
    assert.equal(args.workspace_id,workspace);assert.equal(args.actor_user_id,actor);return{plan_digest:current} as never;}};
  assert.deepEqual(await loadSignalBrandContextPrototypePlanStateV1({database,parent_receipt_id:parent,actor_user_id:actor},dependencies),{guides_pending:true});
  current="old-plan";
  assert.deepEqual(await loadSignalBrandContextPrototypePlanStateV1({database,parent_receipt_id:parent,actor_user_id:actor},dependencies),{guides_pending:false});
  assert.doesNotMatch(queries.join("\n"),/UPDATE|INSERT|authorize_|quote_signal|processing_policy/u);
});


test("a cached DNC continuation of an explicit refresh still waits for the user", async()=>{
  const parent=randomUUID(),predecessor=randomUUID();let starts=0;
  const result=await advanceSignalBrandContextComposedProcessingV1({database:{} as never,
    semantic_run_id:randomUUID(),provider_available:false,
    load_parent:async()=>({parent_receipt_id:parent,workspace_id:randomUUID(),actor_user_id:randomUUID(),
      child_receipt_id:predecessor,child_run_id:randomUUID(),child_status:"failed",child_idempotency_key:"refresh-failed-key"}),
    prepare_quote:async()=>({contract_version:"brand-context-prototype-quote-v1",parent_receipt_id:parent,
      workspace_id:randomUUID(),supersedes_receipt_id:predecessor,quote_digest:`sha256:${"a".repeat(64)}`,
      quoted_at:new Date().toISOString(),quote_expires_at:"2999-01-01T00:00:00.000Z",maximum_micro_usd:"0",
      available_today_micro_usd:"0",requires_provider:false,requires_confirmation:true,refreshes_completed_plan:true,
      authorization_state:"awaiting_authorization"}),
    start_processing:async()=>{starts++;throw new Error("refresh_must_not_start_automatically");}});
  assert.equal(result.state,"awaiting_authorization");assert.equal(starts,0);
});
