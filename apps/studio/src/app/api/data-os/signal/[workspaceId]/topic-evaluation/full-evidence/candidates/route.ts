import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../../semantic-context/_lib";
import { parseSignalTopicEvaluationV2CandidatePageQuery } from "@/lib/data-os/signal-topic-evaluation-api";
import { loadSignalTopicEvaluationV2CandidatesProduct } from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let query;try{query=parseSignalTopicEvaluationV2CandidatePageQuery(request.url);}
  catch{return semanticContextResponse({error:"topic_evaluation_v2_candidate_query_invalid",
    message:"The candidate page request is invalid."},422);}
  try{return semanticContextResponse(await loadSignalTopicEvaluationV2CandidatesProduct({
    workspace:loaded.workspace,actor:loaded.session.appUser,...query}));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_candidate_list_rejected");}
}
