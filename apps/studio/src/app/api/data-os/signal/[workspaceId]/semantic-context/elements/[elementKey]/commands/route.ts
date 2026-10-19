import { signalSemanticContextOrdinaryCommandSchemaV1 }
  from "@/lib/data-os/signal-semantic-context-ordinary-api-contract";
import { editSignalSemanticContextElementProductV1 } from "@/lib/data-os/signal-semantic-context-publication-v2";
import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,
  semanticContextError,semanticContextResponse } from "../../../_lib";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function POST(request:Request,context:{params:Promise<{workspaceId:string;elementKey:string}>}){
  const params=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  const parsed=signalSemanticContextOrdinaryCommandSchemaV1.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return semanticContextResponse({error:"invalid_semantic_context_ordinary_command",
    message:"The ordinary element command is invalid."},422);
  try{return semanticContextResponse(await editSignalSemanticContextElementProductV1({workspace:loaded.workspace,
    actor:loaded.session.appUser,idempotencyKey,generationKey:parsed.data.generation_key,elementKey:params.elementKey,
    expectedVersion:parsed.data.expected_version,stateToken:parsed.data.state_token,action:parsed.data.action,
    ...("values" in parsed.data?{values:parsed.data.values}:{}),
    ...("target_version" in parsed.data?{targetVersion:parsed.data.target_version}:{})}));}
  catch(error){return semanticContextError(error,"semantic_context_ordinary_command_rejected");}
}
