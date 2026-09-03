import {
  createSignalTopicEvaluationRunV1,
  createSignalTopicEvaluationSuccessorRunV1,
  loadSignalTopicEvaluationManagementPreflightV1,
  reviewSignalTopicEvaluationCandidateV1,
  signalTopicEvaluationConfigurationFromEnvV1
} from "@noisia/db";
import { loadSignalTopicEvaluationV2Preflight,navigateSignalTopicEvaluationEvidenceV2 }
  from "@noisia/db";
import { createSignalTopicEvaluationV2ExecutionAuthority,
  type SignalTopicEvaluationV2ExecutionConfiguration } from "@noisia/db";
import { buildSignalTopicEvaluationExecutionFlightCardV2,
  SIGNAL_TOPIC_EVALUATION_V2_LIMITS } from "@noisia/query-engine";

import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

function actor(value:SignalWorkspaceUser){
  if(value.userType!=="noisia_internal")throw Object.assign(new Error("topic_evaluation_forbidden"),
    {code:"topic_evaluation_forbidden",status:403});
  return{id:value.id,user_type:"noisia_internal" as const};
}

export async function startSignalTopicEvaluationSuccessorProductV1(args:{workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;idempotencyKey:string;predecessorRunKey:string;
  expectedEnvelopeDigest:string;confirmation:string;hardCapMicroUsd:bigint}){
  const{pool}=await import("@/lib/db");
  return createSignalTopicEvaluationSuccessorRunV1({pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),idempotency_key:args.idempotencyKey,
    predecessor_run_key:args.predecessorRunKey,expected_envelope_digest:args.expectedEnvelopeDigest,
    confirmation:args.confirmation,hard_cap_micro_usd:args.hardCapMicroUsd,
    configuration:signalTopicEvaluationConfigurationFromEnvV1()});
}

export async function loadSignalTopicEvaluationDryRunProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;cursor?:string|null;limit?:number}){
  const{pool}=await import("@/lib/db");
  const{preflight,management}=await loadSignalTopicEvaluationManagementPreflightV1({queryable:pool,
    workspace_id:args.workspace.id,actor:actor(args.actor),cursor:args.cursor,limit:args.limit,
    configuration:signalTopicEvaluationConfigurationFromEnvV1()});
  if(!("envelope" in preflight))return{...preflight,input_authority:null,...management};
  const{envelope,...flightCard}=preflight;
  return{...flightCard,input_authority:{corpus:envelope.corpus,
    semantic_context:{generation_key:envelope.semantic_context.generation_key,
      generation_authority_digest:envelope.semantic_context.generation_authority_digest,
      brand_os_digest:envelope.semantic_context.brand_os_digest,
      knowledge_digest:envelope.semantic_context.knowledge_digest,
      locale_context_digest:envelope.semantic_context.locale_context_digest,
      candidate_pack_digest:envelope.semantic_context.candidate_pack_digest,
      approved_count:envelope.semantic_context.approved_count},
    diagnostic_packet:{packet_digest:envelope.diagnostic_packet.packet_digest,
      proposal_count:envelope.diagnostic_packet.proposal_count,
      evidence_count:envelope.diagnostic_packet.evidence_count}},...management};
}

export async function startSignalTopicEvaluationProductV1(args:{workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;idempotencyKey:string;expectedEnvelopeDigest:string;
  confirmation:string;hardCapMicroUsd:bigint}){
  const{pool}=await import("@/lib/db");
  return createSignalTopicEvaluationRunV1({pool,workspace_id:args.workspace.id,actor:actor(args.actor),
    idempotency_key:args.idempotencyKey,expected_envelope_digest:args.expectedEnvelopeDigest,
    confirmation:args.confirmation,hard_cap_micro_usd:args.hardCapMicroUsd,
    configuration:signalTopicEvaluationConfigurationFromEnvV1()});
}

export async function reviewSignalTopicEvaluationCandidateProductV1(args:{workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;idempotencyKey:string;command:Parameters<
    typeof reviewSignalTopicEvaluationCandidateV1>[0]["command"]}){
  const{pool}=await import("@/lib/db");
  return reviewSignalTopicEvaluationCandidateV1({pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),idempotency_key:args.idempotencyKey,command:args.command});
}

export async function loadSignalTopicEvaluationFullEvidencePreflightProductV2(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser}){
  const{pool}=await import("@/lib/db");
  return loadSignalTopicEvaluationV2Preflight({queryable:pool,workspace_id:args.workspace.id,
    actor:actor(args.actor)});
}

export async function navigateSignalTopicEvaluationEvidenceProductV2(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;request:unknown}){
  const{pool}=await import("@/lib/db");
  return navigateSignalTopicEvaluationEvidenceV2({queryable:pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),request:args.request});
}

/**
 * The browser never supplies model, pricing or a budget. This is intentionally disabled until all
 * UAT-only server configuration is present; `create...` repeats that fail-closed check before it
 * touches the database.
 */
export async function startSignalTopicEvaluationFullEvidenceProductV2(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;
  expectedSnapshotDigest:string;confirmation:string;
}){
  const{pool}=await import("@/lib/db");
  return createSignalTopicEvaluationV2ExecutionAuthority({pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),idempotency_key:args.idempotencyKey,
    expected_snapshot_digest:args.expectedSnapshotDigest,confirmation:args.confirmation,
    configuration:signalTopicEvaluationV2ExecutionConfigurationFromEnv()});
}

export function signalTopicEvaluationV2ExecutionConfigurationFromEnv(
  env:Record<string,string|undefined>=process.env
):SignalTopicEvaluationV2ExecutionConfiguration{
  const model=env.NOISIA_TOPIC_EVALUATION_V2_MODEL?.trim()??"disabled";
  const pricingVersion=env.NOISIA_TOPIC_EVALUATION_V2_PRICING_VERSION?.trim()??"disabled";
  const input=parsePositiveInteger(env.NOISIA_TOPIC_EVALUATION_V2_INPUT_MICRO_USD_PER_TOKEN,1_000_000);
  const output=parsePositiveInteger(env.NOISIA_TOPIC_EVALUATION_V2_OUTPUT_MICRO_USD_PER_TOKEN,1_000_000);
  const hardCap=parsePositiveInteger(env.NOISIA_TOPIC_EVALUATION_V2_HARD_CAP_MICRO_USD,
    SIGNAL_TOPIC_EVALUATION_V2_LIMITS.hard_cap_micro_usd);
  const profileIsUat=env.NOISIA_RUNTIME_PROFILE==="uat";
  const configured=profileIsUat&&Boolean(env.ANTHROPIC_API_KEY)
    &&/^[a-z0-9][a-z0-9._-]{2,159}$/u.test(model)
    &&/^[a-z0-9][a-z0-9._:-]{2,159}$/u.test(pricingVersion)
    && input!==null&&output!==null&&hardCap!==null
    && hardCap<=SIGNAL_TOPIC_EVALUATION_V2_LIMITS.hard_cap_micro_usd;
  const card=buildSignalTopicEvaluationExecutionFlightCardV2({provider_calls_allowed:12,
    max_model_turns:12,max_tool_calls:24,max_tool_result_bytes:32_768,
    max_total_tool_result_bytes:262_144,max_total_input_tokens:450_000,
    max_total_output_tokens:50_000,hard_cap_micro_usd:configured?hardCap:1});
  return {enabled:configured&&env.NOISIA_TOPIC_EVALUATION_V2_EXECUTION_ENABLED==="true",
    runtime_profile:"uat",credential_configured:Boolean(process.env.ANTHROPIC_API_KEY),provider:"anthropic",
    model,pricing_version:pricingVersion,input_micro_usd_per_token:input??0,
    output_micro_usd_per_token:output??0,flight_card:card};
}

function parsePositiveInteger(value:string|undefined,maximum:number){
  if(!value||!/^[1-9][0-9]*$/u.test(value))return null;
  const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed<=maximum?parsed:null;
}
