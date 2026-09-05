import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../../../../semantic-context/_lib";
import { parseSignalTopicCandidateRefinementNavigationRequestV1Api }
  from "@/lib/data-os/signal-topic-evaluation-api";
import { navigateSignalTopicCandidateRefinementProductV1 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

/** Bounded append-only trace. It never constructs a model or accepts free-form corpus access. */
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;sessionKey:string}>}){
  const{workspaceId,sessionKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let body;try{body=parseSignalTopicCandidateRefinementNavigationRequestV1Api(await request.json());}
  catch{return semanticContextResponse({error:"topic_candidate_refinement_navigation_invalid",
    message:"The candidate evidence request is invalid."},422);}
  try{return semanticContextResponse(await navigateSignalTopicCandidateRefinementProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,sessionKey,request:body}));}
  catch(error){return semanticContextError(error,"topic_candidate_refinement_navigation_rejected");}
}
