import { z } from "zod";

import { SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS } from "@/lib/data-os/signal-semantic-context-pack";
import { mergeSignalSemanticContextElementsProductV2,SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2,
  SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2 } from "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const correction=z.object({canonical_key:key,display_text:z.string().trim().min(1).max(500),
  scope:z.string().trim().max(200).nullable(),locale:z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u).nullable(),
  relation_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),relation_target_key:key.nullable()}).strict();
const annotationResolutions=z.array(z.object({annotation_key:key,
  resolution:z.enum(SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2)}).strict()).max(100)
  .refine((items)=>new Set(items.map((item)=>item.annotation_key)).size===items.length,
    "annotation_key must be unique");
const command=z.object({generation_key:key,target_element_key:key,source_element_keys:z.array(key).min(1).max(100),
  reason:z.enum(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2),rationale:z.string().trim().min(1).max(1000),
  target_correction:correction,target_annotation_resolutions:annotationResolutions.optional()}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",message:"Idempotency-Key is required."},400);
  const parsed=command.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_merge",
    message:"The merge command is invalid."},422);
  try{return semanticContextResponse(await mergeSignalSemanticContextElementsProductV2({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,
    targetElementKey:parsed.data.target_element_key,sourceElementKeys:parsed.data.source_element_keys,
    reason:parsed.data.reason,rationale:parsed.data.rationale,targetCorrection:parsed.data.target_correction,
    targetAnnotationResolutions:parsed.data.target_annotation_resolutions}));}
  catch(error){return semanticContextError(error,"semantic_context_merge_rejected");}
}
