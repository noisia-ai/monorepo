export const SIGNAL_PAYLOAD_VERSION = 4;

export type TbPolarity = "trigger" | "barrier" | "mixed";
export type TbLayer = "psicologico" | "personal" | "social" | "cultural";
export type TbMobility = "movible_por_marca" | "parcialmente_movible" | "estructural";
export type TbConfidence = "alta" | "media" | "baja_direccional";

export type PublicTbFinding = {
  finding_id: string;
  finding_name: string;
  polarity: TbPolarity;
  layer: TbLayer;
  mobility: TbMobility | null;
  confidence: TbConfidence;
  frequency_mentions: number;
  intensity_score: number;
  predictive_capacity: number | null;
  composite_score: number;
  share_of_findings_pct: number;
  evidence_count: number;
  period_start: string | null;
  period_end: string | null;
  public_quote: string | null;
};

export type TbDecisionFieldNode = PublicTbFinding & {
  x: number;
  y: number;
  radius: number;
  actionability_score: number;
};

export type PublicActionCard = {
  action_id: string;
  target_team: "brand_strategy" | "creative_content" | "product_cx" | "retail_media" | "measurement" | "cultural_guardrails";
  kind: "activation" | "friction_removal" | "alignment" | "experiment" | "guardrail" | "structural_note";
  title: string;
  finding_ids: string[];
  primary_finding_id: string | null;
  action_text: string;
  rationale: string | null;
  suggested_channel: string | null;
  suggested_format: string | null;
  success_signal: string | null;
  estimated_effort: string | null;
  estimated_impact: string | null;
  confidence: string | null;
  priority_rank: number;
};

export type CompetitiveSignalPayload = {
  enabled: boolean;
  entities: Array<{
    entity_id: string;
    entity_name: string;
    entity_kind: "primary_brand" | "competitor_pool" | "competitor" | "category";
    mention_count: number;
    confidence: "alta" | "media" | "baja_direccional";
  }>;
  finding_entity_presence: unknown[];
  gaps: unknown[];
  recommendations: unknown[];
  limitations: string[];
};

export type EmergingPattern = {
  pattern_id: string;
  title: string;
  pattern_type: "source_pattern" | "unexpected_insight" | "language_code" | "cx_signal" | "product_signal" | "content_signal" | "hypothesis";
  why_it_matters: string;
  data_basis: string[];
  evidence_count: number;
  source_breakdown: Array<{ source: string; count: number }>;
  related_finding_ids: string[];
  confidence: TbConfidence;
  evidence_quotes: string[];
};

export type SignalKnowledgeImpact = {
  business_question_answer: string;
  decision_to_inform: string | null;
  sources_used: Array<{
    source_id: string;
    title: string;
    source_kind: string;
    original_file_name: string | null;
    status: string;
    summary: string;
    used_for: string[];
  }>;
  confirmed_by_corpus: string[];
  contradicted_or_unproven: string[];
  decision_implications: string[];
  strategic_constraints: string[];
};

export type StrategicOpportunity = {
  opportunity_id: string;
  title: string;
  decision: string;
  why_now: string;
  level: "brand" | "content" | "product_cx" | "competitive" | "measurement" | "category";
  source_mix: string[];
  related_finding_ids: string[];
  evidence_summary: string;
  what_to_do: string;
  success_signal: string;
  confidence: TbConfidence;
};

export type FutureSignal = {
  signal_id: string;
  title: string;
  polarity: "future_trigger" | "future_barrier";
  horizon: "30_90_days" | "3_6_months" | "6_12_months";
  why_it_could_emerge: string;
  evidence_basis: string[];
  watch_metric: string;
  related_finding_ids: string[];
  confidence: TbConfidence;
};

export type MarketAnalysis = {
  headline: string;
  answer: string;
  implications: string[];
  patterns: Array<{
    title: string;
    why_it_matters: string;
    source_basis: string[];
    related_finding_ids: string[];
  }>;
};

export type EvidenceDeepDive = {
  finding_id: string;
  plain_language_title: string;
  description: string;
  channel_insight: string;
  format_insight: string;
  period_insight: string;
  competitor_insight: string | null;
  future_watchout: string | null;
  proof_points: string[];
};

export type SignalPayloadV2 = {
  schema_version: 4;
  generated_at: string;
  report: {
    brand_name: string;
    methodology_name: string;
    methodology_slug: string;
    business_question: string | null;
    headline: string;
    summary: string;
  };
  manifest: Record<string, boolean>;
  metrics: {
    findings_total: number;
    barriers_total: number;
    triggers_total: number;
    movable_total: number;
  };
  findings: PublicTbFinding[];
  tb_decision_field_nodes: TbDecisionFieldNode[];
  tb_decision_field_edges: unknown[];
  action_cards: PublicActionCard[];
  competitive: CompetitiveSignalPayload;
  emerging_patterns: EmergingPattern[];
  knowledge_impact: SignalKnowledgeImpact | null;
  strategic_opportunities: StrategicOpportunity[];
  future_signals: FutureSignal[];
  market_analysis: MarketAnalysis | null;
  evidence_deep_dives: EvidenceDeepDive[];
  overview: unknown;
  barriers: unknown[];
  triggers: unknown[];
  actions: unknown;
  aggregates: unknown;
  client_boundaries: string[];
};
