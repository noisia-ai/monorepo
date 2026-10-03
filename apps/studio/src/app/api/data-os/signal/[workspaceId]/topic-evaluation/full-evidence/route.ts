import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../semantic-context/_lib";
import { loadSignalTopicEvaluationFullEvidencePreflightProductV2 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  try{return semanticContextResponse(await loadSignalTopicEvaluationFullEvidencePreflightProductV2({
    workspace:loaded.workspace,actor:loaded.session.appUser}));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_preflight_rejected");}
}

// R24 deliberately exposes no launch authority. A later audited gate must replace this closed edge.
export async function POST(_request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  return semanticContextResponse({error:"topic_evaluation_v2_disabled",
    message:"The full-evidence evaluator is installed but provider execution is disabled."},403);
}
