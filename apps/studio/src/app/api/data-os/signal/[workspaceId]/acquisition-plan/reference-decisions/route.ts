import { z } from "zod";
import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { decideSignalAcquisitionReferenceV1,withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
const body=z.object({identity_key:z.string().regex(/^reference-sha256-[0-9a-f]{64}$/u),action:z.enum(["include","exclude","revert"]),evidence:z.string().trim().min(1).max(500),effective_from:z.string().datetime({offset:true})}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await context.params;const loaded=await loadSignalWorkspaceContextForManagement(workspaceId);if("response"in loaded)return loaded.response;
 if(loaded.session.appUser.userType!=="noisia_internal")return Response.json({error:"forbidden"},{status:403});
 const key=request.headers.get("Idempotency-Key")?.trim()??"";if(key.length<8||key.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
 const parsed=body.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return Response.json({error:"invalid_reference_decision"},{status:422});
 try{return Response.json(await withSignalAcquisitionTransactionV1((queryable)=>decideSignalAcquisitionReferenceV1({queryable,workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey:key,identityKey:parsed.data.identity_key,action:parsed.data.action,evidence:parsed.data.evidence,effectiveFrom:parsed.data.effective_from})),{status:201,headers:{"Cache-Control":"private, no-store"}});}catch{return Response.json({error:"reference_decision_rejected"},{status:409});}
}
