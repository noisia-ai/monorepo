import { timingSafeEqual } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { brands, methodologies, publishedOutputs, studyCorpora } from "@noisia/db";

import { db } from "@/lib/db";

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
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      version: publishedOutputs.version,
      publishedAt: publishedOutputs.publishedAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
    .where(and(...where))
    .orderBy(desc(publishedOutputs.publishedAt), desc(publishedOutputs.updatedAt));

  const visibleRows = grant.outputs.includes("*") ? latestCanonicalReports(rows) : rows;

  return visibleRows.map((row) => ({
    output_id: row.outputId,
    title: row.title,
    headline: row.headline,
    summary: row.summary,
    report_version: row.version,
    brand_name: row.brandName ?? row.brandFallbackName,
    methodology: row.methodologyName,
    methodology_slug: row.methodologySlug,
    published_at: row.publishedAt?.toISOString() ?? null
  }));
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
      title: publishedOutputs.title,
      headline: publishedOutputs.headline,
      summary: publishedOutputs.summary,
      version: publishedOutputs.version,
      payload: publishedOutputs.payload,
      publishedAt: publishedOutputs.publishedAt,
      generatedAt: publishedOutputs.createdAt,
      brandName: brands.displayName,
      brandFallbackName: brands.name,
      methodologyName: methodologies.name,
      methodologySlug: publishedOutputs.methodologySlug
    })
    .from(publishedOutputs)
    .innerJoin(studyCorpora, eq(studyCorpora.id, publishedOutputs.studyCorpusId))
    .innerJoin(methodologies, eq(methodologies.id, studyCorpora.methodologyId))
    .leftJoin(brands, eq(brands.id, publishedOutputs.brandId))
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
        brand_name: stringValue(report.brand_name) || output.brandName || output.brandFallbackName,
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
