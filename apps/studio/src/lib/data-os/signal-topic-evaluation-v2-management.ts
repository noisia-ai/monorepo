import { z } from "zod";

const digest=z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key=z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,199}$/u);
const line=z.string().min(1).max(240);

export const signalTopicEvaluationV2ResultOriginSchema=z.object({
  kind:z.literal("imported_result"),source_run_key:key,source_output_digest:digest,
  source_completed_at:z.string().datetime(),imported_at:z.string().datetime(),
  source_provider_calls:z.number().int().min(0).max(12),
  source_cost_micro_usd:z.number().int().min(0).max(20_000_000)
}).strict();

export const signalTopicEvaluationV2CandidateSchema=z.object({
  candidate_key:key,title:z.string().min(1).max(160),description:z.string().min(1).max(1500),
  inclusion:z.array(line).min(1).max(16),exclusion:z.array(line).max(16),
  source_cluster_keys:z.array(key).min(1).max(12),evidence_count:z.number().int().min(1).max(48),
  rank:z.number().int().min(1).max(10).nullable(),review_state:z.enum(["pending","rejected"]),
  revision:z.number().int().positive(),state_token:digest,undo_target_revision:z.number().int().positive().nullable(),
  updated_at:z.string().datetime()
}).strict();

export const signalTopicEvaluationV2CandidatePageSchema=z.object({
  contract_version:z.literal("signal-topic-evaluation-v2-candidate-page-v1"),run_key:key.nullable(),
  items:z.array(signalTopicEvaluationV2CandidateSchema).max(50),total:z.number().int().nonnegative(),
  pending:z.number().int().nonnegative(),rejected:z.number().int().nonnegative(),
  limit:z.number().int().min(1).max(50),next_cursor:z.string().min(16).max(512).nullable(),
  result_origin:signalTopicEvaluationV2ResultOriginSchema.nullable().default(null),
  topic_adoption:z.literal(false),publication:z.literal(false),serving:z.literal(false)
}).strict().superRefine((page,context)=>{
  if(page.pending+page.rejected!==page.total||(page.run_key===null&&page.total!==0)){
    context.addIssue({code:z.ZodIssueCode.custom,message:"topic_evaluation_v2_candidate_counts_invalid"});
  }
});

const evidence=z.object({evidence_ref:digest,explanation_digest:digest,
  retrieval_operation:z.enum(["cluster_catalog","cluster_profile","representative_mentions","search_cluster",
    "compare_clusters","brand_os_context"]),retrieval_index:z.number().int().min(0).max(23)}).strict();

export const signalTopicEvaluationV2RefinementProposalSchema=z.object({
  display_name:z.string().min(1).max(160),description:z.string().min(1).max(1500),
  rationale:z.string().min(1).max(1200),evidence_refs:z.array(digest).min(1).max(48),
  related_candidates:z.array(z.object({candidate_key:key,title:z.string().min(1).max(160)}).strict()).max(8),
  recommendation:z.enum(["none","consider_merge","consider_split"]),proposal_digest:digest,
  created_at:z.string().datetime(),source_revision:z.number().int().positive(),is_stale:z.boolean()
}).strict();

const refinement=z.discriminatedUnion("status",[
  z.object({status:z.literal("unavailable"),proposal:z.null()}).strict(),
  z.object({status:z.literal("none"),proposal:z.null()}).strict(),
  z.object({status:z.literal("available"),proposal:signalTopicEvaluationV2RefinementProposalSchema}).strict()
]);

export const signalTopicEvaluationV2CandidateDetailSchema=z.object({
  contract_version:z.literal("signal-topic-evaluation-v2-candidate-detail-v1"),run_key:key,
  candidate:signalTopicEvaluationV2CandidateSchema.extend({candidate_digest:digest,
    base_model_payload:z.object({candidate_key:key,title:z.string().min(1).max(160),
      description:z.string().min(1).max(1500),inclusion:z.array(line).min(1).max(16),
      exclusion:z.array(line).max(16),explanation:z.string().min(1).max(2000),
      source_cluster_keys:z.array(key).min(1).max(12),evidence_refs:z.array(digest).min(1).max(48),
      status:z.literal("pending")}).strict(),base_model_payload_digest:digest,
    evidence:z.array(evidence).min(1).max(48)}).strict(),
  // A rolling deployment may still return the older detail projection. Never invent a proposal.
  result_origin:signalTopicEvaluationV2ResultOriginSchema.nullable().default(null),
  refinement:refinement.default({status:"unavailable",proposal:null}),topic_adoption:z.literal(false),
  publication:z.literal(false),serving:z.literal(false)
}).strict();

export type SignalTopicEvaluationV2Candidate=z.infer<typeof signalTopicEvaluationV2CandidateSchema>;
export type SignalTopicEvaluationV2CandidatePage=z.infer<typeof signalTopicEvaluationV2CandidatePageSchema>;
export type SignalTopicEvaluationV2CandidateDetail=z.infer<typeof signalTopicEvaluationV2CandidateDetailSchema>;
export type SignalTopicEvaluationV2RefinementProposal=z.infer<typeof signalTopicEvaluationV2RefinementProposalSchema>;

/** Pure unsaved-field projection. The existing editorial command remains the only save path. */
export function copySignalTopicEvaluationV2RefinementWording(args:{
  candidate:SignalTopicEvaluationV2Candidate;proposal:SignalTopicEvaluationV2RefinementProposal;
  fields:{title:string;description:string;inclusion:string;exclusion:string}
}){
  if(args.candidate.review_state!=="pending"||args.proposal.is_stale
    ||args.proposal.source_revision!==args.candidate.revision)return null;
  return{...args.fields,title:args.proposal.display_name,description:args.proposal.description};
}

export function parseSignalTopicEvaluationV2CandidatePage(value:unknown){
  return signalTopicEvaluationV2CandidatePageSchema.parse(value);
}
export function parseSignalTopicEvaluationV2CandidateDetail(value:unknown){
  return signalTopicEvaluationV2CandidateDetailSchema.parse(value);
}
export function createSignalTopicEvaluationV2ReviewIdempotencyKey(){
  return `topic-evaluation-v2:review:${crypto.randomUUID()}`;
}
