import {
  resolveSignalPulseVisibility,
  type SignalPulseResolvedVisibility
} from "@/lib/signal-pulse/runtime-contracts";

type JsonRecord = Record<string, unknown>;

export type PulseOutputLike = {
  id: string;
  title: string | null;
  headline: string | null;
  summary: string | null;
  payload: unknown;
  visibilityConfig?: unknown;
  methodologySlug: string | null;
  kind: string | null;
  brandName?: string | null;
  brandFallbackName?: string | null;
  themeName?: string | null;
};

export type PulseApiFilters = {
  period?: string;
  platform?: string;
  signalId?: string;
  signalType?: string;
  lifecycle?: string;
  campaign?: string;
  moveType?: string;
  sourceType?: string;
  scope?: string;
  analysisScope?: string;
  patternFlag?: string;
  performanceEvent?: string;
  status?: string;
  q?: string;
};

export function isSignalPulseOutput(output: PulseOutputLike | null | undefined): output is PulseOutputLike & {
  methodologySlug: "signal-pulse";
  kind: "signal_pulse";
} {
  return output?.methodologySlug === "signal-pulse" && output.kind === "signal_pulse";
}

export function buildPulseApiContext(args: {
  output: PulseOutputLike;
  isInternalUser: boolean;
}) {
  const payload = asRecord(args.output.payload);
  return {
    payload,
    visibility: resolveSignalPulseVisibility({
      config: args.output.visibilityConfig,
      isInternalUser: args.isInternalUser
    })
  };
}

export function buildPulseOverviewResponse(args: {
  output: PulseOutputLike;
  payload: JsonRecord;
  visibility: SignalPulseResolvedVisibility;
  filters?: PulseApiFilters;
}) {
  const report = asRecord(args.payload.report);
  const executiveRead = asRecord(args.payload.executive_read);
  const periods = sanitizePulsePeriodsForVisibility(arrayOfRecords(args.payload.periods), args.visibility);
  const filters = withDefaultPulsePeriod(normalizePulseFilters(args.filters), periods);
  const signals = filterSignals(arrayOfRecords(args.payload.signals), filters);
  const moves = filterMoves(arrayOfRecords(args.payload.marketing_moves), signals, filters);
  const qualityGates = arrayOfRecords(args.payload.quality_gates);
  const cost = asRecord(args.payload.cost);
  const activePeriod = findPeriod(periods, filters.period) ?? periods.at(-1) ?? null;
  const topSignals = signals.slice(0, 8).map((signal) => compactSignal(signal, args.visibility));
  const topMoves = moves.slice(0, 6).map(compactMove);

  return {
    output_id: args.output.id,
    mode: "published",
    brand_name: args.output.brandName ?? args.output.brandFallbackName ?? args.output.themeName ?? stringValue(report.title) ?? "Signal Pulse",
    report: {
      title: args.output.title ?? stringValue(report.title),
      business_question: stringValue(report.business_question),
      generated_from_engine_analysis_id: stringValue(report.generated_from_engine_analysis_id)
    },
    periods,
    active_period: activePeriod ? stringValue(activePeriod.id) : null,
    executive_read: {
      headline: stringValue(executiveRead.headline) || args.output.headline,
      reading: stringValue(executiveRead.body) || args.output.summary,
      action: stringValue(executiveRead.action),
      limitations: arrayValue(args.payload.limitations).map(String)
    },
    kpis: {
      signals_active: signals.length,
      new_this_period: signals.filter((signal) => stringValue(signal.lifecycle_state) === "new").length,
      risks: signals.filter((signal) => stringValue(signal.signal_type) === "risk").length,
      confidence: confidenceFromSignals(signals)
    },
    charts: chartInventory(args.payload, args.visibility),
    top_signals: topSignals,
    top_moves: topMoves,
    filters: filtersForResponse(filters),
    quality: {
      gates_passed: qualityGates.filter((gate) => gate.passed === true).length,
      gates_total: qualityGates.length,
      cost
    },
    visibility: {
      paid_organic: args.visibility.showPaidOrganic,
      competitive: args.visibility.showCompetitive,
      evidence: args.visibility.showEvidence,
      corpus: args.visibility.showCorpus,
      sources: args.visibility.showSources,
      quality: args.visibility.showQuality
    },
    warnings: warningList(args.payload)
  };
}

export function buildPulseSignalsResponse(args: {
  payload: JsonRecord;
  visibility: SignalPulseResolvedVisibility;
  signalId?: string;
  filters?: PulseApiFilters;
}) {
  const periods = arrayOfRecords(args.payload.periods);
  const evidence = args.visibility.showEvidence ? arrayOfRecords(args.payload.evidence) : [];
  const normalizedFilters = normalizePulseFilters({ ...args.filters, signalId: args.signalId ?? args.filters?.signalId });
  const filters = args.signalId ? normalizedFilters : withDefaultPulsePeriod(normalizedFilters, periods);
  const moves = arrayOfRecords(args.payload.marketing_moves);
  const signals: JsonRecord[] = filterSignals(arrayOfRecords(args.payload.signals), filters).map((signal) => enrichSignal(signal, { periods, evidence, moves, visibility: args.visibility }));

  if (filters.signalId) {
    const signal = signals.find((item) => stringValue(item.id) === filters.signalId);
    return signal ? { signal } : null;
  }

  return {
    signals,
    count: signals.length,
    filters: filtersForResponse(filters),
    periods: periods.map((period) => ({
      id: stringValue(period.id),
      label: stringValue(period.label),
      comparable: period.comparable !== false,
      confidence: stringValue(period.confidence)
    }))
  };
}

export function buildPulseMovesResponse(args: {
  payload: JsonRecord;
  visibility: SignalPulseResolvedVisibility;
  filters?: PulseApiFilters;
}) {
  const filters = withDefaultPulsePeriod(normalizePulseFilters(args.filters), arrayOfRecords(args.payload.periods));
  const filteredSignals = filterSignals(arrayOfRecords(args.payload.signals), filters);
  const signals = new Map(filteredSignals.map((signal) => [stringValue(signal.id), compactSignal(signal, args.visibility)]));
  const evidence = args.visibility.showEvidence ? arrayOfRecords(args.payload.evidence) : [];
  const moves: JsonRecord[] = filterMoves(arrayOfRecords(args.payload.marketing_moves), filteredSignals, filters).map((move) => {
    const refs = stringArray(move.signal_refs);
    return {
      ...move,
      signals: refs.map((id) => signals.get(id)).filter(Boolean),
      evidence: evidence.filter((item) => refs.includes(stringValue(item.signal_id))).slice(0, 4)
    };
  });

  const board = moves.reduce<Record<string, JsonRecord[]>>((acc, move) => {
    const key = stringValue(move.status) || "candidate";
    acc[key] = [...(acc[key] ?? []), move];
    return acc;
  }, {});

  return {
    moves,
    board,
    count: moves.length,
    filters: filtersForResponse(filters)
  };
}

export function buildPulseChartResponse(args: {
  payload: JsonRecord;
  dataRef: string;
  visibility?: SignalPulseResolvedVisibility;
  filters?: PulseApiFilters;
}) {
  const charts = chartRefs(args.payload, args.visibility);
  const filters = normalizePulseFilters(args.filters);
  const key = chartAlias(args.dataRef);
  if (isPaidChartKey(key) && args.visibility && !args.visibility.showPaidOrganic) return null;
  const chart = charts[args.dataRef] ?? charts[key];
  if (!chart) return null;
  return {
    data_ref: args.dataRef,
    chart_key: key,
    payload: filterChartPayload(asRecord(chart), filters),
    filters: filtersForResponse(filters)
  };
}

export function pulseApiFiltersFromSearchParams(searchParams: URLSearchParams): PulseApiFilters {
  return normalizePulseFilters({
    period: queryValue(searchParams, "period", "period_id", "period_label"),
    platform: queryValue(searchParams, "platform", "source"),
    signalId: queryValue(searchParams, "signal_id", "signal"),
    signalType: queryValue(searchParams, "signal_type", "type"),
    lifecycle: queryValue(searchParams, "lifecycle", "lifecycle_state"),
    campaign: queryValue(searchParams, "campaign", "campaign_id", "campaign_name", "entity_name"),
    moveType: queryValue(searchParams, "move_type"),
    sourceType: queryValue(searchParams, "source_type", "source_kind", "data_source"),
    scope: queryValue(searchParams, "scope", "entity_scope"),
    analysisScope: queryValue(searchParams, "analysis_scope"),
    patternFlag: queryValue(searchParams, "pattern_flag", "pattern", "signal_pattern"),
    performanceEvent: queryValue(searchParams, "performance_event", "event"),
    status: queryValue(searchParams, "status"),
    q: queryValue(searchParams, "q")
  });
}

export function sanitizePulsePeriodsForVisibility(periods: JsonRecord[], visibility: SignalPulseResolvedVisibility): JsonRecord[] {
  if (visibility.showPaidOrganic) return periods;
  return periods.map((period) => ({
    ...period,
    coverage: stripPaidCoverage(asRecord(period.coverage))
  }));
}

export function sanitizePulseChartRefsForVisibility(chartRefsInput: JsonRecord, visibility: SignalPulseResolvedVisibility): JsonRecord {
  if (visibility.showPaidOrganic) return chartRefsInput;
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(chartRefsInput)) {
    const normalizedKey = chartAlias(key);
    if (isPaidChartKey(normalizedKey)) continue;
    if (normalizedKey === "source_coverage_strip") {
      const chart = asRecord(value);
      output[key] = {
        ...chart,
        rows: arrayOfRecords(chart.rows).map((row) => ({
          ...row,
          coverage: stripPaidCoverage(asRecord(row.coverage))
        }))
      };
      continue;
    }
    output[key] = value;
  }
  return output;
}

function normalizePulseFilters(filters: PulseApiFilters | null | undefined): PulseApiFilters {
  return {
    period: normalizeRawFilterValue(filters?.period),
    platform: normalizeFilterValue(filters?.platform),
    signalId: normalizeRawFilterValue(filters?.signalId),
    signalType: normalizeFilterValue(filters?.signalType),
    lifecycle: normalizeFilterValue(filters?.lifecycle),
    campaign: normalizeFilterValue(filters?.campaign),
    moveType: normalizeFilterValue(filters?.moveType),
    sourceType: normalizeFilterValue(filters?.sourceType),
    scope: normalizeFilterValue(filters?.scope),
    analysisScope: normalizeAnalysisScopeFilter(filters?.analysisScope),
    patternFlag: normalizePatternFlagFilter(filters?.patternFlag),
    performanceEvent: normalizeFilterValue(filters?.performanceEvent),
    status: normalizeFilterValue(filters?.status),
    q: normalizeFilterValue(filters?.q)
  };
}

function withDefaultPulsePeriod(filters: PulseApiFilters, periods: JsonRecord[]): PulseApiFilters {
  if (filters.period) return filters;
  const latest = periods.at(-1);
  return latest ? { ...filters, period: stringValue(latest.id) || stringValue(latest.label) } : filters;
}

function hasActivePulseFilters(filters: PulseApiFilters) {
  return Boolean(
    filters.period ||
    filters.platform ||
    filters.signalId ||
    filters.signalType ||
    filters.lifecycle ||
    filters.campaign ||
    filters.moveType ||
    filters.sourceType ||
    filters.scope ||
    filters.analysisScope ||
    filters.patternFlag ||
    filters.performanceEvent ||
    filters.status ||
    filters.q
  );
}

function filtersForResponse(filters: PulseApiFilters) {
  return {
    active: hasActivePulseFilters(filters),
    period: filters.period || null,
    platform: filters.platform || null,
    signal_id: filters.signalId || null,
    signal_type: filters.signalType || null,
    lifecycle: filters.lifecycle || null,
    campaign: filters.campaign || null,
    move_type: filters.moveType || null,
    source_type: filters.sourceType || null,
    scope: filters.scope || null,
    analysis_scope: filters.analysisScope || null,
    pattern_flag: filters.patternFlag || null,
    performance_event: filters.performanceEvent || null,
    status: filters.status || null,
    q: filters.q || null
  };
}

function findPeriod(periods: JsonRecord[], periodFilter?: string) {
  if (!periodFilter) return null;
  return periods.find((period) => {
    return stringValue(period.id) === periodFilter || stringValue(period.label) === periodFilter;
  }) ?? null;
}

function enrichSignal(signal: JsonRecord, args: { periods: JsonRecord[]; evidence: JsonRecord[]; moves: JsonRecord[]; visibility: SignalPulseResolvedVisibility }): JsonRecord {
  const signalId = stringValue(signal.id);
  return {
    ...signal,
    pattern_flags: patternFlagsForSignal(signal),
    primary_pattern_flag: patternFlagsForSignal(signal)[0] ?? "",
    intelligence_read: signalIntelligenceRead(signal, args.visibility),
    evidence: args.evidence.filter((item) => stringValue(item.signal_id) === signalId),
    moves: args.moves.filter((move) => stringArray(move.signal_refs).includes(signalId)),
    period_summary: args.periods.map((period) => {
      const metric = metricForPeriod(signal, stringValue(period.id), stringValue(period.label));
      return {
        period_id: stringValue(period.id),
        label: stringValue(period.label),
        comparable: period.comparable !== false,
        volume: metric ? numberValue(metric.volume) : null,
        lifecycle_state: metric ? stringValue(metric.lifecycle_state) : ""
      };
    })
  };
}

function filterSignals(signals: JsonRecord[], filters: PulseApiFilters): JsonRecord[] {
  return signals.filter((signal) => {
    if (filters.signalId && stringValue(signal.id) !== filters.signalId) return false;
    if (filters.signalType && normalizeFilterValue(signal.signal_type) !== filters.signalType) return false;
    if (filters.lifecycle && !signalMatchesLifecycle(signal, filters.lifecycle, filters.period)) return false;
    if (filters.period && !signalMatchesPeriod(signal, filters.period)) return false;
    if (filters.platform && !signalMatchesPlatform(signal, filters.platform, filters.period)) return false;
    if (filters.sourceType && !signalMatchesSourceType(signal, filters.sourceType)) return false;
    if (filters.scope && !signalMatchesScope(signal, filters.scope)) return false;
    if (filters.analysisScope && normalizeAnalysisScopeFilter(asRecord(signal.dimensions).analysis_scope) !== filters.analysisScope) return false;
    if (filters.patternFlag && !signalMatchesPatternFlag(signal, filters.patternFlag)) return false;
    if (filters.campaign && !signalMatchesQuery(signal, filters.campaign)) return false;
    if (filters.performanceEvent && !signalMatchesQuery(signal, filters.performanceEvent)) return false;
    if (filters.q && !signalMatchesQuery(signal, filters.q)) return false;
    return true;
  });
}

function filterMoves(moves: JsonRecord[], filteredSignals: JsonRecord[], filters: PulseApiFilters): JsonRecord[] {
  const allowedSignalIds = new Set(filteredSignals.map((signal) => stringValue(signal.id)).filter(Boolean));
  const hasSignalScopedFilter = Boolean(
    filters.period ||
    filters.platform ||
    filters.signalId ||
    filters.signalType ||
    filters.lifecycle ||
    filters.campaign ||
    filters.sourceType ||
    filters.scope ||
    filters.analysisScope ||
    filters.patternFlag ||
    filters.performanceEvent ||
    filters.q
  );
  return moves.filter((move) => {
    if (filters.moveType && normalizeFilterValue(move.move_type) !== filters.moveType) return false;
    if (filters.status && normalizeFilterValue(move.status) !== filters.status) return false;
    const refs = stringArray(move.signal_refs);
    if (hasSignalScopedFilter && !refs.some((id) => allowedSignalIds.has(id))) return false;
    return true;
  });
}

function filterChartPayload(chart: JsonRecord, filters: PulseApiFilters): JsonRecord {
  if (!hasActivePulseFilters(filters)) return chart;
  const rows = arrayOfRecords(chart.rows);
  if (rows.length === 0) return chart;
  return {
    ...chart,
    rows: rows.filter((row) => {
      if (filters.signalId && stringValue(row.signal_id || row.id) !== filters.signalId) return false;
      if (filters.period && !rowMatchesPeriod(row, filters.period)) return false;
      if (filters.platform && !rowMatchesPlatform(row, filters.platform)) return false;
      if (filters.lifecycle && normalizeFilterValue(row.lifecycle_state) !== filters.lifecycle) return false;
      if (filters.signalType && normalizeFilterValue(row.signal_type) !== filters.signalType) return false;
      if (filters.campaign && !rowMatchesText(row, filters.campaign, ["campaign", "campaign_id", "campaign_name", "entity_name", "creative_text"])) return false;
      if (filters.sourceType && !rowMatchesText(row, filters.sourceType, ["source_type", "source_kind", "data_source", "provider", "channel"])) return false;
      if (filters.scope && !rowMatchesText(row, filters.scope, ["scope", "entity_scope", "query_scope", "brand_scope"])) return false;
      if (filters.analysisScope && normalizeAnalysisScopeFilter(row.analysis_scope) !== filters.analysisScope) return false;
      if (filters.patternFlag && !rowMatchesPatternFlag(row, filters.patternFlag)) return false;
      if (filters.performanceEvent && !rowMatchesText(row, filters.performanceEvent, ["performance_event", "event", "metric", "metric_name", "event_name"])) return false;
      return true;
    })
  };
}

function signalMatchesPeriod(signal: JsonRecord, period: string) {
  if (period === "all") return true;
  const metric = metricForPeriod(signal, period, period);
  if (metric) return numberValue(metric.volume) > 0;
  return stringValue(signal.cut_period_label) === period || stringValue(signal.period_id) === period;
}

function signalMatchesLifecycle(signal: JsonRecord, lifecycle: string, period?: string) {
  const metric = period && period !== "all" ? metricForPeriod(signal, period, period) : null;
  return normalizeFilterValue(metric?.lifecycle_state ?? signal.lifecycle_state) === lifecycle;
}

function signalMatchesPlatform(signal: JsonRecord, platform: string, period?: string) {
  const metric = period && period !== "all" ? metricForPeriod(signal, period, period) : null;
  const sourceMix = asRecord(metric?.source_mix ?? signal.source_mix);
  if (numberValue(sourceMix[platform]) > 0) return true;
  const dimensions = asRecord(signal.dimensions);
  return stringArray(dimensions.platforms).map(normalizeFilterValue).includes(platform);
}

function signalMatchesSourceType(signal: JsonRecord, sourceType: string) {
  const dimensions = asRecord(signal.dimensions);
  return [
    signal.source_type,
    signal.source_kind,
    signal.data_source,
    dimensions.source_type,
    dimensions.source_kind,
    dimensions.data_source,
    ...stringArray(dimensions.source_types),
    ...stringArray(dimensions.sources)
  ].map(normalizeFilterValue).includes(sourceType);
}

function signalMatchesScope(signal: JsonRecord, scope: string) {
  const dimensions = asRecord(signal.dimensions);
  return [
    signal.scope,
    signal.entity_scope,
    signal.query_scope,
    signal.brand_scope,
    dimensions.scope,
    dimensions.entity_scope,
    dimensions.query_scope,
    dimensions.brand_scope,
    ...stringArray(dimensions.scopes)
  ].map(normalizeFilterValue).includes(scope);
}

function signalMatchesPatternFlag(signal: JsonRecord, patternFlag: string) {
  return patternFlagsForSignal(signal).includes(patternFlag);
}

function signalMatchesQuery(signal: JsonRecord, query: string) {
  const dimensions = asRecord(signal.dimensions);
  const contextSummary = asRecord(dimensions.context_summary);
  const haystack = [
    signal.title,
    signal.description,
    signal.signal_type,
    dimensions.signal_role,
    dimensions.marketing_read,
    signal.period_read,
    signal.window_read,
    signal.marketing_hypothesis,
    signal.next_month_decision,
    signal.marketing_read,
    signal.action_hint,
    signal.performance_connection,
    dimensions.period_read,
    dimensions.window_read,
    dimensions.marketing_hypothesis,
    dimensions.next_month_decision,
    dimensions.action_hint,
    dimensions.performance_connection,
    dimensions.evidence_basis,
    dimensions.analysis_scope,
    dimensions.campaign,
    dimensions.campaign_name,
    dimensions.performance_event,
    dimensions.event,
    ...patternFlagsForSignal(signal),
    ...stringArray(contextSummary.pattern_flag_types)
  ].map(stringValue).join(" ").toLowerCase();
  return haystack.includes(query);
}

function metricForPeriod(signal: JsonRecord, periodId: string, periodLabel: string) {
  return arrayOfRecords(signal.period_metrics).find((metric) => {
    const id = stringValue(metric.period_id);
    const label = stringValue(metric.label);
    return Boolean((periodId && id === periodId) || (periodLabel && label === periodLabel));
  }) ?? null;
}

function rowMatchesPeriod(row: JsonRecord, period: string) {
  if (period === "all") return true;
  return [row.period_id, row.label, row.period_label, row.month].map(stringValue).includes(period);
}

function rowMatchesPlatform(row: JsonRecord, platform: string) {
  if (normalizeFilterValue(row.platform) === platform || normalizeFilterValue(row.source) === platform) return true;
  const sourceMix = asRecord(row.source_mix);
  if (numberValue(sourceMix[platform]) > 0) return true;
  const coverage = asRecord(row.coverage);
  return numberValue(coverage[platform]) > 0;
}

function rowMatchesText(row: JsonRecord, query: string, fields: string[]) {
  return fields.some((field) => normalizeFilterValue(row[field]).includes(query));
}

function rowMatchesPatternFlag(row: JsonRecord, patternFlag: string) {
  return patternFlagValues([
    row.pattern_flag,
    row.primary_pattern_flag,
    row.pattern_flags,
    row.pattern_flag_types,
    asRecord(row.dimensions).pattern_flags,
    asRecord(row.dimensions).pattern_flag_types,
    asRecord(asRecord(row.dimensions).context_summary).pattern_flag_types
  ]).map(normalizePatternFlagFilter).includes(patternFlag);
}

function compactSignal(signal: JsonRecord, visibility?: SignalPulseResolvedVisibility) {
  const dimensions = asRecord(signal.dimensions);
  const patternFlags = patternFlagsForSignal(signal);
  return {
    id: stringValue(signal.id),
    title: stringValue(signal.title),
    signal_type: stringValue(signal.signal_type),
    signal_role: stringValue(dimensions.signal_role),
    analysis_scope: stringValue(dimensions.analysis_scope),
    pattern_flags: patternFlags,
    primary_pattern_flag: patternFlags[0] ?? "",
    intelligence_read: signalIntelligenceRead(signal, visibility),
    scope: stringValue(dimensions.scope || dimensions.entity_scope || signal.scope || signal.entity_scope),
    lifecycle_state: stringValue(signal.lifecycle_state),
    impact_v1: numberValue(signal.impact_v1),
    volume: numberValue(signal.volume),
    delta_prev: numberOrNull(signal.delta_prev),
    source_mix: asRecord(signal.source_mix),
    polarity_bucket: stringValue(signal.polarity_bucket),
    dominant_emotion: stringValue(signal.dominant_emotion),
    confidence: stringValue(signal.confidence),
    evidence_count: numberValue(signal.evidence_count)
  };
}

function signalIntelligenceRead(signal: JsonRecord, visibility?: SignalPulseResolvedVisibility) {
  const dimensions = asRecord(signal.dimensions);
  const marketingHypothesis = stringValue(signal.marketing_hypothesis || dimensions.marketing_hypothesis);
  return {
    pattern_flags: patternFlagsForSignal(signal),
    period_read: stringValue(signal.period_read || dimensions.period_read),
    window_read: stringValue(signal.window_read || dimensions.window_read),
    marketing_hypothesis: visibility?.showPaidOrganic === false && marketingHypothesis
      ? "Hipótesis de marketing disponible sólo con permiso de paid/organic."
      : marketingHypothesis,
    next_month_decision: stringValue(signal.next_month_decision || dimensions.next_month_decision),
    marketing_read: stringValue(signal.marketing_read || dimensions.marketing_read),
    action_hint: stringValue(signal.action_hint || dimensions.action_hint),
    performance_connection: visibility?.showPaidOrganic === false && stringValue(signal.performance_connection || dimensions.performance_connection)
      ? "Conexión a performance disponible sólo con permiso de paid/organic."
      : stringValue(signal.performance_connection || dimensions.performance_connection)
  };
}

function patternFlagsForSignal(signal: JsonRecord) {
  const dimensions = asRecord(signal.dimensions);
  const contextSummary = asRecord(dimensions.context_summary);
  return Array.from(new Set(patternFlagValues([
    signal.pattern_flag,
    signal.primary_pattern_flag,
    signal.pattern_flags,
    signal.pattern_flag_types,
    dimensions.pattern_flag,
    dimensions.primary_pattern_flag,
    dimensions.pattern_flags,
    dimensions.pattern_flag_types,
    contextSummary.pattern_flag_types
  ]).map(normalizePatternFlagFilter).filter(Boolean)));
}

function patternFlagValues(values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return patternFlagValues(value);
    const record = asRecord(value);
    if (record.type) return [stringValue(record.type)];
    return [stringValue(value)];
  }).filter(Boolean);
}

function compactMove(move: JsonRecord) {
  return {
    id: stringValue(move.id),
    move_type: stringValue(move.move_type),
    action_text: stringValue(move.action_text),
    signal_refs: stringArray(move.signal_refs),
    owner_suggestion: stringValue(move.owner_suggestion),
    timing: stringValue(move.timing),
    measurement_suggestion: stringValue(move.measurement_suggestion),
    confidence: stringValue(move.confidence),
    status: stringValue(move.status)
  };
}

function chartInventory(payload: JsonRecord, visibility: SignalPulseResolvedVisibility) {
  return Object.fromEntries(
    Object.keys(chartRefs(payload, visibility)).map((key) => [key, key])
  );
}

function chartRefs(payload: JsonRecord, visibility?: SignalPulseResolvedVisibility) {
  const refs = asRecord(payload.chart_refs);
  return visibility ? sanitizePulseChartRefsForVisibility(refs, visibility) : refs;
}

function chartAlias(value: string) {
  const aliases: Record<string, string> = {
    galaxy: "semantic_signal_galaxy",
    semantic_galaxy: "semantic_signal_galaxy",
    impact_polarity: "impact_polarity_map",
    momentum: "signal_momentum_stream",
    coverage: "source_coverage_strip"
  };
  return aliases[value] ?? value;
}

function isPaidChartKey(value: string) {
  const key = value.toLowerCase();
  return key.includes("paid") || key.includes("organic") || key.includes("performance") || key.includes("campaign");
}

function stripPaidCoverage(coverage: JsonRecord) {
  const output = { ...coverage };
  delete output.performance;
  delete output.spend;
  delete output.impressions;
  delete output.clicks;
  delete output.conversions;
  return output;
}

function confidenceFromSignals(signals: JsonRecord[]) {
  if (signals.some((signal) => stringValue(signal.confidence) === "alta")) return "alta";
  if (signals.some((signal) => stringValue(signal.confidence) === "media")) return "media";
  return signals.length > 0 ? "baja" : "sin_datos";
}

function warningList(payload: JsonRecord) {
  return [
    ...arrayValue(payload.limitations).map(String),
    ...arrayOfRecords(payload.quality_gates)
      .filter((gate) => gate.passed !== true)
      .map((gate) => stringValue(gate.detail) || stringValue(gate.id))
  ].filter(Boolean).slice(0, 12);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return arrayValue(value).map(asRecord);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function stringArray(value: unknown) {
  return arrayValue(value).map(stringValue).filter(Boolean);
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function queryValue(searchParams: URLSearchParams, ...keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value != null) return value;
  }
  return undefined;
}

function normalizeRawFilterValue(value: unknown) {
  return stringValue(value).trim();
}

function normalizeFilterValue(value: unknown) {
  return normalizeRawFilterValue(value).toLowerCase();
}

function normalizeAnalysisScopeFilter(value: unknown) {
  return normalizeFilterValue(value).replace(/[\s-]+/g, "_");
}

function normalizePatternFlagFilter(value: unknown) {
  return normalizeFilterValue(value).replace(/[\s-]+/g, "_");
}
