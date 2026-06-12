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
}) {
  const report = asRecord(args.payload.report);
  const executiveRead = asRecord(args.payload.executive_read);
  const periods = arrayOfRecords(args.payload.periods);
  const signals = arrayOfRecords(args.payload.signals);
  const moves = arrayOfRecords(args.payload.marketing_moves);
  const qualityGates = arrayOfRecords(args.payload.quality_gates);
  const cost = asRecord(args.payload.cost);
  const activePeriod = periods.at(-1) ?? null;
  const topSignals = signals.slice(0, 8).map(compactSignal);
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
    charts: chartInventory(args.payload),
    top_signals: topSignals,
    top_moves: topMoves,
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
}) {
  const periods = arrayOfRecords(args.payload.periods);
  const evidence = args.visibility.showEvidence ? arrayOfRecords(args.payload.evidence) : [];
  const moves = arrayOfRecords(args.payload.marketing_moves);
  const signals: JsonRecord[] = arrayOfRecords(args.payload.signals).map((signal) => enrichSignal(signal, { periods, evidence, moves }));

  if (args.signalId) {
    const signal = signals.find((item) => stringValue(item.id) === args.signalId);
    return signal ? { signal } : null;
  }

  return {
    signals,
    count: signals.length,
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
}) {
  const signals = new Map(arrayOfRecords(args.payload.signals).map((signal) => [stringValue(signal.id), compactSignal(signal)]));
  const evidence = args.visibility.showEvidence ? arrayOfRecords(args.payload.evidence) : [];
  const moves: JsonRecord[] = arrayOfRecords(args.payload.marketing_moves).map((move) => {
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
    count: moves.length
  };
}

export function buildPulseChartResponse(args: {
  payload: JsonRecord;
  dataRef: string;
}) {
  const charts = chartRefs(args.payload);
  const chart = charts[args.dataRef] ?? charts[chartAlias(args.dataRef)];
  if (!chart) return null;
  return {
    data_ref: args.dataRef,
    chart_key: chartAlias(args.dataRef),
    payload: chart
  };
}

function enrichSignal(signal: JsonRecord, args: { periods: JsonRecord[]; evidence: JsonRecord[]; moves: JsonRecord[] }): JsonRecord {
  const signalId = stringValue(signal.id);
  return {
    ...signal,
    evidence: args.evidence.filter((item) => stringValue(item.signal_id) === signalId),
    moves: args.moves.filter((move) => stringArray(move.signal_refs).includes(signalId)),
    period_summary: args.periods.map((period) => ({
      period_id: stringValue(period.id),
      label: stringValue(period.label),
      comparable: period.comparable !== false
    }))
  };
}

function compactSignal(signal: JsonRecord) {
  return {
    id: stringValue(signal.id),
    title: stringValue(signal.title),
    signal_type: stringValue(signal.signal_type),
    lifecycle_state: stringValue(signal.lifecycle_state),
    impact_v1: numberValue(signal.impact_v1),
    volume: numberValue(signal.volume),
    delta_prev: numberOrNull(signal.delta_prev),
    polarity_bucket: stringValue(signal.polarity_bucket),
    dominant_emotion: stringValue(signal.dominant_emotion),
    confidence: stringValue(signal.confidence),
    evidence_count: numberValue(signal.evidence_count)
  };
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

function chartInventory(payload: JsonRecord) {
  return Object.fromEntries(
    Object.keys(chartRefs(payload)).map((key) => [key, key])
  );
}

function chartRefs(payload: JsonRecord) {
  return asRecord(payload.chart_refs);
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
