import {createHash} from "node:crypto";
import {z} from "zod";
import {
  buildSignalTopicEditorialScreeningPlanV1,signalTopicEditorialDigestV1 as digest,
  SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1,signalTopicEditorialScreeningOutputSchemaV1,
  type SignalTopicEditorialScreeningBatchV1,type SignalTopicEditorialScreeningGroupV1,
} from "./signal-topic-consolidation-editorial-v1";
import {validateSignalTopicEditorialRepairRequestV1} from "./signal-topic-consolidation-editorial-repair-v1";
import type {SignalTopicEditorialRunnerProviderRequestV1} from "./signal-topic-consolidation-editorial-runner-v1";
import {validateSignalTopicEditorialGroupRequestV2,validateSignalTopicEditorialGroupOutputV2,
  SIGNAL_TOPIC_EDITORIAL_MAX_RESULT_BYTES_V2,type SignalTopicEditorialGroupRequestV2,
  type SignalTopicEditorialGroupDecisionV2} from "./signal-topic-consolidation-editorial-v2";

/** Must be loaded from the existing paid-call ledger and its request FK, never
 * accepted from a browser. This pure function checks integrity, not DB authority. */
export type SignalTopicEditorialPaidSourceCallV2={
  call_id:string;execution_id:string;workspace_id:string;run_id:string;status:string;
  response_http_status:number;response_complete:boolean;
  response_body_private:string;response_sha256:string;response_output:unknown;
  request:SignalTopicEditorialRunnerProviderRequestV1;
};
export type SignalTopicEditorialPaidReuseSourceV2=
  |{kind:"raw_response"}
  |{kind:"historical_checkpoint";state_body:string;state_digest:string;source_plan_digest:string};
export type SignalTopicEditorialPaidReuseLineageV2={
  source_kind:SignalTopicEditorialPaidReuseSourceV2["kind"];
  source_call_id:string;source_execution_id:string;source_request_digest:string;source_batch_request_digest:string;
  source_raw_sha256:string;source_checkpoint_digest:string|null;source_decision_digest:string;
};
export type SignalTopicEditorialPaidReuseReasonV2=
  |"target_request_invalid"|"source_scope_mismatch"|"source_not_settled"|"source_receipt_invalid"
  |"source_request_invalid"|"source_context_changed"|"source_group_changed"|"source_raw_incomplete"
  |"source_output_mismatch"|"source_checkpoint_invalid"|"source_checkpoint_missing_batch"
  |"source_decision_missing"|"source_decision_invalid"|"source_rationale_missing"|"source_unresolved"
  |"source_evidence_missing";
export type SignalTopicEditorialPaidReuseResultV2=
  |{status:"reusable";decision:SignalTopicEditorialGroupDecisionV2;lineage:SignalTopicEditorialPaidReuseLineageV2;source_decision_body:string}
  |{status:"needs_review";reason:SignalTopicEditorialPaidReuseReasonV2};

class ReuseFailure extends Error {constructor(readonly reason:SignalTopicEditorialPaidReuseReasonV2){super(reason);}}
const fail=(reason:SignalTopicEditorialPaidReuseReasonV2):never=>{throw new ReuseFailure(reason);};
const rawSha=(text:string)=>`sha256:${createHash("sha256").update(text).digest("hex")}`;
const digestPattern=/^sha256:[0-9a-f]{64}$/u;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const same=(a:unknown,b:unknown)=>digest(a)===digest(b);
function canonical(value:unknown):string {
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;
}
function parseBounded(text:string,reason:SignalTopicEditorialPaidReuseReasonV2):unknown {
  if(typeof text!=="string"||Buffer.byteLength(text,"utf8")>SIGNAL_TOPIC_EDITORIAL_MAX_RESULT_BYTES_V2)return fail(reason);
  try{return JSON.parse(text);}catch{return fail(reason);}
}

/** Rebuild the sealed V1 request using its historical builder. This validates
 * the complete source/dossier/evidence mapping without invoking V1's obsolete
 * editorial-length checks on the paid output. No V1 state is modified. */
function verifySourceBatch(target:SignalTopicEditorialGroupRequestV2,batch:SignalTopicEditorialScreeningBatchV1){
  if(batch.source_context_digest!==target.identity.source_context_digest
    ||batch.editorial_context_digest!==target.identity.editorial_context_digest)return fail("source_context_changed");
  if(batch.contract_version!=="signal-topic-editorial-screening-batch-v1"||!Number.isSafeInteger(batch.batch_index)||batch.batch_index<0
    ||!same(batch.configuration,SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1)
    ||digest({request_body:batch.request_body,configuration:batch.configuration,group_receipts:batch.group_receipts})!==batch.request_digest)
    return fail("source_request_invalid");
  const groups=parseBounded(batch.source_groups_body,"source_request_invalid") as SignalTopicEditorialScreeningGroupV1[];
  if(!Array.isArray(groups)||!groups.length||groups.length>60)return fail("source_request_invalid");
  let rebuilt:SignalTopicEditorialScreeningBatchV1;
  try {
    rebuilt=buildSignalTopicEditorialScreeningPlanV1({expected_group_count:groups.length,
      source_context_digest:batch.source_context_digest,editorial_context_digest:batch.editorial_context_digest,
      context:target.source_context,groups,batch_size:Math.max(10,groups.length)}).batches[0]!;
  }catch{return fail("source_request_invalid");}
  // A standalone batch is rebuilt at index zero; restore its historical ordinal
  // before comparing exact canonical bytes and its derived idempotency key.
  const body=JSON.parse(rebuilt.request_body) as {messages:Array<{content:string}>};
  const payload=JSON.parse(body.messages[0]!.content) as Record<string,unknown>;
  payload.batch_index=batch.batch_index;payload.batch_key_prefix=`b${String(batch.batch_index).padStart(4,"0")}-`;
  body.messages[0]!.content=canonical(payload);
  const request_body=canonical(body);
  const request_digest=digest({request_body,configuration:rebuilt.configuration,group_receipts:rebuilt.group_receipts});
  const expected={...rebuilt,batch_index:batch.batch_index,request_body,request_digest,
    batch_key:`topic-consolidation-screen-v1:${batch.batch_index}:${request_digest.slice(7,23)}`};
  if(!same(batch,expected))return fail("source_request_invalid");
  const matching=groups.filter(group=>group.group_key===target.receipt.group_key);
  if(matching.length!==1||!same(matching[0],target.source_group))return fail("source_group_changed");
}

function verifyCallRequest(batch:SignalTopicEditorialScreeningBatchV1,request:SignalTopicEditorialRunnerProviderRequestV1){
  const original:SignalTopicEditorialRunnerProviderRequestV1={contract_version:"signal-topic-editorial-provider-request-v1",
    phase:"screening",idempotency_key:batch.batch_key,model:batch.model,request_digest:batch.request_digest,request_body:batch.request_body};
  if(!request.repair){if(!same(request,original))return fail("source_request_invalid");return;}
  try{if(!same(validateSignalTopicEditorialRepairRequestV1(request).original,original))return fail("source_request_invalid");}
  catch{return fail("source_request_invalid");}
}

const checkpointSchema=z.object({
  contract_version:z.literal("signal-topic-editorial-runner-v1"),execution_key:z.string(),plan_digest:z.string(),
  phase:z.enum(["screening","global","completed"]),screening_outputs:z.array(signalTopicEditorialScreeningOutputSchemaV1),
  global:z.unknown(),
}).strict();

/** Reuse a paid semantic decision, not a provider response or a second charge.
 * The persistence adapter MUST re-check the source call/request FK, owner and
 * exact historical checkpoint under the same transaction that records lineage.
 * A digest supplied by an untrusted client is not evidence of database history.
 * There is deliberately no partial-JSON scanner, repair or Noise fallback here. */
export function reuseSignalTopicEditorialPaidGroupV2(args:{request:SignalTopicEditorialGroupRequestV2;
  source_batch:SignalTopicEditorialScreeningBatchV1;source_call:SignalTopicEditorialPaidSourceCallV2;
  source:SignalTopicEditorialPaidReuseSourceV2}):SignalTopicEditorialPaidReuseResultV2 {
  try {
    try{validateSignalTopicEditorialGroupRequestV2(args.request);}catch{return fail("target_request_invalid");}
    const {source_call:call,source_batch:batch,request,source}=args;
    if(!uuidPattern.test(call.call_id)||!uuidPattern.test(call.execution_id)
      ||call.workspace_id!==request.identity.workspace_id||call.run_id!==request.identity.run_id)return fail("source_scope_mismatch");
    if(call.status!=="settled")return fail("source_not_settled");
    if(call.response_http_status!==200||call.response_complete!==true||!digestPattern.test(call.response_sha256)
      ||typeof call.response_body_private!=="string"||rawSha(call.response_body_private)!==call.response_sha256)return fail("source_receipt_invalid");
    verifySourceBatch(request,batch);
    verifyCallRequest(batch,call.request);
    const provider=z.object({type:z.literal("message"),role:z.literal("assistant"),model:z.literal(batch.model),
      stop_reason:z.string(),content:z.array(z.object({type:z.literal("text"),text:z.string()}).passthrough())})
      .passthrough().safeParse(parseBounded(call.response_body_private,"source_receipt_invalid"));
    if(!provider.success||provider.data.content.length!==1)return fail("source_receipt_invalid");
    let output:unknown,checkpointDigest:string|null=null;
    if(source.kind==="raw_response"){
      if(provider.data.stop_reason!=="end_turn")return fail("source_raw_incomplete");
      output=parseBounded(provider.data.content[0]!.text,"source_raw_incomplete");
      if(!same(output,call.response_output))return fail("source_output_mismatch");
    }else{
      if(!["end_turn","max_tokens"].includes(provider.data.stop_reason))return fail("source_receipt_invalid");
      const value=parseBounded(source.state_body,"source_checkpoint_invalid");
      if(!digestPattern.test(source.source_plan_digest)||!digestPattern.test(source.state_digest)
        ||digest(value)!==source.state_digest)return fail("source_checkpoint_invalid");
      const parsed=checkpointSchema.safeParse(value);
      if(!parsed.success||parsed.data.execution_key!==call.execution_id||parsed.data.plan_digest!==source.source_plan_digest
        ||new Set(parsed.data.screening_outputs.map(item=>item.batch_index)).size!==parsed.data.screening_outputs.length)
        return fail("source_checkpoint_invalid");
      output=parsed.data.screening_outputs.find(item=>item.batch_index===batch.batch_index);
      if(!output)return fail("source_checkpoint_missing_batch");
      checkpointDigest=source.state_digest;
    }
    const parsed=signalTopicEditorialScreeningOutputSchemaV1.safeParse(output);
    if(!parsed.success||parsed.data.batch_index!==batch.batch_index)return fail("source_decision_invalid");
    const expected=new Set(batch.group_keys),seen=new Set(parsed.data.decisions.map(item=>item.group_key));
    if(seen.size!==parsed.data.decisions.length||seen.size!==expected.size||[...seen].some(key=>!expected.has(key)))
      return fail("source_decision_invalid");
    const decision=parsed.data.decisions.find(item=>item.group_key===request.receipt.group_key);
    if(!decision)return fail("source_decision_missing");
    if(decision.disposition==="unresolved")return fail("source_unresolved");
    if(decision.rationale===null)return fail("source_rationale_missing");
    if(!decision.cited_ref_ids.length)return fail("source_evidence_missing");
    const aliases=new Map(request.receipt.evidence.map(item=>[item.ref_id,item.evidence_id]));
    if(decision.cited_ref_ids.some(ref=>!aliases.has(ref)))return fail("source_decision_invalid");
    let mapped:SignalTopicEditorialGroupDecisionV2;
    try{mapped=validateSignalTopicEditorialGroupOutputV2(request,{
      contract_version:"signal-topic-editorial-group-output-v2",group_id:request.receipt.group_id,
      disposition:decision.disposition,candidate:decision.candidate===null?null:{label:decision.candidate.label,
        definition:decision.candidate.definition,locale:decision.candidate.locale},confidence:decision.confidence,
      rationale:decision.rationale,cited_evidence_ids:decision.cited_ref_ids.map(ref=>aliases.get(ref)),
    });}catch{return fail("source_decision_invalid");}
    return {status:"reusable",decision:mapped,source_decision_body:canonical(decision),lineage:{source_kind:source.kind,source_call_id:call.call_id,
      source_execution_id:call.execution_id,source_request_digest:call.request.request_digest,
      source_batch_request_digest:batch.request_digest,source_raw_sha256:call.response_sha256,
      source_checkpoint_digest:checkpointDigest,source_decision_digest:digest(decision)}};
  }catch(error){return {status:"needs_review",reason:error instanceof ReuseFailure?error.reason:"source_receipt_invalid"};}
}
