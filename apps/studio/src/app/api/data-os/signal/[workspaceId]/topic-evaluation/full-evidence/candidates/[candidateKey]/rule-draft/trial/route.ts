import { loadSignalWorkspaceContextForSemanticContextManagement } from "../../../../../../semantic-context/_lib";
import { parseTopicRuleDraftTrial,topicRuleError,topicRuleIdempotencyKey,topicRuleResponse } from "@/lib/data-os/signal-topic-rule-draft-api";
import { testTopicRuleDraftProduct } from "@/lib/data-os/signal-topic-rule-draft-product";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;candidateKey:string}>}){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=topicRuleIdempotencyKey(request);
  if(!idempotencyKey)return topicRuleResponse({error:"topic_rule_request_invalid"},422);
  let body;try{body=parseTopicRuleDraftTrial(await request.json());}
  catch{return topicRuleResponse({error:"topic_rule_request_invalid"},422);}
  if(body.candidate_key!==candidateKey)return topicRuleResponse({error:"topic_rule_scope_mismatch"},422);
  try{return topicRuleResponse(await testTopicRuleDraftProduct({workspace:loaded.workspace,
    actor:loaded.session.appUser,request:body,idempotencyKey}));}catch(error){return topicRuleError(error);}
}
