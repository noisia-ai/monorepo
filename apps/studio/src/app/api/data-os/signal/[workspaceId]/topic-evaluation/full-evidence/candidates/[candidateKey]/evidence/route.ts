import { loadSignalWorkspaceContextForSemanticContextManagement,semanticContextError,
  semanticContextResponse } from "../../../../../semantic-context/_lib";
import { parseSignalTopicEvaluationV2CandidateEvidenceQuery } from "@/lib/data-os/signal-topic-evaluation-api";
import { parseSignalTopicEvaluationV2CandidateEvidencePage } from "@/lib/data-os/signal-topic-evaluation-v2-management";
import { loadSignalTopicEvaluationV2CandidateEvidenceProduct } from "@/lib/data-os/signal-topic-evaluation";

export const runtime="nodejs";export const dynamic="force-dynamic";

export async function GET(request:Request,context:{params:Promise<{workspaceId:string;candidateKey:string}>}){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let query;try{query=parseSignalTopicEvaluationV2CandidateEvidenceQuery(request.url);}
  catch{return semanticContextResponse({error:"topic_evaluation_v2_candidate_query_invalid",
    message:"The candidate evidence request is invalid."},422);}
  try{return semanticContextResponse(parseSignalTopicEvaluationV2CandidateEvidencePage(
    await loadSignalTopicEvaluationV2CandidateEvidenceProduct({workspace:loaded.workspace,
      actor:loaded.session.appUser,runKey:query.run_key,candidateKey,collection:query.collection,
      limit:query.limit,cursor:query.cursor})));}
  catch(error){return semanticContextError(error,"topic_evaluation_v2_candidate_evidence_rejected");}
}
