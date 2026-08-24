import { z } from "zod";

import { annotateSignalSemanticContextElementProductV2,SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2,
  SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_V2,SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2 } from
  "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const command=z.object({generation_key:key,element_key:key,annotation_key:key,
  annotation_type:z.enum(SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_V2),
  reason:z.enum(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2),rationale:z.string().trim().min(1).max(1000),
  related_element_keys:z.array(key).max(100),resolution:z.enum(SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2).optional()}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",message:"Idempotency-Key is required."},400);
  const parsed=command.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_annotation",
    message:"The review annotation command is invalid."},422);
  try{return semanticContextResponse(await annotateSignalSemanticContextElementProductV2({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,
    elementKey:parsed.data.element_key,annotationKey:parsed.data.annotation_key,
    annotationType:parsed.data.annotation_type,reason:parsed.data.reason,rationale:parsed.data.rationale,
    relatedElementKeys:parsed.data.related_element_keys,resolution:parsed.data.resolution}));}
  catch(error){return semanticContextError(error,"semantic_context_annotation_rejected");}
}
