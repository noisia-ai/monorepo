import { z } from "zod";

// Browser-safe projection only. The server additionally runs the authoritative QE parser.
const digest=z.string().regex(/^sha256:[0-9a-f]{64}$/u),uuid=z.string().uuid();
const runKey=z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u);
const candidateKey=z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u);
const count=z.number().int().nonnegative();
const scope=z.enum(["primary_brand","same_entity","competitor","category","other"]);
const controls=/[\u0000-\u0008\u000e-\u001f\u007f]/u;
const phrase=z.string().min(1).max(160).refine((value)=>!controls.test(value)&&/[\p{L}\p{N}]/u.test(value));
const phrases=z.array(phrase).max(16);
export const topicRuleSpecUiSchema=z.object({contract_version:z.literal("signal-topic-rule-spec-v1"),
  kind:z.literal("topic"),label:z.string().trim().min(1).max(160),definition:z.string().trim().min(1).max(1500),
  lexical:z.object({any:phrases,all:phrases,not:phrases}).strict().superRefine((value,context)=>{
    const positive=value.any.length+value.all.length;
    if(!positive||positive+value.not.length>32)context.addIssue({code:z.ZodIssueCode.custom,message:"invalid_phrases"});
  }),filters:z.object({languages:z.array(z.string().regex(/^[a-z]{2}$/u)).max(16),
    markets:z.array(z.string().regex(/^[A-Z]{2}$/u)).max(16),scopes:z.array(scope).max(16)}).strict()
}).strict();
export type TopicRuleSpecUi=z.infer<typeof topicRuleSpecUiSchema>;
const candidateCas={expected_candidate_revision:z.number().int().positive(),expected_candidate_state_token:digest};
export const topicRuleDraftSaveSchema=z.object({run_key:runKey,candidate_key:candidateKey,...candidateCas,
  expected_draft_revision:count,expected_draft_digest:digest.nullable(),rule_spec:topicRuleSpecUiSchema
}).strict().refine((value)=>(value.expected_draft_revision===0)===(value.expected_draft_digest===null));
export const topicRuleDraftTrialRequestSchema=z.object({run_key:runKey,candidate_key:candidateKey,...candidateCas,
  draft_id:uuid,expected_draft_revision:z.number().int().positive(),expected_draft_digest:digest,
  max_memberships:z.number().int().min(1).max(50000),example_limit:z.number().int().min(0).max(10),
  timeout_ms:z.number().int().min(1).max(15000)}).strict();
export type TopicRuleDraftSave=z.infer<typeof topicRuleDraftSaveSchema>;
export type TopicRuleDraftTrialRequest=z.infer<typeof topicRuleDraftTrialRequestSchema>;

export const topicRuleDraftSchema=z.object({contract_version:z.literal("signal-topic-contract-draft-v1"),
  draft_id:uuid,revision:z.number().int().positive(),draft_digest:digest,predecessor_draft_id:uuid.nullable(),
  rule_spec:topicRuleSpecUiSchema,spec_digest:digest,source:z.object({run_key:runKey,candidate_key:candidateKey,
    revision:z.number().int().positive(),version_digest:digest,snapshot_digest:digest}).strict(),
  created_at:z.string().datetime(),is_stale:z.boolean(),is_latest:z.boolean(),idempotent_replay:z.boolean()}).strict();
export const topicRuleTrialSchema=z.object({contract_version:z.literal("signal-topic-contract-draft-trial-v1"),
  draft_id:uuid,draft_revision:z.number().int().positive(),draft_digest:digest,spec_digest:digest,
  compiler_version:z.literal("signal-topic-rule-simple-fts-v1"),plan_hash:digest,snapshot_digest:digest,
  population_digest:digest,considered_digest:digest,population_kind:z.literal("frozen_snapshot_memberships"),
  counts:z.object({total:count,considered:count,not_tested:count,filter_excluded:count,unavailable:count,
    matched:count,abstained:count}).strict(),max_memberships:z.number().int().min(1).max(50000),
  example_limit:z.number().int().min(0).max(10),timeout_ms:z.number().int().min(1).max(15000),
  examples:z.array(z.object({evidence_ref:digest,outcome:z.enum(["matched","abstained"]),
    excerpt:z.string().max(600),language:z.string().regex(/^[a-z]{2}$/u).nullable(),
    market:z.string().regex(/^[A-Z]{2}$/u).nullable(),scope:scope.nullable(),
    month:z.string().regex(/^20[0-9]{2}-(?:0[1-9]|1[0-2])$/u)}).strict()).max(10),
  example_availability:z.object({stored:count.max(10),available:count.max(10),unavailable:count.max(10)}).strict(),
  topic_adoption:z.literal(false),publication:z.literal(false),serving:z.literal(false),
  trial_id:uuid,created_at:z.string().datetime(),is_stale:z.boolean(),is_latest_draft:z.boolean(),
  idempotent_replay:z.boolean()
}).strict().superRefine((value,context)=>{
  const c=value.counts,a=value.example_availability;
  if(c.considered!==Math.min(c.total,value.max_memberships)||c.not_tested!==c.total-c.considered
    ||c.unavailable+c.filter_excluded+c.matched+c.abstained!==c.considered
    ||a.available+a.unavailable!==a.stored||a.available!==value.examples.length||a.stored>value.example_limit)
    context.addIssue({code:z.ZodIssueCode.custom,message:"invalid_trial_counts"});
});
export const topicRuleDraftPageSchema=z.object({contract_version:z.literal("signal-topic-rule-draft-management-v1"),
  run_key:runKey,candidate_key:candidateKey,candidate:z.object({title:z.string().min(1).max(160),
    description:z.string().min(1).max(1500),revision:z.number().int().positive(),state_token:digest,
    review_state:z.enum(["pending","rejected"])}).strict(),draft:topicRuleDraftSchema.nullable(),
  trial:topicRuleTrialSchema.nullable()
}).strict().superRefine((page,context)=>{
  if((page.draft&&(page.draft.source.run_key!==page.run_key||page.draft.source.candidate_key!==page.candidate_key))
    ||(page.trial&&(!page.draft||page.trial.draft_id!==page.draft.draft_id
      ||page.trial.draft_digest!==page.draft.draft_digest||page.trial.draft_revision!==page.draft.revision)))
    context.addIssue({code:z.ZodIssueCode.custom,message:"topic_rule_scope_mismatch"});
});
export type TopicRuleDraftPage=z.infer<typeof topicRuleDraftPageSchema>;
export type TopicRuleTrial=z.infer<typeof topicRuleTrialSchema>;
export type TopicRuleFields={any:string;all:string;not:string;languages:string;markets:string;scopes:string[]};
export const emptyTopicRuleFields=():TopicRuleFields=>({any:"",all:"",not:"",languages:"",markets:"",scopes:[]});
export function topicRuleFieldsFromSpec(spec:TopicRuleSpecUi):TopicRuleFields{return{
  any:spec.lexical.any.join("\n"),all:spec.lexical.all.join("\n"),not:spec.lexical.not.join("\n"),
  languages:spec.filters.languages.join("\n"),markets:spec.filters.markets.join("\n"),scopes:[...spec.filters.scopes]};}
function lines(value:string){return value.split(/\r?\n/u).map((item)=>item.trim()).filter(Boolean);}
export function topicRuleSpecFromFields(candidate:{title:string;description:string},fields:TopicRuleFields){
  return topicRuleSpecUiSchema.parse({contract_version:"signal-topic-rule-spec-v1",kind:"topic",
    label:candidate.title,definition:candidate.description,
    lexical:{any:lines(fields.any),all:lines(fields.all),not:lines(fields.not)},
    filters:{languages:lines(fields.languages),markets:lines(fields.markets),scopes:fields.scopes}});
}
export const topicRulePendingSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("save"),key:z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),body:topicRuleDraftSaveSchema}).strict(),
  z.object({kind:z.literal("trial"),key:z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),body:topicRuleDraftTrialRequestSchema}).strict()
]);
export type TopicRulePending=z.infer<typeof topicRulePendingSchema>;
export const topicRuleSafeErrors=["topic_rule_request_invalid","topic_rule_scope_mismatch","topic_rule_candidate_stale",
  "topic_rule_draft_stale","topic_rule_draft_source_stale","topic_rule_draft_idempotency_conflict",
  "topic_rule_draft_forbidden","topic_rule_candidate_not_found","topic_rule_draft_not_found",
  "topic_rule_trial_timeout","topic_rule_schema_unavailable","topic_rule_operation_failed"]as const;
export type TopicRuleSafeError=typeof topicRuleSafeErrors[number];
export class TopicRuleRequestError extends Error{
  constructor(public readonly code:TopicRuleSafeError,public readonly ambiguous=false){super(code);}
}
export async function requestTopicRuleJson(url:string,init:RequestInit,transport:typeof fetch=fetch){
  let response:Response;try{response=await transport(url,{cache:"no-store",...init});}
  catch{throw new TopicRuleRequestError("topic_rule_operation_failed",init.method==="POST");}
  const value:unknown=await response.json().catch(()=>null);
  if(!response.ok){const code=value&&typeof value==="object"&&"error" in value?value.error:undefined;
    const safe=topicRuleSafeErrors.find((item)=>item===code)??"topic_rule_operation_failed";
    throw new TopicRuleRequestError(safe,init.method==="POST"&&response.status>=500);}
  if(value===null)throw new TopicRuleRequestError("topic_rule_operation_failed",init.method==="POST");
  return value;
}
export async function loadTopicRuleDraftPage(endpoint:string,run_key:string,candidate_key:string,
  signal?:AbortSignal,transport:typeof fetch=fetch){
  const page=topicRuleDraftPageSchema.parse(await requestTopicRuleJson(
    `${endpoint}?${new URLSearchParams({run_key})}`,{method:"GET",signal},transport));
  if(page.run_key!==run_key||page.candidate_key!==candidate_key)throw new TopicRuleRequestError("topic_rule_scope_mismatch");
  return page;
}
