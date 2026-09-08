import { createHash } from "node:crypto";

import { resolveWorkspaceImportStorageV1 } from "./workspace-import-storage";
import { pool } from "@/lib/db";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import { createWorkspaceConnectorSourceProductV1 } from "@/lib/data-os/workspace-ingestion";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import {
  executeSignalGovernanceControlCommandV1
} from "@/lib/data-os/signal-governance-control-plane";
import {
  activateSignalDataGovernanceObjectV1,
  ensureSignalLicensingPolicyDraftV1,
  ensureSignalProvenancePolicyBindingDraftV1,
  ensureSignalQualityPolicyDraftV1,
  ensureSignalRetentionPolicyDraftV1
} from "@/lib/data-os/signal-data-governance";
import {
  loadSignalAcquisitionPlanV1,
  promoteSignalAcquisitionPlanV1,
  reconcileSignalAcquisitionPlanDraftV1
} from "@/lib/data-os/signal-acquisition-plan";
import {
  WORKSPACE_MANUAL_IMPORT_SETUP_VERSION,
  manualImportUsageDecisionsV1,
  type WorkspaceManualImportSetupInputV1
} from "@/lib/data-os/workspace-manual-import-contract";

type Context = {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  access: "manual-import";
};

export class WorkspaceManualImportSetupError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export async function loadWorkspaceManualImportSetupV1(args: Context) {
  const identity = await args.queryable.query<{ category_name: string | null; suggested: string | null }>(`
      SELECT CASE WHEN count(entity.id)=1 THEN min(entity.canonical_name) END category_name,
        brand.industry suggested
      FROM brands brand LEFT JOIN intelligence_entities entity
        ON entity.brand_id=brand.id AND entity.organization_id=brand.organization_id
        AND entity.entity_type='category' AND entity.status='active'
      WHERE brand.id=$1::uuid AND brand.organization_id=$2::uuid
      GROUP BY brand.id
    `, [args.workspace.subject.id, args.workspace.organizationId]);
  const sources = await args.queryable.query<{ source_key: string; name: string; external_ai_processing: boolean }>(`
      SELECT source.source_key,source.name,
        EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=binding.licensing_policy_id
            AND usage.usage_purpose='llm-processing' AND usage.decision='allowed') external_ai_processing
      FROM data_sources source
      JOIN signal_provenance_policy_bindings binding ON binding.data_source_id=source.id
        AND binding.workspace_id=source.workspace_id AND binding.import_batch_id IS NULL
        AND binding.status='active' AND binding.effective_from<=clock_timestamp()
        AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
      JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
        AND quality.workspace_id=source.workspace_id AND quality.status='active'
        AND quality.effective_from<=clock_timestamp()
        AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.workspace_id=source.workspace_id AND retention.status='active'
        AND retention.retention_state='allowed' AND retention.effective_from<=clock_timestamp()
        AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
        AND (retention.retain_until IS NULL OR retention.retain_until>clock_timestamp())
      JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.workspace_id=source.workspace_id AND licensing.status='active'
        AND licensing.effective_from<=clock_timestamp()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
      WHERE source.workspace_id=$1::uuid AND source.status='active'
        AND source.source_contract_version='signal-data-source-connector-v1'
        AND source.role->>'manual_import_setup'=$2
        AND (SELECT count(*) FROM signal_licensing_policy_usages usage
          WHERE usage.licensing_policy_id=licensing.id AND usage.decision='allowed'
            AND usage.usage_purpose IN ('internal-qa','client-derived-metrics','client-mention-list','client-text-or-excerpt'))=4
      ORDER BY source.created_at,source.id
    `, [args.workspace.id, WORKSPACE_MANUAL_IMPORT_SETUP_VERSION]);
  const plan = await loadSignalAcquisitionPlanV1(args);
  let storageReady = false;
  try { resolveWorkspaceImportStorageV1(); storageReady = true; } catch { /* Expose configuration state, never credentials. */ }
  const configured = plan.state === "current" && plan.readiness.ready_for_import && sources.rows.length > 0;
  return {
    contract_version: WORKSPACE_MANUAL_IMPORT_SETUP_VERSION,
    category_name: identity.rows[0]?.category_name ?? null,
    category_name_suggested: identity.rows[0]?.suggested ?? null,
    sources: sources.rows,
    slots: plan.slots.filter(slot => slot.desired_state === "active")
      .map(slot => ({ slot_key: slot.slot_key, scope: slot.scope, label: slot.label })),
    configured,
    storage_ready: storageReady,
    ready_for_import: configured && storageReady,
    external_ai_processing: sources.rows.length === 1 ? sources.rows[0]!.external_ai_processing : null,
    timezone: args.workspace.timezone,
    import_url: `/api/data-os/signal/${args.workspace.id}/acquisition-plan/imports`
  };
}

export function loadWorkspaceManualImportSetupProductV1(args: Omit<Context, "queryable">) {
  return loadWorkspaceManualImportSetupV1({ ...args, queryable: pool });
}

export async function prepareWorkspaceManualImportV1(args: Context & {
  idempotencyKey: string;
  input: WorkspaceManualImportSetupInputV1;
}) {
  // The existing operation record owns the entire setup. A retry cannot create
  // another connector, replace rights, or promote another acquisition plan.
  const operation = await beginSignalProductOperationV1<Awaited<ReturnType<typeof loadWorkspaceManualImportSetupV1>> & { source_key: string }>({
    ...args, action: "create-source", input: args.input
  });
  if (operation.replay) return { ...await loadWorkspaceManualImportSetupV1(args), source_key: operation.replay.source_key };
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `workspace-manual-import-setup:${args.workspace.id}`
  ]);
  const stepKey = (step: string) => hash(`${operation.key}:${step}`);
  const categories = await args.queryable.query<{ canonical_name: string }>(`
    SELECT canonical_name FROM intelligence_entities
    WHERE organization_id=$1::uuid AND brand_id=$2::uuid
      AND entity_type='category' AND status='active' FOR UPDATE
  `, [args.workspace.organizationId, args.workspace.subject.id]);
  if (categories.rows.length > 1 || (categories.rows[0]
    && categories.rows[0].canonical_name.toLocaleLowerCase("und") !== args.input.category_name.toLocaleLowerCase("und"))) {
    throw new WorkspaceManualImportSetupError("category_identity_conflict");
  }
  if (categories.rows.length === 0) {
    await executeSignalGovernanceControlCommandV1({ ...args, idempotencyKey: stepKey("category"), command: {
      action: "upsert-identity", entity_type: "category", canonical_name: args.input.category_name, external_id: null
    } });
  }
  const source = await createWorkspaceConnectorSourceProductV1({
    ...args, idempotencyKey: stepKey("connector"), input: {
      contract_version: "signal-data-source-connector-v1", name: args.input.source_name,
      provider: args.input.provider, source_type: "social-listening", connection_method: "manual-csv"
    }
  });
  const sourceRow = await args.queryable.query<{ id: string }>(`
    UPDATE data_sources SET role=role||jsonb_build_object('manual_import_setup',$3::text)
    WHERE workspace_id=$1::uuid AND source_key=$2
      AND source_contract_version='signal-data-source-connector-v1' RETURNING id::text
  `, [args.workspace.id, source.source_key, WORKSPACE_MANUAL_IMPORT_SETUP_VERSION]);
  const sourceId = sourceRow.rows[0]?.id;
  if (!sourceId) throw new WorkspaceManualImportSetupError("connector_not_found");

  const policyKey = `manual-${sourceId}`;
  const shared = { queryable: args.queryable, organizationId: args.workspace.organizationId, actor: args.actor, access: args.access };
  const definition = { workspace_id: args.workspace.id, policy_key: policyKey, policy_version: 1 };
  const evidenceHash = hash(JSON.stringify({ contract_version: WORKSPACE_MANUAL_IMPORT_SETUP_VERSION,
    actor_id: args.actor.id, source_key: source.source_key, rights: args.input.rights }));
  const quality = await ensureSignalQualityPolicyDraftV1({ ...shared, idempotencyKey: stepKey("quality"), definition: {
    ...definition, min_quality_score: null, required_quality_flags: [], forbidden_quality_flags: [],
    canonical_root_disposition: "evaluate"
  } });
  const retention = await ensureSignalRetentionPolicyDraftV1({ ...shared, idempotencyKey: stepKey("retention"), definition: {
    ...definition, retention_state: "allowed", retention_mode: args.input.rights.retention_until ? "until" : "indefinite",
    retain_until: args.input.rights.retention_until, expiry_action: "block_use", approval_evidence_hash: evidenceHash
  } });
  const licensing = await ensureSignalLicensingPolicyDraftV1({ ...shared, idempotencyKey: stepKey("licensing"), definition: {
    ...definition, approval_evidence_hash: evidenceHash, usages: [...manualImportUsageDecisionsV1(args.input)]
  } });
  for (const [kind, policy] of [["quality-policy", quality], ["retention-policy", retention], ["licensing-policy", licensing]] as const) {
    await activateSignalDataGovernanceObjectV1({ queryable: args.queryable, workspaceId: args.workspace.id,
      actor: args.actor, access: args.access, objectKind: kind, objectId: policy.policy_id, idempotencyKey: stepKey(`activate-${kind}`) });
  }
  const binding = await ensureSignalProvenancePolicyBindingDraftV1({
    queryable: args.queryable, actor: args.actor, access: args.access, idempotencyKey: stepKey("binding"), definition: {
      workspace_id: args.workspace.id, data_source_id: sourceId, import_batch_id: null, binding_version: 1,
      quality_policy_id: quality.policy_id, retention_policy_id: retention.policy_id, licensing_policy_id: licensing.policy_id
    }
  });
  await activateSignalDataGovernanceObjectV1({ queryable: args.queryable, workspaceId: args.workspace.id,
    actor: args.actor, access: args.access, objectKind: "provenance-binding", objectId: binding.binding_id, idempotencyKey: stepKey("activate-binding") });

  const current = await loadSignalAcquisitionPlanV1(args);
  if (current.state !== "current") {
    // An unrelated, manually edited draft is not silently promoted by importing.
    if (current.draft_plan) throw new WorkspaceManualImportSetupError("existing_acquisition_draft_requires_resolution");
    const reconciled = await reconcileSignalAcquisitionPlanDraftV1({ ...args, idempotencyKey: stepKey("plan"),
      expectedCurrentVersion: current.current_plan?.version ?? null, expectedBrandOsRevision: null });
    const draft = reconciled.draft_plan;
    if (!draft || !reconciled.readiness.ready_to_promote) throw new WorkspaceManualImportSetupError("acquisition_setup_blocked");
    const clock = await args.queryable.query<{ now: string }>("SELECT clock_timestamp()::text AS now");
    await promoteSignalAcquisitionPlanV1({ ...args, idempotencyKey: stepKey("activate-plan"),
      expectedDraftVersion: draft.version, expectedDraftRevision: draft.draft_revision, expectedDraftDigest: draft.draft_digest,
      effectiveFrom: clock.rows[0]!.now, evidence: "Manual CSV setup: current Brand OS identities define capture slots; query evidence remains unavailable and no semantic attribution is granted."
    });
  }
  const result = { ...await loadWorkspaceManualImportSetupV1(args), source_key: source.source_key };
  if (!result.configured) throw new WorkspaceManualImportSetupError("acquisition_setup_blocked");
  await completeSignalProductOperationV1({ queryable: args.queryable, workspaceId: args.workspace.id, key: operation.key, result });
  return result;
}

export async function prepareWorkspaceManualImportInTransactionV1(args: Omit<Parameters<typeof prepareWorkspaceManualImportV1>[0], "queryable">) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await prepareWorkspaceManualImportV1({ ...args, queryable: client });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (attempt < 2 && error && typeof error === "object" && "code" in error && error.code === "40001") continue;
      throw error;
    } finally { client.release(); }
  }
}

function hash(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

export type WorkspaceManualImportSetupV1 = Awaited<ReturnType<typeof loadWorkspaceManualImportSetupV1>>;
