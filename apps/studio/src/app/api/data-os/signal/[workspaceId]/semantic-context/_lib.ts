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
  semantic_context_terminal_run_successor_required:"This draft already has a terminal run. Prepare a new generation instead of reconciling it as drift.",
  semantic_context_terminal_run_not_eligible:"The terminal run is not eligible for a fresh generation. Preserve it and request technical review.",
  semantic_context_terminal_run_retry_required:"The provider call did not start, so the existing safe retry path must be used.",
  semantic_context_generation_review_required:"This generation contains proposals that must be reviewed instead of regenerated.",
  semantic_context_generation_run_exists:"This generation already has a proposal run. Prepare a new generation before starting another.",
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
  ,topic_evaluation_candidate_not_found:"This Topic Evaluation candidate is no longer available."
  ,topic_evaluation_candidate_stale:"This candidate changed. Refresh before trying again."
  ,topic_evaluation_candidate_idempotency_conflict:"This review key was already used for a different command."
  ,topic_evaluation_candidate_restore_required:"Restore the rejected candidate before editing it."
  ,topic_evaluation_candidate_state_invalid:"This candidate action is not valid in its current state."
  ,topic_evaluation_candidate_undo_target_invalid:"The reversible candidate version changed. Refresh before undoing."
  ,topic_evaluation_candidate_cursor_invalid:"The candidate page changed. Return to the first page."
  ,semantic_context_review_filter_invalid:"One or more review filters are invalid."
  ,semantic_context_review_cursor_invalid:"The review page changed. Return to the first page and try again."
  ,semantic_context_review_element_not_found:"This Semantic Context element is not available in the selected generation."
  ,semantic_context_revalidation_confirmation_required:"Confirm paid-response revalidation before continuing."
  ,semantic_context_paid_response_not_revalidatable:"This paid response cannot be revalidated safely."
  ,semantic_context_paid_response_digest_mismatch:"The stored paid response failed its integrity check."
  ,semantic_context_paid_response_settlement_invalid:"The original paid run settlement is not reconcilable."
  ,semantic_context_paid_response_authority_drift:"Brand OS, Knowledge, locale, or generation authority changed; the paid response remains preserved."
  ,semantic_context_provider_duplicate_semantic_key_conflict:"The paid response contains conflicting proposals for one semantic key; no proposal was saved."
  ,semantic_context_publish_v1_retired:"Semantic Context publication V1 is retired. Refresh and use the sealed V2 preflight."
  ,semantic_context_stale_preflight:"The publication graph changed. Refresh the V2 preflight before publishing."
  ,semantic_context_provider_lineage_drift:"Provider lineage changed. Reconcile the generation before publishing."
  ,semantic_context_merged_terminal:"A merged source is terminal and cannot be edited or reused."
  ,semantic_context_merge_annotation_required:"Every merge source requires an open near-duplicate review annotation to the selected target."
  ,semantic_context_merge_source_annotation_blocked:"Resolve the other open source annotations before merging."
  ,semantic_context_merge_cycle:"This merge would create a direct or transitive cycle."
  ,semantic_context_annotation_resolution_stale:"One or more annotation resolutions are stale. Refresh and try again."
  ,semantic_context_annotation_resolution_confirmation_required:"Confirm the deliberate annotation resolution before continuing."
  ,semantic_context_annotation_repair_confirmation_required:"Confirm the append-only annotation basis repair before continuing."
  ,semantic_context_annotation_repair_not_eligible:"This annotation is not an eligible historical resolution repair. Refresh and review its current history."
  ,semantic_context_annotation_resolution_basis_complete:"This annotation already has a sealed resolution basis and cannot be repaired again."
  ,semantic_context_annotation_not_found:"This review annotation is no longer current. Refresh and try again."
} as Record<string,string>)[code]??"The Semantic Context Pack operation was rejected.";}
function safeError(error:unknown){return error instanceof Error?{name:error.name}:{name:"UnknownError"};}
