import assert from "node:assert/strict";
import test from "node:test";
import type { SignalBrandContextPreparationRuntimeV1 } from "@noisia/db";

import type { ClientBrandContextProcessingConfirmationV1,
  ClientBrandContextProcessingViewV1 } from "./client-brand-context-processing-quote";
import { startClientBrandContextProcessingForActorV1 } from "./signal-brand-context-processing-quote";

const workspaceId="00000000-0000-4000-8000-000000000001";
const organizationId="00000000-0000-4000-8000-000000000002";
const brandId="00000000-0000-4000-8000-000000000003";
const actorId="00000000-0000-4000-8000-000000000004";
const receiptId="00000000-0000-4000-8000-000000000005";
const quoteDigest=`sha256:${"a".repeat(64)}`;
const observedAt="2026-09-11T12:00:00.000Z";
const expiresAt="2999-09-11T12:05:00.000Z";
const runtime={queue_configured:true,worker_alive:true,recovery_alive:true,
  semantic:{available:true,provider:"anthropic",model:"claude-sonnet-4-6",model_version:"claude-sonnet-4-6",
    pricing_version:"synthetic",max_input_tokens:20_000,max_output_tokens:64_000,model_max_output_tokens:64_000,
    input_usd_per_million_tokens:"3",output_usd_per_million_tokens:"15",platform_hard_cap_micro_usd:1_000_000n},
  prototype:{available:true}} as SignalBrandContextPreparationRuntimeV1;
const failedView={contract_version:"client-brand-context-processing-view-v1",workspace_id:workspaceId,
  observed_at:observedAt,can_start:true,status:"quote_available",
  quote:{reference:`qv1_${"a".repeat(64)}`,maximum_micro_usd:"700000",available_today_micro_usd:"4999400",expires_at:expiresAt},
  operation:{state:"failed",phase:null,request_observed:true}} satisfies ClientBrandContextProcessingViewV1;
const body:ClientBrandContextProcessingConfirmationV1={contract_version:"client-brand-context-processing-request-v1",
  confirmation:"prepare_brand_context_within_shown_cap",expected_quote:{observed_at:observedAt,
    reference:`qv1_${"a".repeat(64)}`,maximum_micro_usd:"700000",available_today_micro_usd:"4999400",expires_at:expiresAt}};
const operation={observed_at:observedAt,receipt_id:receiptId,authorization_not_after:expiresAt,
  semantic_cap_micro_usd:"600000",prototype_cap_micro_usd:"100000",available_today_micro_usd:"4999400",
  quote_digest:quoteDigest,authorization_current:true,source_current:true,generation_status:"draft",
  semantic_status:"failed",semantic_retry_safe:true,child_receipt_id:null,child_idempotency_key:null,prototype_status:null};

test("the product POST requeues only the original receipt-bound DNC Stage1 run",async()=>{
  const retries:Record<string,unknown>[]=[];let newQuotes=0,newStarts=0;
  const result=await startClientBrandContextProcessingForActorV1({workspace:{id:workspaceId,organizationId,brandId},
    actorUserId:actorId,idempotencyKey:"retry-request-one",body,database:{} as never,runtimeLoader:async()=>runtime},{
    loadOperation:async()=>operation,
    retry:async input=>{retries.push(input);return{contract_version:"brand-context-semantic-retry-v1",
      run_id:"00000000-0000-4000-8000-000000000006",run_key:"run-one",status:"queued",replayed:false,
      admission_not_after:expiresAt};},
    loadQuote:async()=>{newQuotes++;throw new Error("must_not_quote_new_run");},
    start:async()=>{newStarts++;throw new Error("must_not_create_new_run");},
    loadView:async()=>failedView
  });
  assert.deepEqual(result,failedView);assert.equal(retries.length,1);assert.equal(newQuotes,0);assert.equal(newStarts,0);
  assert.equal(retries[0]!.parent_receipt_id,receiptId);assert.equal(retries[0]!.actor_user_id,actorId);
  assert.equal(retries[0]!.idempotency_key,"retry-request-one");
});

test("the DNC retry rejects a changed opaque quote before touching its run",async()=>{
  let retries=0;
  await assert.rejects(()=>startClientBrandContextProcessingForActorV1({workspace:{id:workspaceId,organizationId,brandId},
    actorUserId:actorId,idempotencyKey:"retry-request-two",body:{...body,expected_quote:{...body.expected_quote,
      reference:`qv1_${"b".repeat(64)}`}},database:{} as never,runtimeLoader:async()=>runtime},{
    loadOperation:async()=>operation,retry:async()=>{retries++;throw new Error("must_not_retry");}
  }),error=>error instanceof Error&&"status" in error&&error.status===409);
  assert.equal(retries,0);
});

test("a paid failed response cannot enter the DNC retry path",async()=>{
  let retries=0,quotes=0;
  await assert.rejects(()=>startClientBrandContextProcessingForActorV1({workspace:{id:workspaceId,organizationId,brandId},
    actorUserId:actorId,idempotencyKey:"retry-request-three",body,database:{} as never,runtimeLoader:async()=>runtime},{
    loadOperation:async()=>({...operation,semantic_retry_safe:false}),
    retry:async()=>{retries++;throw new Error("must_not_retry");},
    loadQuote:async()=>{quotes++;throw new Error("new_quote_unavailable");}
  }),/new_quote_unavailable/u);
  assert.equal(retries,0);assert.equal(quotes,1);
});
