import { loadSignalSemanticContextDiffProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,semanticContextResponse } from "../_lib";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const generationKey=new URL(request.url).searchParams.get("generation_key")?.trim()||undefined;
  try{return semanticContextResponse(await loadSignalSemanticContextDiffProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,generationKey}));}
  catch(error){return semanticContextError(error,"semantic_context_diff_unavailable");}
}
