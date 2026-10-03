import { z } from "zod";

import { SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS } from "@/lib/data-os/signal-semantic-context-pack";
import { signalSemanticContextCreateCommandSchemaV1 }
  from "@/lib/data-os/signal-semantic-context-ordinary-api-contract";
import { createSignalSemanticContextElementProductV1,loadSignalSemanticContextCreationGuidanceProductV1 }
  from "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const guidance=z.object({generation_key:key,element_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS),
  canonical_key:key,display_text:z.string().trim().min(1).max(500),locale:z.string()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u).nullable()}).strict();

export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const url=new URL(request.url);const candidate=guidance.safeParse({generation_key:url.searchParams.get("generation_key"),
    element_kind:url.searchParams.get("element_kind"),canonical_key:url.searchParams.get("canonical_key"),
    display_text:url.searchParams.get("display_text"),locale:url.searchParams.get("locale")||null});
  if(!candidate.success)return semanticContextResponse({error:"invalid_semantic_context_creation_guidance",
    message:"Creation guidance input is invalid."},422);
  try{return semanticContextResponse(await loadSignalSemanticContextCreationGuidanceProductV1({workspace:loaded.workspace,
    actor:loaded.session.appUser,generationKey:candidate.data.generation_key,elementKind:candidate.data.element_kind,
    canonicalKey:candidate.data.canonical_key,displayText:candidate.data.display_text,locale:candidate.data.locale}));}
  catch(error){return semanticContextError(error,"semantic_context_creation_guidance_rejected");}
}

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);if(!idempotencyKey)return semanticContextResponse({
    error:"idempotency_key_required",message:"Idempotency-Key is required."},400);
  const parsed=signalSemanticContextCreateCommandSchemaV1.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({
    error:"invalid_semantic_context_creation",message:"Element creation input is invalid."},422);
  try{return semanticContextResponse(await createSignalSemanticContextElementProductV1({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,values:parsed.data.values}));}
  catch(error){return semanticContextError(error,"semantic_context_creation_rejected");}
}
