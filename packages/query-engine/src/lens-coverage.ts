export type EngineQueryPackEntityStat = {
  id?: string | null;
  name?: string | null;
  entityKind?: string | null;
  isCategoryBaseline?: boolean | null;
  includedCount?: number | null;
};

export type EngineQueryPackBatchStat = {
  queryPackId?: string | null;
  corpusEntityId?: string | null;
  entityKind?: string | null;
  entityLabel?: string | null;
  mentionType?: string | null;
  includedCount?: number | null;
  status?: string | null;
};

export type EngineQueryPackStat = {
  id?: string | null;
  lensSlug?: string | null;
  signalIntent?: string | null;
  scope?: string | null;
  status?: string | null;
  mentionsReturned?: number | null;
  linkedMentionCount?: number | null;
  directMentionCount?: number | null;
  sharedMentionCount?: number | null;
};

export type EngineQueryPackCoverageInput = {
  brandId?: string | null;
  themeId?: string | null;
  baseCorpusId?: string | null;
  entities?: EngineQueryPackEntityStat[];
  importBatches?: EngineQueryPackBatchStat[];
  queryPacks?: EngineQueryPackStat[];
};

export type EngineQueryPackScopeCoverage = {
  scope: string;
  required: boolean;
  packCount: number;
  importedPackCount: number;
  directImportedPackCount: number;
  completedBatchCount: number;
  mentionCount: number;
  directMentionCount: number;
  sharedMentionCount: number;
  status: "ready" | "low_coverage" | "empty" | "missing" | "planned";
};

export type EngineQueryPackValidation = {
  ok: boolean;
  status: "ready" | "directional" | "blocked";
  methodologySlug: string;
  requirement: Record<string, unknown> | null;
  summary: {
    totalIncluded: number;
    comparableEntities: number;
    competitors: number;
    categorySignals: number;
    minComparableMentions: number;
    requiredScopes: string[];
    importedScopes: string[];
    missingScopes: string[];
    scopeCoverage: EngineQueryPackScopeCoverage[];
  };
  hardFailures: string[];
  warnings: string[];
};

const PRIMARY_METHODOLOGY_SLUG = "triggers-barriers";
const comparableEntityKinds = new Set(["primary_brand", "competitor", "competitor_pool", "category"]);

export const lensQueryPackRequirements: Record<string, Record<string, unknown>> = {
  [PRIMARY_METHODOLOGY_SLUG]: {
    validation_level: "active_pipeline",
    requires_competitors: false,
    min_mentions_per_entity: 0,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["triggers", "barriers", "experience", "noise"],
    charts_expected: ["tb_decision_field", "tb_comparative_dashboard"]
  },
  "signal-pulse": {
    validation_level: "required_for_lens",
    requires_competitors: false,
    min_mentions_per_entity: 100,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["marketing_signal", "trend", "risk", "move"],
    charts_expected: ["impact_polarity", "momentum_stream", "coverage_strip", "galaxy_layout"]
  },
  "narrative-ownership": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 150,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["narrative", "valence"],
    charts_expected: ["stacked_share", "matrix_2x2", "bar_ranking"]
  },
  "value-perception-matrix": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 120,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["value_benefit", "value_cost", "perceived_value"],
    charts_expected: ["heatmap", "matrix_2x2", "bar_ranking", "evidence_list"]
  },
  "brand-positioning-map": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 120,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["axis_x", "axis_y", "perceived_position", "distance_to_ideal"],
    charts_expected: ["matrix_2x2", "radar", "bar_ranking", "evidence_list"]
  },
  "category-opportunity-map": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 100,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["demand_theme", "coverage_gap", "urgency", "capturability"],
    charts_expected: ["bubble_field", "bar_ranking", "matrix_2x2", "evidence_list"]
  },
  "white-space-analysis": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 120,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["space", "need_state", "brand_coverage", "competitor_coverage"],
    charts_expected: ["bubble_field", "matrix_2x2", "bar_ranking", "evidence_list"]
  },
  "journey-friction-mapping": {
    validation_level: "required_for_lens",
    requires_competitors: false,
    min_mentions_per_entity: 80,
    required_scopes: ["brand", "category"],
    required_dimensions: ["journey_phase", "friction_type", "visibility", "polarity"],
    charts_expected: ["heatmap", "waterfall", "bar_ranking", "evidence_list"]
  },
  "decision-velocity": {
    validation_level: "required_for_lens",
    requires_competitors: false,
    min_mentions_per_entity: 100,
    required_scopes: ["brand", "category"],
    required_dimensions: ["journey_stage", "blocker", "accelerator", "velocity_effect"],
    charts_expected: ["timeline", "waterfall", "heatmap", "evidence_list"]
  },
  "cultural-codes-decoding": {
    validation_level: "required_for_lens",
    requires_competitors: false,
    min_mentions_per_entity: 80,
    required_scopes: ["brand", "category"],
    required_dimensions: ["code", "tension", "symbol", "category_meaning"],
    charts_expected: ["tension_card", "heatmap", "bar_ranking", "evidence_list"]
  },
  "sentiment-advocacy-proxy": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 120,
    required_scopes: ["brand", "competitors"],
    required_dimensions: ["sentiment", "emotional_intensity", "theme", "advocacy_class"],
    charts_expected: ["diverging_bar", "stacked_share", "timeline", "evidence_list"]
  },
  "trust-risk-benchmark": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 120,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["trust_driver", "risk_theme", "severity", "escalating"],
    charts_expected: ["gauge", "diverging_bar", "timeline", "evidence_list"]
  },
  "competitive-wave": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 150,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["axis_x", "axis_y", "entity_score", "wave_position"],
    charts_expected: ["wave_plot", "bar_ranking", "confidence_badge"]
  },
  "audience-segment-lens": {
    validation_level: "required_for_lens",
    requires_competitors: false,
    min_mentions_per_entity: 80,
    required_scopes: ["brand", "category"],
    required_dimensions: ["segment", "signal_skew", "need_state", "source_metadata"],
    charts_expected: ["heatmap", "stacked_share", "bar_ranking", "evidence_list"]
  },
  "influence-architecture": {
    validation_level: "required_for_lens",
    requires_competitors: true,
    min_mentions_per_entity: 150,
    required_scopes: ["brand", "competitors", "category"],
    required_dimensions: ["node", "community", "influence_role", "flow"],
    charts_expected: ["force_graph", "bar_ranking", "sankey_flow", "evidence_list"]
  },
  "evidence-confidence-layer": {
    validation_level: "required_for_lens",
    requires_competitors: false,
    min_mentions_per_entity: 1,
    required_scopes: ["brand"],
    required_dimensions: ["evidence_quality", "source_diversity", "claim_strength"],
    charts_expected: ["confidence_badge", "bar_ranking", "evidence_list"]
  }
};

export function queryPackRequirementForLens(slug: string) {
  return lensQueryPackRequirements[slug] ?? null;
}

export function validateEngineQueryPackCoverage(
  methodologySlug: string,
  coverage: EngineQueryPackCoverageInput
): EngineQueryPackValidation {
  const requirement = queryPackRequirementForLens(methodologySlug);
  if (!requirement || requirement.validation_level !== "required_for_lens") {
    return {
      ok: true,
      status: "ready",
      methodologySlug,
      requirement,
      summary: {
        totalIncluded: totalIncludedMentions(coverage),
        comparableEntities: 0,
        competitors: 0,
        categorySignals: 0,
        minComparableMentions: 0,
        requiredScopes: [],
        importedScopes: [],
        missingScopes: [],
        scopeCoverage: []
      },
      hardFailures: [],
      warnings: []
    };
  }

  const minMentions = numberFromRequirement(requirement.min_mentions_per_entity);
  const requiresCompetitors = requirement.requires_competitors === true;
  const hasDirectnessSignals = hasDirectnessTracking(coverage);
  const requiredScopes = arrayFromRequirement(requirement.required_scopes)
    .filter((scope) => !(scope === "brand" && coverage.themeId && !coverage.brandId));
  const scopeCoverage = buildScopeCoverage(methodologySlug, requiredScopes, coverage, minMentions);
  const importedScopes = scopeCoverage
    .filter((scope) => scope.importedPackCount > 0 && scope.mentionCount > 0)
    .map((scope) => scope.scope);
  const missingScopes = scopeCoverage
    .filter((scope) => scope.required && (scope.status === "missing" || scope.status === "planned"))
    .map((scope) => scope.scope);
  const emptyRequiredScopes = scopeCoverage
    .filter((scope) => scope.required && scope.status === "empty")
    .map((scope) => scope.scope);
  const lowScopeCoverage = scopeCoverage
    .filter((scope) => scope.required && scope.status === "low_coverage")
    .map((scope) => `${scope.scope} (${scope.mentionCount})`);
  const entityCounts = mergedEntityCounts(coverage, methodologySlug);
  const comparableEntities = entityCounts.filter((entity) => {
    if (entity.includedCount <= 0) return false;
    if (entity.isCategoryBaseline) return false;
    return comparableEntityKinds.has(entity.entityKind);
  });
  const competitors = comparableEntities.filter((entity) => entity.entityKind === "competitor" || entity.entityKind === "competitor_pool");
  const categorySignals = entityCounts.filter((entity) => {
    return entity.includedCount > 0 &&
      (entity.entityKind === "category" || entity.isCategoryBaseline || entity.scope === "category" || entity.scope === "industry");
  });
  const totalIncluded = totalIncludedMentions(coverage);
  const minComparableMentions = comparableEntities.length
    ? Math.min(...comparableEntities.map((entity) => entity.includedCount))
    : 0;

  const hardFailures: string[] = [];
  const warnings: string[] = [];

  if (totalIncluded <= 0) {
    hardFailures.push("El corpus no tiene menciones incluidas para correr el lente.");
  }

  if (requiresCompetitors && comparableEntities.length < 2) {
    hardFailures.push("El lente necesita al menos 2 entidades atribuidas entre marca, competidores o peers de categoria.");
  }

  if (requiresCompetitors && competitors.length === 0 && coverage.brandId) {
    hardFailures.push("El lente necesita al menos un competidor/peer atribuido para comparar contra la marca.");
  }

  if (requiredScopes.includes("category") && categorySignals.length === 0 && !coverage.baseCorpusId) {
    const categoryScope = scopeCoverage.find((scope) => scope.scope === "category");
    if (!categoryScope || categoryScope.mentionCount <= 0) {
      warnings.push("No hay baseline/categoria atribuida; el lente puede correr, pero sus conclusiones quedan direccionales.");
    }
  }

  if (missingScopes.length > 0) {
    hardFailures.push(
      `Faltan query packs importados para este lente: ${missingScopes.join(", ")}. Genera/sube CSVs desde los modulos del Engine antes de correr analisis.`
    );
  }

  if (emptyRequiredScopes.length > 0) {
    hardFailures.push(
      `Los query packs importados no tienen menciones incluidas para estos scopes: ${emptyRequiredScopes.join(", ")}. Revisa el CSV o vuelve a exportar antes de correr analisis.`
    );
  }

  if (minMentions > 0 && comparableEntities.some((entity) => entity.includedCount < minMentions)) {
    warnings.push(`Al menos una entidad tiene menos de ${minMentions} menciones incluidas; readiness debe degradar a directional.`);
  }

  if (lowScopeCoverage.length > 0) {
    warnings.push(`Scopes con menos de ${minMentions} menciones para este lente: ${lowScopeCoverage.join(", ")}.`);
  }

  const sharedOnlyScopes = scopeCoverage
    .filter((scope) => scope.required && scope.mentionCount > 0 && scope.directMentionCount <= 0)
    .map((scope) => scope.scope);
  if (hasDirectnessSignals && sharedOnlyScopes.length > 0) {
    warnings.push(
      `Estos scopes tienen data compartida por provenance, pero no CSV directo del pack: ${sharedOnlyScopes.join(", ")}. Puede correr como direccional, pero QA debe validar que las queries específicas del lente no quedaron sin export.`
    );
  }

  if (coverage.importBatches?.length && !coverage.importBatches.some((batch) => batch.status === "completed")) {
    warnings.push("No hay import batches completados; revisar carga/CSV antes de publicar.");
  }

  const status = hardFailures.length > 0
    ? "blocked"
    : warnings.length > 0
      ? "directional"
      : "ready";

  return {
    ok: hardFailures.length === 0,
    status,
    methodologySlug,
    requirement,
    summary: {
      totalIncluded,
      comparableEntities: comparableEntities.length,
      competitors: competitors.length,
      categorySignals: categorySignals.length + (coverage.baseCorpusId ? 1 : 0),
      minComparableMentions,
      requiredScopes,
      importedScopes,
      missingScopes,
      scopeCoverage
    },
    hardFailures,
    warnings
  };
}

function buildScopeCoverage(
  methodologySlug: string,
  requiredScopes: string[],
  coverage: EngineQueryPackCoverageInput,
  minMentions: number
): EngineQueryPackScopeCoverage[] {
  const completedBatchPackIds = new Set(
    (coverage.importBatches ?? [])
      .filter((batch) => batch.status === "completed" && batch.queryPackId)
      .map((batch) => batch.queryPackId as string)
  );
  const batchesByPackId = new Map<string, { completed: number; mentions: number }>();
  for (const batch of coverage.importBatches ?? []) {
    if (!batch.queryPackId) continue;
    const current = batchesByPackId.get(batch.queryPackId) ?? { completed: 0, mentions: 0 };
    if (batch.status === "completed") {
      current.completed += 1;
      current.mentions += Math.max(0, Number(batch.includedCount ?? 0));
    }
    batchesByPackId.set(batch.queryPackId, current);
  }

  const scopes = new Map<string, EngineQueryPackScopeCoverage>();
  function ensure(scopeValue: unknown, required: boolean) {
    const scope = normalizeScope(scopeValue);
    if (!scope) return null;
    const current = scopes.get(scope) ?? {
      scope,
      required,
      packCount: 0,
      importedPackCount: 0,
      directImportedPackCount: 0,
      completedBatchCount: 0,
      mentionCount: 0,
      directMentionCount: 0,
      sharedMentionCount: 0,
      status: required ? "missing" : "planned"
    } satisfies EngineQueryPackScopeCoverage;
    current.required = current.required || required;
    scopes.set(scope, current);
    return current;
  }

  for (const scope of requiredScopes) ensure(scope, true);

  for (const pack of coverage.queryPacks ?? []) {
    if (pack.lensSlug !== methodologySlug) continue;
    const row = ensure(pack.scope, requiredScopes.includes(String(normalizeScope(pack.scope) ?? "")));
    if (!row) continue;
    const batchStats = pack.id ? batchesByPackId.get(pack.id) : null;
    const directMentions = Math.max(
      Number(pack.directMentionCount ?? 0),
      batchStats?.mentions ?? 0
    );
    const sharedMentions = Math.max(0, Number(pack.sharedMentionCount ?? 0));
    const provenanceMentions = Math.max(
      Number(pack.linkedMentionCount ?? 0),
      directMentions + sharedMentions
    );
    const mentions = provenanceMentions > 0
      ? provenanceMentions
      : Number(pack.mentionsReturned ?? 0);
    const imported = mentions > 0 || pack.status === "imported" || pack.status === "approved" || (pack.id ? completedBatchPackIds.has(pack.id) : false);
    row.packCount += 1;
    row.importedPackCount += imported ? 1 : 0;
    row.directImportedPackCount += directMentions > 0 || (pack.id ? completedBatchPackIds.has(pack.id) : false) ? 1 : 0;
    row.completedBatchCount += batchStats?.completed ?? 0;
    row.mentionCount += mentions;
    row.directMentionCount += directMentions;
    row.sharedMentionCount += Math.max(0, mentions - directMentions);
  }

  for (const row of scopes.values()) {
    row.status = scopeStatus(row, minMentions);
  }

  return Array.from(scopes.values()).sort((a, b) => scopeSort(a.scope) - scopeSort(b.scope));
}

function mergedEntityCounts(coverage: EngineQueryPackCoverageInput, methodologySlug: string) {
  const counts = new Map<string, {
    entityKind: string;
    includedCount: number;
    isCategoryBaseline: boolean;
    scope: string | null;
  }>();

  for (const entity of coverage.entities ?? []) {
    const entityKind = normalizeEntityKind(entity.entityKind);
    const key = entity.id || `${entityKind}:${entity.name ?? ""}`;
    if (!key) continue;
    counts.set(key, {
      entityKind,
      includedCount: Math.max(0, Number(entity.includedCount ?? 0)),
      isCategoryBaseline: entity.isCategoryBaseline === true,
      scope: entityKind
    });
  }

  for (const batch of coverage.importBatches ?? []) {
    const includedCount = Math.max(0, Number(batch.includedCount ?? 0));
    if (includedCount <= 0) continue;
    const entityKind = normalizeEntityKind(batch.entityKind ?? batch.mentionType);
    const key = batch.corpusEntityId || `${entityKind}:${batch.entityLabel ?? batch.mentionType ?? "batch"}`;
    const current = counts.get(key);
    counts.set(key, {
      entityKind: current?.entityKind ?? entityKind,
      includedCount: current && batch.corpusEntityId
        ? Math.max(current.includedCount, includedCount)
        : (current?.includedCount ?? 0) + includedCount,
      isCategoryBaseline: current?.isCategoryBaseline ?? entityKind === "category",
      scope: normalizeScope(batch.mentionType ?? batch.entityKind)
    });
  }

  const queryPackIdsWithCompletedBatches = new Set(
    (coverage.importBatches ?? [])
      .filter((batch) => batch.status === "completed" && batch.queryPackId)
      .map((batch) => batch.queryPackId as string)
  );

  for (const pack of coverage.queryPacks ?? []) {
    if (pack.lensSlug !== methodologySlug) continue;
    if (pack.id && queryPackIdsWithCompletedBatches.has(pack.id)) continue;
    const includedCount = Math.max(
      0,
      Number(pack.mentionsReturned ?? 0),
      Number(pack.linkedMentionCount ?? 0)
    );
    if (includedCount <= 0) continue;
    const scope = normalizeScope(pack.scope);
    if (countsAlreadyCoverScope(counts, scope)) continue;
    const entityKind = scope === "competitors"
      ? "competitor_pool"
      : scope === "category"
        ? "category"
        : scope === "brand"
          ? "primary_brand"
          : "category";
    const key = `query-pack:${methodologySlug}:${scope}`;
    const current = counts.get(key);
    counts.set(key, {
      entityKind,
      includedCount: (current?.includedCount ?? 0) + includedCount,
      isCategoryBaseline: entityKind === "category",
      scope
    });
  }

  return Array.from(counts.values());
}

function totalIncludedMentions(coverage: EngineQueryPackCoverageInput) {
  const batchTotal = (coverage.importBatches ?? [])
    .filter((batch) => !batch.status || batch.status === "completed")
    .reduce((sum, batch) => sum + Math.max(0, Number(batch.includedCount ?? 0)), 0);
  if (batchTotal > 0) return batchTotal;
  const entityTotal = (coverage.entities ?? [])
    .reduce((sum, entity) => sum + Math.max(0, Number(entity.includedCount ?? 0)), 0);
  if (entityTotal > 0) return entityTotal;
  return (coverage.queryPacks ?? [])
    .reduce((sum, pack) => sum + Math.max(0, Number(pack.mentionsReturned ?? 0), Number(pack.linkedMentionCount ?? 0)), 0);
}

function numberFromRequirement(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function hasDirectnessTracking(coverage: EngineQueryPackCoverageInput) {
  if ((coverage.importBatches ?? []).some((batch) => batch.queryPackId)) return true;
  return (coverage.queryPacks ?? []).some((pack) =>
    pack.directMentionCount !== undefined || pack.sharedMentionCount !== undefined
  );
}

function arrayFromRequirement(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeEntityKind(value: unknown) {
  const kind = String(value ?? "").toLowerCase();
  if (kind === "brand") return "primary_brand";
  if (kind === "industry" || kind === "baseline") return "category";
  if (kind === "competitors") return "competitor_pool";
  if (kind === "unknown" || !kind) return "category";
  return kind;
}

function normalizeScope(value: unknown) {
  const scope = String(value ?? "").toLowerCase();
  if (scope === "industry") return "category";
  if (!scope || scope === "unknown") return null;
  return scope;
}

function countsAlreadyCoverScope(
  counts: Map<string, { entityKind: string; includedCount: number; isCategoryBaseline: boolean; scope: string | null }>,
  scope: string | null
) {
  if (!scope) return false;
  return Array.from(counts.values()).some((entity) => {
    if (entity.includedCount <= 0) return false;
    if (scope === "brand") return entity.entityKind === "primary_brand" || entity.entityKind === "brand";
    if (scope === "competitors") return entity.entityKind === "competitor" || entity.entityKind === "competitor_pool";
    if (scope === "category") return entity.entityKind === "category" || entity.isCategoryBaseline;
    return entity.scope === scope;
  });
}

function scopeStatus(scope: EngineQueryPackScopeCoverage, minMentions: number): EngineQueryPackScopeCoverage["status"] {
  if (scope.packCount === 0) return "missing";
  if (scope.importedPackCount === 0) return "planned";
  if (scope.mentionCount <= 0) return "empty";
  if (minMentions > 0 && scope.mentionCount < minMentions) return "low_coverage";
  return "ready";
}

function scopeSort(scope: string) {
  if (scope === "brand") return 1;
  if (scope === "competitors") return 2;
  if (scope === "category") return 3;
  if (scope === "baseline") return 4;
  return 9;
}
