import { z } from "zod";
import { validateSignalAcquisitionSlotKeyV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { retireSignalAcquisitionSlotV1,withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
const body=z.object({evidence:z.string().trim().min(1).max(500)}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;slotKey:string}>}){
 const params=await context.params;const loaded=await loadSignalWorkspaceContextForManagement(params.workspaceId);if("response"in loaded)return loaded.response;
 if(loaded.session.appUser.userType!=="noisia_internal")return Response.json({error:"forbidden"},{status:403});
 const key=request.headers.get("Idempotency-Key")?.trim()??"";if(key.length<8||key.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
 const parsed=body.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return Response.json({error:"invalid_slot_retirement"},{status:422});
 try{return Response.json(await withSignalAcquisitionTransactionV1((queryable)=>retireSignalAcquisitionSlotV1({queryable,workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey:key,slotKey:validateSignalAcquisitionSlotKeyV1(params.slotKey),evidence:parsed.data.evidence})),{headers:{"Cache-Control":"private, no-store"}});}catch{return Response.json({error:"slot_retirement_rejected"},{status:409});}
}
