import type {
  CompetitiveSignalPayload,
  EvidenceDeepDive,
  EmergingPattern,
  FutureSignal,
  MarketAnalysis,
  PublicActionCard,
  PublicTbFinding,
  SignalKnowledgeImpact,
  SignalPayloadV2,
  StrategicOpportunity,
  TbDecisionFieldNode
} from "@/lib/signal/contracts";
import { buildTbDecisionFieldNodes } from "@/lib/signal/tb-decision-field";

export type TbDashboardViewModel = {
  report: SignalPayloadV2["report"];
  manifest: Record<string, boolean>;
  metrics: SignalPayloadV2["metrics"];
  findings: PublicTbFinding[];
  decisionFieldNodes: TbDecisionFieldNode[];
  actionCards: PublicActionCard[];
  competitive: CompetitiveSignalPayload;
  emergingPatterns: EmergingPattern[];
  knowledgeImpact: SignalKnowledgeImpact | null;
  strategicOpportunities: StrategicOpportunity[];
  futureSignals: FutureSignal[];
  marketAnalysis: MarketAnalysis | null;
  evidenceDeepDives: EvidenceDeepDive[];
  overview: Record<string, unknown>;
  actions: Record<string, unknown>;
  barriers: Record<string, unknown>[];
  triggers: Record<string, unknown>[];
  aggregates: Record<string, unknown>;
  clientBoundaries: string[];
};

export function adaptTbSignalPayload(payload: unknown): TbDashboardViewModel {
  const source = asRecord(payload);
  const report = asRecord(source.report);
  const metrics = asRecord(source.metrics);
  const findings = normalizeFindings(source.findings, source);
  const actionCards = normalizeActionCards(source.action_cards, source);
  const decisionNodes = arrayValue(source.tb_decision_field_nodes).length > 0
    ? arrayValue(source.tb_decision_field_nodes).map(asRecord).map((node) => ({ ...node })) as TbDecisionFieldNode[]
    : buildTbDecisionFieldNodes(findings);

  return {
    report: {
      brand_name: stringValue(report.brand_name) || "Marca",
      methodology_name: stringValue(report.methodology_name) || "Triggers & Barriers",
      methodology_slug: stringValue(report.methodology_slug) || "triggers-barriers",
      business_question: stringValue(report.business_question) || null,
      headline: stringValue(report.headline) || "Lectura de decisión",
      summary: stringValue(report.summary) || "Resumen del corpus publicado."
    },
    manifest: asBooleanRecord(source.manifest),
    metrics: {
      findings_total: numberValue(metrics.findings_total),
      barriers_total: numberValue(metrics.barriers_total),
      triggers_total: numberValue(metrics.triggers_total),
      movable_total: numberValue(metrics.movable_total)
    },
    findings,
    decisionFieldNodes: decisionNodes,
    actionCards,
    competitive: normalizeCompetitive(source.competitive),
    emergingPatterns: normalizeEmergingPatterns(source.emerging_patterns),
    knowledgeImpact: normalizeKnowledgeImpact(source.knowledge_impact),
    strategicOpportunities: normalizeStrategicOpportunities(source.strategic_opportunities),
    futureSignals: normalizeFutureSignals(source.future_signals),
    marketAnalysis: normalizeMarketAnalysis(source.market_analysis),
    evidenceDeepDives: normalizeEvidenceDeepDives(source.evidence_deep_dives),
    overview: asRecord(source.overview),
    actions: asRecord(source.actions),
    barriers: arrayValue(source.barriers).map(asRecord),
    triggers: arrayValue(source.triggers).map(asRecord),
    aggregates: asRecord(source.aggregates),
    clientBoundaries: stringArray(source.client_boundaries)
  };
}

function normalizeKnowledgeImpact(input: unknown): SignalKnowledgeImpact | null {
  const value = asRecord(input);
  if (!stringValue(value.business_question_answer) && arrayValue(value.sources_used).length === 0) return null;
  return {
    business_question_answer: stringValue(value.business_question_answer),
    decision_to_inform: stringValue(value.decision_to_inform) || null,
    sources_used: arrayValue(value.sources_used).map(asRecord).map((source) => ({
      source_id: stringValue(source.source_id),
      title: stringValue(source.title),
      source_kind: stringValue(source.source_kind),
      original_file_name: stringValue(source.original_file_name) || null,
      status: stringValue(source.status),
      summary: stringValue(source.summary),
      used_for: stringArray(source.used_for)
    })).filter((source) => source.title || source.summary),
    confirmed_by_corpus: stringArray(value.confirmed_by_corpus),
    contradicted_or_unproven: stringArray(value.contradicted_or_unproven),
    decision_implications: stringArray(value.decision_implications),
    strategic_constraints: stringArray(value.strategic_constraints)
  };
}

function normalizeStrategicOpportunities(input: unknown): StrategicOpportunity[] {
  return arrayValue(input).map(asRecord).map((item, index) => ({
    opportunity_id: stringValue(item.opportunity_id) || `OP-${index + 1}`,
    title: stringValue(item.title) || "Oportunidad",
    decision: stringValue(item.decision),
    why_now: stringValue(item.why_now),
    level: coerceOpportunityLevel(item.level),
    source_mix: stringArray(item.source_mix),
    related_finding_ids: stringArray(item.related_finding_ids),
    evidence_summary: stringValue(item.evidence_summary),
    what_to_do: stringValue(item.what_to_do),
    success_signal: stringValue(item.success_signal),
    confidence: coerceConfidence(item.confidence)
  })).filter((item) => item.decision || item.what_to_do);
}

function normalizeFutureSignals(input: unknown): FutureSignal[] {
  return arrayValue(input).map(asRecord).map((item, index) => ({
    signal_id: stringValue(item.signal_id) || `FS-${index + 1}`,
    title: stringValue(item.title) || "Señal futura",
    polarity: item.polarity === "future_trigger" ? "future_trigger" as const : "future_barrier" as const,
    horizon: item.horizon === "30_90_days" || item.horizon === "6_12_months" ? item.horizon as FutureSignal["horizon"] : "3_6_months" as const,
    why_it_could_emerge: stringValue(item.why_it_could_emerge),
    evidence_basis: stringArray(item.evidence_basis),
    watch_metric: stringValue(item.watch_metric),
    related_finding_ids: stringArray(item.related_finding_ids),
    confidence: coerceConfidence(item.confidence)
  })).filter((item) => item.why_it_could_emerge);
}

function normalizeMarketAnalysis(input: unknown): MarketAnalysis | null {
  const value = asRecord(input);
  if (!stringValue(value.answer) && !stringValue(value.headline)) return null;
  return {
    headline: stringValue(value.headline) || "Market analysis",
    answer: stringValue(value.answer),
    implications: stringArray(value.implications),
    patterns: arrayValue(value.patterns).map(asRecord).map((item) => ({
      title: stringValue(item.title),
      why_it_matters: stringValue(item.why_it_matters),
      source_basis: stringArray(item.source_basis),
      related_finding_ids: stringArray(item.related_finding_ids)
    })).filter((item) => item.title && item.why_it_matters)
  };
}

function normalizeEvidenceDeepDives(input: unknown): EvidenceDeepDive[] {
  return arrayValue(input).map(asRecord).map((item) => ({
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

function normalizeFindings(input: unknown, source: Record<string, unknown>): PublicTbFinding[] {
  const direct = arrayValue(input).map(asRecord);
  if (direct.length > 0) {
    return direct.map((item) => ({
      finding_id: stringValue(item.finding_id),
      finding_name: stringValue(item.finding_name),
      polarity: coercePolarity(item.polarity),
      layer: coerceLayer(item.layer),
      mobility: coerceMobility(item.mobility ?? item.movilidad),
      confidence: coerceConfidence(item.confidence),
      frequency_mentions: numberValue(item.frequency_mentions),
      intensity_score: numberValue(item.intensity_score),
      predictive_capacity: item.predictive_capacity === null ? null : numberValue(item.predictive_capacity),
      composite_score: numberValue(item.composite_score),
      share_of_findings_pct: numberValue(item.share_of_findings_pct),
      evidence_count: numberValue(item.evidence_count),
      period_start: stringValue(item.period_start) || null,
      period_end: stringValue(item.period_end) || null,
      public_quote: stringValue(item.public_quote) || null
    })).filter((item) => item.finding_id && item.finding_name);
  }

  const aggregates = asRecord(source.aggregates);
  const scatter = arrayValue(aggregates.findings_scatter).map(asRecord);
  const voice = new Map(
    arrayValue(aggregates.top_findings_by_voice)
      .map(asRecord)
      .map((item) => [stringValue(item.finding_id), numberValue(item.citation_count)])
  );
  const recommendations = [...arrayValue(source.barriers), ...arrayValue(source.triggers)]
    .map(asRecord);
  const quoteByFinding = new Map(recommendations.map((rec) => [stringValue(rec.finding_id), stringValue(rec.quote)]));
  const total = Math.max(1, scatter.length);

  return scatter.map((item) => ({
    finding_id: stringValue(item.finding_id),
    finding_name: stringValue(item.nombre),
    polarity: coercePolarity(item.polarity),
    layer: coerceLayer(item.layer),
    mobility: coerceMobility(item.movilidad),
    confidence: coerceConfidence("media"),
    frequency_mentions: numberValue(item.frecuencia),
    intensity_score: numberValue(item.intensidad),
    predictive_capacity: null,
    composite_score: numberValue(item.score),
    share_of_findings_pct: 100 / total,
    evidence_count: voice.get(stringValue(item.finding_id)) ?? 0,
    period_start: stringValue(item.period_start) || null,
    period_end: stringValue(item.period_end) || null,
    public_quote: quoteByFinding.get(stringValue(item.finding_id)) || null
  })).filter((item) => item.finding_id && item.finding_name);
}

function normalizeActionCards(input: unknown, source: Record<string, unknown>): PublicActionCard[] {
  const direct = arrayValue(input).map(asRecord);
  if (direct.length > 0) {
    return direct.map((item, index) => ({
      action_id: stringValue(item.action_id) || `action-${index + 1}`,
      target_team: coerceTeam(item.target_team),
      kind: coerceActionKind(item.kind),
      title: stringValue(item.title) || "Acción",
      finding_ids: stringArray(item.finding_ids),
      primary_finding_id: stringValue(item.primary_finding_id) || null,
      action_text: stringValue(item.action_text),
      rationale: stringValue(item.rationale) || null,
      suggested_channel: stringValue(item.suggested_channel) || null,
      suggested_format: stringValue(item.suggested_format) || null,
      success_signal: stringValue(item.success_signal) || null,
      estimated_effort: stringValue(item.estimated_effort) || null,
      estimated_impact: stringValue(item.estimated_impact) || null,
      confidence: stringValue(item.confidence) || null,
      priority_rank: numberValue(item.priority_rank) || index + 1
    }));
  }

  const actions = asRecord(source.actions);
  return [actions.best_move, ...arrayValue(actions.alternatives)]
    .map(asRecord)
    .filter((item) => stringValue(item.text))
    .map((item, index) => ({
      action_id: stringValue(item.id) || `legacy-action-${index + 1}`,
      target_team: inferTeam(item),
      kind: coerceActionKind(item.kind),
      title: stringValue(item.finding_name) || "Acción priorizada",
      finding_ids: stringValue(item.finding_id) ? [stringValue(item.finding_id)] : [],
      primary_finding_id: stringValue(item.finding_id) || null,
      action_text: stringValue(item.text),
      rationale: null,
      suggested_channel: stringValue(item.medium) || null,
      suggested_format: stringValue(item.type) || null,
      success_signal: stringValue(item.success_signal) || null,
      estimated_effort: stringValue(item.effort) || null,
      estimated_impact: null,
      confidence: stringValue(item.confidence) || null,
      priority_rank: index + 1
    }));
}

function normalizeCompetitive(input: unknown): CompetitiveSignalPayload {
  const value = asRecord(input);
  const entities = arrayValue(value.entities).map(asRecord).map((item) => ({
    entity_id: stringValue(item.entity_id),
    entity_name: stringValue(item.entity_name),
    entity_kind: coerceEntityKind(item.entity_kind),
    mention_count: numberValue(item.mention_count),
    confidence: coerceConfidence(item.confidence)
  })).filter((item) => item.entity_id && item.entity_name);

  return {
    enabled: Boolean(value.enabled) && entities.length > 0,
    entities,
    finding_entity_presence: arrayValue(value.finding_entity_presence),
    gaps: arrayValue(value.gaps),
    recommendations: arrayValue(value.recommendations),
    limitations: stringArray(value.limitations)
  };
}

function normalizeEmergingPatterns(input: unknown): EmergingPattern[] {
  return arrayValue(input).map(asRecord).map((item, index) => ({
    pattern_id: stringValue(item.pattern_id) || `EP-${index + 1}`,
    title: stringValue(item.title) || "Pattern emergente",
    pattern_type: coercePatternType(item.pattern_type),
    why_it_matters: stringValue(item.why_it_matters),
    data_basis: stringArray(item.data_basis),
    evidence_count: numberValue(item.evidence_count),
    source_breakdown: arrayValue(item.source_breakdown).map(asRecord).map((source) => ({
      source: stringValue(source.source),
      count: numberValue(source.count)
    })).filter((source) => source.source),
    related_finding_ids: stringArray(item.related_finding_ids),
    confidence: coerceConfidence(item.confidence),
    evidence_quotes: stringArray(item.evidence_quotes)
  })).filter((item) => item.why_it_matters);
}

function inferTeam(item: Record<string, unknown>): PublicActionCard["target_team"] {
  const text = `${stringValue(item.owner)} ${stringValue(item.medium)} ${stringValue(item.type)}`.toLowerCase();
  if (/cx|servicio|producto|faq|pdp|ux/.test(text)) return "product_cx";
  if (/media|retail|crm|performance|commerce/.test(text)) return "retail_media";
  if (/medici|kpi|test|experimento|tracking/.test(text)) return "measurement";
  if (/brand|estrateg|posicion|claim/.test(text)) return "brand_strategy";
  return "creative_content";
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

function coerceTeam(value: unknown): PublicActionCard["target_team"] {
  const allowed: PublicActionCard["target_team"][] = ["brand_strategy", "creative_content", "product_cx", "retail_media", "measurement", "cultural_guardrails"];
  return allowed.includes(value as PublicActionCard["target_team"]) ? value as PublicActionCard["target_team"] : "creative_content";
}

function coerceOpportunityLevel(value: unknown): StrategicOpportunity["level"] {
  const allowed: StrategicOpportunity["level"][] = ["brand", "content", "product_cx", "competitive", "measurement", "category"];
  return allowed.includes(value as StrategicOpportunity["level"]) ? value as StrategicOpportunity["level"] : "content";
}

function coerceActionKind(value: unknown): PublicActionCard["kind"] {
  const allowed: PublicActionCard["kind"][] = ["activation", "friction_removal", "alignment", "experiment", "guardrail", "structural_note"];
  return allowed.includes(value as PublicActionCard["kind"]) ? value as PublicActionCard["kind"] : "activation";
}

function coerceEntityKind(value: unknown): CompetitiveSignalPayload["entities"][number]["entity_kind"] {
  return value === "competitor" || value === "category" || value === "competitor_pool" ? value : "primary_brand";
}

function coercePatternType(value: unknown): EmergingPattern["pattern_type"] {
  const allowed: EmergingPattern["pattern_type"][] = ["source_pattern", "unexpected_insight", "language_code", "cx_signal", "product_signal", "content_signal", "hypothesis"];
  return allowed.includes(value as EmergingPattern["pattern_type"]) ? value as EmergingPattern["pattern_type"] : "unexpected_insight";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBooleanRecord(value: unknown): Record<string, boolean> {
  return Object.fromEntries(Object.entries(asRecord(value)).map(([key, raw]) => [key, raw !== false]));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
