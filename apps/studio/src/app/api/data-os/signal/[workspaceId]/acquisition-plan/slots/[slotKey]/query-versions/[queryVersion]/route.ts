import { z } from "zod";

import { validateSignalAcquisitionSlotKeyV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { loadSignalAcquisitionQueryDraftDetailProductV1 } from
  "@/lib/data-os/signal-acquisition-query-composer";
import {
  reviewSignalAcquisitionQueryVersionV1,
  SignalAcquisitionPlanError,
  withSignalAcquisitionTransactionV1
} from "@/lib/data-os/signal-acquisition-plan";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const review=z.object({
  decision:z.enum(["approved","rejected"]),
  evidence:z.string().trim().min(1).max(500)
}).strict();

export async function GET(_request:Request,context:{params:Promise<{
  workspaceId:string;slotKey:string;queryVersion:string;
}>}){
  const params=await context.params;const loaded=await managed(params.workspaceId);
  if("response" in loaded)return loaded.response;
  try{
    const slotKey=validateSignalAcquisitionSlotKeyV1(params.slotKey);
    const queryVersion=z.coerce.number().int().positive().parse(params.queryVersion);
    const result=await loadSignalAcquisitionQueryDraftDetailProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser,slotKey,queryVersion});
    return Response.json(result,{headers:privateHeaders()});
  }catch(error){return domainError(error,"query_detail_unavailable");}
}

export async function POST(request:Request,context:{params:Promise<{
  workspaceId:string;slotKey:string;queryVersion:string;
}>}){
  const params=await context.params;const loaded=await managed(params.workspaceId);
  if("response" in loaded)return loaded.response;
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  if(key.length<8||key.length>500)return rejected("idempotency_key_required",400);
  const parsed=review.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return rejected("invalid_query_review",422);
  try{
    const slotKey=validateSignalAcquisitionSlotKeyV1(params.slotKey);
    const queryVersion=z.coerce.number().int().positive().parse(params.queryVersion);
    const result=await withSignalAcquisitionTransactionV1((queryable)=>(
      reviewSignalAcquisitionQueryVersionV1({queryable,workspace:loaded.workspace,
        actor:loaded.session.appUser,idempotencyKey:key,slotKey,queryVersion,...parsed.data})
    ));
    return Response.json(result,{status:201,headers:privateHeaders()});
  }catch(error){return domainError(error,"query_review_rejected");}
}

async function managed(workspaceId:string){
  const loaded=await loadSignalWorkspaceContextForManagement(workspaceId);
  if("response" in loaded)return loaded;
  if(loaded.session.appUser.userType!=="noisia_internal")return{
    response:Response.json({error:"forbidden"},{status:403,headers:privateHeaders()})
  } as const;
  return loaded;
}
function domainError(error:unknown,fallback:string){
  if(error instanceof SignalAcquisitionPlanError)return rejected(error.code,error.status);
  return rejected(fallback,409);
}
function rejected(error:string,status:number){return Response.json({error,message:error},{status,headers:privateHeaders()});}
function privateHeaders(){return{"Cache-Control":"private, no-store"};}
