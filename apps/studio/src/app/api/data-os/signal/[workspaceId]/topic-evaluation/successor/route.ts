import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../../semantic-context/_lib";
import { parseSignalTopicEvaluationSuccessorStartRequestV1 }
  from "@/lib/data-os/signal-topic-evaluation-api";
import { startSignalTopicEvaluationSuccessorProductV1 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  let body;try{body=parseSignalTopicEvaluationSuccessorStartRequestV1(await request.json());}
  catch{return semanticContextResponse({error:"invalid_topic_evaluation_successor_command",
    message:"The Topic Evaluation successor command is invalid."},422);}
  try{return semanticContextResponse(await startSignalTopicEvaluationSuccessorProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,
    predecessorRunKey:body.predecessor_run_key,expectedEnvelopeDigest:body.expected_envelope_digest,
    confirmation:body.confirmation,hardCapMicroUsd:body.hard_cap_micro_usd}),202);}
  catch(error){return semanticContextError(error,"topic_evaluation_successor_start_rejected");}
}
