import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { SignalSemanticContextPackError } from "@/lib/data-os/signal-semantic-context-pack";

export async function loadSignalWorkspaceContextForSemanticContextManagement(workspaceId:string){
  const loaded=await loadSignalWorkspaceContextForManagement(workspaceId);
  if("response" in loaded)return loaded;
  if(loaded.session.appUser.userType!=="noisia_internal")return{response:semanticContextResponse(
    {error:"forbidden",message:"Semantic Context Pack management requires an internal operator."},403)} as const;
  return loaded;
}

export function semanticContextError(error:unknown,fallback:string){
  if(error instanceof SignalSemanticContextPackError)return semanticContextResponse(
    {error:error.code,message:operatorMessage(error.code)},error.status);
  if(error instanceof Error&&"code" in error&&typeof (error as {code?:unknown}).code==="string"){
    const code=(error as {code:string}).code;const status="status" in error
      &&typeof (error as {status?:unknown}).status==="number"?(error as {status:number}).status:409;
    return semanticContextResponse({error:code,message:operatorMessage(code)},status);
  }
  console.error(`[signal-semantic-context] ${fallback}`,safeError(error));
  return semanticContextResponse({error:fallback,message:"Semantic Context Pack is temporarily unavailable."},409);
}

export function requireIdempotencyKey(request:Request){
  const key=request.headers.get("Idempotency-Key")?.trim()??"";
  return key.length>=8&&key.length<=500?key:null;
}
export function semanticContextResponse(body:unknown,status=200){return Response.json(body,{status,
  headers:{"Cache-Control":"private, no-store"}});}
function operatorMessage(code:string){return({
  semantic_context_draft_exists:"A draft already exists. Finish or reconcile it before creating another.",
  semantic_context_draft_not_found:"The requested draft is not available.",
  semantic_context_generation_not_found:"The requested Semantic Context Pack generation is not available.",
  semantic_context_authority_drift:"Brand OS, Knowledge, or locale authority changed. Create a reconciled generation.",
  semantic_context_reconciliation_reason_mismatch:"The selected reason does not match the current drift. Refresh and try again.",
  semantic_context_proposal_run_active:"Wait for the active proposal run to finish before reconciling context.",
  semantic_context_generation_conflict:"Semantic Context history changed concurrently. Refresh and try again.",
  semantic_context_not_publishable:"Review every pending element and approve at least one element before publishing.",
  semantic_context_forbidden:"You are not authorized to manage this Semantic Context Pack.",
  semantic_context_preflight_drift:"The preflight is stale. Refresh it before confirming generation.",
  semantic_context_hard_cap_insufficient:"The explicit hard cap does not cover the bounded estimate.",
  semantic_context_input_token_budget_exceeded:"The sealed Brand OS and Knowledge context exceeds the configured input-token bound.",
  provider_configuration_unavailable:"The server-owned provider configuration is incomplete.",
  proposal_queue_unavailable:"The proposal queue is unavailable.",
  proposal_worker_unavailable:"The proposal Worker is not ready.",
  proposal_recovery_unavailable:"The proposal recovery drainer is not ready.",
  semantic_context_provider_outcome_ambiguous:"A provider call may have started; automatic retry is blocked to prevent duplicate spend.",
  semantic_context_proposal_run_not_retryable:"This run cannot be retried without risking duplicate spend."
} as Record<string,string>)[code]??"The Semantic Context Pack operation was rejected.";}
function safeError(error:unknown){return error instanceof Error?{name:error.name}:{name:"UnknownError"};}
