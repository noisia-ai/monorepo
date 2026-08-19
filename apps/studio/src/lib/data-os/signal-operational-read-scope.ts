import {
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
  SignalBackendContractError,
  buildSignalMentionReadPredicateV1,
  buildSignalPopulationMentionReadPredicateV1,
  resolveSignalOperationalReadModeV1,
  type SignalFilterV1,
  type SignalOperationalReadModeV1,
  type SignalOperationalReadScopeDescriptorV1
} from "@noisia/query-engine";

import { isUndefinedTableError } from "@/lib/db/errors";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceCorpus
} from "@/lib/data-os/signal-workspace";

export const SIGNAL_OPERATIONAL_READ_MODE_ENV =
  "NOISIA_SIGNAL_OPERATIONAL_READ_MODE" as const;

export type SignalOperationalPopulationV1 = NonNullable<
  SignalOperationalReadScopeDescriptorV1["population"]
> & {
  quality_contract_status: "resolved" | "not_available";
  quality_policy_key: string | null;
  quality_policy_version: number | null;
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
  period_start: string | null;
  period_end: string | null;
  timezone: string | null;
};

export type SignalOperationalReadScopeV1 = {
  descriptor: SignalOperationalReadScopeDescriptorV1;
  workspace: ResolvedSignalWorkspace;
  mode: SignalOperationalReadModeV1;
  visibleSource: "legacy_corpus" | "governed_population";
  legacyCorpus: SignalWorkspaceCorpus | null;
  population: SignalOperationalPopulationV1 | null;
};

type SignalOperationalScopeQueryable = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

export function signalOperationalReadMode(
  env: Record<string, string | undefined> = process.env
) {
  return resolveSignalOperationalReadModeV1(
    env[SIGNAL_OPERATIONAL_READ_MODE_ENV]
  );
}

export async function resolveSignalOperationalReadScopeV1(
  workspace: ResolvedSignalWorkspace,
  options: {
    mode?: SignalOperationalReadModeV1;
    queryable?: SignalOperationalScopeQueryable;
  } = {}
): Promise<SignalOperationalReadScopeV1> {
  const mode = options.mode ?? signalOperationalReadMode();
  const legacyCorpus = resolveLegacyServingCorpus(workspace, mode);
  let population: SignalOperationalPopulationV1 | null;
  try {
    population = await loadCurrentOperationalPopulation(workspace.id, options.queryable);
  } catch (error) {
    // Legacy serving must remain usable before the additive workspace data-plane
    // migrations are applied. In that state there is no governed population to
    // shadow yet, but the existing corpus is still a valid client-visible source.
    if (mode !== "legacy" || !isUndefinedTableError(error)) throw error;
    population = null;
  }

  if (mode !== "legacy" && !population) {
    throw new SignalBackendContractError(
      "not_available",
      "Workspace has no active governed operational population.",
      { reason: "operational_population_not_available", read_mode: mode }
    );
  }
  if (population && !isPrimaryBrandPopulation(population)) {
    if (mode !== "legacy") {
      throw new SignalBackendContractError(
        "not_available",
        "The active operational population is not client-safe.",
        {
          reason: "operational_population_contract_invalid",
          read_mode: mode
        }
      );
    }
  }

  const visibleSource = mode === "governed"
    ? "governed_population" as const
    : "legacy_corpus" as const;
  if (visibleSource === "legacy_corpus" && !legacyCorpus) {
    throw new SignalBackendContractError(
      "not_available",
      "Workspace has no unambiguous legacy serving corpus.",
      { reason: "legacy_serving_corpus_not_available", read_mode: mode }
    );
  }

  return {
    descriptor: {
      contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
      workspace_id: workspace.id,
      mode,
      visible_source: visibleSource,
      policy_key: "operational-primary-brand",
      population: population ? {
        id: population.id,
        key: population.key,
        version: population.version,
        definition_hash: population.definition_hash,
        acceptance_status: population.acceptance_status,
        allowed_scopes: population.allowed_scopes
      } : null,
      legacy_corpus_id: legacyCorpus?.id ?? null
    },
    workspace,
    mode,
    visibleSource,
    legacyCorpus,
    population
  };
}

export function buildSignalOperationalMentionReadPredicateV1(
  scope: SignalOperationalReadScopeV1,
  filter: SignalFilterV1
) {
  if (scope.visibleSource === "governed_population") {
    if (!scope.population) {
      throw new SignalBackendContractError(
        "not_available",
        "Governed serving requires an active operational population.",
        { reason: "operational_population_not_available" }
      );
    }
    if (filter.dimensions.corpus_scope?.length) {
      throw new SignalBackendContractError(
        "unsupported_dimension",
        "Operational scope is resolved server-side and cannot be selected by the client.",
        { field: "dimension.corpus_scope", policy_key: scope.descriptor.policy_key }
      );
    }
    return buildSignalPopulationMentionReadPredicateV1(
      filter,
      scope.population.id,
      scope.workspace.id
    );
  }
  if (!scope.legacyCorpus) {
    throw new SignalBackendContractError(
      "not_available",
      "Legacy serving requires an operational corpus.",
      { reason: "legacy_serving_corpus_not_available" }
    );
  }
  return buildSignalMentionReadPredicateV1(
    filter,
    [scope.legacyCorpus.id],
    scope.workspace.id
  );
}

export function operationalMaterializationScopeV1(
  scope: SignalOperationalReadScopeV1
) {
  if (scope.visibleSource === "governed_population") {
    if (!scope.population) {
      throw new SignalBackendContractError(
        "not_available",
        "Governed materialization requires an active population."
      );
    }
    return {
      kind: "governed_population" as const,
      population_id: scope.population.id,
      population_version: scope.population.version,
      population_definition_hash: scope.population.definition_hash
    };
  }
  if (!scope.legacyCorpus) {
    throw new SignalBackendContractError(
      "not_available",
      "Legacy materialization requires an operational corpus."
    );
  }
  return {
    kind: "legacy_corpus" as const,
    study_corpus_id: scope.legacyCorpus.id
  };
}

export function requireSignalOperationalReadScopeV1(
  workspace: ResolvedSignalWorkspace,
  scope?: SignalOperationalReadScopeV1
) {
  if (scope) {
    if (scope.workspace.id !== workspace.id || scope.descriptor.workspace_id !== workspace.id) {
      throw new SignalBackendContractError(
        "invalid_filter",
        "Operational read scope does not belong to this workspace.",
        { reason: "operational_read_scope_workspace_mismatch" }
      );
    }
    return scope;
  }
  const configuredMode = signalOperationalReadMode();
  if (configuredMode !== "legacy") {
    throw new SignalBackendContractError(
      "not_available",
      "Operational read scope must be resolved at the authenticated workspace boundary.",
      { reason: "operational_read_scope_not_resolved", read_mode: configuredMode }
    );
  }
  const legacyCorpus = resolveLegacyServingCorpus(workspace, "legacy");
  if (!legacyCorpus) {
    throw new SignalBackendContractError(
      "not_available",
      "Workspace has no unambiguous legacy serving corpus.",
      { reason: "legacy_serving_corpus_not_available", read_mode: "legacy" }
    );
  }
  return {
    descriptor: {
      contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
      workspace_id: workspace.id,
      mode: "legacy",
      visible_source: "legacy_corpus",
      policy_key: "operational-primary-brand",
      population: null,
      legacy_corpus_id: legacyCorpus.id
    },
    workspace,
    mode: "legacy",
    visibleSource: "legacy_corpus",
    legacyCorpus,
    population: null
  } satisfies SignalOperationalReadScopeV1;
}

export function governedSignalOperationalReadScopeV1(
  scope: SignalOperationalReadScopeV1
) {
  if (!scope.population) {
    throw new SignalBackendContractError(
      "not_available",
      "Shadow comparison requires an active governed population.",
      { reason: "operational_population_not_available" }
    );
  }
  return {
    ...scope,
    mode: "governed",
    visibleSource: "governed_population",
    descriptor: {
      ...scope.descriptor,
      mode: "governed",
      visible_source: "governed_population"
    }
  } satisfies SignalOperationalReadScopeV1;
}

export async function resolveOperationalWorkspacePopulation(workspaceId: string) {
  const population = await loadCurrentOperationalPopulation(workspaceId);
  if (!population) {
    throw new Error("Workspace has no governed operational population.");
  }
  return {
    id: population.id,
    population_key: population.key,
    version: population.version,
    definition_hash: population.definition_hash,
    acceptance_status: population.acceptance_status,
    allowed_scopes: population.allowed_scopes,
    min_quality_score: population.min_quality_score,
    period_start: population.period_start,
    period_end: population.period_end
  };
}

async function loadCurrentOperationalPopulation(
  workspaceId: string,
  queryable?: SignalOperationalScopeQueryable
) {
  const resolvedQueryable = queryable ?? (await import("@/lib/db")).pool;
  const result = await resolvedQueryable.query<{
    id: string;
    population_key: string;
    version: number;
    definition_hash: string;
    acceptance_status: "included";
    allowed_scopes: string[];
    min_quality_score: number | null;
    period_start: string | null;
    period_end: string | null;
  }>(`
    SELECT
      definition.id::text,
      definition.population_key,
      definition.version,
      definition.definition_hash,
      definition.acceptance_status,
      definition.allowed_scopes,
      definition.min_quality_score,
      definition.period_start::text,
      definition.period_end::text
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition
      ON definition.id = pointer.population_id
     AND definition.workspace_id = pointer.workspace_id
    WHERE pointer.workspace_id = $1::uuid
      AND pointer.purpose = 'operational'
      AND definition.status = 'active'
    LIMIT 1
  `, [workspaceId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    key: row.population_key,
    version: row.version,
    definition_hash: row.definition_hash,
    acceptance_status: row.acceptance_status,
    allowed_scopes: row.allowed_scopes as ["primary_brand"],
    quality_contract_status: "not_available" as const,
    quality_policy_key: null,
    quality_policy_version: null,
    min_quality_score: row.min_quality_score,
    required_quality_flags: [],
    forbidden_quality_flags: [],
    period_start: row.period_start,
    period_end: row.period_end,
    timezone: null
  };
}

function isPrimaryBrandPopulation(population: SignalOperationalPopulationV1) {
  return population.acceptance_status === "included"
    && population.allowed_scopes.length === 1
    && population.allowed_scopes[0] === "primary_brand"
    && population.version >= 1
    && population.definition_hash.length > 0;
}

function resolveLegacyServingCorpus(
  workspace: ResolvedSignalWorkspace,
  mode: SignalOperationalReadModeV1
) {
  const operational = workspace.corpora.filter((item) => item.role === "operational");
  if (operational.length > 1) {
    throw new SignalBackendContractError(
      "not_available",
      "Signal workspace has an ambiguous operational corpus.",
      { reason: "multiple_active_operational_corpora", read_mode: mode }
    );
  }
  if (operational.length === 1) return operational[0]!;
  const legacy = workspace.corpora.filter((item) => item.role === "legacy");
  if (legacy.length > 1) {
    throw new SignalBackendContractError(
      "not_available",
      "Signal workspace has an ambiguous legacy fallback corpus.",
      { reason: "multiple_active_legacy_corpora", read_mode: mode }
    );
  }
  return legacy[0] ?? null;
}
