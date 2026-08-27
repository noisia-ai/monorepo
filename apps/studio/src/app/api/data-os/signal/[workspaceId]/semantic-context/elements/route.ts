import { z } from "zod";

import { SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS, SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS }
  from "@/lib/data-os/signal-semantic-context-pack";
import { createSignalSemanticContextElementProductV1,loadSignalSemanticContextCreationGuidanceProductV1 }
  from "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const applicability=z.discriminatedUnion("state",[
  z.object({state:z.enum(["workspace_inherited","explicit_global"]),locale:z.null()}).strict(),
  z.object({state:z.literal("explicit_locale"),locale:z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u)}).strict()
]);
const values=z.object({element_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS),
  display_text:z.string().trim().min(1).max(500),canonical_key:key,scope:z.string().trim().max(200).nullable(),
  relation_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),relation_target_key:key.nullable(),
  applicability}).strict().refine((entry)=>Boolean(entry.relation_kind)===Boolean(entry.relation_target_key),
  "relation pair required").refine((entry)=>entry.element_kind!=="locale_variant"
    ||entry.applicability.state==="explicit_locale","locale_variant requires a locale");
const command=z.object({contract_version:z.literal("create-semantic-context-element-v1"),generation_key:key,values}).strict();
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
  const parsed=command.safeParse(await request.json().catch(()=>null));if(!parsed.success)return semanticContextResponse({
    error:"invalid_semantic_context_creation",message:"Element creation input is invalid."},422);
  try{return semanticContextResponse(await createSignalSemanticContextElementProductV1({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,values:parsed.data.values}));}
  catch(error){return semanticContextError(error,"semantic_context_creation_rejected");}
}
