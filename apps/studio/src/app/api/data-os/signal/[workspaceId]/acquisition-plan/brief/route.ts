import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  loadSignalAcquisitionBriefContextProductV1,
  sealSignalAcquisitionBriefFromOperatorProductV1
} from "@/lib/data-os/signal-acquisition-brief-management";
import { SignalAcquisitionPlanError } from "@/lib/data-os/signal-acquisition-plan";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const country=z.string().regex(/^[A-Z]{2}$/u);
const period=z.object({
  start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  end:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
}).strict().refine((value)=>value.start<=value.end,{message:"Capture period is invalid."});
const command=z.object({
  revision_token:z.string().min(32).max(2_000),
  objective:z.string().trim().min(1).max(1_000),
  purpose:z.string().trim().min(1).max(500),
  market_country:country.nullable(),
  countries:z.array(country).min(1).max(100),
  languages:z.array(z.string().trim().min(2).max(20)).min(1).max(100),
  default_capture_period:period.nullable(),
  target_window_months:z.number().int().min(1).max(120).nullable(),
  construction_mode:z.enum(["exploratory","detection"]),
  include_knowledge_context:z.boolean()
}).strict();

export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
  const loaded=await managed(await context.params);
  if("response" in loaded)return loaded.response;
  try{
    const result=await loadSignalAcquisitionBriefContextProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser
    });
    return Response.json(result,{headers:privateHeaders()});
  }catch(error){return domainError(error,"acquisition_brief_unavailable");}
}

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const loaded=await managed(await context.params);
  if("response" in loaded)return loaded.response;
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  if(key.length<8||key.length>500)return rejected("idempotency_key_required",400);
  const parsed=command.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return Response.json({error:"invalid_acquisition_brief",message:"The acquisition brief is invalid.",
    details:parsed.error.flatten()},{status:422,headers:privateHeaders()});
  try{
    const result=await sealSignalAcquisitionBriefFromOperatorProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey:key,input:parsed.data
    });
    return Response.json(result,{headers:privateHeaders()});
  }catch(error){return domainError(error,"acquisition_brief_rejected");}
}

async function managed(params:{workspaceId:string}){
  const loaded=await loadSignalWorkspaceContextForManagement(params.workspaceId);
  if("response" in loaded)return loaded;
  if(loaded.session.appUser.userType!=="noisia_internal")return{
    response:rejected("forbidden",403)
  } as const;
  return loaded;
}
function domainError(error:unknown,fallback:string){
  if(error instanceof SignalAcquisitionPlanError)return rejected(error.code,error.status);
  console.error(`[signal-acquisition-brief] ${fallback}`,error);
  return rejected(fallback,409);
}
function rejected(error:string,status:number){
  return Response.json({error,message:error},{status,headers:privateHeaders()});
}
function privateHeaders(){return{"Cache-Control":"private, no-store"};}
