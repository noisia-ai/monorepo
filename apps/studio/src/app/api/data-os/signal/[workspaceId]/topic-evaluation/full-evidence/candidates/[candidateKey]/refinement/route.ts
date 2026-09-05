import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../../../../../semantic-context/_lib";
import { parseSignalTopicCandidateRefinementSessionStartRequestV1 }
  from "@/lib/data-os/signal-topic-evaluation-api";
import { startSignalTopicCandidateRefinementProductV1 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

/** Opens no provider edge. It seals one already-pending candidate for bounded later evidence use. */
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;candidateKey:string}>}){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  let body;try{body=parseSignalTopicCandidateRefinementSessionStartRequestV1(await request.json());}
  catch{return semanticContextResponse({error:"topic_candidate_refinement_session_invalid",
    message:"The candidate refinement request is invalid."},422);}
  if(body.candidate_key!==candidateKey)return semanticContextResponse({
    error:"topic_candidate_refinement_candidate_key_mismatch",
    message:"The candidate key does not match the route."},422);
  try{return semanticContextResponse(await startSignalTopicCandidateRefinementProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,input:body}),201);}
  catch(error){return semanticContextError(error,"topic_candidate_refinement_session_rejected");}
}
