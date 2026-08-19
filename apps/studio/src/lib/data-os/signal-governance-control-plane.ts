import { createHash } from "node:crypto";

import {
  SIGNAL_DATA_USAGE_PURPOSES,
  canonicalizeSignalTimezone,
  type SignalDataUsagePurposeV1,
  type SignalLicensingPolicyDefinitionV1,
  type SignalQualityPolicyDefinitionV1,
  type SignalRetentionPolicyDefinitionV1
} from "@noisia/query-engine";

import {
  activateSignalDataGovernanceObjectV1,
  ensureSignalLicensingPolicyDraftV1,
  ensureSignalProvenancePolicyBindingDraftV1,
  ensureSignalQualityPolicyDraftV1,
  ensureSignalRetentionPolicyDraftV1,
  type SignalDataGovernancePolicyKindV1
} from "@/lib/data-os/signal-data-governance";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  resolveSignalWorkspaceForUser,
  type ResolvedSignalWorkspace,
  type SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

const QUALITY_KEY = "workspace-observed-quality";
const RETENTION_KEY = "workspace-retention";
const LICENSING_KEY = "workspace-client-usage";

export type SignalBrandOsCanonicalSnapshotV1 = {
  name: string;
  organization_id: string;
  industry: string | null;
  industry_sub: string | null;
  countries: string[];
  aliases: string[];
  competitors: Array<{ name: string; seed_id: string }>;
  knowledge_count: number;
};

/** The single canonical Brand OS identity projection used by creation, readiness and reconciliation. */
export function buildSignalBrandOsCanonicalSnapshotV1(
  value: SignalBrandOsCanonicalSnapshotV1
): SignalBrandOsCanonicalSnapshotV1 {
  return {
    ...value,
    countries: [...value.countries],
    aliases: [...value.aliases],
    competitors: [...value.competitors].sort((left, right) => (
      left.name.toLocaleLowerCase("und").localeCompare(right.name.toLocaleLowerCase("und"))
      || left.seed_id.localeCompare(right.seed_id)
    ))
  };
}

export function signalBrandOsCanonicalSnapshotHashV1(value: SignalBrandOsCanonicalSnapshotV1) {
  return sha256(stableJson(buildSignalBrandOsCanonicalSnapshotV1(value)));
}

export type SignalGovernancePreparationStateV1 = "ready" | "blocked" | "draft" | "not_available";

export type SignalGovernancePreparationV1 = {
  contract_version: "signal-governance-control-plane-v1";
  workspace: {
    name: string;
    slug: string;
    timezone: string;
    status: string;
  };
  checklist: Array<{
    key: "identity" | "timezone" | "quality" | "retention" | "licensing" | "provenance" | "imports" | "semantic-review" | "governed-views" | "strategic";
    state: SignalGovernancePreparationStateV1;
    blocker: string | null;
    action: string | null;
  }>;
  policies: {
    quality: SignalGovernancePolicySummaryV1[];
    retention: SignalGovernancePolicySummaryV1[];
    licensing: Array<SignalGovernancePolicySummaryV1 & {
      usages: Array<{ usage_purpose: SignalDataUsagePurposeV1; decision: string }>;
    }>;
  };
  sources: Array<{
    source_id: string;
    name: string;
    scope: string | null;
    status: string;
    imports: number;
    completed_imports: Array<{ import_batch_id: string; label: string; created_at: string }>;
    active_source_binding: SignalGovernanceBindingSummaryV1 | null;
    binding_drafts: Array<SignalGovernanceBindingSummaryV1 & { import_batch_id: string | null }>;
    unbound_imports: number;
  }>;
  identities: {
    primary_brand: number;
    competitors: number;
    categories: number;
    references: number;
    brand_os_profile_version: number | null;
  };
  semantic_review: {
    canonical_roots: number;
    approved_eligible: number;
    pending: number;
    unattributed_final: number;
  };
  governed_views: {
    ready_compilations: number;
    current_bindings: number;
    stale_or_invalidated: number;
  };
  strategic: {
    compilation_ready: boolean;
    binding_current: boolean;
    authorized_provenance_routes: number;
  };
};

type SignalGovernancePolicySummaryV1 = {
  policy_key: string;
  policy_version: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

type SignalGovernanceBindingSummaryV1 = {
  binding_version: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  scope: "source" | "import";
};

export type SignalGovernanceControlCommandV1 =
  | {
    action: "create-quality-draft";
    min_quality_score: number | null;
    required_quality_flags: string[];
    forbidden_quality_flags: string[];
    canonical_root_disposition: "evaluate" | "blocked" | "not_available";
    effective_from: string | null;
    effective_to: string | null;
  }
  | {
    action: "create-retention-draft";
    retention_state: "allowed" | "blocked" | "not_available";
    retention_mode: "indefinite" | "until" | "not_available";
    retain_until: string | null;
    expiry_action: "block_use" | "review_required" | "not_available";
    approval_evidence: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }
  | {
    action: "create-licensing-draft";
    usages: Array<{ usage_purpose: SignalDataUsagePurposeV1; decision: "allowed" | "prohibited" | "not_available" }>;
    approval_evidence: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }
  | {
    action: "activate-policy";
    policy_kind: Exclude<SignalDataGovernancePolicyKindV1, "provenance-binding">;
    policy_version: number;
  }
  | {
    action: "create-provenance-binding-draft";
    source_id: string;
    import_batch_id: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }
  | {
    action: "activate-provenance-binding";
    source_id: string;
    import_batch_id: string | null;
    binding_version: number;
  }
  | {
    action: "upsert-identity";
    entity_type: "category" | "reference";
    canonical_name: string;
    external_id: string | null;
  }
  | {
    action: "update-timezone";
    timezone: string;
  }
  | {
    action: "reconcile-brand-os";
  };

export async function loadSignalGovernancePreparationV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
}): Promise<SignalGovernancePreparationV1> {
  const result = await args.queryable.query<{
    payload: SignalGovernancePreparationV1;
  }>(PREPARATION_SQL, [args.workspace.id]);
  const row = result.rows[0]?.payload;
  if (!row) throw new Error("Workspace governance preparation is unavailable.");
  return row;
}

export async function loadSignalGovernancePreparationForWorkspaceV1(
  workspace: ResolvedSignalWorkspace
) {
  const { pool } = await import("@/lib/db");
  return loadSignalGovernancePreparationV1({ queryable: pool, workspace });
}

export async function executeSignalGovernanceControlCommandInTransactionV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  command: SignalGovernanceControlCommandV1;
}) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await executeSignalGovernanceControlCommandV1({
      ...args,
      queryable: client
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function executeSignalGovernanceControlCommandV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  command: SignalGovernanceControlCommandV1;
}) {
  assertWriterAuthority(args.workspace, args.actor);
  const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `governance-control:${args.workspace.id}:${commandIdentity(args.command)}`
  ]);
  await assertPersistedAuthority(args);
  const requestDigest = sha256(stableJson({
    contract_version: "signal-governance-control-plane-v1",
    workspace_id: args.workspace.id,
    command: args.command
  }));
  const replay = await claimGovernanceControlOperation({
    ...args,idempotencyKey,requestDigest
  });
  if (replay !== null) return replay;

  const result = await (async () => { switch (args.command.action) {
    case "create-quality-draft": {
      const version = await nextPolicyVersion(args.queryable, "signal_quality_policies", args.workspace.id, QUALITY_KEY, idempotencyKey);
      const definition: SignalQualityPolicyDefinitionV1 = {
        workspace_id: args.workspace.id,
        policy_key: QUALITY_KEY,
        policy_version: version,
        min_quality_score: args.command.min_quality_score,
        required_quality_flags: args.command.required_quality_flags,
        forbidden_quality_flags: args.command.forbidden_quality_flags,
        canonical_root_disposition: args.command.canonical_root_disposition
      };
      return ensureSignalQualityPolicyDraftV1({
        queryable: args.queryable,
        organizationId: args.workspace.organizationId,
        actor: args.actor,
        definition,
        idempotencyKey,
        effectiveFrom: args.command.effective_from,
        effectiveTo: args.command.effective_to
      });
    }
    case "create-retention-draft": {
      requireApprovalEvidence(args.command.approval_evidence, args.command.retention_state !== "not_available");
      const version = await nextPolicyVersion(args.queryable, "signal_retention_policies", args.workspace.id, RETENTION_KEY, idempotencyKey);
      const definition: SignalRetentionPolicyDefinitionV1 = {
        workspace_id: args.workspace.id,
        policy_key: RETENTION_KEY,
        policy_version: version,
        retention_state: args.command.retention_state,
        retention_mode: args.command.retention_mode,
        retain_until: args.command.retain_until,
        expiry_action: args.command.expiry_action,
        approval_evidence_hash: evidenceHash(args.command.approval_evidence)
      };
      return ensureSignalRetentionPolicyDraftV1({
        queryable: args.queryable,
        organizationId: args.workspace.organizationId,
        actor: args.actor,
        definition,
        idempotencyKey,
        effectiveFrom: args.command.effective_from,
        effectiveTo: args.command.effective_to
      });
    }
    case "create-licensing-draft": {
      requireApprovalEvidence(args.command.approval_evidence, true);
      assertCompleteUsageMatrix(args.command.usages);
      const version = await nextPolicyVersion(args.queryable, "signal_licensing_policies", args.workspace.id, LICENSING_KEY, idempotencyKey);
      const definition: SignalLicensingPolicyDefinitionV1 = {
        workspace_id: args.workspace.id,
        policy_key: LICENSING_KEY,
        policy_version: version,
        approval_evidence_hash: evidenceHash(args.command.approval_evidence),
        usages: args.command.usages
      };
      return ensureSignalLicensingPolicyDraftV1({
        queryable: args.queryable,
        organizationId: args.workspace.organizationId,
        actor: args.actor,
        definition,
        idempotencyKey,
        effectiveFrom: args.command.effective_from,
        effectiveTo: args.command.effective_to
      });
    }
    case "activate-policy": {
      const resolved = await resolvePolicyObject(args.queryable, args.workspace.id, args.command.policy_kind, args.command.policy_version);
      return activateSignalDataGovernanceObjectV1({
        queryable: args.queryable,
        workspaceId: args.workspace.id,
        actor: args.actor,
        objectKind: args.command.policy_kind,
        objectId: resolved.id,
        idempotencyKey
      });
    }
    case "create-provenance-binding-draft": {
      const authority = await loadActivePolicies(args.queryable, args.workspace.id);
      await assertSourceImportScope(args.queryable, args.workspace.id, args.command.source_id, args.command.import_batch_id);
      const bindingVersion = await nextBindingVersion(
        args.queryable, args.workspace.id, args.command.source_id, args.command.import_batch_id,
        idempotencyKey
      );
      return ensureSignalProvenancePolicyBindingDraftV1({
        queryable: args.queryable,
        actor: args.actor,
        definition: {
          workspace_id: args.workspace.id,
          data_source_id: args.command.source_id,
          import_batch_id: args.command.import_batch_id,
          binding_version: bindingVersion,
          quality_policy_id: authority.quality,
          retention_policy_id: authority.retention,
          licensing_policy_id: authority.licensing
        },
        idempotencyKey,
        effectiveFrom: args.command.effective_from,
        effectiveTo: args.command.effective_to
      });
    }
    case "activate-provenance-binding": {
      const binding = await resolveBindingObject(args.queryable, args.workspace.id, args.command);
      return activateSignalDataGovernanceObjectV1({
        queryable: args.queryable,
        workspaceId: args.workspace.id,
        actor: args.actor,
        objectKind: "provenance-binding",
        objectId: binding.id,
        idempotencyKey
      });
    }
    case "upsert-identity":
      return upsertWorkspaceIdentity({ ...args, command: args.command });
    case "update-timezone":
      return updateWorkspaceTimezone(args, canonicalizeSignalTimezone(args.command.timezone));
    case "reconcile-brand-os":
      return reconcileSignalBrandOsProjectionV1(args);
  } })();
  await completeGovernanceControlOperation(args.queryable,args.workspace.id,idempotencyKey,result);
  return result;
}

async function claimGovernanceControlOperation(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  command: SignalGovernanceControlCommandV1;
  idempotencyKey: string;
  requestDigest: string;
}) {
  await args.queryable.query(`
    INSERT INTO signal_governance_control_operations (
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status
    ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,'in_progress')
    ON CONFLICT (workspace_id,idempotency_key) DO NOTHING
  `,[args.workspace.id,args.actor.id,args.command.action,args.requestDigest,args.idempotencyKey]);
  const selected = await args.queryable.query<{
    actor_user_id: string;action: string;request_digest: string;status: string;result: unknown;
  }>(`
    SELECT actor_user_id::text,action,request_digest,status,result
    FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid AND idempotency_key=$2
    FOR UPDATE
  `,[args.workspace.id,args.idempotencyKey]);
  const row = selected.rows[0];
  if (!row || row.actor_user_id!==args.actor.id || row.action!==args.command.action
      || row.request_digest!==args.requestDigest) {
    throw new Error("Idempotency-Key was reused with incompatible governance input.");
  }
  if (row.status==="completed") return row.result;
  if (row.status!=="in_progress") throw new Error("Governance operation has an invalid state.");
  return null;
}

async function completeGovernanceControlOperation(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  idempotencyKey: string,
  result: unknown
) {
  const updated = await queryable.query(`
    UPDATE signal_governance_control_operations
    SET status='completed',result=$3::jsonb,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE workspace_id=$1::uuid AND idempotency_key=$2 AND status='in_progress'
  `,[workspaceId,idempotencyKey,JSON.stringify(result)]);
  if (updated.rowCount!==1) throw new Error("Governance operation completion was not persisted.");
}

async function assertPersistedAuthority(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const result = await args.queryable.query<{ allowed: boolean }>(`
    SELECT workspace.organization_id=$2::uuid
      AND workspace.brand_id=$3::uuid
      AND workspace.status='active'
      AND signal_data_governance_actor_is_valid(workspace.id,$4::uuid) AS allowed
    FROM signal_workspaces workspace WHERE workspace.id=$1::uuid
  `, [args.workspace.id, args.workspace.organizationId, args.workspace.subject.id, args.actor.id]);
  if (result.rows[0]?.allowed !== true) throw new Error("Governance command is cross-workspace or unauthorized.");
}

function assertWriterAuthority(workspace: ResolvedSignalWorkspace, actor: SignalWorkspaceUser) {
  if (workspace.status !== "active" || workspace.subject.type !== "brand" || actor.userType !== "noisia_internal") {
    throw new Error("Governance control requires an active brand workspace and internal operator.");
  }
}

async function nextPolicyVersion(
  queryable: SignalBrandPolicyQueryable,
  table: "signal_quality_policies" | "signal_retention_policies" | "signal_licensing_policies",
  workspaceId: string,
  policyKey: string,
  idempotencyKey: string
) {
  const result = await queryable.query<{ version: number }>(
    `SELECT COALESCE(
       (SELECT policy_version FROM ${table}
        WHERE workspace_id=$1::uuid AND creation_idempotency_key=$3),
       (SELECT COALESCE(max(policy_version),0)::int+1 FROM ${table}
        WHERE workspace_id=$1::uuid AND policy_key=$2)
     ) AS version`,
    [workspaceId, policyKey, idempotencyKey]
  );
  return result.rows[0]?.version ?? 1;
}

async function nextBindingVersion(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  sourceId: string,
  importId: string | null,
  idempotencyKey: string
) {
  const result = await queryable.query<{ version: number }>(`
    SELECT COALESCE(
      (SELECT binding_version FROM signal_provenance_policy_bindings
       WHERE workspace_id=$1::uuid AND creation_idempotency_key=$4),
      (SELECT COALESCE(max(binding_version),0)::int+1
       FROM signal_provenance_policy_bindings
       WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid
         AND import_batch_id IS NOT DISTINCT FROM $3::uuid)
    ) AS version
  `, [workspaceId, sourceId, importId, idempotencyKey]);
  return result.rows[0]?.version ?? 1;
}

async function resolvePolicyObject(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  kind: Exclude<SignalDataGovernancePolicyKindV1, "provenance-binding">,
  version: number
) {
  const config = kind === "quality-policy"
    ? { table: "signal_quality_policies", key: QUALITY_KEY }
    : kind === "retention-policy"
      ? { table: "signal_retention_policies", key: RETENTION_KEY }
      : { table: "signal_licensing_policies", key: LICENSING_KEY };
  const result = await queryable.query<{ id: string }>(`
    SELECT id::text FROM ${config.table}
    WHERE workspace_id=$1::uuid AND policy_key=$2 AND policy_version=$3 AND status='draft'
  `, [workspaceId, config.key, version]);
  if (result.rowCount !== 1) throw new Error("Policy draft is unavailable or already activated.");
  return result.rows[0]!;
}

async function loadActivePolicies(queryable: SignalBrandPolicyQueryable, workspaceId: string) {
  const result = await queryable.query<{ kind: string; id: string }>(`
    SELECT 'quality' AS kind,id::text FROM signal_quality_policies
      WHERE workspace_id=$1::uuid AND policy_key=$2 AND status='active'
        AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp())
    UNION ALL
    SELECT 'retention',id::text FROM signal_retention_policies
      WHERE workspace_id=$1::uuid AND policy_key=$3 AND status='active'
        AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp())
    UNION ALL
    SELECT 'licensing',id::text FROM signal_licensing_policies
      WHERE workspace_id=$1::uuid AND policy_key=$4 AND status='active'
        AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp())
  `, [workspaceId, QUALITY_KEY, RETENTION_KEY, LICENSING_KEY]);
  const grouped = Object.fromEntries(result.rows.map((row) => [row.kind, row.id]));
  if (!grouped.quality || !grouped.retention || !grouped.licensing || result.rowCount !== 3) {
    throw new Error("Exactly one active quality, retention and licensing authority is required.");
  }
  return grouped as { quality: string; retention: string; licensing: string };
}

async function assertSourceImportScope(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  sourceId: string,
  importId: string | null
) {
  const result = await queryable.query<{ allowed: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM data_sources source
      WHERE source.id=$2::uuid AND source.workspace_id=$1::uuid AND source.status='active'
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM import_batches batch WHERE batch.id=$3::uuid
            AND batch.workspace_id=$1::uuid AND batch.data_source_id=source.id
            AND batch.status='completed'
        ))
    ) AS allowed
  `, [workspaceId, sourceId, importId]);
  if (result.rows[0]?.allowed !== true) throw new Error("Provenance source/import is unavailable or cross-workspace.");
}

async function resolveBindingObject(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  command: Extract<SignalGovernanceControlCommandV1, { action: "activate-provenance-binding" }>
) {
  const result = await queryable.query<{ id: string }>(`
    SELECT id::text FROM signal_provenance_policy_bindings
    WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid
      AND import_batch_id IS NOT DISTINCT FROM $3::uuid
      AND binding_version=$4 AND status='draft'
  `, [workspaceId, command.source_id, command.import_batch_id, command.binding_version]);
  if (result.rowCount !== 1) throw new Error("Provenance binding draft is unavailable or already activated.");
  return result.rows[0]!;
}

async function upsertWorkspaceIdentity(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  command: Extract<SignalGovernanceControlCommandV1, { action: "upsert-identity" }>;
}) {
  const name = args.command.canonical_name.trim().replace(/\s+/gu, " ");
  if (name.length < 2 || name.length > 240) throw new Error("Governed identity name is invalid.");
  const externalId = args.command.external_id?.trim() || null;
  const result = await args.queryable.query<{ id: string; created: boolean }>(`
    WITH existing AS (
      SELECT id FROM intelligence_entities
      WHERE organization_id=$1::uuid AND brand_id=$2::uuid AND entity_type=$3
        AND lower(canonical_name)=lower($4)
      FOR UPDATE
    ), inserted AS (
      INSERT INTO intelligence_entities (
        organization_id,brand_id,entity_type,canonical_name,external_id,status,metadata
      ) SELECT $1::uuid,$2::uuid,$3,$4,$5,'active',jsonb_build_object(
        'created_by','governance-control-v1','actor_user_id',$6::text,
        'idempotency_key_hash',$7::text
      ) WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    )
    SELECT id::text,true AS created FROM inserted
    UNION ALL SELECT id::text,false FROM existing
  `, [args.workspace.organizationId, args.workspace.subject.id, args.command.entity_type,
    name, externalId, args.actor.id, sha256(args.idempotencyKey)]);
  if (result.rowCount !== 1) throw new Error("Governed identity could not be resolved deterministically.");
  await reconcileSignalBrandOsProjectionV1(args);
  return { entity_id: result.rows[0]!.id, created: result.rows[0]!.created };
}

async function updateWorkspaceTimezone(
  args: {
    queryable: SignalBrandPolicyQueryable;
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    idempotencyKey: string;
  },
  timezone: string
) {
  const result = await args.queryable.query<{ timezone: string; changed: boolean }>(`
    WITH changed AS (
      UPDATE signal_workspaces SET timezone=$2,updated_at=clock_timestamp()
      WHERE id=$1::uuid AND timezone IS DISTINCT FROM $2
      RETURNING timezone
    ), refresh AS (
      UPDATE signal_refresh_policies SET timezone=$2,updated_at=clock_timestamp()
      WHERE workspace_id=$1::uuid AND timezone IS DISTINCT FROM $2 RETURNING 1
    )
    SELECT COALESCE((SELECT timezone FROM changed),$2) AS timezone,
      EXISTS(SELECT 1 FROM changed) AS changed
  `, [args.workspace.id, timezone]);
  return result.rows[0]!;
}

export async function reconcileSignalBrandOsProjectionV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
}) {
  const snapshot = await args.queryable.query<{
    name: string;
    organization_id: string;
    industry: string | null;
    industry_sub: string | null;
    countries: string[];
    aliases: string[];
    competitors: Array<{ name: string; seed_id: string }>;
    knowledge_count: number;
  }>(`
    SELECT COALESCE(brand.display_name,brand.name) AS name,brand.organization_id::text,
      brand.industry,brand.industry_sub,brand.countries,
      COALESCE(brand.brand_seed_handles,ARRAY[]::text[]) AS aliases,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name',seed.canonical_name,'seed_id',seed.id::text)
        ORDER BY lower(seed.canonical_name),seed.id)
        FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
        WHERE competitor.brand_id=brand.id AND competitor.status='current' AND seed.active),'[]'::jsonb) AS competitors,
      (SELECT count(*)::int FROM brand_knowledge_sources source
        WHERE source.brand_id=brand.id AND source.status='active') AS knowledge_count
    FROM brands brand WHERE brand.id=$1::uuid AND brand.organization_id=$2::uuid
  `, [args.workspace.subject.id, args.workspace.organizationId]);
  const state = snapshot.rows[0];
  if (!state) throw new Error("Brand OS source identity is unavailable.");
  const snapshotHash = signalBrandOsCanonicalSnapshotHashV1(state);
  const profile = await args.queryable.query<{ id: string; version: number; created: boolean }>(`
    WITH current_profile AS (
      SELECT * FROM brand_os_profiles WHERE brand_id=$1::uuid AND status='active'
      ORDER BY version DESC LIMIT 1 FOR UPDATE
    ), retired AS (
      UPDATE brand_os_profiles SET status='retired',updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM current_profile)
        AND COALESCE(metadata->>'snapshot_hash','')<>$3
      RETURNING 1
    ), next_version AS (
      SELECT COALESCE(max(version),0)+1 AS value FROM brand_os_profiles WHERE brand_id=$1::uuid
    ), inserted AS (
      INSERT INTO brand_os_profiles (organization_id,brand_id,name,status,version,metadata)
      SELECT $2::uuid,$1::uuid,$4||' Brand OS','active',next_version.value,
        jsonb_build_object('source','governance-control-v1','snapshot_hash',$3,
          'reconciled_by_user_id',$5::text,'reconciliation_key_hash',$6::text,
          'industry',$7::text,'industry_sub',$8::text,'countries',$9::text[],
          'aliases',$10::text[],'knowledge_source_count',$11::int)
      FROM next_version
      WHERE NOT EXISTS (SELECT 1 FROM current_profile WHERE metadata->>'snapshot_hash'=$3)
      RETURNING id,version
    )
    SELECT id::text,version,true AS created FROM inserted
    UNION ALL
    SELECT id::text,version,false FROM current_profile WHERE metadata->>'snapshot_hash'=$3
  `, [args.workspace.subject.id, args.workspace.organizationId, snapshotHash, state.name,
    args.actor.id, sha256(args.idempotencyKey), state.industry, state.industry_sub,
    state.countries, state.aliases, state.knowledge_count]);
  const resolved = profile.rows[0];
  if (!resolved) throw new Error("Brand OS profile reconciliation failed.");
  if (resolved.created) {
    await args.queryable.query(`
      INSERT INTO brand_os_competitors (brand_os_profile_id,competitor_name,competitor_brand_seed_id,role,priority,metadata)
      SELECT $1::uuid,seed.canonical_name,seed.id,'governed_competitor',
        row_number() OVER (ORDER BY lower(seed.canonical_name),seed.id),
        jsonb_build_object('source','governance-control-v1')
      FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
      WHERE competitor.brand_id=$2::uuid AND competitor.status='current' AND seed.active
      ON CONFLICT DO NOTHING
    `, [resolved.id, args.workspace.subject.id]);
    const seedSet = await args.queryable.query<{ id: string }>(`
      INSERT INTO brand_os_seed_sets (brand_os_profile_id,name,seed_set_type,status,metadata)
      VALUES ($1::uuid,'Governed identity seeds','workspace_identity','active',
        jsonb_build_object('source','governance-control-v1')) RETURNING id::text
    `, [resolved.id]);
    await args.queryable.query(`
      INSERT INTO brand_os_seed_terms (seed_set_id,term,term_type,brand_seed_id,metadata)
      SELECT $1::uuid,term,'keyword',NULL,jsonb_build_object('scope','primary_brand')
      FROM unnest($2::text[]) term WHERE NULLIF(btrim(term),'') IS NOT NULL
      UNION ALL
      SELECT $1::uuid,seed.canonical_name,'brand_seed',seed.id,jsonb_build_object('scope','competitor')
      FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
      WHERE competitor.brand_id=$3::uuid AND competitor.status='current' AND seed.active
      ON CONFLICT DO NOTHING
    `, [seedSet.rows[0]!.id, state.aliases, args.workspace.subject.id]);
  }
  return { profile_id: resolved.id, version: resolved.version, created: resolved.created, snapshot_hash: snapshotHash };
}

export async function reconcileSignalBrandOsForBrandMutationV1(args: {
  brandId: string;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
}) {
  if (args.actor.userType !== "noisia_internal") throw new Error("Brand OS reconciliation requires an internal actor.");
  const { pool } = await import("@/lib/db");
  const lookup = await pool.query<{ workspace_id: string }>(`
    SELECT id::text AS workspace_id FROM signal_workspaces
    WHERE brand_id=$1::uuid AND status='active'
  `, [args.brandId]);
  if (lookup.rowCount !== 1) throw new Error("Brand workspace is unavailable or ambiguous.");
  const workspace = await resolveSignalWorkspaceForUser(args.actor, {
    workspaceId: lookup.rows[0]!.workspace_id
  });
  if (!workspace) throw new Error("Brand workspace is not authorized for reconciliation.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `brand-os-reconcile:${workspace.id}`
    ]);
    const result = await reconcileSignalBrandOsProjectionV1({
      queryable: client,
      workspace,
      actor: args.actor,
      idempotencyKey: args.idempotencyKey
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function commandIdentity(command: SignalGovernanceControlCommandV1) {
  if ("source_id" in command) return `${command.action}:${command.source_id}:${command.import_batch_id ?? "source"}`;
  if ("policy_kind" in command) return `${command.action}:${command.policy_kind}:${command.policy_version}`;
  if ("entity_type" in command) return `${command.action}:${command.entity_type}:${command.canonical_name.toLowerCase()}`;
  return command.action;
}

function normalizeIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 500) {
    throw new Error("Idempotency-Key must be between 8 and 500 characters.");
  }
  return sha256(`signal-governance-control-v1\u001f${normalized}`);
}

function evidenceHash(value: string | null) {
  const normalized = value?.trim();
  return normalized ? sha256(`operator-approval-evidence-v1\u001f${normalized}`) : null;
}

function requireApprovalEvidence(value: string | null, required: boolean) {
  if (required && (!value || value.trim().length < 8)) {
    throw new Error("Approval evidence is required for an affirmative operator decision.");
  }
}

function assertCompleteUsageMatrix(usages: Array<{ usage_purpose: SignalDataUsagePurposeV1 }>) {
  const observed = [...new Set(usages.map((usage) => usage.usage_purpose))].sort();
  const expected = [...SIGNAL_DATA_USAGE_PURPOSES].sort();
  if (stableJson(observed) !== stableJson(expected)) {
    throw new Error("Licensing requires an explicit decision for every closed usage purpose.");
  }
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

const PREPARATION_SQL = String.raw`
WITH workspace AS (
  SELECT w.*,COALESCE(b.display_name,b.name,w.slug) AS display_name
  FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id
  WHERE w.id=$1::uuid AND w.status='active'
), policy_quality AS (
  SELECT jsonb_agg(jsonb_build_object('policy_key',p.policy_key,'policy_version',p.policy_version,
    'status',p.status,'effective_from',p.effective_from,'effective_to',p.effective_to,
    'approved_by',u.full_name,'approved_at',p.activated_at) ORDER BY p.policy_version DESC) AS items
  FROM signal_quality_policies p LEFT JOIN users u ON u.id=p.activated_by_user_id WHERE p.workspace_id=$1::uuid
), policy_retention AS (
  SELECT jsonb_agg(jsonb_build_object('policy_key',p.policy_key,'policy_version',p.policy_version,
    'status',p.status,'effective_from',p.effective_from,'effective_to',p.effective_to,
    'approved_by',u.full_name,'approved_at',p.approved_at) ORDER BY p.policy_version DESC) AS items
  FROM signal_retention_policies p LEFT JOIN users u ON u.id=p.approved_by_user_id WHERE p.workspace_id=$1::uuid
), policy_licensing AS (
  SELECT jsonb_agg(jsonb_build_object('policy_key',p.policy_key,'policy_version',p.policy_version,
    'status',p.status,'effective_from',p.effective_from,'effective_to',p.effective_to,
    'approved_by',u.full_name,'approved_at',p.approved_at,'usages',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('usage_purpose',usage.usage_purpose,'decision',usage.decision)
        ORDER BY usage.usage_purpose) FROM signal_licensing_policy_usages usage
      WHERE usage.licensing_policy_id=p.id),'[]'::jsonb)) ORDER BY p.policy_version DESC) AS items
  FROM signal_licensing_policies p LEFT JOIN users u ON u.id=p.approved_by_user_id WHERE p.workspace_id=$1::uuid
), source_state AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_id',source.id::text,'name',source.name,
    'scope',source.governed_scope,'status',source.status,'imports',(SELECT count(*)::int FROM import_batches batch
      WHERE batch.workspace_id=source.workspace_id AND batch.data_source_id=source.id AND batch.status='completed'),
    'completed_imports',COALESCE((SELECT jsonb_agg(jsonb_build_object('import_batch_id',batch.id::text,
      'label',COALESCE(batch.source_file_name,'Import '||to_char(batch.created_at,'YYYY-MM-DD HH24:MI')),
      'created_at',batch.created_at) ORDER BY batch.created_at DESC,batch.id)
      FROM import_batches batch WHERE batch.workspace_id=source.workspace_id
        AND batch.data_source_id=source.id AND batch.status='completed'),'[]'::jsonb),
    'active_source_binding',(SELECT jsonb_build_object('binding_version',binding.binding_version,
      'status',binding.status,'effective_from',binding.effective_from,'effective_to',binding.effective_to,'scope','source')
      FROM signal_provenance_policy_bindings binding WHERE binding.workspace_id=source.workspace_id
        AND binding.data_source_id=source.id AND binding.import_batch_id IS NULL AND binding.status='active'
      ORDER BY binding.binding_version DESC LIMIT 1),
    'binding_drafts',COALESCE((SELECT jsonb_agg(jsonb_build_object('binding_version',binding.binding_version,
      'status',binding.status,'effective_from',binding.effective_from,'effective_to',binding.effective_to,
      'scope',CASE WHEN binding.import_batch_id IS NULL THEN 'source' ELSE 'import' END,
      'import_batch_id',binding.import_batch_id::text) ORDER BY binding.binding_version DESC)
      FROM signal_provenance_policy_bindings binding WHERE binding.workspace_id=source.workspace_id
        AND binding.data_source_id=source.id AND binding.status='draft'),'[]'::jsonb),
    'unbound_imports',(SELECT count(*)::int FROM import_batches batch WHERE batch.workspace_id=source.workspace_id
      AND batch.data_source_id=source.id AND batch.status='completed' AND NOT EXISTS (
        SELECT 1 FROM signal_provenance_policy_bindings binding WHERE binding.workspace_id=source.workspace_id
          AND binding.data_source_id=source.id AND binding.status='active'
          AND (binding.import_batch_id=batch.id OR binding.import_batch_id IS NULL)
          AND binding.effective_from<=clock_timestamp()
          AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
      ))) ORDER BY lower(source.name),source.id),'[]'::jsonb) AS items
  FROM data_sources source WHERE source.workspace_id=$1::uuid
), counts AS (
  SELECT
    (SELECT count(*)::int FROM competitors c JOIN brand_seeds s ON s.id=c.competitor_brand_seed_id AND s.active
      WHERE c.brand_id=workspace.brand_id) AS competitors,
    (SELECT count(*)::int FROM intelligence_entities e WHERE e.organization_id=workspace.organization_id
      AND e.brand_id=workspace.brand_id AND e.entity_type='category' AND e.status='active') AS categories,
    (SELECT count(*)::int FROM intelligence_entities e WHERE e.organization_id=workspace.organization_id
      AND e.brand_id=workspace.brand_id AND e.entity_type='reference' AND e.status='active') AS references,
    (SELECT max(version)::int FROM brand_os_profiles p WHERE p.brand_id=workspace.brand_id AND p.status='active'
      AND p.metadata->>'snapshot_hash' ~ '^sha256:[0-9a-f]{64}$') AS profile_version,
    (SELECT count(*)::int FROM mentions m WHERE m.workspace_id=workspace.id AND m.canonical_mention_id=m.id) AS roots,
    (SELECT count(DISTINCT a.mention_id)::int FROM signal_mention_attributions a WHERE a.workspace_id=workspace.id
      AND a.attribution_basis='mention_semantic' AND a.is_current AND a.review_status='approved'
      AND a.eligibility_status='eligible') AS approved_eligible,
    (SELECT count(DISTINCT a.mention_id)::int FROM signal_mention_attributions a WHERE a.workspace_id=workspace.id
      AND a.attribution_basis='mention_semantic' AND a.is_current AND a.review_status='pending') AS pending,
    (SELECT count(DISTINCT a.mention_id)::int FROM signal_mention_attributions a WHERE a.workspace_id=workspace.id
      AND a.attribution_basis='mention_semantic' AND a.is_current AND a.review_status='approved'
      AND a.eligibility_status='not_eligible' AND a.scope='unattributed' AND a.entity_id IS NULL) AS unattributed,
    (SELECT count(*)::int FROM signal_population_policy_compilations c WHERE c.workspace_id=workspace.id
      AND c.compilation_status='ready' AND c.is_current AND c.module_key=ANY(ARRAY['brand-monitoring','mentions','topics-narratives'])) AS ready_compilations,
    (SELECT count(*)::int FROM signal_governed_view_bindings b WHERE b.workspace_id=workspace.id
      AND b.binding_status='current' AND b.module_key=ANY(ARRAY['brand-monitoring','mentions','topics-narratives'])) AS current_bindings,
    (SELECT count(*)::int FROM signal_population_policy_compilations c WHERE c.workspace_id=workspace.id
      AND (c.compilation_status<>'ready' OR EXISTS (SELECT 1 FROM signal_data_governance_invalidations i
        WHERE i.policy_compilation_id=c.id))) AS stale_compilations,
    EXISTS(SELECT 1 FROM signal_population_policy_compilations c WHERE c.workspace_id=workspace.id
      AND c.module_key='triggers-barriers' AND c.view_key='strategic' AND c.is_current
      AND c.compilation_status='ready') AS strategic_ready,
    EXISTS(SELECT 1 FROM signal_governed_view_bindings b WHERE b.workspace_id=workspace.id
      AND b.module_key='triggers-barriers' AND b.view_key='strategic' AND b.binding_status='current') AS strategic_binding,
    (SELECT count(DISTINCT binding.id)::int FROM signal_provenance_policy_bindings binding
      JOIN signal_licensing_policy_usages llm ON llm.licensing_policy_id=binding.licensing_policy_id
        AND llm.usage_purpose='llm-processing' AND llm.decision='allowed'
      JOIN signal_licensing_policy_usages strategic ON strategic.licensing_policy_id=binding.licensing_policy_id
        AND strategic.usage_purpose='strategic-analysis' AND strategic.decision='allowed'
      WHERE binding.workspace_id=workspace.id AND binding.status='active'
        AND binding.effective_from<=clock_timestamp()
        AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())) AS strategic_routes,
    EXISTS(SELECT 1 FROM signal_quality_policies p WHERE p.workspace_id=workspace.id AND p.status='active'
      AND p.effective_from<=clock_timestamp() AND (p.effective_to IS NULL OR p.effective_to>clock_timestamp())) AS quality_ready,
    EXISTS(SELECT 1 FROM signal_retention_policies p WHERE p.workspace_id=workspace.id AND p.status='active'
      AND p.retention_state='allowed' AND p.effective_from<=clock_timestamp()
      AND (p.effective_to IS NULL OR p.effective_to>clock_timestamp())
      AND (p.retention_mode='indefinite' OR p.retain_until>clock_timestamp())) AS retention_ready,
    EXISTS(SELECT 1 FROM signal_licensing_policies p WHERE p.workspace_id=workspace.id AND p.status='active'
      AND p.effective_from<=clock_timestamp() AND (p.effective_to IS NULL OR p.effective_to>clock_timestamp())) AS licensing_ready,
    EXISTS(SELECT 1 FROM signal_provenance_policy_bindings p WHERE p.workspace_id=workspace.id AND p.status='active'
      AND p.effective_from<=clock_timestamp() AND (p.effective_to IS NULL OR p.effective_to>clock_timestamp())) AS provenance_ready,
    EXISTS(SELECT 1 FROM import_batches b WHERE b.workspace_id=workspace.id AND b.status='completed') AS imports_ready
  FROM workspace
)
SELECT jsonb_build_object(
  'contract_version','signal-governance-control-plane-v1',
  'workspace',jsonb_build_object('name',workspace.display_name,'slug',workspace.slug,
    'timezone',workspace.timezone,'status',workspace.status),
  'checklist',jsonb_build_array(
    jsonb_build_object('key','identity','state',CASE WHEN counts.profile_version IS NOT NULL THEN 'ready' ELSE 'blocked' END,
      'blocker',CASE WHEN counts.profile_version IS NULL THEN 'brand_os_not_reconciled' END,'action','reconcile-brand-os'),
    jsonb_build_object('key','timezone','state',CASE WHEN workspace.timezone IS NOT NULL THEN 'ready' ELSE 'blocked' END,
      'blocker',CASE WHEN workspace.timezone IS NULL THEN 'timezone_not_available' END,'action','update-timezone'),
    jsonb_build_object('key','quality','state',CASE WHEN counts.quality_ready THEN 'ready' ELSE 'blocked' END,
      'blocker',CASE WHEN NOT counts.quality_ready THEN 'active_quality_policy_required' END,'action','create-quality-draft'),
    jsonb_build_object('key','retention','state',CASE WHEN counts.retention_ready THEN 'ready' ELSE 'blocked' END,
      'blocker',CASE WHEN NOT counts.retention_ready THEN 'active_retention_policy_required' END,'action','create-retention-draft'),
    jsonb_build_object('key','licensing','state',CASE WHEN counts.licensing_ready THEN 'ready' ELSE 'blocked' END,
      'blocker',CASE WHEN NOT counts.licensing_ready THEN 'active_licensing_policy_required' END,'action','create-licensing-draft'),
    jsonb_build_object('key','provenance','state',CASE WHEN counts.provenance_ready THEN 'ready' ELSE 'blocked' END,
      'blocker',CASE WHEN NOT counts.provenance_ready THEN 'active_provenance_binding_required' END,'action','create-provenance-binding-draft'),
    jsonb_build_object('key','imports','state',CASE WHEN counts.imports_ready THEN 'ready' ELSE 'not_available' END,
      'blocker',CASE WHEN NOT counts.imports_ready THEN 'completed_import_required' END,'action',NULL),
    jsonb_build_object('key','semantic-review','state',CASE WHEN counts.approved_eligible>0 THEN 'ready'
      WHEN counts.roots=0 THEN 'not_available' ELSE 'blocked' END,
      'blocker',CASE WHEN counts.roots>0 AND counts.approved_eligible=0 THEN 'approved_eligible_assertion_required' END,'action',NULL),
    jsonb_build_object('key','governed-views','state',CASE WHEN counts.current_bindings>0 THEN 'ready'
      WHEN counts.ready_compilations>0 THEN 'draft' ELSE 'blocked' END,
      'blocker',CASE WHEN counts.ready_compilations=0 THEN 'ready_compilation_required' END,'action',NULL),
    jsonb_build_object('key','strategic','state',CASE WHEN counts.strategic_binding THEN 'ready'
      WHEN counts.strategic_ready THEN 'draft' ELSE 'blocked' END,
      'blocker',CASE WHEN NOT counts.strategic_ready THEN 'strategic_authority_required' END,'action',NULL)
  ),
  'policies',jsonb_build_object('quality',COALESCE(policy_quality.items,'[]'::jsonb),
    'retention',COALESCE(policy_retention.items,'[]'::jsonb),
    'licensing',COALESCE(policy_licensing.items,'[]'::jsonb)),
  'sources',source_state.items,
  'identities',jsonb_build_object('primary_brand',1,'competitors',counts.competitors,
    'categories',counts.categories,'references',counts.references,'brand_os_profile_version',counts.profile_version),
  'semantic_review',jsonb_build_object('canonical_roots',counts.roots,'approved_eligible',counts.approved_eligible,
    'pending',counts.pending,'unattributed_final',counts.unattributed),
  'governed_views',jsonb_build_object('ready_compilations',counts.ready_compilations,
    'current_bindings',counts.current_bindings,'stale_or_invalidated',counts.stale_compilations),
  'strategic',jsonb_build_object('compilation_ready',counts.strategic_ready,
    'binding_current',counts.strategic_binding,'authorized_provenance_routes',counts.strategic_routes)
) AS payload
FROM workspace,policy_quality,policy_retention,policy_licensing,source_state,counts`;
