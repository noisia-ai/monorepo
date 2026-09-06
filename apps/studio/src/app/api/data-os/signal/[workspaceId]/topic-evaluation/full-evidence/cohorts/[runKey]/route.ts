import { loadSignalWorkspaceContextForSemanticContextManagement } from "../../../../semantic-context/_lib";
import { topicRuleIdempotencyKey } from "@/lib/data-os/signal-topic-rule-draft-api";
import { parseTopicCohortQuery,topicCohortError,topicCohortResponse } from "@/lib/data-os/signal-topic-rule-cohort-api";
import { topicCohortSaveSchema } from "@/lib/data-os/signal-topic-rule-cohort-management";
import { loadTopicCohortProduct,saveTopicCohortProduct } from "@/lib/data-os/signal-topic-rule-cohort-product";

export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{workspaceId:string;runKey:string}>};
export async function GET(request:Request,context:Context){
  const{workspaceId,runKey}=await context.params,loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  let query;try{query=parseTopicCohortQuery(request.url,runKey);}catch{return topicCohortResponse({error:"topic_rule_cohort_request_invalid"},422);}
  try{return topicCohortResponse(await loadTopicCohortProduct({workspace:loaded.workspace,actor:loaded.session.appUser,runKey,query}));}
  catch(error){return topicCohortError(error);}
}
export async function POST(request:Request,context:Context){
  const{workspaceId,runKey}=await context.params,loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=topicRuleIdempotencyKey(request);if(!idempotencyKey)return topicCohortResponse({error:"topic_rule_cohort_request_invalid"},422);
  let body;try{body=topicCohortSaveSchema.parse(await request.json());}catch{return topicCohortResponse({error:"topic_rule_cohort_request_invalid"},422);}
  if(body.run_key!==runKey)return topicCohortResponse({error:"topic_rule_cohort_scope_mismatch"},422);
  try{return topicCohortResponse(await saveTopicCohortProduct({workspace:loaded.workspace,actor:loaded.session.appUser,runKey,request:body,idempotencyKey}));}
  catch(error){return topicCohortError(error);}
}
