import { z } from "zod";
import { SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS,
  bulkApproveSignalSemanticContextElementsProductV1,
  decideSignalSemanticContextElementProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../_lib";
export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const edit=z.object({canonical_key:key,display_text:z.string().trim().min(1).max(500),
  locale:z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u).nullable(),
  relation_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),relation_target_key:key.nullable()}).strict();
const command=z.discriminatedUnion("action",[
  z.object({action:z.enum(["approve","reject"]),generation_key:key,element_key:key}).strict(),
  z.object({action:z.literal("edit"),generation_key:key,element_key:key,edit}).strict(),
  z.object({action:z.literal("bulk_approve"),generation_key:key,element_keys:z.array(key).min(1).max(100)}).strict()
]);
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  const parsed=command.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_decision",
    message:"The semantic context decision is invalid.",details:parsed.error.flatten()},422);
  try{if(parsed.data.action==="bulk_approve")return semanticContextResponse(
    await bulkApproveSignalSemanticContextElementsProductV1({workspace:loaded.workspace,
      actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,
      elementKeys:parsed.data.element_keys}));
    const editInput=parsed.data.action==="edit"?parsed.data.edit:undefined;
    return semanticContextResponse(await decideSignalSemanticContextElementProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,
      generationKey:parsed.data.generation_key,elementKey:parsed.data.element_key,
      action:parsed.data.action,edit:editInput}));}
  catch(error){return semanticContextError(error,"semantic_context_decision_rejected");}
}
