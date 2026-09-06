import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../../../semantic-context/_lib";
import { parseSignalTopicEvaluationV2CandidateDetailQuery } from "@/lib/data-os/signal-topic-evaluation-api";
import { loadSignalTopicEvaluationV2CandidateDetailProduct } from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{workspaceId:string;candidateKey:string}>}){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let query;try{query=parseSignalTopicEvaluationV2CandidateDetailQuery(request.url);}
  catch{return semanticContextResponse({error:"topic_evaluation_v2_candidate_query_invalid",
    message:"The candidate detail request is invalid."},422);}
  try{return semanticContextResponse(await loadSignalTopicEvaluationV2CandidateDetailProduct({
    workspace:loaded.workspace,actor:loaded.session.appUser,runKey:query.run_key,candidateKey}));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_candidate_detail_rejected");}
}
