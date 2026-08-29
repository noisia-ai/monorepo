import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../../../../semantic-context/_lib";
import { parseSignalTopicEvaluationCandidateCommandV1 } from "@/lib/data-os/signal-topic-evaluation-api";
import { reviewSignalTopicEvaluationCandidateProductV1 } from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function POST(request:Request,context:{params:Promise<{workspaceId:string;candidateKey:string}>}){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  let command;try{command=parseSignalTopicEvaluationCandidateCommandV1(await request.json());}
  catch{return semanticContextResponse({error:"invalid_topic_evaluation_candidate_command",
    message:"The Topic Evaluation candidate command is invalid."},422);}
  if(command.candidate_key!==candidateKey)return semanticContextResponse({
    error:"topic_evaluation_candidate_key_mismatch",message:"The candidate key does not match the route."},422);
  try{return semanticContextResponse(await reviewSignalTopicEvaluationCandidateProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,command}));}
  catch(error){return semanticContextError(error,"topic_evaluation_candidate_review_rejected");}
}
