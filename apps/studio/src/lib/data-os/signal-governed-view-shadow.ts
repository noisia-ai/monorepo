import { createHash } from "node:crypto";

import {
  SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS,
  SIGNAL_SERVING_SCOPE_CONTRACT_VERSION,
  normalizeSignalClientGovernedViewKeyV1,
  signalFiltersHashV1,
  signalGovernedModuleViewContractV1,
  signalServingScopeCursorIsolationHashV1,
  signalServingScopeEtagSeedV1,
  signalServingScopeIdentityHashV1,
  validateSignalCoverageDescriptorV1,
  validateSignalServingScopeDescriptorV1,
  type SignalClientGovernedViewKeyV1,
  type SignalClientGovernedViewModuleKeyV1,
  type SignalCoverageDescriptorV1,
  type SignalFilterV1,
  type SignalGovernedViewDescriptorV1
} from "@noisia/query-engine";

import {
  createPostgresSignalGovernedViewResolverStore,
  resolveSignalGovernedViewV1
} from "@/lib/data-os/signal-governed-view-resolver";
import { governedDescriptorReadScope } from "@/lib/data-os/signal-module-serving-scope";
import type { SignalServingQueryable } from "@/lib/data-os/signal-workspace-serving";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

export const SIGNAL_GOVERNED_VIEW_SHADOW_MODULES = [
  ...SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS
] as const;

type ShadowModule = SignalClientGovernedViewModuleKeyV1;

type GovernedPopulationBaselineV1 = {
  filtered_count: number;
  canonical_ids_hash: string;
  period_start: string | null;
  period_end: string | null;
  series_hash: string;
  topic_result_count: number;
  topic_results_hash: string;
  narrative_result_count: number;
  narrative_results_hash: string;
  resolved_alias_assignment_count: number;
};

type CurrentBindingProof = {
  workspace_id: string;
  module_key: ShadowModule;
  view_key: SignalClientGovernedViewKeyV1;
  binding_id: string;
  binding_version: number;
  policy_bundle_id: string;
  policy_key: string;
  policy_version: number;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  membership_digest: string;
  policy_compilation_id: string;
  governance_evaluation_id: string;
  governance_data_watermark_id: string;
  source_watermark_hash: string;
  governance_digest: string;
  next_policy_transition_at: string | null;
  usage_purposes: string[];
  governance_unknown_count: number;
  min_quality_score: number | null;
  quality_contract_status: string;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  watermark_data_freshness_state: "fresh" | "stale" | "partial" | "not_available";
  watermark_captured_at: string;
  data_watermark_hash: string;
  expected_membership_count: number;
  actual_membership_count: number;
  expected_membership_digest: string;
  actual_membership_digest: string;
  expected_only_count: number;
  actual_only_count: number;
  alias_membership_count: number;
  invalidation_count: number;
};

export type SignalGovernedViewShadowModuleEvidenceV1 = {
  module_key: ShadowModule;
  view_key: SignalClientGovernedViewKeyV1;
  resolution_source: "governed-binding";
  binding_version: number;
  policy: {
    key: string;
    version: number;
    definition_hash: string;
    compiled_plan_hash: string;
  };
  population: {
    version: number;
    definition_hash: string;
    membership_digest: string;
  };
  watermark: {
    data_watermark_hash: string;
    source_watermark_hash: string;
    governance_digest: string;
    freshness_state: string;
    captured_at: string;
    next_policy_transition_at: string | null;
  };
  coverage: SignalCoverageDescriptorV1;
  denominator: number;
  canonical_ids_hash: string;
  period_start: string | null;
  period_end: string | null;
  serving_identity: {
    scope_hash: string;
    cursor_isolation_hash: string;
    etag_seed: string;
  };
  reader_checks: {
    sql_memberships_exact: boolean;
    canonical_ids_exact: boolean;
    period_exact: boolean;
    series_exact: boolean;
    pagination_cursor_isolated: boolean;
    taxonomy_evidence_exact: boolean;
  };
  reconciliation: {
    expected_only_count: number;
    membership_only_count: number;
    unexplained_count: number;
  };
  invariants: {
    canonical_root_deduped: boolean;
    alias_memberships: number;
    exact_view_policy: boolean;
    policy_sql_matches_memberships: boolean;
    current_ready_compilation: boolean;
    durable_watermark: boolean;
    operational_pointer_followed: false;
  };
  gate_passed: boolean;
};

export type SignalGovernedViewBindingShadowEvidenceV1 = {
  contract_version: "signal-governed-view-binding-shadow-v1";
  read_only: true;
  transaction: "repeatable_read_read_only";
  view_key: SignalClientGovernedViewKeyV1;
  modules: SignalGovernedViewShadowModuleEvidenceV1[];
  evidence_capability: {
    same_view: true;
    mentions_binding_available: boolean;
    by_module: Array<{
      module_key: ShadowModule;
      state: "available" | "not_available";
      metric_denominator_count: number;
      visible_count: number | null;
      withheld_count: number | null;
    }>;
  };
  cross_module: {
    all_bindings_current: boolean;
    one_policy_bundle: boolean;
    distinct_population_refs: boolean;
    canonical_module_order: ShadowModule[];
    operational_pointer_followed: false;
    unexplained_count: number;
  };
  evidence_digest: string;
  gate_passed: boolean;
};

export type SignalGovernedViewBindingShadowResultV1 = {
  public_evidence: SignalGovernedViewBindingShadowEvidenceV1;
  private_identity: {
    workspace_id: string;
    modules: Array<{
      module_key: ShadowModule;
      binding_id: string;
      policy_bundle_id: string;
      population_id: string;
      policy_compilation_id: string;
      governance_evaluation_id: string;
      governance_data_watermark_id: string;
    }>;
  };
};

/**
 * Read-only reconciliation of one named client view across its three modules.
 * It follows only exact current bindings and never consults the operational V1
 * pointer. Legacy comparison is deliberately absent: non-brand views have no
 * meaningful legacy denominator.
 */
export async function runSignalGovernedViewBindingShadowV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: unknown;
  filter: SignalFilterV1;
  executionOrder?: readonly ShadowModule[];
  onModuleTiming?: (moduleKey: ShadowModule, durationMs: number) => void;
  queryable?: SignalServingQueryable;
}): Promise<SignalGovernedViewBindingShadowResultV1> {
  const viewKey = normalizeSignalClientGovernedViewKeyV1(args.viewKey);
  if (args.queryable) {
    await requireRepeatableReadOnlyTransaction(args.queryable);
    return runWithClient({ ...args, viewKey }, args.queryable);
  }
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await runWithClient({ ...args, viewKey }, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runWithClient(
  args: {
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    viewKey: SignalClientGovernedViewKeyV1;
    filter: SignalFilterV1;
    executionOrder?: readonly ShadowModule[];
    onModuleTiming?: (moduleKey: ShadowModule, durationMs: number) => void;
  },
  queryable: SignalServingQueryable
): Promise<SignalGovernedViewBindingShadowResultV1> {
  if (args.actor.userType !== "noisia_internal" || args.workspace.subject.type !== "brand") {
    throw new Error("Governed view shadow requires an authorized internal brand workspace.");
  }
  const executionOrder = normalizeExecutionOrder(args.executionOrder);
  await requirePersistedShadowAuthority({
    workspace: args.workspace,
    actor: args.actor,
    queryable
  });
  // These modules own the production pool as their default queryable. Keep them
  // behind the validated read-only transaction boundary so importing the pure
  // shadow contract never initializes a database connection (notably in unit
  // tests), while every real read still receives this exact transaction client.
  const { loadGovernedPopulationContract } = await import(
    "@/lib/data-os/signal-workspace-population"
  );
  const resolverStore = createPostgresSignalGovernedViewResolverStore(
    async <Row>(sql: string, values: unknown[]) => {
      const result = await queryable.query<Record<string, unknown>>(sql, values);
      return result.rows as Row[];
    }
  );
  const publicByModule = new Map<ShadowModule, SignalGovernedViewShadowModuleEvidenceV1>();
  const privateByModule = new Map<ShadowModule,
    SignalGovernedViewBindingShadowResultV1["private_identity"]["modules"][number]>();
  const descriptorByModule = new Map<ShadowModule, SignalGovernedViewDescriptorV1>();

  for (const moduleKey of executionOrder) {
    const startedAt = performance.now();
    const descriptor = await resolveSignalGovernedViewV1(
      args.workspace,
      { module_key: moduleKey, view_key: args.viewKey },
      resolverStore
    );
    if (descriptor.resolution_source !== "governed-binding"
      || !descriptor.binding
      || !descriptor.population
      || !descriptor.population.policy_compilation_id
      || !descriptor.population.compiled_plan_hash
      || descriptor.population.compilation_status !== "ready") {
      throw new Error(`Current governed binding is unavailable for ${moduleKey}/${args.viewKey}.`);
    }
    const proof = await loadProof({
      workspace: args.workspace,
      moduleKey,
      viewKey: args.viewKey,
      descriptor,
      queryable
    });
    const baseline = await loadGovernedPopulationContract({
      workspace: args.workspace,
      populationId: proof.population_id,
      filter: args.filter,
      queryable
    });
    const coverage = await loadCoverage({
      workspaceId: proof.workspace_id,
      populationId: proof.population_id,
      qualityContractStatus: proof.quality_contract_status,
      minQualityScore: proof.min_quality_score,
      requiredQualityFlags: proof.required_quality_flags,
      forbiddenQualityFlags: proof.forbidden_quality_flags,
      filter: args.filter,
      queryable
    });
    const readerChecks = await loadReaderChecks({
      moduleKey,
      workspace: args.workspace,
      populationId: proof.population_id,
      filter: args.filter,
      baseline,
      queryable
    });
    const exactViewPolicy = descriptorMatchesViewContract(
      descriptor,
      moduleKey,
      args.viewKey,
      args.workspace
    );
    const exactMemberships = proof.expected_membership_count === proof.actual_membership_count
      && proof.expected_membership_digest === proof.actual_membership_digest
      && proof.actual_membership_digest === proof.membership_digest
      && proof.expected_only_count === 0
      && proof.actual_only_count === 0;
    const identityMatches = descriptor.workspace_id === proof.workspace_id
      && descriptor.module_key === proof.module_key
      && descriptor.view_key === proof.view_key
      && descriptor.binding.binding_id === proof.binding_id
      && descriptor.binding.binding_version === proof.binding_version
      && descriptor.policy.policy_bundle_id === proof.policy_bundle_id
      && descriptor.policy.definition_hash === proof.policy_definition_hash
      && descriptor.population.population_id === proof.population_id
      && descriptor.population.population_version === proof.population_version
      && descriptor.population.definition_hash === proof.population_definition_hash
      && descriptor.population.membership_digest === proof.membership_digest
      && descriptor.population.policy_compilation_id === proof.policy_compilation_id
      && descriptor.population.compiled_plan_hash === proof.compiled_plan_hash;
    const durableWatermark = proof.governance_data_watermark_id.length > 0
      && /^sha256:[0-9a-f]{64}$/u.test(proof.data_watermark_hash)
      && /^sha256:[0-9a-f]{64}$/u.test(proof.source_watermark_hash)
      && /^sha256:[0-9a-f]{64}$/u.test(proof.governance_digest);
    const reconciliation = {
      expected_only_count: proof.expected_only_count,
      membership_only_count: proof.actual_only_count,
      unexplained_count: proof.expected_only_count + proof.actual_only_count
    };
    const invariants = {
      canonical_root_deduped: proof.alias_membership_count === 0,
      alias_memberships: proof.alias_membership_count,
      exact_view_policy: exactViewPolicy,
      policy_sql_matches_memberships: exactMemberships,
      current_ready_compilation: identityMatches
        && proof.invalidation_count === 0
        && proof.governance_unknown_count === 0,
      durable_watermark: durableWatermark,
      operational_pointer_followed: false as const
    };
    const servingScope = servingDescriptor({
      descriptor,
      proof,
      coverage,
      denominator: baseline.filtered_count,
      filter: args.filter
    });
    const normalizedFiltersHash = signalFiltersHashV1(args.filter);
    const normalizedSortHash = hashCanonicalJson(["published", "desc"]);
    const servingIdentity = {
      scope_hash: signalServingScopeIdentityHashV1(servingScope),
      cursor_isolation_hash: signalServingScopeCursorIsolationHashV1({
        scope: servingScope,
        normalized_filters_hash: normalizedFiltersHash,
        normalized_sort_hash: normalizedSortHash
      }),
      etag_seed: signalServingScopeEtagSeedV1({
        scope: servingScope,
        normalized_filters_hash: normalizedFiltersHash,
        normalized_sort_hash: normalizedSortHash
      })
    };
    const gatePassed = reconciliation.unexplained_count === 0
      && Object.values(readerChecks).every(Boolean)
      && invariants.canonical_root_deduped
      && invariants.exact_view_policy
      && invariants.policy_sql_matches_memberships
      && invariants.current_ready_compilation
      && invariants.durable_watermark;
    publicByModule.set(moduleKey, {
      module_key: moduleKey,
      view_key: args.viewKey,
      resolution_source: "governed-binding",
      binding_version: proof.binding_version,
      policy: {
        key: proof.policy_key,
        version: proof.policy_version,
        definition_hash: proof.policy_definition_hash,
        compiled_plan_hash: proof.compiled_plan_hash
      },
      population: {
        version: proof.population_version,
        definition_hash: proof.population_definition_hash,
        membership_digest: proof.membership_digest
      },
      watermark: {
        data_watermark_hash: proof.data_watermark_hash,
        source_watermark_hash: proof.source_watermark_hash,
        governance_digest: proof.governance_digest,
        freshness_state: proof.watermark_data_freshness_state,
        captured_at: proof.watermark_captured_at,
        next_policy_transition_at: proof.next_policy_transition_at
      },
      coverage,
      denominator: baseline.filtered_count,
      canonical_ids_hash: baseline.canonical_ids_hash,
      period_start: baseline.period_start,
      period_end: baseline.period_end,
      serving_identity: servingIdentity,
      reader_checks: readerChecks,
      reconciliation,
      invariants,
      gate_passed: gatePassed
    });
    privateByModule.set(moduleKey, {
      module_key: moduleKey,
      binding_id: proof.binding_id,
      policy_bundle_id: proof.policy_bundle_id,
      population_id: proof.population_id,
      policy_compilation_id: proof.policy_compilation_id,
      governance_evaluation_id: proof.governance_evaluation_id,
      governance_data_watermark_id: proof.governance_data_watermark_id
    });
    descriptorByModule.set(moduleKey, descriptor);
    args.onModuleTiming?.(moduleKey, Math.round((performance.now() - startedAt) * 10) / 10);
  }

  const modules = SIGNAL_GOVERNED_VIEW_SHADOW_MODULES.map((key) => publicByModule.get(key)!);
  const privateModules = SIGNAL_GOVERNED_VIEW_SHADOW_MODULES.map((key) => privateByModule.get(key)!);
  const mentionsDescriptor = descriptorByModule.get("mentions")!;
  const mentionsScope = governedDescriptorReadScope(
    args.workspace,
    mentionsDescriptor,
    "governed",
    args.viewKey
  );
  const evidenceByModule = [] as SignalGovernedViewBindingShadowEvidenceV1["evidence_capability"]["by_module"];
  const { loadSignalClientEvidenceAccessV1 } = await import(
    "@/lib/data-os/signal-workspace-serving"
  );
  for (const moduleKey of SIGNAL_GOVERNED_VIEW_SHADOW_MODULES) {
    const metricScope = governedDescriptorReadScope(
      args.workspace,
      descriptorByModule.get(moduleKey)!,
      "governed",
      args.viewKey
    );
    const access = await loadSignalClientEvidenceAccessV1({
      workspace: args.workspace,
      metricReadScope: metricScope,
      evidenceReadScope: mentionsScope,
      filter: args.filter,
      queryable
    });
    evidenceByModule.push({
      module_key: moduleKey,
      state: access.state,
      metric_denominator_count: access.metric_denominator_count,
      visible_count: access.evidence_visible_count,
      withheld_count: access.evidence_withheld_count
    });
  }
  const evidenceCapability = {
    same_view: true as const,
    mentions_binding_available: mentionsDescriptor.resolution_source === "governed-binding",
    by_module: evidenceByModule
  };
  const crossModule = {
    all_bindings_current: modules.every((module) => module.resolution_source === "governed-binding"),
    one_policy_bundle: new Set(privateModules.map((module) => module.policy_bundle_id)).size === 1,
    distinct_population_refs: new Set(privateModules.map((module) => module.population_id)).size
      === SIGNAL_GOVERNED_VIEW_SHADOW_MODULES.length,
    canonical_module_order: [...SIGNAL_GOVERNED_VIEW_SHADOW_MODULES],
    operational_pointer_followed: false as const,
    unexplained_count: modules.reduce(
      (total, module) => total + module.reconciliation.unexplained_count,
      0
    )
  };
  const isolationHashes = modules.map((module) => module.serving_identity.scope_hash);
  const withoutDigest = {
    contract_version: "signal-governed-view-binding-shadow-v1" as const,
    read_only: true as const,
    transaction: "repeatable_read_read_only" as const,
    view_key: args.viewKey,
    modules,
    evidence_capability: evidenceCapability,
    cross_module: crossModule,
    gate_passed: modules.every((module) => module.gate_passed)
      && evidenceByModule.every((item) => item.state === "available")
      && new Set(isolationHashes).size === isolationHashes.length
      && crossModule.all_bindings_current
      && crossModule.one_policy_bundle
      && crossModule.distinct_population_refs
      && crossModule.unexplained_count === 0
  };
  return {
    public_evidence: {
      ...withoutDigest,
      evidence_digest: hashCanonicalJson(withoutDigest)
    },
    private_identity: {
      workspace_id: args.workspace.id,
      modules: privateModules
    }
  };
}

async function requirePersistedShadowAuthority(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  queryable: SignalServingQueryable;
}) {
  const result = await args.queryable.query<{ authorized: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM signal_workspaces workspace
      JOIN users actor ON actor.id=$4::uuid
      WHERE workspace.id=$1::uuid
        AND workspace.organization_id=$2::uuid
        AND workspace.brand_id=$3::uuid
        AND workspace.status='active'
        AND actor.status='active'
        AND actor.user_type='noisia_internal'
        AND signal_data_governance_actor_is_valid(workspace.id,actor.id)
    ) AS authorized
  `, [
    args.workspace.id,
    args.workspace.organizationId,
    args.workspace.subject.id,
    args.actor.id
  ]);
  if (result.rows[0]?.authorized !== true) {
    throw new Error("Governed view shadow actor or workspace ownership is invalid.");
  }
}

function normalizeExecutionOrder(input?: readonly ShadowModule[]): ShadowModule[] {
  if (!input) return [...SIGNAL_GOVERNED_VIEW_SHADOW_MODULES];
  const values = [...input];
  if (values.length !== SIGNAL_GOVERNED_VIEW_SHADOW_MODULES.length
    || new Set(values).size !== SIGNAL_GOVERNED_VIEW_SHADOW_MODULES.length
    || values.some((value) => !SIGNAL_GOVERNED_VIEW_SHADOW_MODULES.includes(value))) {
    throw new Error("Governed view shadow execution order must contain each client module once.");
  }
  return values;
}

async function requireRepeatableReadOnlyTransaction(queryable: SignalServingQueryable) {
  const result = await queryable.query<{ isolation: string; read_only: string }>(`
    SELECT current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only
  `);
  const row = result.rows[0];
  if (row?.isolation !== "repeatable read" || row.read_only !== "on") {
    throw new Error("Governed view shadow requires REPEATABLE READ READ ONLY.");
  }
}

async function loadProof(args: {
  workspace: ResolvedSignalWorkspace;
  moduleKey: ShadowModule;
  viewKey: SignalClientGovernedViewKeyV1;
  descriptor: SignalGovernedViewDescriptorV1;
  queryable: SignalServingQueryable;
}): Promise<CurrentBindingProof> {
  if (!args.descriptor.binding || !args.descriptor.population) {
    throw new Error("Current governed view binding proof is unavailable.");
  }
  const result = await args.queryable.query<CurrentBindingProof>(`
    WITH selected AS (
      SELECT binding.workspace_id,binding.module_key,binding.view_key,
        binding.id AS binding_id,binding.binding_version,
        bundle.id AS policy_bundle_id,bundle.policy_key,bundle.policy_version,
        bundle.definition_hash AS policy_definition_hash,bundle.quality_contract_status,
        bundle.min_quality_score,bundle.required_quality_flags,bundle.forbidden_quality_flags,
        population.id AS population_id,population.version AS population_version,
        population.definition_hash AS population_definition_hash,population.membership_digest,
        compilation.id AS policy_compilation_id,compilation.compiled_plan_hash,
        compilation.governance_evaluation_id,compilation.governance_data_watermark_id,
        compilation.source_watermark_hash,compilation.governance_digest,
        compilation.next_policy_transition_at,compilation.usage_purposes,
        compilation.governance_unknown_count,watermark.source_key,watermark.corpus_revision,
        watermark.max_observed_at,watermark.accepted_at,watermark.materialized_at,
        watermark.source_freshness_state,watermark.data_freshness_state
      FROM signal_governed_view_bindings binding
      JOIN signal_population_policy_bundles bundle
        ON bundle.id=binding.policy_bundle_id AND bundle.workspace_id=binding.workspace_id
      JOIN signal_population_definitions population
        ON population.id=binding.population_id AND population.workspace_id=binding.workspace_id
      JOIN signal_population_policy_compilations compilation
        ON compilation.id=binding.policy_compilation_id
       AND compilation.workspace_id=binding.workspace_id
       AND compilation.policy_bundle_id=bundle.id
       AND compilation.population_id=population.id
      JOIN signal_data_watermarks watermark
        ON watermark.id=compilation.governance_data_watermark_id
       AND watermark.workspace_id=binding.workspace_id
       AND watermark.population_id=population.id
      WHERE binding.id=$4::uuid AND binding.workspace_id=$1::uuid
        AND binding.module_key=$2 AND binding.view_key=$3
        AND binding.binding_status='current' AND compilation.is_current
        AND compilation.compilation_status='ready'
    ), expected AS (
      SELECT DISTINCT item.mention_id AS id FROM selected
      JOIN signal_data_governance_evaluation_items item
        ON item.evaluation_id=selected.governance_evaluation_id
       AND item.workspace_id=selected.workspace_id
      WHERE item.decision='included' AND item.reason_code='policy_eligible'
    ), actual AS (
      SELECT DISTINCT membership.mention_id AS id FROM selected
      JOIN signal_population_memberships membership
        ON membership.population_id=selected.population_id
       AND membership.workspace_id=selected.workspace_id
      WHERE membership.membership_status='included' AND membership.removed_at IS NULL
    )
    SELECT selected.workspace_id::text,selected.module_key,selected.view_key,
      selected.binding_id::text,selected.binding_version,selected.policy_bundle_id::text,
      selected.policy_key,selected.policy_version,selected.policy_definition_hash,
      selected.compiled_plan_hash,selected.population_id::text,selected.population_version,
      selected.population_definition_hash,selected.membership_digest,
      selected.policy_compilation_id::text,selected.governance_evaluation_id::text,
      selected.governance_data_watermark_id::text,selected.source_watermark_hash,
      selected.governance_digest,selected.next_policy_transition_at::text,
      selected.usage_purposes,selected.governance_unknown_count,selected.min_quality_score,
      selected.quality_contract_status,selected.required_quality_flags,
      selected.forbidden_quality_flags,
      selected.data_freshness_state AS watermark_data_freshness_state,
      GREATEST(selected.max_observed_at,selected.accepted_at,selected.materialized_at)::text
        AS watermark_captured_at,
      'sha256:' || encode(sha256(convert_to(concat_ws('|',selected.source_key,
        selected.corpus_revision::text,COALESCE(selected.max_observed_at::text,'not_available'),
        selected.accepted_at::text,selected.materialized_at::text,
        selected.source_freshness_state,selected.data_freshness_state),'UTF8')),'hex')
        AS data_watermark_hash,
      (SELECT count(*)::int FROM expected) AS expected_membership_count,
      (SELECT count(*)::int FROM actual) AS actual_membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(id::text,',' ORDER BY id::text)
        FROM expected),''),'UTF8')),'hex') AS expected_membership_digest,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(id::text,',' ORDER BY id::text)
        FROM actual),''),'UTF8')),'hex') AS actual_membership_digest,
      (SELECT count(*)::int FROM (SELECT id FROM expected EXCEPT SELECT id FROM actual) missing)
        AS expected_only_count,
      (SELECT count(*)::int FROM (SELECT id FROM actual EXCEPT SELECT id FROM expected) extra)
        AS actual_only_count,
      (SELECT count(*)::int FROM actual JOIN mentions mention ON mention.id=actual.id
        WHERE mention.canonical_mention_id<>mention.id) AS alias_membership_count,
      (SELECT count(*)::int FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=selected.policy_compilation_id)
        AS invalidation_count
    FROM selected
  `, [args.workspace.id, args.moduleKey, args.viewKey, args.descriptor.binding.binding_id]);
  const row = result.rows[0];
  if (!row || row.workspace_id !== args.workspace.id
    || row.module_key !== args.moduleKey || row.view_key !== args.viewKey) {
    throw new Error(`Current binding proof is unavailable for ${args.moduleKey}/${args.viewKey}.`);
  }
  return row;
}

function descriptorMatchesViewContract(
  descriptor: SignalGovernedViewDescriptorV1,
  moduleKey: ShadowModule,
  viewKey: SignalClientGovernedViewKeyV1,
  workspace: ResolvedSignalWorkspace
) {
  if (descriptor.read_contract.authority_source !== "compiled-policy") return false;
  const semantic = descriptor.read_contract.predicate.semantic_assertion;
  if (!semantic) return false;
  const contract = signalGovernedModuleViewContractV1(moduleKey, viewKey);
  const scopes = [...semantic.allowed_scopes].sort();
  const contractScopes = [...contract.allowed_scopes].sort();
  const exact = contract.scope_mode === "exact"
    ? scopes.join("|") === contractScopes.join("|")
    : scopes.length > 0 && scopes.every((scope) => contractScopes.includes(
      scope as (typeof contractScopes)[number]
    ));
  const entitiesValid = semantic.allowed_entities.length > 0
    && semantic.allowed_entities.every((entity) =>
      semantic.allowed_scopes.includes(entity.scope)
      && contract.allowed_entity_types.includes(entity.entity_type));
  const exactBrand = viewKey !== "brand"
    || (semantic.allowed_entities.length === 1
      && semantic.allowed_entities[0]?.entity_id === workspace.subject.id);
  return exact && entitiesValid && exactBrand
    && descriptor.visibility_class === "client-safe"
    && descriptor.denominator.key === "eligible-canonical-roots";
}

async function loadReaderChecks(args: {
  moduleKey: ShadowModule;
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  baseline: GovernedPopulationBaselineV1;
  queryable: SignalServingQueryable;
}) {
  if (args.moduleKey === "brand-monitoring") {
    const { loadSignalBrandMonitoringGovernedModuleProofV1 } = await import(
      "@/lib/signal-v2/brand-monitoring"
    );
    const governed = await loadSignalBrandMonitoringGovernedModuleProofV1(args);
    return {
      sql_memberships_exact: governed.row_denominator === args.baseline.filtered_count,
      canonical_ids_exact: governed.canonical_ids_hash === args.baseline.canonical_ids_hash,
      period_exact: governed.period_start === args.baseline.period_start
        && governed.period_end === args.baseline.period_end,
      series_exact: governed.series_hash === args.baseline.series_hash,
      pagination_cursor_isolated: true,
      taxonomy_evidence_exact: true
    };
  }
  if (args.moduleKey === "mentions") {
    const { loadSignalMentionsGovernedModuleProofV1 } = await import(
      "@/lib/data-os/signal-workspace-serving"
    );
    const governed = await loadSignalMentionsGovernedModuleProofV1({
      ...args,
      isInternalUser: true
    });
    return {
      sql_memberships_exact: governed.total_count === args.baseline.filtered_count,
      canonical_ids_exact: governed.canonical_ids_hash === args.baseline.canonical_ids_hash,
      period_exact: governed.period_start === args.baseline.period_start
        && governed.period_end === args.baseline.period_end,
      series_exact: true,
      pagination_cursor_isolated: governed.cursor_valid
        && governed.cursor_overlap_count === 0,
      taxonomy_evidence_exact: true
    };
  }
  const { loadSignalTopicsNarrativesGovernedModuleProofV1 } = await import(
    "@/lib/data-os/signal-topics-narratives-serving"
  );
  const governed = await loadSignalTopicsNarrativesGovernedModuleProofV1(args);
  return {
    sql_memberships_exact: governed.row_denominator === args.baseline.filtered_count,
    canonical_ids_exact: governed.canonical_ids_hash === args.baseline.canonical_ids_hash,
    period_exact: governed.period_start === args.baseline.period_start
      && governed.period_end === args.baseline.period_end,
    series_exact: true,
    pagination_cursor_isolated: true,
    taxonomy_evidence_exact: governed.topic_result_count === args.baseline.topic_result_count
      && governed.topic_results_hash === args.baseline.topic_results_hash
      && governed.narrative_result_count === args.baseline.narrative_result_count
      && governed.narrative_results_hash === args.baseline.narrative_results_hash
      && governed.resolved_alias_assignment_count
        === args.baseline.resolved_alias_assignment_count
  };
}

async function loadCoverage(args: {
  workspaceId: string;
  populationId: string;
  qualityContractStatus: string;
  minQualityScore: number | null;
  requiredQualityFlags: string[];
  forbiddenQualityFlags: string[];
  filter: SignalFilterV1;
  queryable: SignalServingQueryable;
}): Promise<SignalCoverageDescriptorV1> {
  const result = await args.queryable.query<{
    captured: number; quality_eligible: number; reviewed: number;
    resolved_attributed: number; unattributed: number; used_by_view: number;
  }>(`
    WITH captured AS (
      SELECT mention.* FROM mentions mention
      WHERE mention.workspace_id=$1::uuid AND mention.canonical_mention_id=mention.id
        AND mention.inclusion_status='included'
        AND (mention.published_at AT TIME ZONE $4)::date BETWEEN $5::date AND $6::date
    ), review_state AS (
      SELECT captured.id,
        bool_or(assertion.review_status IN ('approved','rejected')) AS reviewed,
        bool_or(assertion.review_status='approved' AND assertion.eligibility_status='eligible'
          AND assertion.scope<>'unattributed') AS resolved_attributed,
        bool_or(assertion.review_status='approved' AND assertion.eligibility_status='not_eligible'
          AND assertion.scope='unattributed' AND assertion.entity_id IS NULL) AS unattributed
      FROM captured LEFT JOIN signal_mention_attributions assertion
        ON assertion.workspace_id=$1::uuid AND assertion.mention_id=captured.id
       AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
      GROUP BY captured.id
    )
    SELECT (SELECT count(*)::int FROM captured) AS captured,
      (SELECT count(*)::int FROM captured mention
       WHERE ($2::int IS NULL OR COALESCE(mention.quality_score,-1)>=$2::int)
         AND NOT EXISTS (SELECT 1 FROM unnest($7::text[]) required(flag)
          WHERE NOT (COALESCE(mention.quality_flags,'[]'::jsonb) ? required.flag))
         AND NOT EXISTS (SELECT 1 FROM unnest($8::text[]) forbidden(flag)
          WHERE COALESCE(mention.quality_flags,'[]'::jsonb) ? forbidden.flag)) AS quality_eligible,
      (SELECT count(*)::int FROM review_state WHERE reviewed) AS reviewed,
      (SELECT count(*)::int FROM review_state WHERE resolved_attributed) AS resolved_attributed,
      (SELECT count(*)::int FROM review_state WHERE unattributed) AS unattributed,
      (SELECT count(*)::int FROM signal_population_memberships membership
       JOIN mentions mention ON mention.id=membership.mention_id
       WHERE membership.population_id=$3::uuid AND membership.workspace_id=$1::uuid
         AND membership.membership_status='included' AND membership.removed_at IS NULL
         AND (mention.published_at AT TIME ZONE $4)::date BETWEEN $5::date AND $6::date)
        AS used_by_view
  `, [args.workspaceId,args.minQualityScore,args.populationId,args.filter.timezone,
    args.filter.date_range.start,args.filter.date_range.end,args.requiredQualityFlags,
    args.forbiddenQualityFlags]);
  const row = result.rows[0];
  if (!row) throw new Error("Governed view coverage is unavailable.");
  const available = (count: number) => ({ availability: "available" as const, count });
  const unavailable = { availability: "not_available" as const, count: null };
  return validateSignalCoverageDescriptorV1({
    state: "partial",
    captured: available(row.captured),
    quality_eligible: args.qualityContractStatus === "resolved"
      ? available(row.quality_eligible) : unavailable,
    unreviewed: available(row.captured - row.reviewed),
    reviewed: available(row.reviewed),
    resolved_attributed: available(row.resolved_attributed),
    abstained: unavailable,
    unattributed: available(row.unattributed),
    used_by_view: available(row.used_by_view)
  });
}

function servingDescriptor(args: {
  descriptor: SignalGovernedViewDescriptorV1;
  proof: CurrentBindingProof;
  coverage: SignalCoverageDescriptorV1;
  denominator: number;
  filter: SignalFilterV1;
}) {
  return validateSignalServingScopeDescriptorV1({
    contract_version: SIGNAL_SERVING_SCOPE_CONTRACT_VERSION,
    workspace_id: args.descriptor.workspace_id,
    module_key: args.descriptor.module_key,
    view_key: args.descriptor.view_key,
    rollout_mode: "governed",
    resolution_source: "governed-binding",
    visible_source: "governed-binding",
    binding: args.descriptor.binding,
    policy: args.descriptor.policy,
    population: args.descriptor.population,
    compilation: {
      policy_compilation_id: args.proof.policy_compilation_id,
      compiled_plan_hash: args.proof.compiled_plan_hash,
      compilation_status: "ready"
    },
    visibility_class: args.descriptor.visibility_class,
    usage_purposes: args.proof.usage_purposes,
    watermark: {
      availability: "available",
      data_watermark_hash: args.proof.data_watermark_hash,
      source_watermark_hash: args.proof.source_watermark_hash,
      governance_digest: args.proof.governance_digest,
      captured_at: args.proof.watermark_captured_at,
      next_policy_transition_at: args.proof.next_policy_transition_at
    },
    freshness: {
      state: args.proof.watermark_data_freshness_state,
      invalidation_state: "valid",
      invalidated_at: null
    },
    coverage: args.coverage,
    denominator: { ...args.descriptor.denominator, count: args.denominator },
    period: {
      start: args.filter.date_range.start,
      end: args.filter.date_range.end,
      timezone: args.filter.timezone
    }
  });
}

function hashCanonicalJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
