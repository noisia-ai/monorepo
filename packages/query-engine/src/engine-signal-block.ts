import { isEngineMethodologySlug } from "./engine";
import { getEngineMethodologySpec } from "./methodologies/registry";

export type EngineSignalConfidence = "alta" | "media" | "baja_direccional";

export type EngineSignalOwnership =
  | "brand_owned"
  | "competitor_owned"
  | "category_wide"
  | "shared"
  | "insufficient_evidence";

export type EngineSignalChartType =
  | "matrix_2x2"
  | "wave_plot"
  | "heatmap"
  | "force_graph"
  | "radial"
  | "radar"
  | "scatter_effort_impact"
  | "bar_ranking"
  | "diverging_bar"
  | "gauge"
  | "timeline"
  | "waterfall"
  | "stacked_share"
  | "bubble_field"
  | "sankey_flow"
  | "evidence_list"
  | "tension_card"
  | "confidence_badge";

export type EngineSignalChart = {
  chart_id: string;
  type: EngineSignalChartType;
  title: string;
  data: unknown;
  encodings?: Record<string, unknown>;
  evidence_ids: string[];
  confidence: EngineSignalConfidence;
};

export type EngineSignalMethodologyView = {
  kind: string;
  title: string;
  primary_question: string;
  readiness: {
    status: "beta_ready" | "directional" | "insufficient_evidence";
    reason: string;
    missing: string[];
  };
  cards: Array<{
    label: string;
    value: string;
    detail: string;
    confidence: EngineSignalConfidence;
  }>;
  rows: Array<{
    finding_id: string;
    label: string;
    axis: string | null;
    entity: string | null;
    score: number | null;
    evidence_count: number;
    confidence: EngineSignalConfidence;
    dimensions: Record<string, unknown>;
  }>;
  conclusions: Array<{
    kind: "protect" | "dispute" | "watch" | "validate";
    title: string;
    detail: string;
    finding_ids: string[];
  }>;
};

export type EngineSignalMethodologyBlock = {
  kind: string;
  title: string;
  subtitle: string | null;
  methodology_slug: string;
  summary: string;
  methodology_view: EngineSignalMethodologyView;
  charts: EngineSignalChart[];
  findings: Array<{
    finding_id: string;
    title: string;
    dimensions: Record<string, unknown>;
    score: number | null;
    ownership: EngineSignalOwnership | null;
    evidence_count: number;
    public_quote: string | null;
    confidence: EngineSignalConfidence;
  }>;
  evidence_index: Array<{ finding_id: string; mention_ids: string[] }>;
  limitations: string[];
};

export type EngineSignalFindingInput = {
  id: string;
  findingKey: string;
  name: string;
  dimensions: Record<string, unknown>;
  frequency: number;
  intensity: number | null;
  sentiment: number | null;
  sharePct: number | null;
  compositeScore: number | null;
  ownership: EngineSignalOwnership | null;
  confidence: EngineSignalConfidence;
  evidenceCount: number;
  mentionIds: string[];
  quote: string | null;
};

type BuildEngineMethodologyBlockArgs = {
  methodologySlug: string;
  methodologyVersion?: string | null;
  findings: EngineSignalFindingInput[];
  summary?: string | null;
  limitations?: unknown;
};

type MethodRenderSpec = {
  title: string;
  question: string;
  primaryDimension: string;
  secondaryDimension: string | null;
  chartTypes: EngineSignalChartType[];
  minimumDistinctSignals: number;
  buildCharts: (ctx: RenderContext) => EngineSignalChart[];
  buildConclusions: (ctx: RenderContext) => EngineSignalMethodologyView["conclusions"];
};

type RenderContext = {
  slug: string;
  kind: string;
  title: string;
  findings: EngineSignalFindingInput[];
  rows: RenderRow[];
  confidence: EngineSignalConfidence;
};

type RenderRow = EngineSignalMethodologyView["rows"][number] & {
  ownership?: EngineSignalOwnership | null;
};

const methodRenderSpecs: Record<string, MethodRenderSpec> = {
  "narrative-ownership": {
    title: "Narrative ownership board",
    question: "Quien posee cada narrativa y cuales son activos, riesgos o espacios disputables?",
    primaryDimension: "narrative",
    secondaryDimension: "valence",
    chartTypes: ["stacked_share", "matrix_2x2", "bar_ranking"],
    minimumDistinctSignals: 3,
    buildCharts: buildNarrativeOwnershipCharts,
    buildConclusions: buildNarrativeOwnershipConclusions
  },
  "value-perception-matrix": {
    title: "Value perception matrix",
    question: "Que beneficio y costo percibido capitaliza cada entidad, y donde hay whitespace de valor?",
    primaryDimension: "value_benefit",
    secondaryDimension: "value_cost",
    chartTypes: ["heatmap", "matrix_2x2", "bar_ranking", "evidence_list"],
    minimumDistinctSignals: 4,
    buildCharts: buildValuePerceptionCharts,
    buildConclusions: buildValuePerceptionConclusions
  },
  "journey-friction-mapping": {
    title: "Journey friction map",
    question: "En que fase del journey se rompe la decision y que tipo de friccion lo explica?",
    primaryDimension: "journey_phase",
    secondaryDimension: "friction_type",
    chartTypes: ["heatmap", "waterfall", "bar_ranking", "evidence_list"],
    minimumDistinctSignals: 4,
    buildCharts: buildJourneyFrictionCharts,
    buildConclusions: buildJourneyFrictionConclusions
  },
  "sentiment-advocacy-proxy": {
    title: "Sentiment / advocacy proxy",
    question: "Que temas convierten a la audiencia en promotores, pasivos o detractores?",
    primaryDimension: "theme",
    secondaryDimension: "advocacy_class",
    chartTypes: ["diverging_bar", "stacked_share", "timeline", "evidence_list"],
    minimumDistinctSignals: 3,
    buildCharts: buildSentimentAdvocacyCharts,
    buildConclusions: buildSentimentAdvocacyConclusions
  },
  "trust-risk-benchmark": {
    title: "Trust and risk benchmark",
    question: "Que drivers sostienen la confianza y que riesgos podrian escalar?",
    primaryDimension: "risk_theme",
    secondaryDimension: "trust_driver",
    chartTypes: ["gauge", "diverging_bar", "timeline", "evidence_list"],
    minimumDistinctSignals: 3,
    buildCharts: buildTrustRiskCharts,
    buildConclusions: buildTrustRiskConclusions
  }
};

const allowedChartTypes: readonly EngineSignalChartType[] = [
  "matrix_2x2",
  "wave_plot",
  "heatmap",
  "force_graph",
  "radial",
  "radar",
  "scatter_effort_impact",
  "bar_ranking",
  "diverging_bar",
  "gauge",
  "timeline",
  "waterfall",
  "stacked_share",
  "bubble_field",
  "sankey_flow",
  "evidence_list",
  "tension_card",
  "confidence_badge"
];

export function buildEngineMethodologyBlock(args: BuildEngineMethodologyBlockArgs): EngineSignalMethodologyBlock {
  const slug = args.methodologySlug;
  const kind = methodologyKind(slug);
  const renderSpec = methodRenderSpecs[slug] ?? buildFallbackRenderSpec(slug);
  const findings = args.findings.slice().sort(compareFindings);
  const rows = findings
    .map((finding) => buildViewRow(finding, renderSpec))
    .filter((row) => row.label && row.label !== "senal insuficiente")
    .slice(0, 24);
  const confidence = strongestConfidence(findings);
  const ctx: RenderContext = {
    slug,
    kind,
    title: renderSpec.title,
    findings,
    rows,
    confidence
  };
  const charts = withConfidenceChart(renderSpec.buildCharts(ctx), ctx);
  const totalEvidence = findings.reduce((sum, finding) => sum + Math.max(0, finding.evidenceCount), 0);
  const distinctSignals = new Set(rows.map((row) => `${row.label}:${row.axis ?? ""}`)).size;
  const missing = buildReadinessMissing({ findings, rows, totalEvidence, distinctSignals, minimumDistinctSignals: renderSpec.minimumDistinctSignals });
  const readiness = missing.length === 0
    ? {
        status: "beta_ready" as const,
        reason: "Hay diversidad minima de senales, evidencia enlazada y al menos una lectura con confianza media/alta.",
        missing
      }
    : findings.length > 0
      ? {
          status: "directional" as const,
          reason: "El lente tiene senales y charts, pero requiere mas cobertura o QA antes de declararlo client-ready.",
          missing
        }
      : {
          status: "insufficient_evidence" as const,
          reason: "No hay findings publicados para este lente.",
          missing
        };

  return {
    kind,
    title: renderSpec.title,
    subtitle: `${args.methodologyVersion ?? "1.0"} · engine lens`,
    methodology_slug: slug,
    summary: args.summary?.trim() || buildSummary(slug, rows),
    methodology_view: {
      kind: slug,
      title: renderSpec.title,
      primary_question: renderSpec.question,
      readiness,
      cards: buildCards({ findings, rows, totalEvidence, distinctSignals, confidence, primaryDimension: renderSpec.primaryDimension }),
      rows: rows.slice(0, 12),
      conclusions: renderSpec.buildConclusions(ctx).slice(0, 8)
    },
    charts,
    findings: findings.map((finding, index) => ({
      finding_id: finding.findingKey || `engine-${index + 1}`,
      title: finding.name,
      dimensions: finding.dimensions,
      score: finding.compositeScore,
      ownership: finding.ownership,
      evidence_count: finding.evidenceCount,
      public_quote: finding.quote,
      confidence: finding.confidence
    })),
    evidence_index: findings.map((finding) => ({
      finding_id: finding.findingKey,
      mention_ids: finding.mentionIds
    })),
    limitations: buildLimitations(slug, args.limitations, missing)
  };
}

export function normalizeEngineMethodologyBlock(input: unknown): EngineSignalMethodologyBlock | null {
  const value = asRecord(input);
  const slug = stringValue(value.methodology_slug);
  if (!slug && !stringValue(value.kind)) return null;
  const rawView = asRecord(value.methodology_view);
  const rawReadiness = asRecord(rawView.readiness);
  const charts = arrayValue(value.charts).map(asRecord).map((chart, index) => ({
    chart_id: stringValue(chart.chart_id) || `chart-${index + 1}`,
    type: coerceChartType(chart.type),
    title: stringValue(chart.title) || "Chart",
    data: chart.data ?? null,
    encodings: asRecord(chart.encodings),
    evidence_ids: stringArray(chart.evidence_ids),
    confidence: coerceConfidence(chart.confidence)
  }));
  return {
    kind: stringValue(value.kind) || methodologyKind(slug),
    title: stringValue(value.title) || prettifyKey(slug || stringValue(value.kind)),
    subtitle: stringValue(value.subtitle) || null,
    methodology_slug: slug || stringValue(value.kind),
    summary: stringValue(value.summary),
    methodology_view: {
      kind: stringValue(rawView.kind) || slug || stringValue(value.kind),
      title: stringValue(rawView.title) || stringValue(value.title) || "Methodology view",
      primary_question: stringValue(rawView.primary_question),
      readiness: {
        status: coerceReadiness(rawReadiness.status),
        reason: stringValue(rawReadiness.reason),
        missing: stringArray(rawReadiness.missing)
      },
      cards: arrayValue(rawView.cards).map(asRecord).map((card) => ({
        label: stringValue(card.label),
        value: stringValue(card.value),
        detail: stringValue(card.detail),
        confidence: coerceConfidence(card.confidence)
      })).filter((card) => card.label),
      rows: arrayValue(rawView.rows).map(asRecord).map((row, index) => ({
        finding_id: stringValue(row.finding_id) || `row-${index + 1}`,
        label: stringValue(row.label),
        axis: stringValue(row.axis) || null,
        entity: stringValue(row.entity) || null,
        score: nullableNumber(row.score),
        evidence_count: numberValue(row.evidence_count),
        confidence: coerceConfidence(row.confidence),
        dimensions: asRecord(row.dimensions)
      })).filter((row) => row.label),
      conclusions: arrayValue(rawView.conclusions).map(asRecord).map((item) => ({
        kind: coerceConclusionKind(item.kind),
        title: stringValue(item.title),
        detail: stringValue(item.detail),
        finding_ids: stringArray(item.finding_ids)
      })).filter((item) => item.title || item.detail)
    },
    charts,
    findings: arrayValue(value.findings).map(asRecord).map((finding, index) => ({
      finding_id: stringValue(finding.finding_id) || `engine-${index + 1}`,
      title: stringValue(finding.title) || "Finding",
      dimensions: asRecord(finding.dimensions),
      score: nullableNumber(finding.score),
      ownership: coerceOwnership(finding.ownership),
      evidence_count: numberValue(finding.evidence_count),
      public_quote: stringValue(finding.public_quote) || null,
      confidence: coerceConfidence(finding.confidence)
    })),
    evidence_index: arrayValue(value.evidence_index).map(asRecord).map((item) => ({
      finding_id: stringValue(item.finding_id),
      mention_ids: stringArray(item.mention_ids)
    })).filter((item) => item.finding_id),
    limitations: stringArray(value.limitations)
  };
}

export function methodologyKind(slug: string) {
  return slug.replace(/-/g, "_");
}

function buildFallbackRenderSpec(slug: string): MethodRenderSpec {
  const chartTypes = isEngineMethodologySlug(slug)
    ? getEngineMethodologySpec(slug).charts.map(coerceChartType)
    : ["bar_ranking" as EngineSignalChartType];
  return {
    title: `${prettifyKey(slug)} board`,
    question: "Que hallazgos de este lente son suficientemente fuertes para el reporte compuesto?",
    primaryDimension: "finding",
    secondaryDimension: null,
    chartTypes,
    minimumDistinctSignals: 3,
    buildCharts: (ctx) => chartTypes.map((type) => buildGenericChart(ctx, type)),
    buildConclusions: buildGenericConclusions
  };
}

function buildNarrativeOwnershipCharts(ctx: RenderContext): EngineSignalChart[] {
  return [
    chart(ctx, "stacked_share", "Share de narrativa por entidad", ctx.findings.map((finding) => ({
      finding_key: finding.findingKey,
      narrative: textDim(finding, "narrative") || finding.name,
      entity: entityLabel(finding),
      entity_id: finding.dimensions.dominant_entity_id ?? null,
      valence: textDim(finding, "valence") || "neutra",
      share_pct: numberValue(finding.sharePct ?? finding.dimensions.entity_share_pct),
      frequency: finding.frequency,
      ownership: finding.ownership,
      score: finding.compositeScore,
      confidence: finding.confidence
    })), { x: "narrative", y: "share_pct", color: "entity" }),
    chart(ctx, "matrix_2x2", "Ownership x valencia", ctx.findings.map((finding) => ({
      finding_key: finding.findingKey,
      name: finding.name,
      x: String(finding.ownership ?? finding.dimensions.ownership_decision ?? "shared"),
      y: textDim(finding, "valence") || "neutra",
      score: finding.compositeScore,
      frequency: finding.frequency,
      evidence_count: finding.evidenceCount,
      confidence: finding.confidence
    })), { x: "x", y: "y", size: "frequency", color: "confidence" }),
    chart(ctx, "bar_ranking", "Narrativas disputables o huerfanas", ctx.findings.map((finding) => ({
      finding_key: finding.findingKey,
      name: textDim(finding, "narrative") || finding.name,
      score: finding.compositeScore,
      share_pct: finding.sharePct,
      ownership: finding.ownership,
      valence: textDim(finding, "valence"),
      evidence_count: finding.evidenceCount,
      frequency: finding.frequency,
      confidence: finding.confidence
    })), { x: "name", y: "score", color: "ownership" })
  ];
}

function buildValuePerceptionCharts(ctx: RenderContext): EngineSignalChart[] {
  const rows = ctx.findings.map((finding) => ({
    finding_key: finding.findingKey,
    name: finding.name,
    benefit: textDim(finding, "value_benefit") || "sin beneficio",
    cost: textDim(finding, "value_cost") || "sin costo",
    entity: entityLabel(finding),
    perceived_value: textDim(finding, "perceived_value") || "unclear",
    value_score: numberValue(finding.dimensions.value_score ?? finding.compositeScore),
    share_pct: numberValue(finding.sharePct ?? finding.dimensions.value_ownership_share),
    whitespace_candidate: finding.dimensions.whitespace_candidate === true,
    score: finding.compositeScore,
    evidence_count: finding.evidenceCount,
    frequency: finding.frequency,
    confidence: finding.confidence
  }));
  return [
    chart(ctx, "heatmap", "Beneficio x costo percibido", rows, { x: "cost", y: "benefit", color: "value_score", series: "entity" }),
    chart(ctx, "matrix_2x2", "Mapa de valor percibido", rows, { x: "cost", y: "benefit", size: "frequency", color: "perceived_value" }),
    chart(ctx, "bar_ranking", "Whitespace y valor defendible", rows.slice().sort((a, b) => Number(b.whitespace_candidate) - Number(a.whitespace_candidate) || b.value_score - a.value_score), { x: "name", y: "value_score", color: "whitespace_candidate" }),
    evidenceListChart(ctx, rows)
  ];
}

function buildJourneyFrictionCharts(ctx: RenderContext): EngineSignalChart[] {
  const rows = ctx.findings.map((finding) => ({
    finding_key: finding.findingKey,
    name: finding.name,
    phase: textDim(finding, "journey_phase") || "journey",
    friction_type: textDim(finding, "friction_type") || "friction",
    polarity: textDim(finding, "polarity") || "blocker",
    visibility: textDim(finding, "visibility") || "mixed",
    choke_score: numberValue(finding.dimensions.choke_score),
    accelerator_score: numberValue(finding.dimensions.accelerator_score),
    impact: textDim(finding, "removability_impact"),
    effort: textDim(finding, "removability_effort"),
    quick_win_candidate: finding.dimensions.quick_win_candidate === true,
    score: finding.compositeScore,
    evidence_count: finding.evidenceCount,
    frequency: finding.frequency,
    confidence: finding.confidence
  }));
  return [
    chart(ctx, "heatmap", "Fase x friccion", rows, { x: "phase", y: "friction_type", color: "choke_score" }),
    chart(ctx, "waterfall", "Bloqueadores vs aceleradores", rows, { x: "phase", y: "choke_score", y2: "accelerator_score", color: "polarity" }),
    chart(ctx, "bar_ranking", "Quick wins y choke points", rows.slice().sort((a, b) => Number(b.quick_win_candidate) - Number(a.quick_win_candidate) || b.choke_score - a.choke_score), { x: "name", y: "choke_score", color: "quick_win_candidate" }),
    evidenceListChart(ctx, rows)
  ];
}

function buildSentimentAdvocacyCharts(ctx: RenderContext): EngineSignalChart[] {
  const rows = ctx.findings.map((finding) => ({
    finding_key: finding.findingKey,
    name: finding.name,
    entity: entityLabel(finding),
    theme: textDim(finding, "theme") || finding.name,
    advocacy_class: textDim(finding, "advocacy_class") || "passive",
    advocacy_proxy: numberValue(finding.dimensions.advocacy_proxy),
    pct_promoter: numberValue(finding.dimensions.pct_promoter),
    pct_passive: numberValue(finding.dimensions.pct_passive),
    pct_detractor: numberValue(finding.dimensions.pct_detractor),
    is_survey_nps: finding.dimensions.is_survey_nps === true,
    score: finding.compositeScore,
    evidence_count: finding.evidenceCount,
    frequency: finding.frequency,
    confidence: finding.confidence,
    period: periodLabel(finding)
  }));
  return [
    chart(ctx, "diverging_bar", "Proxy de advocacy por entidad/tema", rows, { x: "theme", y: "advocacy_proxy", color: "entity" }),
    chart(ctx, "stacked_share", "Promoters, passives, detractors", rows, { x: "entity", y: ["pct_promoter", "pct_passive", "pct_detractor"], color: "advocacy_class" }),
    chart(ctx, "timeline", "Pulso de advocacy en el tiempo", rows, { x: "period", y: "advocacy_proxy", color: "advocacy_class" }),
    evidenceListChart(ctx, rows)
  ];
}

function buildTrustRiskCharts(ctx: RenderContext): EngineSignalChart[] {
  const rows = ctx.findings.map((finding) => ({
    finding_key: finding.findingKey,
    name: finding.name,
    entity: entityLabel(finding),
    trust_driver: textDim(finding, "trust_driver"),
    risk_theme: textDim(finding, "risk_theme"),
    severity: textDim(finding, "severity") || "low",
    escalating: textDim(finding, "escalating") || "unclear",
    trust_score: numberValue(finding.dimensions.trust_score),
    risk_score: numberValue(finding.dimensions.risk_score),
    risk_theme_share_pct: numberValue(finding.dimensions.risk_theme_share_pct),
    reputational_vulnerability: finding.dimensions.reputational_vulnerability === true,
    sensitive_risk_requires_evidence: finding.dimensions.sensitive_risk_requires_evidence === true,
    score: finding.compositeScore,
    evidence_count: finding.evidenceCount,
    frequency: finding.frequency,
    confidence: finding.confidence,
    period: periodLabel(finding)
  }));
  return [
    chart(ctx, "gauge", "Trust score por entidad", rows, { x: "entity", y: "trust_score", color: "confidence" }),
    chart(ctx, "diverging_bar", "Confianza vs riesgo reputacional", rows, { x: "name", y: "risk_score", y2: "trust_score", color: "severity" }),
    chart(ctx, "timeline", "Riesgos en escalada", rows, { x: "period", y: "risk_score", color: "escalating" }),
    evidenceListChart(ctx, rows)
  ];
}

function evidenceListChart(ctx: RenderContext, rows: unknown[]): EngineSignalChart {
  return chart(ctx, "evidence_list", "Evidencia trazable", rows, { x: "name", y: "evidence_count", color: "confidence" });
}

function buildNarrativeOwnershipConclusions(ctx: RenderContext): EngineSignalMethodologyView["conclusions"] {
  const positiveOwned = ctx.rows.filter((row) => row.ownership === "brand_owned" && row.axis?.toLowerCase().includes("posit")).slice(0, 2);
  const competitorOwned = ctx.rows.filter((row) => row.ownership === "competitor_owned").slice(0, 2);
  const negativeOwned = ctx.rows.filter((row) => row.ownership === "brand_owned" && row.axis?.toLowerCase().includes("neg")).slice(0, 2);
  return [
    ...positiveOwned.map((row) => conclusion("protect", `Proteger narrativa propia: ${row.label}`, `La marca aparece como owner de una narrativa positiva; mantenerla visible y defenderla con evidencia.`, row.finding_id)),
    ...competitorOwned.map((row) => conclusion("dispute", `Narrativa en disputa: ${row.label}`, `La narrativa esta mas asociada a otra entidad; decidir si se disputa o se evita copiar.`, row.finding_id)),
    ...negativeOwned.map((row) => conclusion("watch", `Riesgo narrativo propio: ${row.label}`, `La marca tambien puede poseer narrativas negativas; no publicarlo como activo sin plan de contencion.`, row.finding_id)),
    ...lowEvidenceConclusions(ctx.rows)
  ];
}

function buildValuePerceptionConclusions(ctx: RenderContext): EngineSignalMethodologyView["conclusions"] {
  const ownedHigh = ctx.rows.filter((row) => row.ownership === "brand_owned" && String(row.dimensions.perceived_value ?? "").toLowerCase() === "high").slice(0, 2);
  const whitespace = ctx.rows.filter((row) => row.dimensions.whitespace_candidate === true).slice(0, 2);
  const costRisks = ctx.rows.filter((row) => ["monetario", "tiempo", "cognitivo", "social"].includes(String(row.axis ?? "").toLowerCase())).slice(0, 2);
  return [
    ...ownedHigh.map((row) => conclusion("protect", `Valor defendible: ${row.label}`, `El beneficio aparece con valor percibido alto y ownership de marca; conviene sostenerlo con prueba de producto.`, row.finding_id)),
    ...whitespace.map((row) => conclusion("validate", `Whitespace candidato: ${row.label}`, `Hay demanda, pero el whitespace requiere evidencia de ausencia competitiva antes de declararse como oportunidad fuerte.`, row.finding_id)),
    ...costRisks.map((row) => conclusion("watch", `Costo percibido a vigilar: ${row.label}`, `El costo ${row.axis} puede bloquear el valor si no se compensa con prueba clara.`, row.finding_id))
  ];
}

function buildJourneyFrictionConclusions(ctx: RenderContext): EngineSignalMethodologyView["conclusions"] {
  const quickWins = ctx.rows.filter((row) => row.dimensions.quick_win_candidate === true).slice(0, 2);
  const blockers = ctx.rows.filter((row) => String(row.dimensions.polarity ?? "").toLowerCase() === "blocker").slice(0, 2);
  const accelerators = ctx.rows.filter((row) => String(row.dimensions.polarity ?? "").toLowerCase() === "accelerator").slice(0, 2);
  return [
    ...quickWins.map((row) => conclusion("validate", `Quick win candidato: ${row.label}`, `La friccion parece removible y de alto impacto; validar esfuerzo real con producto/CX antes de prometerlo.`, row.finding_id)),
    ...blockers.map((row) => conclusion("watch", `Choke point: ${row.label}`, `La fase ${row.label} concentra friccion; priorizar evidencia y owner operativo.`, row.finding_id)),
    ...accelerators.map((row) => conclusion("protect", `Acelerador del journey: ${row.label}`, `El corpus muestra una senal que facilita avanzar; convertirla en promesa o prueba.`, row.finding_id))
  ];
}

function buildSentimentAdvocacyConclusions(ctx: RenderContext): EngineSignalMethodologyView["conclusions"] {
  const promoters = ctx.rows.filter((row) => String(row.axis ?? "").toLowerCase() === "promoter").slice(0, 2);
  const detractors = ctx.rows.filter((row) => String(row.axis ?? "").toLowerCase() === "detractor").slice(0, 2);
  return [
    ...promoters.map((row) => conclusion("protect", `Driver de advocacy: ${row.label}`, `Este tema empuja advocacy positiva; usarlo como prueba social sin llamarlo NPS encuestado.`, row.finding_id)),
    ...detractors.map((row) => conclusion("watch", `Driver detractor: ${row.label}`, `Este tema concentra detraccion; convertirlo en guardrail de experiencia o comunicacion.`, row.finding_id)),
    conclusion("validate", "Lectura proxy, no encuesta NPS", "El bloque usa menciones del corpus como proxy direccional; no debe presentarse como NPS survey.", ctx.rows[0]?.finding_id ?? "advocacy-proxy")
  ].filter((item) => item.finding_ids.length > 0);
}

function buildTrustRiskConclusions(ctx: RenderContext): EngineSignalMethodologyView["conclusions"] {
  const trustDrivers = ctx.rows.filter((row) => Boolean(row.dimensions.trust_driver)).slice(0, 2);
  const risks = ctx.rows.filter((row) => Boolean(row.dimensions.risk_theme)).slice(0, 3);
  const sensitive = ctx.rows.filter((row) => row.dimensions.sensitive_risk_requires_evidence === true).slice(0, 2);
  return [
    ...trustDrivers.map((row) => conclusion("protect", `Driver de confianza: ${row.label}`, `La confianza aparece ligada a este driver; defenderlo con evidencia concreta.`, row.finding_id)),
    ...risks.map((row) => conclusion("watch", `Riesgo reputacional: ${row.label}`, `Riesgo con severidad ${String(row.dimensions.severity ?? "sin severidad")}; revisar citas antes de escalarlo.`, row.finding_id)),
    ...sensitive.map((row) => conclusion("validate", `Riesgo sensible requiere prueba: ${row.label}`, `No declarar crisis ni acusacion sin patron y citas suficientes.`, row.finding_id))
  ];
}

function buildGenericConclusions(ctx: RenderContext): EngineSignalMethodologyView["conclusions"] {
  return [
    ...ctx.rows.slice(0, 2).map((row) => conclusion("validate", `Validar senal: ${row.label}`, "Senal generada por engine; requiere QA antes de entrar como afirmacion fuerte.", row.finding_id)),
    ...lowEvidenceConclusions(ctx.rows)
  ];
}

function lowEvidenceConclusions(rows: RenderRow[]) {
  return rows
    .filter((row) => row.confidence === "baja_direccional" || row.evidence_count < 2)
    .slice(0, 2)
    .map((row) => conclusion("validate", `Validar evidencia: ${row.label}`, `${row.evidence_count} evidencias y confianza ${row.confidence}.`, row.finding_id));
}

function conclusion(
  kind: EngineSignalMethodologyView["conclusions"][number]["kind"],
  title: string,
  detail: string,
  findingId: string
) {
  return { kind, title, detail, finding_ids: findingId ? [findingId] : [] };
}

function buildGenericChart(ctx: RenderContext, type: EngineSignalChartType) {
  return chart(ctx, type, `${ctx.title} · ${prettifyKey(type)}`, genericRows(ctx.findings), defaultEncodings(type));
}

function chart(
  ctx: RenderContext,
  type: EngineSignalChartType,
  title: string,
  data: unknown,
  encodings?: Record<string, unknown>
): EngineSignalChart {
  return {
    chart_id: `${ctx.slug}-${type}`,
    type,
    title,
    data,
    encodings,
    evidence_ids: evidenceIds(ctx.findings),
    confidence: ctx.confidence
  };
}

function withConfidenceChart(charts: EngineSignalChart[], ctx: RenderContext): EngineSignalChart[] {
  const hasConfidence = charts.some((item) => item.type === "confidence_badge");
  if (hasConfidence) return charts;
  return [
    ...charts,
    {
      chart_id: `${ctx.slug}-confidence_badge`,
      type: "confidence_badge",
      title: "Mix de confianza",
      data: {
        alta: ctx.findings.filter((finding) => finding.confidence === "alta").length,
        media: ctx.findings.filter((finding) => finding.confidence === "media").length,
        baja_direccional: ctx.findings.filter((finding) => finding.confidence === "baja_direccional").length
      },
      encodings: { color: "confidence" },
      evidence_ids: [],
      confidence: ctx.confidence
    }
  ];
}

function buildViewRow(finding: EngineSignalFindingInput, spec: MethodRenderSpec): RenderRow {
  const primary = stringValue(finding.dimensions[spec.primaryDimension]) || finding.name;
  const secondary = spec.secondaryDimension ? stringValue(finding.dimensions[spec.secondaryDimension]) : "";
  return {
    finding_id: finding.findingKey,
    label: primary,
    axis: secondary || null,
    entity: entityLabel(finding),
    score: finding.compositeScore,
    evidence_count: finding.evidenceCount,
    confidence: finding.confidence,
    dimensions: finding.dimensions,
    ownership: finding.ownership
  };
}

function buildCards(args: {
  findings: EngineSignalFindingInput[];
  rows: RenderRow[];
  totalEvidence: number;
  distinctSignals: number;
  confidence: EngineSignalConfidence;
  primaryDimension: string;
}): EngineSignalMethodologyView["cards"] {
  const topRow = args.rows[0] ?? null;
  return [
    {
      label: "Signals",
      value: String(args.findings.length),
      detail: `${args.distinctSignals} distinct ${prettifyKey(args.primaryDimension)} values.`,
      confidence: args.confidence
    },
    {
      label: "Evidence",
      value: String(args.totalEvidence),
      detail: "Mention links carried into the published engine block.",
      confidence: args.totalEvidence >= Math.max(3, args.rows.length) ? args.confidence : "baja_direccional"
    },
    {
      label: "Top read",
      value: topRow ? truncateText(topRow.label, 28) : "n/a",
      detail: topRow?.axis ? `Axis: ${topRow.axis}` : "No primary row yet.",
      confidence: topRow?.confidence ?? "baja_direccional"
    },
    {
      label: "Readiness",
      value: args.confidence === "alta" ? "Strong" : args.confidence === "media" ? "Usable" : "Directional",
      detail: "Based on confidence, diversity and evidence links.",
      confidence: args.confidence
    }
  ];
}

function buildReadinessMissing(args: {
  findings: EngineSignalFindingInput[];
  rows: EngineSignalMethodologyView["rows"];
  totalEvidence: number;
  distinctSignals: number;
  minimumDistinctSignals: number;
}) {
  const missing: string[] = [];
  if (args.findings.length === 0) missing.push("findings");
  if (args.totalEvidence < Math.max(3, args.rows.length)) missing.push("evidencia enlazada");
  if (args.distinctSignals < args.minimumDistinctSignals) missing.push("diversidad de senales");
  if (!args.findings.some((finding) => finding.confidence === "alta" || finding.confidence === "media")) missing.push("confianza media/alta");
  return missing;
}

function buildSummary(slug: string, rows: EngineSignalMethodologyView["rows"]) {
  const top = rows[0];
  if (!top) return `${prettifyKey(slug)} no encontro senales suficientes para publicar todavia.`;
  if (slug === "narrative-ownership") return `La narrativa principal es "${top.label}" y debe leerse por ownership, valencia y evidencia.`;
  if (slug === "value-perception-matrix") return `El valor percibido se organiza alrededor de "${top.label}" con costo ${top.axis ?? "sin eje claro"}.`;
  if (slug === "journey-friction-mapping") return `El journey muestra friccion relevante en "${top.label}" (${top.axis ?? "sin tipo claro"}).`;
  if (slug === "sentiment-advocacy-proxy") return `El proxy de advocacy destaca "${top.label}" como driver direccional.`;
  if (slug === "trust-risk-benchmark") return `El benchmark de confianza/riesgo destaca "${top.label}" como senal prioritaria.`;
  return `${prettifyKey(slug)} genero ${rows.length} senales listas para QA.`;
}

function buildLimitations(slug: string, input: unknown, missing: string[]) {
  const base = stringArray(input);
  const methodLimit = slug === "sentiment-advocacy-proxy"
    ? "Advocacy proxy no equivale a NPS encuestado; se deriva de corpus social y debe presentarse como direccional."
    : slug === "trust-risk-benchmark"
      ? "Riesgos sensibles requieren citas suficientes; no declarar crisis o acusaciones sin QA editorial."
      : slug === "value-perception-matrix"
        ? "Whitespace es candidato hasta validar ausencia competitiva y permiso de marca."
        : slug === "journey-friction-mapping"
          ? "Impacto y removibilidad son direccionales hasta validarse con datos operativos o producto/CX."
          : slug === "narrative-ownership"
            ? "Ownership narrativo mide asociacion en corpus, no propiedad legal ni preferencia total de mercado."
            : "Este bloque engine requiere QA antes de usarse como afirmacion fuerte.";
  const missingLimit = missing.length > 0 ? `Readiness pendiente: ${missing.join(", ")}.` : null;
  return [...base, methodLimit, missingLimit].filter((item): item is string => Boolean(item));
}

function genericRows(findings: EngineSignalFindingInput[]) {
  return findings.map((finding) => ({
    finding_key: finding.findingKey,
    name: finding.name,
    frequency: finding.frequency,
    intensity: finding.intensity,
    sentiment: finding.sentiment,
    share_pct: finding.sharePct,
    score: finding.compositeScore,
    confidence: finding.confidence,
    dimensions: finding.dimensions,
    evidence_count: finding.evidenceCount
  }));
}

function defaultEncodings(type: EngineSignalChartType): Record<string, unknown> {
  if (type === "confidence_badge") return { color: "confidence" };
  if (type === "timeline") return { x: "period", y: "frequency", color: "confidence" };
  if (type === "heatmap") return { x: "name", y: "dimensions", color: "score" };
  if (type === "stacked_share") return { x: "name", y: "share_pct", color: "confidence" };
  return { x: "name", y: "score", color: "confidence" };
}

function compareFindings(a: EngineSignalFindingInput, b: EngineSignalFindingInput) {
  return Number(b.compositeScore ?? 0) - Number(a.compositeScore ?? 0) ||
    b.evidenceCount - a.evidenceCount ||
    b.frequency - a.frequency;
}

function evidenceIds(findings: EngineSignalFindingInput[]) {
  return Array.from(new Set(findings.flatMap((finding) => finding.mentionIds))).slice(0, 30);
}

function entityLabel(finding: EngineSignalFindingInput) {
  return stringValue(finding.dimensions.entity_name) ||
    stringValue(finding.dimensions.entity) ||
    stringValue(finding.dimensions.dominant_entity_id) ||
    finding.ownership ||
    finding.id;
}

function textDim(finding: EngineSignalFindingInput, key: string) {
  return stringValue(finding.dimensions[key]);
}

function periodLabel(finding: EngineSignalFindingInput) {
  return stringValue(finding.dimensions.period) ||
    stringValue(finding.dimensions.window) ||
    stringValue(finding.dimensions.period_start) ||
    "current";
}

function coerceChartType(value: unknown): EngineSignalChartType {
  return (allowedChartTypes as readonly unknown[]).includes(value) ? value as EngineSignalChartType : "evidence_list";
}

function strongestConfidence(findings: EngineSignalFindingInput[]): EngineSignalConfidence {
  if (findings.some((finding) => finding.confidence === "alta")) return "alta";
  if (findings.some((finding) => finding.confidence === "media")) return "media";
  return "baja_direccional";
}

function coerceConfidence(value: unknown): EngineSignalConfidence {
  if (value === "alta" || value === "media" || value === "baja_direccional") return value;
  return "baja_direccional";
}

function coerceOwnership(value: unknown): EngineSignalOwnership | null {
  if (
    value === "brand_owned" ||
    value === "competitor_owned" ||
    value === "category_wide" ||
    value === "shared" ||
    value === "insufficient_evidence"
  ) {
    return value;
  }
  return null;
}

function coerceReadiness(value: unknown): EngineSignalMethodologyView["readiness"]["status"] {
  if (value === "beta_ready" || value === "insufficient_evidence") return value;
  return "directional";
}

function coerceConclusionKind(value: unknown): EngineSignalMethodologyView["conclusions"][number]["kind"] {
  if (value === "protect" || value === "dispute" || value === "watch") return value;
  return "validate";
}

function prettifyKey(key: string) {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateText(value: string, length: number) {
  return value.length > length ? `${value.slice(0, Math.max(0, length - 1))}...` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map((item) => String(item)).filter(Boolean);
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
