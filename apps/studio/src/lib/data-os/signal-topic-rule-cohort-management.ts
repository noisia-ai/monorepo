import { z } from "zod";
import { topicRuleSpecUiSchema } from "./signal-topic-rule-draft-management";

// Browser-safe DTOs only: authority, compilation and current rights stay in the DB core.
const digest=z.string().regex(/^sha256:[0-9a-f]{64}$/u),uuid=z.string().uuid();
export const topicCohortRunKeySchema=z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u);
const key=z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u),count=z.number().int().nonnegative();
const positive=z.number().int().positive(),staleReasons=z.array(z.enum(["source_changed","snapshot_changed","profile_changed"])).max(3);
const cas={expected_cohort_revision:count,expected_cohort_digest:digest.nullable()};
export const topicCohortSelectionSchema=z.object({candidate_key:key,draft_id:uuid,
  expected_candidate_revision:positive,expected_candidate_state_token:digest,
  expected_draft_revision:positive,expected_draft_digest:digest}).strict();
export type TopicCohortSelection=z.infer<typeof topicCohortSelectionSchema>;
const selections=z.array(topicCohortSelectionSchema).min(2).max(15).refine((rows)=>
  new Set(rows.map(row=>row.candidate_key)).size===rows.length&&new Set(rows.map(row=>row.draft_id)).size===rows.length);
export const topicCohortSaveSchema=z.object({run_key:topicCohortRunKeySchema,...cas,sources:selections}).strict()
  .refine(value=>(value.expected_cohort_revision===0)===(value.expected_cohort_digest===null));
export const topicCohortTrialRequestSchema=z.object({run_key:topicCohortRunKeySchema,
  expected_cohort_revision:positive,expected_cohort_digest:digest,max_memberships:positive.max(50000),
  example_limit:count.max(10),timeout_ms:positive.max(15000)}).strict();
export type TopicCohortSave=z.infer<typeof topicCohortSaveSchema>;
export type TopicCohortTrialRequest=z.infer<typeof topicCohortTrialRequestSchema>;
const sourceSchema=z.object({candidate_key:key,title:z.string().min(1).max(160),description:z.string().min(1).max(1500),
  inclusion:z.array(z.string().min(1).max(240)).min(1).max(16),exclusion:z.array(z.string().min(1).max(240)).max(16),
  revision:positive,state_token:digest,review_state:z.enum(["pending","rejected"]),draft:z.object({draft_id:uuid,
    revision:positive,draft_digest:digest,spec_digest:digest,is_stale:z.boolean()}).strict().nullable(),
  eligibility:z.enum(["eligible","missing_draft","stale_draft","rejected"])}).strict().refine(value=>
  value.eligibility===(value.review_state==="rejected"?"rejected":!value.draft?"missing_draft":value.draft.is_stale?"stale_draft":"eligible"));
export type TopicCohortSource=z.infer<typeof sourceSchema>;
export const topicCohortSourcesSchema=z.object({contract_version:z.literal("signal-topic-rule-cohort-sources-v1"),
  run_key:topicCohortRunKeySchema,snapshot_digest:digest,total:count,limit:positive.max(20),items:z.array(sourceSchema).max(20),
  next_cursor:z.string().min(1).max(2048).nullable(),selected:z.array(sourceSchema).max(15),
  missing_selected_candidate_keys:z.array(key).max(15)}).strict();
const bindingRule=z.object({candidate_id:uuid,candidate_key:key,candidate_revision:positive,candidate_version_digest:digest,
  candidate_state_token:digest,draft_id:uuid,draft_revision:positive,draft_digest:digest,spec_digest:digest,rule_spec:topicRuleSpecUiSchema}).strict();
export const topicCohortStoreSchema=z.object({contract_version:z.literal("signal-topic-rule-cohort-store-v1"),
  cohort_id:uuid,cohort_revision:positive,cohort_digest:digest,profile_id:uuid,profile_version:positive,
  binding:z.object({run_id:uuid,snapshot_id:uuid,snapshot_digest:digest,population_digest:digest,rights_digest:digest,
    semantic_context_authority_digest:digest,artifact_binding_digest:digest,workspace_id:uuid,run_key:topicCohortRunKeySchema,
    cohort_revision:positive,predecessor_digest:digest.nullable(),rules:z.array(bindingRule).min(2).max(15)}).strict(),
  created_at:z.string().datetime(),is_stale:z.boolean(),stale_reasons:staleReasons,is_latest:z.boolean(),idempotent_replay:z.boolean()
}).strict().refine(value=>value.binding.cohort_revision===value.cohort_revision
  &&new Set(value.binding.rules.map(row=>row.candidate_key)).size===value.binding.rules.length);
export type TopicCohortStore=z.infer<typeof topicCohortStoreSchema>;
export const topicCohortTrialSchema=z.object({contract_version:z.literal("signal-topic-rule-cohort-trial-v1"),
  cohort_id:uuid,cohort_revision:positive,cohort_digest:digest,profile_id:uuid,profile_version:positive,
  compiler_version:z.literal("signal-topic-rule-cohort-simple-fts-v1"),plan_hash:digest,
  rule_plans:z.array(z.object({candidate_key:key,spec_digest:digest,plan_hash:digest,compiler_version:z.literal("signal-topic-rule-simple-fts-v1")}).strict()).min(2).max(15),
  snapshot_digest:digest,population_digest:digest,considered_digest:digest,population_kind:z.literal("frozen_snapshot_memberships"),
  counts:z.object({total:count,considered:count,not_tested:count,unavailable:count,excluded_by_all_filters:count,
    abstained:count,single_match:count,multiple_match:count,covered:count}).strict(),
  per_rule:z.array(z.object({candidate_key:key,matched:count,exclusive:count,shared:count}).strict()).min(2).max(15),
  pairs:z.array(z.object({left_candidate_key:key,right_candidate_key:key,intersection:count}).strict()).max(105),
  max_memberships:positive.max(50000),example_limit:count.max(10),timeout_ms:positive.max(15000),
  examples:z.array(z.object({evidence_ref:digest,outcome:z.enum(["abstained","single_match","multiple_match"]),
    matched_candidate_keys:z.array(key).max(15),excerpt:z.string().max(600),language:z.string().regex(/^[a-z]{2}$/u).nullable(),
    market:z.string().regex(/^[A-Z]{2}$/u).nullable(),scope:z.enum(["primary_brand","same_entity","competitor","category","other"]).nullable(),
    month:z.string().regex(/^20[0-9]{2}-(?:0[1-9]|1[0-2])$/u)}).strict()).max(10),
  topic_adoption:z.literal(false),publication:z.literal(false),serving:z.literal(false),trial_id:uuid,created_at:z.string().datetime(),
  is_stale:z.boolean(),stale_reasons:staleReasons,is_latest_cohort:z.boolean(),idempotent_replay:z.boolean(),
  example_availability:z.object({stored:count.max(10),available:count.max(10),unavailable:count.max(10)}).strict()
}).strict().superRefine((value,context)=>{
  const c=value.counts,a=value.example_availability,keys=value.rule_plans.map(row=>row.candidate_key);
  if(c.considered!==Math.min(c.total,value.max_memberships)||c.not_tested!==c.total-c.considered
    ||c.unavailable+c.excluded_by_all_filters+c.abstained+c.single_match+c.multiple_match!==c.considered
    ||c.covered!==c.single_match+c.multiple_match||a.available+a.unavailable!==a.stored
    ||a.available!==value.examples.length||a.stored>value.example_limit||new Set(keys).size!==keys.length
    ||value.per_rule.length!==keys.length||new Set(value.per_rule.map(row=>row.candidate_key)).size!==keys.length
    ||value.per_rule.some(row=>!keys.includes(row.candidate_key)||row.matched!==row.exclusive+row.shared||row.matched>c.covered)
    ||value.pairs.length!==keys.length*(keys.length-1)/2
    ||new Set(value.pairs.map(row=>[row.left_candidate_key,row.right_candidate_key].sort().join("|"))).size!==value.pairs.length
    ||value.pairs.some(row=>row.left_candidate_key===row.right_candidate_key||!keys.includes(row.left_candidate_key)
      ||!keys.includes(row.right_candidate_key)||row.intersection>c.multiple_match)
    ||value.examples.some(row=>row.matched_candidate_keys.some(item=>!keys.includes(item))
      ||new Set(row.matched_candidate_keys).size!==row.matched_candidate_keys.length
      ||(row.outcome==="abstained"?row.matched_candidate_keys.length!==0:
        row.outcome==="single_match"?row.matched_candidate_keys.length!==1:row.matched_candidate_keys.length<2)))
    context.addIssue({code:z.ZodIssueCode.custom,message:"invalid_cohort_trial"});
});
export type TopicCohortTrial=z.infer<typeof topicCohortTrialSchema>;
export const topicCohortPageSchema=z.object({contract_version:z.literal("signal-topic-rule-cohort-management-v1"),
  run_key:topicCohortRunKeySchema,sources:topicCohortSourcesSchema,cohort:topicCohortStoreSchema.nullable(),
  trial:topicCohortTrialSchema.nullable()}).strict().superRefine((page,context)=>{
  if(page.sources.run_key!==page.run_key||(page.cohort&&(page.cohort.binding.run_key!==page.run_key||!page.cohort.is_latest))
    ||(page.trial&&(!page.cohort||page.trial.cohort_id!==page.cohort.cohort_id
      ||page.trial.cohort_revision!==page.cohort.cohort_revision||page.trial.cohort_digest!==page.cohort.cohort_digest
      ||!page.trial.is_latest_cohort)))context.addIssue({code:z.ZodIssueCode.custom,message:"topic_rule_cohort_scope_mismatch"});
});
export type TopicCohortPage=z.infer<typeof topicCohortPageSchema>;
export function cohortSelectionFromSource(source:TopicCohortSource):TopicCohortSelection|null{
  if(source.eligibility!=="eligible"||!source.draft)return null;
  return{candidate_key:source.candidate_key,draft_id:source.draft.draft_id,expected_candidate_revision:source.revision,
    expected_candidate_state_token:source.state_token,expected_draft_revision:source.draft.revision,expected_draft_digest:source.draft.draft_digest};
}
export function cohortSelectionFromStore(store:TopicCohortStore|null):TopicCohortSelection[]{return store?.binding.rules.map(row=>({
  candidate_key:row.candidate_key,draft_id:row.draft_id,expected_candidate_revision:row.candidate_revision,
  expected_candidate_state_token:row.candidate_state_token,expected_draft_revision:row.draft_revision,expected_draft_digest:row.draft_digest}))??[];}
export function cohortSelectionEqual(a:TopicCohortSelection[],b:TopicCohortSelection[]){
  const normalized=(rows:TopicCohortSelection[])=>[...rows].sort((x,y)=>x.candidate_key.localeCompare(y.candidate_key))
    .map(row=>[row.candidate_key,row.draft_id,row.expected_candidate_revision,row.expected_candidate_state_token,row.expected_draft_revision,row.expected_draft_digest]);
  return JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
}
export function cohortSelectionIsCurrent(selected:TopicCohortSelection,current:TopicCohortSource|undefined){
  const next=current&&cohortSelectionFromSource(current);return!!next&&cohortSelectionEqual([selected],[next]);
}
export const topicCohortPendingSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("save"),key:z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),body:topicCohortSaveSchema}).strict(),
  z.object({kind:z.literal("trial"),key:z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),body:topicCohortTrialRequestSchema}).strict()
]);
export type TopicCohortPending=z.infer<typeof topicCohortPendingSchema>;
export function parseTopicCohortMutationResult(value:unknown,operation:TopicCohortPending,workspaceId:string){
  if(operation.kind==="save"){
    const result=topicCohortStoreSchema.parse(value);
    if(result.binding.run_key!==operation.body.run_key||result.binding.workspace_id!==workspaceId
      ||result.cohort_revision!==operation.body.expected_cohort_revision+1
      ||!cohortSelectionEqual(cohortSelectionFromStore(result),operation.body.sources))throw new Error("topic_rule_cohort_scope_mismatch");
    return result;
  }
  const result=topicCohortTrialSchema.parse(value);
  if(result.cohort_revision!==operation.body.expected_cohort_revision||result.cohort_digest!==operation.body.expected_cohort_digest
    ||result.max_memberships!==operation.body.max_memberships||result.example_limit!==operation.body.example_limit
    ||result.timeout_ms!==operation.body.timeout_ms)throw new Error("topic_rule_cohort_scope_mismatch");
  return result;
}
export const topicCohortSafeErrors=["topic_rule_cohort_request_invalid","topic_rule_cohort_scope_mismatch",
  "topic_rule_cohort_selection_invalid","topic_rule_cohort_selection_duplicate","topic_rule_cohort_run_not_found",
  "topic_rule_cohort_source_stale","topic_rule_cohort_draft_stale","topic_rule_cohort_draft_digest_invalid",
  "topic_rule_cohort_idempotency_conflict","topic_rule_cohort_stale","topic_rule_cohort_not_found",
  "topic_rule_cohort_limits_invalid","topic_rule_cohort_sources_query_invalid","topic_rule_cohort_sources_cursor_invalid",
  "topic_rule_cohort_forbidden","topic_rule_cohort_trial_timeout","topic_rule_cohort_schema_unavailable","topic_rule_cohort_operation_failed"]as const;
export type TopicCohortSafeError=typeof topicCohortSafeErrors[number];
export class TopicCohortRequestError extends Error{
  constructor(public readonly code:TopicCohortSafeError,public readonly ambiguous=false){super(code);}
}
export async function requestTopicCohortJson(url:string,init:RequestInit,transport:typeof fetch=fetch){
  let response:Response;try{response=await transport(url,{cache:"no-store",...init});}
  catch{throw new TopicCohortRequestError("topic_rule_cohort_operation_failed",init.method==="POST");}
  const value:unknown=await response.json().catch(()=>null);
  if(!response.ok){const code=value&&typeof value==="object"&&"error" in value?value.error:undefined;
    const safe=code==="forbidden"&&response.status===403?"topic_rule_cohort_forbidden":
      topicCohortSafeErrors.find(item=>item===code)??"topic_rule_cohort_operation_failed";
    throw new TopicCohortRequestError(safe,init.method==="POST"&&(response.status>=500||safe==="topic_rule_cohort_operation_failed"));}
  if(value===null)throw new TopicCohortRequestError("topic_rule_cohort_operation_failed",init.method==="POST");
  return value;
}
export async function loadTopicCohortPage(url:string,workspaceId:string,runKey:string,selectedKeys:string[],cursor:string|null,
  signal?:AbortSignal,transport:typeof fetch=fetch){
  const query=new URLSearchParams({limit:"20"});if(cursor)query.set("cursor",cursor);
  selectedKeys.forEach(value=>query.append("selected_candidate_key",value));
  const page=topicCohortPageSchema.parse(await requestTopicCohortJson(`${url}?${query}`,{method:"GET",signal},transport));
  const refreshed=[...page.sources.selected.map(row=>row.candidate_key),...page.sources.missing_selected_candidate_keys];
  if(page.run_key!==runKey||(page.cohort&&page.cohort.binding.workspace_id!==workspaceId)
    ||refreshed.length!==selectedKeys.length||new Set(refreshed).size!==refreshed.length
    ||refreshed.some(key=>!selectedKeys.includes(key)))throw new TopicCohortRequestError("topic_rule_cohort_scope_mismatch");
  return page;
}
