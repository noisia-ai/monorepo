import { validateSignalAcquisitionQueryVersionInputV1,validateSignalAcquisitionSlotKeyV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { createSignalAcquisitionQueryVersionV1,withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";

export async function POST(request:Request,context:{params:Promise<{workspaceId:string;slotKey:string}>}){
  const params=await context.params;const loaded=await loadSignalWorkspaceContextForManagement(params.workspaceId);
  if("response" in loaded)return loaded.response;if(loaded.session.appUser.userType!=="noisia_internal")return Response.json({error:"forbidden"},{status:403});
  const key=request.headers.get("Idempotency-Key")?.trim()??"";if(key.length<8||key.length>500)return Response.json({error:"idempotency_key_required"},{status:400});
  try{const slotKey=validateSignalAcquisitionSlotKeyV1(params.slotKey);const input=validateSignalAcquisitionQueryVersionInputV1(await request.json());
    return Response.json(await withSignalAcquisitionTransactionV1((queryable)=>createSignalAcquisitionQueryVersionV1({
      queryable,workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey:key,slotKey,input
    })),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch{return Response.json({error:"acquisition_query_rejected",message:"The query version could not be created from the current draft."},{status:409});}
}
