import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../../../../../semantic-context/_lib";
import { parseSignalTopicEvaluationV2CandidateCommand } from "@/lib/data-os/signal-topic-evaluation-api";
import { reviewSignalTopicEvaluationV2CandidateProduct } from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function POST(request:Request,context:{params:Promise<{workspaceId:string;candidateKey:string}>}){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  let command;try{command=parseSignalTopicEvaluationV2CandidateCommand(await request.json());}
  catch{return semanticContextResponse({error:"invalid_topic_evaluation_v2_candidate_command",
    message:"The candidate command is invalid."},422);}
  if(command.candidate_key!==candidateKey)return semanticContextResponse({
    error:"topic_evaluation_v2_candidate_key_mismatch",
    message:"The candidate key does not match the route."},422);
  try{return semanticContextResponse(await reviewSignalTopicEvaluationV2CandidateProduct({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,command}));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_candidate_review_rejected");}
}
