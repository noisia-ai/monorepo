import { timingSafeEqual } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { brands, methodologies, publishedOutputs, studyCorpora, themes } from "@noisia/db";

import { db } from "@/lib/db";
import { resolveSignalPulseVisibility } from "@/lib/signal-pulse/runtime-contracts";
import { adaptTbSignalPayload } from "@/lib/signal/adapters/tb";

export type ReportingDataset =
  | "summary"
  | "kpis"
  | "findings"
  | "recommendations"
  | "emerging-patterns"
  | "time-series-monthly"
  | "platform-distribution"
  | "content-type-distribution"
  | "layer-distribution"
  | "mobility-distribution"
  | "polarity-distribution"
  | "evidence-sample";

export type ReportingV2Section =
  | "full"
  | "overview"
  | "findings"
  | "decision-field"
  | "action-cards"
  | "strategic-opportunities"
  | "competitive-intelligence"
  | "engine-methodology"
  | "methodology-view"
  | "emerging-patterns"
  | "future-signals"
  | "market-analysis"
  | "knowledge-impact"
  | "evidence-deep-dives"
  | "aggregates"
  | "evidence-sample"
  | "signals"
  | "marketing-moves"
  | "paid-organic"
  | "competitive-category"
  | "sources"
  | "quality"
  | "manifest";

type ApiKeyConfig = {
  label: string;
  key: string;
  outputs: string[];
};

type ApiKeyGrant = {
  label: string;
  outputs: string[];
};

type PublishedOutputRow = Awaited<ReturnType<typeof getPublishedOutputForReporting>>;

const DATASET_ALIASES: Record<string, ReportingDataset> = {
  summary: "summary",
  overview: "summary",
  kpis: "kpis",
  metrics: "kpis",
  findings: "findings",
  recommendations: "recommendations",
  actions: "recommendations",
  "emerging-patterns": "emerging-patterns",
  "emerging_patterns": "emerging-patterns",
  patterns: "emerging-patterns",
  "time-series-monthly": "time-series-monthly",
  "time_series_monthly": "time-series-monthly",
  "volume-timeline": "time-series-monthly",
  "platform-distribution": "platform-distribution",
  "platform_distribution": "platform-distribution",
  "content-type-distribution": "content-type-distribution",
  "content_type_distribution": "content-type-distribution",
  "layer-distribution": "layer-distribution",
  "layer_distribution": "layer-distribution",
  "mobility-distribution": "mobility-distribution",
  "mobility_distribution": "mobility-distribution",
  "polarity-distribution": "polarity-distribution",
  "polarity_distribution": "polarity-distribution",
  "evidence-sample": "evidence-sample",
  "evidence_sample": "evidence-sample",
  verbatims: "evidence-sample",
  "mentions-sample": "evidence-sample",
  "mentions_sample": "evidence-sample"
};

const DATASET_LABELS: Record<ReportingDataset, string> = {
  summary: "Report summary",
  kpis: "Report KPIs",
  findings: "Findings",
  recommendations: "Recommendations",
  "emerging-patterns": "Emerging patterns",
  "time-series-monthly": "Monthly time series",
  "platform-distribution": "Platform distribution",
  "content-type-distribution": "Content type distribution",
  "layer-distribution": "Layer distribution",
  "mobility-distribution": "Mobility distribution",
  "polarity-distribution": "Polarity distribution",
  "evidence-sample": "Evidence sample"
};

const V2_SECTION_ALIASES: Record<string, ReportingV2Section> = {
  full: "full",
  signal: "full",
  report: "full",
  payload: "full",
  summary: "overview",
  overview: "overview",
  findings: "findings",
  "decision-field": "decision-field",
  "decision_field": "decision-field",
  "tb-decision-field": "decision-field",
  "tb_decision_field": "decision-field",
  "action-cards": "action-cards",
  "action_cards": "action-cards",
  "action-studio": "action-cards",
  "action_studio": "action-cards",
  actions: "action-cards",
  recommendations: "action-cards",
  "strategic-opportunities": "strategic-opportunities",
  "strategic_opportunities": "strategic-opportunities",
  opportunities: "strategic-opportunities",
  "competitive-intelligence": "competitive-intelligence",
  "competitive_intelligence": "competitive-intelligence",
  competitive: "competitive-intelligence",
  "engine-methodology": "engine-methodology",
  "engine_methodology": "engine-methodology",
  "competitive-wave": "engine-methodology",
  "competitive_wave": "engine-methodology",
  "narrative-ownership": "engine-methodology",
  "narrative_ownership": "engine-methodology",
  "value-perception": "engine-methodology",
  "value_perception": "engine-methodology",
  "brand-positioning": "engine-methodology",
  "brand_positioning": "engine-methodology",
  "category-opportunity": "engine-methodology",
  "category_opportunity": "engine-methodology",
  "white-space": "engine-methodology",
  "white_space": "engine-methodology",
  "journey-friction": "engine-methodology",
  "journey_friction": "engine-methodology",
  "decision-velocity": "engine-methodology",
  "decision_velocity": "engine-methodology",
  "cultural-codes": "engine-methodology",
  "cultural_codes": "engine-methodology",
  "advocacy-proxy": "engine-methodology",
  "advocacy_proxy": "engine-methodology",
  "audience-segment": "engine-methodology",
  "audience_segment": "engine-methodology",
  "influence-architecture": "engine-methodology",
  "influence_architecture": "engine-methodology",
  "trust-risk": "engine-methodology",
  "trust_risk": "engine-methodology",
  "evidence-confidence": "engine-methodology",
  "evidence_confidence": "engine-methodology",
  engine: "engine-methodology",
  lens: "engine-methodology",
  "methodology-view": "methodology-view",
  "methodology_view": "methodology-view",
  "lens-view": "methodology-view",
  "lens_view": "methodology-view",
  "emerging-patterns": "emerging-patterns",
  "emerging_patterns": "emerging-patterns",
  patterns: "emerging-patterns",
  "future-signals": "future-signals",
  "future_signals": "future-signals",
  futures: "future-signals",
  "market-analysis": "market-analysis",
  "market_analysis": "market-analysis",
  market: "market-analysis",
  "knowledge-impact": "knowledge-impact",
  "knowledge_impact": "knowledge-impact",
  knowledge: "knowledge-impact",
  "evidence-deep-dives": "evidence-deep-dives",
  "evidence_deep_dives": "evidence-deep-dives",
  "deep-dives": "evidence-deep-dives",
  "deep_dives": "evidence-deep-dives",
  aggregates: "aggregates",
  charts: "aggregates",
  "evidence-sample": "evidence-sample",
  "evidence_sample": "evidence-sample",
  "mentions-sample": "evidence-sample",
  "mentions_sample": "evidence-sample",
  verbatims: "evidence-sample",
  signals: "signals",
  "signal-pulse-signals": "signals",
  "marketing-moves": "marketing-moves",
  "marketing_moves": "marketing-moves",
  moves: "marketing-moves",
  "paid-organic": "paid-organic",
  "paid_organic": "paid-organic",
  performance: "paid-organic",
  "competitive-category": "competitive-category",
  "competitive_category": "competitive-category",
  category: "competitive-category",
  sources: "sources",
  quality: "quality",
  manifest: "manifest"
};

export async function authorizeReportingRequest(request: Request, outputId?: string) {
  const key = getApiKeyFromRequest(request);

  if (!key) {
    return { ok: false as const, response: errorResponse("missing_api_key", "Missing reporting API key.", 401) };
  }

  const configs = parseApiKeyConfigs();
  const match = configs.find((config) => safeEqual(config.key, key));

  if (!match) {
    return { ok: false as const, response: errorResponse("invalid_api_key", "Invalid reporting API key.", 401) };
  }

  if (outputId && !canAccessOutput(match.outputs, outputId)) {
    return { ok: false as const, response: errorResponse("forbidden_output", "API key cannot access this report.", 403) };
  }

  return { ok: true as const, grant: { label: match.label, outputs: match.outputs } satisfies ApiKeyGrant };
}

export async function listReportsForGrant(grant: ApiKeyGrant) {
  const where = [eq(publishedOutputs.status, "published"), isNull(publishedOutputs.archivedAt)];

  if (!grant.outputs.includes("*")) {
    where.push(inArray(publishedOutputs.id, grant.outputs));
  }

  const rows = await db
    .select({
      outputId: publishedOutputs.id,
      studyCorpusId: publishedOutputs.studyCorpusId,
      outputType: publishedOutputs.outputType,
      kind: publishedOutputs.kind,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      version: publishedOutputs.version,
      publishedAt: publishedOutputs.publishedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      themeName: themes.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .leftJoin(themes, eq(themes.id, publishedOutputs.themeId))
    .where(and(...where))
    .orderBy(desc(publishedOutputs.publishedAt), desc(publishedOutputs.updatedAt));

  const visibleRows = grant.outputs.includes("*") ? latestCanonicalReports(rows) : rows;

  return visibleRows.map((row) => ({
    output_id: row.outputId,
    title: row.title,
    headline: row.headline,
    summary: row.summary,
    report_version: row.version,
    brand_name: reportSubjectName(row),
    methodology: row.methodologyName,
    methodology_slug: row.methodologySlug,
    published_at: row.publishedAt?.toISOString() ?? null
  }));
}

export async function listReportsForGrantV2(grant: ApiKeyGrant) {
  const where = [eq(publishedOutputs.status, "published"), isNull(publishedOutputs.archivedAt)];

  if (!grant.outputs.includes("*")) {
    where.push(inArray(publishedOutputs.id, grant.outputs));
  }

  const rows = await db
    .select({
      outputId: publishedOutputs.id,
      studyCorpusId: publishedOutputs.studyCorpusId,
      outputType: publishedOutputs.outputType,
      kind: publishedOutputs.kind,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      version: publishedOutputs.version,
      manifest: publishedOutputs.manifest,
      payload: publishedOutputs.payload,
      visibilityConfig: publishedOutputs.visibilityConfig,
      publishedAt: publishedOutputs.publishedAt,
      updatedAt: publishedOutputs.updatedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      themeName: themes.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .leftJoin(themes, eq(themes.id, publishedOutputs.themeId))
    .where(and(...where))
    .orderBy(desc(publishedOutputs.publishedAt), desc(publishedOutputs.updatedAt));

  const visibleRows = grant.outputs.includes("*") ? latestCanonicalReports(rows) : rows;

  return visibleRows.map((row) => {
    const payload = asRecord(row.payload);
    const report = asRecord(payload.report);
    return {
      api_version: 2,
      output_id: row.outputId,
      output_type: row.outputType,
      title: row.title,
      headline: stringValue(report.headline) || row.headline,
      summary: stringValue(report.summary) || row.summary,
      report_version: row.version,
      schema_version: numberValue(payload.schema_version) || row.version,
      brand_name: reportSubjectName(row, report),
      methodology: stringValue(report.methodology_name) || row.methodologyName,
      methodology_slug: stringValue(report.methodology_slug) || row.methodologySlug,
      published_at: row.publishedAt?.toISOString() ?? null,
      updated_at: row.updatedAt?.toISOString() ?? null,
      sections: getEnabledV2Sections(row.manifest, row.payload, row.visibilityConfig),
      links: {
        full: `/api/public/v2/reports/${row.outputId}`,
        sections: `/api/public/v2/reports/${row.outputId}/sections/{section}`
      }
    };
  });
}

function latestCanonicalReports<
  T extends { studyCorpusId: string; outputType: string; methodologySlug: string }
>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.studyCorpusId}:${row.outputType}:${row.methodologySlug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getPublishedOutputForReporting(outputId: string) {
  const [row] = await db
    .select({
      outputId: publishedOutputs.id,
      tbAnalysisId: publishedOutputs.tbAnalysisId,
      studyCorpusId: publishedOutputs.studyCorpusId,
      brandId: publishedOutputs.brandId,
      outputType: publishedOutputs.outputType,
      kind: publishedOutputs.kind,
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      version: publishedOutputs.version,
      manifest: publishedOutputs.manifest,
      payload: publishedOutputs.payload,
      visibilityConfig: publishedOutputs.visibilityConfig,
      publishedAt: publishedOutputs.publishedAt,
      generatedAt: publishedOutputs.createdAt,
      updatedAt: publishedOutputs.updatedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      themeName: themes.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .leftJoin(themes, eq(themes.id, publishedOutputs.themeId))
    .where(and(eq(publishedOutputs.id, outputId), eq(publishedOutputs.status, "published"), isNull(publishedOutputs.archivedAt)))
    .limit(1);

  return row ?? null;
}

export function resolveReportingDataset(dataset: string | null | undefined): ReportingDataset | null {
  if (!dataset) return "summary";
  const normalized = dataset.replace(/\.csv$/i, "").replace(/\.json$/i, "").toLowerCase();
  return DATASET_ALIASES[normalized] ?? null;
}

export function getDatasetLabel(dataset: ReportingDataset) {
  return DATASET_LABELS[dataset];
}

export function resolveReportingV2Section(section: string | null | undefined): ReportingV2Section | null {
  if (!section) return "full";
  const normalized = section.replace(/\.json$/i, "").toLowerCase();
  return V2_SECTION_ALIASES[normalized] ?? null;
}

export function buildReportingDataset(output: NonNullable<PublishedOutputRow>, dataset: ReportingDataset) {
  const payload = asRecord(output.payload);
  const report = asRecord(payload.report);
  const metrics = asRecord(payload.metrics);
  const aggregates = asRecord(payload.aggregates);
  const corpus = asRecord(aggregates.corpus);

  if (dataset === "summary") {
    return [
      {
        output_id: output.outputId,
        report_version: output.version,
        brand_name: reportSubjectName(output, report),
        methodology: stringValue(report.methodology_name) || output.methodologyName,
        methodology_slug: stringValue(report.methodology_slug) || output.methodologySlug,
        business_question: stringValue(report.business_question),
        headline: stringValue(report.headline) || output.headline,
        summary: stringValue(report.summary) || output.summary,
        generated_at: stringValue(payload.generated_at) || output.generatedAt?.toISOString() || null,
        published_at: output.publishedAt?.toISOString() ?? null,
        corpus_total_mentions: numberValue(corpus.total_mentions),
        window_start: stringValue(asRecord(corpus.window).start),
        window_end: stringValue(asRecord(corpus.window).end),
        window_months: numberValue(asRecord(corpus.window).months)
      }
    ];
  }

  if (dataset === "kpis") {
    return [
      ["findings_total", "Findings total", metrics.findings_total],
      ["barriers_total", "Barriers total", metrics.barriers_total],
      ["triggers_total", "Triggers total", metrics.triggers_total],
      ["movable_total", "Movable findings", metrics.movable_total]
    ].map(([metricKey, metricLabel, metricValue]) => ({
      output_id: output.outputId,
      metric_key: metricKey,
      metric_label: metricLabel,
      metric_value: numberValue(metricValue)
    }));
  }

  if (dataset === "findings") {
    const publicFindings = arrayValue(payload.findings).map(asRecord);
    if (publicFindings.length > 0) {
      return publicFindings.map((row) => ({
        output_id: output.outputId,
        finding_id: stringValue(row.finding_id),
        finding_name: stringValue(row.finding_name),
        polarity: stringValue(row.polarity),
        layer: stringValue(row.layer),
        mobility: stringValue(row.mobility),
        confidence: stringValue(row.confidence),
        frequency_mentions: numberValue(row.frequency_mentions),
        intensity_score: numberValue(row.intensity_score),
        predictive_capacity: numberValue(row.predictive_capacity),
        composite_score: numberValue(row.composite_score),
        citation_count: numberValue(row.evidence_count),
        period_start: stringValue(row.period_start),
        period_end: stringValue(row.period_end),
        public_quote: stringValue(row.public_quote)
      }));
    }

    const scatterById = new Map(
      arrayValue(aggregates.findings_scatter).map((item) => {
        const row = asRecord(item);
        return [stringValue(row.finding_id), row] as const;
      })
    );
    const voiceById = new Map(
      arrayValue(aggregates.top_findings_by_voice).map((item) => {
        const row = asRecord(item);
        return [stringValue(row.finding_id), row] as const;
      })
    );
    const rows = [...arrayValue(payload.barriers), ...arrayValue(payload.triggers)].map(asRecord);
    return rows.map((row) => {
      const findingId = stringValue(row.finding_id);
      const scatter = scatterById.get(findingId) ?? {};
      const voice = voiceById.get(findingId) ?? {};
      return {
        output_id: output.outputId,
        finding_id: findingId,
        finding_name: stringValue(row.finding_name),
        polarity: stringValue(row.kind) === "activation" ? "trigger" : "barrier",
        layer: stringValue(row.layer),
        mobility: stringValue(row.movilidad),
        confidence: stringValue(row.confidence),
        frequency_mentions: numberValue(scatter.frecuencia),
        intensity_score: numberValue(scatter.intensidad),
        composite_score: numberValue(scatter.score),
        citation_count: numberValue(voice.citation_count),
        public_quote: stringValue(row.quote)
      };
    });
  }

  if (dataset === "recommendations") {
    const actionCards = arrayValue(payload.action_cards).map(asRecord);
    if (actionCards.length > 0) {
      return actionCards.map((row, index) => ({
        output_id: output.outputId,
        recommendation_id: stringValue(row.action_id),
        finding_id: stringValue(row.primary_finding_id),
        finding_ids: stringArray(row.finding_ids).join(","),
        finding_name: stringValue(row.title),
        kind: stringValue(row.kind),
        target_team: stringValue(row.target_team),
        recommendation_text: stringValue(row.action_text),
        rationale: stringValue(row.rationale),
        intervention_type: stringValue(row.suggested_format),
        estimated_effort: stringValue(row.estimated_effort),
        estimated_impact: stringValue(row.estimated_impact),
        success_signal: stringValue(row.success_signal),
        suggested_owner: stringValue(row.target_team),
        recommended_medium: stringValue(row.suggested_channel),
        recommended_tone: "",
        confidence: stringValue(row.confidence),
        priority_rank: numberValue(row.priority_rank) || index + 1
      }));
    }

    const barriers = arrayValue(payload.barriers).map(asRecord);
    const triggers = arrayValue(payload.triggers).map(asRecord);
    return [...barriers, ...triggers]
      .filter((row) => stringValue(row.kind) !== "structural_note")
      .map((row, index) => ({
        output_id: output.outputId,
        recommendation_id: stringValue(row.id),
        finding_id: stringValue(row.finding_id),
        finding_name: stringValue(row.finding_name),
        kind: stringValue(row.kind),
        recommendation_text: stringValue(row.text),
        intervention_type: stringValue(row.type),
        estimated_effort: stringValue(row.effort),
        success_signal: stringValue(row.success_signal),
        suggested_owner: stringValue(row.owner),
        recommended_medium: stringValue(row.medium),
        recommended_tone: stringValue(row.tone),
        confidence: stringValue(row.confidence),
        priority_rank: index + 1
      }));
  }

  if (dataset === "emerging-patterns") {
    return arrayValue(payload.emerging_patterns).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        pattern_id: stringValue(row.pattern_id),
        title: stringValue(row.title),
        pattern_type: stringValue(row.pattern_type),
        why_it_matters: stringValue(row.why_it_matters),
        data_basis: stringArray(row.data_basis).join(","),
        evidence_count: numberValue(row.evidence_count),
        related_finding_ids: stringArray(row.related_finding_ids).join(","),
        confidence: stringValue(row.confidence)
      };
    });
  }

  if (dataset === "time-series-monthly") {
    return arrayValue(aggregates.volume_timeline).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        month: stringValue(row.month),
        mention_count: numberValue(row.count)
      };
    });
  }

  if (dataset === "platform-distribution") {
    return arrayValue(aggregates.platform_distribution).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        platform: stringValue(row.platform),
        mention_count: numberValue(row.count),
        share_pct: numberValue(row.pct)
      };
    });
  }

  if (dataset === "content-type-distribution") {
    return arrayValue(aggregates.content_type_distribution).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        content_type: stringValue(row.content_type),
        mention_count: numberValue(row.count),
        share_pct: numberValue(row.pct)
      };
    });
  }

  if (dataset === "layer-distribution") {
    return arrayValue(aggregates.layer_distribution).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        layer: stringValue(row.layer),
        finding_count: numberValue(row.count),
        share_pct: numberValue(row.pct),
        avg_intensity: numberValue(row.avg_intensity)
      };
    });
  }

  if (dataset === "mobility-distribution") {
    return arrayValue(aggregates.mobility_distribution).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        mobility: stringValue(row.movilidad),
        finding_count: numberValue(row.count),
        share_pct: numberValue(row.pct)
      };
    });
  }

  if (dataset === "polarity-distribution") {
    return arrayValue(aggregates.polarity_distribution).map((item) => {
      const row = asRecord(item);
      return {
        output_id: output.outputId,
        polarity: stringValue(row.polarity),
        finding_count: numberValue(row.count),
        share_pct: numberValue(row.pct)
      };
    });
  }

  return arrayValue(aggregates.mentions_sample).map((item) => {
    const row = asRecord(item);
    return {
      output_id: output.outputId,
      mention_id: stringValue(row.mention_id),
      finding_id: stringValue(row.finding_id),
      finding_name: stringValue(row.finding_name),
      text: stringValue(row.text),
      platform: stringValue(row.platform),
      published_at: stringValue(row.published_at),
      is_protagonist: Boolean(row.is_protagonist)
    };
  });
}

export function jsonDatasetResponse(output: NonNullable<PublishedOutputRow>, dataset: ReportingDataset, rows: Array<Record<string, unknown>>) {
  return Response.json(
    {
      data: rows,
      meta: {
        output_id: output.outputId,
        dataset,
        dataset_label: getDatasetLabel(dataset),
        row_count: rows.length,
        report_version: output.version,
        published_at: output.publishedAt?.toISOString() ?? null
      }
    },
    { headers: noStoreHeaders() }
  );
}

export function csvDatasetResponse(dataset: ReportingDataset, rows: Array<Record<string, unknown>>) {
  return new Response(toCsv(rows), {
    headers: {
      ...noStoreHeaders(),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="noisia-${dataset}.csv"`
    }
  });
}

export function buildReportingV2Document(output: NonNullable<PublishedOutputRow>) {
  if (output.kind === "signal_pulse" || output.methodologySlug === "signal-pulse") {
    return buildSignalPulseReportingV2Document(output);
  }

  const payload = asRecord(output.payload);
  const viewModel = adaptTbSignalPayload(payload);
  const aggregates = asRecord(viewModel.aggregates);
  const corpus = asRecord(aggregates.corpus);
  const corpusWindow = asRecord(corpus.window);
  const subjectName = reportSubjectName(output, asRecord(payload.report)) ?? viewModel.report.brand_name;
  const metadata = {
    api_version: 2,
    output_id: output.outputId,
    output_type: output.outputType,
    report_version: output.version,
    schema_version: numberValue(payload.schema_version) || output.version,
    title: output.title,
    published_at: output.publishedAt?.toISOString() ?? null,
    generated_at: stringValue(payload.generated_at) || output.generatedAt?.toISOString() || null,
    updated_at: output.updatedAt?.toISOString() ?? null,
    brand_name: subjectName,
    methodology: viewModel.report.methodology_name || output.methodologyName,
    methodology_slug: viewModel.report.methodology_slug || output.methodologySlug,
    business_question: viewModel.report.business_question,
    corpus: {
      total_mentions: numberValue(corpus.total_mentions),
      window_start: stringValue(corpusWindow.start),
      window_end: stringValue(corpusWindow.end),
      window_months: numberValue(corpusWindow.months)
    }
  };
  const sections = {
    overview: {
      report: { ...viewModel.report, brand_name: subjectName },
      metrics: viewModel.metrics,
      knowledge_impact: viewModel.knowledgeImpact,
      client_boundaries: viewModel.clientBoundaries
    },
    findings: viewModel.findings,
    decision_field: {
      nodes: viewModel.decisionFieldNodes,
      edges: arrayValue(payload.tb_decision_field_edges)
    },
    action_cards: viewModel.actionCards,
    strategic_opportunities: viewModel.strategicOpportunities,
    competitive_intelligence: viewModel.competitive,
    engine_methodology: viewModel.engineBlock,
    methodology_view: viewModel.engineBlock?.methodology_view ?? null,
    emerging_patterns: viewModel.emergingPatterns,
    future_signals: viewModel.futureSignals,
    market_analysis: viewModel.marketAnalysis,
    knowledge_impact: viewModel.knowledgeImpact,
    evidence_deep_dives: viewModel.evidenceDeepDives,
    aggregates: viewModel.aggregates,
    evidence_sample: arrayValue(aggregates.mentions_sample).map(asRecord),
    manifest: viewModel.manifest
  };

  return {
    metadata,
    report: viewModel.report,
    manifest: viewModel.manifest,
    metrics: viewModel.metrics,
    sections
  };
}

export function buildReportingV2Section(output: NonNullable<PublishedOutputRow>, section: ReportingV2Section) {
  const document = buildReportingV2Document(output);
  const sections = document.sections as Record<string, unknown>;

  switch (section) {
    case "full":
      return document;
    case "overview":
      return sections.overview;
    case "findings":
      return sections.findings;
    case "decision-field":
      return sections.decision_field;
    case "action-cards":
      return sections.action_cards;
    case "strategic-opportunities":
      return sections.strategic_opportunities;
    case "competitive-intelligence":
      return sections.competitive_intelligence;
    case "engine-methodology":
      return sections.engine_methodology;
    case "methodology-view":
      return sections.methodology_view;
    case "emerging-patterns":
      return sections.emerging_patterns;
    case "future-signals":
      return sections.future_signals;
    case "market-analysis":
      return sections.market_analysis;
    case "knowledge-impact":
      return sections.knowledge_impact;
    case "evidence-deep-dives":
      return sections.evidence_deep_dives;
    case "aggregates":
      return sections.aggregates;
    case "evidence-sample":
      return sections.evidence_sample;
    case "signals":
      return sections.signals;
    case "marketing-moves":
      return sections.marketing_moves;
    case "paid-organic":
      return sections.paid_organic;
    case "competitive-category":
      return sections.competitive_category;
    case "sources":
      return sections.sources;
    case "quality":
      return sections.quality;
    case "manifest":
      return sections.manifest;
  }
}

function buildSignalPulseReportingV2Document(output: NonNullable<PublishedOutputRow>) {
  const payload = asRecord(output.payload);
  const report = asRecord(payload.report);
  const executiveRead = asRecord(payload.executive_read);
  const periods = arrayValue(payload.periods).map(asRecord);
  const signals = arrayValue(payload.signals).map(asRecord);
  const moves = arrayValue(payload.marketing_moves).map(asRecord);
  const evidence = arrayValue(payload.evidence).map(asRecord);
  const sources = arrayValue(payload.sources).map(asRecord);
  const qualityGates = arrayValue(payload.quality_gates).map(asRecord);
  const performance = asRecord(payload.performance);
  const chartRefs = asRecord(payload.chart_refs);
  const cost = asRecord(payload.cost);
  const visibility = resolveSignalPulseVisibility({
    config: output.visibilityConfig,
    isInternalUser: false
  });
  const sectionsEnabled = getSignalPulseV2Sections(visibility);
  const subjectName = reportSubjectName(output, report) ?? stringValue(report.title);
  const metadata = {
    api_version: 2,
    output_id: output.outputId,
    output_type: output.outputType,
    report_version: output.version,
    schema_version: numberValue(payload.schema_version) || output.version,
    title: output.title,
    published_at: output.publishedAt?.toISOString() ?? null,
    generated_at: stringValue(payload.generated_at) || output.generatedAt?.toISOString() || null,
    updated_at: output.updatedAt?.toISOString() ?? null,
    brand_name: subjectName,
    methodology: output.methodologyName,
    methodology_slug: output.methodologySlug,
    business_question: stringValue(report.business_question),
    visibility: {
      paid_data: visibility.showPaidOrganic,
      competitive: visibility.showCompetitive,
      evidence: visibility.showEvidence
    },
    corpus: {
      period_count: periods.length,
      window_start: stringValue(periods[0]?.period_start),
      window_end: stringValue(periods.at(-1)?.period_end)
    }
  };
  const locked = (section: string) => ({
    locked: true,
    section,
    reason: "not_authorized_for_client_export"
  });
  const sections = {
    overview: {
      report: {
        title: stringValue(report.title) || output.title,
        brand_name: subjectName,
        business_question: stringValue(report.business_question)
      },
      executive_read: executiveRead,
      periods,
      cost,
      chart_refs: chartRefs
    },
    signals,
    marketing_moves: moves,
    evidence_sample: visibility.showEvidence ? evidence.slice(0, 80) : locked("evidence_sample"),
    paid_organic: visibility.showPaidOrganic ? performance : locked("paid_organic"),
    competitive_category: visibility.showCompetitive ? {
      signals,
      evidence_sample: visibility.showEvidence ? evidence.slice(0, 80) : []
    } : locked("competitive_category"),
    sources: visibility.showSources ? sources : locked("sources"),
    quality: visibility.showQuality ? {
      quality_gates: qualityGates,
      limitations: arrayValue(payload.limitations).map(stringValue).filter(Boolean)
    } : locked("quality"),
    manifest: {
      kind: "signal_pulse",
      sections: sectionsEnabled,
      visibility: metadata.visibility
    }
  };

  return {
    metadata,
    report: sections.overview.report,
    manifest: sections.manifest,
    sections
  };
}

export function jsonV2Response(
  output: NonNullable<PublishedOutputRow>,
  section: ReportingV2Section,
  data: unknown
) {
  const payload = asRecord(output.payload);
  return Response.json(
    {
      data,
      meta: {
        api_version: 2,
        output_id: output.outputId,
        section,
        report_version: output.version,
        schema_version: numberValue(payload.schema_version) || output.version,
        published_at: output.publishedAt?.toISOString() ?? null
      }
    },
    { headers: noStoreHeaders() }
  );
}

export function noStoreHeaders() {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}

export function errorResponse(error: string, message: string, status: number) {
  return Response.json({ error, message }, { status, headers: noStoreHeaders() });
}

function getApiKeyFromRequest(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice("bearer ".length).trim();
  }

  return request.headers.get("x-noisia-api-key")?.trim() || new URL(request.url).searchParams.get("api_key")?.trim() || "";
}

function parseApiKeyConfigs(): ApiKeyConfig[] {
  const raw = process.env.NOISIA_REPORTING_API_KEYS?.trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as Array<{ label?: string; key?: string; outputs?: string[] }>;
      return parsed
        .filter((item) => item.key)
        .map((item, index) => ({
          label: item.label || `key_${index + 1}`,
          key: String(item.key),
          outputs: Array.isArray(item.outputs) && item.outputs.length > 0 ? item.outputs.map(String) : ["*"]
        }));
    } catch {
      return [];
    }
  }

  return raw
    .split(",")
    .map((entry, index) => {
      const [label, key, scopes] = entry.split(":").map((part) => part.trim());
      if (!key) return null;
      return {
        label: label || `key_${index + 1}`,
        key,
        outputs: scopes ? scopes.split("|").map((part) => part.trim()).filter(Boolean) : ["*"]
      };
    })
    .filter((item): item is ApiKeyConfig => Boolean(item));
}

function canAccessOutput(outputs: string[], outputId: string) {
  return outputs.includes("*") || outputs.includes(outputId);
}

function reportSubjectName(
  row: { brandName?: string | null; brandFallbackName?: string | null; themeName?: string | null },
  report: Record<string, unknown> = {}
) {
  return stringValue(report.brand_name) || row.brandName || row.brandFallbackName || row.themeName || null;
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return "";
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ];
  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function getEnabledV2Sections(manifest: unknown, payload: unknown = null, visibilityConfig: unknown = null) {
  const flags = asRecord(manifest);
  const payloadRecord = asRecord(payload);
  if (stringValue(payloadRecord.kind) === "signal_pulse" || stringValue(flags.kind) === "signal_pulse") {
    return getSignalPulseV2Sections(resolveSignalPulseVisibility({
      config: visibilityConfig,
      isInternalUser: false
    }));
  }
  const engineBlock = asRecord(asRecord(payload).engine_block);
  const hasEngineBlock = Boolean(stringValue(engineBlock.methodology_slug) || stringValue(engineBlock.kind));
  const engineModuleKeys = [
    "engine_methodology",
    "competitive_wave",
    "narrative_ownership",
    "value_perception",
    "brand_positioning",
    "category_opportunity",
    "white_space",
    "journey_friction",
    "decision_velocity",
    "cultural_codes",
    "advocacy_proxy",
    "audience_segment",
    "influence_architecture",
    "trust_risk",
    "evidence_confidence"
  ];
  const sectionMap: Array<[ReportingV2Section, string[], { requiresEngine?: boolean }?]> = [
    ["overview", ["overview"]],
    ["findings", ["overview", "tb_decision_field", "evidence"]],
    ["decision-field", ["tb_decision_field"]],
    ["action-cards", ["action_studio"]],
    ["strategic-opportunities", ["opportunities"]],
    ["competitive-intelligence", ["competitive_intelligence"]],
    ["engine-methodology", engineModuleKeys, { requiresEngine: true }],
    ["methodology-view", engineModuleKeys, { requiresEngine: true }],
    ["emerging-patterns", ["emerging_patterns"]],
    ["future-signals", ["emerging_patterns"]],
    ["market-analysis", ["emerging_patterns"]],
    ["knowledge-impact", ["overview"]],
    ["evidence-deep-dives", ["evidence"]],
    ["aggregates", ["overview"]],
    ["evidence-sample", ["corpus_view", "evidence"]],
    ["manifest", ["overview"]]
  ];

  if (Object.keys(flags).length === 0) {
    return sectionMap
      .filter(([, , options]) => !options?.requiresEngine || hasEngineBlock)
      .map(([section]) => section);
  }

  return sectionMap
    .filter(([, keys, options]) => (!options?.requiresEngine || hasEngineBlock) && keys.some((key) => flags[key] !== false))
    .map(([section]) => section);
}

function getSignalPulseV2Sections(visibility: ReturnType<typeof resolveSignalPulseVisibility>): ReportingV2Section[] {
  return [
    "overview",
    "signals",
    "marketing-moves",
    visibility.showEvidence ? "evidence-sample" : null,
    visibility.showPaidOrganic ? "paid-organic" : null,
    visibility.showCompetitive ? "competitive-category" : null,
    visibility.showSources ? "sources" : null,
    visibility.showQuality ? "quality" : null,
    "manifest"
  ].filter((section): section is ReportingV2Section => Boolean(section));
}
