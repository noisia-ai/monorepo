import { z } from "zod";
import { topicRuleDraftPageSchema,topicRuleDraftSchema,topicRulePendingSchema,topicRuleSpecUiSchema,
  topicRuleFieldsFromSpec,type TopicRuleFields } from "./signal-topic-rule-draft-management";

// Deliberately browser-only: no DB/QE barrel, context, actor, provider or private source IDs.
const digest=z.string().regex(/^sha256:[0-9a-f]{64}$/u),uuid=z.string().uuid(),count=z.number().int().nonnegative();
const run=z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u),candidate=z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u);
const cas={expected_candidate_revision:z.number().int().positive(),expected_candidate_state_token:digest,
  expected_draft_revision:count,expected_draft_digest:digest.nullable()};
const base={run_key:run,candidate_key:candidate,receipt_id:uuid,...cas};
export const topicRuleSuggestionCommandSchema=z.discriminatedUnion("action",[
  z.object({...base,action:z.literal("save"),lexical:topicRuleSpecUiSchema.shape.lexical,filters:topicRuleSpecUiSchema.shape.filters}).strict(),
  z.object({...base,action:z.literal("restore"),restore_draft_id:uuid}).strict()
]).refine(value=>(value.expected_draft_revision===0)===(value.expected_draft_digest===null));
export type TopicRuleSuggestionCommand=z.infer<typeof topicRuleSuggestionCommandSchema>;
const availability=z.object({stored:count.max(12),available:count.max(12),unavailable:count.max(12)}).strict()
  .refine(value=>value.stored===value.available+value.unavailable);
export const topicRuleSuggestionReceiptSchema=z.object({receipt_id:uuid,origin:z.enum(["local_fixture","provider"]),
  status:z.enum(["suggested","insufficient_evidence"]),explanation:z.string().min(1).max(600),
  rule_spec:topicRuleSpecUiSchema.nullable(),run_key:run,candidate_key:candidate,...cas,
  is_stale:z.boolean(),stale_reasons:z.array(z.enum(["candidate_changed","brand_os_changed","evidence_unavailable"])).max(3),
  current_draft:z.object({revision:count,digest:digest.nullable()}).strict(),draft_changed:z.boolean(),evidence:availability,
  latest_link:z.object({link_id:uuid,draft_id:uuid,action:z.enum(["save","restore"])}).strict().nullable(),
  created_at:z.string().datetime()}).strict().superRefine((value,context)=>{
    if((value.status==="suggested")!==(value.rule_spec!==null)||value.is_stale!==(value.stale_reasons.length>0)
      ||(value.current_draft.revision===0)!==(value.current_draft.digest===null)
      ||(value.expected_draft_revision===0)!==(value.expected_draft_digest===null))
      context.addIssue({code:z.ZodIssueCode.custom,message:"topic_rule_suggestion_scope_mismatch"});
  });
export type TopicRuleSuggestionReceipt=z.infer<typeof topicRuleSuggestionReceiptSchema>;
const citation=z.discriminatedUnion("status",[
  z.object({evidence_ref:digest,status:z.literal("available"),excerpt:z.string().min(1).max(600),
    language:z.string().nullable(),market:z.string().nullable(),month:z.string(),scope:z.string().nullable()}).strict(),
  z.object({evidence_ref:digest,status:z.literal("unavailable"),reason:z.enum(["rights_changed","source_changed","reference_unavailable"])}).strict()
]);
export const topicRuleSuggestionPageSchema=z.object({contract_version:z.literal("signal-topic-rule-suggestion-management-v1"),
  page:topicRuleDraftPageSchema,receipt:topicRuleSuggestionReceiptSchema.nullable(),
  citations:z.object({receipt_id:uuid,items:z.array(citation).max(12),availability}).strict().nullable(),
  prior_drafts:z.array(z.object({draft_id:uuid,revision:z.number().int().positive()}).strict()).max(10),
  generation:z.discriminatedUnion("enabled",[
    z.object({enabled:z.literal(false),reason:z.enum(["execution_not_enabled","worker_unavailable"])}).strict(),
    z.object({enabled:z.literal(true),reason:z.literal("ready"),budget_micro_usd:z.number().int().positive().max(1000000)}).strict()
  ])
}).strict().superRefine((value,context)=>{
  const r=value.receipt,p=value.page,c=value.citations;
  if((r&&(r.run_key!==p.run_key||r.candidate_key!==p.candidate_key||r.current_draft.revision!==(p.draft?.revision??0)
      ||r.current_draft.digest!==(p.draft?.draft_digest??null)
      ||(!r.is_stale&&(r.expected_candidate_revision!==p.candidate.revision||r.expected_candidate_state_token!==p.candidate.state_token
        ||(r.rule_spec&&(r.rule_spec.label!==p.candidate.title||r.rule_spec.definition!==p.candidate.description))))))
    ||(c&&(!r||c.receipt_id!==r.receipt_id||c.items.length!==c.availability.stored
      ||c.items.filter(item=>item.status==="available").length!==c.availability.available
      ||new Set(c.items.map(item=>item.evidence_ref)).size!==c.items.length
      ||c.availability.stored!==r.evidence.stored||c.availability.available!==r.evidence.available))
    ||new Set(value.prior_drafts.map(item=>item.draft_id)).size!==value.prior_drafts.length
    ||value.prior_drafts.some(item=>!p.draft||item.revision>=p.draft.revision))
    context.addIssue({code:z.ZodIssueCode.custom,message:"topic_rule_suggestion_scope_mismatch"});
});
export type TopicRuleSuggestionPage=z.infer<typeof topicRuleSuggestionPageSchema>;
export const topicRuleSuggestionBridgeSchema=z.object({link_id:uuid,receipt_id:uuid,action:z.enum(["save","restore"]),
  draft:topicRuleDraftSchema,idempotent_replay:z.boolean()}).strict();
export const topicRuleSuggestionPendingSchema=z.union([topicRulePendingSchema,z.object({kind:z.literal("suggestion"),
  key:z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),scope:z.string().min(1).max(2048),body:topicRuleSuggestionCommandSchema}).strict()]);
export type TopicRuleSuggestionPending=z.infer<typeof topicRuleSuggestionPendingSchema>;
export const topicRuleSuggestionSafeErrors=["topic_rule_suggestion_request_invalid","topic_rule_suggestion_scope_mismatch",
  "topic_rule_suggestion_source_stale","topic_rule_suggestion_draft_stale","topic_rule_suggestion_not_found",
  "topic_rule_suggestion_insufficient_evidence","topic_rule_suggestion_restore_invalid","topic_rule_suggestion_idempotency_conflict",
  "topic_rule_suggestion_forbidden","topic_rule_suggestion_schema_unavailable","topic_rule_suggestion_operation_failed",
  "topic_rule_suggestion_execution_not_enabled","topic_rule_suggestion_execution_experiment_limit",
  "topic_rule_suggestion_execution_source_stale","topic_rule_suggestion_execution_idempotency_conflict",
  "topic_rule_suggestion_execution_not_found","topic_rule_suggestion_execution_forbidden"]as const;
export type TopicRuleSuggestionSafeError=typeof topicRuleSuggestionSafeErrors[number];
export class TopicRuleSuggestionRequestError extends Error{
  constructor(public readonly code:TopicRuleSuggestionSafeError,public readonly ambiguous=false){super(code);}
}
export async function requestTopicRuleSuggestionJson(url:string,init:RequestInit,transport:typeof fetch=fetch){
  let response:Response;try{response=await transport(url,{cache:"no-store",...init});}
  catch{throw new TopicRuleSuggestionRequestError("topic_rule_suggestion_operation_failed",init.method==="POST");}
  const value:unknown=await response.json().catch(()=>null);
  if(!response.ok){const raw=value&&typeof value==="object"&&"error"in value?value.error:undefined;
    const code=topicRuleSuggestionSafeErrors.find(item=>item===raw)
      ??(response.status===401||response.status===403?"topic_rule_suggestion_forbidden":"topic_rule_suggestion_operation_failed");
    throw new TopicRuleSuggestionRequestError(code,init.method==="POST"&&response.status>=500);}
  if(value===null)throw new TopicRuleSuggestionRequestError("topic_rule_suggestion_operation_failed",init.method==="POST");return value;
}
export async function loadTopicRuleSuggestionPage(endpoint:string,run_key:string,candidate_key:string,
  options:{receipt_id?:string;include_citations?:boolean;signal?:AbortSignal}={},transport:typeof fetch=fetch){
  const query=new URLSearchParams({run_key});if(options.receipt_id)query.set("receipt_id",options.receipt_id);
  if(options.include_citations)query.set("include_citations","true");
  const result=topicRuleSuggestionPageSchema.parse(await requestTopicRuleSuggestionJson(`${endpoint}?${query}`,
    {method:"GET",signal:options.signal},transport));
  if(result.page.run_key!==run_key||result.page.candidate_key!==candidate_key
    ||(options.receipt_id&&result.receipt?.receipt_id!==options.receipt_id))
    throw new TopicRuleSuggestionRequestError("topic_rule_suggestion_scope_mismatch");return result;
}
/** Copy is pure and uses only editable rule fields. It never alters candidate identity or sends a request. */
export function topicRuleSuggestionFields(receipt:TopicRuleSuggestionReceipt):TopicRuleFields{
  if(receipt.is_stale||!receipt.rule_spec||receipt.status!=="suggested")throw new Error("topic_rule_suggestion_source_stale");
  return topicRuleFieldsFromSpec(receipt.rule_spec);
}
export function topicRuleSuggestionFormStale(page:TopicRuleSuggestionPage["page"],base:{candidate_revision:number;
  candidate_state_token:string;draft_revision:number;draft_digest:string|null}){
  return page.candidate.revision!==base.candidate_revision||page.candidate.state_token!==base.candidate_state_token
    ||(page.draft?.revision??0)!==base.draft_revision||(page.draft?.draft_digest??null)!==base.draft_digest;
}
