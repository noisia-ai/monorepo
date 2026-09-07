import {loadSignalWorkspaceContextForSemanticContextManagement} from "../../../../../semantic-context/_lib";
import {parseTopicRuleSuggestionQuery,topicRuleSuggestionError} from "@/lib/data-os/signal-topic-rule-suggestion-api";
import {topicRuleResponse} from "@/lib/data-os/signal-topic-rule-draft-api";
import {loadTopicRuleSuggestionProduct} from "@/lib/data-os/signal-topic-rule-suggestion-product";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{workspaceId:string;candidateKey:string}>};
export async function GET(request:Request,context:Context){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response"in loaded)return loaded.response;
  let query;try{query=parseTopicRuleSuggestionQuery(request.url);}catch{return topicRuleResponse({error:"topic_rule_suggestion_request_invalid"},422);}
  try{return topicRuleResponse(await loadTopicRuleSuggestionProduct({workspace:loaded.workspace,actor:loaded.session.appUser,
    runKey:query.run_key,candidateKey,receiptId:query.receipt_id,includeCitations:query.include_citations==="true"}));}
  catch(error){return topicRuleSuggestionError(error);}
}
