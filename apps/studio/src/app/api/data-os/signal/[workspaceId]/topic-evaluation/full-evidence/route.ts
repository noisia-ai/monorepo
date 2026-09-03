import { loadSignalWorkspaceContextForSemanticContextManagement,requireIdempotencyKey,semanticContextError,
  semanticContextResponse } from "../../semantic-context/_lib";
import { parseSignalTopicEvaluationV2ExecutionStartRequest } from "@/lib/data-os/signal-topic-evaluation-api";
import { loadSignalTopicEvaluationFullEvidencePreflightProductV2,
  startSignalTopicEvaluationFullEvidenceProductV2 }
  from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(_request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  try{return semanticContextResponse(await loadSignalTopicEvaluationFullEvidencePreflightProductV2({
    workspace:loaded.workspace,actor:loaded.session.appUser}));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_preflight_rejected");}
}

/** Disabled by default: only the server-owned UAT configuration can make this closed command live. */
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const{workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=requireIdempotencyKey(request);
  if(!idempotencyKey)return semanticContextResponse({error:"idempotency_key_required",
    message:"Idempotency-Key is required."},400);
  let body;try{body=parseSignalTopicEvaluationV2ExecutionStartRequest(await request.json());}
  catch{return semanticContextResponse({error:"invalid_topic_evaluation_v2_execution_command",
    message:"The full-evidence Topic Evaluation command is invalid."},422);}
  try{return semanticContextResponse(await startSignalTopicEvaluationFullEvidenceProductV2({
    workspace:loaded.workspace,actor:loaded.session.appUser,idempotencyKey,
    expectedSnapshotDigest:body.expected_snapshot_digest,confirmation:body.confirmation}),202);}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_execution_rejected");}
}
