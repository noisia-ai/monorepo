import {loadSignalWorkspaceContextForSemanticContextManagement} from "../../../../../../../semantic-context/_lib";
import {parseTopicRuleSuggestionCommand,topicRuleSuggestionError} from "@/lib/data-os/signal-topic-rule-suggestion-api";
import {topicRuleResponse,topicRuleIdempotencyKey} from "@/lib/data-os/signal-topic-rule-draft-api";
import {saveTopicRuleSuggestionProduct} from "@/lib/data-os/signal-topic-rule-suggestion-product";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{workspaceId:string;candidateKey:string;receiptId:string}>};
export async function POST(request:Request,context:Context){
  const{workspaceId,candidateKey,receiptId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response"in loaded)return loaded.response;
  const idempotencyKey=topicRuleIdempotencyKey(request);
  if(!idempotencyKey)return topicRuleResponse({error:"topic_rule_suggestion_request_invalid"},422);
  let body;try{body=parseTopicRuleSuggestionCommand(await request.json());}
  catch{return topicRuleResponse({error:"topic_rule_suggestion_request_invalid"},422);}
  if(body.candidate_key!==candidateKey||body.receipt_id!==receiptId)return topicRuleResponse({error:"topic_rule_suggestion_scope_mismatch"},422);
  try{return topicRuleResponse(await saveTopicRuleSuggestionProduct({workspace:loaded.workspace,
    actor:loaded.session.appUser,request:body,idempotencyKey}));}catch(error){return topicRuleSuggestionError(error);}
}
