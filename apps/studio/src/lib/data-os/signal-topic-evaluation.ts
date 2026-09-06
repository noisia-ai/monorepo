import {
  createSignalTopicEvaluationRunV1,
  createSignalTopicEvaluationSuccessorRunV1,
  loadSignalTopicEvaluationManagementPreflightV1,
  reviewSignalTopicEvaluationCandidateV1,
  signalTopicEvaluationConfigurationFromEnvV1
} from "@noisia/db";
import { loadSignalTopicEvaluationV2CandidateDetail,loadSignalTopicEvaluationV2CandidateManagement,
  loadSignalTopicEvaluationV2Preflight,navigateSignalTopicEvaluationEvidenceV2,
  reviewSignalTopicEvaluationV2Candidate }
  from "@noisia/db";

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

export async function loadSignalTopicEvaluationV2CandidatesProduct(args:{workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;cursor?:string|null;limit?:number}){
  const{pool}=await import("@/lib/db");
  return loadSignalTopicEvaluationV2CandidateManagement({queryable:pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),cursor:args.cursor,limit:args.limit});
}

export async function loadSignalTopicEvaluationV2CandidateDetailProduct(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;runKey:string;candidateKey:string}){
  const{pool}=await import("@/lib/db");
  return loadSignalTopicEvaluationV2CandidateDetail({queryable:pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),run_key:args.runKey,candidate_key:args.candidateKey});
}

export async function reviewSignalTopicEvaluationV2CandidateProduct(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;
  command:Parameters<typeof reviewSignalTopicEvaluationV2Candidate>[0]["command"]}){
  const{pool}=await import("@/lib/db");
  return reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),idempotency_key:args.idempotencyKey,command:args.command});
}
