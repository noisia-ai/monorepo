import { z } from "zod";
import {
  bulkApproveSignalSemanticContextElementsProductV1,
  decideSignalSemanticContextElementProductV1 } from "@/lib/data-os/signal-semantic-context-pack";
import { rejectSignalSemanticContextElementProductV2,SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2 } from
  "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../_lib";
export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const command=z.discriminatedUnion("action",[
  z.object({action:z.literal("approve"),generation_key:key,element_key:key}).strict(),
  z.object({action:z.literal("reject"),generation_key:key,element_key:key,
    reason:z.enum(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2),
    rationale:z.string().trim().min(1).max(1000)}).strict(),
  z.object({action:z.literal("bulk_approve"),generation_key:key,element_keys:z.array(key).min(1).max(100)}).strict()
]);
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  const raw=await request.json().catch(()=>null);
  if(raw&&typeof raw==="object"&&(raw as{action?:unknown}).action==="edit")return semanticContextResponse({
    error:"semantic_context_edit_v1_retired",
    message:"The legacy edit command is retired. Use the append-only correction endpoint."
  },410);
  const parsed=command.safeParse(raw);
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_decision",
    message:"The semantic context decision is invalid.",details:parsed.error.flatten()},422);
  try{if(parsed.data.action==="bulk_approve")return semanticContextResponse(
    await bulkApproveSignalSemanticContextElementsProductV1({workspace:loaded.workspace,
      actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,
      elementKeys:parsed.data.element_keys}));
    if(parsed.data.action==="reject")return semanticContextResponse(
      await rejectSignalSemanticContextElementProductV2({workspace:loaded.workspace,
        actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,
        elementKey:parsed.data.element_key,reason:parsed.data.reason,rationale:parsed.data.rationale}));
    return semanticContextResponse(await decideSignalSemanticContextElementProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,
      generationKey:parsed.data.generation_key,elementKey:parsed.data.element_key,
      action:"approve"}));}
  catch(error){return semanticContextError(error,"semantic_context_decision_rejected");}
}
