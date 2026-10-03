import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../../semantic-context/_lib";
import { navigateSignalTopicEvaluationEvidenceProductV2 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

/** Read-only POST: the closed request body selects a bounded navigation operation. */
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let body:unknown;try{body=await request.json();}catch{return semanticContextResponse({
    error:"topic_evaluation_v2_navigation_invalid",message:"The evidence request is invalid."},422);}
  try{return semanticContextResponse(await navigateSignalTopicEvaluationEvidenceProductV2({
    workspace:loaded.workspace,actor:loaded.session.appUser,request:body}));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_navigation_rejected");}
}
