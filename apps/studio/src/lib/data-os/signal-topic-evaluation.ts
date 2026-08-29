import {
  createSignalTopicEvaluationRunV1,
  prepareSignalTopicEvaluationDryRunV1,
  signalTopicEvaluationConfigurationFromEnvV1
} from "@noisia/db";

import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

function actor(value:SignalWorkspaceUser){
  if(value.userType!=="noisia_internal")throw Object.assign(new Error("topic_evaluation_forbidden"),
    {code:"topic_evaluation_forbidden",status:403});
  return{id:value.id,user_type:"noisia_internal" as const};
}

export async function loadSignalTopicEvaluationDryRunProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser}){
  const{pool}=await import("@/lib/db");
  const prepared=await prepareSignalTopicEvaluationDryRunV1({queryable:pool,workspace_id:args.workspace.id,
    actor:actor(args.actor),configuration:signalTopicEvaluationConfigurationFromEnvV1()});
  const{envelope,...flightCard}=prepared;
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
      evidence_count:envelope.diagnostic_packet.evidence_count}}};
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
