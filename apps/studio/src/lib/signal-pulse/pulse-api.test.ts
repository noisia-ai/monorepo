import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPulseApiContext,
  buildPulseChartResponse,
  buildPulseMovesResponse,
  buildPulseOverviewResponse,
  buildPulseSignalsResponse,
  isSignalPulseOutput,
  pulseApiFiltersFromSearchParams,
  type PulseOutputLike
} from "./pulse-api";

const output: PulseOutputLike = {
  id: "out_sp",
  title: "Aurora Signal Pulse",
  headline: "Headline",
  summary: "Summary",
  methodologySlug: "signal-pulse",
  kind: "signal_pulse",
  brandName: "Aurora",
  brandFallbackName: "Aurora",
  themeName: null,
  visibilityConfig: {},
  payload: {
    report: {
      title: "Aurora",
      business_question: "Qué activar este mes",
      generated_from_engine_analysis_id: "ea_1"
    },
    executive_read: {
      headline: "La rutina crujiente acelera.",
      body: "La señal tiene evidencia suficiente.",
      action: "Probar un hook de rutina."
    },
    periods: [
      { id: "rp_1", label: "2026-05", comparable: true, confidence: "media", coverage: { conversation: 100, performance: 20, spend: 1000 } },
      { id: "rp_2", label: "2026-06", comparable: true, confidence: "alta", coverage: { conversation: 140, performance: 30, spend: 1200 } }
    ],
    signals: [
      {
        id: "s_1",
        title: "Rutina crujiente",
        signal_type: "opportunity",
        period_read: "En el corte 2026-06 la rutina crujiente crece en TikTok y Facebook.",
        window_read: "En la ventana de 12 meses pasa de señal emergente en mayo a nuevo pico en junio.",
        marketing_hypothesis: "La campaña Back to school coincide con lenguaje de rutina y puede explicar recepción parcial sin asumir causalidad completa.",
        next_month_decision: "Probar un hook de rutina crujiente y medir CTR, comentarios útiles y menciones orgánicas contra el control.",
        marketing_read: "El aprendizaje movible es bajar la rutina a hook creativo, no sólo amplificar sabor.",
        action_hint: "Testear rutina crujiente como claim y medir CTR contra el mensaje base.",
        performance_connection: "connected: Back to school comparte lenguaje con evidencia y sube engagement.",
        lifecycle_state: "new",
        impact_v1: "82",
        volume: 140,
        delta_prev: "12",
        source_mix: { facebook: 60, tiktok: 80 },
        period_metrics: [
          { period_id: "rp_1", label: "2026-05", volume: 44, lifecycle_state: "emerging", source_mix: { facebook: 44 } },
          { period_id: "rp_2", label: "2026-06", volume: 140, lifecycle_state: "new", source_mix: { facebook: 60, tiktok: 80 } }
        ],
        polarity_bucket: "positiva",
        dominant_emotion: "afinidad",
        dimensions: {
          signal_role: "claim a testear",
          scope: "brand",
          campaign_names: ["Back to school"],
          performance_events: ["engagement spike", "engagement up"],
          source_types: ["organic"],
          source_platforms: ["facebook", "tiktok"],
          platforms: ["facebook", "tiktok"],
          analysis_scope: "mixed",
          context_summary: {
            pattern_flag_types: ["accelerating", "marketing_overlap"]
          },
          performance_connection: "El engagement sube en el corte de junio."
        },
        confidence: "alta",
        evidence_count: 2
      },
      {
        id: "s_2",
        title: "Precio se siente alto",
        signal_type: "risk",
        period_read: "En el corte 2026-06 suben quejas de precio en Facebook.",
        window_read: "En la ventana aparece como aceleración del último mes, no como patrón saturado de todo el año.",
        marketing_hypothesis: "La campaña Promo precio y el evento de CTR drop conviven con la fricción, pero requiere revisar piezas antes de atribuir causa.",
        next_month_decision: "Auditar piezas de precio y medir sentimiento, CTR y dudas por creatividad antes de escalar.",
        marketing_read: "La pauta de precio puede estar atrayendo atención equivocada si la conversación se queda en costo percibido.",
        action_hint: "Comparar una variante de valor contra precio y medir CTR y comentarios de fricción.",
        performance_connection: "connected: Promo precio comparte periodo y evidencia con caída de CTR.",
        lifecycle_state: "accelerating",
        impact_v1: "61",
        volume: 70,
        source_mix: { facebook: 70 },
        period_metrics: [
          { period_id: "rp_2", label: "2026-06", volume: 70, lifecycle_state: "accelerating", source_mix: { facebook: 70 } }
        ],
        dimensions: {
          signal_role: "riesgo creativo",
          scope: "category",
          campaign_names: ["Promo precio"],
          performance_events: ["ctr drop"],
          source_types: ["paid"],
          source_platforms: ["facebook"],
          platforms: ["facebook"],
          analysis_scope: "current_cut",
          context_summary: {
            pattern_flag_types: ["accelerating", "temporal_marketing_context"]
          },
          performance_connection: "CTR cae mientras suben quejas por precio."
        },
        confidence: "media",
        evidence_count: 1
      },
      {
        id: "s_3",
        title: "Educación para carretera",
        signal_type: "opportunity",
        period_read: "En el corte 2026-06 no hay volumen activo de esta señal.",
        window_read: "En la ventana el tema aparece en mayo y queda como patrón histórico aislado para monitoreo.",
        marketing_hypothesis: "No hay campaña, pauta o performance conectada; la fuente de reviews sugiere oportunidad educativa independiente.",
        next_month_decision: "Monitorear si reaparece y medir volumen, sentimiento y preguntas útiles antes de producir contenido.",
        marketing_read: "Sirve como backlog de contenido educativo, no como prioridad del corte actual.",
        action_hint: "Guardar como hipótesis para educación de carretera y validar si vuelve en el siguiente mes.",
        performance_connection: "no_connection: no hay fuente estructurada conectada.",
        lifecycle_state: "inactive_in_cut",
        impact_v1: null,
        volume: 0,
        source_mix: {},
        period_metrics: [
          { period_id: "rp_1", label: "2026-05", volume: 36, lifecycle_state: "emerging", source_mix: { youtube: 36 } }
        ],
        dimensions: {
          signal_role: "senal emergente",
          scope: "category",
          source_types: ["reviews"],
          platforms: ["youtube"],
          analysis_scope: "window_pattern",
          context_summary: {
            pattern_flag_types: ["inactive_in_cut", "conversation_only"]
          },
          performance_connection: "Sin conexión suficiente con performance."
        },
        confidence: "baja",
        evidence_count: 0
      }
    ],
    marketing_moves: [
      {
        id: "m_1",
        move_type: "test_claim",
        action_text: "Probar claim de rutina crujiente.",
        signal_refs: ["s_1"],
        owner_suggestion: "Brand",
        timing: "this_month",
        measurement_suggestion: "CTR",
        confidence: "alta",
        status: "candidate"
      },
      {
        id: "m_2",
        move_type: "monitor",
        action_text: "Vigilar precio alto en pauta.",
        signal_refs: ["s_2"],
        owner_suggestion: "Media",
        timing: "this_month",
        measurement_suggestion: "Sentimiento por creatividad",
        confidence: "media",
        status: "approved"
      }
    ],
    evidence: [
      { evidence_id: "e_1", signal_id: "s_1", quote: "Lo compro para la tarde.", evidence_role: "protagonist" },
      { evidence_id: "e_2", signal_id: "s_1", quote: "Me gusta lo crujiente.", evidence_role: "support" }
    ],
    chart_refs: {
      impact_polarity_map: { rows: [{ signal_id: "s_1", impact: 82, signal_type: "opportunity" }] },
      signal_momentum_stream: {
        rows: [
          { signal_id: "s_1", period_id: "rp_1", label: "2026-05", volume: 44, platform: "facebook", pattern_flags: ["accelerating", "marketing_overlap"], primary_pattern_flag: "accelerating" },
          { signal_id: "s_1", period_id: "rp_2", label: "2026-06", volume: 140, platform: "tiktok", campaign: "Back to school", source_type: "organic", scope: "brand", analysis_scope: "mixed", performance_event: "engagement spike", pattern_flags: ["accelerating", "marketing_overlap"], primary_pattern_flag: "accelerating" },
          { signal_id: "s_2", period_id: "rp_2", label: "2026-06", volume: 70, platform: "facebook", campaign: "Promo precio", source_type: "paid", scope: "category", analysis_scope: "current_cut", performance_event: "ctr drop", pattern_flags: ["accelerating", "temporal_marketing_context"], primary_pattern_flag: "accelerating" }
        ]
      },
      source_coverage_strip: { rows: [{ period_id: "rp_2", label: "2026-06", coverage: { conversation: 140, performance: 30, spend: 1200 } }] },
      paid_campaign_alignment: { rows: [{ campaign: "always on", spend: 1200 }] }
    },
    quality_gates: [
      { id: "period_coverage", passed: true, detail: "2 periodos." },
      { id: "humanizer_passed", passed: false, detail: "Revisar copy." }
    ],
    cost: { estimated_cost_usd: 0.22, budget_cap_usd: 5 },
    limitations: ["Performance parcial."]
  }
};

test("Pulse API recognizes only published Signal Pulse outputs", () => {
  assert.equal(isSignalPulseOutput(output), true);
  assert.equal(isSignalPulseOutput({ ...output, kind: "signal" }), false);
  assert.equal(isSignalPulseOutput({ ...output, methodologySlug: "triggers-barriers" }), false);
});

test("Pulse overview returns tactical KPIs, chart refs and visible warnings", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const overview = buildPulseOverviewResponse({ output, ...context });

  assert.equal(overview.brand_name, "Aurora");
  assert.equal(overview.active_period, "rp_2");
  assert.equal(overview.kpis.signals_active, 2);
  assert.equal(overview.kpis.new_this_period, 1);
  assert.equal(overview.kpis.risks, 1);
  assert.deepEqual(overview.charts, {
    impact_polarity_map: "impact_polarity_map",
    signal_momentum_stream: "signal_momentum_stream",
    source_coverage_strip: "source_coverage_strip",
    paid_campaign_alignment: "paid_campaign_alignment"
  });
  assert.equal(overview.top_signals[0]?.impact_v1, 82);
  assert.deepEqual((overview.top_signals[0] as Record<string, unknown>).filter_metadata, {
    campaign_names: ["Back to school"],
    performance_events: ["engagement spike", "engagement up"],
    source_types: ["organic"],
    source_platforms: ["facebook", "tiktok"],
    marketing_periods: []
  });
  assert.deepEqual((overview.top_signals[0] as Record<string, unknown>).intelligence_read, {
    pattern_flags: ["accelerating", "marketing_overlap"],
    period_read: "En el corte 2026-06 la rutina crujiente crece en TikTok y Facebook.",
    window_read: "En la ventana de 12 meses pasa de señal emergente en mayo a nuevo pico en junio.",
    marketing_hypothesis: "La campaña Back to school coincide con lenguaje de rutina y puede explicar recepción parcial sin asumir causalidad completa.",
    next_month_decision: "Probar un hook de rutina crujiente y medir CTR, comentarios útiles y menciones orgánicas contra el control.",
    marketing_read: "El aprendizaje movible es bajar la rutina a hook creativo, no sólo amplificar sabor.",
    action_hint: "Testear rutina crujiente como claim y medir CTR contra el mensaje base.",
    performance_connection: "connected: Back to school comparte lenguaje con evidencia y sube engagement."
  });
  assert.match(overview.warnings.join(" "), /Performance parcial/);
});

test("Pulse signals respect evidence visibility for clients", () => {
  const context = buildPulseApiContext({
    output: { ...output, visibilityConfig: { evidence: false } },
    isInternalUser: false
  });
  const signals = buildPulseSignalsResponse({ ...context });
  const detail = buildPulseSignalsResponse({ ...context, signalId: "s_1" });

  assert.ok(signals && "signals" in signals);
  assert.ok(detail && "signal" in detail);
  const signalList = signals as { count: number; signals: Array<Record<string, unknown>> };
  const firstSignal = signalList.signals[0] as Record<string, unknown>;
  const detailSignal = detail.signal as Record<string, unknown>;
  assert.equal(signalList.count, 2);
  assert.equal((firstSignal.evidence as unknown[]).length, 0);
  assert.equal((detailSignal.evidence as unknown[]).length, 0);
  assert.equal(((firstSignal.intelligence_read as Record<string, unknown>).marketing_hypothesis), "Hipótesis de marketing disponible sólo con permiso de paid/organic.");
  assert.equal(((firstSignal.intelligence_read as Record<string, unknown>).performance_connection), "Conexión a performance disponible sólo con permiso de paid/organic.");
  assert.equal(buildPulseSignalsResponse({ ...context, signalId: "missing" }), null);
});

test("Pulse signals expose evidence internally and moves group by status", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const detail = buildPulseSignalsResponse({ ...context, signalId: "s_1" });
  const moves = buildPulseMovesResponse(context);

  assert.ok(detail && "signal" in detail);
  const detailSignal = detail.signal as Record<string, unknown>;
  assert.equal((detailSignal.evidence as unknown[]).length, 2);
  assert.equal((detailSignal.moves as unknown[]).length, 1);
  assert.equal((detailSignal.intelligence_read as Record<string, unknown>).next_month_decision, "Probar un hook de rutina crujiente y medir CTR, comentarios útiles y menciones orgánicas contra el control.");
  assert.equal(moves.count, 2);
  assert.equal(moves.board.candidate?.length, 1);
  assert.equal(moves.board.approved?.length, 1);
  assert.equal(((moves.moves[0] as Record<string, unknown>).evidence as unknown[]).length, 2);
});

test("Pulse chart endpoint resolves aliases for internal users", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const chart = buildPulseChartResponse({ payload: context.payload, dataRef: "impact_polarity", visibility: context.visibility });

  assert.equal(chart?.chart_key, "impact_polarity_map");
  assert.deepEqual(chart?.payload, { rows: [{ signal_id: "s_1", impact: 82, signal_type: "opportunity" }] });
  assert.equal(buildPulseChartResponse({ payload: context.payload, dataRef: "nope", visibility: context.visibility }), null);
});

test("Pulse API strips paid coverage and paid charts for clients without paid permission", () => {
  const context = buildPulseApiContext({ output, isInternalUser: false });
  const overview = buildPulseOverviewResponse({ output, ...context });
  const coverageChart = buildPulseChartResponse({ payload: context.payload, dataRef: "coverage", visibility: context.visibility });
  const paidChart = buildPulseChartResponse({ payload: context.payload, dataRef: "paid_campaign_alignment", visibility: context.visibility });

  assert.equal(context.visibility.showPaidOrganic, false);
  assert.deepEqual((overview.periods[0] as Record<string, unknown>).coverage, { conversation: 100 });
  assert.deepEqual(overview.charts, {
    impact_polarity_map: "impact_polarity_map",
    signal_momentum_stream: "signal_momentum_stream",
    source_coverage_strip: "source_coverage_strip"
  });
  assert.equal(paidChart, null);
  assert.deepEqual(coverageChart?.payload, {
    rows: [{ period_id: "rp_2", label: "2026-06", coverage: { conversation: 140 } }]
  });
});

test("Pulse endpoints can filter the 12-month intelligence by period and platform", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const maySignals = buildPulseSignalsResponse({ ...context, filters: { period: "rp_1", platform: "facebook" } });
  const allSignals = buildPulseSignalsResponse({ ...context, filters: { period: "all" } });
  const historicalDetail = buildPulseSignalsResponse({ ...context, signalId: "s_3" });
  const tiktokOverview = buildPulseOverviewResponse({ output, ...context, filters: { platform: "TikTok" } });
  const tiktokMoves = buildPulseMovesResponse({ ...context, filters: { platform: "tiktok" } });

  assert.ok(maySignals && "signals" in maySignals);
  assert.ok(allSignals && "signals" in allSignals);
  assert.ok(historicalDetail && "signal" in historicalDetail);
  const historicalSignal = historicalDetail.signal as Record<string, unknown>;
  assert.equal(maySignals.count, 1);
  assert.equal((maySignals.signals[0] as Record<string, unknown>).id, "s_1");
  assert.equal(allSignals.count, 3);
  assert.equal(historicalSignal.id, "s_3");
  assert.equal(tiktokOverview.kpis.signals_active, 1);
  assert.equal(tiktokOverview.top_signals[0]?.id, "s_1");
  assert.equal(tiktokOverview.filters.platform, "tiktok");
  assert.equal(tiktokMoves.count, 1);
  assert.equal(tiktokMoves.moves[0]?.id, "m_1");
});

test("Pulse endpoints can filter window-pattern signals separately from the monthly cut", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const windowSignals = buildPulseSignalsResponse({ ...context, filters: { period: "all", analysisScope: "window_pattern" } });
  const currentSignals = buildPulseSignalsResponse({ ...context, filters: { period: "all", analysisScope: "current_cut" } });

  assert.ok(windowSignals && "signals" in windowSignals);
  assert.ok(currentSignals && "signals" in currentSignals);
  assert.equal(windowSignals.count, 1);
  assert.equal((windowSignals.signals[0] as Record<string, unknown>).id, "s_3");
  assert.equal(currentSignals.count, 1);
  assert.equal((currentSignals.signals[0] as Record<string, unknown>).id, "s_2");
});

test("Pulse moves and charts respect tactical filters", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const approvedMoves = buildPulseMovesResponse({ ...context, filters: { moveType: "monitor", status: "approved" } });
  const momentum = buildPulseChartResponse({
    payload: context.payload,
    dataRef: "momentum",
    visibility: context.visibility,
    filters: { period: "rp_2", platform: "facebook" }
  });

  assert.equal(approvedMoves.count, 1);
  assert.equal(approvedMoves.moves[0]?.id, "m_2");
  assert.deepEqual(momentum?.payload, {
    rows: [{ signal_id: "s_2", period_id: "rp_2", label: "2026-06", volume: 70, platform: "facebook", campaign: "Promo precio", source_type: "paid", scope: "category", analysis_scope: "current_cut", performance_event: "ctr drop", pattern_flags: ["accelerating", "temporal_marketing_context"], primary_pattern_flag: "accelerating" }]
  });
});

test("Pulse filters cover campaigns, source type, scope and performance events", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const campaignSignals = buildPulseSignalsResponse({ ...context, filters: { campaign: "back to school" } });
  const scopedMoves = buildPulseMovesResponse({ ...context, filters: { sourceType: "paid", scope: "category", performanceEvent: "ctr drop" } });
  const campaignChart = buildPulseChartResponse({
    payload: context.payload,
    dataRef: "momentum",
    visibility: context.visibility,
    filters: { campaign: "promo precio", sourceType: "paid", scope: "category" }
  });

  assert.ok(campaignSignals && "signals" in campaignSignals);
  assert.equal(campaignSignals.count, 1);
  assert.equal((campaignSignals.signals[0] as Record<string, unknown>).id, "s_1");
  assert.equal(scopedMoves.count, 1);
  assert.equal(scopedMoves.moves[0]?.id, "m_2");
  assert.deepEqual(campaignChart?.payload, {
    rows: [{ signal_id: "s_2", period_id: "rp_2", label: "2026-06", volume: 70, platform: "facebook", campaign: "Promo precio", source_type: "paid", scope: "category", analysis_scope: "current_cut", performance_event: "ctr drop", pattern_flags: ["accelerating", "temporal_marketing_context"], primary_pattern_flag: "accelerating" }]
  });
});

test("Pulse endpoints filter calculated 12-month pattern flags", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const overlapSignals = buildPulseSignalsResponse({ ...context, filters: { period: "all", patternFlag: "marketing overlap" } });
  const temporalMoves = buildPulseMovesResponse({ ...context, filters: { patternFlag: "temporal_marketing_context" } });
  const temporalChart = buildPulseChartResponse({
    payload: context.payload,
    dataRef: "momentum",
    visibility: context.visibility,
    filters: { patternFlag: "temporal marketing context" }
  });

  assert.ok(overlapSignals && "signals" in overlapSignals);
  assert.equal(overlapSignals.count, 1);
  assert.equal((overlapSignals.signals[0] as Record<string, unknown>).id, "s_1");
  assert.deepEqual((overlapSignals.signals[0] as Record<string, unknown>).pattern_flags, ["accelerating", "marketing_overlap"]);
  assert.equal(temporalMoves.count, 1);
  assert.equal(temporalMoves.moves[0]?.id, "m_2");
  assert.deepEqual(temporalChart?.payload, {
    rows: [{ signal_id: "s_2", period_id: "rp_2", label: "2026-06", volume: 70, platform: "facebook", campaign: "Promo precio", source_type: "paid", scope: "category", analysis_scope: "current_cut", performance_event: "ctr drop", pattern_flags: ["accelerating", "temporal_marketing_context"], primary_pattern_flag: "accelerating" }]
  });
});

test("Pulse signal search includes intelligence reads, not only titles or metrics", () => {
  const context = buildPulseApiContext({ output, isInternalUser: true });
  const windowSearch = buildPulseSignalsResponse({ ...context, filters: { period: "all", q: "patrón histórico aislado" } });
  const decisionSearch = buildPulseSignalsResponse({ ...context, filters: { period: "all", q: "comentarios útiles" } });

  assert.ok(windowSearch && "signals" in windowSearch);
  assert.ok(decisionSearch && "signals" in decisionSearch);
  assert.equal(windowSearch.count, 1);
  assert.equal((windowSearch.signals[0] as Record<string, unknown>).id, "s_3");
  assert.equal(decisionSearch.count, 1);
  assert.equal((decisionSearch.signals[0] as Record<string, unknown>).id, "s_1");
});

test("Pulse API parses dashboard filter query params", () => {
  const filters = pulseApiFiltersFromSearchParams(new URLSearchParams("period=2026-06&platform=TikTok&campaign=Back%20to%20school&source_type=Organic&scope=Brand&analysis_scope=Window%20Pattern&pattern_flag=Marketing%20Overlap&performance_event=Spike&move_type=test_claim&q=Crujiente"));

  assert.deepEqual(filters, {
    period: "2026-06",
    platform: "tiktok",
    signalId: "",
    signalType: "",
    lifecycle: "",
    campaign: "back to school",
    moveType: "test_claim",
    sourceType: "organic",
    scope: "brand",
    analysisScope: "window_pattern",
    patternFlag: "marketing_overlap",
    performanceEvent: "spike",
    status: "",
    q: "crujiente"
  });
});
