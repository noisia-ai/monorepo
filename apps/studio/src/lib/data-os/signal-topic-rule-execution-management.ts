import {z} from "zod";

const digest=z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key=z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u);
export const topicRuleExecutionRequestSchema=z.object({
  run_key:z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u),
  candidate_key:z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u),
  expected_candidate_revision:z.number().int().positive(),expected_candidate_state_token:digest,
  expected_draft_revision:z.number().int().nonnegative(),expected_draft_digest:digest.nullable()
}).strict().refine(v=>(v.expected_draft_revision===0)===(v.expected_draft_digest===null));
export type TopicRuleExecutionRequest=z.infer<typeof topicRuleExecutionRequestSchema>;
export const topicRuleExecutionSchema=z.object({
  contract_version:z.literal("signal-topic-rule-suggestion-execution-v1"),execution_id:z.string().uuid(),
  workspace_id:z.string().uuid(),run_key:z.string(),candidate_key:z.string(),idempotency_key:key,
  expected_candidate_revision:z.number().int().positive(),expected_candidate_state_token:digest,
  expected_draft_revision:z.number().int().nonnegative(),expected_draft_digest:digest.nullable(),
  status:z.enum(["pending","claimed","completed","definitely_not_sent","outcome_unknown","failed"]),
  receipt_id:z.string().uuid().nullable(),budget_micro_usd:z.number().int().positive().max(1000000),
  cost_micro_usd:z.number().int().nonnegative().nullable(),provider_calls:z.number().int().nonnegative(),
  input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative(),idempotent_replay:z.boolean()
}).strict();
export type TopicRuleExecution=z.infer<typeof topicRuleExecutionSchema>;
export const topicRuleExecutionReadSchema=z.object({execution:topicRuleExecutionSchema.nullable()}).strict();
export const topicRuleExecutionPendingSchema=z.object({scope:z.string(),key,body:topicRuleExecutionRequestSchema}).strict();
export type TopicRuleExecutionPending=z.infer<typeof topicRuleExecutionPendingSchema>;
export function assertTopicRuleExecutionBinding(result:TopicRuleExecution,pending:TopicRuleExecutionPending,workspaceId:string){
  if(result.workspace_id!==workspaceId||result.idempotency_key!==pending.key||Object.entries(pending.body).some(([k,v])=>result[k as keyof TopicRuleExecution]!==v))
    throw new Error("topic_rule_execution_scope_mismatch");
  return result;
}
export function topicRuleExecutionIsActive(value:TopicRuleExecution|null){return value?.status==="pending"||value?.status==="claimed";}
