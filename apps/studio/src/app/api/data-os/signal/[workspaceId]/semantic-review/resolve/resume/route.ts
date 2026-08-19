import { z } from "zod";

import { loadSignalWorkspaceContextForStrategicReview } from "../../../../../_lib/load";
import { resumeWorkspaceSemanticResolutionChildV2 } from "@/lib/data-os/signal-semantic-resolution";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const requestSchema=z.object({run_id:z.string().uuid(),child_ordinal:z.number().int().positive()}).strict();

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim();
  if(!idempotencyKey || idempotencyKey.length<8 || idempotencyKey.length>200){
    return json({error:"semantic_resolution_idempotency_key_required",
      message:"Idempotency-Key is required for semantic resolution resume."},400);
  }
  const parsed=requestSchema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return json({error:"invalid_semantic_resolution_resume",
    message:"Semantic resolution resume is invalid."},400);
  try{
    const resumed=await resumeWorkspaceSemanticResolutionChildV2({
      workspaceId:loaded.workspace.id,runId:parsed.data.run_id,
      childOrdinal:parsed.data.child_ordinal,actorUserId:loaded.session.appUser.id,
      idempotencyKey
    });
    return json(resumed,resumed.replayed?200:202);
  }catch(error){
    return json({error:"semantic_resolution_resume_unavailable",
      message:error instanceof Error?error.message:"Unable to resume semantic resolution."},409);
  }
}

function json(payload:unknown,status=200){
  return Response.json(payload,{status,headers:{"Cache-Control":"private, no-store"}});
}
