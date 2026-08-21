import { createHash } from "node:crypto";

import {
  SIGNAL_DATA_USAGE_PURPOSES,
  type SignalDataUsagePurposeV1,
  type SignalLicensingPolicyDefinitionV1
} from "@noisia/query-engine";

import {
  activateSignalDataGovernanceObjectV1,
  ensureSignalLicensingPolicyDraftV1,
  ensureSignalProvenancePolicyBindingDraftV1
} from "@/lib/data-os/signal-data-governance";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import {
  auditSignalSemanticBenchmarkFrozenCorpusV2,
  type SignalSemanticBenchmarkFrozenCorpusV2
} from "@/lib/data-os/signal-semantic-benchmark-export";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

const MAX_AUTHORITY_DAYS = 30;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

type BaselineAuthorityRow = {
  import_batch_id: string;
  data_source_id: string;
  typed_observation_count: number;
  binding_count: number;
  binding_id: string;
  quality_policy_id: string;
  retention_policy_id: string;
  licensing_policy_id: string;
  binding_effective_to: string | null;
  retention_effective_to: string | null;
  retain_until: string | null;
  licensing_effective_to: string | null;
  usages: Array<{
    usage_purpose: SignalDataUsagePurposeV1;
    decision: "allowed" | "prohibited" | "not_available";
  }>;
};

export type SignalAcquisitionStrategicAuthorityResultV1 = {
  contract_version: "signal-acquisition-strategic-authority-v1";
  corpus_identity: string;
  corpus_population_digest: string;
  authority_policy_ref: string;
  authority_definition_hash: string;
  authority_digest: string;
  effective_from: string;
  effective_to: string;
  import_count: number;
  licensing_policy_versions_created: number;
  import_bindings_created: number;
  observation_versions_created: number;
  observation_terms_copied: number;
  required_usage: "strategic-analysis";
  llm_processing_allowed: false;
  future_imports_authorized: false;
};

export async function authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  approvalEvidence: string;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
  requestedEffectiveTo?: string | null;
}) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await authorizeSignalAcquisitionBenchmarkStrategicAuthorityV1({
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

export async function authorizeSignalAcquisitionBenchmarkStrategicAuthorityV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  approvalEvidence: string;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
  requestedEffectiveTo?: string | null;
}): Promise<SignalAcquisitionStrategicAuthorityResultV1> {
  assertAuthorityInput(args);
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `signal-acquisition-strategic-authority:${args.workspace.id}:${args.frozenCorpus.population_digest}`
  ]);
  const operation = await beginSignalProductOperationV1<SignalAcquisitionStrategicAuthorityResultV1>({
    queryable: args.queryable,
    workspace: args.workspace,
    actor: args.actor,
    action: "authorize-acquisition-benchmark",
    idempotencyKey: args.idempotencyKey,
    input: {
      contract_version: "signal-acquisition-strategic-authority-v1",
      corpus_identity: args.frozenCorpus.identity,
      population_digest: args.frozenCorpus.population_digest,
      content_digest: args.frozenCorpus.content_digest,
      provenance_digest: args.frozenCorpus.provenance_digest,
      watermark_digest: args.frozenCorpus.watermark_digest,
      requested_effective_to: args.requestedEffectiveTo ?? null,
      approval_evidence_hash: sha256(args.approvalEvidence.trim())
    }
  });
  if (operation.replay) return operation.replay;
  const protectedServingBefore = await protectedServingStateDigest(args.queryable, args.workspace.id);

  const before = await auditSignalSemanticBenchmarkFrozenCorpusV2({
    client: args.queryable as never,
    workspaceId: args.workspace.id,
    frozenCorpus: args.frozenCorpus
  });
  const nonRightsBlockers = before.blockers.filter((blocker) =>
    !blocker.startsWith("strategic_authority_blocked:")
  );
  if (nonRightsBlockers.length > 0) {
    throw new Error(`Frozen acquisition corpus drifted: ${nonRightsBlockers.join(",")}`);
  }

  const baseline = await loadBaselineAuthorities(args);
  const usageMatrix = assertCompatibleUsageMatrix(baseline);
  const effectiveFrom = new Date();
  const effectiveTo = resolveEffectiveTo({
    now: effectiveFrom,
    requested: args.requestedEffectiveTo ?? null,
    baseline
  });
  const policyKey = strategicPolicyKey(args.frozenCorpus);
  const policyVersion = await nextPolicyVersion(args.queryable, args.workspace.id, policyKey);
  const evidenceHash = sha256(stableJson({
    contract_version: "signal-acquisition-strategic-approval-evidence-v1",
    purpose: "10c2-local-modeling-evaluation",
    corpus_identity: args.frozenCorpus.identity,
    population_digest: args.frozenCorpus.population_digest,
    plan_digests: [...new Set(args.frozenCorpus.partitions.map((item) => item.plan_digest))].sort(),
    actor_user_id: args.actor.id,
    import_count: baseline.length,
    effective_from: effectiveFrom.toISOString(),
    effective_to: effectiveTo.toISOString(),
    operator_evidence_hash: sha256(args.approvalEvidence.trim())
  }));
  const usages = usageMatrix.map((usage) => usage.usage_purpose === "strategic-analysis"
    ? { ...usage, decision: "allowed" as const }
    : usage);
  const definition: SignalLicensingPolicyDefinitionV1 = {
    workspace_id: args.workspace.id,
    policy_key: policyKey,
    policy_version: policyVersion,
    approval_evidence_hash: evidenceHash,
    usages
  };
  const policyIdempotency = sha256(`${operation.key}:licensing-draft`);
  const policy = await ensureSignalLicensingPolicyDraftV1({
    queryable: args.queryable,
    organizationId: args.workspace.organizationId,
    actor: args.actor,
    definition,
    idempotencyKey: policyIdempotency,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo.toISOString()
  });
  await activateSignalDataGovernanceObjectV1({
    queryable: args.queryable,
    workspaceId: args.workspace.id,
    actor: args.actor,
    objectKind: "licensing-policy",
    objectId: policy.policy_id,
    idempotencyKey: sha256(`${operation.key}:licensing-activate`)
  });

  const bindings: Array<{ import_batch_id: string; binding_id: string; definition_hash: string }> = [];
  let bindingsCreated = 0;
  for (const authority of baseline) {
    const bindingVersion = await nextBindingVersion(args.queryable, args.workspace.id,
      authority.data_source_id, authority.import_batch_id);
    const binding = await ensureSignalProvenancePolicyBindingDraftV1({
      queryable: args.queryable,
      actor: args.actor,
      definition: {
        workspace_id: args.workspace.id,
        data_source_id: authority.data_source_id,
        import_batch_id: authority.import_batch_id,
        binding_version: bindingVersion,
        quality_policy_id: authority.quality_policy_id,
        retention_policy_id: authority.retention_policy_id,
        licensing_policy_id: policy.policy_id
      },
      idempotencyKey: sha256(`${operation.key}:binding-draft:${authority.import_batch_id}`),
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo.toISOString()
    });
    const activated = await activateSignalDataGovernanceObjectV1({
      queryable: args.queryable,
      workspaceId: args.workspace.id,
      actor: args.actor,
      objectKind: "provenance-binding",
      objectId: binding.binding_id,
      idempotencyKey: sha256(`${operation.key}:binding-activate:${authority.import_batch_id}`)
    });
    if (binding.created) bindingsCreated += 1;
    if (!activated.object_id) throw new Error("Import-level provenance binding activation failed.");
    bindings.push({
      import_batch_id: authority.import_batch_id,
      binding_id: binding.binding_id,
      definition_hash: binding.definition_hash
    });
  }

  const reprojection = await reprojectTypedObservationRights(args.queryable, args.workspace.id, bindings);
  const authorityDigest = sha256(bindings
    .map((binding) => `${binding.import_batch_id}|${binding.definition_hash}`)
    .sort().join("\n"));
  const protectedServingAfter = await protectedServingStateDigest(args.queryable, args.workspace.id);
  if (protectedServingBefore !== protectedServingAfter) {
    throw new Error("Strategic authority transition attempted to mutate protected serving state.");
  }
  const result: SignalAcquisitionStrategicAuthorityResultV1 = {
    contract_version: "signal-acquisition-strategic-authority-v1",
    corpus_identity: args.frozenCorpus.identity,
    corpus_population_digest: args.frozenCorpus.population_digest,
    authority_policy_ref: sha256(`${args.workspace.id}|${policyKey}|${policyVersion}`),
    authority_definition_hash: policy.definition_hash,
    authority_digest: authorityDigest,
    effective_from: effectiveFrom.toISOString(),
    effective_to: effectiveTo.toISOString(),
    import_count: baseline.length,
    licensing_policy_versions_created: policy.created ? 1 : 0,
    import_bindings_created: bindingsCreated,
    observation_versions_created: reprojection.observations,
    observation_terms_copied: reprojection.terms,
    required_usage: "strategic-analysis",
    llm_processing_allowed: false,
    future_imports_authorized: false
  };
  await completeSignalProductOperationV1({
    queryable: args.queryable,
    workspaceId: args.workspace.id,
    key: operation.key,
    result
  });
  return result;
}

async function loadBaselineAuthorities(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
}): Promise<BaselineAuthorityRow[]> {
  const result = await args.queryable.query<BaselineAuthorityRow>(String.raw`
    WITH requested AS MATERIALIZED (
      SELECT value.scope,value.plan_version,value.plan_digest,value.slot_digest
      FROM jsonb_to_recordset($2::jsonb) AS value(
        key text,scope text,entity_ref text,declared_market text,plan_version integer,
        plan_digest text,slot_digest text,total integer,included integer,excluded integer,
        population_digest text,modeling_digest text
      )
    ), batches AS MATERIALIZED (
      SELECT DISTINCT batch.id AS import_batch_id,batch.data_source_id
      FROM requested request
      JOIN signal_acquisition_plans plan ON plan.workspace_id=$1::uuid
        AND plan.plan_version=request.plan_version AND plan.definition_hash=request.plan_digest
      JOIN signal_acquisition_slots slot ON slot.workspace_id=plan.workspace_id
        AND slot.plan_id=plan.id AND slot.definition_hash=request.slot_digest
        AND slot.scope=request.scope
      JOIN import_batches batch ON batch.workspace_id=plan.workspace_id
        AND batch.acquisition_plan_id=plan.id AND batch.acquisition_slot_id=slot.id
        AND batch.status='completed' AND batch.ingestion_phase='completed'
        AND batch.acquisition_contract_version='signal-acquisition-import-v2'
        AND batch.acquisition_plan_digest=request.plan_digest
        AND batch.acquisition_slot_digest=request.slot_digest
        AND batch.acquisition_import_seal_digest IS NOT NULL
        AND batch.provider_observation_projection_state='ready'
    ), current_observations AS MATERIALIZED (
      SELECT batch.import_batch_id,batch.data_source_id,count(*)::int AS typed_observation_count,
        count(DISTINCT observation.provenance_binding_id)::int AS binding_count,
        min(observation.provenance_binding_id::text)::uuid AS binding_id
      FROM batches batch
      JOIN signal_provider_mention_observations observation
        ON observation.workspace_id=$1::uuid AND observation.import_batch_id=batch.import_batch_id
       AND NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
         WHERE successor.supersedes_observation_id=observation.id)
      GROUP BY batch.import_batch_id,batch.data_source_id
    )
    SELECT current.import_batch_id::text,current.data_source_id::text,
      current.typed_observation_count,current.binding_count,binding.id::text AS binding_id,
      binding.quality_policy_id::text,binding.retention_policy_id::text,
      binding.licensing_policy_id::text,binding.effective_to::text AS binding_effective_to,
      retention.effective_to::text AS retention_effective_to,
      retention.retain_until::text,licensing.effective_to::text AS licensing_effective_to,
      (SELECT jsonb_agg(jsonb_build_object('usage_purpose',usage.usage_purpose,
        'decision',usage.decision) ORDER BY usage.usage_purpose)
       FROM signal_licensing_policy_usages usage
       WHERE usage.licensing_policy_id=licensing.id) AS usages
    FROM current_observations current
    JOIN signal_provenance_policy_bindings binding
      ON binding.id=current.binding_id AND binding.workspace_id=$1::uuid
     AND binding.data_source_id=current.data_source_id AND binding.status='active'
     AND binding.effective_from<=clock_timestamp()
     AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
    JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
     AND quality.workspace_id=$1::uuid AND quality.status='active'
     AND quality.effective_from<=clock_timestamp()
     AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
    JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
     AND retention.workspace_id=$1::uuid AND retention.status='active'
     AND retention.retention_state='allowed' AND retention.effective_from<=clock_timestamp()
     AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
     AND (retention.retain_until IS NULL OR retention.retain_until>clock_timestamp())
    JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
     AND licensing.workspace_id=$1::uuid AND licensing.status='active'
     AND licensing.effective_from<=clock_timestamp()
     AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
    ORDER BY current.import_batch_id
  `, [args.workspace.id, JSON.stringify(args.frozenCorpus.partitions)]);
  if ((result.rowCount ?? 0) < 1 || result.rows.some((row) => row.binding_count !== 1
    || row.typed_observation_count < 1 || !row.binding_id)) {
    throw new Error("Frozen imports do not have one current typed rights authority.");
  }
  return result.rows;
}

function assertCompatibleUsageMatrix(rows: BaselineAuthorityRow[]) {
  const matrices = rows.map((row) => [...row.usages].sort((left, right) =>
    left.usage_purpose.localeCompare(right.usage_purpose)));
  const expectedPurposes = [...SIGNAL_DATA_USAGE_PURPOSES].sort();
  for (const usages of matrices) {
    if (stableJson(usages.map((usage) => usage.usage_purpose).sort()) !== stableJson(expectedPurposes)) {
      throw new Error("Baseline licensing usage matrix is incomplete.");
    }
    if (usages.find((usage) => usage.usage_purpose === "llm-processing")?.decision === "allowed") {
      throw new Error("This operation cannot preserve an already allowed llm-processing decision.");
    }
  }
  if (matrices.some((matrix) => stableJson(matrix) !== stableJson(matrices[0]))) {
    throw new Error("Frozen imports have incompatible baseline licensing decisions.");
  }
  return matrices[0]!;
}

function resolveEffectiveTo(args: { now: Date; requested: string | null; baseline: BaselineAuthorityRow[] }) {
  const maximum = new Date(args.now.getTime() + MAX_AUTHORITY_DAYS * 86_400_000);
  const candidates = [maximum, ...(args.requested ? [timestamp(args.requested)] : []),
    ...args.baseline.flatMap((row) => [row.binding_effective_to,row.retention_effective_to,
      row.retain_until,row.licensing_effective_to].filter((value): value is string => Boolean(value)).map(timestamp))];
  const effective = new Date(Math.min(...candidates.map((value) => value.getTime())));
  if (effective.getTime() <= args.now.getTime()) {
    throw new Error("Retention or licensing does not cover the strategic authority window.");
  }
  return effective;
}

async function nextPolicyVersion(queryable: SignalBrandPolicyQueryable, workspaceId: string, policyKey: string) {
  const result = await queryable.query<{ version: number }>(`
    SELECT COALESCE(max(policy_version),0)::int+1 AS version
    FROM signal_licensing_policies WHERE workspace_id=$1::uuid AND policy_key=$2
  `, [workspaceId, policyKey]);
  return result.rows[0]?.version ?? 1;
}

async function nextBindingVersion(queryable: SignalBrandPolicyQueryable, workspaceId: string,
  sourceId: string, importBatchId: string) {
  const result = await queryable.query<{ version: number }>(`
    SELECT COALESCE(max(binding_version),0)::int+1 AS version
    FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid
      AND data_source_id=$2::uuid AND import_batch_id=$3::uuid
  `, [workspaceId, sourceId, importBatchId]);
  return result.rows[0]?.version ?? 1;
}

async function reprojectTypedObservationRights(queryable: SignalBrandPolicyQueryable,
  workspaceId: string, bindings: Array<{ import_batch_id: string; binding_id: string }>) {
  const result = await queryable.query<{ observation_count: number; term_count: number }>(String.raw`
    WITH requested AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($2::jsonb)
        AS value(import_batch_id uuid,binding_id uuid)
    ), current_observations AS MATERIALIZED (
      SELECT observation.*,requested.binding_id,binding.definition_hash AS next_rights_hash,
        retention.retain_until AS next_retention_until
      FROM requested
      JOIN signal_provenance_policy_bindings binding ON binding.id=requested.binding_id
       AND binding.workspace_id=$1::uuid AND binding.import_batch_id=requested.import_batch_id
       AND binding.status='active'
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
      JOIN signal_provider_mention_observations observation
        ON observation.workspace_id=$1::uuid
       AND observation.import_batch_id=requested.import_batch_id
       AND NOT EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
         WHERE successor.supersedes_observation_id=observation.id)
    ), payloads AS MATERIALIZED (
      SELECT observation.id AS previous_id,
        to_jsonb(observation) || jsonb_build_object(
          'id',gen_random_uuid(),'observation_version',observation.observation_version+1,
          'supersedes_observation_id',observation.id,'provenance_binding_id',observation.binding_id,
          'rights_definition_hash',observation.next_rights_hash,
          'retention_until',observation.next_retention_until,'created_at',clock_timestamp()
        ) AS payload
      FROM current_observations observation
    ), inserted AS MATERIALIZED (
      INSERT INTO signal_provider_mention_observations
      SELECT (jsonb_populate_record(NULL::signal_provider_mention_observations,payload)).*
      FROM payloads RETURNING id,supersedes_observation_id
    ), copied_terms AS (
      INSERT INTO signal_provider_mention_observation_terms(
        id,observation_id,workspace_id,term_kind,ordinal,term_private,term_hash,normalized_term,created_at
      ) SELECT gen_random_uuid(),inserted.id,term.workspace_id,term.term_kind,term.ordinal,
        term.term_private,term.term_hash,term.normalized_term,clock_timestamp()
      FROM inserted JOIN signal_provider_mention_observation_terms term
        ON term.observation_id=inserted.supersedes_observation_id
      RETURNING id
    ) SELECT (SELECT count(*)::int FROM inserted) AS observation_count,
      (SELECT count(*)::int FROM copied_terms) AS term_count
  `, [workspaceId, JSON.stringify(bindings)]);
  const row = result.rows[0];
  if (!row || row.observation_count < 1) throw new Error("Typed rights reprojection created no successors.");
  return { observations: row.observation_count, terms: row.term_count };
}

async function protectedServingStateDigest(queryable: SignalBrandPolicyQueryable, workspaceId: string) {
  const domains = [
    ["pointers", "signal_workspace_population_pointers", "row_value.workspace_id=$1::uuid"],
    ["governed-bindings", "signal_governed_view_bindings", "row_value.workspace_id=$1::uuid"],
    ["materializations", "metric_materializations", "row_value.workspace_id=$1::uuid"],
    ["classification-generations", "signal_classification_generations", "row_value.workspace_id=$1::uuid"],
    ["classification-assignments", "signal_classification_assignments", "row_value.workspace_id=$1::uuid"],
    ["record-tags", "record_tags", `EXISTS (
      SELECT 1 FROM signal_workspaces protected_workspace WHERE protected_workspace.id=$1::uuid
        AND (row_value.brand_id=protected_workspace.brand_id OR EXISTS (
          SELECT 1 FROM signal_classification_generations protected_generation
          WHERE protected_generation.id=row_value.classification_generation_id
            AND protected_generation.workspace_id=protected_workspace.id
        ))
    )`]
  ] as const;
  const state: Array<{ key: string;count: number;digest: string }> = [];
  for (const [key, table, workspacePredicate] of domains) {
    const result = await queryable.query<{ count: number;digest: string }>(`
      WITH rows AS (SELECT to_jsonb(row_value) value FROM ${table} row_value
        WHERE ${workspacePredicate}), hashes AS (
        SELECT encode(digest(convert_to(value::text,'UTF8'),'sha256'),'hex') value FROM rows
      ) SELECT count(*)::int count,encode(digest(convert_to(
        COALESCE(string_agg(value,'' ORDER BY value),''),'UTF8'),'sha256'),'hex') digest FROM hashes
    `, [workspaceId]);
    state.push({ key,count: result.rows[0]?.count ?? 0,digest: result.rows[0]?.digest ?? "" });
  }
  return sha256(stableJson(state));
}

function assertAuthorityInput(args: {
  workspace: ResolvedSignalWorkspace;actor: SignalWorkspaceUser;approvalEvidence: string;
  frozenCorpus: SignalSemanticBenchmarkFrozenCorpusV2;
}) {
  if (args.workspace.status !== "active" || args.workspace.subject.type !== "brand"
    || args.actor.userType !== "noisia_internal") {
    throw new Error("Strategic authority requires an active brand workspace and internal actor.");
  }
  if (args.approvalEvidence.trim().length < 8) throw new Error("Operator approval evidence is required.");
  if (args.frozenCorpus.partitions.length < 1 || !HASH_PATTERN.test(args.frozenCorpus.population_digest)) {
    throw new Error("Frozen acquisition corpus identity is invalid.");
  }
}

function strategicPolicyKey(corpus: SignalSemanticBenchmarkFrozenCorpusV2) {
  return `acquisition-strategic-${sha256(`${corpus.identity}|${corpus.population_digest}`).slice(7, 27)}`;
}

function timestamp(value: string) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("Strategic authority expiration is invalid.");
  return result;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>)
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([key,entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
