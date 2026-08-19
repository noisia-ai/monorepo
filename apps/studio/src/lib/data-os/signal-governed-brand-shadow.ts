import { createHash } from "node:crypto";

import {
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  compileSignalPopulationPolicyBundleV1,
  normalizeSignalGovernedViewModuleKeyV1,
  signalGovernedViewCompilationPlanHashV1,
  validateSignalCoverageDescriptorV1,
  validateSignalPopulationPolicyBundleDefinitionV1,
  type SignalCoverageDescriptorV1,
  type SignalFilterV1,
  type SignalGovernedViewModuleKeyV1,
  type SignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import {
  loadGovernedPopulationContract,
  loadLegacyDifferenceExplanation
} from "@/lib/data-os/signal-workspace-population";
import { loadSignalTopicsNarrativesModuleShadowV1 } from "@/lib/data-os/signal-topics-narratives-serving";
import {
  loadSignalMentionsModuleShadowV1,
  type SignalServingQueryable
} from "@/lib/data-os/signal-workspace-serving";
import { loadSignalBrandMonitoringModuleShadowV1 } from "@/lib/signal-v2/brand-monitoring";
import {
  SIGNAL_BRAND_POLICY_KEY,
  SIGNAL_BRAND_POLICY_MODULES,
  SIGNAL_BRAND_POLICY_VERSION
} from "@/lib/data-os/signal-governed-brand-policy";
import {
  createPostgresSignalGovernedViewResolverStore,
  resolveSignalGovernedViewV1
} from "@/lib/data-os/signal-governed-view-resolver";

type DraftCompilationStatus = "ready" | "stale" | "blocked";

type SignalBrandDraftCandidateDescriptorV1 = {
  workspace_id: string;
  module_key: SignalGovernedViewModuleKeyV1;
  policy_bundle_id: string;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  membership_digest: string;
  policy_compilation_id: string;
  governance_evaluation_id: string;
  compilation_status: DraftCompilationStatus;
  blocking_reasons: string[];
  definition: SignalPopulationPolicyBundleDefinitionV1;
};

export type SignalBrandDraftShadowEvidenceV1 = {
  contract_version: "signal-brand-draft-shadow-v1";
  read_only: true;
  transaction: "repeatable_read_read_only";
  module_key: SignalGovernedViewModuleKeyV1;
  view_key: "brand";
  policy: {
    key: typeof SIGNAL_BRAND_POLICY_KEY;
    version: typeof SIGNAL_BRAND_POLICY_VERSION;
    definition_hash: string;
    compiled_plan_hash: string;
    compilation_status: DraftCompilationStatus;
    blocking_reasons: string[];
  };
  population: {
    version: number;
    definition_hash: string;
    membership_digest: string;
  };
  coverage: SignalCoverageDescriptorV1;
  denominator: number;
  canonical_ids_hash: string;
  period_start: string | null;
  period_end: string | null;
  series_hash: string;
  module_checks: {
    brand_monitoring: boolean;
    mentions: boolean;
    topics_narratives: boolean;
    cursor_isolation: boolean;
    taxonomy_evidence: boolean;
  };
  legacy_differences: {
    legacy_only_count: number;
    governed_only_count: number;
    explained_legacy_count: number;
    unexplained_count: number;
    legacy_only_by_reason: Record<string, number>;
    governed_only_by_reason: Record<string, number>;
  };
  invariants: {
    canonical_root_deduped: boolean;
    alias_memberships: number;
    exact_brand_entity: boolean;
    policy_sql_matches_memberships: boolean;
    operational_pointer_followed: false;
  };
  gate_passed: boolean;
};

export type SignalBrandDraftShadowResultV1 = {
  public_evidence: SignalBrandDraftShadowEvidenceV1;
  private_identity: {
    workspace_id: string;
    policy_bundle_id: string;
    population_id: string;
    policy_compilation_id: string;
    governance_evaluation_id: string;
  };
};

const CURRENT_BINDING_SHADOW_MODULES = [
  "brand-monitoring",
  "mentions",
  "topics-narratives"
] as const satisfies readonly SignalGovernedViewModuleKeyV1[];

type CurrentBindingShadowModule = (typeof CURRENT_BINDING_SHADOW_MODULES)[number];

type SignalCurrentBindingShadowModuleEvidenceV1 = {
  module_key: CurrentBindingShadowModule;
  view_key: "brand";
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
  reader_checks: {
    sql_memberships_exact: boolean;
    canonical_ids_exact: boolean;
    period_exact: boolean;
    series_exact: boolean;
    pagination_cursor_isolated: boolean;
    taxonomy_evidence_exact: boolean;
  };
  legacy_differences: {
    legacy_only_count: number;
    governed_only_count: number;
    explained_legacy_count: number;
    unexplained_count: number;
    legacy_only_by_reason: Record<string, number>;
    governed_only_by_reason: Record<string, number>;
  };
  invariants: {
    canonical_root_deduped: boolean;
    alias_memberships: number;
    exact_brand_entity: boolean;
    policy_sql_matches_memberships: boolean;
    current_ready_compilation: boolean;
    durable_watermark: boolean;
    operational_pointer_followed: false;
  };
  gate_passed: boolean;
};

export type SignalGovernedBrandBindingShadowEvidenceV1 = {
  contract_version: "signal-governed-brand-binding-shadow-v1";
  read_only: true;
  transaction: "repeatable_read_read_only";
  view_key: "brand";
  modules: SignalCurrentBindingShadowModuleEvidenceV1[];
  cross_module: {
    all_bindings_current: boolean;
    distinct_population_refs: boolean;
    canonical_module_order: CurrentBindingShadowModule[];
    operational_pointer_followed: false;
    unexplained_count: number;
  };
  evidence_digest: string;
  gate_passed: boolean;
};

export type SignalGovernedBrandBindingShadowResultV1 = {
  public_evidence: SignalGovernedBrandBindingShadowEvidenceV1;
  private_identity: {
    workspace_id: string;
    modules: Array<{
      module_key: CurrentBindingShadowModule;
      binding_id: string;
      policy_bundle_id: string;
      population_id: string;
      policy_compilation_id: string;
      governance_evaluation_id: string;
      governance_data_watermark_id: string;
    }>;
  };
};

type CurrentBindingProof = {
  workspace_id: string;
  module_key: CurrentBindingShadowModule;
  view_key: "brand";
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
  policy_evaluation_watermark: string;
  next_policy_transition_at: string | null;
  usage_purposes: string[];
  governance_unknown_count: number;
  min_quality_score: number | null;
  quality_contract_status: string;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  watermark_data_freshness_state: string;
  watermark_captured_at: string;
  data_watermark_hash: string;
  expected_membership_count: number;
  actual_membership_count: number;
  expected_membership_digest: string;
  actual_membership_digest: string;
  alias_membership_count: number;
  exact_brand_entity: boolean;
  invalidation_count: number;
};

export async function runSignalBrandDraftShadowV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  moduleKey: unknown;
  filter: SignalFilterV1;
  queryable?: SignalServingQueryable;
}): Promise<SignalBrandDraftShadowResultV1> {
  if (args.queryable) return runSignalBrandDraftShadowWithClient(args, args.queryable);
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await runSignalBrandDraftShadowWithClient(args, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Audits the three promoted `brand` bindings without consulting the operational
 * population pointer. The optional execution order exists only to prove that
 * module-local populations are order-independent; output is always canonical.
 */
export async function runSignalGovernedBrandBindingShadowV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  filter: SignalFilterV1;
  executionOrder?: readonly CurrentBindingShadowModule[];
  onModuleTiming?: (moduleKey: CurrentBindingShadowModule, durationMs: number) => void;
  queryable?: SignalServingQueryable;
}): Promise<SignalGovernedBrandBindingShadowResultV1> {
  if (args.queryable) {
    await requireRepeatableReadOnlyTransaction(args.queryable);
    return runSignalGovernedBrandBindingShadowWithClient(args, args.queryable);
  }
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await runSignalGovernedBrandBindingShadowWithClient(args, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runSignalGovernedBrandBindingShadowWithClient(
  args: {
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    filter: SignalFilterV1;
    executionOrder?: readonly CurrentBindingShadowModule[];
    onModuleTiming?: (moduleKey: CurrentBindingShadowModule, durationMs: number) => void;
  },
  queryable: SignalServingQueryable
): Promise<SignalGovernedBrandBindingShadowResultV1> {
  if (args.actor.userType !== "noisia_internal" || args.workspace.subject.type !== "brand") {
    throw new Error("Governed binding shadow requires an authorized internal brand workspace.");
  }
  const executionOrder = normalizeCurrentBindingShadowOrder(args.executionOrder);
  const legacyCorpus = args.workspace.corpora.find((corpus) => corpus.role === "operational")
    ?? args.workspace.corpora.find((corpus) => corpus.role === "legacy");
  if (!legacyCorpus) throw new Error("Governed binding shadow requires one legacy comparison corpus.");
  const resolverStore = createPostgresSignalGovernedViewResolverStore(
    async <Row>(sql: string, values: unknown[]) => {
      const result = await queryable.query<Record<string, unknown>>(sql, values);
      return result.rows as Row[];
    }
  );
  const publicByModule = new Map<CurrentBindingShadowModule, SignalCurrentBindingShadowModuleEvidenceV1>();
  const privateByModule = new Map<CurrentBindingShadowModule,
    SignalGovernedBrandBindingShadowResultV1["private_identity"]["modules"][number]>();

  // Keep every statement on the same client/snapshot. PostgreSQL clients queue
  // concurrent queries implicitly, which would make the audit order opaque.
  for (const moduleKey of executionOrder) {
    const moduleStartedAt = performance.now();
    const descriptor = await resolveSignalGovernedViewV1(
      args.workspace,
      { module_key: moduleKey, view_key: "brand" },
      resolverStore
    );
    if (descriptor.resolution_source !== "governed-binding"
      || !descriptor.binding
      || !descriptor.population
      || !descriptor.population.policy_compilation_id
      || !descriptor.population.compiled_plan_hash
      || descriptor.population.compilation_status !== "ready") {
      throw new Error(`Current governed binding is unavailable for ${moduleKey}/brand.`);
    }
    const proof = await loadCurrentBindingProofV1({
      workspace: args.workspace,
      moduleKey,
      descriptor,
      queryable
    });
    const baseline = await loadGovernedPopulationContract({
      workspace: args.workspace,
      populationId: proof.population_id,
      filter: args.filter,
      queryable
    });
    const differences = await loadLegacyDifferenceExplanation({
      workspace: args.workspace,
      legacyCorpusId: legacyCorpus.id,
      populationId: proof.population_id,
      filter: args.filter,
      queryable,
      baseline: "operational_v1"
    });
    const coverage = await loadSignalBrandPopulationCoverageV1({
      workspaceId: proof.workspace_id,
      populationId: proof.population_id,
      qualityContractStatus: proof.quality_contract_status,
      minQualityScore: proof.min_quality_score,
      requiredQualityFlags: proof.required_quality_flags,
      forbiddenQualityFlags: proof.forbidden_quality_flags,
      filter: args.filter,
      queryable
    });
    const readerChecks = await loadCurrentBindingModuleChecksV1({
      moduleKey,
      workspace: args.workspace,
      populationId: proof.population_id,
      filter: args.filter,
      baseline,
      queryable
    });
    const identityMatches = descriptor.workspace_id === proof.workspace_id
      && descriptor.module_key === proof.module_key
      && descriptor.view_key === proof.view_key
      && descriptor.binding.binding_id === proof.binding_id
      && descriptor.binding.binding_version === proof.binding_version
      && descriptor.policy.policy_bundle_id === proof.policy_bundle_id
      && descriptor.policy.policy_key === proof.policy_key
      && descriptor.policy.policy_version === proof.policy_version
      && descriptor.policy.definition_hash === proof.policy_definition_hash
      && descriptor.population.population_id === proof.population_id
      && descriptor.population.population_version === proof.population_version
      && descriptor.population.definition_hash === proof.population_definition_hash
      && descriptor.population.membership_digest === proof.membership_digest
      && descriptor.population.policy_compilation_id === proof.policy_compilation_id
      && descriptor.population.compiled_plan_hash === proof.compiled_plan_hash;
    const exactMemberships = proof.expected_membership_count === proof.actual_membership_count
      && proof.expected_membership_digest === proof.actual_membership_digest
      && proof.actual_membership_digest === proof.membership_digest;
    const durableWatermark = proof.governance_data_watermark_id.length > 0
      && /^sha256:[0-9a-f]{64}$/u.test(proof.data_watermark_hash)
      && /^sha256:[0-9a-f]{64}$/u.test(proof.source_watermark_hash)
      && /^sha256:[0-9a-f]{64}$/u.test(proof.governance_digest);
    const invariants = {
      canonical_root_deduped: proof.alias_membership_count === 0
        && baseline.contract_violation_count === 0,
      alias_memberships: proof.alias_membership_count,
      exact_brand_entity: proof.exact_brand_entity,
      policy_sql_matches_memberships: exactMemberships,
      current_ready_compilation: identityMatches
        && proof.invalidation_count === 0
        && proof.governance_unknown_count === 0,
      durable_watermark: durableWatermark,
      operational_pointer_followed: false as const
    };
    const gatePassed = baseline.primary_brand_contract
      && baseline.contract_violation_count === 0
      && differences.unexplained_count === 0
      && Object.values(readerChecks).every(Boolean)
      && invariants.canonical_root_deduped
      && invariants.exact_brand_entity
      && invariants.policy_sql_matches_memberships
      && invariants.current_ready_compilation
      && invariants.durable_watermark;
    publicByModule.set(moduleKey, {
      module_key: moduleKey,
      view_key: "brand",
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
      reader_checks: readerChecks,
      legacy_differences: {
        legacy_only_count: differences.legacy_only_count,
        governed_only_count: differences.governed_only_count,
        explained_legacy_count: differences.explained_legacy_count,
        unexplained_count: differences.unexplained_count,
        legacy_only_by_reason: differences.legacy_only_by_reason,
        governed_only_by_reason: differences.governed_only_by_reason
      },
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
    args.onModuleTiming?.(moduleKey, Math.round((performance.now() - moduleStartedAt) * 10) / 10);
  }

  const modules = CURRENT_BINDING_SHADOW_MODULES.map((moduleKey) => publicByModule.get(moduleKey)!);
  const privateModules = CURRENT_BINDING_SHADOW_MODULES.map((moduleKey) => privateByModule.get(moduleKey)!);
  const crossModule = {
    all_bindings_current: modules.every((module) => module.resolution_source === "governed-binding"),
    distinct_population_refs: new Set(privateModules.map((module) => module.population_id)).size
      === CURRENT_BINDING_SHADOW_MODULES.length,
    canonical_module_order: [...CURRENT_BINDING_SHADOW_MODULES],
    operational_pointer_followed: false as const,
    unexplained_count: modules.reduce(
      (total, module) => total + module.legacy_differences.unexplained_count,
      0
    )
  };
  const withoutDigest = {
    contract_version: "signal-governed-brand-binding-shadow-v1" as const,
    read_only: true as const,
    transaction: "repeatable_read_read_only" as const,
    view_key: "brand" as const,
    modules,
    cross_module: crossModule,
    gate_passed: modules.every((module) => module.gate_passed)
      && crossModule.all_bindings_current
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

function normalizeCurrentBindingShadowOrder(
  input?: readonly CurrentBindingShadowModule[]
): CurrentBindingShadowModule[] {
  if (!input) return [...CURRENT_BINDING_SHADOW_MODULES];
  const values = [...input];
  if (values.length !== CURRENT_BINDING_SHADOW_MODULES.length
    || new Set(values).size !== CURRENT_BINDING_SHADOW_MODULES.length
    || values.some((value) => !CURRENT_BINDING_SHADOW_MODULES.includes(value))) {
    throw new Error("Governed binding shadow execution order must contain each supported module once.");
  }
  return values;
}

async function requireRepeatableReadOnlyTransaction(queryable: SignalServingQueryable) {
  const result = await queryable.query<{
    isolation: string;
    read_only: string;
  }>(`
    SELECT current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only
  `);
  const row = result.rows[0];
  if (row?.isolation !== "repeatable read" || row.read_only !== "on") {
    throw new Error("Governed binding shadow requires REPEATABLE READ READ ONLY.");
  }
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

async function loadCurrentBindingProofV1(args: {
  workspace: ResolvedSignalWorkspace;
  moduleKey: CurrentBindingShadowModule;
  descriptor: Awaited<ReturnType<typeof resolveSignalGovernedViewV1>>;
  queryable: SignalServingQueryable;
}): Promise<CurrentBindingProof> {
  if (!args.descriptor.binding || !args.descriptor.population) {
    throw new Error("Current governed binding proof is unavailable.");
  }
  const result = await args.queryable.query<CurrentBindingProof>(`
    WITH selected AS (
      SELECT
        binding.workspace_id,
        binding.module_key,
        binding.view_key,
        binding.id AS binding_id,
        binding.binding_version,
        bundle.id AS policy_bundle_id,
        bundle.policy_key,
        bundle.policy_version,
        bundle.definition_hash AS policy_definition_hash,
        bundle.quality_contract_status,
        bundle.min_quality_score,
        bundle.required_quality_flags,
        bundle.forbidden_quality_flags,
        population.id AS population_id,
        population.version AS population_version,
        population.definition_hash AS population_definition_hash,
        population.membership_digest,
        compilation.id AS policy_compilation_id,
        compilation.compiled_plan_hash,
        compilation.governance_evaluation_id,
        compilation.governance_data_watermark_id,
        compilation.source_watermark_hash,
        compilation.governance_digest,
        compilation.policy_evaluation_watermark,
        compilation.next_policy_transition_at,
        compilation.usage_purposes,
        compilation.governance_unknown_count,
        watermark.source_key,
        watermark.corpus_revision,
        watermark.max_observed_at,
        watermark.accepted_at,
        watermark.materialized_at,
        watermark.source_freshness_state,
        watermark.data_freshness_state
      FROM signal_governed_view_bindings binding
      JOIN signal_population_policy_bundles bundle
        ON bundle.id = binding.policy_bundle_id
       AND bundle.workspace_id = binding.workspace_id
      JOIN signal_population_definitions population
        ON population.id = binding.population_id
       AND population.workspace_id = binding.workspace_id
      JOIN signal_population_policy_compilations compilation
        ON compilation.id = binding.policy_compilation_id
       AND compilation.workspace_id = binding.workspace_id
       AND compilation.policy_bundle_id = bundle.id
       AND compilation.population_id = population.id
      JOIN signal_data_watermarks watermark
        ON watermark.id = compilation.governance_data_watermark_id
       AND watermark.workspace_id = binding.workspace_id
       AND watermark.population_id = population.id
      WHERE binding.id = $3::uuid
        AND binding.workspace_id = $1::uuid
        AND binding.module_key = $2
        AND binding.view_key = 'brand'
        AND binding.binding_status = 'current'
        AND compilation.is_current
        AND compilation.compilation_status = 'ready'
    ), expected AS (
      SELECT item.mention_id AS id
      FROM selected
      JOIN signal_data_governance_evaluation_items item
        ON item.evaluation_id = selected.governance_evaluation_id
       AND item.workspace_id = selected.workspace_id
      WHERE item.decision = 'included' AND item.reason_code = 'policy_eligible'
    ), actual AS (
      SELECT membership.mention_id AS id
      FROM selected
      JOIN signal_population_memberships membership
        ON membership.population_id = selected.population_id
       AND membership.workspace_id = selected.workspace_id
      WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL
    )
    SELECT
      selected.workspace_id::text,
      selected.module_key,
      selected.view_key,
      selected.binding_id::text,
      selected.binding_version,
      selected.policy_bundle_id::text,
      selected.policy_key,
      selected.policy_version,
      selected.policy_definition_hash,
      selected.compiled_plan_hash,
      selected.population_id::text,
      selected.population_version,
      selected.population_definition_hash,
      selected.membership_digest,
      selected.policy_compilation_id::text,
      selected.governance_evaluation_id::text,
      selected.governance_data_watermark_id::text,
      selected.source_watermark_hash,
      selected.governance_digest,
      selected.policy_evaluation_watermark::text,
      selected.next_policy_transition_at::text,
      selected.usage_purposes,
      selected.governance_unknown_count,
      selected.min_quality_score,
      selected.quality_contract_status,
      selected.required_quality_flags,
      selected.forbidden_quality_flags,
      selected.data_freshness_state AS watermark_data_freshness_state,
      GREATEST(selected.max_observed_at, selected.accepted_at,
        selected.materialized_at)::text AS watermark_captured_at,
      'sha256:' || encode(sha256(convert_to(concat_ws('|',
        selected.source_key,
        selected.corpus_revision::text,
        COALESCE(selected.max_observed_at::text, 'not_available'),
        selected.accepted_at::text,
        selected.materialized_at::text,
        selected.source_freshness_state,
        selected.data_freshness_state
      ), 'UTF8')), 'hex') AS data_watermark_hash,
      (SELECT count(*)::int FROM expected) AS expected_membership_count,
      (SELECT count(*)::int FROM actual) AS actual_membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(id::text, ',' ORDER BY id::text) FROM expected
      ), ''), 'UTF8')), 'hex') AS expected_membership_digest,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(id::text, ',' ORDER BY id::text) FROM actual
      ), ''), 'UTF8')), 'hex') AS actual_membership_digest,
      (SELECT count(*)::int FROM actual
       JOIN mentions mention ON mention.id = actual.id
       WHERE mention.canonical_mention_id <> mention.id) AS alias_membership_count,
      (SELECT count(*) = 1
       FROM signal_population_policy_entities entity
       WHERE entity.workspace_id = selected.workspace_id
         AND entity.policy_bundle_id = selected.policy_bundle_id
         AND entity.scope = 'primary_brand'
         AND entity.entity_type = 'brand'
         AND entity.entity_id = $4::uuid) AS exact_brand_entity,
      (SELECT count(*)::int FROM signal_data_governance_invalidations invalidation
       WHERE invalidation.policy_compilation_id = selected.policy_compilation_id)
        AS invalidation_count
    FROM selected
  `, [
    args.workspace.id,
    args.moduleKey,
    args.descriptor.binding.binding_id,
    args.workspace.subject.id
  ]);
  const row = result.rows[0];
  if (!row || row.workspace_id !== args.workspace.id || row.module_key !== args.moduleKey) {
    throw new Error(`Current binding proof is unavailable for ${args.moduleKey}/brand.`);
  }
  return row;
}

async function loadCurrentBindingModuleChecksV1(args: {
  moduleKey: CurrentBindingShadowModule;
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  baseline: Awaited<ReturnType<typeof loadGovernedPopulationContract>>;
  queryable: SignalServingQueryable;
}) {
  if (args.moduleKey === "brand-monitoring") {
    const shadow = await loadSignalBrandMonitoringModuleShadowV1({
      workspace: args.workspace,
      populationId: args.populationId,
      filter: args.filter,
      queryable: args.queryable
    });
    return {
      sql_memberships_exact: shadow.governed.row_denominator === args.baseline.filtered_count,
      canonical_ids_exact: shadow.governed.canonical_ids_hash === args.baseline.canonical_ids_hash,
      period_exact: shadow.governed.period_start === args.baseline.period_start
        && shadow.governed.period_end === args.baseline.period_end,
      series_exact: shadow.governed.series_hash === args.baseline.series_hash,
      pagination_cursor_isolated: true,
      taxonomy_evidence_exact: true
    };
  }
  if (args.moduleKey === "mentions") {
    const shadow = await loadSignalMentionsModuleShadowV1({
      workspace: args.workspace,
      populationId: args.populationId,
      filter: args.filter,
      isInternalUser: true,
      queryable: args.queryable
    });
    return {
      sql_memberships_exact: shadow.governed.total_count === args.baseline.filtered_count,
      canonical_ids_exact: shadow.governed.canonical_ids_hash === args.baseline.canonical_ids_hash,
      period_exact: shadow.governed.period_start === args.baseline.period_start
        && shadow.governed.period_end === args.baseline.period_end,
      series_exact: true,
      pagination_cursor_isolated: shadow.governed.cursor_valid
        && shadow.governed.cursor_overlap_count === 0,
      taxonomy_evidence_exact: true
    };
  }
  const shadow = await loadSignalTopicsNarrativesModuleShadowV1({
    workspace: args.workspace,
    populationId: args.populationId,
    filter: args.filter,
    queryable: args.queryable
  });
  return {
    sql_memberships_exact: shadow.governed.row_denominator === args.baseline.filtered_count,
    canonical_ids_exact: shadow.governed.canonical_ids_hash === args.baseline.canonical_ids_hash,
    period_exact: shadow.governed.period_start === args.baseline.period_start
      && shadow.governed.period_end === args.baseline.period_end,
    series_exact: true,
    pagination_cursor_isolated: true,
    taxonomy_evidence_exact: shadow.governed.topic_result_count === args.baseline.topic_result_count
      && shadow.governed.topic_results_hash === args.baseline.topic_results_hash
      && shadow.governed.narrative_result_count === args.baseline.narrative_result_count
      && shadow.governed.narrative_results_hash === args.baseline.narrative_results_hash
      && shadow.governed.resolved_alias_assignment_count
        === args.baseline.resolved_alias_assignment_count
  };
}

async function loadSignalBrandPopulationCoverageV1(args: {
  workspaceId: string;
  populationId: string;
  qualityContractStatus: string;
  minQualityScore: number | null;
  requiredQualityFlags: string[];
  forbiddenQualityFlags: string[];
  filter: SignalFilterV1;
  queryable: SignalServingQueryable;
}): Promise<SignalCoverageDescriptorV1> {
  const qualityAvailable = args.qualityContractStatus === "resolved";
  const result = await args.queryable.query<{
    captured: number;
    quality_eligible: number;
    reviewed: number;
    resolved_attributed: number;
    unattributed: number;
    used_by_view: number;
  }>(`
    WITH captured AS (
      SELECT mention.*
      FROM mentions mention
      WHERE mention.workspace_id = $1::uuid
        AND mention.canonical_mention_id = mention.id
        AND mention.inclusion_status = 'included'
        AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
        AND (mention.published_at AT TIME ZONE $4)::date <= $6::date
    ), review_state AS (
      SELECT captured.id,
        bool_or(assertion.review_status IN ('approved', 'rejected')) AS reviewed,
        bool_or(assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'eligible'
          AND assertion.scope <> 'unattributed') AS resolved_attributed,
        bool_or(assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'not_eligible'
          AND assertion.scope = 'unattributed'
          AND assertion.entity_id IS NULL) AS unattributed
      FROM captured
      LEFT JOIN signal_mention_attributions assertion
        ON assertion.workspace_id = $1::uuid
       AND assertion.mention_id = captured.id
       AND assertion.attribution_basis = 'mention_semantic'
       AND assertion.is_current
      GROUP BY captured.id
    )
    SELECT
      (SELECT count(*)::int FROM captured) AS captured,
      (SELECT count(*)::int FROM captured mention
       WHERE ($2::int IS NULL OR COALESCE(mention.quality_score, -1) >= $2::int)
         AND NOT EXISTS (
           SELECT 1 FROM unnest($7::text[]) required(flag)
           WHERE NOT (COALESCE(mention.quality_flags, '[]'::jsonb) ? required.flag)
         )
         AND NOT EXISTS (
           SELECT 1 FROM unnest($8::text[]) forbidden(flag)
           WHERE COALESCE(mention.quality_flags, '[]'::jsonb) ? forbidden.flag
         )) AS quality_eligible,
      (SELECT count(*)::int FROM review_state WHERE reviewed) AS reviewed,
      (SELECT count(*)::int FROM review_state WHERE resolved_attributed) AS resolved_attributed,
      (SELECT count(*)::int FROM review_state WHERE unattributed) AS unattributed,
      (SELECT count(*)::int
       FROM signal_population_memberships membership
       JOIN mentions mention ON mention.id = membership.mention_id
       WHERE membership.population_id = $3::uuid
         AND membership.workspace_id = $1::uuid
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL
         AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
         AND (mention.published_at AT TIME ZONE $4)::date <= $6::date) AS used_by_view
  `, [
    args.workspaceId,
    args.minQualityScore,
    args.populationId,
    args.filter.timezone,
    args.filter.date_range.start,
    args.filter.date_range.end,
    args.requiredQualityFlags,
    args.forbiddenQualityFlags
  ]);
  const row = result.rows[0]!;
  const available = (count: number) => ({ availability: "available" as const, count });
  const unavailable = { availability: "not_available" as const, count: null };
  return validateSignalCoverageDescriptorV1({
    state: "partial",
    captured: available(row.captured),
    quality_eligible: qualityAvailable ? available(row.quality_eligible) : unavailable,
    unreviewed: available(row.captured - row.reviewed),
    reviewed: available(row.reviewed),
    resolved_attributed: available(row.resolved_attributed),
    abstained: unavailable,
    unattributed: available(row.unattributed),
    used_by_view: available(row.used_by_view)
  });
}

async function runSignalBrandDraftShadowWithClient(
  args: {
    workspace: ResolvedSignalWorkspace;
    actor: SignalWorkspaceUser;
    moduleKey: unknown;
    filter: SignalFilterV1;
  },
  queryable: SignalServingQueryable
): Promise<SignalBrandDraftShadowResultV1> {
  const descriptor = await resolveSignalBrandDraftCandidateV1({
    workspace: args.workspace,
    actor: args.actor,
    moduleKey: args.moduleKey,
    queryable
  });
  const legacyCorpus = args.workspace.corpora.find((corpus) => corpus.role === "operational")
    ?? args.workspace.corpora.find((corpus) => corpus.role === "legacy");
  if (!legacyCorpus) throw new Error("Draft shadow requires one legacy comparison corpus.");
  // A single PostgreSQL client owns the repeatable-read snapshot. Keep queries
  // sequential: pg does not support concurrent client.query calls and queuing
  // them implicitly would obscure which statement belongs to the snapshot.
  const brandMonitoring = await loadSignalBrandMonitoringModuleShadowV1({
    workspace: args.workspace,
    populationId: descriptor.population_id,
    filter: args.filter,
    queryable
  });
  const mentions = await loadSignalMentionsModuleShadowV1({
    workspace: args.workspace,
    populationId: descriptor.population_id,
    filter: args.filter,
    isInternalUser: true,
    queryable
  });
  const topicsNarratives = await loadSignalTopicsNarrativesModuleShadowV1({
    workspace: args.workspace,
    populationId: descriptor.population_id,
    filter: args.filter,
    queryable
  });
  const baseline = await loadGovernedPopulationContract({
    workspace: args.workspace,
    populationId: descriptor.population_id,
    filter: args.filter,
    queryable
  });
  const differences = await loadLegacyDifferenceExplanation({
    workspace: args.workspace,
    legacyCorpusId: legacyCorpus.id,
    populationId: descriptor.population_id,
    filter: args.filter,
    queryable,
    baseline: "operational_v1"
  });
  const coverage = await loadSignalBrandDraftCoverageV1({
    descriptor,
    filter: args.filter,
    queryable
  });
  const identity = await loadSignalBrandDraftIdentityChecksV1(descriptor, queryable);
  const moduleChecks = {
    brand_monitoring: brandMonitoring.governed.row_denominator === baseline.filtered_count
      && brandMonitoring.governed.canonical_ids_hash === baseline.canonical_ids_hash
      && brandMonitoring.governed.period_start === baseline.period_start
      && brandMonitoring.governed.period_end === baseline.period_end
      && brandMonitoring.governed.series_hash === baseline.series_hash,
    mentions: mentions.governed.total_count === baseline.filtered_count
      && mentions.governed.canonical_ids_hash === baseline.canonical_ids_hash
      && mentions.governed.period_start === baseline.period_start
      && mentions.governed.period_end === baseline.period_end,
    topics_narratives: topicsNarratives.governed.row_denominator === baseline.filtered_count
      && topicsNarratives.governed.canonical_ids_hash === baseline.canonical_ids_hash
      && topicsNarratives.governed.topic_results_hash === baseline.topic_results_hash
      && topicsNarratives.governed.narrative_results_hash === baseline.narrative_results_hash,
    cursor_isolation: mentions.governed.cursor_valid
      && mentions.governed.cursor_overlap_count === 0,
    taxonomy_evidence: topicsNarratives.governed.topic_result_count === baseline.topic_result_count
      && topicsNarratives.governed.narrative_result_count === baseline.narrative_result_count
      && topicsNarratives.governed.resolved_alias_assignment_count
        === baseline.resolved_alias_assignment_count
  };
  const gatePassed = descriptor.compilation_status === "ready"
    && descriptor.blocking_reasons.length === 0
    && baseline.primary_brand_contract
    && baseline.contract_violation_count === 0
    && differences.unexplained_count === 0
    && identity.alias_membership_count === 0
    && identity.exact_brand_entity
    && identity.policy_sql_matches_memberships
    && Object.values(moduleChecks).every(Boolean);
  return {
    public_evidence: {
      contract_version: "signal-brand-draft-shadow-v1",
      read_only: true,
      transaction: "repeatable_read_read_only",
      module_key: descriptor.module_key,
      view_key: "brand",
      policy: {
        key: SIGNAL_BRAND_POLICY_KEY,
        version: SIGNAL_BRAND_POLICY_VERSION,
        definition_hash: descriptor.policy_definition_hash,
        compiled_plan_hash: descriptor.compiled_plan_hash,
        compilation_status: descriptor.compilation_status,
        blocking_reasons: descriptor.blocking_reasons
      },
      population: {
        version: descriptor.population_version,
        definition_hash: descriptor.population_definition_hash,
        membership_digest: descriptor.membership_digest
      },
      coverage,
      denominator: baseline.filtered_count,
      canonical_ids_hash: baseline.canonical_ids_hash,
      period_start: baseline.period_start,
      period_end: baseline.period_end,
      series_hash: baseline.filled_series_hash,
      module_checks: moduleChecks,
      legacy_differences: {
        legacy_only_count: differences.legacy_only_count,
        governed_only_count: differences.governed_only_count,
        explained_legacy_count: differences.explained_legacy_count,
        unexplained_count: differences.unexplained_count,
        legacy_only_by_reason: differences.legacy_only_by_reason,
        governed_only_by_reason: differences.governed_only_by_reason
      },
      invariants: {
        canonical_root_deduped: identity.alias_membership_count === 0
          && baseline.contract_violation_count === 0,
        alias_memberships: identity.alias_membership_count,
        exact_brand_entity: identity.exact_brand_entity,
        policy_sql_matches_memberships: identity.policy_sql_matches_memberships,
        operational_pointer_followed: false
      },
      gate_passed: gatePassed
    },
    private_identity: {
      workspace_id: descriptor.workspace_id,
      policy_bundle_id: descriptor.policy_bundle_id,
      population_id: descriptor.population_id,
      policy_compilation_id: descriptor.policy_compilation_id,
      governance_evaluation_id: descriptor.governance_evaluation_id
    }
  };
}

async function resolveSignalBrandDraftCandidateV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  moduleKey: unknown;
  queryable: SignalServingQueryable;
}): Promise<SignalBrandDraftCandidateDescriptorV1> {
  if (args.actor.userType !== "noisia_internal" || args.workspace.subject.type !== "brand") {
    throw new Error("Draft brand shadow requires an authorized internal brand workspace.");
  }
  const moduleKey = normalizeSignalGovernedViewModuleKeyV1(args.moduleKey);
  if (!(SIGNAL_BRAND_POLICY_MODULES as readonly string[]).includes(moduleKey)) {
    throw new Error("Draft brand shadow does not support this module.");
  }
  const result = await args.queryable.query<{
    workspace_id: string;
    policy_bundle_id: string;
    policy_definition_hash: string;
    compiled_plan_hash: string;
    population_id: string;
    population_version: number;
    population_definition_hash: string;
    membership_digest: string;
    policy_compilation_id: string;
    governance_evaluation_id: string;
    compilation_status: DraftCompilationStatus;
    blocking_reasons: string[];
    actor_id: string;
    actor_user_type: string;
    definition: SignalPopulationPolicyBundleDefinitionV1;
  }>(`
    SELECT
      workspace.id::text AS workspace_id,
      bundle.id::text AS policy_bundle_id,
      bundle.definition_hash AS policy_definition_hash,
      compilation.compiled_plan_hash,
      population.id::text AS population_id,
      population.version AS population_version,
      population.definition_hash AS population_definition_hash,
      population.membership_digest,
      compilation.id::text AS policy_compilation_id,
      compilation.governance_evaluation_id::text,
      compilation.compilation_status,
      compilation.blocking_reasons,
      actor.id::text AS actor_id,
      actor.user_type AS actor_user_type,
      jsonb_build_object(
        'contract_version', '${SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION}',
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
    JOIN users actor ON actor.id = $4::uuid AND actor.user_type = 'noisia_internal'
    JOIN signal_population_policy_compilations compilation
      ON compilation.policy_bundle_id = bundle.id
     AND compilation.workspace_id = bundle.workspace_id
     AND compilation.is_current
     AND compilation.module_key = $5
     AND compilation.view_key = 'brand'
     AND (compilation.next_policy_transition_at IS NULL
       OR compilation.next_policy_transition_at > clock_timestamp())
    JOIN signal_population_definitions population
      ON population.id = compilation.population_id
     AND population.workspace_id = compilation.workspace_id
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
    WHERE bundle.workspace_id = $1::uuid
      AND bundle.policy_key = $2
      AND bundle.policy_version = $3
      AND bundle.status = 'draft'
      AND $5 = ANY(bundle.authorized_modules)
      AND population.status = 'draft'
      AND population.purpose = 'operational'
      AND population.definition->>'contract_version'
        = 'signal-governed-view-resolved-population-v1'
      AND population.definition->>'module_key' = $5
      AND population.definition->>'view_key' = 'brand'
      AND EXISTS (
        SELECT 1 FROM signal_governed_view_population_derivations derivation
        WHERE derivation.workspace_id = bundle.workspace_id
          AND derivation.module_key = $5
          AND derivation.view_key = 'brand'
          AND derivation.policy_bundle_id = bundle.id
          AND derivation.resolved_population_id = population.id
          AND derivation.policy_definition_hash = bundle.definition_hash
          AND derivation.compiled_plan_hash = compilation.compiled_plan_hash
      )
      AND compilation.policy_definition_hash = bundle.definition_hash
      AND compilation.population_version = population.version
      AND compilation.population_definition_hash = population.definition_hash
      AND compilation.membership_digest = population.membership_digest
      AND NOT EXISTS (
        SELECT 1 FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id = compilation.id
      )
    LIMIT 1
  `, [
    args.workspace.id,
    SIGNAL_BRAND_POLICY_KEY,
    SIGNAL_BRAND_POLICY_VERSION,
    args.actor.id,
    moduleKey
  ]);
  const row = result.rows[0];
  if (!row || row.workspace_id !== args.workspace.id || row.actor_id !== args.actor.id) {
    throw new Error("Draft brand policy candidate is unavailable or cross-workspace.");
  }
  const definition = validateSignalPopulationPolicyBundleDefinitionV1(row.definition);
  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: row.policy_bundle_id,
    definition_hash: row.policy_definition_hash,
    definition
  });
  const expectedModulePlanHash = signalGovernedViewCompilationPlanHashV1({
    base_plan_hash: compiled.plan_hash,
    module_key: moduleKey,
    view_key: "brand",
    authorized_modules: definition.authorized_modules,
    capability_usage_purposes: definition.required_usage_purposes
  });
  if (expectedModulePlanHash !== row.compiled_plan_hash
    || definition.allowed_entities.length !== 1
    || definition.allowed_entities[0]?.scope !== "primary_brand"
    || definition.allowed_entities[0]?.entity_type !== "brand"
    || definition.allowed_entities[0]?.entity_id !== args.workspace.subject.id) {
    throw new Error("Draft brand policy compilation is incompatible with the workspace brand.");
  }
  return { ...row, module_key: moduleKey, definition };
}

async function loadSignalBrandDraftCoverageV1(args: {
  descriptor: SignalBrandDraftCandidateDescriptorV1;
  filter: SignalFilterV1;
  queryable: SignalServingQueryable;
}): Promise<SignalCoverageDescriptorV1> {
  const qualityAvailable = args.descriptor.definition.quality_contract_status === "resolved";
  const result = await args.queryable.query<{
    captured: number;
    quality_eligible: number;
    reviewed: number;
    resolved_attributed: number;
    unattributed: number;
    used_by_view: number;
  }>(`
    WITH captured AS (
      SELECT mention.*
      FROM mentions mention
      WHERE mention.workspace_id = $1::uuid
        AND mention.canonical_mention_id = mention.id
        AND mention.inclusion_status = 'included'
        AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
        AND (mention.published_at AT TIME ZONE $4)::date <= $6::date
    ), review_state AS (
      SELECT captured.id,
        bool_or(assertion.review_status IN ('approved', 'rejected')) AS reviewed,
        bool_or(assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'eligible'
          AND assertion.scope <> 'unattributed') AS resolved_attributed,
        bool_or(assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'not_eligible'
          AND assertion.scope = 'unattributed'
          AND assertion.entity_id IS NULL) AS unattributed
      FROM captured
      LEFT JOIN signal_mention_attributions assertion
        ON assertion.workspace_id = $1::uuid
       AND assertion.mention_id = captured.id
       AND assertion.attribution_basis = 'mention_semantic'
       AND assertion.is_current
      GROUP BY captured.id
    )
    SELECT
      (SELECT count(*)::int FROM captured) AS captured,
      (SELECT count(*)::int FROM captured mention
       WHERE ($2::int IS NULL OR COALESCE(mention.quality_score, -1) >= $2::int)
         AND NOT EXISTS (
           SELECT 1 FROM unnest($7::text[]) required(flag)
           WHERE NOT (COALESCE(mention.quality_flags, '[]'::jsonb) ? required.flag)
         )
         AND NOT EXISTS (
           SELECT 1 FROM unnest($8::text[]) forbidden(flag)
           WHERE COALESCE(mention.quality_flags, '[]'::jsonb) ? forbidden.flag
         ))
        AS quality_eligible,
      (SELECT count(*)::int FROM review_state WHERE reviewed) AS reviewed,
      (SELECT count(*)::int FROM review_state WHERE resolved_attributed) AS resolved_attributed,
      (SELECT count(*)::int FROM review_state WHERE unattributed) AS unattributed,
      (SELECT count(*)::int
       FROM signal_population_memberships membership
       JOIN mentions mention ON mention.id = membership.mention_id
       WHERE membership.population_id = $3::uuid
         AND membership.workspace_id = $1::uuid
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL
         AND (mention.published_at AT TIME ZONE $4)::date >= $5::date
         AND (mention.published_at AT TIME ZONE $4)::date <= $6::date)
        AS used_by_view
  `, [
    args.descriptor.workspace_id,
    args.descriptor.definition.min_quality_score,
    args.descriptor.population_id,
    args.filter.timezone,
    args.filter.date_range.start,
    args.filter.date_range.end,
    args.descriptor.definition.required_quality_flags,
    args.descriptor.definition.forbidden_quality_flags
  ]);
  const row = result.rows[0]!;
  const available = (count: number) => ({ availability: "available" as const, count });
  const unavailable = { availability: "not_available" as const, count: null };
  return validateSignalCoverageDescriptorV1({
    state: "partial",
    captured: available(row.captured),
    quality_eligible: qualityAvailable ? available(row.quality_eligible) : unavailable,
    unreviewed: available(row.captured - row.reviewed),
    reviewed: available(row.reviewed),
    resolved_attributed: available(row.resolved_attributed),
    // 0064 does not persist abstention as a distinct semantic decision.
    abstained: unavailable,
    unattributed: available(row.unattributed),
    used_by_view: available(row.used_by_view)
  });
}

async function loadSignalBrandDraftIdentityChecksV1(
  descriptor: SignalBrandDraftCandidateDescriptorV1,
  queryable: SignalServingQueryable
) {
  const result = await queryable.query<{
    alias_membership_count: number;
    exact_brand_entity: boolean;
    policy_sql_matches_memberships: boolean;
  }>(`
    WITH expected AS (
      SELECT item.mention_id AS id
      FROM signal_data_governance_evaluation_items item
      WHERE item.evaluation_id = $5::uuid
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
    )
    SELECT
      (SELECT count(*)::int FROM actual
       JOIN mentions mention ON mention.id = actual.id
       WHERE mention.canonical_mention_id <> mention.id) AS alias_membership_count,
      (SELECT count(*) = 1
       FROM signal_population_policy_entities entity
       WHERE entity.policy_bundle_id = $4::uuid
         AND entity.workspace_id = $1::uuid
         AND entity.scope = 'primary_brand'
         AND entity.entity_type = 'brand'
         AND entity.entity_id = $2::uuid) AS exact_brand_entity,
      NOT EXISTS (
        (SELECT id FROM expected EXCEPT SELECT id FROM actual)
        UNION ALL
        (SELECT id FROM actual EXCEPT SELECT id FROM expected)
      ) AS policy_sql_matches_memberships
  `, [
    descriptor.workspace_id,
    descriptor.definition.allowed_entities[0]!.entity_id,
    descriptor.population_id,
    descriptor.policy_bundle_id,
    descriptor.governance_evaluation_id
  ]);
  return result.rows[0]!;
}
