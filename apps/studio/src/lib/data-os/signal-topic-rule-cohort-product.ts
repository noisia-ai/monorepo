import { createSignalTopicRuleCohortV1,loadSignalTopicRuleCohortV1,loadSignalTopicRuleCohortSourcesV1,
  loadSignalTopicRuleCohortLatestTrialV1,runSignalTopicRuleCohortTrialV1 } from "@noisia/db";
import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "./signal-workspace";
import { withTopicRuleTransaction } from "./signal-topic-rule-draft-product";
import { topicCohortPageSchema,topicCohortStoreSchema,topicCohortTrialSchema,
  type TopicCohortSave,type TopicCohortTrialRequest } from "./signal-topic-rule-cohort-management";

type Context={workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;runKey:string};
function fail():never{throw Object.assign(new Error("topic_rule_cohort_scope_mismatch"),{code:"topic_rule_cohort_scope_mismatch"});}
function actor(value:SignalWorkspaceUser){if(value.userType!=="noisia_internal")
  throw Object.assign(new Error("topic_rule_cohort_forbidden"),{code:"topic_rule_cohort_forbidden"});
  return{id:value.id,user_type:"noisia_internal"as const};}
export async function loadTopicCohortProduct(args:Context&{query:{limit:number;cursor:string|null;selected_candidate_keys:string[]}}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,true,async client=>{
    const context={queryable:client,workspace_id:args.workspace.id,actor:authorized,run_key:args.runKey};
    const sources=await loadSignalTopicRuleCohortSourcesV1({...context,...args.query});
    const cohort=await loadSignalTopicRuleCohortV1(context),trial=await loadSignalTopicRuleCohortLatestTrialV1(context);
    if(cohort&&cohort.binding.workspace_id!==args.workspace.id)fail();
    return topicCohortPageSchema.parse({contract_version:"signal-topic-rule-cohort-management-v1",run_key:args.runKey,sources,cohort,trial});
  });
}
export async function saveTopicCohortProduct(args:Context&{request:TopicCohortSave;idempotencyKey:string}){
  if(args.runKey!==args.request.run_key)fail();const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,false,async client=>{
    const result=topicCohortStoreSchema.parse(await createSignalTopicRuleCohortV1({client,workspace_id:args.workspace.id,
      actor:authorized,idempotency_key:args.idempotencyKey,...args.request}));
    if(result.binding.run_key!==args.runKey||result.binding.workspace_id!==args.workspace.id)fail();
    return result;
  });
}
export async function testTopicCohortProduct(args:Context&{request:TopicCohortTrialRequest;idempotencyKey:string}){
  if(args.runKey!==args.request.run_key)fail();const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,false,async client=>topicCohortTrialSchema.parse(await runSignalTopicRuleCohortTrialV1({
    client,workspace_id:args.workspace.id,actor:authorized,idempotency_key:args.idempotencyKey,...args.request})));
}
