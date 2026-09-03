import { classifySignalTopicEvaluationProviderBoundaryV1,
  SignalTopicEvaluationProviderBoundaryErrorV1,
  runOfflineSignalTopicEvaluationV2,
  type SignalTopicEvaluationModelInputV2,
  type SignalTopicEvidenceNavigationRequestV2,
  type SignalTopicEvidenceNavigationResultV2 } from "@noisia/query-engine";
import { claimSignalTopicEvaluationV2ExecutionAuthority,
  failSignalTopicEvaluationV2DispatchBeforeClaim,
  navigateSignalTopicEvaluationEvidenceV2,
  persistSignalTopicEvaluationProviderTraceV2,
  recordSignalTopicEvaluationV2ProviderTurnAttempt,
  settleSignalTopicEvaluationV2ExecutionFailure,
  type SignalTopicEvaluationV2ClaimedExecution } from "@noisia/db";
import type { Pool } from "pg";

import { SignalTopicEvaluationProviderResponseInvalidErrorV2 } from "../providers/anthropic-full-evidence-topic-evaluation";

/** Offline harness retained for contract tests; the separately guarded V2 outbox is the only
 * registered provider composition root. */
export async function executeSignalTopicEvaluationV2OfflineFixture(args:{
  snapshot_digest:string;
  model:{next(input:SignalTopicEvaluationModelInputV2):Promise<
    {kind:"tool";request:unknown}|{kind:"final";json:string}>};
  navigate:(request:SignalTopicEvidenceNavigationRequestV2)=>Promise<SignalTopicEvidenceNavigationResultV2>;
}){return runOfflineSignalTopicEvaluationV2(args);}

type FullEvidenceProviderModelV2={next(input:SignalTopicEvaluationModelInputV2):Promise<
  ({kind:"tool";request:unknown}|{kind:"final";json:string})&{usage?:{
    input_tokens:number;output_tokens:number;cost_micro_usd:number}}>};

/**
 * Worker execution body. Its composition root first atomically dispatches and claims one durable
 * authority; every provider attempt is persisted before transport and no error path retries.
 */
export async function processSignalTopicEvaluationV2ProviderRun(args:{
  pool:Pick<Pool,"connect"|"query">;
  run_id:string;
  claimed_execution?: SignalTopicEvaluationV2ClaimedExecution;
  create_model:(input:{model:string;snapshot_digest:string;max_output_tokens:number;
    input_micro_usd_per_token:number;output_micro_usd_per_token:number})=>FullEvidenceProviderModelV2;
}){
  let attempts=0;let inputTokens=0;let outputTokens=0;let costMicroUsd=0;let providerCompleted=false;
  let modelConstructed=false;let transportStarted=false;
  let claimed:SignalTopicEvaluationV2ClaimedExecution|undefined=args.claimed_execution;
  try{
    if (claimed && claimed.run_id!==args.run_id) throw new Error("topic_evaluation_v2_claimed_run_mismatch");
    const claimedAuthority=claimed??await claimSignalTopicEvaluationV2ExecutionAuthority({pool:args.pool,run_id:args.run_id});
    claimed=claimedAuthority;
    const model=args.create_model({model:claimedAuthority.configuration.model,snapshot_digest:claimedAuthority.snapshot_digest,
      max_output_tokens:claimedAuthority.configuration.flight_card.max_total_output_tokens,
      input_micro_usd_per_token:claimedAuthority.configuration.input_micro_usd_per_token,
      output_micro_usd_per_token:claimedAuthority.configuration.output_micro_usd_per_token});
    modelConstructed=true;
    const trace=await runOfflineSignalTopicEvaluationV2({snapshot_digest:claimedAuthority.snapshot_digest,
      provider_calls_on_completion:"model_turns",
      limits:claimedAuthority.configuration.flight_card,
      model:{next:async(input)=>{
        await recordSignalTopicEvaluationV2ProviderTurnAttempt({pool:args.pool,run_id:args.run_id});
        attempts+=1;
        transportStarted=true;
        const decision=await model.next(input);
        const usage=decision.usage??{input_tokens:0,output_tokens:0,cost_micro_usd:0};
        inputTokens+=usage.input_tokens;outputTokens+=usage.output_tokens;costMicroUsd+=usage.cost_micro_usd;
        return decision;
      }},navigate:(request)=>navigateSignalTopicEvaluationEvidenceV2({queryable:args.pool,
        workspace_id:claimedAuthority.workspace_id,
        actor:{id:claimedAuthority.requested_by_user_id,user_type:"noisia_internal"},request})});
    providerCompleted=true;
    const client=await args.pool.connect();try{await client.query("BEGIN");
      await persistSignalTopicEvaluationProviderTraceV2({client,run_id:args.run_id,
        workspace_id:claimedAuthority.workspace_id,snapshot_id:claimedAuthority.snapshot_id,
        execution_authorization_id:claimedAuthority.execution_authorization_id,trace});
      await client.query("COMMIT");}catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{client.release();}
    return {status:"completed" as const,run_id:args.run_id,candidate_count:trace.output.candidates.length,
      provider_call_count:trace.provider_calls,settled_micro_usd:trace.total_cost_micro_usd};
  }catch(error){
    if(!claimed){
      const settled=await failSignalTopicEvaluationV2DispatchBeforeClaim({pool:args.pool,run_id:args.run_id});
      return {status:settled.status,run_id:args.run_id,provider_call_count:0,
        settled_micro_usd:0,error_code:"topic_evaluation_v2_dispatch_pretransport_failed"};
    }
    const boundary=classifySignalTopicEvaluationProviderBoundaryV1(error);
    if (error instanceof SignalTopicEvaluationProviderResponseInvalidErrorV2) {
      inputTokens+=error.usage.input_tokens;
      outputTokens+=error.usage.output_tokens;
      costMicroUsd+=error.usage.cost_micro_usd;
    }
    const localPretransport=!modelConstructed||!transportStarted;
    const localFailure=localPretransport||(error instanceof SignalTopicEvaluationProviderBoundaryErrorV1
      && boundary.outcome_class==="definitely_not_sent");
    const outcome=localFailure?"definitely_not_sent"
      :providerCompleted||isKnownControlFailure(error)?"known_response_invalid":"ambiguous_after_send";
    const errorCode=localPretransport?"topic_evaluation_v2_provider_pretransport_failed"
      :outcome==="ambiguous_after_send"?boundary.error_code
      :outcome==="definitely_not_sent"?boundary.error_code:"topic_evaluation_v2_provider_response_or_control_invalid";
    const settled=await settleSignalTopicEvaluationV2ExecutionFailure({pool:args.pool,run_id:args.run_id,
      outcome,error_code:errorCode,provider_call_count:attempts,observed_input_tokens:inputTokens,
      observed_output_tokens:outputTokens,observed_cost_micro_usd:costMicroUsd});
    return {status:settled.status,run_id:args.run_id,provider_call_count:attempts,
      settled_micro_usd:settled.settled_micro_usd,error_code:errorCode};
  }
}

function isKnownControlFailure(error:unknown){return error instanceof Error
  && (error instanceof SignalTopicEvaluationProviderResponseInvalidErrorV2
    || /^topic_evaluation_v2_[a-z0-9_]+$/u.test(error.message));}
