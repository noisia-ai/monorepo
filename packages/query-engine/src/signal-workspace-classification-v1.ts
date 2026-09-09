import { z } from "zod";
import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";
import type { SignalTopicDefinitionV1 } from "./signal-topic-catalog-v1";

export const SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1 = "signal-workspace-classification-v1" as const;
// A transport capacity bound, never a population or top-k membership limit.
// Exceeding it fails this root explicitly; it does not clip its decisions.
export const SIGNAL_WORKSPACE_CLASSIFICATION_OUTCOME_MAX_BYTES_V1 = 8 * 1024 * 1024;
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/u);

/** Numerical lineage is distinct from a fit-v1 assignment file. The DB checks
 * these exact references against the sealed incremental source and bank. */
export const signalWorkspaceIncrementalMembershipMetadataSchemaV1 = z.object({
  contract_version: z.literal("workspace-computed-incremental-membership-v1"),
  engine_execution_id: z.string().uuid(), output_artifact_id: z.string().uuid(),
  memberships_artifact_id: z.string().uuid(), binding_artifact_id: z.string().uuid(), binding_digest: digest,
  unit_keys: z.array(z.string().regex(/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u)).length(1),
  model_component_key: digest, birth_membership_digest: digest,
  model_origin: z.object({ execution_id: z.string().uuid(), model_artifact_sha256: digest }).strict(),
  proposal_artifact_id: z.string().uuid(), proposal_owner_execution_id: z.string().uuid(),
  proposal_semantics_digest: digest, materialized_definition_digest: digest,
  evaluation_digest: digest,
  evidence_fragment: z.object({ chunk_index: z.number().int().nonnegative(), start: z.number().int().nonnegative(),
    end: z.number().int().positive(), chunk_sha256: digest }).strict(),
  matched_chunks: z.number().int().positive()
}).strict();
export type SignalWorkspaceIncrementalMembershipMetadataV1 = z.infer<typeof signalWorkspaceIncrementalMembershipMetadataSchemaV1>;

/** Semantic identity only. Run IDs and ingestion revisions belong to the
 * generation receipt, not this identity: a new import must permit exact reuse. */
export const signalWorkspaceClassificationIdentitySchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1),
  workspace_id: z.string().uuid(),
  engine_key: key,
  engine_version: z.number().int().positive(),
  engine_artifact_digest: digest,
  embedding_config_digest: digest,
  catalog_digest: digest,
  compiler_digest: digest,
  context_digest: digest,
  decision_policy_digest: digest
}).strict();
export type SignalWorkspaceClassificationIdentityV1 = z.infer<typeof signalWorkspaceClassificationIdentitySchemaV1>;

export const signalWorkspaceClassificationRootIdentitySchemaV1 = z.object({
  root_id: z.string().uuid(),
  // The preparation fingerprint covers full content, relevant provenance,
  // semantic scopes and rights. A text hash alone is insufficient.
  fingerprint: digest,
  correction_digest: digest
}).strict();
export type SignalWorkspaceClassificationRootIdentityV1 = z.infer<typeof signalWorkspaceClassificationRootIdentitySchemaV1>;

/** Sparse decisions are statements about individual Topics. Missing rows never
 * mean rejection. In particular, a retrieval shortlist cannot be decoded here. */
export const signalWorkspaceClassificationDecisionSchemaV1 = z.object({
  taxonomy_term_id: z.string().uuid(),
  term_key: key,
  definition_revision: z.number().int().positive(),
  definition_digest: digest,
  disposition: z.enum(["approved", "pending", "rejected"]),
  resolution_method: z.enum(["human", "model", "labeling_function"]),
  model_version_id: z.string().uuid().nullable(),
  labeling_function_version_id: z.string().uuid().nullable(),
  approval_policy_id: z.string().uuid().nullable(),
  decided_by_user_id: z.string().uuid().nullable(),
  correction_operation_id: z.string().uuid().nullable(),
  score: z.number().finite().nullable(),
  evidence_digest: digest,
  lineage_digest: digest,
  // Actual membership in a numerical cluster is reproducible evidence. It is
  // deliberately not authority to approve the cluster's interpreted meaning.
  membership_basis: z.literal("computed_cluster").optional(),
  membership_metadata: z.discriminatedUnion("contract_version", [z.object({
    contract_version: z.literal("workspace-computed-cluster-membership-v1"),
    engine_execution_id: z.string().uuid(),
    materialization_artifact_id: z.string().uuid(),
    assignment_artifact_ids: z.array(z.string().uuid()).min(1).max(2),
    unit_keys: z.array(z.string().regex(/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u)).min(1),
    proposal_semantics_digest: digest,
    materialized_definition_digest: digest,
    evidence_fragment: z.object({
      chunk_index: z.number().int().nonnegative(), start: z.number().int().nonnegative(),
      end: z.number().int().positive(), chunk_sha256: digest
    }).strict(),
    matched_chunks: z.number().int().positive()
  }).strict(), signalWorkspaceIncrementalMembershipMetadataSchemaV1]).optional()
}).strict().superRefine((value, ctx) => {
  const problem = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.membership_basis === "computed_cluster") {
    if (!value.membership_metadata || value.disposition !== "pending" || value.resolution_method !== "model"
      || value.approval_policy_id !== null) problem("workspace_classification_computed_membership_not_approval");
    if (value.membership_metadata?.contract_version === "workspace-computed-cluster-membership-v1" && (new Set(value.membership_metadata.assignment_artifact_ids).size
      !== value.membership_metadata.assignment_artifact_ids.length || new Set(value.membership_metadata.unit_keys).size
      !== value.membership_metadata.unit_keys.length)) problem("workspace_classification_computed_membership_duplicate_ref");
    const fragment = value.membership_metadata?.evidence_fragment;
    if (fragment && (fragment.end <= fragment.start || fragment.end - fragment.start > 1400)) {
      problem("workspace_classification_computed_membership_fragment_invalid");
    }
  } else if (value.membership_metadata !== undefined) problem("workspace_classification_membership_basis_required");
  if (value.resolution_method === "human") {
    if (!value.decided_by_user_id || !value.correction_operation_id || value.model_version_id
      || value.labeling_function_version_id || value.approval_policy_id) problem("workspace_classification_human_authority_required");
  } else {
    if (value.decided_by_user_id || value.correction_operation_id) problem("workspace_classification_actor_is_not_model_authority");
    if (value.resolution_method === "model" && (!value.model_version_id || value.labeling_function_version_id)) {
      problem("workspace_classification_model_required");
    }
    if (value.resolution_method === "labeling_function" && (!value.labeling_function_version_id || value.model_version_id)) {
      problem("workspace_classification_labeling_function_required");
    }
    if (value.disposition === "approved" && !value.approval_policy_id) problem("workspace_classification_approval_policy_required");
    if (value.disposition !== "approved" && value.approval_policy_id) problem("workspace_classification_approval_policy_not_applicable");
  }
});
export type SignalWorkspaceClassificationDecisionV1 = z.infer<typeof signalWorkspaceClassificationDecisionSchemaV1>;

/** Label, lifecycle and lineage are presentation/selection/provenance. Changing
 * the actual definition, scope, boundaries or examples changes the meaning
 * that can truthfully be attributed to an existing computed cluster. */
export function signalWorkspaceClassificationTopicSemanticsDigestV1(value: Pick<SignalTopicDefinitionV1,
  "definition" | "scope" | "inclusion" | "exclusion" | "positive_examples" | "negative_examples">) {
  return signalWorkspaceEmbeddingDigestV1({ definition: value.definition, scope: value.scope,
    inclusion: value.inclusion, exclusion: value.exclusion,
    positive_examples: value.positive_examples, negative_examples: value.negative_examples });
}

export const signalWorkspaceClassificationOutcomeSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1),
  root: signalWorkspaceClassificationRootIdentitySchemaV1,
  reuse_key: digest,
  resolution_state: z.enum(["approved", "pending", "rejected", "abstained", "error"]),
  // unresolved is one root-level exception, not one task for every unlabelled Topic.
  has_unresolved_topics: z.boolean(),
  reason_code: key,
  technical_error_code: key.nullable(),
  evidence_digest: digest,
  coverage: z.object({
    expected_chunks: z.number().int().positive(),
    processed_chunks: z.number().int().nonnegative(),
    chunk_coverage_digest: digest
  }).strict(),
  // No arbitrary top-k or total-membership cap. Storage can stream these in blocks.
  decisions: z.array(signalWorkspaceClassificationDecisionSchemaV1)
}).strict().superRefine((value, ctx) => {
  const problem = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const terms = new Set<string>();
  const ids = new Set<string>();
  for (const decision of value.decisions) {
    if (terms.has(decision.term_key) || ids.has(decision.taxonomy_term_id)) problem("workspace_classification_duplicate_decision");
    terms.add(decision.term_key); ids.add(decision.taxonomy_term_id);
  }
  if (value.coverage.processed_chunks > value.coverage.expected_chunks) problem("workspace_classification_chunk_coverage_invalid");
  if (value.resolution_state === "error") {
    // A failure on one Topic must not erase an independently verified correction
    // or decision for another. The store validates every retained authority.
    if (!value.technical_error_code || !value.has_unresolved_topics) problem("workspace_classification_error_shape_invalid");
    return;
  }
  if (value.technical_error_code !== null) problem("workspace_classification_error_shape_invalid");
  if (value.coverage.processed_chunks !== value.coverage.expected_chunks) problem("workspace_classification_chunk_coverage_incomplete");
  const expected = signalWorkspaceClassificationResolutionV1(value.decisions, value.has_unresolved_topics);
  if (expected !== value.resolution_state) problem("workspace_classification_root_summary_mismatch");
});
export type SignalWorkspaceClassificationOutcomeV1 = z.infer<typeof signalWorkspaceClassificationOutcomeSchemaV1>;

/** Root status and Topic disposition are different. A root can retain approved
 * membership while its overall status remains pending due to another Topic. */
export function signalWorkspaceClassificationResolutionV1(
  decisions: ReadonlyArray<Pick<SignalWorkspaceClassificationDecisionV1, "disposition">>,
  hasUnresolvedTopics: boolean
): "approved" | "pending" | "rejected" | "abstained" {
  if (hasUnresolvedTopics || decisions.some(value => value.disposition === "pending")) return "pending";
  if (decisions.some(value => value.disposition === "approved")) return "approved";
  if (decisions.some(value => value.disposition === "rejected")) return "rejected";
  return "abstained";
}

export function signalWorkspaceClassificationReuseKeyV1(
  identity: SignalWorkspaceClassificationIdentityV1,
  root: SignalWorkspaceClassificationRootIdentityV1
) {
  return signalWorkspaceEmbeddingDigestV1({
    identity: signalWorkspaceClassificationIdentitySchemaV1.parse(identity),
    root: signalWorkspaceClassificationRootIdentitySchemaV1.parse(root)
  });
}

export function parseSignalWorkspaceClassificationOutcomeV1(args: {
  identity: SignalWorkspaceClassificationIdentityV1;
  root: SignalWorkspaceClassificationRootIdentityV1;
  outcome: unknown;
}): SignalWorkspaceClassificationOutcomeV1 {
  if (Buffer.byteLength(JSON.stringify(args.outcome) ?? "", "utf8") > SIGNAL_WORKSPACE_CLASSIFICATION_OUTCOME_MAX_BYTES_V1) {
    throw new Error("workspace_classification_outcome_capacity_exceeded");
  }
  const value = signalWorkspaceClassificationOutcomeSchemaV1.parse(args.outcome);
  const expected = signalWorkspaceClassificationReuseKeyV1(args.identity, args.root);
  if (value.reuse_key !== expected || signalWorkspaceEmbeddingDigestV1(value.root)
    !== signalWorkspaceEmbeddingDigestV1(signalWorkspaceClassificationRootIdentitySchemaV1.parse(args.root))) {
    throw new Error("workspace_classification_root_identity_mismatch");
  }
  // DB verifies current actor, rights, catalog revision, model/policy state and
  // evidence separately. Shape validation is never approval authority.
  return value;
}

export function canReuseSignalWorkspaceClassificationOutcomeV1(args: {
  identity: SignalWorkspaceClassificationIdentityV1;
  root: SignalWorkspaceClassificationRootIdentityV1;
  prior: { reuse_key: string; resolution_state: string; source_generation_complete: boolean };
}) {
  return args.prior.source_generation_complete && ["approved", "pending", "rejected", "abstained"].includes(args.prior.resolution_state)
    && args.prior.reuse_key === signalWorkspaceClassificationReuseKeyV1(args.identity, args.root);
}
