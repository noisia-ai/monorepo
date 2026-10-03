import { loadSignalWorkspaceContextForSemanticContextManagement } from "../../../../../semantic-context/_lib";
import { parseSignalTopicEvaluationV2CandidateDetailQuery } from "@/lib/data-os/signal-topic-evaluation-api";
import { parseTopicRuleDraftSave,topicRuleError,topicRuleIdempotencyKey,topicRuleResponse } from "@/lib/data-os/signal-topic-rule-draft-api";
import { loadTopicRuleDraftProduct,saveTopicRuleDraftProduct } from "@/lib/data-os/signal-topic-rule-draft-product";

export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{workspaceId:string;candidateKey:string}>};
export async function GET(request:Request,context:Context){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let query;try{query=parseSignalTopicEvaluationV2CandidateDetailQuery(request.url);}
  catch{return topicRuleResponse({error:"topic_rule_request_invalid"},422);}
  try{return topicRuleResponse(await loadTopicRuleDraftProduct({workspace:loaded.workspace,
    actor:loaded.session.appUser,runKey:query.run_key,candidateKey}));}catch(error){return topicRuleError(error);}
}
export async function POST(request:Request,context:Context){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=topicRuleIdempotencyKey(request);
  if(!idempotencyKey)return topicRuleResponse({error:"topic_rule_request_invalid"},422);
  let body;try{body=parseTopicRuleDraftSave(await request.json());}
  catch{return topicRuleResponse({error:"topic_rule_request_invalid"},422);}
  if(body.candidate_key!==candidateKey)return topicRuleResponse({error:"topic_rule_scope_mismatch"},422);
  try{return topicRuleResponse(await saveTopicRuleDraftProduct({workspace:loaded.workspace,
    actor:loaded.session.appUser,request:body,idempotencyKey}));}catch(error){return topicRuleError(error);}
}
