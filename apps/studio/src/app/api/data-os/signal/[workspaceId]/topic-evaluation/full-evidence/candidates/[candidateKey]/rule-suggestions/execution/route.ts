import {z} from "zod";
import {loadSignalWorkspaceContextForSemanticContextManagement} from "../../../../../../semantic-context/_lib";
import {topicRuleSuggestionError} from "@/lib/data-os/signal-topic-rule-suggestion-api";
import {topicRuleResponse,topicRuleIdempotencyKey} from "@/lib/data-os/signal-topic-rule-draft-api";
import {topicRuleExecutionRequestSchema} from "@/lib/data-os/signal-topic-rule-execution-management";
import {loadTopicRuleExecutionProduct,launchTopicRuleExecutionProduct} from "@/lib/data-os/signal-topic-rule-execution-product";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{workspaceId:string;candidateKey:string}>};
const querySchema=z.object({run_key:z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u),
  idempotency_key:z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u).optional()}).strict();
export async function GET(request:Request,context:Context){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response"in loaded)return loaded.response;
  const params=new URL(request.url).searchParams;
  const query=querySchema.safeParse(Object.fromEntries(params));
  if(!query.success||new Set(params.keys()).size!==[...params].length)
    return topicRuleResponse({error:"topic_rule_suggestion_request_invalid"},422);
  try{return topicRuleResponse({execution:await loadTopicRuleExecutionProduct({workspace:loaded.workspace,actor:loaded.session.appUser,
    runKey:query.data.run_key,candidateKey,idempotencyKey:query.data.idempotency_key})});}
  catch(error){return topicRuleSuggestionError(error);}
}
export async function POST(request:Request,context:Context){
  const{workspaceId,candidateKey}=await context.params;
  const loaded=await loadSignalWorkspaceContextForSemanticContextManagement(workspaceId);
  if("response"in loaded)return loaded.response;
  const key=topicRuleIdempotencyKey(request),body=topicRuleExecutionRequestSchema.safeParse(await request.json().catch(()=>null));
  if(!key||!body.success||body.data.candidate_key!==candidateKey)
    return topicRuleResponse({error:"topic_rule_suggestion_request_invalid"},422);
  try{return topicRuleResponse(await launchTopicRuleExecutionProduct({workspace:loaded.workspace,actor:loaded.session.appUser,
    request:body.data,idempotencyKey:key}));}
  catch(error){return topicRuleSuggestionError(error);}
}
