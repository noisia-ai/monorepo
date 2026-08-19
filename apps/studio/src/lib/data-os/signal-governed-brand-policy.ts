import {
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  compileSignalPopulationPolicyBundleV1,
  signalGovernedViewCompilationPlanHashV1,
  signalPopulationPolicyDefinitionHashV1,
  validateSignalPopulationPolicyBundleDefinitionV1,
  type SignalCompiledPopulationPolicyV1,
  type SignalDataUsagePurposeV1,
  type SignalGovernedViewModuleKeyV1,
  type SignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";

import { evaluateSignalBrandDataGovernanceV1 } from "@/lib/data-os/signal-data-governance";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

export const SIGNAL_BRAND_POLICY_KEY = "operational-brand-governed" as const;
export const SIGNAL_BRAND_POLICY_VERSION = 1 as const;
export const SIGNAL_BRAND_POLICY_MODULES = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const satisfies readonly SignalGovernedViewModuleKeyV1[];
export const SIGNAL_BRAND_POLICY_REQUIRED_USAGES = [
  "client-derived-metrics",
  "client-mention-list",
  "client-text-or-excerpt"
] as const satisfies readonly SignalDataUsagePurposeV1[];

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };

export interface SignalBrandPolicyQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>>;
}

export type SignalBrandPolicyGovernanceV1 = {
  quality: {
    status: "resolved";
    policy_id: string;
    policy_key: string;
    policy_version: number;
    min_score: number | null;
    required_flags: string[];
    forbidden_flags: string[];
  } | {
    status: "not_available";
  };
  data_governance: {
    status: "resolved";
    retention_policy_ref: string;
    licensing_policy_ref: string;
    required_usage_purposes: SignalDataUsagePurposeV1[];
  } | {
    status: "not_available";
  };
};

export type SignalBrandPolicyDraftV1 = {
  policy_bundle_id: string;
  workspace_id: string;
  policy_key: typeof SIGNAL_BRAND_POLICY_KEY;
  policy_version: number;
  definition_hash: string;
  status: "draft";
  created: boolean;
  readiness: SignalCompiledPopulationPolicyV1["readiness"];
};

export type SignalBrandPolicyCandidateReconciliationV1 = {
  workspace_id: string;
  policy_bundle_id: string;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  base_population_id: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  expected_membership_count: number;
  actual_membership_count: number;
  expected_membership_digest: string;
  actual_membership_digest: string;
  alias_membership_count: number;
  source_watermark_hash: string;
  source_watermark_at: string | null;
  compilation_status: "ready" | "stale" | "blocked";
  blocking_reasons: string[];
  policy_matches_memberships: boolean;
  policy_compilation_id: string;
  compilation_version: number;
  governance_evaluation_id: string | null;
  governance_digest: string | null;
  authorized_root_count: number;
  quality_blocked_count: number;
  retention_blocked_count: number;
  licensing_blocked_count: number;
  governance_unknown_count: number | null;
  governance_unknown_availability: "measured" | "not_available";
  current_pointer_unchanged: true;
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: "brand";
  usage_purposes: SignalDataUsagePurposeV1[];
};

export function buildSignalBrandPolicyDefinitionV1(args: {
  workspace: ResolvedSignalWorkspace;
  governance: SignalBrandPolicyGovernanceV1;
  policyVersion?: number;
}): SignalPopulationPolicyBundleDefinitionV1 {
  if (args.workspace.status !== "active" || args.workspace.subject.type !== "brand") {
    throw new Error("Brand policy drafts require an active brand workspace.");
  }
  const quality = args.governance.quality;
  const dataGovernance = args.governance.data_governance;
  return validateSignalPopulationPolicyBundleDefinitionV1({
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    policy_key: SIGNAL_BRAND_POLICY_KEY,
    policy_version: args.policyVersion ?? SIGNAL_BRAND_POLICY_VERSION,
    authorized_modules: [...SIGNAL_BRAND_POLICY_MODULES],
    allowed_scopes: ["primary_brand"],
    allowed_entities: [{
      scope: "primary_brand",
      entity_type: "brand",
      entity_id: args.workspace.subject.id
    }],
    acceptance_status: "included",
    quality_contract_status: quality.status,
    quality_policy_key: quality.status === "resolved" ? quality.policy_key : null,
    quality_policy_version: quality.status === "resolved" ? quality.policy_version : null,
    min_quality_score: quality.status === "resolved" ? quality.min_score : null,
    required_quality_flags: quality.status === "resolved" ? quality.required_flags : [],
    forbidden_quality_flags: quality.status === "resolved" ? quality.forbidden_flags : [],
    eligibility_policy: "semantic-approved-eligible",
    deduplication_policy: "canonical-root",
    visibility_class: "client-safe",
    denominator_key: "eligible-canonical-roots",
    period_start: null,
    period_end: null,
    timezone: null,
    retention_policy_ref: dataGovernance.status === "resolved"
      ? dataGovernance.retention_policy_ref
      : null,
    licensing_policy_ref: dataGovernance.status === "resolved"
      ? dataGovernance.licensing_policy_ref
      : null,
    data_governance_contract_status: dataGovernance.status,
    quality_policy_id: quality.status === "resolved" ? quality.policy_id : null,
    required_usage_purposes: dataGovernance.status === "resolved"
      ? dataGovernance.required_usage_purposes
      : []
  });
}

export async function ensureSignalBrandPolicyDraftV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  policyVersion?: number;
  queryable?: SignalBrandPolicyQueryable;
}): Promise<SignalBrandPolicyDraftV1> {
  if (args.actor.userType !== "noisia_internal") {
    throw new Error("Brand policy drafts require an internal server-resolved actor.");
  }
  if (args.workspace.subject.type !== "brand") {
    throw new Error("Brand policy drafts require a brand workspace.");
  }
  if (args.queryable) {
    return ensureSignalBrandPolicyDraftWithClient(
      args.workspace,
      args.actor,
      args.queryable,
      args.policyVersion
    );
  }
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await ensureSignalBrandPolicyDraftWithClient(
      args.workspace,
      args.actor,
      client,
      args.policyVersion
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSignalBrandPolicyDraftWithClient(
  workspace: ResolvedSignalWorkspace,
  actor: SignalWorkspaceUser,
  queryable: SignalBrandPolicyQueryable,
  policyVersion: number = SIGNAL_BRAND_POLICY_VERSION
): Promise<SignalBrandPolicyDraftV1> {
  await queryable.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${workspace.id}:${SIGNAL_BRAND_POLICY_KEY}:${policyVersion}`]
  );
  const identity = await queryable.query<{
    workspace_id: string;
    organization_id: string;
    brand_id: string;
    workspace_status: string;
    actor_id: string | null;
    actor_user_type: string | null;
    actor_organization_id: string | null;
  }>(`
    SELECT
      workspace.id::text AS workspace_id,
      workspace.organization_id::text AS organization_id,
      workspace.brand_id::text AS brand_id,
      workspace.status AS workspace_status,
      actor.id::text AS actor_id,
      actor.user_type AS actor_user_type,
      actor.organization_id::text AS actor_organization_id
    FROM signal_workspaces workspace
    LEFT JOIN users actor ON actor.id = $2::uuid
    WHERE workspace.id = $1::uuid
  `, [workspace.id, actor.id]);
  const row = identity.rows[0];
  if (!row
    || row.workspace_status !== "active"
    || row.organization_id !== workspace.organizationId
    || row.brand_id !== workspace.subject.id
    || row.actor_id !== actor.id
    || row.actor_user_type !== "noisia_internal") {
    throw new Error("Brand policy actor or workspace ownership is invalid.");
  }

  // There is no workspace-level, versioned mention-quality/retention/licensing catalog
  // in the current schema. Keep the draft honest and blocked instead of manufacturing
  // thresholds from a fixture or a legacy population.
  const definition = buildSignalBrandPolicyDefinitionV1({
    workspace,
    policyVersion,
    governance: {
      quality: { status: "not_available" },
      data_governance: { status: "not_available" }
    }
  });
  const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
  const existing = await queryable.query<{
    id: string;
    definition_hash: string;
    status: string;
    entity_count: number;
    exact_entity: boolean;
  }>(`
    SELECT bundle.id::text, bundle.definition_hash, bundle.status,
      entity.entity_count,
      entity.exact_entity
    FROM signal_population_policy_bundles bundle
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS entity_count,
        bool_and(scope = 'primary_brand' AND entity_type = 'brand'
          AND entity_id = $4::uuid) AS exact_entity
      FROM signal_population_policy_entities allowed
      WHERE allowed.policy_bundle_id = bundle.id
        AND allowed.workspace_id = bundle.workspace_id
    ) entity
    WHERE bundle.workspace_id = $1::uuid
      AND bundle.policy_key = $2
      AND bundle.policy_version = $3
    FOR UPDATE OF bundle
  `, [
    workspace.id,
    SIGNAL_BRAND_POLICY_KEY,
    policyVersion,
    workspace.subject.id
  ]);
  const persisted = existing.rows[0];
  if (persisted) {
    if (persisted.status !== "draft"
      || persisted.entity_count !== 1
      || persisted.exact_entity !== true) {
      throw new Error("Existing brand policy version has incompatible governed content.");
    }
    const compiled = compileSignalPopulationPolicyBundleV1({
      policy_bundle_id: persisted.id,
      definition_hash: definitionHash,
      definition
    });
    return {
      policy_bundle_id: persisted.id,
      workspace_id: workspace.id,
      policy_key: SIGNAL_BRAND_POLICY_KEY,
      policy_version: policyVersion,
      definition_hash: persisted.definition_hash,
      status: "draft",
      created: false,
      readiness: compiled.readiness
    };
  }

  const inserted = await queryable.query<{ id: string }>(`
    INSERT INTO signal_population_policy_bundles (
      workspace_id, policy_key, policy_version, status,
      authorized_modules, allowed_scopes, acceptance_status,
      quality_contract_status, quality_policy_key, quality_policy_version,
      min_quality_score, required_quality_flags, forbidden_quality_flags,
      eligibility_policy, deduplication_policy, visibility_class,
      denominator_key, period_start, period_end, timezone,
      retention_policy_ref, licensing_policy_ref,
      data_governance_contract_status, quality_policy_id,
      required_usage_purposes, definition_hash,
      created_by_user_id
    ) VALUES (
      $1::uuid, $2, $3, 'draft', $4::text[], $5::text[], $6,
      $7, $8, $9, $10, $11::text[], $12::text[],
      $13, $14, $15, $16, $17::date, $18::date, $19,
      $20, $21, $22, $23::uuid, $24::text[], $25, $26::uuid
    )
    RETURNING id::text
  `, [
    workspace.id,
    definition.policy_key,
    definition.policy_version,
    definition.authorized_modules,
    definition.allowed_scopes,
    definition.acceptance_status,
    definition.quality_contract_status,
    definition.quality_policy_key,
    definition.quality_policy_version,
    definition.min_quality_score,
    definition.required_quality_flags,
    definition.forbidden_quality_flags,
    definition.eligibility_policy,
    definition.deduplication_policy,
    definition.visibility_class,
    definition.denominator_key,
    definition.period_start,
    definition.period_end,
    definition.timezone,
    definition.retention_policy_ref,
    definition.licensing_policy_ref,
    definition.data_governance_contract_status,
    definition.quality_policy_id,
    definition.required_usage_purposes,
    definitionHash,
    actor.id
  ]);
  const policyBundleId = inserted.rows[0]!.id;
  await queryable.query(`
    INSERT INTO signal_population_policy_entities (
      workspace_id, policy_bundle_id, scope, entity_type, entity_id
    ) VALUES ($1::uuid, $2::uuid, 'primary_brand', 'brand', $3::uuid)
  `, [workspace.id, policyBundleId, workspace.subject.id]);
  await queryable.query(
    "SELECT assert_signal_population_policy_bundle_contract($1::uuid)",
    [policyBundleId]
  );
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: policyBundleId,
    definition_hash: definitionHash,
    definition
  });
  return {
    policy_bundle_id: policyBundleId,
    workspace_id: workspace.id,
    policy_key: SIGNAL_BRAND_POLICY_KEY,
    policy_version: policyVersion,
    definition_hash: definitionHash,
    status: "draft",
    created: true,
    readiness: compiled.readiness
  };
}

export async function reconcileSignalBrandPolicyCandidateV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  policyBundleId: string;
  moduleKey?: SignalGovernedViewModuleKeyV1;
  reconcileMemberships?: boolean;
  queryable?: SignalBrandPolicyQueryable;
}): Promise<SignalBrandPolicyCandidateReconciliationV1> {
  if (args.actor.userType !== "noisia_internal") {
    throw new Error("Brand policy compilation requires an internal server-resolved actor.");
  }
  if (args.queryable) {
    return reconcileSignalBrandPolicyCandidateWithClient(args, args.queryable);
  }
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await reconcileSignalBrandPolicyCandidateWithClient(args, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveSignalBrandPolicyDraftGovernanceV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  policyBundleId: string;
  qualityPolicyId: string;
  queryable?: SignalBrandPolicyQueryable;
}): Promise<SignalBrandPolicyDraftV1> {
  if (args.actor.userType !== "noisia_internal" || args.workspace.subject.type !== "brand") {
    throw new Error("Brand data-governance resolution requires an internal brand-workspace actor.");
  }
  if (args.queryable) return resolveSignalBrandPolicyDraftGovernanceWithClient(args, args.queryable);
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await resolveSignalBrandPolicyDraftGovernanceWithClient(args, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resolveSignalBrandPolicyDraftGovernanceWithClient(
  args: {
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    policyBundleId: string;
    moduleKey?: SignalGovernedViewModuleKeyV1;
    qualityPolicyId: string;
  },
  queryable: SignalBrandPolicyQueryable
): Promise<SignalBrandPolicyDraftV1> {
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${args.workspace.id}:brand-policy-governance:${args.policyBundleId}`
  ]);
  const authority = await queryable.query<{
    bundle_policy_version: number;
    policy_key: string;
    policy_version: number;
    min_quality_score: number | null;
    required_quality_flags: string[];
    forbidden_quality_flags: string[];
    canonical_root_disposition: string;
  }>(`
    SELECT bundle.policy_version AS bundle_policy_version,
      quality.policy_key, quality.policy_version, quality.min_quality_score,
      quality.required_quality_flags, quality.forbidden_quality_flags,
      quality.canonical_root_disposition
    FROM signal_quality_policies quality
    JOIN signal_population_policy_bundles bundle
      ON bundle.id = $3::uuid AND bundle.workspace_id = quality.workspace_id
      AND bundle.status = 'draft'
    WHERE quality.id = $2::uuid AND quality.workspace_id = $1::uuid
      AND quality.status = 'active'
      AND signal_data_governance_actor_is_valid(quality.workspace_id, $4::uuid)
  `, [args.workspace.id, args.qualityPolicyId, args.policyBundleId, args.actor.id]);
  const quality = authority.rows[0];
  if (!quality || quality.canonical_root_disposition !== "evaluate") {
    throw new Error("Brand policy requires an active evaluable quality authority in the same workspace.");
  }
  const definition = buildSignalBrandPolicyDefinitionV1({
    workspace: args.workspace,
    policyVersion: quality.bundle_policy_version,
    governance: {
      quality: {
        status: "resolved",
        policy_id: args.qualityPolicyId,
        policy_key: quality.policy_key,
        policy_version: quality.policy_version,
        min_score: quality.min_quality_score,
        required_flags: quality.required_quality_flags,
        forbidden_flags: quality.forbidden_quality_flags
      },
      data_governance: {
        status: "resolved",
        retention_policy_ref: "provenance-bound-retention",
        licensing_policy_ref: "provenance-bound-licensing",
        required_usage_purposes: [...SIGNAL_BRAND_POLICY_REQUIRED_USAGES]
      }
    }
  });
  const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
  const updated = await queryable.query<{ id: string }>(`
    UPDATE signal_population_policy_bundles SET
      quality_contract_status = $4,
      quality_policy_key = $5,
      quality_policy_version = $6,
      min_quality_score = $7,
      required_quality_flags = $8::text[],
      forbidden_quality_flags = $9::text[],
      retention_policy_ref = $10,
      licensing_policy_ref = $11,
      data_governance_contract_status = $12,
      quality_policy_id = $13::uuid,
      required_usage_purposes = $14::text[],
      definition_hash = $15,
      updated_at = now()
    WHERE id = $2::uuid AND workspace_id = $1::uuid
      AND policy_key = $3 AND policy_version = $16
      AND status = 'draft'
    RETURNING id::text
  `, [
    args.workspace.id,
    args.policyBundleId,
    SIGNAL_BRAND_POLICY_KEY,
    definition.quality_contract_status,
    definition.quality_policy_key,
    definition.quality_policy_version,
    definition.min_quality_score,
    definition.required_quality_flags,
    definition.forbidden_quality_flags,
    definition.retention_policy_ref,
    definition.licensing_policy_ref,
    definition.data_governance_contract_status,
    definition.quality_policy_id,
    definition.required_usage_purposes,
    definitionHash,
    definition.policy_version
  ]);
  if (updated.rowCount !== 1) throw new Error("Brand policy draft is unavailable or cross-workspace.");
  await queryable.query("SELECT assert_signal_population_policy_bundle_contract($1::uuid)", [args.policyBundleId]);
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: args.policyBundleId,
    definition_hash: definitionHash,
    definition
  });
  return {
    policy_bundle_id: args.policyBundleId,
    workspace_id: args.workspace.id,
    policy_key: SIGNAL_BRAND_POLICY_KEY,
    policy_version: definition.policy_version,
    definition_hash: definitionHash,
    status: "draft",
    created: false,
    readiness: compiled.readiness
  };
}

async function reconcileSignalBrandPolicyCandidateWithClient(
  args: {
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    policyBundleId: string;
    moduleKey?: SignalGovernedViewModuleKeyV1;
    reconcileMemberships?: boolean;
  },
  queryable: SignalBrandPolicyQueryable
): Promise<SignalBrandPolicyCandidateReconciliationV1> {
  await queryable.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${args.workspace.id}:brand-policy-candidate:${args.policyBundleId}`]
  );
  const artifacts = await loadBrandPolicyArtifacts(
    queryable,
    args.workspace.id,
    args.policyBundleId,
    args.actor.id
  );
  if (artifacts.actor_guard !== args.actor.id || artifacts.actor_user_type !== "noisia_internal") {
    throw new Error("Brand policy compilation actor is invalid for this workspace.");
  }
  const definition = validateSignalPopulationPolicyBundleDefinitionV1(artifacts.definition);
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: artifacts.policy_bundle_id,
    definition_hash: artifacts.policy_definition_hash,
    definition
  });
  const moduleKey = args.moduleKey ?? "brand-monitoring";
  const moduleCompiledPlanHash = signalGovernedViewCompilationPlanHashV1({
    base_plan_hash: compiled.plan_hash,
    module_key: moduleKey,
    view_key: "brand",
    authorized_modules: definition.authorized_modules,
    capability_usage_purposes: definition.required_usage_purposes
  });
  const derivation = await ensureBrandModulePopulationV1(queryable, {
    workspaceId: args.workspace.id,
    policyBundleId: artifacts.policy_bundle_id,
    basePopulationId: artifacts.population_id,
    moduleKey,
    policyDefinitionHash: artifacts.policy_definition_hash,
    compiledPlanHash: moduleCompiledPlanHash,
    actorUserId: args.actor.id
  });
  const governanceEvaluation = definition.data_governance_contract_status === "resolved"
    ? await evaluateSignalBrandDataGovernanceV1({
      queryable,
      workspaceId: args.workspace.id,
      brandId: args.workspace.subject.id,
      policyBundleId: artifacts.policy_bundle_id,
      populationId: derivation.population_id,
      actor: args.actor,
      moduleKey,
      reconcileMemberships: args.reconcileMemberships === true
    })
    : null;
  const state = await loadBrandCandidateState(queryable, {
    workspaceId: args.workspace.id,
    populationId: derivation.population_id,
    definition,
    populationDefinitionHash: derivation.population_definition_hash,
    moduleKey,
    policyBundleId: artifacts.policy_bundle_id,
    basePopulationId: artifacts.population_id,
    compiledPlanHash: moduleCompiledPlanHash,
    governanceEvaluationId: governanceEvaluation?.evaluation_id ?? null
  });
  const mismatchReasons: string[] = [];
  if (!state.population_contract_matches) mismatchReasons.push("population_contract_mismatch");
  if (state.alias_membership_count > 0) mismatchReasons.push("alias_membership_detected");
  if (state.expected_membership_digest !== state.actual_membership_digest
    || state.expected_membership_count !== state.actual_membership_count) {
    mismatchReasons.push("membership_set_mismatch");
  }
  if (state.population_membership_digest !== state.actual_membership_digest) {
    mismatchReasons.push("population_digest_stale");
  }
  const policyBlockers: string[] = [...compiled.readiness.blocking_reasons];
  if (governanceEvaluation && !governanceEvaluation.governance_data_watermark_id) {
    policyBlockers.push("data-watermark-not-available");
  }
  if (governanceEvaluation && governanceEvaluation.governance_unknown_count > 0) {
    policyBlockers.push("data-governance-not-available");
  }
  const blockingReasons = [...new Set([...mismatchReasons, ...policyBlockers])].sort();
  const compilationStatus = mismatchReasons.length > 0
    ? "stale" as const
    : policyBlockers.length > 0
      ? "blocked" as const
      : "ready" as const;
  const currentCompilation = await queryable.query<{
    id: string;
    compilation_version: number;
    compiled_plan_hash: string;
    policy_definition_hash: string;
    population_definition_hash: string;
    membership_digest: string;
    source_watermark_hash: string;
    governance_evaluation_id: string | null;
    governance_digest: string | null;
    invalidated: boolean;
    compilation_status: string;
    blocking_reasons: string[];
    next_policy_transition_at: string | null;
    governance_data_watermark_id: string | null;
  }>(`
    SELECT id::text, compilation_version, compiled_plan_hash,
      policy_definition_hash, population_definition_hash, membership_digest,
      source_watermark_hash, governance_evaluation_id::text,
      governance_digest, compilation_status, blocking_reasons,
      next_policy_transition_at::text,governance_data_watermark_id::text,
      EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id = signal_population_policy_compilations.id) AS invalidated
    FROM signal_population_policy_compilations
    WHERE workspace_id = $1::uuid AND policy_bundle_id = $2::uuid
      AND population_id = $3::uuid AND module_key=$4 AND view_key='brand' AND is_current
    FOR UPDATE
  `, [
    args.workspace.id, artifacts.policy_bundle_id, derivation.population_id,
    moduleKey
  ]);
  const prior = currentCompilation.rows[0];
  const identical = Boolean(prior
    && prior.invalidated === false
    && prior.compiled_plan_hash === moduleCompiledPlanHash
    && prior.policy_definition_hash === artifacts.policy_definition_hash
    && prior.population_definition_hash === derivation.population_definition_hash
    && prior.membership_digest === state.actual_membership_digest
    && prior.source_watermark_hash === state.source_watermark_hash
    && prior.governance_evaluation_id === (governanceEvaluation?.evaluation_id ?? null)
    && prior.governance_digest === (governanceEvaluation?.governance_digest ?? null)
    && prior.next_policy_transition_at === (governanceEvaluation?.next_policy_transition_at ?? null)
    && prior.governance_data_watermark_id === (governanceEvaluation?.governance_data_watermark_id ?? null)
    && prior.compilation_status === compilationStatus
    && JSON.stringify(prior.blocking_reasons) === JSON.stringify(blockingReasons));
  let policyCompilationId: string;
  let compilationVersion: number;
  if (identical && prior) {
    policyCompilationId = prior.id;
    compilationVersion = prior.compilation_version;
  } else {
    if (prior) {
      await queryable.query(`
        UPDATE signal_population_policy_compilations
        SET is_current = false, retired_at = now()
        WHERE id = $1::uuid
      `, [prior.id]);
    }
    const inserted = await queryable.query<{ id: string; compilation_version: number }>(`
      INSERT INTO signal_population_policy_compilations (
        workspace_id, policy_bundle_id, population_id, compilation_version,
        compiled_plan_hash, policy_definition_hash, population_version,
        population_definition_hash, membership_digest,
        source_watermark_hash, source_watermark_at,
        compilation_status, blocking_reasons, compiled_by_user_id,
        governance_evaluation_id, quality_policy_id, quality_policy_version,
        quality_policy_hash, retention_policy_digest, licensing_policy_digest,
        usage_purposes, authorized_root_count, quality_blocked_count,
        retention_blocked_count, licensing_blocked_count,
        governance_unknown_count, policy_evaluation_watermark, governance_digest,
        module_key,view_key,next_policy_transition_at,governance_data_watermark_id
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid,
        COALESCE((SELECT max(compilation_version) + 1
          FROM signal_population_policy_compilations
          WHERE policy_bundle_id = $2::uuid AND population_id = $3::uuid
            AND module_key = $28 AND view_key = 'brand'), 1),
        $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12::text[], $13::uuid,
        $14::uuid, $15::uuid, $16::int, $17, $18, $19, $20::text[],
        $21::int, $22::int, $23::int, $24::int, $25::int,
        $26::timestamptz, $27,$28,'brand',$29::timestamptz,$30::uuid
      ) RETURNING id::text, compilation_version
    `, [
      args.workspace.id,
      artifacts.policy_bundle_id,
      derivation.population_id,
      moduleCompiledPlanHash,
      artifacts.policy_definition_hash,
      derivation.population_version,
      derivation.population_definition_hash,
      state.actual_membership_digest,
      state.source_watermark_hash,
      state.source_watermark_at,
      compilationStatus,
      blockingReasons,
      args.actor.id,
      governanceEvaluation?.evaluation_id ?? null,
      governanceEvaluation?.quality_policy_id ?? null,
      governanceEvaluation?.quality_policy_version ?? null,
      governanceEvaluation?.quality_policy_hash ?? null,
      governanceEvaluation?.retention_policy_digest ?? null,
      governanceEvaluation?.licensing_policy_digest ?? null,
      governanceEvaluation?.usage_purposes ?? [],
      governanceEvaluation?.authorized_root_count ?? 0,
      governanceEvaluation?.quality_blocked_count ?? 0,
      governanceEvaluation?.retention_blocked_count ?? 0,
      governanceEvaluation?.licensing_blocked_count ?? 0,
      governanceEvaluation?.governance_unknown_count ?? null,
      governanceEvaluation?.policy_evaluation_watermark ?? null,
      governanceEvaluation?.governance_digest ?? null,
      moduleKey,
      governanceEvaluation?.next_policy_transition_at ?? null,
      governanceEvaluation?.governance_data_watermark_id ?? null
    ]);
    policyCompilationId = inserted.rows[0]!.id;
    compilationVersion = inserted.rows[0]!.compilation_version;
  }
  return {
    workspace_id: args.workspace.id,
    policy_bundle_id: artifacts.policy_bundle_id,
    policy_definition_hash: artifacts.policy_definition_hash,
    compiled_plan_hash: moduleCompiledPlanHash,
    base_population_id: artifacts.population_id,
    population_id: derivation.population_id,
    population_version: derivation.population_version,
    population_definition_hash: derivation.population_definition_hash,
    expected_membership_count: state.expected_membership_count,
    actual_membership_count: state.actual_membership_count,
    expected_membership_digest: state.expected_membership_digest,
    actual_membership_digest: state.actual_membership_digest,
    alias_membership_count: state.alias_membership_count,
    source_watermark_hash: state.source_watermark_hash,
    source_watermark_at: state.source_watermark_at,
    compilation_status: compilationStatus,
    blocking_reasons: blockingReasons,
    policy_matches_memberships: mismatchReasons.length === 0,
    policy_compilation_id: policyCompilationId,
    compilation_version: compilationVersion,
    governance_evaluation_id: governanceEvaluation?.evaluation_id ?? null,
    governance_digest: governanceEvaluation?.governance_digest ?? null,
    authorized_root_count: governanceEvaluation?.authorized_root_count ?? 0,
    quality_blocked_count: governanceEvaluation?.quality_blocked_count ?? 0,
    retention_blocked_count: governanceEvaluation?.retention_blocked_count ?? 0,
    licensing_blocked_count: governanceEvaluation?.licensing_blocked_count ?? 0,
    governance_unknown_count: governanceEvaluation?.governance_unknown_count ?? null,
    governance_unknown_availability: governanceEvaluation
      ? "measured" : "not_available",
    current_pointer_unchanged: true,
    module_key: moduleKey,
    view_key: "brand",
    usage_purposes: governanceEvaluation?.usage_purposes ?? []
  };
}

async function ensureBrandModulePopulationV1(
  queryable: SignalBrandPolicyQueryable,
  args: {
    workspaceId: string;
    policyBundleId: string;
    basePopulationId: string;
    moduleKey: SignalGovernedViewModuleKeyV1;
    policyDefinitionHash: string;
    compiledPlanHash: string;
    actorUserId: string;
  }
) {
  const result = await queryable.query<{
    population_id: string;
    population_key: string;
    population_version: number;
    population_definition_hash: string;
    created: boolean;
  }>(`
    SELECT resolved_population_id::text AS population_id,
      population_key, population_version, population_definition_hash, created
    FROM ensure_signal_governed_view_population_derivation(
      $1::uuid,$2::uuid,$3::uuid,$4,'brand',$5,$6,$7::uuid
    )
  `, [
    args.workspaceId,
    args.policyBundleId,
    args.basePopulationId,
    args.moduleKey,
    args.policyDefinitionHash,
    args.compiledPlanHash,
    args.actorUserId
  ]);
  const population = result.rows[0];
  if (!population) throw new Error("Governed module population could not be resolved.");
  return population;
}

async function loadBrandPolicyArtifacts(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  policyBundleId: string,
  actorUserId: string
) {
  const result = await queryable.query<{
    policy_bundle_id: string;
    policy_definition_hash: string;
    population_id: string;
    population_key: string;
    population_version: number;
    population_definition_hash: string;
    actor_guard: string | null;
    actor_user_type: string | null;
    definition: SignalPopulationPolicyBundleDefinitionV1;
  }>(`
    SELECT
      bundle.id::text AS policy_bundle_id,
      bundle.definition_hash AS policy_definition_hash,
      population.id::text AS population_id,
      population.population_key,
      population.version AS population_version,
      population.definition_hash AS population_definition_hash,
      actor.id::text AS actor_guard,
      actor.user_type AS actor_user_type,
      jsonb_build_object(
        'contract_version', 'signal-governed-views-v1',
        'workspace_id', bundle.workspace_id::text,
        'policy_key', bundle.policy_key,
        'policy_version', bundle.policy_version,
        'authorized_modules', bundle.authorized_modules,
        'allowed_scopes', bundle.allowed_scopes,
        'allowed_entities', COALESCE(entity.items, '[]'::jsonb),
        'acceptance_status', bundle.acceptance_status,
        'quality_contract_status', bundle.quality_contract_status,
        'quality_policy_key', bundle.quality_policy_key,
        'quality_policy_version', bundle.quality_policy_version,
        'min_quality_score', bundle.min_quality_score,
        'required_quality_flags', bundle.required_quality_flags,
        'forbidden_quality_flags', bundle.forbidden_quality_flags,
        'eligibility_policy', bundle.eligibility_policy,
        'deduplication_policy', bundle.deduplication_policy,
        'visibility_class', bundle.visibility_class,
        'denominator_key', bundle.denominator_key,
        'period_start', bundle.period_start::text,
        'period_end', bundle.period_end::text,
        'timezone', bundle.timezone,
        'retention_policy_ref', bundle.retention_policy_ref,
        'licensing_policy_ref', bundle.licensing_policy_ref,
        'data_governance_contract_status', bundle.data_governance_contract_status,
        'quality_policy_id', bundle.quality_policy_id::text,
        'required_usage_purposes', bundle.required_usage_purposes
      ) AS definition
    FROM signal_population_policy_bundles bundle
    JOIN signal_workspaces workspace
      ON workspace.id = bundle.workspace_id AND workspace.status = 'active'
    JOIN users actor ON actor.id = $3::uuid
    JOIN signal_population_definitions population
      ON population.workspace_id = bundle.workspace_id
     AND population.population_key = 'primary-brand-operational'
     AND population.purpose = 'operational'
     AND population.status = 'draft'
     AND population.definition->>'contract_version'
       = 'signal-operational-primary-brand-semantic-v2'
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'scope', allowed.scope,
        'entity_type', allowed.entity_type,
        'entity_id', allowed.entity_id::text
      ) ORDER BY allowed.scope, allowed.entity_type, allowed.entity_id) AS items
      FROM signal_population_policy_entities allowed
      WHERE allowed.policy_bundle_id = bundle.id
        AND allowed.workspace_id = bundle.workspace_id
    ) entity ON true
    WHERE bundle.id = $2::uuid
      AND bundle.workspace_id = $1::uuid
      AND bundle.policy_key = '${SIGNAL_BRAND_POLICY_KEY}'
      AND bundle.status IN ('draft','active')
    LIMIT 1
  `, [workspaceId, policyBundleId, actorUserId]);
  const row = result.rows[0];
  if (!row) throw new Error("Brand policy draft or semantic candidate is unavailable.");
  return row;
}

async function loadBrandCandidateState(
  queryable: SignalBrandPolicyQueryable,
  args: {
    workspaceId: string;
    populationId: string;
    definition: SignalPopulationPolicyBundleDefinitionV1;
    populationDefinitionHash: string;
    moduleKey: SignalGovernedViewModuleKeyV1;
    policyBundleId: string;
    basePopulationId: string;
    compiledPlanHash: string;
    governanceEvaluationId: string | null;
  }
) {
  const params: unknown[] = [
    args.workspaceId,
    null,
    args.populationId,
    args.definition.min_quality_score,
    args.definition.period_start,
    args.definition.period_end,
    args.definition.timezone ?? "UTC",
    args.definition.required_quality_flags,
    args.definition.forbidden_quality_flags,
    args.populationDefinitionHash,
    args.definition.policy_key,
    String(args.definition.policy_version),
    args.governanceEvaluationId,
    args.moduleKey,
    args.policyBundleId,
    args.basePopulationId,
    args.compiledPlanHash
  ];
  const result = await queryable.query<{
    population_contract_matches: boolean;
    population_membership_digest: string;
    expected_membership_count: number;
    actual_membership_count: number;
    expected_membership_digest: string;
    actual_membership_digest: string;
    alias_membership_count: number;
    source_watermark_hash: string;
    source_watermark_at: string | null;
  }>(`
    WITH population AS (
      SELECT * FROM signal_population_definitions
      WHERE id = $3::uuid AND workspace_id = $1::uuid
        AND $2::uuid IS NULL
        AND $7::text IS NOT NULL
        AND cardinality($8::text[]) >= 0
        AND cardinality($9::text[]) >= 0
    ), expected AS (
      SELECT item.mention_id AS id
      FROM signal_data_governance_evaluation_items item
      WHERE item.evaluation_id = $13::uuid
        AND item.workspace_id = $1::uuid
        AND item.decision = 'included'
        AND item.reason_code = 'policy_eligible'
    ), actual AS (
      SELECT membership.mention_id AS id
      FROM signal_population_memberships membership
      WHERE membership.population_id = $3::uuid
        AND membership.workspace_id = $1::uuid
        AND membership.membership_status = 'included'
        AND membership.removed_at IS NULL
    ), watermarks AS (
      SELECT COALESCE(string_agg(concat_ws(':',
        watermark.id::text,
        watermark.source_key,
        watermark.corpus_revision::text,
        COALESCE(watermark.max_observed_at::text, '∅'),
        watermark.accepted_at::text,
        watermark.data_freshness_state
      ), ',' ORDER BY watermark.id), '') AS content,
      max(COALESCE(watermark.max_observed_at, watermark.accepted_at)) AS observed_at
      FROM signal_data_watermarks watermark
      WHERE watermark.workspace_id = $1::uuid
        AND watermark.population_id = $3::uuid
    )
    SELECT
      COALESCE((SELECT
        purpose = 'operational'
        AND status = 'draft'
        AND population_key = $14::text || '-brand-governed'
        AND acceptance_status = 'included'
        AND allowed_scopes = ARRAY['primary_brand']::text[]
        AND min_quality_score IS NOT DISTINCT FROM $4::int
        AND period_start IS NOT DISTINCT FROM $5::date
        AND period_end IS NOT DISTINCT FROM $6::date
        AND definition_hash = $10
        AND policy_key = $11
        AND policy_version = $12
        AND definition->>'contract_version'
          = 'signal-governed-view-resolved-population-v1'
        AND definition->>'module_key' = $14::text
        AND definition->>'view_key' = 'brand'
        AND definition->>'policy_bundle_id' = $15::text
        AND definition->>'base_population_id' = $16::text
        AND definition->>'compiled_plan_hash' = $17::text
        AND EXISTS (
          SELECT 1 FROM signal_governed_view_population_derivations derivation
          WHERE derivation.resolved_population_id = population.id
            AND derivation.workspace_id = $1::uuid
            AND derivation.module_key = $14::text
            AND derivation.view_key = 'brand'
            AND derivation.policy_bundle_id = $15::uuid
            AND derivation.base_population_id = $16::uuid
            AND derivation.compiled_plan_hash = $17::text
        )
        FROM population), false) AS population_contract_matches,
      COALESCE((SELECT membership_digest FROM population),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        AS population_membership_digest,
      (SELECT count(*)::int FROM expected) AS expected_membership_count,
      (SELECT count(*)::int FROM actual) AS actual_membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(id::text, ',' ORDER BY id) FROM expected
      ), ''), 'UTF8')), 'hex') AS expected_membership_digest,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(id::text, ',' ORDER BY id) FROM actual
      ), ''), 'UTF8')), 'hex') AS actual_membership_digest,
      (SELECT count(*)::int
       FROM actual JOIN mentions mention ON mention.id = actual.id
       WHERE mention.canonical_mention_id <> mention.id) AS alias_membership_count,
      'sha256:' || encode(sha256(convert_to(
        COALESCE((SELECT content FROM watermarks), ''), 'UTF8')), 'hex') AS source_watermark_hash,
      (SELECT observed_at::text FROM watermarks) AS source_watermark_at
  `, params);
  return result.rows[0]!;
}
