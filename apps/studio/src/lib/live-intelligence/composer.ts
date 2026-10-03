export type ComposerRow = {
  canonical_signal_id: string;
  methodology_slug: string;
  signal_type: string;
  semantic_key?: string | null;
  canonical_title: string;
  signal_status: string;
  dimensions: Record<string, unknown>;
  observation_id: string | null;
  frequency: number | null;
  share_pct: string | null;
  intensity: string | null;
  sentiment: string | null;
  composite_score: string | null;
  confidence: string | null;
  delta_vs_previous: string | null;
  evidence_count: number;
  evidence_examples?: unknown;
};

export type NormalizedComposerSignal = ReturnType<typeof normalizeComposerRow>;

export type ComposerEvidenceExample = {
  observation_id: string | null;
  mention_id: string | null;
  source_id: string | null;
  quote: string;
  platform: string | null;
  published_at: string | null;
  evidence_role: string | null;
  is_protagonist: boolean;
};

export type ComposerSelection = {
  methodologies?: string[];
  signalTypes?: string[];
  statuses?: string[];
  chartKeys?: string[];
};

export type ComposerDraft = ReturnType<typeof buildComposerDraft>;

export type ComposerLensStatusLike = {
  methodology_slug: string;
  status: string;
  engine_analysis_id?: string | null;
  current_step?: string | null;
  signals_in_range?: number;
  evidence_in_range?: number;
  message?: string | null;
  readiness?: unknown;
  quality_gates_failed?: Array<{ id: string; detail: string }>;
};

export type ComposerSignalLike = {
  canonical_signal_id: string;
  methodology_slug: string;
  signal_type?: string;
  frequency?: number;
  evidence_count?: number;
  supporting_methodologies?: string[];
  supporting_signal_ids?: string[];
  supporting_observation_ids?: string[];
  evidence_examples?: ComposerEvidenceExample[];
};

export type ComposerModuleLike = {
  methodology_slug: string;
  total_signals?: number;
  total_frequency?: number;
  evidence_count?: number;
  signal_types?: Record<string, number>;
  top_signals?: ComposerSignalLike[];
};

const SIGNAL_PULSE_COMPOSER_BLOCKERS = [
  "source_presence",
  "signal_min_evidence",
  "chart_data_available",
  "move_has_signal",
  "cost_within_budget",
  "no_invented_numbers"
];

export type ComposerEditorialState = {
  selection?: Record<string, unknown> | null;
  draft?: Record<string, unknown> | null;
} | null;

export function reusableComposerEngineAnalysisSql(alias = "live_ea") {
  return `(
    (
      ${alias}.methodology_slug = 'signal-pulse'
      AND ${alias}.status IN ('needs_review', 'approved')
      AND (
        SELECT COUNT(DISTINCT gate->>'id')::int
        FROM jsonb_array_elements(COALESCE(${alias}.meta_json->'quality_gates', '[]'::jsonb)) gate
        WHERE gate->>'id' = ANY(ARRAY[${SIGNAL_PULSE_COMPOSER_BLOCKERS.map((gate) => `'${gate}'`).join(", ")}])
          AND gate->>'passed' = 'true'
      ) = ${SIGNAL_PULSE_COMPOSER_BLOCKERS.length}
    )
    OR (
      ${alias}.methodology_slug <> 'signal-pulse'
      AND CASE
        WHEN COALESCE(${alias}.meta_json->'retrieval'->>'retrieved_units', '') ~ '^[0-9]+$'
        THEN (${alias}.meta_json->'retrieval'->>'retrieved_units')::int
        ELSE 0
      END > 0
      AND ${alias}.meta_json->'engine_coding'->>'provider' = 'anthropic'
      AND COALESCE((${alias}.meta_json->'engine_coding'->>'fixture')::boolean, true) = false
    )
  )`;
}

export function normalizeComposerRow(row: ComposerRow) {
  return {
    canonical_signal_id: row.canonical_signal_id,
    methodology_slug: row.methodology_slug,
    signal_type: row.signal_type,
    semantic_key: row.semantic_key ?? null,
    title: row.canonical_title,
    status: row.signal_status,
    frequency: numberValue(row.frequency),
    share_pct: nullableNumber(row.share_pct),
    intensity: nullableNumber(row.intensity),
    sentiment: nullableNumber(row.sentiment),
    composite_score: nullableNumber(row.composite_score),
    confidence: row.confidence,
    delta_vs_previous: nullableNumber(row.delta_vs_previous),
    evidence_count: row.evidence_count,
    dimensions: row.dimensions ?? {},
    supporting_methodologies: [row.methodology_slug],
    supporting_signal_types: [row.signal_type],
    supporting_signal_ids: [row.canonical_signal_id],
    supporting_observation_ids: row.observation_id ? [row.observation_id] : [],
    supporting_signal_count: 1,
    supporting_evidence_count: row.evidence_count,
    evidence_examples: normalizeEvidenceExamples(row.evidence_examples)
  };
}

export function filterComposerSignals(rows: NormalizedComposerSignal[], selection: ComposerSelection = {}) {
  const methodologySet = normalizedSet(selection.methodologies);
  const signalTypeSet = normalizedSet(selection.signalTypes);
  const statusSet = normalizedSet(selection.statuses);

  return rows.filter((row) => {
    if (methodologySet.size > 0 && !methodologySet.has(normalizeToken(row.methodology_slug))) return false;
    if (signalTypeSet.size > 0 && !signalTypeSet.has(normalizeToken(row.signal_type))) return false;
    if (statusSet.size > 0 && !statusSet.has(normalizeToken(row.status))) return false;
    return true;
  });
}

export function dedupeComposerSignals(rows: NormalizedComposerSignal[]) {
  const groups = new Map<string, NormalizedComposerSignal[]>();
  for (const row of rows) {
    const key = composerDedupeKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return Array.from(groups.values())
    .map((bucket) => {
      const first = bucket[0];
      if (!first) throw new Error("Composer dedupe group unexpectedly empty.");
      const best = [...bucket].sort((a, b) => signalRankValue(b) - signalRankValue(a))[0] ?? first;
      return {
        ...best,
        supporting_methodologies: unique(bucket.map((row) => row.methodology_slug)),
        supporting_signal_types: unique(bucket.map((row) => row.signal_type)),
        supporting_signal_ids: unique(bucket.flatMap((row) => row.supporting_signal_ids)),
        supporting_observation_ids: unique(bucket.flatMap((row) => row.supporting_observation_ids)),
        supporting_signal_count: bucket.length,
        supporting_evidence_count: bucket.reduce((sum, row) => sum + row.evidence_count, 0),
        evidence_examples: uniqueEvidenceExamples(bucket.flatMap((row) => row.evidence_examples))
      };
    })
    .sort((a, b) => signalRankValue(b) - signalRankValue(a));
}

export function buildComposerModules(rows: NormalizedComposerSignal[]) {
  const map = new Map<string, {
    methodology_slug: string;
    total_signals: number;
    total_frequency: number;
    evidence_count: number;
    signal_types: Record<string, number>;
    top_signals: NormalizedComposerSignal[];
  }>();

  for (const row of rows) {
    const bucket = map.get(row.methodology_slug) ?? {
      methodology_slug: row.methodology_slug,
      total_signals: 0,
      total_frequency: 0,
      evidence_count: 0,
      signal_types: {},
      top_signals: []
    };
    bucket.total_signals += 1;
    bucket.total_frequency += row.frequency;
    bucket.evidence_count += row.evidence_count;
    bucket.signal_types[row.signal_type] = (bucket.signal_types[row.signal_type] ?? 0) + 1;
    bucket.top_signals.push(row);
    bucket.top_signals = bucket.top_signals
      .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0) || b.frequency - a.frequency)
      .slice(0, 4);
    map.set(row.methodology_slug, bucket);
  }

  return Array.from(map.values()).sort((a, b) => b.total_frequency - a.total_frequency);
}

export function buildComposerDraft(args: {
  rows: NormalizedComposerSignal[];
  dedupedRows: NormalizedComposerSignal[];
  modules: ReturnType<typeof buildComposerModules>;
  opportunities: NormalizedComposerSignal[];
  risks: NormalizedComposerSignal[];
  selection?: ComposerSelection;
  lensStatuses?: ComposerLensStatusLike[];
}) {
  const supportingRows = args.dedupedRows.flatMap((row) => row.supporting_signal_ids.length > 0 ? [row] : []);
  const lensStatuses = normalizeComposerLensStatuses(args.lensStatuses);
  return {
    kind: "live_composer_draft",
    version: 1,
    selection: {
      methodologies: unique(args.selection?.methodologies ?? []),
      signalTypes: unique(args.selection?.signalTypes ?? []),
      statuses: unique(args.selection?.statuses ?? []),
      chartKeys: unique(args.selection?.chartKeys ?? [])
    },
    module_slugs: args.modules.map((module) => module.methodology_slug),
    module_chart_keys: chartKeysByModule(args.modules.map((module) => module.methodology_slug)),
    selected_chart_keys: chartKeysForModules(args.modules.map((module) => module.methodology_slug)),
    selected_canonical_signal_ids: args.dedupedRows.map((row) => row.canonical_signal_id),
    supporting_signal_ids: unique(supportingRows.flatMap((row) => row.supporting_signal_ids)),
    supporting_observation_ids: unique(args.dedupedRows.flatMap((row) => row.supporting_observation_ids)),
    opportunity_signal_ids: args.opportunities.map((row) => row.canonical_signal_id),
    risk_signal_ids: args.risks.map((row) => row.canonical_signal_id),
    evidence_mention_ids: unique(args.dedupedRows.flatMap((row) => row.evidence_examples.map((example) => example.mention_id ?? ""))),
    lens_statuses: lensStatuses,
    lens_status_summary: summarizeComposerLensStatuses(lensStatuses),
    totals: {
      raw_signals: args.rows.length,
      deduped_signals: args.dedupedRows.length,
      modules: args.modules.length,
      charts: chartKeysForModules(args.modules.map((module) => module.methodology_slug)).length,
      opportunities: args.opportunities.length,
      risks: args.risks.length,
      evidence_examples: args.dedupedRows.reduce((sum, row) => sum + row.evidence_examples.length, 0)
    }
  };
}

export function buildComposerEditorialDraft(args: {
  baseDraft: ComposerDraft | null;
  modules: ComposerModuleLike[];
  opportunities: ComposerSignalLike[];
  risks: ComposerSignalLike[];
  selectedModuleSlugs: string[];
  selectedChartKeys?: string[];
  selectedCanonicalSignalIds: string[];
  selection?: ComposerSelection;
  lensStatuses?: ComposerLensStatusLike[];
}) {
  const selectedModuleSet = new Set(args.selectedModuleSlugs);
  const availableChartKeys = chartKeysForModules(args.selectedModuleSlugs);
  const selectedChartKeySet = new Set(
    (args.selectedChartKeys && args.selectedChartKeys.length > 0 ? args.selectedChartKeys : availableChartKeys)
      .filter((chartKey) => availableChartKeys.includes(chartKey))
  );
  const selectedChartKeys = availableChartKeys.filter((chartKey) => selectedChartKeySet.has(chartKey));
  const selectedSignalSet = new Set(args.selectedCanonicalSignalIds);
  const opportunityIds = new Set(args.opportunities.map((row) => row.canonical_signal_id));
  const riskIds = new Set(args.risks.map((row) => row.canonical_signal_id));
  const allSignals = uniqueSignals([
    ...args.modules.flatMap((module) => module.top_signals ?? []),
    ...args.opportunities,
    ...args.risks
  ]);
  const selectedSignals = allSignals.filter((signal) => (
    selectedSignalSet.has(signal.canonical_signal_id) &&
    signalBelongsToSelectedModule(signal, selectedModuleSet)
  ));
  const lensStatuses = normalizeComposerLensStatuses(
    args.lensStatuses ?? args.baseDraft?.lens_statuses
  );

  return {
    kind: "live_composer_editorial_draft",
    version: 2,
    source_kind: args.baseDraft?.kind ?? null,
    selection: {
      methodologies: unique(args.selection?.methodologies ?? []),
      signalTypes: unique(args.selection?.signalTypes ?? []),
      statuses: unique(args.selection?.statuses ?? []),
      chartKeys: selectedChartKeys,
      modules: args.selectedModuleSlugs,
      canonicalSignalIds: selectedSignals.map((signal) => signal.canonical_signal_id)
    },
    module_slugs: args.selectedModuleSlugs,
    module_chart_keys: chartKeysByModule(args.selectedModuleSlugs, selectedChartKeys),
    selected_chart_keys: selectedChartKeys,
    selected_canonical_signal_ids: selectedSignals.map((signal) => signal.canonical_signal_id),
    supporting_signal_ids: unique(selectedSignals.flatMap((signal) => signal.supporting_signal_ids ?? [signal.canonical_signal_id])),
    supporting_observation_ids: unique(selectedSignals.flatMap((signal) => signal.supporting_observation_ids ?? [])),
    opportunity_signal_ids: selectedSignals
      .filter((signal) => opportunityIds.has(signal.canonical_signal_id))
      .map((signal) => signal.canonical_signal_id),
    risk_signal_ids: selectedSignals
      .filter((signal) => riskIds.has(signal.canonical_signal_id))
      .map((signal) => signal.canonical_signal_id),
    evidence_mention_ids: unique(selectedSignals.flatMap((signal) => (
      signal.evidence_examples ?? []
    ).map((example) => example.mention_id ?? ""))),
    lens_statuses: lensStatuses,
    lens_status_summary: summarizeComposerLensStatuses(lensStatuses),
    totals: {
      available_modules: args.modules.length,
      selected_modules: args.selectedModuleSlugs.length,
      available_charts: chartKeysForModules(args.modules.map((module) => module.methodology_slug)).length,
      selected_charts: selectedChartKeys.length,
      available_signals: allSignals.length,
      selected_signals: selectedSignals.length,
      opportunities: selectedSignals.filter((signal) => opportunityIds.has(signal.canonical_signal_id)).length,
      risks: selectedSignals.filter((signal) => riskIds.has(signal.canonical_signal_id)).length,
      evidence_examples: selectedSignals.reduce((sum, signal) => sum + (signal.evidence_examples?.length ?? 0), 0)
    }
  };
}

export function applyComposerEditorialCut<TModule extends ComposerModuleLike, TSignal extends ComposerSignalLike>(args: {
  modules: TModule[];
  opportunities: TSignal[];
  risks: TSignal[];
  draft: ComposerDraft | null;
  editorial: ComposerEditorialState;
}) {
  if (!args.editorial) {
    return {
      applied: false,
      modules: args.modules,
      opportunities: args.opportunities,
      risks: args.risks,
      draft: args.draft
    };
  }

  const editorialDraft = recordOrEmpty(args.editorial.draft);
  const editorialSelection = recordOrEmpty(args.editorial.selection);
  const selectedModuleSlugs = unique([
    ...stringList(editorialDraft.module_slugs),
    ...stringList(editorialSelection.modules)
  ]);
  const selectedSignalIds = unique([
    ...stringList(editorialDraft.selected_canonical_signal_ids),
    ...stringList(editorialSelection.canonicalSignalIds)
  ]);
  const selectedOpportunityIds = unique([
    ...stringList(editorialDraft.opportunity_signal_ids),
    ...stringList(editorialSelection.opportunitySignalIds)
  ]);
  const selectedRiskIds = unique([
    ...stringList(editorialDraft.risk_signal_ids),
    ...stringList(editorialSelection.riskSignalIds)
  ]);
  const selectedChartKeys = unique([
    ...stringList(editorialDraft.selected_chart_keys),
    ...stringList(editorialSelection.chartKeys)
  ]);
  const moduleSet = new Set(selectedModuleSlugs);
  const signalSet = new Set(selectedSignalIds);
  const opportunitySet = new Set(selectedOpportunityIds);
  const riskSet = new Set(selectedRiskIds);

  const modules = args.modules
    .filter((module) => moduleSet.has(module.methodology_slug))
    .map((module) => {
      const topSignals = (module.top_signals ?? []).filter((signal) => signalSet.has(signal.canonical_signal_id));
      return {
        ...module,
        total_signals: topSignals.length,
        total_frequency: topSignals.reduce((sum, signal) => sum + signalFrequency(signal), 0),
        evidence_count: topSignals.reduce((sum, signal) => sum + signalEvidence(signal), 0),
        signal_types: countSignalTypes(topSignals),
        top_signals: topSignals
      } as TModule;
    });
  const opportunities = args.opportunities.filter((signal) => opportunitySet.has(signal.canonical_signal_id));
  const risks = args.risks.filter((signal) => riskSet.has(signal.canonical_signal_id));
  const selectedSignals = uniqueSignals([
    ...modules.flatMap((module) => module.top_signals ?? []),
    ...opportunities,
    ...risks
  ]);
  const lensStatuses = normalizeComposerLensStatuses(
    Array.isArray(editorialDraft.lens_statuses) && editorialDraft.lens_statuses.length > 0
      ? editorialDraft.lens_statuses as ComposerLensStatusLike[]
      : args.draft?.lens_statuses
  );
  const visibleDraft = args.draft ? {
    ...args.draft,
    kind: "live_composer_visible_draft",
    version: Math.max(args.draft.version, 2),
    module_slugs: selectedModuleSlugs,
    module_chart_keys: chartKeysByModule(selectedModuleSlugs, selectedChartKeys),
    selected_chart_keys: selectedChartKeys.length > 0 ? selectedChartKeys : chartKeysForModules(selectedModuleSlugs),
    selected_canonical_signal_ids: selectedSignals.map((signal) => signal.canonical_signal_id),
    supporting_signal_ids: unique(selectedSignals.flatMap((signal) => signal.supporting_signal_ids ?? [signal.canonical_signal_id])),
    supporting_observation_ids: unique(selectedSignals.flatMap((signal) => signal.supporting_observation_ids ?? [])),
    opportunity_signal_ids: opportunities.map((signal) => signal.canonical_signal_id),
    risk_signal_ids: risks.map((signal) => signal.canonical_signal_id),
    evidence_mention_ids: unique(selectedSignals.flatMap((signal) => (
      signal.evidence_examples ?? []
    ).map((example) => example.mention_id ?? ""))),
    lens_statuses: lensStatuses,
    lens_status_summary: summarizeComposerLensStatuses(lensStatuses),
    totals: {
      ...args.draft.totals,
      raw_signals: selectedSignals.length,
      deduped_signals: selectedSignals.length,
      modules: modules.length,
      charts: selectedChartKeys.length > 0 ? selectedChartKeys.length : chartKeysForModules(selectedModuleSlugs).length,
      opportunities: opportunities.length,
      risks: risks.length,
      evidence_examples: selectedSignals.reduce((sum, signal) => sum + (signal.evidence_examples?.length ?? 0), 0),
      available_modules: args.modules.length,
      selected_modules: modules.length,
      available_charts: chartKeysForModules(args.modules.map((module) => module.methodology_slug)).length,
      selected_charts: selectedChartKeys.length > 0 ? selectedChartKeys.length : chartKeysForModules(selectedModuleSlugs).length,
      available_signals: uniqueSignals([
        ...args.modules.flatMap((module) => module.top_signals ?? []),
        ...args.opportunities,
        ...args.risks
      ]).length,
      selected_signals: selectedSignals.length
    }
  } : null;

  return {
    applied: true,
    modules,
    opportunities,
    risks,
    draft: visibleDraft
  };
}

export function composerChartKeysForModule(moduleSlug: string) {
  const generic = ["overview", "evidence"];
  const byModule: Record<string, string[]> = {
    "triggers-barriers": ["decision_field", "opportunities", "competitive_intelligence", "evidence"],
    "narrative-ownership": ["ownership_share", "ownership_valence", "orphan_narratives", "evidence"],
    "value-perception-matrix": ["benefit_cost_heatmap", "value_map", "whitespace_ranking", "evidence"],
    "journey-friction-mapping": ["journey_heatmap", "phase_friction", "blockers_accelerators", "evidence"],
    "sentiment-advocacy-proxy": ["advocacy_proxy", "driver_breakdown", "sentiment_intensity", "evidence"],
    "trust-risk-benchmark": ["trust_drivers", "risk_benchmark", "escalation_watch", "evidence"],
    "brand-positioning-map": ["positioning_map", "attribute_distance", "entity_ranking", "evidence"],
    "category-opportunity-map": ["opportunity_map", "demand_coverage", "urgency_ranking", "evidence"],
    "white-space-analysis": ["white_space_map", "capturable_spaces", "permission_ranking", "evidence"],
    "competitive-wave": ["wave_plot", "axis_radar", "entity_ranking", "evidence"],
    "cultural-codes-decoding": ["codes_map", "tension_matrix", "maturity_ranking", "evidence"],
    "influence-architecture": ["node_roles", "community_map", "influence_paths", "evidence"],
    "decision-velocity": ["velocity_index", "blockers_accelerators", "journey_stage", "evidence"],
    "audience-segment-lens": ["segment_skew", "segment_signal_matrix", "segment_evidence", "evidence"],
    "evidence-confidence-layer": ["confidence_mix", "source_diversity", "evidence_gaps", "evidence"]
  };
  return byModule[moduleSlug] ?? generic;
}

export function composerChartKey(moduleSlug: string, chartSlug: string) {
  return `${moduleSlug}:${chartSlug}`;
}

export function chartKeysForModules(moduleSlugs: string[]) {
  return unique(moduleSlugs.flatMap((moduleSlug) =>
    composerChartKeysForModule(moduleSlug).map((chartSlug) => composerChartKey(moduleSlug, chartSlug))
  ));
}

export function chartKeysByModule(moduleSlugs: string[], selectedChartKeys?: string[]) {
  const selected = selectedChartKeys && selectedChartKeys.length > 0 ? new Set(selectedChartKeys) : null;
  return Object.fromEntries(moduleSlugs.map((moduleSlug) => [
    moduleSlug,
    composerChartKeysForModule(moduleSlug)
      .map((chartSlug) => composerChartKey(moduleSlug, chartSlug))
      .filter((chartKey) => !selected || selected.has(chartKey))
  ]));
}

export function isComposerOpportunity(row: NormalizedComposerSignal) {
  const type = row.signal_type.toLowerCase();
  const dimensions = row.dimensions;
  return (
    type.includes("trigger") ||
    type.includes("value") ||
    type.includes("opportunity") ||
    type.includes("category_need") ||
    type.includes("whitespace") ||
    type.includes("positioning") ||
    type.includes("narrative") ||
    dimensionNumber(dimensions, "opportunity_score") > 0 ||
    dimensionNumber(dimensions, "whitespace_score") > 0 ||
    dimensionNumber(dimensions, "value_score") > 0 ||
    dimensionNumber(dimensions, "accelerator_score") > dimensionNumber(dimensions, "blocker_score") ||
    dimensionNumber(dimensions, "velocity_index") > 0 ||
    Number(row.delta_vs_previous ?? 0) > 0
  ) && !isComposerRisk(row);
}

export function isComposerRisk(row: NormalizedComposerSignal) {
  const type = row.signal_type.toLowerCase();
  const sentiment = row.sentiment ?? 0;
  const dimensions = row.dimensions;
  return (
    type.includes("barrier") ||
    type.includes("risk") ||
    type.includes("friction") ||
    dimensionNumber(dimensions, "risk_score") > 0 ||
    dimensionNumber(dimensions, "choke_score") > dimensionNumber(dimensions, "accelerator_score") ||
    dimensionNumber(dimensions, "blocker_score") > dimensionNumber(dimensions, "accelerator_score") ||
    dimensionNumber(dimensions, "velocity_index") < 0 ||
    dimensions.reputational_vulnerability === true ||
    sentiment < -0.2
  );
}

function dimensionNumber(dimensions: Record<string, unknown>, key: string) {
  const value = dimensions[key];
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function composerDedupeKey(row: NormalizedComposerSignal) {
  return slugify(row.title) || row.semantic_key || row.canonical_signal_id;
}

function signalRankValue(row: NormalizedComposerSignal) {
  return (row.composite_score ?? 0) * 1000 + row.frequency + row.evidence_count * 0.1;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueSignals<T extends ComposerSignalLike>(signals: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const signal of signals) {
    if (!signal.canonical_signal_id || seen.has(signal.canonical_signal_id)) continue;
    seen.add(signal.canonical_signal_id);
    output.push(signal);
  }
  return output;
}

function signalBelongsToSelectedModule(signal: ComposerSignalLike, selectedModuleSet: Set<string>) {
  if (selectedModuleSet.size === 0) return false;
  if (selectedModuleSet.has(signal.methodology_slug)) return true;
  return (signal.supporting_methodologies ?? []).some((methodology) => selectedModuleSet.has(methodology));
}

function signalFrequency(signal: ComposerSignalLike) {
  return typeof signal.frequency === "number" && Number.isFinite(signal.frequency) ? signal.frequency : 0;
}

function signalEvidence(signal: ComposerSignalLike) {
  const directEvidence = typeof signal.evidence_count === "number" && Number.isFinite(signal.evidence_count)
    ? signal.evidence_count
    : 0;
  return Math.max(directEvidence, signal.evidence_examples?.length ?? 0);
}

function countSignalTypes(signals: ComposerSignalLike[]) {
  const output: Record<string, number> = {};
  for (const signal of signals) {
    const key = signal.signal_type || "signal";
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

function recordOrEmpty(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordOrNull(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeComposerLensStatuses(value: unknown): ComposerLensStatusLike[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      methodology_slug: stringValue(row.methodology_slug),
      status: stringValue(row.status) || "not_started",
      engine_analysis_id: stringOrNull(row.engine_analysis_id),
      current_step: stringOrNull(row.current_step),
      signals_in_range: numberValue(row.signals_in_range),
      evidence_in_range: numberValue(row.evidence_in_range),
      message: stringOrNull(row.message),
      readiness: normalizeLensReadinessForDraft(row.readiness),
      quality_gates_failed: normalizeFailedGates(row.quality_gates_failed)
    }))
    .filter((row) => row.methodology_slug)
    .slice(0, 40);
}

function summarizeComposerLensStatuses(lensStatuses: ComposerLensStatusLike[]) {
  return {
    total: lensStatuses.length,
    active: lensStatuses.filter((status) => status.status === "active").length,
    ready: lensStatuses.filter((status) => status.status === "ready" || status.status === "approved" || status.status === "needs_review").length,
    running: lensStatuses.filter((status) => status.status === "queued" || status.status === "running").length,
    blocked: lensStatuses.filter((status) => status.status === "blocked" || status.status === "failed").length,
    no_signals: lensStatuses.filter((status) => status.status === "no_signals" || status.status === "not_started").length
  };
}

function normalizeLensReadinessForDraft(value: unknown) {
  const input = recordOrNull(value);
  if (!input) return null;
  const summary = recordOrNull(input.summary) ?? {};
  return {
    status: stringValue(input.status) || null,
    hard_failures: stringList(input.hard_failures),
    warnings: stringList(input.warnings),
    summary: {
      requiredScopes: stringList(summary.requiredScopes),
      importedScopes: stringList(summary.importedScopes),
      missingScopes: stringList(summary.missingScopes),
      scopeCoverage: normalizeScopeCoverage(summary.scopeCoverage)
    }
  };
}

function normalizeScopeCoverage(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      scope: stringValue(row.scope),
      mentionCount: numberValue(row.mentionCount),
      status: stringValue(row.status)
    }))
    .filter((row) => row.scope || row.status);
}

function normalizeFailedGates(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      id: stringValue(row.id),
      detail: stringValue(row.detail)
    }))
    .filter((row) => row.id || row.detail)
    .slice(0, 12);
}

function normalizeEvidenceExamples(value: unknown): ComposerEvidenceExample[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      observation_id: stringOrNull(row.observation_id),
      mention_id: stringOrNull(row.mention_id),
      source_id: stringOrNull(row.source_id),
      quote: stringValue(row.quote).slice(0, 600),
      platform: stringOrNull(row.platform),
      published_at: stringOrNull(row.published_at),
      evidence_role: stringOrNull(row.evidence_role),
      is_protagonist: row.is_protagonist === true
    }))
    .filter((row) => row.quote)
    .slice(0, 6);
}

function uniqueEvidenceExamples(rows: ComposerEvidenceExample[]) {
  const seen = new Set<string>();
  const output: ComposerEvidenceExample[] = [];
  for (const row of rows) {
    const key = row.mention_id || row.source_id || `${row.observation_id ?? ""}:${slugify(row.quote)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
    if (output.length >= 8) break;
  }
  return output;
}

function normalizedSet(values?: string[]) {
  return new Set((values ?? []).map(normalizeToken).filter(Boolean));
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function stringOrNull(value: unknown) {
  const text = stringValue(value).trim();
  return text || null;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
