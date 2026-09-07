import {launchSignalTopicRuleSuggestionExecutionV1,loadSignalTopicRuleSuggestionExecutionV1} from "@noisia/db";
import type {ResolvedSignalWorkspace,SignalWorkspaceUser} from "./signal-workspace";
import {withTopicRuleTransaction} from "./signal-topic-rule-draft-product";
import {topicRuleExecutionSchema,type TopicRuleExecutionRequest} from "./signal-topic-rule-execution-management";
import {getDataOsQueue,loadDataOsRuntimeReadiness} from "@/lib/queue/data-os";

type Context={workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser};
function actor(value:SignalWorkspaceUser){if(value.userType!=="noisia_internal")
  throw Object.assign(new Error("topic_rule_suggestion_forbidden"),{code:"topic_rule_suggestion_forbidden"});
  return{id:value.id,user_type:"noisia_internal"as const};}
export function topicRuleExecutionConfiguration(env:Record<string,string|undefined>=process.env){
  const budget=Number(env.NOISIA_TOPIC_RULE_SUGGESTION_BUDGET_MICRO_USD);
  const workspace=env.NOISIA_TOPIC_RULE_SUGGESTION_WORKSPACE_ID,run=env.NOISIA_TOPIC_RULE_SUGGESTION_RUN_KEY,
    candidate=env.NOISIA_TOPIC_RULE_SUGGESTION_CANDIDATE_KEY;
  const enabled=env.NOISIA_TOPIC_RULE_SUGGESTION_ENABLED==="true"&&env.NOISIA_RUNTIME_PROFILE==="uat"
    &&Number.isSafeInteger(budget)&&budget>0&&budget<=1000000&&!!workspace&&!!run&&!!candidate;
  return{enabled,budget_micro_usd:enabled?budget:0,workspace,run,candidate};
}
export async function topicRuleExecutionCapability(scope:{workspace:string;run:string;candidate:string}){
  const config=topicRuleExecutionConfiguration();
  if(!config.enabled||config.workspace!==scope.workspace||config.run!==scope.run||config.candidate!==scope.candidate)
    return{enabled:false as const,reason:"execution_not_enabled" as const};
  const ready=await loadDataOsRuntimeReadiness();
  return ready.queue_configured&&ready.worker_alive
    ?{enabled:true as const,reason:"ready"as const,budget_micro_usd:config.budget_micro_usd}
    :{enabled:false as const,reason:"worker_unavailable"as const};
}
export async function loadTopicRuleExecutionProduct(args:Context&{runKey:string;candidateKey:string;idempotencyKey?:string}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,true,async client=>{
    const row=await loadSignalTopicRuleSuggestionExecutionV1({queryable:client,workspace_id:args.workspace.id,actor:authorized,
      run_key:args.runKey,candidate_key:args.candidateKey,idempotency_key:args.idempotencyKey});
    return row?topicRuleExecutionSchema.parse(row):null;
  });
}
export async function launchTopicRuleExecutionProduct(args:Context&{request:TopicRuleExecutionRequest;idempotencyKey:string}){
  const authorized=actor(args.actor),capability=await topicRuleExecutionCapability({workspace:args.workspace.id,
    run:args.request.run_key,candidate:args.request.candidate_key});
  if(!capability.enabled)throw Object.assign(new Error("topic_rule_suggestion_execution_not_enabled"),
    {code:"topic_rule_suggestion_execution_not_enabled"});
  const{pool}=await import("@/lib/db");
  const row=await withTopicRuleTransaction(pool,false,async client=>topicRuleExecutionSchema.parse(
    await launchSignalTopicRuleSuggestionExecutionV1({client,workspace_id:args.workspace.id,actor:authorized,
      ...args.request,idempotency_key:args.idempotencyKey,budget_micro_usd:capability.budget_micro_usd})));
  // The committed execution is also the durable dispatch pending. Same-key recovery uses the same job ID.
  if(row.status==="pending"){
    const queue=getDataOsQueue(),existing=await queue.getJob(row.execution_id);
    // Manual same-request recovery can restart a job that failed BEFORE its durable claim.
    // A claimed/terminal execution never reaches this path; DB claim remains the provider boundary.
    if(existing&&await existing.getState()==="failed")await existing.retry("failed");
    else await queue.add("signal-topic-rule-suggestion-v1",{execution_id:row.execution_id},
      {jobId:row.execution_id,attempts:1,removeOnComplete:false,removeOnFail:false});
  }
  return row;
}
