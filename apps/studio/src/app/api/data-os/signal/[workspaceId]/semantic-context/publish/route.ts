import { z } from "zod";
import { publishSignalSemanticContextGenerationProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../_lib";
export const runtime="nodejs";export const dynamic="force-dynamic";
const command=z.object({generation_key:z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200),
  confirmation:z.literal("publish_reviewed_semantic_context")}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  const parsed=command.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_publication",
    message:"Explicit publication confirmation is required."},422);
  try{return semanticContextResponse(await publishSignalSemanticContextGenerationProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,
    generationKey:parsed.data.generation_key}));}
  catch(error){return semanticContextError(error,"semantic_context_publication_rejected");}
}
