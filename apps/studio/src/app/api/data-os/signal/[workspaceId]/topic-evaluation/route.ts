import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../semantic-context/_lib";
import { parseSignalTopicEvaluationStartRequestV1 } from "@/lib/data-os/signal-topic-evaluation-api";
import { loadSignalTopicEvaluationDryRunProductV1,startSignalTopicEvaluationProductV1 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  try{return semanticContextResponse(await loadSignalTopicEvaluationDryRunProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser}));}
  catch(error){return semanticContextError(error,"topic_evaluation_preflight_rejected");}
}

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  let body;try{body=parseSignalTopicEvaluationStartRequestV1(await request.json());}
  catch{return semanticContextResponse({error:"invalid_topic_evaluation_command",
    message:"The Topic Evaluation command is invalid."},422);}
  try{return semanticContextResponse(await startSignalTopicEvaluationProductV1({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,expectedEnvelopeDigest:body.expected_envelope_digest,
    confirmation:body.confirmation,hardCapMicroUsd:body.hard_cap_micro_usd}),202);}
  catch(error){return semanticContextError(error,"topic_evaluation_start_rejected");}
}
