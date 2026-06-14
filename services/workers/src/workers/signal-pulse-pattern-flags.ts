export type SignalPulsePatternSeriesPoint = {
  label: string;
  volume: number;
  delta_prev: number | null;
};

export type SignalPulsePatternWindow = {
  current_period: string | null;
  current_volume: number;
  previous_volume: number;
  delta_prev: number | null;
  active_periods: number;
  first_active_period: string | null;
  last_active_period: string | null;
  peak_period: string | null;
  peak_volume: number;
  lifecycle_state: string;
};

export type SignalPulsePatternMarketingIntersection = {
  period_label: string;
  basis: string;
  campaign_count: number;
  matching_creative_count: number;
  performance_event_count: number;
};

export type SignalPulsePatternFlag = {
  type:
    | "new_in_cut"
    | "repeated_window"
    | "saturation_candidate"
    | "reactivated"
    | "accelerating"
    | "declining"
    | "inactive_in_cut"
    | "weekly_spike"
    | "marketing_overlap"
    | "temporal_marketing_context"
    | "conversation_only";
  severity: "high" | "medium" | "low";
  detail: string;
  evidence_periods: string[];
  metrics: Record<string, number | string | null>;
};

export function buildSignalPulsePatternFlags(args: {
  periodSeries: SignalPulsePatternSeriesPoint[];
  weeklySeries: SignalPulsePatternSeriesPoint[];
  windowPattern: SignalPulsePatternWindow;
  weeklyPattern: SignalPulsePatternWindow;
  marketingIntersections: SignalPulsePatternMarketingIntersection[];
  hasDirectMarketingOverlap: boolean;
}): SignalPulsePatternFlag[] {
  const flags: SignalPulsePatternFlag[] = [];
  const activePeriods = args.periodSeries.filter((period) => period.volume > 0);
  const current = args.periodSeries.at(-1) ?? null;
  const previous = args.periodSeries.at(-2) ?? null;
  const currentVolume = current?.volume ?? 0;
  const previousVolume = previous?.volume ?? 0;
  const deltaPrev = current && previous ? current.volume - previous.volume : null;
  const windowVolume = args.periodSeries.reduce((sum, period) => sum + period.volume, 0);
  const activeVolume = activePeriods.reduce((sum, period) => sum + period.volume, 0);
  const activeAverage = activePeriods.length > 0 ? activeVolume / activePeriods.length : 0;
  const activeLabels = activePeriods.map((period) => period.label);
  const currentPeriod = current?.label ?? args.windowPattern.current_period ?? null;
  const baseMetrics = {
    current_volume: currentVolume,
    previous_volume: previousVolume,
    delta_prev: deltaPrev,
    active_periods: activePeriods.length,
    window_volume: windowVolume,
    peak_period: args.windowPattern.peak_period,
    peak_volume: args.windowPattern.peak_volume
  };

  if (currentVolume > 0 && activePeriods.length === 1) {
    flags.push({
      type: "new_in_cut",
      severity: currentVolume >= 30 ? "high" : currentVolume >= 8 ? "medium" : "low",
      detail: `El cluster aparece por primera vez en ${currentPeriod ?? "el corte actual"}; tratar como señal emergente, no como patrón histórico todavía.`,
      evidence_periods: currentPeriod ? [currentPeriod] : [],
      metrics: baseMetrics
    });
  }

  if (currentVolume === 0 && activePeriods.length > 0) {
    flags.push({
      type: "inactive_in_cut",
      severity: activePeriods.length >= 4 ? "medium" : "low",
      detail: "La señal existe en la ventana pero no aparece en el corte actual; usarla sólo como contexto histórico salvo que explique una decisión de marketing.",
      evidence_periods: activeLabels.slice(-4),
      metrics: baseMetrics
    });
  }

  if (currentVolume > 0 && previousVolume === 0 && activePeriods.length > 1) {
    flags.push({
      type: "reactivated",
      severity: currentVolume >= Math.max(20, activeAverage) ? "high" : "medium",
      detail: `La conversación regresa en ${currentPeriod ?? "el corte actual"} después de al menos un periodo sin volumen; revisar qué cambió en campaña, fuente o contexto.`,
      evidence_periods: [activePeriods.at(-2)?.label, currentPeriod].filter((label): label is string => Boolean(label)),
      metrics: baseMetrics
    });
  }

  if (currentVolume > 0 && deltaPrev !== null && deltaPrev > 0) {
    const deltaPct = previousVolume > 0 ? round((deltaPrev / previousVolume) * 100, 2) : null;
    const meaningfulLift = previousVolume === 0 || deltaPrev >= Math.max(8, previousVolume * 0.35);
    if (meaningfulLift) {
      flags.push({
        type: "accelerating",
        severity: deltaPct === null || deltaPct >= 100 || deltaPrev >= 50 ? "high" : "medium",
        detail: "El corte actual crece contra el periodo previo; usar el delta para explicar si es pico real o continuidad de ventana.",
        evidence_periods: [previous?.label, currentPeriod].filter((label): label is string => Boolean(label)),
        metrics: {
          ...baseMetrics,
          delta_pct: deltaPct
        }
      });
    }
  }

  if (currentVolume > 0 && deltaPrev !== null && deltaPrev < 0) {
    const drop = Math.abs(deltaPrev);
    if (drop >= Math.max(8, previousVolume * 0.35)) {
      flags.push({
        type: "declining",
        severity: drop >= Math.max(30, previousVolume * 0.6) ? "high" : "medium",
        detail: "La señal baja contra el periodo previo; evitar amplificarla como oportunidad si la ventana muestra pérdida de tracción.",
        evidence_periods: [previous?.label, currentPeriod].filter((label): label is string => Boolean(label)),
        metrics: baseMetrics
      });
    }
  }

  if (currentVolume > 0 && activePeriods.length >= 3) {
    flags.push({
      type: "repeated_window",
      severity: activePeriods.length >= 6 ? "high" : "medium",
      detail: `La señal aparece en ${activePeriods.length} periodos de la ventana; leerla como repetición o aprendizaje acumulado, no como hallazgo aislado del mes.`,
      evidence_periods: activeLabels.slice(-6),
      metrics: baseMetrics
    });
  }

  if (currentVolume > 0 && activePeriods.length >= 4 && currentVolume >= Math.max(8, activeAverage * 0.7)) {
    flags.push({
      type: "saturation_candidate",
      severity: activePeriods.length >= 6 && currentVolume >= activeAverage ? "high" : "medium",
      detail: "La señal mantiene presencia en varios meses; revisar si la marca o la categoría están repitiendo un territorio sin nuevo aprendizaje.",
      evidence_periods: activeLabels.slice(-6),
      metrics: {
        ...baseMetrics,
        active_average_volume: round(activeAverage, 2)
      }
    });
  }

  const weeklyCurrent = args.weeklySeries.at(-1) ?? null;
  const weeklyPrevious = args.weeklySeries.at(-2) ?? null;
  const weeklyDelta = weeklyCurrent && weeklyPrevious ? weeklyCurrent.volume - weeklyPrevious.volume : null;
  const weeklyPeak = args.weeklySeries.slice().sort((a, b) => b.volume - a.volume)[0] ?? null;
  if (weeklyCurrent && weeklyCurrent.volume > 0 && weeklyDelta !== null && weeklyDelta >= Math.max(5, (weeklyPrevious?.volume ?? 0) * 0.5)) {
    flags.push({
      type: "weekly_spike",
      severity: weeklyDelta >= 30 || weeklyCurrent.volume === weeklyPeak?.volume ? "high" : "medium",
      detail: "Dentro del corte hay un pico semanal; usarlo para ubicar timing de campaña, pauta o conversación externa antes de concluir.",
      evidence_periods: [weeklyPrevious?.label, weeklyCurrent.label].filter((label): label is string => Boolean(label)),
      metrics: {
        weekly_current_volume: weeklyCurrent.volume,
        weekly_previous_volume: weeklyPrevious?.volume ?? 0,
        weekly_delta_prev: weeklyDelta,
        weekly_peak_period: weeklyPeak?.label ?? null,
        weekly_peak_volume: weeklyPeak?.volume ?? 0
      }
    });
  } else if (args.weeklyPattern.current_volume > 0 && args.weeklyPattern.peak_volume > Math.max(8, args.weeklyPattern.current_volume * 1.5)) {
    flags.push({
      type: "weekly_spike",
      severity: "medium",
      detail: "La serie semanal tuvo un pico dentro de la ventana; revisar si el aprendizaje vive en una semana específica y no en todo el mes.",
      evidence_periods: [args.weeklyPattern.peak_period].filter((label): label is string => Boolean(label)),
      metrics: {
        weekly_current_volume: args.weeklyPattern.current_volume,
        weekly_peak_period: args.weeklyPattern.peak_period,
        weekly_peak_volume: args.weeklyPattern.peak_volume
      }
    });
  }

  const directIntersections = args.marketingIntersections.filter((intersection) => (
    intersection.basis === "creative_or_campaign_language_overlaps_evidence"
    || intersection.basis === "repeated_marketing_language_overlap"
  ));
  if (args.hasDirectMarketingOverlap || directIntersections.length > 0) {
    const intersections = directIntersections.length > 0
      ? directIntersections
      : args.marketingIntersections.filter((intersection) => intersection.matching_creative_count > 0);
    flags.push({
      type: "marketing_overlap",
      severity: "high",
      detail: "Hay overlap directo entre evidencia de conversación y lenguaje/KB/creative de marketing; se puede formular hipótesis, no causalidad automática.",
      evidence_periods: intersections.map((intersection) => intersection.period_label).slice(0, 4),
      metrics: {
        matched_periods: intersections.length,
        matching_creatives: intersections.reduce((sum, intersection) => sum + intersection.matching_creative_count, 0),
        campaigns: intersections.reduce((sum, intersection) => sum + intersection.campaign_count, 0)
      }
    });
  } else if (args.marketingIntersections.some((intersection) => intersection.basis === "same_period_marketing_activity")) {
    const intersections = args.marketingIntersections.filter((intersection) => intersection.basis === "same_period_marketing_activity");
    flags.push({
      type: "temporal_marketing_context",
      severity: "low",
      detail: "Hay actividad de marketing en los mismos periodos, pero sin overlap directo de lenguaje/evidencia; debe redactarse como no_connection si se publica.",
      evidence_periods: intersections.map((intersection) => intersection.period_label).slice(0, 4),
      metrics: {
        matched_periods: intersections.length,
        campaigns: intersections.reduce((sum, intersection) => sum + intersection.campaign_count, 0),
        performance_events: intersections.reduce((sum, intersection) => sum + intersection.performance_event_count, 0)
      }
    });
  }

  if (flags.length === 0) {
    flags.push({
      type: "conversation_only",
      severity: currentVolume > 0 ? "medium" : "low",
      detail: "El caso sólo tiene evidencia conversacional suficiente para review; no hay patrón de ventana ni cruce marketing claro para publicar sin síntesis humana.",
      evidence_periods: activeLabels.slice(-4),
      metrics: baseMetrics
    });
  }

  return flags
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.type.localeCompare(b.type))
    .slice(0, 7);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function severityRank(severity: SignalPulsePatternFlag["severity"]) {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}
