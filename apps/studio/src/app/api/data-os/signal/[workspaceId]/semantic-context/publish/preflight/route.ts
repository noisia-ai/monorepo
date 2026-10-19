import { z } from "zod";

import { loadSignalSemanticContextPublicationPreflightProductV2 } from
  "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const query=z.object({generation_key:z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200)}).strict();
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const url=new URL(request.url);const parsed=query.safeParse({generation_key:url.searchParams.get("generation_key")});
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_publish_preflight",
    message:"A valid generation key is required."},422);
  try{return semanticContextResponse(await loadSignalSemanticContextPublicationPreflightProductV2({
    workspace:loaded.workspace,actor:loaded.session.appUser,generationKey:parsed.data.generation_key}));}
  catch(error){return semanticContextError(error,"semantic_context_publish_preflight_rejected");}
}
