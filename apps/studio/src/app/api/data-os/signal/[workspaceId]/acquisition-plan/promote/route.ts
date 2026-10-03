import { z } from "zod";
import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { promoteSignalAcquisitionPlanV1,withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";

const body = z.object({
  expected_draft_version:z.number().int().positive(),expected_draft_revision:z.number().int().nonnegative(),
  expected_draft_digest:z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  effective_from:z.string().datetime({ offset:true }),evidence:z.string().trim().min(1).max(500)
}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await context.params;const loaded=await loadSignalWorkspaceContextForManagement(workspaceId);
  if("response" in loaded)return loaded.response;if(loaded.session.appUser.userType!=="noisia_internal")return Response.json({error:"forbidden"},{status:403});
  const key=request.headers.get("Idempotency-Key")?.trim()??"";if(key.length<8||key.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
  const parsed=body.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return Response.json({error:"invalid_acquisition_promotion",details:parsed.error.flatten()},{status:422});
  try{return Response.json(await withSignalAcquisitionTransactionV1((queryable)=>promoteSignalAcquisitionPlanV1({
    queryable,workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey:key,
    expectedDraftVersion:parsed.data.expected_draft_version,expectedDraftRevision:parsed.data.expected_draft_revision,
    expectedDraftDigest:parsed.data.expected_draft_digest,effectiveFrom:parsed.data.effective_from,evidence:parsed.data.evidence
  })),{headers:{"Cache-Control":"private, no-store"}});}catch{return Response.json({error:"acquisition_promotion_rejected"},{status:409});}
}
