import type { getTbAnalysisForCorpus } from "@/lib/data/corpora";
import {
  SIGNAL_PAYLOAD_VERSION,
  type EmergingPattern,
  type EvidenceDeepDive,
  type FutureSignal,
  type MarketAnalysis,
  type PublicTbFinding,
  type SignalKnowledgeImpact,
  type StrategicOpportunity
} from "@/lib/signal/contracts";
import { defaultSignalManifest, type SignalModuleKey } from "@/lib/signal/manifest";
import { buildTbDecisionFieldNodes } from "@/lib/signal/tb-decision-field";

type AnalysisState = NonNullable<Awaited<ReturnType<typeof getTbAnalysisForCorpus>>>;

type BuildSignalPayloadArgs = {
  state: AnalysisState;
  corpus: {
    id: string;
    brandName: string | null;
    themeName: string | null;
    methodologyName: string | null;
    methodologySlug: string | null;
    businessQuestion: string | null;
    decisionToInform?: string | null;
  };
  manifest?: Partial<Record<SignalModuleKey, boolean>>;
  headline?: string | null;
  summary?: string | null;
};

export function normalizeSignalManifest(input?: Partial<Record<SignalModuleKey, boolean>>) {
  return {
    ...defaultSignalManifest,
    ...(input ?? {})
  };
}

export function buildSignalPayload(args: BuildSignalPayloadArgs) {
  const manifest = normalizeSignalManifest(args.manifest);
  const { analysis, recommendations, gates, findingSummary, findings, aggregates } = args.state;
  const brandName = args.corpus.brandName ?? args.corpus.themeName ?? "la marca";
  const friction = recommendations.filter((rec) => rec.kind === "friction_removal");
  const activation = recommendations.filter((rec) => rec.kind === "activation");
  const structural = recommendations.filter((rec) => rec.kind === "structural_note");
  const failedGates = gates.filter((gate) => !gate.passed);

  // Build a finding_human_id → enrichment map for O(1) lookups while
  // serializing recommendations. Defensive default if `findings` is absent
  // (older callers).
  const publicFindings = buildPublicFindings(findings ?? []);
  const findingsByHumanId = new Map<string, { quote: string; journeyIntensity: Record<string, number> }>();
  for (const f of findings ?? []) {
    findingsByHumanId.set(f.findingHumanId, {
      quote: f.quote,
      journeyIntensity: f.journeyIntensity
    });
  }

  const serialize = (rec: AnalysisState["recommendations"][number]) =>
    serializeRecommendation(rec, findingsByHumanId);

  return {
    schema_version: SIGNAL_PAYLOAD_VERSION,
    generated_at: new Date().toISOString(),
    report: {
      brand_name: brandName,
      methodology_name: args.corpus.methodologyName ?? "Triggers & Barriers",
      methodology_slug: args.corpus.methodologySlug ?? "triggers-barriers",
      business_question: args.corpus.businessQuestion,
      headline: args.headline?.trim() || `Qué mueve y qué frena la decisión sobre ${brandName}`,
      summary:
        args.summary?.trim() ||
        "Lectura editorial del corpus aprobado: barreras accionables, contexto estructural y movimientos recomendados para la marca."
    },
    manifest,
    metrics: {
      findings_total: findingSummary.total,
      barriers_total: findingSummary.barriers,
      triggers_total: findingSummary.triggers,
      movable_total: findingSummary.movable
    },
    findings: publicFindings,
    tb_decision_field_nodes: buildTbDecisionFieldNodes(publicFindings),
    tb_decision_field_edges: [],
    action_cards: buildActionCardsFromAnalysis(
      analysis.metaJson,
      [...friction, ...activation, ...structural].map(serialize)
    ),
    competitive: normalizeCompetitivePayload(analysis.comparativeBrief),
    emerging_patterns: buildEmergingPatternsFromAnalysis(analysis.metaJson),
    knowledge_impact: buildKnowledgeImpact({
      metaJson: analysis.metaJson,
      corpus: args.corpus,
      knowledgeSources: args.state.knowledgeSources ?? [],
      comparativeBrief: analysis.comparativeBrief
    }),
    strategic_opportunities: buildStrategicOpportunities({
      metaJson: analysis.metaJson,
      findings: publicFindings,
      actionCards: buildActionCardsFromAnalysis(
        analysis.metaJson,
        [...friction, ...activation, ...structural].map(serialize)
      )
    }),
    future_signals: buildFutureSignals(analysis.metaJson, publicFindings),
    market_analysis: buildMarketAnalysis(analysis.metaJson, args.corpus, analysis.comparativeBrief),
    evidence_deep_dives: buildEvidenceDeepDives({
      metaJson: analysis.metaJson,
      findings: publicFindings,
      comparativeBrief: analysis.comparativeBrief
    }),
    overview: {
      top_barriers: friction.slice(0, 5).map((rec, index) => {
        const enrichment = findingsByHumanId.get(rec.findingHumanId ?? "");
        return {
          rank: index + 1,
          id: rec.findingHumanId,
          label: rec.findingName,
          confidence: rec.confidence,
          action: rec.intervencionSugerida,
          success_signal: rec.indicadorExito,
          // Real protagonist verbatim from tb_finding_citations
          quote: enrichment?.quote ?? null
        };
      }),
      editorial_note: null
    },
    barriers: friction.map(serialize),
    triggers: activation.map(serialize),
    actions: {
      best_move: friction[0] ? serialize(friction[0]) : null,
      alternatives: friction.slice(1).map(serialize),
      structural_notes: structural.map(serialize)
    },
    client_boundaries: buildClientBoundaries({ failedGatesCount: failedGates.length, comparativeBrief: analysis.comparativeBrief }),
    // Block consumed by Signal dashboard charts. Feeds polarity donut, layer
    // bars, mobility split, source breakdown, volume timeline, severity scatter,
    // top findings by share-of-voice, and the verbatim explorer.
    aggregates: aggregates ?? null
  };
}

function buildPublicFindings(findings: AnalysisState["findings"]): PublicTbFinding[] {
  const totalFrequency = Math.max(
    1,
    findings.reduce((sum, finding) => sum + Number(finding.frecuencia ?? 0), 0)
  );

  return findings
    .map((finding) => ({
      finding_id: finding.findingHumanId,
      finding_name: finding.findingName,
      polarity: coercePolarity(finding.polarity),
      layer: coerceLayer(finding.layer),
      mobility: coerceMobility(finding.movilidad),
      confidence: coerceConfidence(finding.confidence),
      frequency_mentions: Number(finding.frecuencia ?? 0),
      intensity_score: Number(finding.intensidadPromedio ?? 0),
      predictive_capacity:
        finding.capacidadPredictiva === null || finding.capacidadPredictiva === undefined
          ? null
          : Number(finding.capacidadPredictiva),
      composite_score: Number(finding.scoreCompuesto ?? 0),
      share_of_findings_pct: (Number(finding.frecuencia ?? 0) / totalFrequency) * 100,
      evidence_count: Number(finding.evidenceCount ?? 0),
      period_start: finding.periodStart ?? null,
      period_end: finding.periodEnd ?? null,
      public_quote: finding.quote || null
    }))
    .filter((finding) => finding.finding_id && finding.finding_name);
}

function buildFallbackActionCards(items: Array<ReturnType<typeof serializeRecommendation>>) {
  return items
    .filter((item) => item.text)
    .map((item, index) => ({
      action_id: item.id,
      target_team: inferTargetTeam(item),
      kind: item.kind === "structural_note" ? "guardrail" : item.kind,
      title: item.finding_name || "Acción priorizada",
      finding_ids: item.finding_id ? [item.finding_id] : [],
      primary_finding_id: item.finding_id ?? null,
      action_text: item.text ?? "",
      rationale: null,
      suggested_channel: item.medium ?? null,
      suggested_format: item.type ?? null,
      success_signal: item.success_signal ?? null,
      estimated_effort: item.effort ?? null,
      estimated_impact: inferImpact(item),
      confidence: item.confidence ?? null,
      priority_rank: index + 1
    }));
}

function buildActionCardsFromAnalysis(
  metaJson: unknown,
  fallbackItems: Array<ReturnType<typeof serializeRecommendation>>
) {
  const meta = metaJson && typeof metaJson === "object" ? metaJson as Record<string, unknown> : {};
  const direct = Array.isArray(meta.action_studio) ? meta.action_studio : [];
  if (direct.length > 0) {
    return direct
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item, index) => ({
        action_id: stringValue(item.action_id) || `AS-${String(index + 1).padStart(2, "0")}`,
        target_team: coerceTeam(item.target_team),
        kind: coerceActionKind(item.kind),
        title: stringValue(item.title) || "Acción priorizada",
        finding_ids: stringArray(item.finding_ids),
        primary_finding_id: stringValue(item.primary_finding_id) || stringArray(item.finding_ids)[0] || null,
        action_text: stringValue(item.action_text),
        rationale: stringValue(item.rationale) || null,
        suggested_channel: stringValue(item.suggested_channel) || null,
        suggested_format: stringValue(item.suggested_format) || null,
        success_signal: stringValue(item.success_signal) || null,
        estimated_effort: stringValue(item.estimated_effort) || null,
        estimated_impact: stringValue(item.estimated_impact) || null,
        confidence: stringValue(item.confidence) || null,
        priority_rank: numberValue(item.priority_rank) || index + 1
      }))
      .filter((item) => item.action_text);
  }
  return buildFallbackActionCards(fallbackItems);
}

function normalizeCompetitivePayload(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const entities = Array.isArray(source.entities) ? source.entities : [];
  return {
    enabled: entities.length > 0,
    entities,
    finding_entity_presence: Array.isArray(source.finding_entity_presence) ? source.finding_entity_presence : [],
    gaps: Array.isArray(source.competitive_gaps) ? source.competitive_gaps : Array.isArray(source.gaps) ? source.gaps : [],
    recommendations: Array.isArray(source.recommendations) ? source.recommendations : [],
    limitations: Array.isArray(source.limitations)
      ? source.limitations.filter((item): item is string => typeof item === "string")
      : ["El benchmark competitivo todavía no fue generado para este corte."]
  };
}

function buildEmergingPatternsFromAnalysis(metaJson: unknown): EmergingPattern[] {
  const meta = metaJson && typeof metaJson === "object" ? metaJson as Record<string, unknown> : {};
  const direct = Array.isArray(meta.emerging_patterns) ? meta.emerging_patterns : [];
  const openSignals = Array.isArray(meta.open_signals) ? meta.open_signals : [];
  const combined = [...direct, ...openSignals];
  if (combined.length > 0) {
    const seen = new Set<string>();
    return combined
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item, index) => ({
        pattern_id: stringValue(item.pattern_id) || `EP-${String(index + 1).padStart(2, "0")}`,
        title: stringValue(item.title) || "Pattern emergente",
        pattern_type: coercePatternType(item.pattern_type),
        why_it_matters: stringValue(item.why_it_matters),
        data_basis: stringArray(item.data_basis),
        evidence_count: numberValue(item.evidence_count),
        source_breakdown: arrayRecords(item.source_breakdown)
          .map((source) => ({ source: stringValue(source.source), count: numberValue(source.count) }))
          .filter((source) => source.source),
        related_finding_ids: stringArray(item.related_finding_ids),
        confidence: coerceConfidence(item.confidence),
        evidence_quotes: stringArray(item.evidence_quotes).slice(0, 3)
      }))
      .filter((item) => {
        if (!item.why_it_matters || seen.has(item.pattern_id)) return false;
        seen.add(item.pattern_id);
        return true;
      });
  }

  return [];
}

function buildKnowledgeImpact(args: {
  metaJson: unknown;
  corpus: BuildSignalPayloadArgs["corpus"];
  knowledgeSources: unknown[];
  comparativeBrief: unknown;
}): SignalKnowledgeImpact | null {
  const meta = recordValue(args.metaJson);
  const direct = recordValue(meta.knowledge_impact);
  const sourceRows = args.knowledgeSources.map(recordValue);
  const processedSources = sourceRows
    .filter((source) => stringValue(source.status) !== "failed")
    .map((source) => {
      const payload = recordValue(source.extractedPayload);
      return {
        source_id: stringValue(source.id),
        title: stringValue(source.title) || stringValue(source.originalFileName) || "Knowledge source",
        source_kind: stringValue(source.sourceKind) || "knowledge_source",
        original_file_name: stringValue(source.originalFileName) || null,
        status: stringValue(source.status) || "processed",
        summary: stringValue(payload.summary) || stringValue(source.errorMessage),
        used_for: stringArray(payload.recommended_use).length > 0 ? stringArray(payload.recommended_use) : inferKnowledgeUse(source)
      };
    })
    .filter((source) => source.summary || source.title)
    .slice(0, 12);

  const strategicContext = recordValue(recordValue(args.comparativeBrief).strategy_context);
  const answer = stringValue(direct.business_question_answer) ||
    buildFallbackQuestionAnswer(args.corpus.businessQuestion, strategicContext, processedSources);

  if (!answer && processedSources.length === 0) return null;

  return {
    business_question_answer: answer,
    decision_to_inform: args.corpus.decisionToInform ? stringValue(args.corpus.decisionToInform) : null,
    sources_used: processedSources,
    confirmed_by_corpus: stringArray(direct.confirmed_by_corpus).length > 0
      ? stringArray(direct.confirmed_by_corpus)
      : fallbackConfirmed(processedSources, strategicContext),
    contradicted_or_unproven: stringArray(direct.contradicted_or_unproven).length > 0
      ? stringArray(direct.contradicted_or_unproven)
      : fallbackUnproven(processedSources),
    decision_implications: stringArray(direct.decision_implications).length > 0
      ? stringArray(direct.decision_implications)
      : fallbackDecisionImplications(strategicContext),
    strategic_constraints: stringArray(direct.strategic_constraints).length > 0
      ? stringArray(direct.strategic_constraints)
      : extractStrategicConstraints(sourceRows)
  };
}

function buildStrategicOpportunities(args: {
  metaJson: unknown;
  findings: PublicTbFinding[];
  actionCards: ReturnType<typeof buildActionCardsFromAnalysis>;
}): StrategicOpportunity[] {
  const meta = recordValue(args.metaJson);
  const direct = arrayRecords(meta.strategic_opportunities);
  if (direct.length > 0) {
    return direct
      .map((item, index) => ({
        opportunity_id: stringValue(item.opportunity_id) || `OP-${String(index + 1).padStart(2, "0")}`,
        title: stringValue(item.title) || "Oportunidad estratégica",
        decision: stringValue(item.decision),
        why_now: stringValue(item.why_now),
        level: coerceOpportunityLevel(item.level),
        source_mix: stringArray(item.source_mix),
        related_finding_ids: stringArray(item.related_finding_ids),
        evidence_summary: stringValue(item.evidence_summary),
        what_to_do: stringValue(item.what_to_do),
        success_signal: stringValue(item.success_signal),
        confidence: coerceConfidence(item.confidence)
      }))
      .filter((item) => item.decision || item.what_to_do)
      .slice(0, 8);
  }

  return args.actionCards.slice(0, 6).map((action, index) => {
    const finding = args.findings.find((item) => item.finding_id === action.primary_finding_id);
    return {
      opportunity_id: `OP-${String(index + 1).padStart(2, "0")}`,
      title: action.title,
      decision: action.rationale || "Convertir el hallazgo en una decisión de ejecución medible.",
      why_now: finding
        ? `${finding.evidence_count} evidencias y score ${finding.composite_score.toFixed(1)} sostienen que esta tensión cambia la prioridad.`
        : "El análisis la priorizó como movimiento accionable.",
      level: mapTeamToOpportunityLevel(action.target_team),
      source_mix: ["findings", "action_studio", "corpus"],
      related_finding_ids: action.finding_ids,
      evidence_summary: finding?.public_quote ?? action.rationale ?? "",
      what_to_do: action.action_text,
      success_signal: action.success_signal ?? "Definir métrica de éxito antes de activar.",
      confidence: coerceConfidence(action.confidence)
    };
  });
}

function buildFutureSignals(metaJson: unknown, findings: PublicTbFinding[]): FutureSignal[] {
  const direct = arrayRecords(recordValue(metaJson).future_signals);
  if (direct.length > 0) {
    return direct
      .map((item, index) => ({
        signal_id: stringValue(item.signal_id) || `FS-${String(index + 1).padStart(2, "0")}`,
        title: stringValue(item.title) || "Señal futura",
        polarity: item.polarity === "future_trigger" ? "future_trigger" as const : "future_barrier" as const,
        horizon: coerceHorizon(item.horizon),
        why_it_could_emerge: stringValue(item.why_it_could_emerge),
        evidence_basis: stringArray(item.evidence_basis),
        watch_metric: stringValue(item.watch_metric),
        related_finding_ids: stringArray(item.related_finding_ids),
        confidence: coerceConfidence(item.confidence)
      }))
      .filter((item) => item.why_it_could_emerge)
      .slice(0, 6);
  }

  return findings
    .filter((finding) => finding.composite_score >= 2.4)
    .slice(0, 4)
    .map((finding, index) => ({
      signal_id: `FS-${String(index + 1).padStart(2, "0")}`,
      title: finding.polarity === "trigger" ? `Puede crecer: ${finding.finding_name}` : `Puede empeorar: ${finding.finding_name}`,
      polarity: finding.polarity === "trigger" ? "future_trigger" : "future_barrier",
      horizon: "3_6_months",
      why_it_could_emerge: "La señal ya aparece en el corpus y merece monitoreo si cambia de volumen, canal o tono.",
      evidence_basis: [finding.finding_id],
      watch_metric: "Cambio mensual en menciones, engagement y sentimiento conectado al finding.",
      related_finding_ids: [finding.finding_id],
      confidence: finding.confidence
    }));
}

function buildMarketAnalysis(metaJson: unknown, corpus: BuildSignalPayloadArgs["corpus"], comparativeBrief: unknown): MarketAnalysis | null {
  const direct = recordValue(recordValue(metaJson).market_analysis);
  if (stringValue(direct.answer) || stringValue(direct.headline)) {
    return {
      headline: stringValue(direct.headline) || "Lectura de mercado",
      answer: stringValue(direct.answer),
      implications: stringArray(direct.implications),
      patterns: arrayRecords(direct.patterns).map((item) => ({
        title: stringValue(item.title),
        why_it_matters: stringValue(item.why_it_matters),
        source_basis: stringArray(item.source_basis),
        related_finding_ids: stringArray(item.related_finding_ids)
      })).filter((item) => item.title && item.why_it_matters)
    };
  }

  const context = recordValue(recordValue(comparativeBrief).strategy_context);
  const mustAnswer = stringArray(context.must_answer).slice(0, 3);
  if (mustAnswer.length === 0 && !corpus.businessQuestion) return null;
  return {
    headline: "Respuesta abierta a la pregunta de negocio",
    answer: corpus.businessQuestion
      ? `El reporte debe leerse contra esta pregunta: ${corpus.businessQuestion}`
      : "El corte cruza corpus, contexto competitivo y hallazgos para orientar la decisión.",
    implications: mustAnswer.length > 0 ? mustAnswer : ["Validar la oportunidad contra evidencia de corpus y benchmark antes de activar."],
    patterns: stringArray(context.competitor_hypotheses).slice(0, 4).map((item, index) => ({
      title: `Hipótesis competitiva ${index + 1}`,
      why_it_matters: item,
      source_basis: ["query_strategy_brief", "competitive_context"],
      related_finding_ids: []
    }))
  };
}

function buildEvidenceDeepDives(args: {
  metaJson: unknown;
  findings: PublicTbFinding[];
  comparativeBrief: unknown;
}): EvidenceDeepDive[] {
  const direct = arrayRecords(recordValue(args.metaJson).evidence_deep_dives);
  if (direct.length > 0) {
    return direct.map((item) => ({
      finding_id: stringValue(item.finding_id),
      plain_language_title: stringValue(item.plain_language_title),
      description: stringValue(item.description),
      channel_insight: stringValue(item.channel_insight),
      format_insight: stringValue(item.format_insight),
      period_insight: stringValue(item.period_insight),
      competitor_insight: stringValue(item.competitor_insight) || null,
      future_watchout: stringValue(item.future_watchout) || null,
      proof_points: stringArray(item.proof_points)
    })).filter((item) => item.finding_id && item.description);
  }

  const presence = arrayRecords(recordValue(args.comparativeBrief).finding_entity_presence);
  return args.findings.map((finding) => {
    const competitive = presence.find((item) => stringValue(item.finding_id) === finding.finding_id);
    const period = finding.period_start && finding.period_end
      ? `${finding.period_start} a ${finding.period_end}`
      : "Sin rango temporal suficiente en el payload.";
    return {
      finding_id: finding.finding_id,
      plain_language_title: finding.finding_name,
      description: `${finding.finding_name} opera como ${prettifyKey(finding.polarity)} ${prettifyKey(finding.layer)} con ${finding.evidence_count} evidencias publicadas.`,
      channel_insight: "Revisar distribución por canal en Corpus View para separar comportamiento de plataforma de señal cultural.",
      format_insight: "Cruzar con tipo de contenido antes de traducirlo a formato creativo.",
      period_insight: period,
      competitor_insight: competitive ? `Ownership detectado: ${stringValue(competitive.ownership) || "sin clasificar"}.` : null,
      future_watchout: "Monitorear si sube en volumen o cambia de entidad dominante.",
      proof_points: [finding.public_quote].filter((item): item is string => Boolean(item))
    };
  });
}

function buildClientBoundaries(args: { failedGatesCount: number; comparativeBrief: unknown }) {
  const boundaries = [
    "El reporte publica una muestra de evidencia vinculada a hallazgos; no expone el corpus completo.",
    "Las recomendaciones deben leerse junto con su nivel de confianza y evidencia disponible."
  ];
  if (args.failedGatesCount > 0) {
    boundaries.push("Este corte tuvo observaciones metodológicas internas; Noisia las considera antes de presentar conclusiones finales.");
  }
  if (!args.comparativeBrief) {
    boundaries.push("La lectura competitiva requiere corpus de marca, competencia e industria atribuido; si falta, se muestra como pendiente.");
  }
  return boundaries;
}

function inferTargetTeam(item: ReturnType<typeof serializeRecommendation>) {
  const text = `${item.owner ?? ""} ${item.medium ?? ""} ${item.type ?? ""}`.toLowerCase();
  if (/cx|servicio|producto|faq|pdp|ux/.test(text)) return "product_cx";
  if (/media|retail|crm|performance|commerce/.test(text)) return "retail_media";
  if (/medici|kpi|test|experimento|tracking/.test(text)) return "measurement";
  if (/brand|estrateg|posicion|claim/.test(text)) return "brand_strategy";
  return "creative_content";
}

function inferImpact(item: ReturnType<typeof serializeRecommendation>) {
  const confidence = `${item.confidence ?? ""}`.toLowerCase();
  const mobility = `${item.movilidad ?? ""}`.toLowerCase();
  if (confidence.includes("alta") && mobility.includes("movible")) return "alto";
  if (confidence.includes("baja")) return "bajo";
  return "medio";
}

function coerceTeam(value: unknown) {
  const allowed = ["brand_strategy", "creative_content", "product_cx", "retail_media", "measurement", "cultural_guardrails"] as const;
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : "creative_content";
}

function coerceActionKind(value: unknown) {
  const allowed = ["activation", "friction_removal", "alignment", "experiment", "guardrail", "structural_note"] as const;
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : "activation";
}

function coercePatternType(value: unknown): EmergingPattern["pattern_type"] {
  const allowed = ["source_pattern", "unexpected_insight", "language_code", "cx_signal", "product_signal", "content_signal", "hypothesis"] as const;
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : "unexpected_insight";
}

function coerceOpportunityLevel(value: unknown): StrategicOpportunity["level"] {
  const allowed = ["brand", "content", "product_cx", "competitive", "measurement", "category"] as const;
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : "content";
}

function coerceHorizon(value: unknown): FutureSignal["horizon"] {
  if (value === "30_90_days" || value === "6_12_months") return value;
  return "3_6_months";
}

function mapTeamToOpportunityLevel(team: ReturnType<typeof buildActionCardsFromAnalysis>[number]["target_team"]): StrategicOpportunity["level"] {
  if (team === "brand_strategy") return "brand";
  if (team === "product_cx") return "product_cx";
  if (team === "measurement") return "measurement";
  if (team === "retail_media") return "competitive";
  return "content";
}

function inferKnowledgeUse(source: Record<string, unknown>) {
  const kind = stringValue(source.sourceKind);
  if (kind.includes("competitive")) return ["competitive_analysis", "signal_editorial"];
  if (kind.includes("brief")) return ["analysis_context", "signal_editorial"];
  if (kind.includes("spreadsheet")) return ["analysis_context", "signal_editorial"];
  return ["analysis_context"];
}

function buildFallbackQuestionAnswer(
  businessQuestion: string | null,
  strategicContext: Record<string, unknown>,
  sources: SignalKnowledgeImpact["sources_used"]
) {
  const hypotheses = stringArray(strategicContext.competitor_hypotheses);
  if (hypotheses[0]) return hypotheses[0];
  const firstCompetitiveSource = sources.find((source) => source.source_kind.includes("spreadsheet") || source.used_for.includes("competitive_analysis"));
  if (firstCompetitiveSource?.summary) return firstCompetitiveSource.summary;
  return businessQuestion ? `El análisis responde esta pregunta con corpus, Knowledge Base y benchmark: ${businessQuestion}` : "";
}

function fallbackConfirmed(
  sources: SignalKnowledgeImpact["sources_used"],
  strategicContext: Record<string, unknown>
) {
  const confirmed = [
    ...stringArray(strategicContext.priority_topics).slice(0, 2),
    ...sources
      .filter((source) => source.original_file_name)
      .slice(0, 3)
      .map((source) => `${source.original_file_name}: ${source.summary}`)
  ];
  return confirmed.filter(Boolean).slice(0, 6);
}

function fallbackUnproven(sources: SignalKnowledgeImpact["sources_used"]) {
  const hasCompetitive = sources.some((source) => source.used_for.includes("competitive_analysis") || source.title.toLowerCase().includes("compet"));
  return hasCompetitive
    ? ["El benchmark identifica oportunidades, pero cada claim competitivo necesita verificarse contra menciones atribuidas por entidad antes de presentarse como ownership."]
    : ["No hay suficiente contexto competitivo procesado para afirmar ownership de competidores."];
}

function fallbackDecisionImplications(strategicContext: Record<string, unknown>) {
  const mustAnswer = stringArray(strategicContext.must_answer);
  return mustAnswer.length > 0
    ? mustAnswer.slice(0, 4)
    : ["Traducir los hallazgos a decisiones de contenido, producto, medición y benchmark antes de activar."];
}

function extractStrategicConstraints(sources: Record<string, unknown>[]) {
  const raw = sources.map((source) => stringValue(recordValue(source.extractedPayload).summary)).join(" ");
  const constraints: string[] = [];
  if (/FCA|financial advice|consejo financiero/i.test(raw)) {
    constraints.push("Compliance financiero: evitar consejos financieros específicos y diferenciar paid/organic.");
  }
  if (/paid|organic|orgánico|organico/i.test(raw)) {
    constraints.push("Separar performance paid de engagement orgánico para no confundir reach con comunidad.");
  }
  return constraints;
}

function prettifyKey(value: unknown) {
  return stringValue(value).replace(/_/g, " ") || "sin clasificar";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function serializeRecommendation(
  rec: AnalysisState["recommendations"][number],
  findingsByHumanId: Map<string, { quote: string; journeyIntensity: Record<string, number> }>
) {
  const enrichment = findingsByHumanId.get(rec.findingHumanId ?? "");
  return {
    id: rec.id,
    finding_id: rec.findingHumanId,
    finding_name: rec.findingName,
    kind: rec.kind,
    layer: rec.layer,
    confidence: rec.confidence,
    movilidad: rec.movilidad,
    text: rec.intervencionSugerida ?? rec.recomendacion ?? rec.razonEstructural,
    type: rec.tipoIntervencion,
    effort: rec.inversionEstimada,
    success_signal: rec.indicadorExito,
    owner: rec.responsableSugerido,
    medium: rec.medioRecomendado,
    tone: rec.tonoRecomendado,
    // Enrichment from tb_findings + tb_finding_citations for editorial render.
    quote: enrichment?.quote ?? null,
    journey_intensity: enrichment?.journeyIntensity ?? null
  };
}

function coercePolarity(value: unknown): PublicTbFinding["polarity"] {
  return value === "trigger" || value === "mixed" ? value : "barrier";
}

function coerceLayer(value: unknown): PublicTbFinding["layer"] {
  return value === "psicologico" || value === "social" || value === "cultural" ? value : "personal";
}

function coerceMobility(value: unknown): PublicTbFinding["mobility"] {
  return value === "movible_por_marca" || value === "parcialmente_movible" || value === "estructural" ? value : null;
}

function coerceConfidence(value: unknown): PublicTbFinding["confidence"] {
  return value === "alta" || value === "baja_direccional" ? value : "media";
}
