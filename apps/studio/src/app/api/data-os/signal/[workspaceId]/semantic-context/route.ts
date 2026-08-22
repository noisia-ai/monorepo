import { createSignalSemanticContextDraftProductV1,
  loadSignalSemanticContextGenerationProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "./_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const generationKey=new URL(request.url).searchParams.get("generation_key")?.trim()||undefined;
  try{return semanticContextResponse(await loadSignalSemanticContextGenerationProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,generationKey}));}
  catch(error){return semanticContextError(error,"semantic_context_generation_unavailable");}
}

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const key=requireIdempotencyKey(request);
  if(!key)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some((field)=>field!=="action")
      ||(body as {action?:unknown}).action!=="create_draft")return semanticContextResponse({
    error:"invalid_semantic_context_command",message:"Only create_draft is supported here."},422);
  try{return semanticContextResponse(await createSignalSemanticContextDraftProductV1({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey:key}),201);}
  catch(error){return semanticContextError(error,"semantic_context_draft_rejected");}
}
