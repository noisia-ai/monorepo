import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmbeddingNeighborhoodClusters,
  chooseSignalPulseCandidateClusters,
  selectPeriodFirstSignalPulseClusters,
  selectSignalPulseClusterPhrase,
  type EmbeddingNeighborhoodRow
} from "./signal-pulse-clustering";
import {
  estimateSignalPulseNamingCostUsd,
  estimateSignalPulseRunCostUsd,
  SIGNAL_PULSE_INTERPRETATION_COST_USD,
  SIGNAL_PULSE_RAG_CONTEXT_COST_USD,
  shouldSkipSignalPulseLlmForBudget
} from "./signal-pulse-budget";
import { buildClaudeSignalNamingPrompt } from "./signal-pulse-prompts";
import { buildSignalPulseDeterministicRead, buildSignalPulseMarketingMove } from "./signal-pulse-copy";
import { splitSignalPulseMetaForMerge } from "./signal-pulse-meta";
import { isActionableSignalPulseTerm, isRawKeywordSignalPhrase, validateSignalPulseSynthesis } from "./signal-pulse-actionability";
import { chooseSignalPulseWindowEnd } from "./signal-pulse-window";
import { summarizeSignalPulseMarketingActivity } from "./signal-pulse-marketing-activity";
import { rankSignalPulseMarketingRecordsForCluster } from "./signal-pulse-marketing-record-match";
import { buildSignalPulsePatternFlags, type SignalPulsePatternSeriesPoint, type SignalPulsePatternWindow } from "./signal-pulse-pattern-flags";

test("Signal Pulse embedding clusters group semantic neighborhoods without reusing mentions", () => {
  const rows: EmbeddingNeighborhoodRow[] = [
    row("a", "a", "Crujiente intenso para botanear viendo futbol", "tiktok", "0.42", "18", "1"),
    row("a", "b", "La botana crujiente queda perfecta con limon y chile", "tiktok", "0.31", "9", "0.86"),
    row("a", "c", "Ese crunch con chile se antoja para una tarde con amigos", "instagram", "0.28", "12", "0.82"),
    row("a", "d", "Me gusta el snack crujiente para compartir", "instagram", "0.22", "5", "0.79"),
    row("b", "b", "La botana crujiente queda perfecta con limon y chile", "tiktok", "0.31", "9", "1"),
    row("b", "e", "El empaque nuevo se ve mas premium en anaquel", "facebook", "0.18", "7", "0.81"),
    row("b", "f", "La bolsa roja destaca mucho en la tienda", "facebook", "0.16", "4", "0.8"),
    row("b", "g", "El diseno del empaque llama la atencion", "instagram", "0.19", "6", "0.78")
  ];

  const clusters = buildEmbeddingNeighborhoodClusters(rows);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.algorithm, "semantic_embedding_neighborhood_v1");
  assert.deepEqual(clusters[0]?.member_mention_ids, ["a", "b", "c", "d"]);
  assert.deepEqual(clusters[0]?.platforms, ["tiktok", "instagram"]);
  assert.equal(clusters[0]?.mention_count, 4);
  assert.equal(clusters[0]?.sentiment_avg, 0.308);
});

test("Signal Pulse semantic phrase selection prefers repeated marketing language", () => {
  const phrase = selectSignalPulseClusterPhrase([
    "Quiero una botana crujiente con chile para ver el partido.",
    "La botana crujiente con limon funciona perfecto en reuniones.",
    "Ese snack crujiente con chile se siente mas antojable.",
    "Botana crujiente para compartir con amigos."
  ]);

  assert.match(phrase, /crujiente/);
  assert.doesNotMatch(phrase, /para/);
});

test("Signal Pulse period-first selection keeps a month-specific signal outside the global top", () => {
  const globalClusters = Array.from({ length: 6 }, (_, index) => cluster({
    term: `global ${index}`,
    mentionCount: 100 - index,
    memberIds: [`g${index}-1`, `g${index}-2`, `g${index}-3`, `g${index}-4`],
    source: "global"
  }));
  const januarySpike = cluster({
    term: "renovacion enero urgente",
    mentionCount: 9,
    memberIds: ["jan-1", "jan-2", "jan-3", "jan-4", "jan-5", "jan-6", "jan-7", "jan-8", "jan-9"],
    source: "period_first",
    periods: ["2025-01"]
  });

  const selected = selectPeriodFirstSignalPulseClusters({
    globalClusters,
    periodClusters: [januarySpike],
    maxClusters: 4,
    perPeriod: 1
  });

  assert.equal(selected.some((item) => item.term === "renovacion enero urgente"), true);
  assert.equal(selected.length, 4);
  assert.deepEqual(selected.find((item) => item.term === "renovacion enero urgente")?.discovery_periods, ["2025-01"]);
});

test("Signal Pulse cluster candidates do not fall back to terms when semantic coverage exists", () => {
  const keywordCandidate = cluster({
    term: "seguro",
    mentionCount: 90,
    memberIds: ["s1", "s2", "s3", "s4"],
    source: "global"
  });

  const choice = chooseSignalPulseCandidateClusters({
    semanticClusters: [],
    termClusters: [keywordCandidate],
    semanticMentionEmbeddings: 1200
  });

  assert.deepEqual(choice.clusters, []);
  assert.equal(choice.fallbackUsed, false);
  assert.equal(choice.semanticCoverageAvailable, true);
});

test("Signal Pulse cluster candidates only use term fallback without semantic coverage", () => {
  const legacyCandidate = cluster({
    term: "renovacion enero urgente",
    mentionCount: 12,
    memberIds: ["l1", "l2", "l3", "l4"],
    source: "global"
  });

  const choice = chooseSignalPulseCandidateClusters({
    semanticClusters: [],
    termClusters: [legacyCandidate],
    semanticMentionEmbeddings: 0
  });

  assert.deepEqual(choice.clusters, [legacyCandidate]);
  assert.equal(choice.fallbackUsed, true);
  assert.equal(choice.semanticCoverageAvailable, false);
});

test("Signal Pulse deterministic copy marks clusters as synthesis backlog, not client-ready insights", () => {
  const copy = buildSignalPulseDeterministicRead({
    canonicalTitle: "Territorio botana crujiente con chile",
    term: "botana crujiente con chile",
    signalType: "opportunity",
    mentionCount: 64,
    sentimentAvg: 0.31,
    platforms: ["tiktok", "instagram"],
    rank: 1
  });

  assert.equal(copy.title, "Cluster pendiente de síntesis: Botana Crujiente Con Chile");
  assert.match(copy.description, /64 menciones/);
  assert.match(copy.description, /todavía no hay una lectura editorial publicable/);
  assert.match(copy.marketingRead, /no debe entrar al Pulse/);
  assert.match(copy.actionHint, /sintetizar el porqué/);
  assert.doesNotMatch(copy.description, /La conversacion esta agrupando/i);
  assert.doesNotMatch(copy.description, /senal|conclusion|esta empujando/i);
  assert.doesNotMatch(copy.marketingRead, /Probar contenido o pauta alrededor/i);
});

test("Signal Pulse deterministic copy never turns risk clusters into publishable frictions by itself", () => {
  const risk = buildSignalPulseDeterministicRead({
    canonicalTitle: "Territorio empaque roto",
    term: "empaque roto",
    signalType: "risk",
    mentionCount: 18,
    sentimentAvg: -0.34,
    platforms: ["facebook"],
    rank: 2
  });
  const directional = buildSignalPulseDeterministicRead({
    canonicalTitle: "Territorio merch especial",
    term: "merch especial",
    signalType: "marketing_signal",
    mentionCount: 6,
    sentimentAvg: 0.02,
    platforms: [],
    rank: 5
  });

  assert.equal(risk.title, "Cluster pendiente de síntesis: Empaque Roto");
  assert.match(risk.marketingRead, /Pendiente de síntesis/);
  assert.match(risk.actionHint, /Revisar muestras/);
  assert.equal(directional.title, "Cluster pendiente de síntesis: Merch Especial");
  assert.match(directional.description, /apenas alcanzan para monitoreo/);
  assert.match(directional.actionHint, /sintetizar/);
});

test("Signal Pulse accepts raw cluster anchors but still identifies raw output phrases", () => {
  for (const term of ["seguro", "aseguradora", "choque", "seguro auto"]) {
    assert.equal(isActionableSignalPulseTerm(term), true, term);
    assert.equal(isRawKeywordSignalPhrase(term), true, term);
  }

  assert.equal(isActionableSignalPulseTerm("renovacion enero urgente"), true);
  assert.equal(isRawKeywordSignalPhrase("renovacion enero urgente"), false);
  assert.equal(isActionableSignalPulseTerm("morena"), false);
});

test("Signal Pulse synthesis validation requires marketing-first qualitative reads", () => {
  const valid = validateSignalPulseSynthesis({
    title: "Gap de pauta: La campaña habla de confianza, pero la conversación pide claridad",
    description: "En 2026-05 la conversación sube desde dudas sobre claridad de respuesta; no es sólo volumen, coincide con una pieza de confianza y aparece en el pico semanal.",
    marketingRead: "La pauta está empujando confianza, pero la evidencia muestra que el aprendizaje movible es claridad operativa antes que promesa emocional.",
    actionHint: "Probar una pieza de claridad sobre tiempos de respuesta y medir dudas, comentarios útiles y CTR contra el claim de confianza",
    signalRole: "paid_gap",
    analysisScope: "mixed",
    periodRead: "En el corte 2026-05 suben las dudas sobre claridad de respuesta y el pico semanal concentra menciones trazables.",
    windowRead: "En la ventana de 12 meses el tema pasa de ruido estable a patrón emergente repetido, con mayo como reactivación frente a abril.",
    marketingHypothesis: "La hipótesis marketing es un gap de pauta: la campaña y el brief empujan confianza, pero la conversación pide claridad operativa.",
    nextMonthDecision: "El próximo mes hay que probar una pieza de claridad, medir dudas, comentarios útiles y CTR contra el claim de confianza.",
    performanceConnection: "connected: creative y brief comparten lenguaje de confianza con evidencia de dudas en mayo",
    evidenceBasis: "Samples 11111111-1111-4111-8111-111111111111 y periodo 2026-05 sostienen la lectura.",
    confidenceRationale: "Publicable porque cruza serie mensual, pico semanal, overlap de creative text y evidencia semántica trazable.",
    contextSummary: strongContextSummary({ direct_marketing_matches: 1 })
  });

  assert.equal(valid.publishable, true);
  assert.deepEqual(valid.reasons, []);

  const keyword = validateSignalPulseSynthesis({
    title: "Fricción: Seguro",
    description: "134 menciones sostienen una señal con tracción suficiente. El corpus está empujando seguro.",
    marketingRead: "Usar seguro como experimento de contenido.",
    actionHint: "Usar \"seguro\" como experimento de contenido",
    signalRole: "friction",
    analysisScope: "current_cut",
    periodRead: "Se ve seguro este mes.",
    windowRead: "No hay lectura de ventana.",
    marketingHypothesis: "Usar seguro como contenido.",
    nextMonthDecision: "Publicar algo.",
    performanceConnection: "no_connection: sólo comparte periodo",
    evidenceBasis: "No hay evidencia trazable.",
    confidenceRationale: "Se ve volumen.",
    contextSummary: strongContextSummary({ current_volume: 134, active_periods: 1, direct_marketing_matches: 0 })
  });

  assert.equal(keyword.publishable, false);
  assert.ok(keyword.reasons.includes("title_keyword_or_non_synthetic"));
  assert.ok(keyword.reasons.includes("generic_keyword_template_copy"));
  assert.ok(keyword.reasons.includes("evidence_basis_without_mention_id"));
  assert.ok(keyword.reasons.includes("window_read_too_thin"));
  assert.ok(keyword.reasons.includes("next_month_decision_not_measurable"));
});

test("Signal Pulse synthesis validation blocks connected performance claims without direct overlap", () => {
  const result = validateSignalPulseSynthesis({
    title: "Riesgo creativo: La promesa de rapidez choca con quejas sobre trámites",
    description: "En 2026-05 aparecen quejas de trámites con volumen suficiente y patrón semanal; la lectura pide revisar el claim antes de amplificar.",
    marketingRead: "El riesgo no es que la gente rechace la marca completa, sino que el claim de rapidez queda expuesto si la experiencia habla de trámites.",
    actionHint: "Auditar piezas con promesa de rapidez y probar una variante que explique pasos, tiempos y resolución esperada",
    signalRole: "creative_risk",
    analysisScope: "mixed",
    periodRead: "En el corte 2026-05 las quejas de trámites crecen con evidencia trazable en el pico semanal.",
    windowRead: "En la ventana de 12 meses la fricción se repite y se reactiva cuando aparece lenguaje de rapidez en campaña.",
    marketingHypothesis: "La hipótesis marketing conecta el claim creativo de rapidez con conversación sobre trámites, pero falta overlap directo.",
    nextMonthDecision: "Auditar las piezas de rapidez y medir dudas, quejas y comentarios útiles antes de volver a escalar el claim.",
    performanceConnection: "connected: coincide con campaña de rapidez en mayo",
    evidenceBasis: "Sample 22222222-2222-4222-8222-222222222222 y periodo 2026-05 muestran la tensión.",
    confidenceRationale: "Hay evidencia textual, series mensuales y pico semanal, pero falta overlap directo con creative text.",
    contextSummary: strongContextSummary({ direct_marketing_matches: 0 })
  });

  assert.equal(result.publishable, false);
  assert.ok(result.reasons.includes("connected_without_direct_marketing_overlap"));
});

test("Signal Pulse synthesis validation requires marketing hypothesis to match connection status", () => {
  const result = validateSignalPulseSynthesis({
    title: "Oportunidad: Educación práctica sobre choques en cadena reduce confusión operativa",
    description: "En 2026-05 aparecen preguntas sobre choques en cadena con suficiente evidencia y una lectura útil para contenido educativo.",
    marketingRead: "La oportunidad movible es convertir dudas operativas en contenido de servicio sin prometer resolución total.",
    actionHint: "Probar un carrusel educativo y medir dudas, comentarios útiles y menciones de claridad frente al baseline",
    signalRole: "content_opportunity",
    analysisScope: "mixed",
    periodRead: "En el corte 2026-05 las preguntas sobre choques en cadena crecen con evidencia trazable en el mes.",
    windowRead: "En la ventana de 12 meses el tema aparece como señal emergente repetida y vuelve a concentrarse en mayo.",
    marketingHypothesis: "La campaña de confianza explica la recepción y debería amplificarse como contenido de resolución.",
    nextMonthDecision: "Probar contenido educativo y medir dudas, comentarios útiles, CTR y menciones de claridad contra control.",
    performanceConnection: "no_connection: no hay overlap directo con campaña, brief o creative text.",
    evidenceBasis: "Sample 33333333-3333-4333-8333-333333333333 y periodo 2026-05 sostienen la lectura.",
    confidenceRationale: "Hay evidencia textual, RAG de conversación y serie mensual, pero no hay conexión de marketing demostrada.",
    contextSummary: strongContextSummary({ direct_marketing_matches: 0 })
  });

  assert.equal(result.publishable, false);
  assert.ok(result.reasons.includes("marketing_hypothesis_connection_mismatch"));
});

test("Signal Pulse synthesis validation forces window scope for window pattern flags", () => {
  const result = validateSignalPulseSynthesis({
    title: "Territorio saturado: Seguro auto como claim genérico ya no diferencia la conversación",
    description: "En 2026-05 el claim de seguro auto conserva volumen, pero la lectura importante es que perdió filo frente a la conversación acumulada.",
    marketingRead: "Marketing debe leerlo como saturación de claim antes de seguir empujando el mismo territorio creativo.",
    actionHint: "Auditar piezas del claim seguro auto y comparar comentarios útiles, CTR y menciones diferenciales contra un ángulo alterno",
    signalRole: "saturation",
    analysisScope: "current_cut",
    periodRead: "En el corte 2026-05 el volumen sigue activo y conserva menciones trazables dentro del mes.",
    windowRead: "En la ventana de 12 meses el territorio se repite, se satura y muestra desgaste de diferenciación.",
    marketingHypothesis: "La campaña y el claim de seguro auto conectan con el patrón repetido por overlap de evidencia y creative text.",
    nextMonthDecision: "Pausar el claim genérico, probar un ángulo alterno y medir CTR, dudas y menciones diferenciales.",
    performanceConnection: "connected: creative text y evidencia comparten el claim seguro auto.",
    evidenceBasis: "Sample 44444444-4444-4444-8444-444444444444 y periodo 2026-05 sostienen la lectura.",
    confidenceRationale: "Hay serie mensual, pico semanal, overlap con creative text y patrón repetido de ventana.",
    contextSummary: strongContextSummary({
      direct_marketing_matches: 1,
      pattern_flag_types: ["repeated_window", "saturation_candidate"]
    })
  });

  assert.equal(result.publishable, false);
  assert.ok(result.reasons.includes("window_pattern_flag_without_window_scope"));
});

test("Signal Pulse pattern flags classify window intelligence before Claude writes", () => {
  const periodSeries: SignalPulsePatternSeriesPoint[] = [
    periodPoint("2026-01", 12, null),
    periodPoint("2026-02", 0, -12),
    periodPoint("2026-03", 0, 0),
    periodPoint("2026-04", 0, 0),
    periodPoint("2026-05", 38, 38)
  ];
  const weeklySeries: SignalPulsePatternSeriesPoint[] = [
    periodPoint("2026-W18", 2, null, "week"),
    periodPoint("2026-W19", 4, 2, "week"),
    periodPoint("2026-W20", 6, 2, "week"),
    periodPoint("2026-W21", 26, 20, "week")
  ];
  const windowPattern: SignalPulsePatternWindow = {
    current_period: "2026-05",
    current_volume: 38,
    previous_volume: 0,
    delta_prev: 38,
    active_periods: 2,
    first_active_period: "2026-01",
    last_active_period: "2026-05",
    peak_period: "2026-05",
    peak_volume: 38,
    lifecycle_state: "reactivated"
  };
  const weeklyPattern: SignalPulsePatternWindow = {
    current_period: "2026-W21",
    current_volume: 26,
    previous_volume: 6,
    delta_prev: 20,
    active_periods: 4,
    first_active_period: "2026-W18",
    last_active_period: "2026-W21",
    peak_period: "2026-W21",
    peak_volume: 26,
    lifecycle_state: "accelerating"
  };

  const flags = buildSignalPulsePatternFlags({
    periodSeries,
    weeklySeries,
    windowPattern,
    weeklyPattern,
    hasDirectMarketingOverlap: true,
    marketingIntersections: [
      {
        period_label: "2026-05",
        basis: "creative_or_campaign_language_overlaps_evidence",
        campaign_count: 1,
        matching_creative_count: 1,
        performance_event_count: 1
      }
    ]
  });

  const types = flags.map((flag) => flag.type);
  assert.ok(types.includes("reactivated"));
  assert.ok(types.includes("accelerating"));
  assert.ok(types.includes("weekly_spike"));
  assert.ok(types.includes("marketing_overlap"));
  assert.match(flags.find((flag) => flag.type === "reactivated")?.detail ?? "", /regresa/);
  assert.deepEqual(flags.find((flag) => flag.type === "marketing_overlap")?.evidence_periods, ["2026-05"]);
});

test("Signal Pulse marketing moves reuse the signal action hint and define measurement", () => {
  const move = buildSignalPulseMarketingMove({
    title: "Oportunidad: Botana Crujiente Con Chile",
    moveType: "amplify",
    lifecycle: "rising",
    confidence: "alta",
    impact: 72,
    volume: 96,
    marketingRead: "La señal trae energía positiva suficiente para probarla como ángulo creativo.",
    actionHint: "Testear botana crujiente con chile como hook principal en una celda pequeña de pauta"
  });

  assert.match(move.actionText, /Testear botana crujiente con chile/);
  assert.match(move.actionText, /distribución controlada/);
  assert.equal(move.ownerSuggestion, "Paid media + Brand");
  assert.equal(move.timing, "este mes");
  assert.match(move.measurementSuggestion, /CTR/);
  assert.equal(move.noGoNotes, null);
  assert.doesNotMatch(move.actionText, /Amplificar .* en pauta y comparar contra el territorio actual/);
});

test("Signal Pulse marketing moves keep weak signals as bounded experiments", () => {
  const move = buildSignalPulseMarketingMove({
    title: "Merch Especial",
    moveType: "create_content",
    lifecycle: "stable",
    confidence: "baja",
    impact: 28,
    volume: 7,
    marketingRead: "",
    actionHint: ""
  });

  assert.match(move.actionText, /experimento de contenido/);
  assert.doesNotMatch(move.actionText, /Bajarlo a una serie corta de contenido/);
  assert.equal(move.ownerSuggestion, "Social + Content");
  assert.equal(move.timing, "siguiente sprint");
  assert.match(move.measurementSuggestion, /7 menciones/);
  assert.match(move.noGoNotes ?? "", /No convertirlo en promesa fuerte/);
});

test("Signal Pulse marketing moves use role and performance connection, not only lifecycle", () => {
  const move = buildSignalPulseMarketingMove({
    title: "Gap de pauta: La campaña habla de confianza pero la conversación pide claridad",
    moveType: "test_claim",
    lifecycle: "rising",
    confidence: "alta",
    impact: 58,
    volume: 134,
    marketingRead: "La pauta empuja confianza y la conversación del mes pide claridad sobre resolución.",
    actionHint: "Cruzar la promesa de confianza con una pieza de claridad sobre tiempos de respuesta",
    signalRole: "paid_gap",
    performanceConnection: "connected: en mayo suben engagement y menciones sobre claridad"
  });

  assert.match(move.actionText, /Auditar piezas, inversión y promesa activa/);
  assert.match(move.measurementSuggestion, /CTR/);
  assert.match(move.measurementSuggestion, /campaña/);
  assert.equal(move.ownerSuggestion, "Paid media + Creative");
  assert.equal(move.noGoNotes, null);
});

test("Signal Pulse marketing moves prevent campaign causality when connection is missing", () => {
  const move = buildSignalPulseMarketingMove({
    title: "Señal emergente: Choques en cadena aparece fuera de la campaña",
    moveType: "test_claim",
    lifecycle: "emerging",
    confidence: "media",
    impact: 42,
    volume: 48,
    marketingRead: "La conversación sube sin campaña o creativo vinculado.",
    actionHint: "Validar si educación sobre choques en cadena merece contenido propio",
    signalRole: "emerging_signal",
    performanceConnection: "no_connection: no hay campaña o creative text relacionado"
  });

  assert.match(move.actionText, /aprendizaje de conversación independiente/);
  assert.match(move.measurementSuggestion, /mantener KPIs de campaña separados/);
  assert.match(move.noGoNotes ?? "", /No venderlo como efecto de campaña/);
  assert.equal(move.ownerSuggestion, "Insights + Social");
});

test("Signal Pulse marketing activity summary surfaces repeated claims across months", () => {
  const summary = summarizeSignalPulseMarketingActivity([
    {
      month: "2026-01",
      platform: "meta",
      channel: "paid",
      entity_kind: "ad",
      entity_name: "Confianza Auto Enero",
      objective: "traffic",
      spend: 100,
      impressions: 10000,
      clicks: 120,
      engagement: 300,
      creative_text: "Seguro de auto con respuesta rápida y atención clara"
    },
    {
      month: "2026-02",
      platform: "meta",
      channel: "paid",
      entity_kind: "ad",
      entity_name: "Confianza Auto Febrero",
      objective: "traffic",
      spend: 140,
      impressions: 12000,
      clicks: 130,
      engagement: 320,
      creative_text: "Respuesta rápida para seguro de auto y atención clara"
    },
    {
      month: "2026-02",
      platform: "tiktok",
      channel: "organic",
      entity_kind: "post",
      entity_name: "Consejo choque",
      objective: "engagement",
      spend: 0,
      impressions: 3000,
      clicks: 0,
      engagement: 90,
      creative_text: "Qué hacer en un choque en cadena"
    }
  ]);

  assert.equal(summary.months.length, 2);
  assert.equal(summary.months[1]?.month, "2026-02");
  assert.equal(summary.months[1]?.top_entities[0]?.entity_name, "Confianza Auto Febrero");
  assert.ok(summary.repeatedLanguage.some((item) => item.phrase === "seguro auto" && item.months.length === 2));
  assert.ok(summary.repeatedLanguage.some((item) => item.phrase === "respuesta rapida" && item.records === 2));
});

test("Signal Pulse marketing record matching prefers evidence overlap over raw keyword matches", () => {
  const matches = rankSignalPulseMarketingRecordsForCluster({
    cluster: {
      id: "00000000-0000-4000-8000-000000000001",
      term: "seguro",
      currentTitle: "Territorio seguro",
      mentionCount: 134,
      platforms: ["facebook"],
      discoveryPeriods: ["2026-05"],
      memberMentionIds: ["11111111-1111-4111-8111-111111111111"],
      samples: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          text: "No queda claro quien responde en un choque en cadena.",
          platform: "facebook",
          published_at: "2026-05-18"
        }
      ]
    },
    semanticMatches: {
      knowledge: [
        {
          title: "Brief confianza",
          source_kind: "brand_document",
          text: "La campaña promete claridad ante responsabilidad legal.",
          similarity: 0.81
        }
      ],
      conversation: [
        {
          mention_id: "22222222-2222-4222-8222-222222222222",
          text: "En choque en cadena nadie entiende quien paga o responde legalmente.",
          platform: "facebook",
          published_at: "2026-05-19",
          period_label: "2026-05",
          similarity: 0.88
        }
      ]
    },
    marketingContext: {
      marketing_brief: { active_campaigns: ["Confianza auto"], allowed_claims: ["claridad ante choque"] },
      knowledge_sources: [],
      source_inventory: [],
      performance_window: [],
      marketing_activity_window: [],
      repeated_marketing_language: [
        {
          phrase: "choque en cadena",
          months: ["2026-04", "2026-05"],
          first_month: "2026-04",
          last_month: "2026-05",
          records: 8,
          spend: 500,
          impressions: 40000,
          engagement: 600,
          platforms: ["meta"],
          channels: ["paid"],
          example_creatives: ["Qué hacer en un choque en cadena"]
        }
      ],
      rag: {
        semantic_available: true,
        embedding_model: "voyage-4-large",
        retrieval_scope: "brand_knowledge_sources + structured performance_records"
      }
    },
    records: [
      {
        record_date: "2026-05-10",
        period_label: "2026-05",
        platform: "meta",
        channel: "paid",
        entity_kind: "ad",
        entity_name: "Seguro Auto Always On",
        objective: "traffic",
        spend: 900,
        impressions: 70000,
        clicks: 800,
        engagement: 900,
        creative_text: "Seguro de auto para todos"
      },
      {
        record_date: "2026-05-11",
        period_label: "2026-05",
        platform: "meta",
        channel: "paid",
        entity_kind: "ad",
        entity_name: "Choque en cadena claridad",
        objective: "engagement",
        spend: 120,
        impressions: 10000,
        clicks: 80,
        engagement: 240,
        creative_text: "Qué hacer en un choque en cadena y quién responde"
      }
    ],
    periodLabels: ["2026-05"]
  });

  assert.equal(matches[0]?.entity_name, "Choque en cadena claridad");
  assert.match(matches[0]?.match_basis ?? "", /evidence_overlap/);
  assert.match(matches[0]?.match_basis ?? "", /repeated_marketing_language_overlap/);
  assert.ok(matches[0]?.matched_terms.includes("choque en cadena"));
  assert.equal(matches.some((match) => match.entity_name === "Seguro Auto Always On"), true);
  assert.ok((matches.find((match) => match.entity_name === "Seguro Auto Always On")?.relevance_score ?? 0) < (matches[0]?.relevance_score ?? 0));
});

test("Signal Pulse budget estimate stays cluster-first and bounded before running", () => {
  assert.equal(estimateSignalPulseNamingCostUsd(0), 0.022);
  assert.equal(estimateSignalPulseNamingCostUsd(100), 0.528);
  assert.equal(SIGNAL_PULSE_RAG_CONTEXT_COST_USD, 0.02);
  assert.equal(estimateSignalPulseRunCostUsd(1), 0.192);
  assert.equal(SIGNAL_PULSE_INTERPRETATION_COST_USD, 0.15);
  assert.equal(estimateSignalPulseRunCostUsd(6000), 0.698);
});

test("Signal Pulse Claude naming prompt uses marketing-first RAG context, not T&B labels", () => {
  const prompt = buildClaudeSignalNamingPrompt([
    {
      id: "00000000-0000-4000-8000-000000000001",
      current_title: "Territorio seguro",
      signal_type: "risk",
      term: "seguro",
      rank: 1,
      mention_count: 134,
      sentiment_avg: -0.22,
      platforms: ["facebook", "tiktok"],
      discovery_periods: ["2026-05"],
      max_period_mention_count: 134,
      samples: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          text: "No queda claro quien responde en un choque en cadena.",
          platform: "facebook",
          published_at: "2026-05-18"
        }
      ],
      context: {
        period_series: [
          {
            granularity: "month",
            label: "2026-04",
            period_start: "2026-04-01",
            period_end: "2026-04-30",
            volume: 44,
            delta_prev: null,
            engagement: 20,
            sentiment_avg: -0.12,
            source_mix: { facebook: 44 },
            lifecycle_state: "stable"
          },
          {
            granularity: "month",
            label: "2026-05",
            period_start: "2026-05-01",
            period_end: "2026-05-31",
            volume: 134,
            delta_prev: 90,
            engagement: 72,
            sentiment_avg: -0.22,
            source_mix: { facebook: 90, tiktok: 44 },
            lifecycle_state: "rising"
          }
        ],
        weekly_series: [
          {
            granularity: "week",
            label: "2026-W20",
            period_start: "2026-05-11",
            period_end: "2026-05-17",
            volume: 28,
            delta_prev: null,
            engagement: 19,
            sentiment_avg: -0.2,
            source_mix: { facebook: 20, tiktok: 8 },
            lifecycle_state: "new"
          },
          {
            granularity: "week",
            label: "2026-W21",
            period_start: "2026-05-18",
            period_end: "2026-05-24",
            volume: 84,
            delta_prev: 56,
            engagement: 45,
            sentiment_avg: -0.27,
            source_mix: { facebook: 52, tiktok: 32 },
            lifecycle_state: "accelerating"
          }
        ],
        window_pattern: {
          current_period: "2026-05",
          current_volume: 134,
          previous_volume: 44,
          delta_prev: 90,
          active_periods: 2,
          first_active_period: "2026-04",
          last_active_period: "2026-05",
          peak_period: "2026-05",
          peak_volume: 134,
          lifecycle_state: "rising"
        },
        weekly_pattern: {
          current_period: "2026-W21",
          current_volume: 84,
          previous_volume: 28,
          delta_prev: 56,
          active_periods: 2,
          first_active_period: "2026-W20",
          last_active_period: "2026-W21",
          peak_period: "2026-W21",
          peak_volume: 84,
          lifecycle_state: "accelerating"
        },
        performance_context: {
          active_months: [
            {
              month: "2026-05",
              records: 42,
              spend: 1200,
              impressions: 88000,
              clicks: 940,
              engagement: 1800,
              avg_ctr: 0.012,
              platforms: ["meta"],
              channels: ["paid"]
            }
          ],
          period_campaigns: [
            {
              period_label: "2026-05",
              period_start: "2026-05-01",
              period_end: "2026-05-31",
              platform: "meta",
              channel: "paid",
              entity_kind: "campaign",
              entity_name: "Confianza auto",
              objective: "traffic",
              spend: 1200,
              impressions: 88000,
              clicks: 940,
              engagement: 1800,
              avg_ctr: 0.012,
              records: 42
            }
          ],
          performance_events: [
            {
              month: "2026-05",
              metric: "engagement",
              current_value: 1800,
              previous_value: 900,
              delta_abs: 900,
              delta_pct: 100,
              direction: "up"
            }
          ],
          matching_creatives: [
            {
              record_date: "2026-05-10",
              period_label: "2026-05",
              platform: "meta",
              channel: "paid",
              entity_kind: "ad",
              entity_name: "Confianza auto",
              objective: "traffic",
              spend: 300,
              impressions: 18000,
              clicks: 210,
              engagement: 330,
              creative_text: "Seguro de auto con respuesta rapida",
              relevance_score: 8.4,
              match_basis: "evidence_overlap+knowledge_or_brief_overlap+repeated_marketing_language_overlap+same_active_period",
              matched_terms: ["respuesta rapida", "confianza", "choque en cadena"]
            }
          ]
        },
        knowledge_matches: [
          {
            title: "Brief mayo",
            source_kind: "brand_document",
            text: "La campaña de mayo empuja confianza y respuesta rapida.",
            similarity: 0.82
          }
        ],
        conversation_matches: [
          {
            mention_id: "22222222-2222-4222-8222-222222222222",
            text: "La póliza promete confianza, pero no entiendo quién paga si el choque fue en cadena.",
            platform: "facebook",
            published_at: "2026-05-20",
            period_label: "2026-05",
            similarity: 0.86
          }
        ],
        investigation_brief: {
          current_cut: {
            period_label: "2026-05",
            volume: 134,
            delta_prev: 90,
            lifecycle_state: "rising",
            sentiment_avg: -0.22,
            source_mix: { facebook: 90, tiktok: 44 }
          },
          window_pattern: {
            current_period: "2026-05",
            current_volume: 134,
            previous_volume: 44,
            delta_prev: 90,
            active_periods: 2,
            first_active_period: "2026-04",
            last_active_period: "2026-05",
            peak_period: "2026-05",
            peak_volume: 134,
            lifecycle_state: "rising"
          },
          weekly_pattern: {
            current_period: "2026-W21",
            current_volume: 84,
            previous_volume: 28,
            delta_prev: 56,
            active_periods: 2,
            first_active_period: "2026-W20",
            last_active_period: "2026-W21",
            peak_period: "2026-W21",
            peak_volume: 84,
            lifecycle_state: "accelerating"
          },
          strongest_periods: [
            {
              period_label: "2026-05",
              volume: 134,
              delta_prev: 90,
              lifecycle_state: "rising",
              source_mix: { facebook: 90, tiktok: 44 }
            }
          ],
          weekly_pulses: [
            {
              period_label: "2026-W21",
              volume: 84,
              delta_prev: 56,
              lifecycle_state: "accelerating",
              source_mix: { facebook: 52, tiktok: 32 }
            }
          ],
          marketing_intersections: [
            {
              period_label: "2026-05",
              basis: "creative_or_campaign_language_overlaps_evidence",
              campaign_count: 1,
              matching_creative_count: 1,
              performance_event_count: 1,
              spend: 1200,
              impressions: 88000,
              engagement: 1800,
              top_campaigns: ["Confianza auto · traffic · meta · paid"],
              top_matching_creatives: ["Seguro de auto con respuesta rapida"]
            }
          ],
          pattern_flags: [
            {
              type: "accelerating",
              severity: "high",
              detail: "El corte actual crece contra el periodo previo; usar el delta para explicar si es pico real o continuidad de ventana.",
              evidence_periods: ["2026-04", "2026-05"],
              metrics: {
                current_volume: 134,
                previous_volume: 44,
                delta_prev: 90,
                active_periods: 2,
                window_volume: 178
              }
            },
            {
              type: "marketing_overlap",
              severity: "high",
              detail: "Hay overlap directo entre evidencia de conversación y lenguaje/KB/creative de marketing; se puede formular hipótesis, no causalidad automática.",
              evidence_periods: ["2026-05"],
              metrics: {
                matched_periods: 1,
                matching_creatives: 1,
                campaigns: 1
              }
            }
          ],
          evidence_map: {
            sample_ids: ["11111111-1111-4111-8111-111111111111"],
            semantic_mention_ids: ["22222222-2222-4222-8222-222222222222"],
            knowledge_titles: ["Brief mayo"]
          },
          synthesis_questions: [
            "Qué cambia en el corte actual versus el patrón de la ventana completa?",
            "Hay conexión comprobable con campañas, claims, pauta u orgánico, o debe marcarse no_connection?"
          ]
        }
      }
    }
  ], {
    marketing_brief: {
      active_campaigns: ["Confianza auto"],
      allowed_claims: ["respuesta clara"],
      prohibited_claims: ["resolver todo al instante"]
    },
    knowledge_sources: [
      { type: "brand_document", content: { summary: "Marca regional de seguros con foco en cercania." } }
    ],
    source_inventory: [
      { source_type: "performance", provider: "meta", name: "Meta 12m", status: "active", visibility: "internal" }
    ],
    performance_window: [
      {
        month: "2026-05",
        records: 42,
        spend: 1200,
        impressions: 88000,
        clicks: 940,
        engagement: 1800,
        avg_ctr: 0.012,
        platforms: ["meta"],
        channels: ["paid"]
      }
    ],
    marketing_activity_window: [
      {
        month: "2026-05",
        records: 42,
        spend: 1200,
        impressions: 88000,
        clicks: 940,
        engagement: 1800,
        platforms: ["meta"],
        channels: ["paid"],
        objectives: ["traffic"],
        top_entities: [
          {
            entity_kind: "campaign",
            entity_name: "Confianza auto",
            objective: "traffic",
            platform: "meta",
            channel: "paid",
            records: 42,
            spend: 1200,
            impressions: 88000,
            engagement: 1800
          }
        ],
        top_creative_excerpts: ["Seguro de auto con respuesta rapida"]
      }
    ],
    repeated_marketing_language: [
      {
        phrase: "respuesta rapida",
        months: ["2026-04", "2026-05"],
        first_month: "2026-04",
        last_month: "2026-05",
        records: 18,
        spend: 2100,
        impressions: 160000,
        engagement: 3100,
        platforms: ["meta"],
        channels: ["paid"],
        example_creatives: ["Seguro de auto con respuesta rapida"]
      }
    ],
    rag: {
      semantic_available: true,
      embedding_model: "voyage-4-large",
      retrieval_scope: "brand_knowledge_sources + structured performance_records"
    }
  });

  assert.match(prompt, /12 meses/);
  assert.match(prompt, /serie semanal/);
  assert.match(prompt, /analysis_scope/);
  assert.match(prompt, /ventana completa/);
  assert.match(prompt, /performance_records/);
  assert.match(prompt, /repeated_marketing_language/);
  assert.match(prompt, /conversation_matches/);
  assert.match(prompt, /investigation_brief/);
  assert.match(prompt, /marketing_intersections/);
  assert.match(prompt, /pattern_flags/);
  assert.match(prompt, /reactivated/);
  assert.match(prompt, /marketing_overlap/);
  assert.match(prompt, /match_basis/);
  assert.match(prompt, /matched_terms/);
  assert.match(prompt, /performance_connection debe empezar exactamente/);
  assert.match(prompt, /marketing_hypothesis debe ser coherente/);
  assert.match(prompt, /no se debe atribuir/);
  assert.match(prompt, /period_read/);
  assert.match(prompt, /window_read/);
  assert.match(prompt, /marketing_hypothesis/);
  assert.match(prompt, /next_month_decision/);
  assert.match(prompt, /cuatro lecturas separadas/);
  assert.match(prompt, /El corte mensual es la vista publicable/);
  assert.match(prompt, /Si no puedes escribir una tesis comparable/);
  assert.match(prompt, /Una fila publish con titulo keyword/);
  assert.match(prompt, /accion de marketing medible/);
  assert.match(prompt, /connected:/);
  assert.match(prompt, /no_connection:/);
  assert.match(prompt, /respuesta rapida/);
  assert.match(prompt, /sample ids/);
  assert.match(prompt, /11111111-1111-4111-8111-111111111111/);
  assert.match(prompt, /22222222-2222-4222-8222-222222222222/);
  assert.match(prompt, /Riesgo creativo/);
  assert.match(prompt, /Gap de pauta/);
  assert.match(prompt, /Confianza auto/);
  assert.match(prompt, /engagement/);
  assert.match(prompt, /Brief mayo/);
  assert.match(prompt, /2026-05/);
  assert.match(prompt, /no_connection/);
  assert.doesNotMatch(prompt, /Triggers & Barriers/);
  assert.doesNotMatch(prompt, /"Barrera:/);
  assert.doesNotMatch(prompt, /"Trigger:/);
});

test("Signal Pulse LLM budget guard reserves the next cluster-level call", () => {
  assert.deepEqual(
    shouldSkipSignalPulseLlmForBudget({
      currentCostUsd: 0.2,
      budgetCapUsd: 0.5,
      estimatedNextCostUsd: 0.15
    }),
    { skip: false, reason: null }
  );
  assert.deepEqual(
    shouldSkipSignalPulseLlmForBudget({
      currentCostUsd: 0.42,
      budgetCapUsd: 0.5,
      estimatedNextCostUsd: 0.15
    }),
    { skip: true, reason: "budget_would_exceed:0.42+0.15/0.5" }
  );
  assert.deepEqual(
    shouldSkipSignalPulseLlmForBudget({
      currentCostUsd: 0.5,
      budgetCapUsd: 0.5,
      estimatedNextCostUsd: 0.015
    }),
    { skip: true, reason: "budget_exhausted:0.5/0.5" }
  );
});

test("Signal Pulse meta merge keeps root quality gates next to nested signal pulse data", () => {
  const qualityGates = [{ id: "source_presence", passed: true, detail: "24 señales." }];
  const { signalPulseMeta, rootMeta } = splitSignalPulseMetaForMerge({
    signal_pulse: { gates: { failed_gates: 0 } },
    quality_gates: qualityGates
  });

  assert.deepEqual(signalPulseMeta, { gates: { failed_gates: 0 } });
  assert.deepEqual(rootMeta, { quality_gates: qualityGates });
});

test("Signal Pulse window closes on structured performance when conversation has a partial newer month", () => {
  assert.equal(
    chooseSignalPulseWindowEnd({
      maxMentionDate: "2026-06-13",
      maxPerformanceDate: "2026-05-31",
      fallbackDate: "2026-06-14"
    }),
    "2026-05-31"
  );
  assert.equal(
    chooseSignalPulseWindowEnd({
      maxMentionDate: "2026-05-29",
      maxPerformanceDate: "2026-05-31",
      fallbackDate: "2026-06-14"
    }),
    "2026-05-29"
  );
});

function row(
  anchor_id: string,
  mention_id: string,
  text_clean: string,
  platform: string,
  sentiment_score: string,
  engagement_score: string,
  similarity: string
): EmbeddingNeighborhoodRow {
  return { anchor_id, mention_id, text_clean, platform, sentiment_score, engagement_score, similarity };
}

function strongContextSummary(overrides: Record<string, unknown> = {}) {
  return {
    samples: 6,
    conversation_matches: 2,
    knowledge_matches: 1,
    period_series_points: 12,
    weekly_series_points: 8,
    strongest_periods: 2,
    weekly_pulses: 1,
    marketing_intersections: 1,
    pattern_flags: 2,
    evidence_sample_ids: 2,
    semantic_evidence_ids: 1,
    active_performance_months: 12,
    direct_marketing_matches: 1,
    synthesis_questions: 4,
    active_periods: 3,
    current_volume: 96,
    pattern_flag_types: ["accelerating", "marketing_overlap"],
    ...overrides
  };
}

function periodPoint(
  label: string,
  volume: number,
  deltaPrev: number | null,
  granularity: "month" | "week" = "month"
): SignalPulsePatternSeriesPoint {
  void granularity;
  return {
    label,
    volume,
    delta_prev: deltaPrev
  };
}

function cluster(args: {
  term: string;
  mentionCount: number;
  memberIds: string[];
  source: "global" | "period_first";
  periods?: string[];
}) {
  return {
    term: args.term,
    mention_count: args.mentionCount,
    platforms: ["tiktok"],
    member_mention_ids: args.memberIds,
    sample_mention_ids: args.memberIds.slice(0, 4),
    sentiment_avg: 0.1,
    engagement_sum: args.mentionCount * 2,
    algorithm: "term_cluster_v2" as const,
    discovery_source: args.source,
    discovery_periods: args.periods ?? [],
    max_period_mention_count: args.periods?.length ? args.mentionCount : undefined
  };
}
