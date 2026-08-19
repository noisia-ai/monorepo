import { createHash } from "node:crypto";

import {
  SIGNAL_DATA_USAGE_PURPOSES,
  signalServingUsagePurposesForModuleViewV1,
  signalLicensingPolicyDefinitionHashV1,
  signalProvenancePolicyBindingDefinitionHashV1,
  signalQualityPolicyDefinitionHashV1,
  signalRetentionPolicyDefinitionHashV1,
  signalGovernedModuleViewContractV1,
  type SignalDataGovernanceReasonCodeV1,
  type SignalDataUsagePurposeV1,
  type SignalGovernedViewKeyV1,
  type SignalGovernedViewModuleKeyV1,
  type SignalLicensingPolicyDefinitionV1,
  type SignalProvenancePolicyBindingDefinitionV1,
  type SignalQualityPolicyDefinitionV1,
  type SignalRetentionPolicyDefinitionV1
} from "@noisia/query-engine";

import type { SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";

const EMPTY_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type SignalDataGovernancePolicyKindV1 =
  | "quality-policy"
  | "retention-policy"
  | "licensing-policy"
  | "provenance-binding";

export type SignalDataGovernanceEvaluationV1 = {
  evaluation_id: string;
  policy_evaluation_watermark: string;
  quality_policy_id: string;
  quality_policy_version: number;
  quality_policy_hash: string;
  usage_purposes: SignalDataUsagePurposeV1[];
  candidate_root_count: number;
  authorized_root_count: number;
  quality_blocked_count: number;
  retention_blocked_count: number;
  licensing_blocked_count: number;
  governance_unknown_count: number;
  retention_policy_digest: string;
  licensing_policy_digest: string;
  governance_digest: string;
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: SignalGovernedViewKeyV1;
  next_policy_transition_at: string | null;
  governance_data_watermark_id: string | null;
  reason_counts: Partial<Record<SignalDataGovernanceReasonCodeV1, number>>;
};

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertInternalActor(actor: SignalWorkspaceUser) {
  if (actor.userType !== "noisia_internal") {
    throw new Error("Data governance writers require an internal server-resolved actor.");
  }
}

async function assertActorWorkspace(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  actor: SignalWorkspaceUser
) {
  assertInternalActor(actor);
  const result = await queryable.query<{ allowed: boolean }>(`
    SELECT signal_data_governance_actor_is_valid($1::uuid, $2::uuid) AS allowed
  `, [workspaceId, actor.id]);
  if (result.rows[0]?.allowed !== true) throw new Error("Data governance actor is not authorized for this workspace.");
}

export async function ensureSignalQualityPolicyDraftV1(args: {
  queryable: SignalBrandPolicyQueryable;
  organizationId: string;
  actor: SignalWorkspaceUser;
  definition: SignalQualityPolicyDefinitionV1;
  idempotencyKey: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}) {
  await assertActorWorkspace(args.queryable, args.definition.workspace_id, args.actor);
  const definitionHash = signalQualityPolicyDefinitionHashV1(args.definition);
  const inserted = await args.queryable.query<{ object_id: string; object_status: string; created: boolean }>(`
    SELECT object_id::text, object_status, created
    FROM create_signal_quality_policy_draft(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::text[],$8::text[],$9,$10,$11,
      COALESCE($12::timestamptz,clock_timestamp()),$13::timestamptz
    )
  `, [
    args.organizationId, args.definition.workspace_id, args.actor.id,
    args.definition.policy_key,
    args.definition.policy_version, args.definition.min_quality_score,
    args.definition.required_quality_flags, args.definition.forbidden_quality_flags,
    args.definition.canonical_root_disposition, definitionHash, args.idempotencyKey,
    args.effectiveFrom ?? null, args.effectiveTo ?? null
  ]);
  const row = inserted.rows[0]!;
  return { policy_id: row.object_id, definition_hash: definitionHash, status: row.object_status, created: row.created };
}

export async function ensureSignalRetentionPolicyDraftV1(args: {
  queryable: SignalBrandPolicyQueryable;
  organizationId: string;
  actor: SignalWorkspaceUser;
  definition: SignalRetentionPolicyDefinitionV1;
  idempotencyKey: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}) {
  await assertActorWorkspace(args.queryable, args.definition.workspace_id, args.actor);
  const definitionHash = signalRetentionPolicyDefinitionHashV1(args.definition);
  const inserted = await args.queryable.query<{ object_id: string; object_status: string; created: boolean }>(`
    SELECT object_id::text, object_status, created
    FROM create_signal_retention_policy_draft(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,
      COALESCE($13::timestamptz,clock_timestamp()),$14::timestamptz
    )
  `, [
    args.organizationId, args.definition.workspace_id, args.actor.id,
    args.definition.policy_key,
    args.definition.policy_version, args.definition.retention_state,
    args.definition.retention_mode, args.definition.retain_until,
    args.definition.expiry_action, args.definition.approval_evidence_hash,
    definitionHash, args.idempotencyKey, args.effectiveFrom ?? null, args.effectiveTo ?? null
  ]);
  const row = inserted.rows[0]!;
  return { policy_id: row.object_id, definition_hash: definitionHash, status: row.object_status, created: row.created };
}

export async function ensureSignalLicensingPolicyDraftV1(args: {
  queryable: SignalBrandPolicyQueryable;
  organizationId: string;
  actor: SignalWorkspaceUser;
  definition: SignalLicensingPolicyDefinitionV1;
  idempotencyKey: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}) {
  await assertActorWorkspace(args.queryable, args.definition.workspace_id, args.actor);
  const definitionHash = signalLicensingPolicyDefinitionHashV1(args.definition);
  const usages = [...args.definition.usages].sort((a, b) => a.usage_purpose.localeCompare(b.usage_purpose));
  const inserted = await args.queryable.query<{ object_id: string; object_status: string; created: boolean }>(`
    SELECT object_id::text, object_status, created
    FROM create_signal_licensing_policy_draft(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::text[],$8::text[],$9,$10,
      COALESCE($11::timestamptz,clock_timestamp()),$12::timestamptz
    )
  `, [
    args.organizationId, args.definition.workspace_id, args.actor.id,
    args.definition.policy_key,
    args.definition.policy_version, args.definition.approval_evidence_hash,
    usages.map((usage) => usage.usage_purpose), usages.map((usage) => usage.decision),
    definitionHash, args.idempotencyKey, args.effectiveFrom ?? null, args.effectiveTo ?? null
  ]);
  const row = inserted.rows[0]!;
  return { policy_id: row.object_id, definition_hash: definitionHash, status: row.object_status, created: row.created };
}

export async function ensureSignalProvenancePolicyBindingDraftV1(args: {
  queryable: SignalBrandPolicyQueryable;
  actor: SignalWorkspaceUser;
  definition: SignalProvenancePolicyBindingDefinitionV1;
  idempotencyKey: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}) {
  await assertActorWorkspace(args.queryable, args.definition.workspace_id, args.actor);
  const definitionHash = signalProvenancePolicyBindingDefinitionHashV1(args.definition);
  const inserted = await args.queryable.query<{ object_id: string; object_status: string; created: boolean }>(`
    SELECT object_id::text, object_status, created
    FROM create_signal_provenance_policy_binding_draft(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,$9,$10,
      COALESCE($11::timestamptz,clock_timestamp()),$12::timestamptz
    )
  `, [
    args.definition.workspace_id, args.actor.id, args.definition.data_source_id,
    args.definition.import_batch_id,
    args.definition.binding_version, args.definition.quality_policy_id,
    args.definition.retention_policy_id, args.definition.licensing_policy_id,
    definitionHash, args.idempotencyKey, args.effectiveFrom ?? null, args.effectiveTo ?? null
  ]);
  const row = inserted.rows[0]!;
  return { binding_id: row.object_id, definition_hash: definitionHash, status: row.object_status, created: row.created };
}

export async function activateSignalDataGovernanceObjectV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  actor: SignalWorkspaceUser;
  objectKind: SignalDataGovernancePolicyKindV1;
  objectId: string;
  idempotencyKey: string;
}) {
  await assertActorWorkspace(args.queryable, args.workspaceId, args.actor);
  const inputHash = hash([
    "signal-data-governance-activation-v1", args.workspaceId, args.objectKind,
    args.objectId, args.actor.id
  ].join("\u001f"));
  const result = await args.queryable.query<{
    object_id: string;
    activated: boolean;
    replayed: boolean;
  }>(`
    SELECT object_id::text, activated, replayed
    FROM activate_signal_data_governance_object(
      $1::uuid,$2::uuid,$3,$4::uuid,$5,$6
    )
  `, [
    args.workspaceId, args.actor.id, args.objectKind, args.objectId,
    inputHash, args.idempotencyKey
  ]);
  return result.rows[0]!;
}

export async function evaluateSignalViewDataGovernanceV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  policyBundleId: string;
  populationId: string;
  actor: SignalWorkspaceUser;
  moduleKey: SignalGovernedViewModuleKeyV1;
  viewKey: SignalGovernedViewKeyV1;
  reconcileMemberships: boolean;
}): Promise<SignalDataGovernanceEvaluationV1> {
  await assertActorWorkspace(args.queryable, args.workspaceId, args.actor);
  const moduleViewContractVersion = args.moduleKey === "triggers-barriers" && args.viewKey === "strategic"
    ? "signal-strategic-gate-d-v1"
    : signalGovernedModuleViewContractV1(args.moduleKey, args.viewKey).contract_version;
  const usagePurposes = signalServingUsagePurposesForModuleViewV1(args.moduleKey, args.viewKey);
  const authority = await args.queryable.query<{
    quality_policy_id: string;
    quality_policy_version: number;
    quality_policy_hash: string;
    min_quality_score: number | null;
    required_quality_flags: string[];
    forbidden_quality_flags: string[];
    canonical_root_disposition: string;
    policy_evaluation_watermark: string;
    authority_digest: string;
    governance_data_watermark_id: string | null;
  }>(`
    SELECT quality.id::text AS quality_policy_id, quality.policy_version AS quality_policy_version,
      quality.definition_hash AS quality_policy_hash,
      quality.min_quality_score,
      quality.required_quality_flags, quality.forbidden_quality_flags,
      quality.canonical_root_disposition, clock_timestamp()::text AS policy_evaluation_watermark,
      'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
        bundle.definition_hash, quality.definition_hash,
        COALESCE((SELECT string_agg(concat_ws(':', binding.id::text, binding.definition_hash,
          retention.definition_hash, licensing.definition_hash,
          binding.effective_from::text,COALESCE(binding.effective_to::text,'∅'),
          retention.effective_from::text,COALESCE(retention.effective_to::text,'∅'),
          COALESCE(retention.retain_until::text,'∅'),licensing.effective_from::text,
          COALESCE(licensing.effective_to::text,'∅'),
          CASE WHEN binding.effective_from > clock_timestamp() THEN 'binding-future'
            WHEN binding.effective_to IS NOT NULL AND binding.effective_to <= clock_timestamp()
              THEN 'binding-expired' ELSE 'binding-current' END,
          CASE WHEN retention.effective_from > clock_timestamp() THEN 'retention-future'
            WHEN retention.effective_to IS NOT NULL AND retention.effective_to <= clock_timestamp()
              THEN 'retention-expired-effective-window'
            WHEN retention.retention_mode='until' AND retention.retain_until <= clock_timestamp()
              THEN 'retention-expired-retain-until' ELSE 'retention-current' END,
          CASE WHEN licensing.effective_from > clock_timestamp() THEN 'licensing-future'
            WHEN licensing.effective_to IS NOT NULL AND licensing.effective_to <= clock_timestamp()
              THEN 'licensing-expired' ELSE 'licensing-current' END,
          CASE WHEN retention.retention_mode='until' AND retention.retain_until <= clock_timestamp()
            THEN 'expired' ELSE 'current' END), ',' ORDER BY binding.id)
          FROM signal_provenance_policy_bindings binding
          JOIN signal_retention_policies retention ON retention.id = binding.retention_policy_id
          JOIN signal_licensing_policies licensing ON licensing.id = binding.licensing_policy_id
          WHERE binding.workspace_id = bundle.workspace_id AND binding.status = 'active'), ''),
        COALESCE((SELECT string_agg(concat_ws(':', provenance.canonical_mention_id::text,
          membership.mention_id::text, membership.import_batch_id::text,
          membership.data_source_id::text), ','
          ORDER BY provenance.canonical_mention_id, membership.mention_id, membership.import_batch_id)
          FROM signal_mention_import_memberships membership
          JOIN mentions provenance ON provenance.id=membership.mention_id
            AND provenance.workspace_id=membership.workspace_id
          WHERE membership.workspace_id = bundle.workspace_id), ''),
        COALESCE((SELECT string_agg(concat_ws(':', mention.id::text,
          mention.inclusion_status, COALESCE(mention.quality_score::text,'∅'),
          COALESCE(mention.quality_flags::text,'[]'), mention.updated_at::text), ',' ORDER BY mention.id)
          FROM mentions mention WHERE mention.workspace_id=bundle.workspace_id
            AND mention.canonical_mention_id=mention.id), ''),
        COALESCE((SELECT string_agg(concat_ws(':', assertion.mention_id::text,
          assertion.scope, assertion.entity_type, COALESCE(assertion.entity_id::text,'∅'),
          assertion.review_status, assertion.eligibility_status, assertion.updated_at::text), ','
          ORDER BY assertion.mention_id, assertion.scope, assertion.entity_type, assertion.entity_id)
          FROM signal_mention_attributions assertion
          WHERE assertion.workspace_id=bundle.workspace_id
            AND assertion.attribution_basis='mention_semantic' AND assertion.is_current), ''),
        COALESCE((SELECT string_agg(concat_ws(':', usage.licensing_policy_id::text,
          usage.usage_purpose,usage.decision), ','
          ORDER BY usage.licensing_policy_id,usage.usage_purpose)
          FROM signal_licensing_policy_usages usage
          JOIN signal_licensing_policies licensing ON licensing.id=usage.licensing_policy_id
          WHERE licensing.workspace_id=bundle.workspace_id), ''),
        COALESCE((SELECT string_agg(concat_ws(':', watermark.id::text,
          watermark.accepted_at::text, COALESCE(watermark.max_observed_at::text,'∅'),
          watermark.data_freshness_state), ',' ORDER BY watermark.id)
          FROM signal_data_watermarks watermark
          WHERE watermark.workspace_id=bundle.workspace_id
            AND watermark.population_id=$3::uuid), '')
      ), 'UTF8')), 'hex') AS authority_digest,
      (SELECT watermark.id::text FROM signal_data_watermarks watermark
        WHERE watermark.workspace_id=bundle.workspace_id
          AND watermark.population_id=$3::uuid
        ORDER BY watermark.accepted_at DESC,watermark.id DESC LIMIT 1
      ) AS governance_data_watermark_id
    FROM signal_population_policy_bundles bundle
    JOIN signal_quality_policies quality ON quality.id = bundle.quality_policy_id
    WHERE bundle.id = $2::uuid AND bundle.workspace_id = $1::uuid
      AND bundle.status IN ('draft','active')
      AND bundle.data_governance_contract_status = 'resolved'
      AND quality.status = 'active' AND quality.workspace_id = bundle.workspace_id
      AND quality.canonical_root_disposition = 'evaluate'
      AND quality.effective_from <= clock_timestamp()
      AND (quality.effective_to IS NULL OR quality.effective_to > clock_timestamp())
      AND $4::text[] <@ bundle.required_usage_purposes
  `, [args.workspaceId, args.policyBundleId, args.populationId, usagePurposes]);
  const governed = authority.rows[0];
  if (!governed || usagePurposes.length === 0
    || !usagePurposes.every((purpose) => SIGNAL_DATA_USAGE_PURPOSES.includes(purpose))) {
    throw new Error(`${args.viewKey} policy has no active relational data-governance authority.`);
  }
  const evaluationKeyParts = args.viewKey === "brand"
    ? [
      "signal-brand-governance-evaluation-v1", args.workspaceId, args.policyBundleId,
      args.populationId, governed.quality_policy_hash, governed.authority_digest,
      args.moduleKey, "brand", usagePurposes.join(",")
    ]
    : [
      "signal-view-governance-evaluation-v1", args.workspaceId, args.policyBundleId,
      args.populationId, governed.quality_policy_hash, governed.authority_digest,
      args.moduleKey, args.viewKey, usagePurposes.join(","), moduleViewContractVersion
    ];
  const evaluationKey = hash(evaluationKeyParts.join("\u001f"));
  const existing = await args.queryable.query<SignalDataGovernanceEvaluationV1 & { evaluation_status: string }>(`
    SELECT evaluation.id::text AS evaluation_id, evaluation.policy_evaluation_watermark::text,
      quality.id::text AS quality_policy_id, quality.policy_version AS quality_policy_version,
      quality.definition_hash AS quality_policy_hash, evaluation.usage_purposes,
      evaluation.candidate_root_count, evaluation.authorized_root_count,
      evaluation.quality_blocked_count, evaluation.retention_blocked_count,
      evaluation.licensing_blocked_count, evaluation.governance_unknown_count,
      evaluation.retention_policy_digest, evaluation.licensing_policy_digest,
      evaluation.governance_digest, evaluation.evaluation_status,
      evaluation.module_key,evaluation.view_key,
      evaluation.next_policy_transition_at::text,
      $3::text AS governance_data_watermark_id
    FROM signal_data_governance_evaluations evaluation
    JOIN signal_quality_policies quality ON quality.id = evaluation.quality_policy_id
    WHERE evaluation.workspace_id = $1::uuid AND evaluation.idempotency_key = $2
      AND (evaluation.next_policy_transition_at IS NULL
        OR evaluation.next_policy_transition_at > clock_timestamp())
  `, [args.workspaceId, evaluationKey, governed.governance_data_watermark_id]);
  let evaluationId = existing.rows[0]?.evaluation_id;
  if (!evaluationId) {
    const inserted = await args.queryable.query<{ id: string }>(`
      INSERT INTO signal_data_governance_evaluations (
        workspace_id, policy_bundle_id, population_id, quality_policy_id,
        usage_purposes, evaluation_status, retention_policy_digest,
        licensing_policy_digest, policy_evaluation_watermark, governance_digest,
        definition_hash, evaluated_by_user_id, idempotency_key,module_key,view_key
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text[],'draft',$6,$6,
        $7::timestamptz,$6,$6,$8::uuid,$9,$10,$11) RETURNING id::text
    `, [args.workspaceId, args.policyBundleId, args.populationId, governed.quality_policy_id,
      usagePurposes, EMPTY_HASH, governed.policy_evaluation_watermark,
      args.actor.id, evaluationKey,args.moduleKey,args.viewKey]);
    evaluationId = inserted.rows[0]!.id;
    await args.queryable.query(buildGovernanceEvaluationItemsSql(), [
      args.workspaceId, args.policyBundleId, evaluationId, governed.quality_policy_id,
      governed.min_quality_score, governed.required_quality_flags,
      governed.forbidden_quality_flags, governed.canonical_root_disposition,
      usagePurposes, governed.policy_evaluation_watermark
    ]);
    await args.queryable.query(`
      WITH summary AS (
        SELECT count(*)::int AS candidate_root_count,
          count(*) FILTER (WHERE decision='included')::int AS authorized_root_count,
          count(*) FILTER (WHERE reason_code='quality_not_eligible')::int AS quality_blocked_count,
          count(*) FILTER (WHERE reason_code IN ('retention_expired','retention_blocked'))::int AS retention_blocked_count,
          count(*) FILTER (WHERE reason_code='licensing_prohibited')::int AS licensing_blocked_count,
          count(*) FILTER (WHERE reason_code IN ('retention_not_available','licensing_not_available','no_authorized_provenance'))::int AS governance_unknown_count
        FROM signal_data_governance_evaluation_items WHERE evaluation_id=$1::uuid
      ), retention_digest AS (
        SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(DISTINCT
          policy.id::text || ':' || policy.definition_hash, ',' ORDER BY policy.id::text || ':' || policy.definition_hash), ''), 'UTF8')), 'hex') AS value
        FROM signal_data_governance_evaluation_items item LEFT JOIN signal_retention_policies policy ON policy.id=item.retention_policy_id
        WHERE item.evaluation_id=$1::uuid
      ), licensing_digest AS (
        SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(DISTINCT
          policy.id::text || ':' || policy.definition_hash, ',' ORDER BY policy.id::text || ':' || policy.definition_hash), ''), 'UTF8')), 'hex') AS value
        FROM signal_data_governance_evaluation_items item LEFT JOIN signal_licensing_policies policy ON policy.id=item.licensing_policy_id
        WHERE item.evaluation_id=$1::uuid
      ), governance_digest AS (
        SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws(':',
          item.mention_id::text,item.decision,item.reason_code,COALESCE(item.import_membership_id::text,'∅'),
          COALESCE(item.provenance_binding_id::text,'∅'),item.quality_policy_id::text,
          COALESCE(item.retention_policy_id::text,'∅'),COALESCE(item.licensing_policy_id::text,'∅'),item.governance_path_hash
        ), ',' ORDER BY item.mention_id), ''), 'UTF8')), 'hex') AS value
        FROM signal_data_governance_evaluation_items item WHERE item.evaluation_id=$1::uuid
      ), calculated AS (
        SELECT summary.*, retention_digest.value AS retention_policy_digest,
          licensing_digest.value AS licensing_policy_digest, governance_digest.value AS governance_digest
        FROM summary, retention_digest, licensing_digest, governance_digest
      )
      UPDATE signal_data_governance_evaluations evaluation SET
        evaluation_status='complete', candidate_root_count=calculated.candidate_root_count,
        authorized_root_count=calculated.authorized_root_count,
        quality_blocked_count=calculated.quality_blocked_count,
        retention_blocked_count=calculated.retention_blocked_count,
        licensing_blocked_count=calculated.licensing_blocked_count,
        governance_unknown_count=calculated.governance_unknown_count,
        retention_policy_digest=calculated.retention_policy_digest,
        licensing_policy_digest=calculated.licensing_policy_digest,
        governance_digest=calculated.governance_digest,
        next_policy_transition_at=signal_data_governance_next_transition(evaluation.id),
        definition_hash='sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
          'signal-data-governance-evaluation-v1',evaluation.workspace_id::text,
          evaluation.policy_bundle_id::text,evaluation.population_id::text,evaluation.quality_policy_id::text,
          evaluation.module_key,evaluation.view_key,
          array_to_string(evaluation.usage_purposes,','),evaluation.policy_evaluation_watermark::text,
          calculated.candidate_root_count::text,calculated.authorized_root_count::text,
          calculated.quality_blocked_count::text,calculated.retention_blocked_count::text,
          calculated.licensing_blocked_count::text,calculated.governance_unknown_count::text,
          calculated.retention_policy_digest,calculated.licensing_policy_digest,calculated.governance_digest
        ),'UTF8')),'hex'), finalized_at=now()
      FROM calculated WHERE evaluation.id=$1::uuid
    `, [evaluationId]);
  }
  if (args.reconcileMemberships) {
    await args.queryable.query(`
      UPDATE signal_population_memberships membership SET membership_status='excluded',
        membership_reason=COALESCE((SELECT item.reason_code
          FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id=evaluation.id AND item.mention_id=membership.mention_id),
          'no_authorized_provenance'),
        removed_at=COALESCE(membership.removed_at,now())
      FROM signal_data_governance_evaluations evaluation
      WHERE evaluation.id=$1::uuid AND membership.population_id=evaluation.population_id
        AND membership.workspace_id=evaluation.workspace_id
        AND membership.membership_status='included' AND membership.removed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM signal_data_governance_evaluation_items item
          WHERE item.evaluation_id=evaluation.id AND item.mention_id=membership.mention_id
            AND item.decision='included')
    `, [evaluationId]);
    await args.queryable.query(`
      INSERT INTO signal_population_memberships (
        population_id,workspace_id,mention_id,membership_status,membership_reason,effective_at,removed_at
      ) SELECT evaluation.population_id,evaluation.workspace_id,item.mention_id,'included','policy_eligible',now(),NULL
      FROM signal_data_governance_evaluations evaluation
      JOIN signal_data_governance_evaluation_items item ON item.evaluation_id=evaluation.id
      WHERE evaluation.id=$1::uuid AND item.decision='included'
      ON CONFLICT (population_id,mention_id) DO UPDATE SET membership_status='included',
        membership_reason='policy_eligible',removed_at=NULL,
        effective_at=CASE WHEN signal_population_memberships.membership_status<>'included'
          OR signal_population_memberships.removed_at IS NOT NULL THEN now()
          ELSE signal_population_memberships.effective_at END
      WHERE signal_population_memberships.membership_status<>'included'
        OR signal_population_memberships.removed_at IS NOT NULL
        OR signal_population_memberships.membership_reason<>'policy_eligible'
    `, [evaluationId]);
    await args.queryable.query(
      "SELECT refresh_signal_governed_view_population_membership_digest($1::uuid)",
      [args.populationId]
    );
  }
  const resolved = await args.queryable.query<SignalDataGovernanceEvaluationV1>(`
    SELECT evaluation.id::text AS evaluation_id,evaluation.policy_evaluation_watermark::text,
      quality.id::text AS quality_policy_id,quality.policy_version AS quality_policy_version,
      quality.definition_hash AS quality_policy_hash,evaluation.usage_purposes,
      evaluation.candidate_root_count,evaluation.authorized_root_count,
      evaluation.quality_blocked_count,evaluation.retention_blocked_count,
      evaluation.licensing_blocked_count,evaluation.governance_unknown_count,
      evaluation.retention_policy_digest,evaluation.licensing_policy_digest,
      evaluation.governance_digest,evaluation.module_key,evaluation.view_key,
      evaluation.next_policy_transition_at::text,$2::text AS governance_data_watermark_id,
      COALESCE((SELECT jsonb_object_agg(reason_code,total) FROM (
        SELECT reason_code,count(*)::int AS total FROM signal_data_governance_evaluation_items
        WHERE evaluation_id=evaluation.id GROUP BY reason_code ORDER BY reason_code
      ) reasons),'{}'::jsonb) AS reason_counts
    FROM signal_data_governance_evaluations evaluation
    JOIN signal_quality_policies quality ON quality.id=evaluation.quality_policy_id
    WHERE evaluation.id=$1::uuid AND evaluation.evaluation_status='complete'
  `, [evaluationId, governed.governance_data_watermark_id]);
  return resolved.rows[0]!;
}

/** Compatibility wrapper for the already-proven brand compilation path. */
export async function evaluateSignalBrandDataGovernanceV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  brandId: string;
  policyBundleId: string;
  populationId: string;
  actor: SignalWorkspaceUser;
  moduleKey: SignalGovernedViewModuleKeyV1;
  reconcileMemberships: boolean;
}): Promise<SignalDataGovernanceEvaluationV1> {
  void args.brandId;
  return evaluateSignalViewDataGovernanceV1({
    queryable: args.queryable,
    workspaceId: args.workspaceId,
    policyBundleId: args.policyBundleId,
    populationId: args.populationId,
    actor: args.actor,
    moduleKey: args.moduleKey,
    viewKey: "brand",
    reconcileMemberships: args.reconcileMemberships
  });
}

function buildGovernanceEvaluationItemsSql() {
  return `
    WITH derivation AS (
      SELECT relation.base_population_id
      FROM signal_data_governance_evaluations evaluation
      JOIN signal_governed_view_population_derivations relation
        ON relation.workspace_id = evaluation.workspace_id
       AND relation.policy_bundle_id = evaluation.policy_bundle_id
       AND relation.resolved_population_id = evaluation.population_id
       AND relation.module_key = evaluation.module_key
       AND relation.view_key = evaluation.view_key
      WHERE evaluation.id = $3::uuid
    ), roots AS (
      SELECT mention.id, mention.quality_score, COALESCE(mention.quality_flags,'[]'::jsonb) AS quality_flags,
        EXISTS (SELECT 1 FROM signal_mention_attributions assertion
          JOIN signal_population_policy_entities allowed
            ON allowed.workspace_id=assertion.workspace_id
           AND allowed.policy_bundle_id=$2::uuid
           AND allowed.scope=assertion.scope
           AND allowed.entity_type=assertion.entity_type
           AND allowed.entity_id=assertion.entity_id
          WHERE assertion.workspace_id=mention.workspace_id AND assertion.mention_id=mention.id
            AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
            AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
        ) AS semantic_eligible
      FROM derivation
      JOIN signal_population_memberships base_membership
        ON base_membership.population_id = derivation.base_population_id
       AND base_membership.workspace_id = $1::uuid
       AND base_membership.membership_status = 'included'
       AND base_membership.removed_at IS NULL
      JOIN mentions mention ON mention.id = base_membership.mention_id
       AND mention.workspace_id = base_membership.workspace_id
      WHERE mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
    ), paths AS (
      SELECT root.id AS mention_id, membership.id AS import_membership_id,
        selected.id AS binding_id, selected.import_batch_id AS binding_import_batch_id,
        selected.retention_policy_id, selected.licensing_policy_id,
        retention.definition_hash AS retention_hash, licensing.definition_hash AS licensing_hash,
        CASE
          WHEN membership.id IS NULL OR selected.id IS NULL THEN 'no_authorized_provenance'
          WHEN selected.quality_policy_id <> $4::uuid THEN 'no_authorized_provenance'
          WHEN retention.status <> 'active'
            OR retention.effective_from > $10::timestamptz
            OR (retention.effective_to IS NOT NULL AND retention.effective_to <= $10::timestamptz)
            OR retention.retention_state='not_available' THEN 'retention_not_available'
          WHEN retention.retention_state='blocked' THEN 'retention_blocked'
          WHEN retention.retention_mode='until' AND retention.retain_until <= $10::timestamptz THEN 'retention_expired'
          WHEN licensing.status <> 'active'
            OR licensing.effective_from > $10::timestamptz
            OR (licensing.effective_to IS NOT NULL AND licensing.effective_to <= $10::timestamptz)
            THEN 'licensing_not_available'
          WHEN EXISTS (SELECT 1 FROM unnest($9::text[]) required(purpose)
            JOIN signal_licensing_policy_usages usage ON usage.licensing_policy_id=licensing.id
              AND usage.usage_purpose=required.purpose AND usage.decision='prohibited') THEN 'licensing_prohibited'
          WHEN EXISTS (SELECT 1 FROM unnest($9::text[]) required(purpose)
            WHERE NOT EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage
              WHERE usage.licensing_policy_id=licensing.id AND usage.usage_purpose=required.purpose
                AND usage.decision='allowed')) THEN 'licensing_not_available'
          ELSE 'policy_eligible'
        END AS path_reason
      FROM roots root
      LEFT JOIN mentions provenance_mention
        ON provenance_mention.workspace_id=$1::uuid
       AND provenance_mention.canonical_mention_id=root.id
      LEFT JOIN signal_mention_import_memberships membership
        ON membership.workspace_id=$1::uuid AND membership.mention_id=provenance_mention.id
      LEFT JOIN LATERAL (
        SELECT binding.* FROM signal_provenance_policy_bindings binding
        WHERE binding.workspace_id=$1::uuid AND binding.data_source_id=membership.data_source_id
          AND binding.status='active' AND binding.effective_from <= $10::timestamptz
          AND (binding.effective_to IS NULL OR binding.effective_to > $10::timestamptz)
          AND (binding.import_batch_id=membership.import_batch_id OR binding.import_batch_id IS NULL)
        ORDER BY (binding.import_batch_id IS NOT NULL) DESC,binding.binding_version DESC,binding.id
        LIMIT 1
      ) selected ON true
      LEFT JOIN signal_retention_policies retention ON retention.id=selected.retention_policy_id
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=selected.licensing_policy_id
    ), best_path AS (
      SELECT DISTINCT ON (mention_id) * FROM paths
      ORDER BY mention_id,(path_reason='policy_eligible') DESC,
        (binding_import_batch_id IS NOT NULL) DESC,binding_id,import_membership_id
    ), decisions AS (
      SELECT root.id AS mention_id,
        CASE
          WHEN NOT root.semantic_eligible THEN 'semantic_not_eligible'
          WHEN $8::text <> 'evaluate' OR ($5::int IS NOT NULL AND COALESCE(root.quality_score,-1)<$5::int)
            OR EXISTS (SELECT 1 FROM unnest($6::text[]) required(flag) WHERE NOT (root.quality_flags ? required.flag))
            OR EXISTS (SELECT 1 FROM unnest($7::text[]) forbidden(flag) WHERE root.quality_flags ? forbidden.flag)
            THEN 'quality_not_eligible'
          ELSE COALESCE(best.path_reason,'no_authorized_provenance')
        END AS reason_code,
        best.import_membership_id,
        best.binding_id,
        best.binding_import_batch_id,
        best.retention_policy_id,
        best.licensing_policy_id,
        best.retention_hash,
        best.licensing_hash,
        best.path_reason
      FROM roots root LEFT JOIN best_path best ON best.mention_id=root.id
    )
    INSERT INTO signal_data_governance_evaluation_items (
      evaluation_id,workspace_id,mention_id,decision,reason_code,
      import_membership_id,provenance_binding_id,quality_policy_id,
      retention_policy_id,licensing_policy_id,governance_path_hash
    ) SELECT $3::uuid,$1::uuid,decision.mention_id,
      CASE WHEN decision.reason_code='policy_eligible' THEN 'included'
        WHEN decision.reason_code IN ('semantic_not_eligible','quality_not_eligible') THEN 'excluded'
        ELSE 'blocked' END,
      decision.reason_code,decision.import_membership_id,decision.binding_id,$4::uuid,
      decision.retention_policy_id,decision.licensing_policy_id,
      'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),'governance-path-v1',
        decision.mention_id::text,COALESCE(decision.import_membership_id::text,'∅'),
        COALESCE(decision.binding_id::text,'∅'),$4::text,
        COALESCE(decision.retention_policy_id::text,'∅'),
        COALESCE(decision.licensing_policy_id::text,'∅'),decision.reason_code,
        array_to_string($9::text[],',')),'UTF8')),'hex')
    FROM decisions decision ORDER BY decision.mention_id
  `;
}

export async function loadSignalDataGovernancePreflightV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  actor: SignalWorkspaceUser;
  moduleKey: SignalGovernedViewModuleKeyV1;
  viewKey: SignalGovernedViewKeyV1;
}) {
  await assertActorWorkspace(args.queryable, args.workspaceId, args.actor);
  const usagePurposes = signalServingUsagePurposesForModuleViewV1(args.moduleKey, args.viewKey);
  const result = await args.queryable.query<{
    source_count: number;
    import_count: number;
    sources_without_active_binding: number;
    imports_without_effective_binding: number;
    sources_without_quality_policy: number;
    sources_without_retention_policy: number;
    sources_without_licensing_policy: number;
    imports_without_quality_policy: number;
    imports_without_retention_policy: number;
    imports_without_licensing_policy: number;
    roots_with_any_provenance: number;
    roots_with_authorized_provenance: number;
    roots_blocked_retention: number;
    roots_blocked_licensing: number;
    roots_governance_not_available: number;
    usage_authorization_gaps: Record<string, number>;
  }>(`
    WITH source_state AS (
      SELECT source.id,binding.id IS NOT NULL AS governed,
        quality.id IS NOT NULL AS has_quality,
        retention.id IS NOT NULL AS has_retention,
        licensing.id IS NOT NULL AS has_licensing
      FROM data_sources source
      LEFT JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=source.id
          AND candidate.import_batch_id IS NULL AND candidate.status='active'
          AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
        ORDER BY candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
      LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
        AND quality.status='active' AND quality.canonical_root_disposition='evaluate'
        AND quality.effective_from<=now() AND (quality.effective_to IS NULL OR quality.effective_to>now())
      LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.status='active' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now())
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.status='active' AND licensing.effective_from<=now()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>now())
      WHERE source.workspace_id=$1::uuid
    ), import_state AS (
      SELECT batch.id,batch.data_source_id,binding.id IS NOT NULL AS governed,
        quality.id IS NOT NULL AS has_quality,
        retention.id IS NOT NULL AS has_retention,
        licensing.id IS NOT NULL AS has_licensing
      FROM import_batches batch
      LEFT JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=batch.data_source_id
          AND candidate.status='active' AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
      LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
        AND quality.status='active' AND quality.canonical_root_disposition='evaluate'
        AND quality.effective_from<=now() AND (quality.effective_to IS NULL OR quality.effective_to>now())
      LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.status='active' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now())
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.status='active' AND licensing.effective_from<=now()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>now())
      WHERE batch.workspace_id=$1::uuid
    ), roots AS (
      SELECT mention.id FROM mentions mention WHERE mention.workspace_id=$1::uuid
        AND mention.canonical_mention_id=mention.id
    ), paths AS (
      SELECT root.id AS mention_id,binding.id AS binding_id,retention.retention_state,
        retention.retention_mode,retention.retain_until,
        licensing.id AS licensing_policy_id,
        CASE WHEN licensing.id IS NULL THEN false ELSE NOT EXISTS (
          SELECT 1 FROM unnest($2::text[]) required(purpose)
          WHERE NOT EXISTS (
            SELECT 1 FROM signal_licensing_policy_usages usage
            WHERE usage.licensing_policy_id=licensing.id
              AND usage.usage_purpose=required.purpose
              AND usage.decision='allowed'
          )
        ) END AS all_allowed,
        CASE WHEN licensing.id IS NULL THEN false ELSE EXISTS (
          SELECT 1 FROM unnest($2::text[]) required(purpose)
          JOIN signal_licensing_policy_usages usage
            ON usage.licensing_policy_id=licensing.id
           AND usage.usage_purpose=required.purpose
           AND usage.decision='prohibited'
        ) END AS any_prohibited
      FROM roots root
      LEFT JOIN mentions provenance_mention ON provenance_mention.workspace_id=$1::uuid
        AND provenance_mention.canonical_mention_id=root.id
      LEFT JOIN signal_mention_import_memberships membership ON membership.workspace_id=$1::uuid
        AND membership.mention_id=provenance_mention.id
      LEFT JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=membership.data_source_id
          AND candidate.status='active' AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=membership.import_batch_id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC LIMIT 1) binding ON true
      LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.status='active' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now())
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.status='active' AND licensing.effective_from<=now()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>now())
    ), root_state AS (
      SELECT mention_id,COALESCE(bool_or(binding_id IS NOT NULL),false) AS any_binding,
        COALESCE(bool_or(binding_id IS NOT NULL AND retention_state='allowed'
          AND (retention_mode<>'until' OR retain_until>now()) AND all_allowed),false) AS authorized,
        COALESCE(bool_or(retention_state='blocked'
          OR (retention_mode='until' AND retain_until<=now())),false) AS retention_blocked,
        COALESCE(bool_or(any_prohibited),false) AS licensing_blocked
      FROM paths GROUP BY mention_id
    ), usage_gap_counts AS (
      SELECT required.purpose,count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM paths path
        JOIN signal_licensing_policy_usages usage
          ON usage.licensing_policy_id=path.licensing_policy_id
         AND usage.usage_purpose=required.purpose AND usage.decision='allowed'
        WHERE path.mention_id=root.id AND path.binding_id IS NOT NULL
          AND path.retention_state='allowed'
          AND (path.retention_mode<>'until' OR path.retain_until>now())
      ))::int AS affected_roots
      FROM roots root CROSS JOIN unnest($2::text[]) required(purpose)
      GROUP BY required.purpose
    ) SELECT
      (SELECT count(*)::int FROM source_state) AS source_count,
      (SELECT count(*)::int FROM import_state) AS import_count,
      (SELECT count(*)::int FROM source_state WHERE NOT governed) AS sources_without_active_binding,
      (SELECT count(*)::int FROM import_state WHERE NOT governed) AS imports_without_effective_binding,
      (SELECT count(*)::int FROM source_state WHERE NOT has_quality) AS sources_without_quality_policy,
      (SELECT count(*)::int FROM source_state WHERE NOT has_retention) AS sources_without_retention_policy,
      (SELECT count(*)::int FROM source_state WHERE NOT has_licensing) AS sources_without_licensing_policy,
      (SELECT count(*)::int FROM import_state WHERE NOT has_quality) AS imports_without_quality_policy,
      (SELECT count(*)::int FROM import_state WHERE NOT has_retention) AS imports_without_retention_policy,
      (SELECT count(*)::int FROM import_state WHERE NOT has_licensing) AS imports_without_licensing_policy,
      (SELECT count(DISTINCT mention.canonical_mention_id)::int
        FROM signal_mention_import_memberships membership
        JOIN mentions mention ON mention.id=membership.mention_id
          AND mention.workspace_id=membership.workspace_id
        WHERE membership.workspace_id=$1::uuid) AS roots_with_any_provenance,
      (SELECT count(*)::int FROM root_state WHERE authorized) AS roots_with_authorized_provenance,
      (SELECT count(*)::int FROM root_state WHERE NOT authorized AND retention_blocked) AS roots_blocked_retention,
      (SELECT count(*)::int FROM root_state WHERE NOT authorized AND licensing_blocked) AS roots_blocked_licensing,
      (SELECT count(*)::int FROM root_state WHERE NOT authorized AND NOT retention_blocked AND NOT licensing_blocked) AS roots_governance_not_available,
      COALESCE((SELECT jsonb_object_agg(purpose,affected_roots ORDER BY purpose)
        FROM usage_gap_counts),'{}'::jsonb) AS usage_authorization_gaps
  `, [args.workspaceId, usagePurposes]);
  const summary = result.rows[0];
  if (!summary) throw new Error("Data governance preflight returned no workspace summary.");
  return {
    contract_version: "signal-data-governance-preflight-v1" as const,
    read_only: true as const,
    writes_performed: false as const,
    module_key: args.moduleKey,
    view_key: args.viewKey,
    usage_purposes: usagePurposes,
    ...summary
  };
}
