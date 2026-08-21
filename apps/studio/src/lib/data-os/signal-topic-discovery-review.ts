import { createHash, createHmac } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";

import { pool } from "@/lib/db";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const REVIEW_DATA_SPLIT = "train_calibration";

const representativeSchema = z.object({
  evidence_ref: z.string().regex(DIGEST),
  role: z.string().min(1).max(80),
  selection_reason: z.string().min(1).max(160),
  excerpt: z.string().min(1).max(800),
  language: z.string().min(1).max(32),
  scope: z.string().min(1).max(80),
  source_slice: z.string().min(1).max(120),
  time_slice: z.string().min(1).max(32),
  rights_digest: z.string().regex(DIGEST)
}).strict();

const packetCoverageSchema = z.object({
  breadth_state: z.string().min(1).max(80),
  cluster_share_of_reviewed_scope: z.number().min(0).max(1),
  distinct_slice_count: z.number().int().nonnegative(),
  maximum_representatives: z.number().int().positive().max(8),
  observed_slice_count: z.number().int().nonnegative(),
  representative_count: z.number().int().nonnegative().max(8),
  reviewed_scope: z.string().min(1).max(120),
  reviewed_scope_denominator: z.number().int().positive()
}).strict();

const sealedPacketSchema = z.object({
  contract_version: z.string().min(1).max(160),
  run_key: z.string().min(1).max(240),
  cluster_key: z.string().min(1).max(240),
  cluster_content_digest: z.string().regex(DIGEST),
  packet_policy_version: z.string().min(1).max(160),
  packet_policy_digest: z.string().regex(DIGEST),
  packet_digest: z.string().regex(DIGEST),
  cluster_member_count: z.number().int().nonnegative(),
  population_denominator: z.number().int().positive(),
  coverage: packetCoverageSchema,
  count_scope: z.string().min(1).max(120),
  representatives: z.array(representativeSchema).min(1).max(8),
  local_terms: z.array(z.unknown()).max(100),
  local_phrases: z.array(z.unknown()).max(100),
  distributions: z.record(z.unknown()),
  distribution_contracts: z.record(z.unknown()),
  neighboring_clusters: z.array(z.unknown()).max(30),
  stability: z.unknown(),
  outlier_information: z.unknown(),
  limitations: z.array(z.unknown()).max(50),
  estimated_tokens: z.number().int().nonnegative(),
  excerpt_character_count: z.number().int().nonnegative()
}).strict();

const topicSchema = z.object({
  topic_label: z.string().min(1).max(120),
  scores: z.record(z.unknown()),
  sealed_packet: sealedPacketSchema
}).strict();

const outlierSchema = z.object({
  evidence_ref: z.string().regex(DIGEST),
  excerpt: z.string().min(1).max(800),
  language: z.string().min(1).max(32),
  platform: z.string().min(1).max(120),
  rights_digest: z.string().regex(DIGEST),
  scope: z.string().min(1).max(80),
  selection_reason: z.literal("seeded_bounded_outlier_diagnostic_sample"),
  time_slice: z.string().min(1).max(32)
}).strict();

const candidateSchema = z.object({
  candidate_label: z.string().min(1).max(120),
  topic_count: z.number().int().positive(),
  reviewed_topic_count: z.number().int().positive(),
  unreviewed_topic_count: z.number().int().nonnegative(),
  cluster_selection_state: z.literal("complete"),
  cluster_selection_contract: z.string().min(1).max(200),
  reviewed_cluster_population_count: z.number().int().nonnegative(),
  reviewed_cluster_population_share: z.number().min(0).max(1),
  outlier_count: z.number().int().nonnegative(),
  outlier_examples: z.array(outlierSchema).max(24),
  packet_token_count: z.number().int().nonnegative(),
  packet_token_limit: z.number().int().positive(),
  multiscope_summary: z.unknown(),
  topics: z.array(topicSchema).min(1).max(500)
}).strict();

export const signalTopicDiscoveryDiagnosticPacketSchema = z.object({
  contract_version: z.literal("signal-topic-discovery-diagnostic-review-v1"),
  review_status: z.literal("operator_diagnostic_review_required"),
  modeling_scope: z.literal("full_population"),
  modeling_record_count: z.number().int().positive(),
  review_scope: z.literal("complete_cluster_census"),
  population_denominator: z.number().int().positive(),
  modeling_decision_allowed: z.literal(false),
  adoption_allowed: z.literal(false),
  holdout_opened: z.literal(false),
  count_scope: z.literal("full_population_diagnostic"),
  decision_sheet_contract: z.literal("signal-topic-discovery-blind-decision-sheet-v2"),
  packet_policy_version: z.string().min(1).max(160),
  packet_policy_digest: z.string().regex(DIGEST),
  packet_token_count: z.number().int().nonnegative(),
  packet_token_limit: z.number().int().positive(),
  technical_limitations: z.array(z.string().max(500)).max(80),
  seed: z.number().int(),
  quality_floor: z.unknown(),
  instructions: z.array(z.string().max(500)).max(40),
  none_acceptable: z.null(),
  candidates: z.array(candidateSchema).length(1),
  candidate_role: z.literal("discovery_proposal_only"),
  reference_seed: z.number().int(),
  reference_seed_selection_basis: z.literal("first_preregistered_final_seed"),
  stability_context: z.record(z.unknown()),
  operator_decision_fields: z.record(z.null()),
  packet_digest: z.string().regex(DIGEST)
}).strict();

export type SignalTopicDiscoveryDiagnosticPacketV1 = z.infer<
  typeof signalTopicDiscoveryDiagnosticPacketSchema
>;

export const signalTopicDiscoveryReviewDraftSchema = z.object({
  proposal_key: z.string().trim().min(1).max(180),
  internal_coherence: z.number().int().min(1).max(5).nullable(),
  neighbor_distinction: z.number().int().min(1).max(5).nullable(),
  human_nameability: z.number().int().min(1).max(5).nullable(),
  strategic_utility: z.number().int().min(1).max(5).nullable(),
  merge_needed: z.boolean().nullable(),
  split_needed: z.boolean().nullable(),
  convert_to_topic_contract_candidate: z.boolean().nullable(),
  none_acceptable: z.boolean().nullable(),
  notes: z.string().trim().max(2000).nullable()
}).strict().superRefine((value, context) => {
  if (value.none_acceptable === true && value.convert_to_topic_contract_candidate === true) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "none_acceptable_conflicts_with_candidate" });
  }
});

export const signalTopicDiscoveryOutlierDraftSchema = z.object({
  study_boundary_thresholds: z.boolean().nullable(),
  study_missing_topic_families: z.boolean().nullable(),
  study_later_recovery: z.boolean().nullable(),
  notes: z.string().trim().max(2000).nullable()
}).strict();

export const signalTopicDiscoveryFinalizeSchema = z.object({
  outcome: z.enum(["candidate_preferred", "none_acceptable", "rerun_requested"]),
  confirmed: z.literal(true)
}).strict();

export type SignalTopicDiscoveryReviewDraftV1 = z.infer<typeof signalTopicDiscoveryReviewDraftSchema>;
export type SignalTopicDiscoveryOutlierDraftV1 = z.infer<typeof signalTopicDiscoveryOutlierDraftSchema>;
export type SignalTopicDiscoveryReviewOutcomeV1 = z.infer<typeof signalTopicDiscoveryFinalizeSchema>["outcome"];

export type SignalTopicDiscoveryEvidenceAuthorityV1 = {
  mentionId: string;
  authorityDigest: `sha256:${string}`;
  authorityValidUntil: string | null;
};

export type SignalTopicDiscoveryReviewListFiltersV1 = {
  status?: "pending" | "reviewed";
  decision?: "topic_contract_candidate" | "merge" | "split" | "none_acceptable";
  scope?: string;
  search?: string;
  size?: "small" | "medium" | "large";
  stability?: "low" | "medium" | "high";
};

export class SignalTopicDiscoveryReviewError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
  }
}

export function validateSignalTopicDiscoveryPacketV1(value: unknown) {
  const packet = signalTopicDiscoveryDiagnosticPacketSchema.parse(value);
  const candidate = packet.candidates[0]!;
  if (
    candidate.topic_count !== candidate.topics.length
    || candidate.reviewed_topic_count !== candidate.topics.length
    || candidate.unreviewed_topic_count !== 0
    || packet.reference_seed !== packet.seed
  ) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_packet_census_mismatch", 422);
  }
  const clusterKeys = candidate.topics.map((topic) => topic.sealed_packet.cluster_key);
  if (new Set(clusterKeys).size !== clusterKeys.length) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_packet_cluster_duplicate", 422);
  }
  for (const topic of candidate.topics) {
    const unsigned = { ...topic.sealed_packet } as Record<string, unknown>;
    delete unsigned.packet_digest;
    if (sha256(stableJson(unsigned)) !== topic.sealed_packet.packet_digest) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_cluster_packet_digest_mismatch", 422);
    }
  }
  return packet;
}

export async function resolveSignalTopicDiscoveryEvidenceRootsV1(args: {
  queryable: Queryable;
  workspaceId: string;
  evidenceRefs: Set<string>;
  pseudonymKey: Buffer;
  expectedAuthority: Map<string, { authorityDigest: string; authorityValidUntil: string | null }>;
}) {
  if (args.pseudonymKey.byteLength < 32) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_pseudonym_key_too_short", 422);
  }
  const roots = await args.queryable.query<{
    id: string;
    authority_digest: string;
    authority_valid_until: string | null;
  }>(`
    SELECT DISTINCT root.id::text AS id,observation.rights_definition_hash AS authority_digest,
      NULLIF(LEAST(
        COALESCE(binding.effective_to,'infinity'::timestamptz),
        COALESCE(retention.effective_to,'infinity'::timestamptz),
        COALESCE(retention.retain_until,'infinity'::timestamptz),
        COALESCE(licensing.effective_to,'infinity'::timestamptz),
        COALESCE(observation.retention_until,'infinity'::timestamptz)
      ),'infinity'::timestamptz)::text AS authority_valid_until
    FROM mentions root
    JOIN mentions member ON member.workspace_id=root.workspace_id
      AND member.canonical_mention_id=root.id
    JOIN signal_provider_mention_observations observation
      ON observation.workspace_id=member.workspace_id AND observation.mention_id=member.id
      AND NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
        WHERE successor.supersedes_observation_id=observation.id)
    JOIN import_batches batch ON batch.id=observation.import_batch_id
      AND batch.workspace_id=observation.workspace_id AND batch.status='completed'
    JOIN signal_provenance_policy_bindings binding
      ON binding.id=observation.provenance_binding_id AND binding.workspace_id=root.workspace_id
      AND binding.status='active' AND binding.effective_from<=transaction_timestamp()
      AND (binding.effective_to IS NULL OR binding.effective_to>transaction_timestamp())
    JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
      AND retention.status='active' AND retention.retention_state='allowed'
      AND retention.effective_from<=transaction_timestamp()
      AND (retention.effective_to IS NULL OR retention.effective_to>transaction_timestamp())
      AND (retention.retain_until IS NULL OR retention.retain_until>transaction_timestamp())
      AND (observation.retention_until IS NULL OR observation.retention_until>transaction_timestamp())
    JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
      AND licensing.status='active' AND licensing.effective_from<=transaction_timestamp()
      AND (licensing.effective_to IS NULL OR licensing.effective_to>transaction_timestamp())
    JOIN signal_licensing_policy_usages usage ON usage.licensing_policy_id=licensing.id
      AND usage.usage_purpose='strategic-analysis' AND usage.decision='allowed'
    WHERE root.workspace_id=$1::uuid AND root.canonical_mention_id=root.id
      AND observation.rights_definition_hash=binding.definition_hash
  `, [args.workspaceId]);
  const resolved = new Map<string, SignalTopicDiscoveryEvidenceAuthorityV1>();
  for (const row of roots.rows) {
    const ref = hmacDigest(args.pseudonymKey, `root:${row.id}`);
    if (!args.evidenceRefs.has(ref)) continue;
    const expected = args.expectedAuthority.get(ref);
    if (!expected || !DIGEST.test(expected.authorityDigest)) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_evidence_authority_missing", 422);
    }
    if (row.authority_digest !== expected.authorityDigest) continue;
    const validUntil = row.authority_valid_until ? new Date(row.authority_valid_until).toISOString() : null;
    if (expected.authorityValidUntil && validUntil !== new Date(expected.authorityValidUntil).toISOString()) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_evidence_authority_expiry_mismatch", 422);
    }
    const prior = resolved.get(ref);
    if (prior && compareNullableDates(prior.authorityValidUntil, validUntil) <= 0) continue;
    resolved.set(ref, {
      mentionId: row.id,
      authorityDigest: expected.authorityDigest as `sha256:${string}`,
      authorityValidUntil: validUntil
    });
  }
  if (resolved.size !== args.evidenceRefs.size) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_evidence_root_unresolved", 422);
  }
  await assertEvidenceRightsCurrent(args.queryable, args.workspaceId, [...resolved.values()].map((row) => row.mentionId));
  return resolved;
}

export async function registerSignalTopicDiscoveryReviewPacketV1(args: {
  queryable: Queryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  packet: unknown;
  packetFileDigest: string;
  sourceManifestDigest: string;
  discoveryRunDigest: string;
  candidateArtifactDigest: string;
  rightsDigest: string;
  evidenceAuthority: Map<string, SignalTopicDiscoveryEvidenceAuthorityV1>;
}) {
  requireInternalActor(args.actor);
  const packet = validateSignalTopicDiscoveryPacketV1(args.packet);
  for (const digest of [args.packetFileDigest, args.sourceManifestDigest, args.discoveryRunDigest,
    args.candidateArtifactDigest, args.rightsDigest]) {
    if (!DIGEST.test(digest)) throw new SignalTopicDiscoveryReviewError("topic_discovery_registration_digest_invalid", 422);
  }
  const candidate = packet.candidates[0]!;
  const evidence = candidate.topics.flatMap((topic) => topic.sealed_packet.representatives);
  const allEvidence = [...evidence, ...candidate.outlier_examples];
  for (const item of allEvidence) {
    const authority = args.evidenceAuthority.get(item.evidence_ref);
    if (!authority || authority.authorityDigest !== item.rights_digest) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_evidence_rights_mismatch", 422);
    }
  }
  if (new Set(allEvidence.map((item) => item.evidence_ref)).size > args.evidenceAuthority.size) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_evidence_authority_incomplete", 422);
  }
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `signal-topic-discovery-review:${args.workspace.id}:${packet.packet_digest}`
  ]);
  const operation = await beginSignalProductOperationV1<{ artifact_key: string; review_key: string }>({
    queryable: args.queryable,
    workspace: args.workspace,
    actor: args.actor,
    action: "register-topic-discovery-review",
    idempotencyKey: args.idempotencyKey,
    input: {
      packet_digest: packet.packet_digest,
      packet_file_digest: args.packetFileDigest,
      source_manifest_digest: args.sourceManifestDigest,
      discovery_run_digest: args.discoveryRunDigest,
      candidate_artifact_digest: args.candidateArtifactDigest,
      rights_digest: args.rightsDigest
    }
  });
  if (operation.replay) return operation.replay;

  const packetArtifactId = cryptoUuid();
  const packetArtifactKey = `topic-discovery-packet-${packet.packet_digest.slice(7, 23)}`;
  await args.queryable.query(`
    INSERT INTO analysis_artifacts(
      id,workspace_id,discovery_run_digest,artifact_key,artifact_type,title,summary,
      content,review_status,revision,position,metadata
    ) VALUES(
      $1::uuid,$2::uuid,$3,$4,'topic_discovery_review_packet',$5,$6,$7::jsonb,
      'needs_review',1,0,$8::jsonb
    )
  `, [
    packetArtifactId, args.workspace.id, args.discoveryRunDigest,
    packetArtifactKey, "Revisión ciega de descubrimiento",
    "Diagnóstico interno; no autoriza contratos, propagación ni serving.",
    JSON.stringify({
      contract_version: "signal-topic-discovery-review-packet-summary-v1",
      modeling_record_count: packet.modeling_record_count,
      population_denominator: packet.population_denominator,
      assigned_count: candidate.reviewed_cluster_population_count,
      assigned_coverage: candidate.reviewed_cluster_population_share,
      outlier_count: candidate.outlier_count,
      outlier_rate: candidate.outlier_count / packet.modeling_record_count,
      stability_context: packet.stability_context,
      technical_limitations: packet.technical_limitations
    }),
    JSON.stringify({
      visibility: "internal_private",
      candidate_role: "discovery_proposal_only",
      modeling_decision_allowed: false,
      adoption_allowed: false,
      holdout_opened: false
    })
  ]);

  for (const [index, topic] of candidate.topics.entries()) {
    const proposalId = cryptoUuid();
    const proposalKey = proposalPublicKey(index);
    await args.queryable.query(`
      INSERT INTO analysis_artifacts(
        id,workspace_id,discovery_run_digest,artifact_key,artifact_type,title,summary,
        content,review_status,revision,position,metadata
      ) VALUES(
        $1::uuid,$2::uuid,$3,$4,'topic_discovery_proposal',$5,$6,$7::jsonb,
        'needs_review',1,$8,$9::jsonb
      )
    `, [
      proposalId, args.workspace.id, args.discoveryRunDigest, proposalKey,
      blindProposalLabel(index), "Representación automática pendiente de evaluación humana.",
      JSON.stringify(operatorSafeProposalContent(topic.sealed_packet, topic.scores)), index + 1,
      JSON.stringify({
        candidate_artifact_digest: args.candidateArtifactDigest,
        discovery_proposal_key: sha256(`${packet.packet_digest}\u001f${topic.sealed_packet.cluster_key}`),
        cluster_key: topic.sealed_packet.cluster_key,
        data_split: REVIEW_DATA_SPLIT,
        authority: "pending_discovery_proposal"
      })
    ]);
    await args.queryable.query(`
      INSERT INTO analysis_artifact_relations(
        source_artifact_id,target_artifact_id,relation_type,position,metadata
      ) VALUES($1::uuid,$2::uuid,'contains_proposal',$3,'{}'::jsonb)
    `, [packetArtifactId, proposalId, index]);
    const groupId = cryptoUuid();
    await args.queryable.query(`
      INSERT INTO analysis_evidence_groups(id,artifact_id,group_key,role,label,summary,position,metadata)
      VALUES($1::uuid,$2::uuid,'representatives','supporting','Evidencia representativa',
        'Excerpts redacted seleccionados por la policy sellada.',0,'{}'::jsonb)
    `, [groupId, proposalId]);
    await insertEvidenceLinks({
      queryable: args.queryable,
      groupId,
      evidence: topic.sealed_packet.representatives,
      evidenceAuthority: args.evidenceAuthority
    });
  }

  const outlierGroupId = cryptoUuid();
  await args.queryable.query(`
    INSERT INTO analysis_evidence_groups(id,artifact_id,group_key,role,label,summary,position,metadata)
    VALUES($1::uuid,$2::uuid,'outlier-reservoir','limitation','Reservorio de outliers',
      'Muestra diagnóstica separada; un outlier no equivale automáticamente a ruido.',1,'{}'::jsonb)
  `, [outlierGroupId, packetArtifactId]);
  if (candidate.outlier_examples.length > 0) {
    await insertEvidenceLinks({
      queryable: args.queryable,
      groupId: outlierGroupId,
      evidence: candidate.outlier_examples.map((item) => ({
        ...item,
        role: "outlier_diagnostic_sample",
        source_slice: item.platform
      })),
      evidenceAuthority: args.evidenceAuthority
    });
  }

  const validUntilValues = [...args.evidenceAuthority.values()]
    .map((item) => item.authorityValidUntil)
    .filter((value): value is string => value !== null)
    .sort();
  await args.queryable.query(`
    INSERT INTO signal_topic_discovery_review_packets(
      artifact_id,workspace_id,discovery_run_digest,candidate_artifact_digest,
      packet_digest,packet_file_digest,source_manifest_digest,packet_policy_version,
      packet_policy_digest,reference_seed,rights_digest,rights_valid_until,
      modeling_denominator,proposal_count,evidence_count,outlier_evidence_count,
      review_scope,source_holdout_state,registered_by_user_id
    ) VALUES(
      $1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,
      $13,$14,$15,$16,$17,'sealed',$18::uuid
    )
  `, [
    packetArtifactId, args.workspace.id, args.discoveryRunDigest, args.candidateArtifactDigest,
    packet.packet_digest, args.packetFileDigest, args.sourceManifestDigest,
    packet.packet_policy_version, packet.packet_policy_digest, packet.reference_seed,
    args.rightsDigest, validUntilValues[0] ?? null, packet.modeling_record_count,
    candidate.topics.length, evidence.length,
    candidate.outlier_examples.length, packet.review_scope, args.actor.id
  ]);

  const reviewId = cryptoUuid();
  await args.queryable.query(`
    INSERT INTO signal_topic_discovery_reviews(
      id,workspace_id,packet_artifact_id,review_revision,created_by_user_id
    ) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4::uuid)
  `, [reviewId, args.workspace.id, packetArtifactId, args.actor.id]);
  const openedDigest = sha256(stableJson({
    contract_version: "signal-topic-discovery-review-event-v1",
    workspace_id: args.workspace.id,
    packet_digest: packet.packet_digest,
    review_revision: 1,
    event_kind: "review_opened"
  }));
  await args.queryable.query(`
    INSERT INTO signal_topic_discovery_review_events(
      workspace_id,review_id,operation_id,event_index,event_kind,previous_state,
      next_state,review_digest,actor_user_id
    ) VALUES($1::uuid,$2::uuid,$3::uuid,0,'review_opened',NULL,'open',$4,$5::uuid)
  `, [args.workspace.id, reviewId, operation.operationId, openedDigest, args.actor.id]);
  const result = { artifact_key: packetArtifactKey, review_key: reviewPublicKey(reviewId) };
  await completeSignalProductOperationV1({
    queryable: args.queryable,
    workspaceId: args.workspace.id,
    key: operation.key,
    result
  });
  return result;
}

export async function loadSignalTopicDiscoveryReviewRunsV1(args: {
  workspace: ResolvedSignalWorkspace;
}) {
  const result = await pool.query<RunRow>(`${RUN_SELECT_SQL}
    WHERE packet.workspace_id=$1::uuid
    ORDER BY packet.registered_at DESC,packet.artifact_id DESC`, [args.workspace.id]);
  return {
    contract_version: "signal-topic-discovery-review-runs-v1" as const,
    runs: result.rows.map(operatorSafeRun)
  };
}

export async function loadSignalTopicDiscoveryReviewSummaryV1(args: {
  workspace: ResolvedSignalWorkspace;
  runKey?: string | null;
}) {
  const run = await loadRunOrThrow(args.workspace.id, args.runKey);
  await assertPacketRightsCurrent(run);
  const review = await loadCurrentReview(run.artifact_id, args.workspace.id);
  const [progress, outlier] = await Promise.all([
    pool.query<{
      reviewed: number;
      candidate: number;
      merge: number;
      split: number;
      none_acceptable: number;
    }>(`${LATEST_DECISIONS_CTE}
      SELECT
        count(*) FILTER(WHERE ${COMPLETE_DECISION_SQL})::int AS reviewed,
        count(*) FILTER(WHERE convert_to_topic_contract_candidate=true)::int AS candidate,
        count(*) FILTER(WHERE merge_needed=true)::int AS merge,
        count(*) FILTER(WHERE split_needed=true)::int AS split,
        count(*) FILTER(WHERE none_acceptable=true)::int AS none_acceptable
      FROM latest WHERE review_id=$1::uuid`, [review.id]),
    loadLatestOutlierDecision(review.id)
  ]);
  const metrics = safeRecord(run.content);
  const reviewed = progress.rows[0]?.reviewed ?? 0;
  return {
    contract_version: "signal-topic-discovery-review-summary-v1" as const,
    run: operatorSafeRun(run),
    review: {
      key: reviewPublicKey(review.id),
      revision: review.review_revision,
      state: review.state,
      outcome: review.outcome,
      reviewed,
      pending: run.proposal_count - reviewed,
      progress: run.proposal_count > 0 ? reviewed / run.proposal_count : 0,
      decisions: progress.rows[0] ?? { candidate: 0, merge: 0, split: 0, none_acceptable: 0 },
      outliers_reviewed: outlier !== null && isCompleteOutlierDecision(outlier),
      operator_review_complete: review.state === "finalized"
    },
    diagnostic: {
      modeling_denominator: run.modeling_denominator,
      assigned_count: numeric(metrics.assigned_count),
      assigned_coverage: numeric(metrics.assigned_coverage),
      outlier_count: numeric(metrics.outlier_count),
      outlier_rate: numeric(metrics.outlier_rate),
      reference_seed: run.reference_seed,
      status: "diagnostic_not_adoption" as const,
      holdout_opened: false,
      ten_c3b_authorized: false,
      ten_d_ready: false
    }
  };
}

export async function listSignalTopicDiscoveryProposalsV1(args: {
  workspace: ResolvedSignalWorkspace;
  runKey?: string | null;
  filters?: SignalTopicDiscoveryReviewListFiltersV1;
  cursor?: string | null;
  limit?: number;
}) {
  const run = await loadRunOrThrow(args.workspace.id, args.runKey);
  await assertPacketRightsCurrent(run);
  const review = await loadCurrentReview(run.artifact_id, args.workspace.id);
  const filters = normalizeFilters(args.filters ?? {});
  const filterDigest = sha256(stableJson(filters));
  const cursor = args.cursor ? decodeCursor(args.cursor, run.packet_digest, filterDigest) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));
  const params: unknown[] = [run.artifact_id, review.id, limit + 1, cursor?.position ?? null,
    filters.status ?? null, filters.decision ?? null, filters.scope ?? null,
    filters.search ?? null, filters.size ?? null, filters.stability ?? null];
  const result = await pool.query<ProposalListRow>(`${LATEST_DECISIONS_CTE}
    SELECT artifact.artifact_key AS proposal_key,artifact.title,artifact.position,
      artifact.content,latest.internal_coherence,latest.neighbor_distinction,
      latest.human_nameability,latest.strategic_utility,latest.merge_needed,
      latest.split_needed,latest.convert_to_topic_contract_candidate,
      latest.none_acceptable,latest.notes,latest.reviewed_at::text,
      (${COMPLETE_DECISION_SQL}) AS reviewed
    FROM analysis_artifact_relations relation
    JOIN analysis_artifacts artifact ON artifact.id=relation.target_artifact_id
    LEFT JOIN latest ON latest.review_id=$2::uuid AND latest.proposal_artifact_id=artifact.id
    WHERE relation.source_artifact_id=$1::uuid AND relation.relation_type='contains_proposal'
      AND ($4::int IS NULL OR artifact.position>$4::int)
      AND ($5::text IS NULL OR ($5='reviewed' AND ${COMPLETE_DECISION_SQL})
        OR ($5='pending' AND NOT (${COMPLETE_DECISION_SQL})))
      AND ($6::text IS NULL
        OR ($6='topic_contract_candidate' AND latest.convert_to_topic_contract_candidate=true)
        OR ($6='merge' AND latest.merge_needed=true)
        OR ($6='split' AND latest.split_needed=true)
        OR ($6='none_acceptable' AND latest.none_acceptable=true))
      AND ($7::text IS NULL OR artifact.content->'distributions'->'scope' ? $7::text)
      AND ($8::text IS NULL OR concat_ws(' ',artifact.content->>'local_terms_text',
        artifact.content->>'local_phrases_text') ILIKE '%'||$8::text||'%')
      AND ($9::text IS NULL OR
        ($9='small' AND (artifact.content->>'cluster_member_count')::int<50)
        OR ($9='medium' AND (artifact.content->>'cluster_member_count')::int BETWEEN 50 AND 249)
        OR ($9='large' AND (artifact.content->>'cluster_member_count')::int>=250))
      AND ($10::text IS NULL OR
        ($10='low' AND COALESCE((artifact.content->>'stability_score')::numeric,0)<0.4)
        OR ($10='medium' AND COALESCE((artifact.content->>'stability_score')::numeric,0) BETWEEN 0.4 AND 0.69)
        OR ($10='high' AND COALESCE((artifact.content->>'stability_score')::numeric,0)>=0.7))
    ORDER BY artifact.position,artifact.artifact_key
    LIMIT $3::int`, params);
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    contract_version: "signal-topic-discovery-review-proposals-v1" as const,
    run_key: run.run_key,
    review_key: reviewPublicKey(review.id),
    records: rows.map(operatorSafeProposalListItem),
    next_cursor: hasMore && last
      ? encodeCursor({ packetDigest: run.packet_digest, filterDigest, position: last.position })
      : null,
    filters_digest: filterDigest
  };
}

export async function loadSignalTopicDiscoveryProposalDetailV1(args: {
  workspace: ResolvedSignalWorkspace;
  proposalKey: string;
}) {
  const result = await pool.query<ProposalDetailRow>(`
    SELECT packet.artifact_id::text AS packet_artifact_id,packet.packet_digest,
      packet.candidate_artifact_digest,packet.rights_valid_until::text,
      packet.discovery_run_digest,artifact.id::text AS artifact_id,
      artifact.artifact_key AS proposal_key,artifact.title,artifact.position,artifact.content,
      artifact.metadata
    FROM analysis_artifacts artifact
    JOIN analysis_artifact_relations relation
      ON relation.target_artifact_id=artifact.id AND relation.relation_type='contains_proposal'
    JOIN signal_topic_discovery_review_packets packet ON packet.artifact_id=relation.source_artifact_id
    WHERE packet.workspace_id=$1::uuid AND artifact.artifact_key=$2
  `, [args.workspace.id, args.proposalKey]);
  const proposal = result.rows[0];
  if (!proposal) throw new SignalTopicDiscoveryReviewError("topic_discovery_proposal_not_found", 404);
  await assertPacketRightsCurrent(proposal);
  const review = await loadCurrentReview(proposal.packet_artifact_id, args.workspace.id);
  const [evidenceResult, decision] = await Promise.all([
    pool.query<EvidenceRow>(`
      SELECT link.source_id::text,link.evidence_role,link.quote,link.locator,link.position
      FROM analysis_evidence_groups evidence_group
      JOIN analysis_evidence_links link ON link.evidence_group_id=evidence_group.id
      WHERE evidence_group.artifact_id=$1::uuid AND evidence_group.group_key='representatives'
      ORDER BY link.position,link.id LIMIT 8
    `, [proposal.artifact_id]),
    loadLatestDecision(review.id, proposal.artifact_id)
  ]);
  await assertEvidenceRightsCurrent(pool, args.workspace.id, evidenceResult.rows.map((row) => row.source_id));
  return {
    contract_version: "signal-topic-discovery-review-proposal-detail-v1" as const,
    run_key: runPublicKey(proposal.packet_digest),
    proposal: {
      key: proposal.proposal_key,
      label: proposal.title,
      position: proposal.position,
      ...publicProposalContent(proposal.content),
      technical: {
        role: "pending_discovery_proposal" as const,
        holdout_opened: false,
        candidate_label: "Candidato ciego",
        lineage_ref: shortDigest(proposal.discovery_run_digest)
      }
    },
    evidence: evidenceResult.rows.map((row) => ({
      role: row.evidence_role,
      excerpt: row.quote,
      ...publicEvidenceLocator(row.locator)
    })),
    draft: decision ? operatorSafeDecision(decision) : null,
    review_state: review.state
  };
}

export async function saveSignalTopicDiscoveryReviewDraftV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  input: SignalTopicDiscoveryReviewDraftV1;
}) {
  requireInternalActor(args.actor);
  const parsed = signalTopicDiscoveryReviewDraftSchema.parse(args.input);
  return withSerializableTransaction(async (client) => {
    const proposal = await loadProposalForWrite(client, args.workspace.id, parsed.proposal_key);
    await assertPacketRightsCurrent({
      packet_artifact_id: proposal.packet_artifact_id,
      rights_valid_until: null
    }, client);
    const review = await loadCurrentReviewForWrite(client, proposal.packet_artifact_id, args.workspace.id);
    const operation = await beginSignalProductOperationV1<{ proposal_key: string; saved: true }>({
      queryable: client, workspace: args.workspace, actor: args.actor,
      action: "save-topic-discovery-review-draft", idempotencyKey: args.idempotencyKey,
      input: parsed
    });
    if (operation.replay) return operation.replay;
    assertReviewOpen(review);
    const prior = await loadLatestDecision(review.id, proposal.artifact_id, client);
    const decisionRevision = (prior?.decision_revision ?? 0) + 1;
    const metadata = safeRecord(proposal.metadata);
    const evidenceRefs = await loadProposalEvidenceRefs(client, proposal.artifact_id);
    const digest = sha256(stableJson({
      contract_version: "signal-topic-discovery-review-decision-v1",
      candidate_artifact_digest: metadata.candidate_artifact_digest,
      discovery_proposal_key: metadata.discovery_proposal_key,
      cluster_key: metadata.cluster_key,
      evidence_refs: evidenceRefs,
      data_split: metadata.data_split,
      reviewer_ref: args.actor.id,
      decision_revision: decisionRevision,
      ...parsed
    }));
    await client.query(`${INSERT_DECISION_SQL}`, [
      args.workspace.id, review.id, proposal.artifact_id, decisionRevision, prior?.id ?? null,
      metadata.candidate_artifact_digest, metadata.discovery_proposal_key, metadata.cluster_key,
      evidenceRefs, metadata.data_split ?? REVIEW_DATA_SPLIT, args.actor.id,
      parsed.internal_coherence, parsed.neighbor_distinction, parsed.human_nameability,
      parsed.strategic_utility, parsed.merge_needed, parsed.split_needed,
      parsed.convert_to_topic_contract_candidate, parsed.none_acceptable, parsed.notes,
      digest, operation.operationId
    ]);
    const result = { proposal_key: parsed.proposal_key, saved: true as const };
    await completeSignalProductOperationV1({ queryable: client, workspaceId: args.workspace.id,
      key: operation.key, result });
    return result;
  });
}

export async function saveSignalTopicDiscoveryOutlierDraftV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  runKey?: string | null;
  input: SignalTopicDiscoveryOutlierDraftV1;
}) {
  requireInternalActor(args.actor);
  const parsed = signalTopicDiscoveryOutlierDraftSchema.parse(args.input);
  return withSerializableTransaction(async (client) => {
    const run = await loadRunOrThrow(args.workspace.id, args.runKey, client);
    await assertPacketRightsCurrent(run, client);
    const review = await loadCurrentReviewForWrite(client, run.artifact_id, args.workspace.id);
    const operation = await beginSignalProductOperationV1<{ saved: true }>({
      queryable: client, workspace: args.workspace, actor: args.actor,
      action: "save-topic-discovery-outlier-draft", idempotencyKey: args.idempotencyKey,
      input: { run_key: run.run_key, ...parsed }
    });
    if (operation.replay) return operation.replay;
    assertReviewOpen(review);
    const prior = await loadLatestOutlierDecision(review.id, client);
    const revision = (prior?.decision_revision ?? 0) + 1;
    const digest = sha256(stableJson({
      contract_version: "signal-topic-discovery-outlier-decision-v1",
      packet_digest: run.packet_digest,
      reviewer_ref: args.actor.id,
      decision_revision: revision,
      ...parsed
    }));
    await client.query(`
      INSERT INTO signal_topic_discovery_outlier_decisions(
        workspace_id,review_id,decision_revision,supersedes_decision_id,state,
        study_boundary_thresholds,study_missing_topic_families,study_later_recovery,
        notes,reviewer_user_id,decision_digest,operation_id
      ) VALUES($1::uuid,$2::uuid,$3,$4::uuid,'draft',$5,$6,$7,$8,$9::uuid,$10,$11::uuid)
    `, [args.workspace.id, review.id, revision, prior?.id ?? null,
      parsed.study_boundary_thresholds, parsed.study_missing_topic_families,
      parsed.study_later_recovery, parsed.notes, args.actor.id, digest, operation.operationId]);
    const result = { saved: true as const };
    await completeSignalProductOperationV1({ queryable: client, workspaceId: args.workspace.id,
      key: operation.key, result });
    return result;
  });
}

export async function finalizeSignalTopicDiscoveryReviewV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  runKey?: string | null;
  outcome: SignalTopicDiscoveryReviewOutcomeV1;
}) {
  requireInternalActor(args.actor);
  return withSerializableTransaction(async (client) => {
    const run = await loadRunOrThrow(args.workspace.id, args.runKey, client);
    await assertPacketRightsCurrent(run, client);
    const review = await loadCurrentReviewForWrite(client, run.artifact_id, args.workspace.id);
    const operation = await beginSignalProductOperationV1<FinalizeResult>({
      queryable: client, workspace: args.workspace, actor: args.actor,
      action: "finalize-topic-discovery-review", idempotencyKey: args.idempotencyKey,
      input: { run_key: run.run_key, outcome: args.outcome, confirmed: true }
    });
    if (operation.replay) return operation.replay;
    assertReviewOpen(review);
    const decisions = await loadAllLatestDecisions(review.id, client);
    if (decisions.length !== run.proposal_count || decisions.some((decision) => !isCompleteDecision(decision))) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_review_census_incomplete", 409);
    }
    const outlier = await loadLatestOutlierDecision(review.id, client);
    if (!outlier || !isCompleteOutlierDecision(outlier)) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_outlier_review_incomplete", 409);
    }
    if (args.outcome === "candidate_preferred"
      && !decisions.some((decision) => decision.convert_to_topic_contract_candidate === true)) {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_candidate_preference_requires_candidate", 409);
    }
    await client.query(`
      INSERT INTO signal_topic_discovery_review_decisions(
        workspace_id,review_id,proposal_artifact_id,decision_revision,supersedes_decision_id,
        state,candidate_artifact_digest,discovery_proposal_key,cluster_key,evidence_refs,
        data_split,reviewer_user_id,reviewed_at,internal_coherence,neighbor_distinction,
        human_nameability,strategic_utility,merge_needed,split_needed,
        convert_to_topic_contract_candidate,none_acceptable,notes,decision_digest,operation_id
      ) SELECT workspace_id,review_id,proposal_artifact_id,decision_revision+1,id,'finalized',
        candidate_artifact_digest,discovery_proposal_key,cluster_key,evidence_refs,data_split,
        $2::uuid,clock_timestamp(),internal_coherence,neighbor_distinction,human_nameability,
        strategic_utility,merge_needed,split_needed,convert_to_topic_contract_candidate,
        none_acceptable,notes,'sha256:'||encode(digest(convert_to(decision_digest||'|finalized',
          'UTF8'),'sha256'),'hex'),$3::uuid
      FROM (${LATEST_DECISIONS_CTE} SELECT * FROM latest WHERE review_id=$1::uuid) current
    `, [review.id, args.actor.id, operation.operationId]);
    await client.query(`
      INSERT INTO signal_topic_discovery_outlier_decisions(
        workspace_id,review_id,decision_revision,supersedes_decision_id,state,
        study_boundary_thresholds,study_missing_topic_families,study_later_recovery,
        notes,reviewer_user_id,reviewed_at,decision_digest,operation_id
      ) VALUES($1::uuid,$2::uuid,$3,$4::uuid,'finalized',$5,$6,$7,$8,$9::uuid,
        clock_timestamp(),$10,$11::uuid)
    `, [args.workspace.id, review.id, outlier.decision_revision + 1, outlier.id,
      outlier.study_boundary_thresholds, outlier.study_missing_topic_families,
      outlier.study_later_recovery, outlier.notes, args.actor.id,
      sha256(`${outlier.decision_digest}|finalized`), operation.operationId]);
    const finalized = await loadAllLatestDecisions(review.id, client);
    const finalizedOutlier = await loadLatestOutlierDecision(review.id, client);
    const exports = buildContractualReviewExports(run, finalized, finalizedOutlier!, args.outcome);
    const reviewDigest = sha256(stableJson({
      contract_version: "signal-topic-discovery-review-final-v1",
      packet_digest: run.packet_digest,
      candidate_artifact_digest: run.candidate_artifact_digest,
      outcome: args.outcome,
      decision_digests: finalized.map((decision) => decision.decision_digest).sort(),
      outlier_decision_digest: finalizedOutlier!.decision_digest,
      score_sheet_digest: exports.scoreSheetDigest,
      decision_sheet_digest: exports.decisionSheetDigest
    }));
    await client.query(`
      INSERT INTO signal_topic_discovery_review_events(
        workspace_id,review_id,operation_id,event_index,event_kind,previous_state,next_state,
        outcome,outlier_decision_digest,score_sheet_digest,decision_sheet_digest,
        review_digest,actor_user_id
      ) VALUES($1::uuid,$2::uuid,$3::uuid,0,'review_finalized','open','finalized',$4,
        $5,$6,$7,$8,$9::uuid)
    `, [args.workspace.id, review.id, operation.operationId, args.outcome,
      finalizedOutlier!.decision_digest, exports.scoreSheetDigest, exports.decisionSheetDigest,
      reviewDigest, args.actor.id]);
    const result: FinalizeResult = {
      finalized: true,
      outcome: args.outcome,
      review_digest: reviewDigest,
      score_sheet_digest: exports.scoreSheetDigest,
      decision_sheet_digest: exports.decisionSheetDigest,
      operator_review_complete: true,
      modeling_adopted: false,
      ten_c3b_authorized: false,
      ten_d_ready: false
    };
    await completeSignalProductOperationV1({ queryable: client, workspaceId: args.workspace.id,
      key: operation.key, result });
    return result;
  });
}

export async function loadSignalTopicDiscoveryReviewExportV1(args: {
  workspace: ResolvedSignalWorkspace;
  runKey?: string | null;
  kind: "score-sheet" | "decision-sheet";
}) {
  const run = await loadRunOrThrow(args.workspace.id, args.runKey);
  const review = await loadCurrentReview(run.artifact_id, args.workspace.id);
  if (review.state !== "finalized" || !review.outcome) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_review_not_finalized", 409);
  }
  const decisions = await loadAllLatestDecisions(review.id);
  const outlier = await loadLatestOutlierDecision(review.id);
  const exports = buildContractualReviewExports(run, decisions, outlier!, review.outcome);
  return args.kind === "score-sheet"
    ? { filename: "topic-discovery-score-sheet.csv", body: exports.scoreSheet,
      digest: exports.scoreSheetDigest }
    : { filename: "topic-discovery-decision-sheet.csv", body: exports.decisionSheet,
      digest: exports.decisionSheetDigest };
}

export async function supersedeSignalTopicDiscoveryReviewV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  runKey?: string | null;
}) {
  requireInternalActor(args.actor);
  return withSerializableTransaction(async (client) => {
    const run = await loadRunOrThrow(args.workspace.id, args.runKey, client);
    const current = await loadCurrentReviewForWrite(client, run.artifact_id, args.workspace.id);
    const operation = await beginSignalProductOperationV1<{
      review_key: string;
      revision: number;
      superseded: true;
    }>({
      queryable: client,
      workspace: args.workspace,
      actor: args.actor,
      action: "supersede-topic-discovery-review",
      idempotencyKey: args.idempotencyKey,
      input: { run_key: run.run_key, confirmed: true }
    });
    if (operation.replay) return operation.replay;
    if (current.state !== "finalized") {
      throw new SignalTopicDiscoveryReviewError("topic_discovery_review_supersession_requires_finalized", 409);
    }
    const nextId = cryptoUuid();
    const nextRevision = current.review_revision + 1;
    await client.query(`
      INSERT INTO signal_topic_discovery_reviews(
        id,workspace_id,packet_artifact_id,review_revision,supersedes_review_id,created_by_user_id
      ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid)
    `, [nextId, args.workspace.id, run.artifact_id, nextRevision, current.id, args.actor.id]);
    const supersededDigest = sha256(stableJson({
      contract_version: "signal-topic-discovery-review-event-v1",
      packet_digest: run.packet_digest,
      event_kind: "review_superseded",
      previous_revision: current.review_revision,
      next_revision: nextRevision
    }));
    const openedDigest = sha256(stableJson({
      contract_version: "signal-topic-discovery-review-event-v1",
      packet_digest: run.packet_digest,
      event_kind: "review_opened",
      review_revision: nextRevision
    }));
    await client.query(`
      INSERT INTO signal_topic_discovery_review_events(
        workspace_id,review_id,operation_id,event_index,event_kind,previous_state,next_state,
        review_digest,actor_user_id
      ) VALUES
        ($1::uuid,$2::uuid,$3::uuid,0,'review_superseded','finalized','superseded',$4,$5::uuid),
        ($1::uuid,$6::uuid,$3::uuid,1,'review_opened',NULL,'open',$7,$5::uuid)
    `, [args.workspace.id, current.id, operation.operationId, supersededDigest,
      args.actor.id, nextId, openedDigest]);
    const result = {
      review_key: reviewPublicKey(nextId),
      revision: nextRevision,
      superseded: true as const
    };
    await completeSignalProductOperationV1({ queryable: client, workspaceId: args.workspace.id,
      key: operation.key, result });
    return result;
  });
}

export async function loadSignalTopicDiscoveryReviewHistoryV1(args: {
  workspace: ResolvedSignalWorkspace;
  runKey?: string | null;
}) {
  const run = await loadRunOrThrow(args.workspace.id, args.runKey);
  const result = await pool.query<{
    review_revision: number;
    event_kind: string;
    next_state: string;
    outcome: string | null;
    created_at: string;
  }>(`
    SELECT review.review_revision,event.event_kind,event.next_state,event.outcome,event.created_at::text
    FROM signal_topic_discovery_reviews review
    JOIN signal_topic_discovery_review_events event ON event.review_id=review.id
    WHERE review.workspace_id=$1::uuid AND review.packet_artifact_id=$2::uuid
    ORDER BY review.review_revision,event.created_at,event.id
  `, [args.workspace.id, run.artifact_id]);
  return {
    contract_version: "signal-topic-discovery-review-history-v1" as const,
    events: result.rows
  };
}

export async function loadSignalTopicDiscoveryOutlierReviewV1(args: {
  workspace: ResolvedSignalWorkspace;
  runKey?: string | null;
}) {
  const run = await loadRunOrThrow(args.workspace.id, args.runKey);
  await assertPacketRightsCurrent(run);
  const review = await loadCurrentReview(run.artifact_id, args.workspace.id);
  const [evidence, decision] = await Promise.all([
    pool.query<EvidenceRow>(`
      SELECT link.source_id::text,link.evidence_role,link.quote,link.locator,link.position
      FROM analysis_evidence_groups evidence_group
      JOIN analysis_evidence_links link ON link.evidence_group_id=evidence_group.id
      WHERE evidence_group.artifact_id=$1::uuid AND evidence_group.group_key='outlier-reservoir'
      ORDER BY link.position,link.id LIMIT 8
    `, [run.artifact_id]),
    loadLatestOutlierDecision(review.id)
  ]);
  await assertEvidenceRightsCurrent(pool, args.workspace.id, evidence.rows.map((row) => row.source_id));
  return {
    contract_version: "signal-topic-discovery-outlier-review-v1" as const,
    run_key: run.run_key,
    review_state: review.state,
    explanation: "Un outlier es una raíz no asignada en este discovery run; no equivale automáticamente a ruido.",
    evidence: evidence.rows.map((row) => ({ excerpt: row.quote, ...publicEvidenceLocator(row.locator) })),
    draft: decision ? operatorSafeOutlierDecision(decision) : null
  };
}

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

type RunRow = {
  artifact_id: string;
  packet_digest: string;
  discovery_run_digest: string;
  candidate_artifact_digest: string;
  packet_policy_version: string;
  packet_policy_digest: string;
  rights_digest: string;
  rights_valid_until: string | null;
  modeling_denominator: number;
  proposal_count: number;
  evidence_count: number;
  outlier_evidence_count: number;
  reference_seed: number;
  review_scope: string;
  registered_at: string;
  content: unknown;
  run_key: string;
};

type ReviewRow = {
  id: string;
  review_revision: number;
  state: "open" | "finalized" | "superseded";
  outcome: SignalTopicDiscoveryReviewOutcomeV1 | null;
};

type DecisionRow = {
  id: string;
  proposal_artifact_id: string;
  proposal_key: string;
  decision_revision: number;
  state: "draft" | "finalized";
  internal_coherence: number | null;
  neighbor_distinction: number | null;
  human_nameability: number | null;
  strategic_utility: number | null;
  merge_needed: boolean | null;
  split_needed: boolean | null;
  convert_to_topic_contract_candidate: boolean | null;
  none_acceptable: boolean | null;
  notes: string | null;
  decision_digest: string;
  reviewed_at: string;
};

type OutlierDecisionRow = {
  id: string;
  decision_revision: number;
  state: "draft" | "finalized";
  study_boundary_thresholds: boolean | null;
  study_missing_topic_families: boolean | null;
  study_later_recovery: boolean | null;
  notes: string | null;
  decision_digest: string;
  reviewed_at: string;
};

type ProposalListRow = DecisionRow & {
  proposal_key: string;
  title: string;
  position: number;
  content: unknown;
  reviewed: boolean;
};

type ProposalDetailRow = {
  packet_artifact_id: string;
  packet_digest: string;
  candidate_artifact_digest: string;
  rights_valid_until: string | null;
  discovery_run_digest: string;
  artifact_id: string;
  proposal_key: string;
  title: string;
  position: number;
  content: unknown;
  metadata: unknown;
};

type EvidenceRow = {
  source_id: string;
  evidence_role: string;
  quote: string | null;
  locator: unknown;
  position: number;
};

type FinalizeResult = {
  finalized: true;
  outcome: SignalTopicDiscoveryReviewOutcomeV1;
  review_digest: string;
  score_sheet_digest: string;
  decision_sheet_digest: string;
  operator_review_complete: true;
  modeling_adopted: false;
  ten_c3b_authorized: false;
  ten_d_ready: false;
};

const RUN_SELECT_SQL = `
  SELECT packet.artifact_id::text,packet.packet_digest,packet.discovery_run_digest,
    packet.candidate_artifact_digest,packet.packet_policy_version,packet.packet_policy_digest,
    packet.rights_digest,packet.rights_valid_until::text,packet.modeling_denominator,
    packet.proposal_count,packet.evidence_count,packet.outlier_evidence_count,
    packet.reference_seed,packet.review_scope,packet.registered_at::text,artifact.content,
    'review-'||substr(packet.packet_digest,8,16) AS run_key
  FROM signal_topic_discovery_review_packets packet
  JOIN analysis_artifacts artifact ON artifact.id=packet.artifact_id
`;

const LATEST_DECISIONS_CTE = `WITH latest AS (
  SELECT DISTINCT ON(decision.review_id,decision.proposal_artifact_id)
    decision.*,artifact.artifact_key AS proposal_key
  FROM signal_topic_discovery_review_decisions decision
  JOIN analysis_artifacts artifact ON artifact.id=decision.proposal_artifact_id
  ORDER BY decision.review_id,decision.proposal_artifact_id,decision.decision_revision DESC
)`;

const COMPLETE_DECISION_SQL = `latest.internal_coherence IS NOT NULL
  AND latest.neighbor_distinction IS NOT NULL AND latest.human_nameability IS NOT NULL
  AND latest.strategic_utility IS NOT NULL AND latest.merge_needed IS NOT NULL
  AND latest.split_needed IS NOT NULL
  AND latest.convert_to_topic_contract_candidate IS NOT NULL
  AND latest.none_acceptable IS NOT NULL`;

const INSERT_DECISION_SQL = `INSERT INTO signal_topic_discovery_review_decisions(
  workspace_id,review_id,proposal_artifact_id,decision_revision,supersedes_decision_id,
  state,candidate_artifact_digest,discovery_proposal_key,cluster_key,evidence_refs,
  data_split,reviewer_user_id,internal_coherence,neighbor_distinction,human_nameability,
  strategic_utility,merge_needed,split_needed,convert_to_topic_contract_candidate,
  none_acceptable,notes,decision_digest,operation_id
) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,'draft',$6,$7,$8,$9::text[],$10,
  $11::uuid,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::uuid)`;

async function insertEvidenceLinks(args: {
  queryable: Queryable;
  groupId: string;
  evidence: z.infer<typeof representativeSchema>[];
  evidenceAuthority: Map<string, SignalTopicDiscoveryEvidenceAuthorityV1>;
}) {
  if (args.evidence.length === 0) return;
  const values: unknown[] = [];
  const rows: string[] = [];
  args.evidence.forEach((item, index) => {
    const authority = args.evidenceAuthority.get(item.evidence_ref);
    if (!authority) throw new SignalTopicDiscoveryReviewError("topic_discovery_evidence_root_unresolved", 422);
    const offset = index * 8;
    rows.push(`($${offset + 1}::uuid,$${offset + 2},$${offset + 3}::uuid,'supports',$${offset + 4},
      $${offset + 5},$${offset + 6}::jsonb,NULL,NULL,$${offset + 7},$${offset + 8}::jsonb)`);
    values.push(args.groupId, "signal_canonical_root", authority.mentionId, item.role,
      item.excerpt, JSON.stringify({
        evidence_ref: item.evidence_ref,
        selection_reason: item.selection_reason,
        language: item.language,
        scope: item.scope,
        source_slice: item.source_slice,
        time_slice: item.time_slice,
        rights_digest: item.rights_digest
      }), index, JSON.stringify({
        visibility: "internal_private",
        full_text_stored: false,
        provider_eligible: false
      }));
  });
  await args.queryable.query(`
    INSERT INTO analysis_evidence_links(
      evidence_group_id,source_type,source_id,relation_type,evidence_role,quote,locator,
      confidence,weight,position,metadata
    ) VALUES ${rows.join(",")}
  `, values);
}

function operatorSafeProposalContent(packet: z.infer<typeof sealedPacketSchema>, scores: Record<string, unknown>) {
  const terms = safeStringList(packet.local_terms);
  const phrases = safeStringList(packet.local_phrases);
  return {
    contract_version: "signal-topic-discovery-proposal-content-v1",
    cluster_member_count: packet.cluster_member_count,
    population_denominator: packet.population_denominator,
    coverage: packet.coverage.cluster_share_of_reviewed_scope,
    local_terms: terms,
    local_phrases: phrases,
    local_terms_text: terms.join(" "),
    local_phrases_text: phrases.join(" "),
    distributions: packet.distributions,
    neighboring_clusters: packet.neighboring_clusters,
    stability: packet.stability,
    stability_score: numeric(safeRecord(packet.stability).matched_assignment_consistency),
    limitations: packet.limitations,
    representation_scores: scores,
    count_scope: packet.count_scope
  };
}

function publicProposalContent(value: unknown) {
  const content = safeRecord(value);
  return {
    cluster_member_count: numeric(content.cluster_member_count),
    population_denominator: numeric(content.population_denominator),
    coverage: numeric(content.coverage),
    local_terms: safeStringList(content.local_terms),
    local_phrases: safeStringList(content.local_phrases),
    distributions: safeRecord(content.distributions),
    neighboring_clusters: Array.isArray(content.neighboring_clusters) ? content.neighboring_clusters : [],
    stability: content.stability ?? { availability: "not_available" },
    limitations: safeStringList(content.limitations)
  };
}

function operatorSafeProposalListItem(row: ProposalListRow) {
  const content = safeRecord(row.content);
  return {
    key: row.proposal_key,
    label: row.title,
    position: row.position,
    size: numeric(content.cluster_member_count),
    coverage: numeric(content.coverage),
    scopes: Object.keys(safeRecord(safeRecord(content.distributions).scope)),
    stability: numeric(content.stability_score),
    review_status: row.reviewed ? "reviewed" : "pending",
    decisions: {
      merge_needed: row.merge_needed,
      split_needed: row.split_needed,
      topic_contract_candidate: row.convert_to_topic_contract_candidate,
      none_acceptable: row.none_acceptable
    }
  };
}

function operatorSafeRun(row: RunRow) {
  return {
    key: row.run_key,
    status: "operator_review_required" as const,
    proposal_count: row.proposal_count,
    evidence_count: row.evidence_count,
    outlier_evidence_count: row.outlier_evidence_count,
    modeling_denominator: row.modeling_denominator,
    reference_seed: row.reference_seed,
    review_scope: row.review_scope,
    packet_policy_version: row.packet_policy_version,
    registered_at: row.registered_at,
    holdout_opened: false,
    modeling_adopted: false
  };
}

function operatorSafeDecision(row: DecisionRow) {
  return {
    internal_coherence: row.internal_coherence,
    neighbor_distinction: row.neighbor_distinction,
    human_nameability: row.human_nameability,
    strategic_utility: row.strategic_utility,
    merge_needed: row.merge_needed,
    split_needed: row.split_needed,
    convert_to_topic_contract_candidate: row.convert_to_topic_contract_candidate,
    none_acceptable: row.none_acceptable,
    notes: row.notes,
    saved_at: row.reviewed_at
  };
}

function operatorSafeOutlierDecision(row: OutlierDecisionRow) {
  return {
    study_boundary_thresholds: row.study_boundary_thresholds,
    study_missing_topic_families: row.study_missing_topic_families,
    study_later_recovery: row.study_later_recovery,
    notes: row.notes,
    saved_at: row.reviewed_at
  };
}

function publicEvidenceLocator(value: unknown) {
  const locator = safeRecord(value);
  return {
    evidence_ref: shortDigest(String(locator.evidence_ref ?? "")),
    selection_reason: String(locator.selection_reason ?? ""),
    language: String(locator.language ?? "und"),
    scope: String(locator.scope ?? "unknown"),
    platform: String(locator.source_slice ?? "unknown"),
    period: String(locator.time_slice ?? "unknown")
  };
}

async function loadRunOrThrow(workspaceId: string, runKey?: string | null, queryable: Queryable = pool) {
  const result = await queryable.query<RunRow>(`${RUN_SELECT_SQL}
    WHERE packet.workspace_id=$1::uuid
      AND ($2::text IS NULL OR 'review-'||substr(packet.packet_digest,8,16)=$2)
    ORDER BY packet.registered_at DESC,packet.artifact_id DESC LIMIT 1`, [workspaceId, runKey ?? null]);
  const run = result.rows[0];
  if (!run) throw new SignalTopicDiscoveryReviewError("topic_discovery_review_not_found", 404);
  return run;
}

async function loadCurrentReview(packetArtifactId: string, workspaceId: string, queryable: Queryable = pool) {
  const result = await queryable.query<ReviewRow>(`
    SELECT review.id::text,review.review_revision,
      COALESCE(event.next_state,'open') AS state,event.outcome
    FROM signal_topic_discovery_reviews review
    LEFT JOIN LATERAL(
      SELECT next_state,outcome FROM signal_topic_discovery_review_events
      WHERE review_id=review.id ORDER BY created_at DESC,id DESC LIMIT 1
    ) event ON true
    WHERE review.workspace_id=$1::uuid AND review.packet_artifact_id=$2::uuid
      AND NOT EXISTS(SELECT 1 FROM signal_topic_discovery_reviews newer
        WHERE newer.supersedes_review_id=review.id)
    ORDER BY review.review_revision DESC LIMIT 1
  `, [workspaceId, packetArtifactId]);
  const review = result.rows[0];
  if (!review) throw new SignalTopicDiscoveryReviewError("topic_discovery_review_state_missing", 409);
  return review;
}

async function loadCurrentReviewForWrite(queryable: Queryable, packetArtifactId: string, workspaceId: string) {
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `signal-topic-discovery-review-write:${workspaceId}:${packetArtifactId}`
  ]);
  return loadCurrentReview(packetArtifactId, workspaceId, queryable);
}

async function loadProposalForWrite(queryable: Queryable, workspaceId: string, proposalKey: string) {
  const result = await queryable.query<{
    packet_artifact_id: string;
    artifact_id: string;
    metadata: unknown;
  }>(`
    SELECT packet.artifact_id::text AS packet_artifact_id,artifact.id::text AS artifact_id,
      artifact.metadata
    FROM analysis_artifacts artifact
    JOIN analysis_artifact_relations relation ON relation.target_artifact_id=artifact.id
      AND relation.relation_type='contains_proposal'
    JOIN signal_topic_discovery_review_packets packet ON packet.artifact_id=relation.source_artifact_id
    WHERE packet.workspace_id=$1::uuid AND artifact.artifact_key=$2
  `, [workspaceId, proposalKey]);
  const row = result.rows[0];
  if (!row) throw new SignalTopicDiscoveryReviewError("topic_discovery_proposal_not_found", 404);
  return row;
}

async function loadLatestDecision(reviewId: string, proposalArtifactId: string, queryable: Queryable = pool) {
  const result = await queryable.query<DecisionRow>(`${LATEST_DECISIONS_CTE}
    SELECT * FROM latest WHERE review_id=$1::uuid AND proposal_artifact_id=$2::uuid`,
  [reviewId, proposalArtifactId]);
  return result.rows[0] ?? null;
}

async function loadAllLatestDecisions(reviewId: string, queryable: Queryable = pool) {
  const result = await queryable.query<DecisionRow>(`${LATEST_DECISIONS_CTE}
    SELECT * FROM latest WHERE review_id=$1::uuid ORDER BY proposal_key`, [reviewId]);
  return result.rows;
}

async function loadLatestOutlierDecision(reviewId: string, queryable: Queryable = pool) {
  const result = await queryable.query<OutlierDecisionRow>(`
    SELECT id::text,decision_revision,state,study_boundary_thresholds,
      study_missing_topic_families,study_later_recovery,notes,decision_digest,reviewed_at::text
    FROM signal_topic_discovery_outlier_decisions WHERE review_id=$1::uuid
    ORDER BY decision_revision DESC LIMIT 1
  `, [reviewId]);
  return result.rows[0] ?? null;
}

async function loadProposalEvidenceRefs(queryable: Queryable, artifactId: string) {
  const result = await queryable.query<{ evidence_ref: string }>(`
    SELECT link.locator->>'evidence_ref' AS evidence_ref
    FROM analysis_evidence_groups evidence_group
    JOIN analysis_evidence_links link ON link.evidence_group_id=evidence_group.id
    WHERE evidence_group.artifact_id=$1::uuid AND evidence_group.group_key='representatives'
    ORDER BY link.position,link.id
  `, [artifactId]);
  const refs = result.rows.map((row) => row.evidence_ref);
  if (refs.length === 0 || refs.some((ref) => !DIGEST.test(ref))) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_proposal_evidence_missing", 409);
  }
  return refs;
}

async function assertPacketRightsCurrent(run: Pick<RunRow, "artifact_id" | "rights_valid_until"> | Pick<ProposalDetailRow, "packet_artifact_id" | "rights_valid_until">, queryable: Queryable = pool) {
  if (run.rights_valid_until && Date.parse(run.rights_valid_until) <= Date.now()) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_review_rights_expired", 403);
  }
  const artifactId = "packet_artifact_id" in run ? run.packet_artifact_id : run.artifact_id;
  const sources = await queryable.query<{ source_id: string }>(`
    SELECT DISTINCT link.source_id::text
    FROM analysis_artifact_relations relation
    JOIN analysis_evidence_groups evidence_group ON evidence_group.artifact_id=relation.target_artifact_id
    JOIN analysis_evidence_links link ON link.evidence_group_id=evidence_group.id
    WHERE relation.source_artifact_id=$1::uuid AND relation.relation_type='contains_proposal'
    UNION
    SELECT DISTINCT link.source_id::text
    FROM analysis_evidence_groups evidence_group
    JOIN analysis_evidence_links link ON link.evidence_group_id=evidence_group.id
    WHERE evidence_group.artifact_id=$1::uuid
  `, [artifactId]);
  await assertEvidenceRightsCurrent(queryable, "", sources.rows.map((row) => row.source_id), artifactId);
}

async function assertEvidenceRightsCurrent(queryable: Queryable, workspaceId: string,
  mentionIds: string[], packetArtifactId?: string) {
  if (mentionIds.length === 0) return;
  const result = await queryable.query<{ eligible: number; expected: number }>(`
    WITH target AS (SELECT unnest($1::uuid[]) AS mention_id),workspace_scope AS (
      SELECT COALESCE($2::uuid,(SELECT workspace_id FROM signal_topic_discovery_review_packets
        WHERE artifact_id=$3::uuid)) AS workspace_id
    ),eligible AS (
      SELECT DISTINCT target.mention_id
      FROM target CROSS JOIN workspace_scope scope
      JOIN mentions root ON root.id=target.mention_id AND root.workspace_id=scope.workspace_id
        AND root.canonical_mention_id=root.id
      JOIN mentions member ON member.workspace_id=root.workspace_id
        AND member.canonical_mention_id=root.id
      JOIN signal_provider_mention_observations observation
        ON observation.workspace_id=member.workspace_id AND observation.mention_id=member.id
        AND NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
          WHERE successor.supersedes_observation_id=observation.id)
      JOIN import_batches batch ON batch.id=observation.import_batch_id
        AND batch.workspace_id=observation.workspace_id AND batch.status='completed'
      JOIN signal_provenance_policy_bindings binding
        ON binding.id=observation.provenance_binding_id AND binding.workspace_id=root.workspace_id
        AND binding.status='active' AND binding.effective_from<=transaction_timestamp()
        AND (binding.effective_to IS NULL OR binding.effective_to>transaction_timestamp())
      JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
        AND quality.status='active' AND quality.effective_from<=transaction_timestamp()
        AND (quality.effective_to IS NULL OR quality.effective_to>transaction_timestamp())
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.status='active' AND retention.retention_state='allowed'
        AND retention.effective_from<=transaction_timestamp()
        AND (retention.effective_to IS NULL OR retention.effective_to>transaction_timestamp())
        AND (retention.retain_until IS NULL OR retention.retain_until>transaction_timestamp())
        AND (observation.retention_until IS NULL OR observation.retention_until>transaction_timestamp())
      JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.status='active' AND licensing.effective_from<=transaction_timestamp()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>transaction_timestamp())
      JOIN signal_licensing_policy_usages usage ON usage.licensing_policy_id=licensing.id
        AND usage.usage_purpose='strategic-analysis' AND usage.decision='allowed'
      WHERE observation.rights_definition_hash=binding.definition_hash
    ) SELECT (SELECT count(*)::int FROM eligible) AS eligible,
      (SELECT count(*)::int FROM target) AS expected
  `, [mentionIds, workspaceId || null, packetArtifactId ?? null]);
  if (result.rows[0]?.eligible !== result.rows[0]?.expected) {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_review_rights_unavailable", 403);
  }
}

function buildContractualReviewExports(run: RunRow, decisions: DecisionRow[],
  outlier: OutlierDecisionRow, outcome: SignalTopicDiscoveryReviewOutcomeV1) {
  const header = ["proposal_key","internal_coherence","neighbor_distinction","human_nameability",
    "strategic_utility","merge_needed","split_needed","topic_contract_candidate",
    "none_acceptable","notes"];
  const scoreRows = decisions.map((decision) => [decision.proposal_key, decision.internal_coherence,
    decision.neighbor_distinction, decision.human_nameability, decision.strategic_utility,
    decision.merge_needed, decision.split_needed, decision.convert_to_topic_contract_candidate,
    decision.none_acceptable, decision.notes]);
  const scoreSheet = csv([header, ...scoreRows]);
  const decisionSheet = csv([
    ["review_outcome","study_boundary_thresholds","study_missing_topic_families",
      "study_later_recovery","notes","modeling_adopted","ten_c3b_authorized","ten_d_ready"],
    [outcome, outlier.study_boundary_thresholds, outlier.study_missing_topic_families,
      outlier.study_later_recovery, outlier.notes, false, false, false]
  ]);
  return {
    scoreSheet,
    decisionSheet,
    scoreSheetDigest: sha256(scoreSheet),
    decisionSheetDigest: sha256(decisionSheet),
    packetDigest: run.packet_digest
  };
}

function normalizeFilters(filters: SignalTopicDiscoveryReviewListFiltersV1) {
  return {
    status: filters.status ?? null,
    decision: filters.decision ?? null,
    scope: normalizeOptional(filters.scope, 80),
    search: normalizeOptional(filters.search, 120),
    size: filters.size ?? null,
    stability: filters.stability ?? null
  };
}

function encodeCursor(value: { packetDigest: string; filterDigest: string; position: number }) {
  const payload = { ...value, contract_version: "signal-topic-discovery-review-cursor-v1" };
  const sealed = { ...payload, cursor_digest: sha256(stableJson(payload)) };
  return Buffer.from(JSON.stringify(sealed)).toString("base64url");
}

function decodeCursor(value: string, packetDigest: string, filterDigest: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const digest = parsed.cursor_digest;
    delete parsed.cursor_digest;
    if (digest !== sha256(stableJson(parsed)) || parsed.packetDigest !== packetDigest
      || parsed.filterDigest !== filterDigest || !Number.isInteger(parsed.position)) {
      throw new Error("cursor_mismatch");
    }
    return { position: Number(parsed.position) };
  } catch {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_review_cursor_invalid", 400);
  }
}

function isCompleteDecision(value: DecisionRow) {
  return value.internal_coherence !== null && value.neighbor_distinction !== null
    && value.human_nameability !== null && value.strategic_utility !== null
    && value.merge_needed !== null && value.split_needed !== null
    && value.convert_to_topic_contract_candidate !== null && value.none_acceptable !== null;
}

function isCompleteOutlierDecision(value: OutlierDecisionRow) {
  return value.study_boundary_thresholds !== null
    && value.study_missing_topic_families !== null
    && value.study_later_recovery !== null;
}

function assertReviewOpen(review: ReviewRow) {
  if (review.state !== "open") throw new SignalTopicDiscoveryReviewError("topic_discovery_review_locked", 409);
}

function requireInternalActor(actor: SignalWorkspaceUser) {
  if (actor.userType !== "noisia_internal") {
    throw new SignalTopicDiscoveryReviewError("topic_discovery_review_forbidden", 403);
  }
}

async function withSerializableTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function proposalPublicKey(index: number) {
  return `proposal-${String(index + 1).padStart(3, "0")}`;
}

function blindProposalLabel(index: number) {
  return `Propuesta ${String(index + 1).padStart(3, "0")}`;
}

function reviewPublicKey(id: string) {
  return `review-${sha256(id).slice(7, 23)}`;
}

function runPublicKey(packetDigest: string) {
  return `review-${packetDigest.slice(7, 23)}`;
}

function shortDigest(value: string) {
  return DIGEST.test(value) ? `${value.slice(0, 15)}…${value.slice(-6)}` : "not_available";
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function safeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : String(safeRecord(item).term ?? safeRecord(item).phrase ?? ""))
      .map((item) => item.trim()).filter(Boolean).slice(0, 40)
    : [];
}

function numeric(value: unknown) {
  const result = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function normalizeOptional(value: string | undefined, maximum: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function csv(rows: unknown[][]) {
  return `${rows.map((row) => row.map(csvValue).join(",")).join("\n")}\n`;
}

function csvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function cryptoUuid() {
  return globalThis.crypto.randomUUID();
}

function hmacDigest(key: Buffer, value: string) {
  return `sha256:${createHmac("sha256", key).update(value).digest("hex")}`;
}

function compareNullableDates(left: string | null, right: string | null) {
  const leftValue = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightValue = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  return leftValue - rightValue;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
