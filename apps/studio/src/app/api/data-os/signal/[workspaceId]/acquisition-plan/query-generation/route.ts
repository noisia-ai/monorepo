import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  generateSignalAcquisitionQueryDraftsProductV1,
  loadSignalAcquisitionQueryGenerationPreflightProductV1
} from "@/lib/data-os/signal-acquisition-query-composer";
import {
  createAnthropicSignalAcquisitionQueryProviderV1,
  loadSignalAcquisitionQueryComposerPlatformConfigurationV1
} from "@/lib/data-os/signal-acquisition-query-provider";
import { SignalAcquisitionPlanError } from "@/lib/data-os/signal-acquisition-plan";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

const cap=z.string().regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u);
const body=z.object({
  source_key:z.string().trim().min(1).max(160),
  hard_cap_usd:cap,
  confirmation:z.literal(true)
}).strict();

export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const loaded=await managed(await context.params);
  if("response" in loaded)return loaded.response;
  const url=new URL(request.url);
  const parsed=z.object({source_key:z.string().trim().min(1).max(160),hard_cap_usd:cap}).safeParse({
    source_key:url.searchParams.get("source_key"),hard_cap_usd:url.searchParams.get("hard_cap_usd")
  });
  if(!parsed.success)return rejected("invalid_query_generation_preflight",422);
  try{
    const configuration=loadSignalAcquisitionQueryComposerPlatformConfigurationV1();
    const result=await loadSignalAcquisitionQueryGenerationPreflightProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser,
      sourceKey:parsed.data.source_key,hardCapUsd:parsed.data.hard_cap_usd,configuration
    });
    return Response.json({...result,runtime:{provider_configured:Boolean(process.env.ANTHROPIC_API_KEY?.trim())}},
      {headers:privateHeaders()});
  }catch(error){return domainError(error,"query_generation_preflight_unavailable");}
}

export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const loaded=await managed(await context.params);
  if("response" in loaded)return loaded.response;
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  if(key.length<8||key.length>500)return rejected("idempotency_key_required",400);
  const parsed=body.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return rejected("invalid_query_generation_command",422);
  const apiKey=process.env.ANTHROPIC_API_KEY?.trim()??"";
  if(!apiKey)return rejected("query_generation_provider_authority_unavailable",503);
  try{
    const configuration=loadSignalAcquisitionQueryComposerPlatformConfigurationV1();
    const result=await generateSignalAcquisitionQueryDraftsProductV1({
      workspace:loaded.workspace,actor:loaded.session.appUser,sourceKey:parsed.data.source_key,
      hardCapUsd:parsed.data.hard_cap_usd,configuration,idempotencyKey:key,
      provider:createAnthropicSignalAcquisitionQueryProviderV1({configuration,apiKey})
    });
    return Response.json(result,{status:201,headers:privateHeaders()});
  }catch(error){return domainError(error,"query_generation_failed");}
}

async function managed(params:{workspaceId:string}){
  const loaded=await loadSignalWorkspaceContextForManagement(params.workspaceId);
  if("response" in loaded)return loaded;
  if(loaded.session.appUser.userType!=="noisia_internal")return{
    response:Response.json({error:"forbidden"},{status:403,headers:privateHeaders()})
  } as const;
  return loaded;
}
function domainError(error:unknown,fallback:string){
  if(error instanceof SignalAcquisitionPlanError)return rejected(error.code,error.status);
  console.error(`[signal-acquisition-query-generation] ${fallback}`,error);
  return rejected(fallback,502);
}
function rejected(error:string,status:number){return Response.json({error,message:error},{status,headers:privateHeaders()});}
function privateHeaders(){return{"Cache-Control":"private, no-store"};}
