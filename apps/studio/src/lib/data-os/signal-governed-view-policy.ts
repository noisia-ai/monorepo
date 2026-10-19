import {
  SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS,
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  assertSignalGovernedPolicyViewContractV1,
  compileSignalPopulationPolicyBundleV1,
  signalDataUsagePurposesForModuleViewV1,
  signalGovernedViewCompilationPlanHashV1,
  signalPopulationPolicyDefinitionHashV1,
  validateSignalPopulationPolicyBundleDefinitionV1,
  type SignalClientGovernedViewKeyV1,
  type SignalClientGovernedViewModuleKeyV1,
  type SignalCompiledPopulationPolicyV1,
  type SignalDataUsagePurposeV1,
  type SignalPolicyEntityReferenceV1,
  type SignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";

import {
  evaluateSignalViewDataGovernanceV1
} from "@/lib/data-os/signal-data-governance";
import {
  ensureSignalBrandPolicyDraftV1,
  reconcileSignalBrandPolicyCandidateV1,
  resolveSignalBrandPolicyDraftGovernanceV1,
  type SignalBrandPolicyGovernanceV1,
  type SignalBrandPolicyQueryable
} from "@/lib/data-os/signal-governed-brand-policy";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

const EMPTY_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const SIGNAL_GOVERNED_VIEW_POLICY_MODULES =
  [...SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS] as const;

const VIEW_POLICY_IDENTITY = {
  brand: { policy_key: "operational-brand-governed", policy_version: 1 },
  competition: { policy_key: "operational-competition-governed", policy_version: 1 },
  category: { policy_key: "operational-category-governed", policy_version: 1 },
  "all-governed": { policy_key: "operational-all-governed", policy_version: 1 }
} as const satisfies Record<SignalClientGovernedViewKeyV1, {
  policy_key: string;
  policy_version: number;
}>;

export function signalGovernedViewPolicyIdentityV1(viewKey: SignalClientGovernedViewKeyV1) {
  return VIEW_POLICY_IDENTITY[viewKey];
}

export type SignalGovernedViewPolicyDraftV1 = {
  policy_bundle_id: string;
  workspace_id: string;
  view_key: SignalClientGovernedViewKeyV1;
  policy_key: string;
  policy_version: number;
  definition_hash: string;
  status: "draft";
  created: boolean;
  readiness: SignalCompiledPopulationPolicyV1["readiness"];
};

export type SignalGovernedViewPolicyCandidateReconciliationV1 = {
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
  module_key: SignalClientGovernedViewModuleKeyV1;
  view_key: SignalClientGovernedViewKeyV1;
  usage_purposes: SignalDataUsagePurposeV1[];
};

type NonBrandViewKey = Exclude<SignalClientGovernedViewKeyV1, "brand">;

function requiredUsageEnvelope(viewKey: SignalClientGovernedViewKeyV1) {
  return [...new Set(SIGNAL_GOVERNED_VIEW_POLICY_MODULES.flatMap((moduleKey) =>
    signalDataUsagePurposesForModuleViewV1(moduleKey, viewKey)))].sort() as SignalDataUsagePurposeV1[];
}

function assertWorkspaceActor(
  workspace: ResolvedSignalWorkspace,
  actor: SignalWorkspaceUser
) {
  if (workspace.status !== "active" || workspace.subject.type !== "brand") {
    throw new Error("Governed client views require an active brand workspace.");
  }
  if (actor.userType !== "noisia_internal") {
    throw new Error("Governed view policy writers require an internal server-resolved actor.");
  }
}

async function withTransaction<T>(
  queryable: SignalBrandPolicyQueryable | undefined,
  run: (client: SignalBrandPolicyQueryable) => Promise<T>
): Promise<T> {
  if (queryable) return run(queryable);
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertPersistedWorkspaceActor(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const result = await args.queryable.query<{ allowed: boolean }>(`
    SELECT workspace.id = $1::uuid
      AND workspace.organization_id = $2::uuid
      AND workspace.brand_id = $3::uuid
      AND workspace.status = 'active'
      AND signal_data_governance_actor_is_valid(workspace.id, $4::uuid) AS allowed
    FROM signal_workspaces workspace
    WHERE workspace.id = $1::uuid
  `, [
    args.workspace.id,
    args.workspace.organizationId,
    args.workspace.subject.id,
    args.actor.id
  ]);
  if (result.rows[0]?.allowed !== true) {
    throw new Error("Governed view policy actor or workspace ownership is invalid.");
  }
}

async function loadGovernedEntities(
  queryable: SignalBrandPolicyQueryable,
  workspace: ResolvedSignalWorkspace,
  viewKey: NonBrandViewKey
): Promise<SignalPolicyEntityReferenceV1[]> {
  const result = await queryable.query<SignalPolicyEntityReferenceV1>(`
    SELECT governed.scope, governed.entity_type, governed.entity_id::text
    FROM (
      SELECT 'primary_brand'::text AS scope, 'brand'::text AS entity_type,
        workspace.brand_id AS entity_id
      FROM signal_workspaces workspace
      WHERE workspace.id = $1::uuid AND workspace.brand_id = $2::uuid
      UNION ALL
      SELECT 'competitor', 'competitor', competitor.id
      FROM competitors competitor
      JOIN brand_seeds seed ON seed.id = competitor.competitor_brand_seed_id
        AND seed.active = true
      WHERE competitor.brand_id = $2::uuid
        AND competitor.status = 'current'
      UNION ALL
      SELECT entity.entity_type, entity.entity_type, entity.id
      FROM intelligence_entities entity
      WHERE entity.organization_id = $3::uuid
        AND entity.brand_id = $2::uuid
        AND entity.entity_type IN ('category', 'reference')
        AND entity.status = 'active'
    ) governed
    WHERE CASE $4::text
      WHEN 'competition' THEN governed.scope = 'competitor'
      WHEN 'category' THEN governed.scope = 'category'
      WHEN 'all-governed' THEN governed.scope IN (
        'primary_brand', 'competitor', 'category', 'reference'
      )
      ELSE false
    END
    ORDER BY governed.scope, governed.entity_type, governed.entity_id
  `, [workspace.id, workspace.subject.id, workspace.organizationId, viewKey]);
  if (result.rows.length === 0) {
    throw new Error(`${viewKey} has no active server-governed entities.`);
  }
  return result.rows;
}

function buildDefinition(args: {
  workspace: ResolvedSignalWorkspace;
  viewKey: NonBrandViewKey;
  entities: SignalPolicyEntityReferenceV1[];
  governance: SignalBrandPolicyGovernanceV1;
  policyVersion?: number;
}): SignalPopulationPolicyBundleDefinitionV1 {
  const identity = VIEW_POLICY_IDENTITY[args.viewKey];
  const quality = args.governance.quality;
  const dataGovernance = args.governance.data_governance;
  const allowedScopes = [...new Set(args.entities.map((entity) => entity.scope))].sort();
  const definition = validateSignalPopulationPolicyBundleDefinitionV1({
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    policy_key: identity.policy_key,
    policy_version: args.policyVersion ?? identity.policy_version,
    authorized_modules: [...SIGNAL_GOVERNED_VIEW_POLICY_MODULES],
    allowed_scopes: allowedScopes,
    allowed_entities: args.entities,
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
  if (dataGovernance.status === "resolved") {
    for (const moduleKey of SIGNAL_GOVERNED_VIEW_POLICY_MODULES) {
      assertSignalGovernedPolicyViewContractV1(moduleKey, args.viewKey, definition);
    }
  }
  return definition;
}

export async function ensureSignalGovernedViewPolicyDraftV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  policyVersion?: number;
  queryable?: SignalBrandPolicyQueryable;
}): Promise<SignalGovernedViewPolicyDraftV1> {
  assertWorkspaceActor(args.workspace, args.actor);
  if (args.viewKey === "brand") {
    const draft = await ensureSignalBrandPolicyDraftV1(args);
    return { ...draft, view_key: "brand" };
  }
  const viewKey = args.viewKey as NonBrandViewKey;
  return withTransaction(args.queryable, async (queryable) => {
    await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${args.workspace.id}:${VIEW_POLICY_IDENTITY[viewKey].policy_key}:${args.policyVersion ?? 1}`
    ]);
    await assertPersistedWorkspaceActor({ ...args, queryable });
    const entities = await loadGovernedEntities(queryable, args.workspace, viewKey);
    const definition = buildDefinition({
      workspace: args.workspace,
      viewKey,
      entities,
      policyVersion: args.policyVersion,
      governance: {
        quality: { status: "not_available" },
        data_governance: { status: "not_available" }
      }
    });
    return persistDraft(queryable, args.workspace, args.actor, viewKey, definition);
  });
}

async function persistDraft(
  queryable: SignalBrandPolicyQueryable,
  workspace: ResolvedSignalWorkspace,
  actor: SignalWorkspaceUser,
  viewKey: NonBrandViewKey,
  definition: SignalPopulationPolicyBundleDefinitionV1
): Promise<SignalGovernedViewPolicyDraftV1> {
  const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
  const existing = await queryable.query<{
    id: string;
    definition_hash: string;
    status: string;
    entities: SignalPolicyEntityReferenceV1[];
  }>(`
    SELECT bundle.id::text, bundle.definition_hash, bundle.status,
      COALESCE(entity.items, '[]'::jsonb) AS entities
    FROM signal_population_policy_bundles bundle
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'scope', allowed.scope, 'entity_type', allowed.entity_type,
        'entity_id', allowed.entity_id::text
      ) ORDER BY allowed.scope, allowed.entity_type, allowed.entity_id) AS items
      FROM signal_population_policy_entities allowed
      WHERE allowed.policy_bundle_id=bundle.id
        AND allowed.workspace_id=bundle.workspace_id
    ) entity ON true
    WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key=$2
      AND bundle.policy_version=$3
    FOR UPDATE OF bundle
  `, [workspace.id, definition.policy_key, definition.policy_version]);
  const persisted = existing.rows[0];
  if (persisted) {
    if (persisted.status !== "draft"
      || JSON.stringify(persisted.entities) !== JSON.stringify(definition.allowed_entities)) {
      throw new Error(`Existing ${viewKey} policy version has incompatible governed content.`);
    }
    const compiled = compileSignalPopulationPolicyBundleV1({
      policy_bundle_id: persisted.id,
      definition_hash: definitionHash,
      definition
    });
    return {
      policy_bundle_id: persisted.id,
      workspace_id: workspace.id,
      view_key: viewKey,
      policy_key: definition.policy_key,
      policy_version: definition.policy_version,
      definition_hash: persisted.definition_hash,
      status: "draft",
      created: false,
      readiness: compiled.readiness
    };
  }
  const inserted = await queryable.query<{ id: string }>(`
    INSERT INTO signal_population_policy_bundles (
      workspace_id,policy_key,policy_version,status,authorized_modules,allowed_scopes,
      acceptance_status,quality_contract_status,quality_policy_key,quality_policy_version,
      min_quality_score,required_quality_flags,forbidden_quality_flags,eligibility_policy,
      deduplication_policy,visibility_class,denominator_key,period_start,period_end,timezone,
      retention_policy_ref,licensing_policy_ref,data_governance_contract_status,
      quality_policy_id,required_usage_purposes,definition_hash,created_by_user_id
    ) VALUES (
      $1::uuid,$2,$3,'draft',$4::text[],$5::text[],$6,$7,$8,$9,$10,$11::text[],$12::text[],
      $13,$14,$15,$16,$17::date,$18::date,$19,$20,$21,$22,$23::uuid,$24::text[],$25,$26::uuid
    ) RETURNING id::text
  `, [
    workspace.id, definition.policy_key, definition.policy_version,
    definition.authorized_modules, definition.allowed_scopes, definition.acceptance_status,
    definition.quality_contract_status, definition.quality_policy_key,
    definition.quality_policy_version, definition.min_quality_score,
    definition.required_quality_flags, definition.forbidden_quality_flags,
    definition.eligibility_policy, definition.deduplication_policy,
    definition.visibility_class, definition.denominator_key, definition.period_start,
    definition.period_end, definition.timezone, definition.retention_policy_ref,
    definition.licensing_policy_ref, definition.data_governance_contract_status,
    definition.quality_policy_id, definition.required_usage_purposes,
    definitionHash, actor.id
  ]);
  const policyBundleId = inserted.rows[0]!.id;
  for (const entity of definition.allowed_entities) {
    await queryable.query(`
      INSERT INTO signal_population_policy_entities (
        workspace_id,policy_bundle_id,scope,entity_type,entity_id
      ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid)
    `, [workspace.id, policyBundleId, entity.scope, entity.entity_type, entity.entity_id]);
  }
  await queryable.query("SELECT assert_signal_population_policy_bundle_contract($1::uuid)", [policyBundleId]);
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: policyBundleId,
    definition_hash: definitionHash,
    definition
  });
  return {
    policy_bundle_id: policyBundleId,
    workspace_id: workspace.id,
    view_key: viewKey,
    policy_key: definition.policy_key,
    policy_version: definition.policy_version,
    definition_hash: definitionHash,
    status: "draft",
    created: true,
    readiness: compiled.readiness
  };
}

export async function resolveSignalGovernedViewPolicyDraftGovernanceV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  policyBundleId: string;
  qualityPolicyId: string;
  queryable?: SignalBrandPolicyQueryable;
}): Promise<SignalGovernedViewPolicyDraftV1> {
  assertWorkspaceActor(args.workspace, args.actor);
  if (args.viewKey === "brand") {
    const draft = await resolveSignalBrandPolicyDraftGovernanceV1(args);
    return { ...draft, view_key: "brand" };
  }
  const viewKey = args.viewKey as NonBrandViewKey;
  return withTransaction(args.queryable, async (queryable) => {
    await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${args.workspace.id}:${viewKey}:policy-governance:${args.policyBundleId}`
    ]);
    await assertPersistedWorkspaceActor({ ...args, queryable });
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
        quality.policy_key,quality.policy_version,quality.min_quality_score,
        quality.required_quality_flags,quality.forbidden_quality_flags,
        quality.canonical_root_disposition
      FROM signal_quality_policies quality
      JOIN signal_population_policy_bundles bundle
        ON bundle.id=$3::uuid AND bundle.workspace_id=quality.workspace_id
       AND bundle.status='draft' AND bundle.policy_key=$4
      WHERE quality.id=$2::uuid AND quality.workspace_id=$1::uuid
        AND quality.status='active'
        AND quality.effective_from<=clock_timestamp()
        AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
    `, [
      args.workspace.id, args.qualityPolicyId, args.policyBundleId,
      VIEW_POLICY_IDENTITY[viewKey].policy_key
    ]);
    const quality = authority.rows[0];
    if (!quality || quality.canonical_root_disposition !== "evaluate") {
      throw new Error(`${viewKey} requires an active evaluable quality authority.`);
    }
    const entities = await loadGovernedEntities(queryable, args.workspace, viewKey);
    const definition = buildDefinition({
      workspace: args.workspace,
      viewKey,
      entities,
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
          required_usage_purposes: requiredUsageEnvelope(viewKey)
        }
      }
    });
    const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
    const updated = await queryable.query<{ id: string }>(`
      UPDATE signal_population_policy_bundles SET
        quality_contract_status=$4,quality_policy_key=$5,quality_policy_version=$6,
        min_quality_score=$7,required_quality_flags=$8::text[],forbidden_quality_flags=$9::text[],
        retention_policy_ref=$10,licensing_policy_ref=$11,data_governance_contract_status=$12,
        quality_policy_id=$13::uuid,required_usage_purposes=$14::text[],definition_hash=$15,
        updated_at=now()
      WHERE id=$2::uuid AND workspace_id=$1::uuid AND policy_key=$3
        AND policy_version=$16 AND status='draft'
      RETURNING id::text
    `, [
      args.workspace.id,args.policyBundleId,definition.policy_key,
      definition.quality_contract_status,definition.quality_policy_key,
      definition.quality_policy_version,definition.min_quality_score,
      definition.required_quality_flags,definition.forbidden_quality_flags,
      definition.retention_policy_ref,definition.licensing_policy_ref,
      definition.data_governance_contract_status,definition.quality_policy_id,
      definition.required_usage_purposes,definitionHash,definition.policy_version
    ]);
    if (updated.rows.length !== 1) {
      const observed = await queryable.query<{ policy_version: number; status: string }>(`
        SELECT policy_version,status FROM signal_population_policy_bundles
        WHERE id=$1::uuid AND workspace_id=$2::uuid AND policy_key=$3
      `,[args.policyBundleId,args.workspace.id,definition.policy_key]);
      throw new Error(`${viewKey} policy draft is unavailable at version ${definition.policy_version}; observed ${observed.rows[0]?.status ?? "missing"}/${observed.rows[0]?.policy_version ?? "unknown"}.`);
    }
    await queryable.query("SELECT assert_signal_population_policy_bundle_contract($1::uuid)", [args.policyBundleId]);
    const compiled = compileSignalPopulationPolicyBundleV1({
      policy_bundle_id: args.policyBundleId,
      definition_hash: definitionHash,
      definition
    });
    return {
      policy_bundle_id: args.policyBundleId,
      workspace_id: args.workspace.id,
      view_key: viewKey,
      policy_key: definition.policy_key,
      policy_version: definition.policy_version,
      definition_hash: definitionHash,
      status: "draft",
      created: false,
      readiness: compiled.readiness
    };
  });
}

export async function reconcileSignalGovernedViewPolicyCandidateV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  policyBundleId: string;
  moduleKey?: SignalClientGovernedViewModuleKeyV1;
  reconcileMemberships?: boolean;
  queryable?: SignalBrandPolicyQueryable;
}): Promise<SignalGovernedViewPolicyCandidateReconciliationV1> {
  assertWorkspaceActor(args.workspace, args.actor);
  if (args.viewKey === "brand") {
    const result = await reconcileSignalBrandPolicyCandidateV1({
      workspace: args.workspace,
      actor: args.actor,
      policyBundleId: args.policyBundleId,
      moduleKey: args.moduleKey,
      reconcileMemberships: args.reconcileMemberships,
      queryable: args.queryable
    });
    return { ...result, module_key: args.moduleKey ?? "brand-monitoring" };
  }
  return withTransaction(args.queryable, (queryable) =>
    reconcileNonBrandWithClient({ ...args, viewKey: args.viewKey as NonBrandViewKey }, queryable));
}

async function reconcileNonBrandWithClient(
  args: {
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    viewKey: NonBrandViewKey;
    policyBundleId: string;
    moduleKey?: SignalClientGovernedViewModuleKeyV1;
    reconcileMemberships?: boolean;
  },
  queryable: SignalBrandPolicyQueryable
): Promise<SignalGovernedViewPolicyCandidateReconciliationV1> {
  const moduleKey = args.moduleKey ?? "brand-monitoring";
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${args.workspace.id}:${args.viewKey}:policy-candidate:${args.policyBundleId}:${moduleKey}`
  ]);
  await assertPersistedWorkspaceActor({ ...args, queryable });
  const base = await queryable.query<{
    population_id: string;
    membership_count: number;
    membership_digest: string;
  }>(`
    SELECT population_id::text,membership_count,membership_digest
    FROM reconcile_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
  `, [args.workspace.id,args.actor.id]);
  const basePopulation = base.rows[0];
  if (!basePopulation) throw new Error("Attributable semantic base could not be reconciled.");
  const artifacts = await loadPolicyArtifacts(
    queryable,args.workspace.id,args.policyBundleId,args.actor.id,args.viewKey
  );
  const definition = validateSignalPopulationPolicyBundleDefinitionV1(artifacts.definition);
  assertSignalGovernedPolicyViewContractV1(moduleKey,args.viewKey,definition);
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: artifacts.policy_bundle_id,
    definition_hash: artifacts.policy_definition_hash,
    definition
  });
  const moduleCompiledPlanHash = signalGovernedViewCompilationPlanHashV1({
    base_plan_hash: compiled.plan_hash,module_key: moduleKey,view_key: args.viewKey,
    authorized_modules: definition.authorized_modules,
    capability_usage_purposes: definition.required_usage_purposes
  });
  const derived = await queryable.query<{
    population_id: string;
    population_key: string;
    population_version: number;
    population_definition_hash: string;
    created: boolean;
  }>(`
    SELECT resolved_population_id::text AS population_id,population_key,
      population_version,population_definition_hash,created
    FROM ensure_signal_governed_view_population_derivation(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::uuid
    )
  `, [
    args.workspace.id,args.policyBundleId,basePopulation.population_id,
    moduleKey,args.viewKey,artifacts.policy_definition_hash,moduleCompiledPlanHash,args.actor.id
  ]);
  const derivation = derived.rows[0];
  if (!derivation) throw new Error("Governed module/view population could not be resolved.");
  const governance = definition.data_governance_contract_status === "resolved"
    ? await evaluateSignalViewDataGovernanceV1({
      queryable,workspaceId: args.workspace.id,policyBundleId: args.policyBundleId,
      populationId: derivation.population_id,actor: args.actor,moduleKey,
      viewKey: args.viewKey,reconcileMemberships: args.reconcileMemberships === true
    })
    : null;
  const state = await loadCandidateState(queryable,{
    workspaceId: args.workspace.id,populationId: derivation.population_id,
    policyBundleId: args.policyBundleId,basePopulationId: basePopulation.population_id,
    moduleKey,viewKey: args.viewKey,compiledPlanHash: moduleCompiledPlanHash,
    governanceEvaluationId: governance?.evaluation_id ?? null
  });
  const mismatchReasons: string[] = [];
  if (!state.population_contract_matches) mismatchReasons.push("population_contract_mismatch");
  if (state.alias_membership_count > 0) mismatchReasons.push("alias_membership_detected");
  if (state.expected_membership_count !== state.actual_membership_count
    || state.expected_membership_digest !== state.actual_membership_digest) {
    mismatchReasons.push("membership_set_mismatch");
  }
  if (state.population_membership_digest !== state.actual_membership_digest) {
    mismatchReasons.push("population_digest_stale");
  }
  const policyBlockers: string[] = [...compiled.readiness.blocking_reasons];
  if (governance && !governance.governance_data_watermark_id) {
    policyBlockers.push("data-watermark-not-available");
  }
  if (governance && governance.governance_unknown_count > 0) {
    policyBlockers.push("data-governance-not-available");
  }
  const blockingReasons = [...new Set([...mismatchReasons,...policyBlockers])].sort();
  const compilationStatus = mismatchReasons.length > 0
    ? "stale" as const
    : policyBlockers.length > 0 ? "blocked" as const : "ready" as const;
  const compilation = await persistCompilation(queryable,{
    workspaceId: args.workspace.id,actorUserId: args.actor.id,
    policyBundleId: args.policyBundleId,populationId: derivation.population_id,
    populationVersion: derivation.population_version,
    populationDefinitionHash: derivation.population_definition_hash,
    policyDefinitionHash: artifacts.policy_definition_hash,
    compiledPlanHash: moduleCompiledPlanHash,membershipDigest: state.actual_membership_digest,
    sourceWatermarkHash: state.source_watermark_hash,sourceWatermarkAt: state.source_watermark_at,
    compilationStatus,blockingReasons,moduleKey,viewKey: args.viewKey,governance
  });
  return {
    workspace_id: args.workspace.id,policy_bundle_id: args.policyBundleId,
    policy_definition_hash: artifacts.policy_definition_hash,
    compiled_plan_hash: moduleCompiledPlanHash,base_population_id: basePopulation.population_id,
    population_id: derivation.population_id,population_version: derivation.population_version,
    population_definition_hash: derivation.population_definition_hash,
    expected_membership_count: state.expected_membership_count,
    actual_membership_count: state.actual_membership_count,
    expected_membership_digest: state.expected_membership_digest,
    actual_membership_digest: state.actual_membership_digest,
    alias_membership_count: state.alias_membership_count,
    source_watermark_hash: state.source_watermark_hash,
    source_watermark_at: state.source_watermark_at,compilation_status: compilationStatus,
    blocking_reasons: blockingReasons,policy_matches_memberships: mismatchReasons.length === 0,
    policy_compilation_id: compilation.id,compilation_version: compilation.version,
    governance_evaluation_id: governance?.evaluation_id ?? null,
    governance_digest: governance?.governance_digest ?? null,
    authorized_root_count: governance?.authorized_root_count ?? 0,
    quality_blocked_count: governance?.quality_blocked_count ?? 0,
    retention_blocked_count: governance?.retention_blocked_count ?? 0,
    licensing_blocked_count: governance?.licensing_blocked_count ?? 0,
    governance_unknown_count: governance?.governance_unknown_count ?? null,
    governance_unknown_availability: governance ? "measured" : "not_available",
    current_pointer_unchanged: true,module_key: moduleKey,view_key: args.viewKey,
    usage_purposes: governance?.usage_purposes ?? []
  };
}

async function loadPolicyArtifacts(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  policyBundleId: string,
  actorUserId: string,
  viewKey: NonBrandViewKey
) {
  const identity = VIEW_POLICY_IDENTITY[viewKey];
  const result = await queryable.query<{
    policy_bundle_id: string;
    policy_definition_hash: string;
    definition: SignalPopulationPolicyBundleDefinitionV1;
  }>(`
    SELECT bundle.id::text AS policy_bundle_id,bundle.definition_hash AS policy_definition_hash,
      jsonb_build_object(
        'contract_version','signal-governed-views-v1','workspace_id',bundle.workspace_id::text,
        'policy_key',bundle.policy_key,'policy_version',bundle.policy_version,
        'authorized_modules',bundle.authorized_modules,'allowed_scopes',bundle.allowed_scopes,
        'allowed_entities',COALESCE(entity.items,'[]'::jsonb),
        'acceptance_status',bundle.acceptance_status,
        'quality_contract_status',bundle.quality_contract_status,
        'quality_policy_key',bundle.quality_policy_key,
        'quality_policy_version',bundle.quality_policy_version,
        'min_quality_score',bundle.min_quality_score,
        'required_quality_flags',bundle.required_quality_flags,
        'forbidden_quality_flags',bundle.forbidden_quality_flags,
        'eligibility_policy',bundle.eligibility_policy,
        'deduplication_policy',bundle.deduplication_policy,
        'visibility_class',bundle.visibility_class,'denominator_key',bundle.denominator_key,
        'period_start',bundle.period_start::text,'period_end',bundle.period_end::text,
        'timezone',bundle.timezone,'retention_policy_ref',bundle.retention_policy_ref,
        'licensing_policy_ref',bundle.licensing_policy_ref,
        'data_governance_contract_status',bundle.data_governance_contract_status,
        'quality_policy_id',bundle.quality_policy_id::text,
        'required_usage_purposes',bundle.required_usage_purposes
      ) AS definition
    FROM signal_population_policy_bundles bundle
    JOIN signal_workspaces workspace ON workspace.id=bundle.workspace_id AND workspace.status='active'
    JOIN users actor ON actor.id=$3::uuid AND actor.user_type='noisia_internal'
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'scope',allowed.scope,'entity_type',allowed.entity_type,'entity_id',allowed.entity_id::text
      ) ORDER BY allowed.scope,allowed.entity_type,allowed.entity_id) AS items
      FROM signal_population_policy_entities allowed
      WHERE allowed.policy_bundle_id=bundle.id AND allowed.workspace_id=bundle.workspace_id
    ) entity ON true
    WHERE bundle.id=$2::uuid AND bundle.workspace_id=$1::uuid
      AND bundle.policy_key=$4
      AND bundle.status IN ('draft','active')
    LIMIT 1
  `, [workspaceId,policyBundleId,actorUserId,identity.policy_key]);
  const row = result.rows[0];
  if (!row) throw new Error(`${viewKey} policy draft is unavailable or cross-workspace.`);
  return row;
}

async function loadCandidateState(
  queryable: SignalBrandPolicyQueryable,
  args: {
    workspaceId: string;
    populationId: string;
    policyBundleId: string;
    basePopulationId: string;
    moduleKey: SignalClientGovernedViewModuleKeyV1;
    viewKey: NonBrandViewKey;
    compiledPlanHash: string;
    governanceEvaluationId: string | null;
  }
) {
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
    WITH expected AS (
      SELECT item.mention_id AS id FROM signal_data_governance_evaluation_items item
      WHERE item.evaluation_id=$8::uuid AND item.workspace_id=$1::uuid
        AND item.decision='included' AND item.reason_code='policy_eligible'
    ), actual AS (
      SELECT membership.mention_id AS id FROM signal_population_memberships membership
      WHERE membership.population_id=$2::uuid AND membership.workspace_id=$1::uuid
        AND membership.membership_status='included' AND membership.removed_at IS NULL
    ), watermarks AS (
      SELECT COALESCE(string_agg(concat_ws(':',watermark.id::text,watermark.source_key,
        watermark.corpus_revision::text,COALESCE(watermark.max_observed_at::text,'∅'),
        watermark.accepted_at::text,watermark.data_freshness_state),',' ORDER BY watermark.id),'') AS content,
        max(COALESCE(watermark.max_observed_at,watermark.accepted_at)) AS observed_at
      FROM signal_data_watermarks watermark
      WHERE watermark.workspace_id=$1::uuid AND watermark.population_id=$2::uuid
    ) SELECT
      EXISTS (SELECT 1 FROM signal_governed_view_population_derivations derivation
        JOIN signal_population_definitions population ON population.id=derivation.resolved_population_id
        WHERE derivation.workspace_id=$1::uuid AND derivation.resolved_population_id=$2::uuid
          AND derivation.policy_bundle_id=$3::uuid AND derivation.base_population_id=$4::uuid
          AND derivation.module_key=$5 AND derivation.view_key=$6
          AND derivation.compiled_plan_hash=$7
          AND population.definition->>'contract_version'='signal-governed-view-resolved-population-v1'
          AND population.definition->>'module_key'=$5
          AND population.definition->>'view_key'=$6
      ) AS population_contract_matches,
      COALESCE((SELECT membership_digest FROM signal_population_definitions WHERE id=$2::uuid),$9)
        AS population_membership_digest,
      (SELECT count(*)::int FROM expected) AS expected_membership_count,
      (SELECT count(*)::int FROM actual) AS actual_membership_count,
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(id::text,',' ORDER BY id) FROM expected),''),'UTF8')),'hex') AS expected_membership_digest,
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(id::text,',' ORDER BY id) FROM actual),''),'UTF8')),'hex') AS actual_membership_digest,
      (SELECT count(*)::int FROM actual JOIN mentions mention ON mention.id=actual.id
        WHERE mention.canonical_mention_id<>mention.id) AS alias_membership_count,
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT content FROM watermarks),''),'UTF8')),'hex') AS source_watermark_hash,
      (SELECT observed_at::text FROM watermarks) AS source_watermark_at
  `, [
    args.workspaceId,args.populationId,args.policyBundleId,args.basePopulationId,
    args.moduleKey,args.viewKey,args.compiledPlanHash,args.governanceEvaluationId,EMPTY_HASH
  ]);
  return result.rows[0]!;
}

async function persistCompilation(
  queryable: SignalBrandPolicyQueryable,
  args: {
    workspaceId: string;
    actorUserId: string;
    policyBundleId: string;
    populationId: string;
    populationVersion: number;
    populationDefinitionHash: string;
    policyDefinitionHash: string;
    compiledPlanHash: string;
    membershipDigest: string;
    sourceWatermarkHash: string;
    sourceWatermarkAt: string | null;
    compilationStatus: "ready" | "stale" | "blocked";
    blockingReasons: string[];
    moduleKey: SignalClientGovernedViewModuleKeyV1;
    viewKey: NonBrandViewKey;
    governance: Awaited<ReturnType<typeof evaluateSignalViewDataGovernanceV1>> | null;
  }
) {
  const current = await queryable.query<{
    id: string;
    compilation_version: number;
    signature_matches: boolean;
  }>(`
    SELECT compilation.id::text,compilation.compilation_version,
      compilation.compiled_plan_hash=$5
      AND compilation.policy_definition_hash=$6
      AND compilation.population_definition_hash=$7
      AND compilation.membership_digest=$8
      AND compilation.source_watermark_hash=$9
      AND compilation.governance_evaluation_id IS NOT DISTINCT FROM $10::uuid
      AND compilation.governance_digest IS NOT DISTINCT FROM $11
      AND compilation.next_policy_transition_at IS NOT DISTINCT FROM $12::timestamptz
      AND compilation.governance_data_watermark_id IS NOT DISTINCT FROM $13::uuid
      AND compilation.compilation_status=$14
      AND compilation.blocking_reasons=$15::text[]
      AND NOT EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=compilation.id) AS signature_matches
    FROM signal_population_policy_compilations compilation
    WHERE compilation.workspace_id=$1::uuid AND compilation.policy_bundle_id=$2::uuid
      AND compilation.population_id=$3::uuid AND compilation.module_key=$4
      AND compilation.view_key=$16 AND compilation.is_current
    FOR UPDATE
  `, [
    args.workspaceId,args.policyBundleId,args.populationId,args.moduleKey,
    args.compiledPlanHash,args.policyDefinitionHash,args.populationDefinitionHash,
    args.membershipDigest,args.sourceWatermarkHash,args.governance?.evaluation_id ?? null,
    args.governance?.governance_digest ?? null,args.governance?.next_policy_transition_at ?? null,
    args.governance?.governance_data_watermark_id ?? null,args.compilationStatus,
    args.blockingReasons,args.viewKey
  ]);
  const prior = current.rows[0];
  if (prior?.signature_matches) return { id: prior.id,version: prior.compilation_version };
  if (prior) {
    await queryable.query(`UPDATE signal_population_policy_compilations
      SET is_current=false,retired_at=now() WHERE id=$1::uuid`,[prior.id]);
  }
  const inserted = await queryable.query<{ id: string; compilation_version: number }>(`
    INSERT INTO signal_population_policy_compilations (
      workspace_id,policy_bundle_id,population_id,compilation_version,compiled_plan_hash,
      policy_definition_hash,population_version,population_definition_hash,membership_digest,
      source_watermark_hash,source_watermark_at,compilation_status,blocking_reasons,
      compiled_by_user_id,governance_evaluation_id,quality_policy_id,quality_policy_version,
      quality_policy_hash,retention_policy_digest,licensing_policy_digest,usage_purposes,
      authorized_root_count,quality_blocked_count,retention_blocked_count,
      licensing_blocked_count,governance_unknown_count,policy_evaluation_watermark,
      governance_digest,module_key,view_key,next_policy_transition_at,governance_data_watermark_id
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,COALESCE((SELECT max(compilation_version)+1
        FROM signal_population_policy_compilations WHERE policy_bundle_id=$2::uuid
          AND population_id=$3::uuid AND module_key=$28 AND view_key=$29),1),
      $4,$5,$6,$7,$8,$9,$10::timestamptz,$11,$12::text[],$13::uuid,$14::uuid,
      $15::uuid,$16::int,$17,$18,$19,$20::text[],$21::int,$22::int,$23::int,
      $24::int,$25::int,$26::timestamptz,$27,$28,$29,$30::timestamptz,$31::uuid
    ) RETURNING id::text,compilation_version
  `, [
    args.workspaceId,args.policyBundleId,args.populationId,args.compiledPlanHash,
    args.policyDefinitionHash,args.populationVersion,args.populationDefinitionHash,
    args.membershipDigest,args.sourceWatermarkHash,args.sourceWatermarkAt,args.compilationStatus,
    args.blockingReasons,args.actorUserId,args.governance?.evaluation_id ?? null,
    args.governance?.quality_policy_id ?? null,args.governance?.quality_policy_version ?? null,
    args.governance?.quality_policy_hash ?? null,args.governance?.retention_policy_digest ?? null,
    args.governance?.licensing_policy_digest ?? null,args.governance?.usage_purposes ?? [],
    args.governance?.authorized_root_count ?? 0,args.governance?.quality_blocked_count ?? 0,
    args.governance?.retention_blocked_count ?? 0,args.governance?.licensing_blocked_count ?? 0,
    args.governance?.governance_unknown_count ?? null,
    args.governance?.policy_evaluation_watermark ?? null,args.governance?.governance_digest ?? null,
    args.moduleKey,args.viewKey,args.governance?.next_policy_transition_at ?? null,
    args.governance?.governance_data_watermark_id ?? null
  ]);
  return { id: inserted.rows[0]!.id,version: inserted.rows[0]!.compilation_version };
}
