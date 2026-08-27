import { z } from "zod";

import { SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS } from "@/lib/data-os/signal-semantic-context-pack";
import { editSignalSemanticContextElementProductV1 } from "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../../../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";
const key=z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const base=z.object({contract_version:z.literal("edit-semantic-context-element-v1"),generation_key:key,
  expected_version:z.number().int().min(1),state_token:z.string().regex(/^sha256:[a-f0-9]{64}$/u)}).strict();
const applicability=z.discriminatedUnion("state",[
  z.object({state:z.enum(["preserve","workspace_inherited","explicit_global"]),locale:z.null()}).strict(),
  z.object({state:z.literal("explicit_locale"),locale:z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u)}).strict()
]);
const values=z.object({display_text:z.string().trim().min(1).max(500),canonical_key:key,
  scope:z.string().trim().max(200).nullable(),relation_kind:z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),
  relation_target_key:key.nullable(),applicability}).strict()
  .refine((entry)=>Boolean(entry.relation_kind)===Boolean(entry.relation_target_key),"relation pair required");
const command=z.discriminatedUnion("action",[
  base.extend({action:z.literal("save"),values}).strict(),
  base.extend({action:z.literal("undo"),target_version:z.number().int().min(1)}).strict(),
  base.extend({action:z.literal("archive")}).strict(),
  base.extend({action:z.literal("restore")}).strict()
]);

export async function POST(request:Request,context:{params:Promise<{workspaceId:string;elementKey:string}>}){
  const params=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  const parsed=command.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_ordinary_command",
    message:"The ordinary element command is invalid."},422);
  try{return semanticContextResponse(await editSignalSemanticContextElementProductV1({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,elementKey:params.elementKey,
    expectedVersion:parsed.data.expected_version,stateToken:parsed.data.state_token,action:parsed.data.action,
    ...("values" in parsed.data?{values:parsed.data.values}:{}),
    ...("target_version" in parsed.data?{targetVersion:parsed.data.target_version}:{})}));}
  catch(error){return semanticContextError(error,"semantic_context_ordinary_command_rejected");}
}
