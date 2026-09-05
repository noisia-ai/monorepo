import { z } from "zod";

export const SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT =
  "signal-topic-candidate-refinement-v1" as const;

export const SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS = Object.freeze({
  session_lifetime_seconds: 15 * 60,
  max_navigation_calls: 12,
  max_tool_result_bytes: 32_768,
  max_total_tool_result_bytes: 196_608,
  search_page_limit: 20,
  representative_limit: 12,
  related_candidate_limit: 8,
  evidence_ref_limit: 48
} as const);

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key = z.string().min(1).max(180).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const cursor = z.string().min(16).max(512);
const boundedFilters = z.object({
  language: z.string().regex(/^[a-z]{2}$/u).optional(),
  market: z.string().regex(/^[A-Z]{2}$/u).optional(),
  scope: z.enum(["primary_brand", "same_entity", "competitor", "category", "other"]).optional(),
  month_from: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  month_to: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  query: z.string().min(2).max(80).regex(/^[\p{L}\p{N}\s'’._-]+$/u).optional()
}).strict();

export const signalTopicCandidateRefinementSessionStartSchemaV1 = z.object({
  run_key: key,
  candidate_key: key,
  expected_revision: z.number().int().positive(),
  state_token: digest
}).strict();

export const signalTopicCandidateRefinementNavigationRequestSchemaV1 = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("candidate_context") }).strict(),
  z.object({ operation: z.literal("cluster_profile"), cluster_key: key }).strict(),
  z.object({ operation: z.literal("representative_mentions"), cluster_key: key,
    limit: z.number().int().min(3).max(SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.representative_limit),
    filters: boundedFilters }).strict(),
  z.object({ operation: z.literal("search_cluster"), cluster_key: key,
    limit: z.number().int().min(1).max(SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.search_page_limit),
    cursor: cursor.nullable(), filters: boundedFilters }).strict(),
  z.object({ operation: z.literal("compare_clusters"), cluster_keys: z.array(key).length(2) }).strict(),
  z.object({ operation: z.literal("brand_os_context") }).strict()
]);

export type SignalTopicCandidateRefinementNavigationRequestV1 = z.infer<
  typeof signalTopicCandidateRefinementNavigationRequestSchemaV1
>;

export const signalTopicCandidateRefinementProposalSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT),
  display_name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_500),
  evidence_refs: z.array(digest).min(1).max(SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.evidence_ref_limit),
  related_candidate_keys: z.array(key).max(SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_LIMITS.related_candidate_limit),
  recommendation: z.enum(["none", "consider_merge", "consider_split"]),
  rationale: z.string().trim().min(1).max(1_200)
}).strict().superRefine((proposal, context) => {
  if (new Set(proposal.evidence_refs).size !== proposal.evidence_refs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "topic_candidate_refinement_duplicate_evidence" });
  }
  if (new Set(proposal.related_candidate_keys).size !== proposal.related_candidate_keys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "topic_candidate_refinement_duplicate_related_candidate" });
  }
  if (proposal.recommendation === "consider_merge" && proposal.related_candidate_keys.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "topic_candidate_refinement_merge_target_required" });
  }
});

export type SignalTopicCandidateRefinementProposalV1 = z.infer<
  typeof signalTopicCandidateRefinementProposalSchemaV1
>;

export function parseSignalTopicCandidateRefinementSessionStartV1(value: unknown) {
  return signalTopicCandidateRefinementSessionStartSchemaV1.parse(value);
}

export function parseSignalTopicCandidateRefinementNavigationRequestV1(value: unknown) {
  const parsed = signalTopicCandidateRefinementNavigationRequestSchemaV1.parse(value);
  if ("cluster_keys" in parsed && parsed.cluster_keys[0] === parsed.cluster_keys[1]) {
    throw new Error("topic_candidate_refinement_duplicate_cluster_key");
  }
  if ("filters" in parsed && parsed.filters.month_from && parsed.filters.month_to
      && parsed.filters.month_from > parsed.filters.month_to) {
    throw new Error("topic_candidate_refinement_filter_range_invalid");
  }
  return parsed;
}

export function parseSignalTopicCandidateRefinementProposalV1(value: unknown) {
  return signalTopicCandidateRefinementProposalSchemaV1.parse(value);
}
