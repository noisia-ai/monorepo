import assert from "node:assert/strict";
import test from "node:test";
import type { SignalBrandContextPreparationRuntimeV1 } from "@noisia/db";
import { loadClientBrandContextProcessingViewForActorV1, startClientBrandContextPrototypeProcessingForActorV1 } from "./signal-brand-context-processing-quote";
import { clientBrandContextProcessingConfirmationV1, clientBrandContextProcessingRequestV1,
  validClientBrandContextProcessingViewV1 } from "./client-brand-context-processing-quote";

const workspace="00000000-0000-4000-8000-000000000001", actor="00000000-0000-4000-8000-000000000002";
const parent="00000000-0000-4000-8000-000000000003", child="00000000-0000-4000-8000-000000000004";
const digest=`sha256:${"b".repeat(64)}`, now=new Date().toISOString(), future="2999-01-01T00:00:00.000Z";
const runtime={queue_configured:true,worker_alive:true,recovery_alive:true,semantic:{available:false},prototype:{available:true}} as SignalBrandContextPreparationRuntimeV1;
const operation={observed_at:now,receipt_id:parent,authorization_not_after:future,semantic_cap_micro_usd:"100",
  prototype_cap_micro_usd:"100",available_today_micro_usd:"1000",semantic_retry_maximum_micro_usd:"100",
  semantic_renewal_idempotency_key:null,semantic_renewal_quote_expires_at:null,semantic_renewal_available_today_micro_usd:null,
  authorization_current:false,source_current:true,generation_status:"published",semantic_status:"completed",
  child_receipt_id:child,child_idempotency_key:"old-completed-key",prototype_status:"completed"};
const quote={contract_version:"brand-context-prototype-quote-v1" as const,parent_receipt_id:parent,workspace_id:workspace,
  supersedes_receipt_id:child,quote_digest:digest,quoted_at:now,quote_expires_at:future,maximum_micro_usd:"100",
  available_today_micro_usd:"1000",requires_provider:true,requires_confirmation:true,
  refreshes_completed_plan:true,authorization_state:"awaiting_authorization" as const};
const dependencies={loadOperation:async()=>operation,loadPrototypeQuote:async()=>quote,
  loadPlanState:async()=>({guides_pending:true}),loadQuote:async()=>({
    contract_version:"client-brand-context-processing-quote-view-v1" as const,workspace_id:workspace,
    status:"configuration_expired" as const,can_start:false as const,maximum_micro_usd:null,available_today_micro_usd:null,
    observed_at:now,quote_expires_at:null,quote_reference:null})};
const args={workspaceId:workspace,actorUserId:actor,database:{} as never,runtimeLoader:async()=>runtime};

test("expired policy or unavailable runtime never labels changed interests prepared", async()=>{
  const paused=await loadClientBrandContextProcessingViewForActorV1({...args,
    runtimeLoader:async()=>({...runtime,prototype:{...runtime.prototype,available:false}})},dependencies);
  assert.equal(paused.operation?.state,"guides_pending");assert.equal(paused.can_start,false);
  assert.equal(validClientBrandContextProcessingViewV1(paused),true);
  const expired=await loadClientBrandContextProcessingViewForActorV1(args,{...dependencies,
    loadPrototypeQuote:async()=>{throw new Error("brand_context_prototype_authorization_expired");}});
  assert.equal(expired.operation?.state,"guides_pending");assert.equal(expired.can_start,false);assert.equal(expired.quote,null);
  assert.equal(validClientBrandContextProcessingViewV1(expired),true);
});

test("a cache-complete refresh is explicitly confirmable with Voyage off and never routes to Claude", async()=>{
  const cached={...quote,maximum_micro_usd:"0",requires_provider:false};
  const cachedRuntime={...runtime,prototype:{...runtime.prototype,available:false}};
  const view=await loadClientBrandContextProcessingViewForActorV1({...args,runtimeLoader:async()=>cachedRuntime},
    {...dependencies,loadPrototypeQuote:async()=>cached});
  assert.equal(view.operation?.state,"guides_pending");assert.equal(view.can_start,true);
  assert.equal(validClientBrandContextProcessingViewV1(view),true);
  const body=clientBrandContextProcessingConfirmationV1(clientBrandContextProcessingRequestV1(null,view,()=>"new-refresh-key"));
  assert.equal(body.confirmation,"prepare_brand_context_prototypes_within_shown_cap");
  let starts=0;
  await startClientBrandContextPrototypeProcessingForActorV1({...args,database:{} as never,runtime:cachedRuntime,
    idempotencyKey:"new-refresh-key",body},{loadReceipt:async()=>null,loadOperation:async()=>operation,
    loadQuote:async()=>cached,loadView:async()=>view,start:async input=>{
      starts++;assert.equal(input.parent_receipt_id,parent);assert.equal(input.provider_available,false);
      assert.equal(input.expected_quote_digest,digest);assert.equal(input.confirmation,body.confirmation);return{} as never;}});
  assert.equal(starts,1);
});

test("historical key replay survives a newer child and expiry without looking up a new plan", async()=>{
  const view=await loadClientBrandContextProcessingViewForActorV1(args,dependencies);
  const body=clientBrandContextProcessingConfirmationV1(clientBrandContextProcessingRequestV1(null,view,()=>"historical-key"));
  const request={...args,database:{} as never,runtime:{...runtime,prototype:{...runtime.prototype,available:false}},
    idempotencyKey:"historical-key",body};
  let starts=0;
  const replay={loadReceipt:async()=>({parent_receipt_id:parent,quote_digest:digest,confirmation:body.confirmation,
    maximum_micro_usd:body.expected_quote.maximum_micro_usd,available_today_micro_usd:body.expected_quote.available_today_micro_usd,
    expires_at:body.expected_quote.expires_at}),
    loadOperation:async()=>{throw new Error("must_not_resolve_latest_parent");},
    loadQuote:async()=>{throw new Error("must_not_requote_old_request");},loadView:async()=>view,
    start:async(input:{idempotency_key:string;expected_quote_digest?:string})=>{
      starts++;assert.equal(input.idempotency_key,"historical-key");assert.equal(input.expected_quote_digest,digest);return{} as never;}};
  await startClientBrandContextPrototypeProcessingForActorV1(request,replay);
  await assert.rejects(()=>startClientBrandContextPrototypeProcessingForActorV1({...request,
    body:{...body,expected_quote:{...body.expected_quote,maximum_micro_usd:"101"}}},replay),{code:"processing_idempotency_conflict"});
  assert.equal(starts,1);
});

test("same-plan completed remains ready while source drift never offers guide refresh", async()=>{
  const unchanged=await loadClientBrandContextProcessingViewForActorV1(args,{...dependencies,
    loadPlanState:async()=>({guides_pending:false}),loadPrototypeQuote:async()=>{throw new Error("brand_context_prototype_prior_run_unresolved");}});
  assert.equal(unchanged.operation?.state,"completed");assert.equal(unchanged.can_start,false);
  const stale=await loadClientBrandContextProcessingViewForActorV1(args,{...dependencies,
    loadOperation:async()=>({...operation,source_current:false}),
    loadPrototypeQuote:async()=>{throw new Error("brand_context_prototype_publication_required");},
    loadPlanState:async()=>{throw new Error("stale_source_must_not_compile_guides");}});
  assert.equal(stale.operation?.state,"stale");assert.equal(stale.can_start,false);
});
