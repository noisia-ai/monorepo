import { z } from "zod";

import { SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS } from "@/lib/data-os/signal-semantic-context-pack";
import { correctSignalSemanticContextElementProductV2,SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2,
  SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2 } from "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const annotationResolutions=z.array(z.object({annotation_key:key,
  resolution:z.enum(SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2)}).strict()).max(100)
  .refine((items)=>new Set(items.map((item)=>item.annotation_key)).size===items.length,
    "annotation_key must be unique");
const command=z.object({generation_key:key,element_key:key,reason:z.enum(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2),
  rationale:z.string().trim().min(1).max(1000),correction:z.object({canonical_key:key,
    display_text:z.string().trim().min(1).max(500),scope:z.string().trim().max(200).nullable(),
    locale:z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u).nullable(),
    relation_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),relation_target_key:key.nullable()}).strict(),
  annotation_resolutions:annotationResolutions.optional()}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",message:"Idempotency-Key is required."},400);
  const parsed=command.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_correction",
    message:"The correction command is invalid."},422);
  try{return semanticContextResponse(await correctSignalSemanticContextElementProductV2({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,
    elementKey:parsed.data.element_key,reason:parsed.data.reason,rationale:parsed.data.rationale,
    correction:parsed.data.correction,annotation_resolutions:parsed.data.annotation_resolutions}));}
  catch(error){return semanticContextError(error,"semantic_context_correction_rejected");}
}
