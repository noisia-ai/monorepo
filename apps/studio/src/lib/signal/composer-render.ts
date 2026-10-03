import type { EngineChart, EngineMethodologyBlock } from "./contracts";

export type ComposerRenderSelection = {
  active: boolean;
  chartKeys: string[];
  canonicalSignalIds?: string[];
  signalFilteringActive?: boolean;
  signalFindingKeys?: string[];
  modules: string[];
};

const chartSlugByMethodologyAndType: Record<string, Partial<Record<EngineChart["type"], string>>> = {
  "narrative-ownership": {
    stacked_share: "ownership_share",
    matrix_2x2: "ownership_valence",
    bar_ranking: "orphan_narratives",
    evidence_list: "evidence"
  },
  "value-perception-matrix": {
    heatmap: "benefit_cost_heatmap",
    matrix_2x2: "value_map",
    bar_ranking: "whitespace_ranking",
    evidence_list: "evidence"
  },
  "journey-friction-mapping": {
    heatmap: "journey_heatmap",
    waterfall: "blockers_accelerators",
    bar_ranking: "phase_friction",
    evidence_list: "evidence"
  },
  "sentiment-advocacy-proxy": {
    diverging_bar: "advocacy_proxy",
    stacked_share: "driver_breakdown",
    timeline: "sentiment_intensity",
    evidence_list: "evidence"
  },
  "trust-risk-benchmark": {
    gauge: "trust_drivers",
    diverging_bar: "risk_benchmark",
    timeline: "escalation_watch",
    evidence_list: "evidence"
  }
};

export function filterEngineBlocksForComposerSelection(
  blocks: EngineMethodologyBlock[],
  selection: ComposerRenderSelection | null
): EngineMethodologyBlock[] {
  if (!selection?.active) return blocks;
  const selectedModules = new Set(selection.modules.map(normalizeSlug).filter(Boolean));
  const selectedCharts = new Set(selection.chartKeys.map(normalizeChartKey).filter(Boolean));
  const selectedFindingKeys = new Set((selection.signalFindingKeys ?? []).map(normalizeFindingKey).filter(Boolean));
  const shouldFilterSignals = selection.signalFilteringActive === true;

  return blocks
    .filter((block) => selectedModules.has(engineBlockSlug(block)))
    .map((block) => filterEngineBlock(block, selectedCharts, selectedFindingKeys, shouldFilterSignals))
    .filter((block) => block.charts.length > 0 || block.findings.length > 0 || block.limitations.length > 0);
}

export function engineChartComposerKey(block: EngineMethodologyBlock, chart: EngineChart): string {
  const slug = engineBlockSlug(block);
  const chartSlug = chartSlugByMethodologyAndType[slug]?.[chart.type] ?? fallbackChartSlug(slug, chart);
  return `${slug}:${chartSlug}`;
}

function fallbackChartSlug(slug: string, chart: EngineChart): string {
  const chartId = normalizeSlug(chart.chart_id);
  const withoutSlug = chartId.startsWith(`${slug}-`) ? chartId.slice(slug.length + 1) : chartId;
  return withoutSlug.replace(/-/g, "_");
}

function engineBlockSlug(block: EngineMethodologyBlock): string {
  return normalizeSlug(block.methodology_slug || block.kind || "");
}

function filterEngineBlock(
  block: EngineMethodologyBlock,
  selectedCharts: Set<string>,
  selectedFindingKeys: Set<string>,
  shouldFilterSignals: boolean
): EngineMethodologyBlock {
  const visibleFindings = shouldFilterSignals
    ? block.findings.filter((finding) => selectedFindingKeys.has(normalizeFindingKey(finding.finding_id)))
    : block.findings;
  const visibleFindingKeys = new Set(visibleFindings.map((finding) => normalizeFindingKey(finding.finding_id)));
  const visibleEvidenceIds = new Set(
    block.evidence_index
      .filter((item) => !shouldFilterSignals || visibleFindingKeys.has(normalizeFindingKey(item.finding_id)))
      .flatMap((item) => item.mention_ids)
      .map(normalizeEvidenceId)
      .filter(Boolean)
  );

  return {
    ...block,
    methodology_view: block.methodology_view
      ? {
          ...block.methodology_view,
          rows: shouldFilterSignals
            ? block.methodology_view.rows.filter((row) => visibleFindingKeys.has(normalizeFindingKey(row.finding_id)))
            : block.methodology_view.rows,
          conclusions: shouldFilterSignals
            ? block.methodology_view.conclusions.filter((item) =>
                item.finding_ids.some((findingId) => visibleFindingKeys.has(normalizeFindingKey(findingId)))
              )
            : block.methodology_view.conclusions
        }
      : block.methodology_view,
    charts: block.charts
      .filter((chart) => selectedCharts.has(engineChartComposerKey(block, chart)))
      .map((chart) => shouldFilterSignals ? filterChartForFindings(chart, visibleFindings, visibleFindingKeys, visibleEvidenceIds) : chart),
    findings: visibleFindings,
    evidence_index: shouldFilterSignals
      ? block.evidence_index.filter((item) => visibleFindingKeys.has(normalizeFindingKey(item.finding_id)))
      : block.evidence_index
  };
}

function filterChartForFindings(
  chart: EngineChart,
  visibleFindings: EngineMethodologyBlock["findings"],
  visibleFindingKeys: Set<string>,
  visibleEvidenceIds: Set<string>
): EngineChart {
  return {
    ...chart,
    data: chart.type === "confidence_badge"
      ? confidenceBadgeData(visibleFindings)
      : filterChartData(chart.data, visibleFindingKeys),
    evidence_ids: chart.evidence_ids.filter((id) => visibleEvidenceIds.has(normalizeEvidenceId(id)))
  };
}

function filterChartData(data: unknown, visibleFindingKeys: Set<string>): unknown {
  if (Array.isArray(data)) {
    return data.filter((item) => {
      const key = chartFindingKey(item);
      return !key || visibleFindingKeys.has(key);
    });
  }
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = Array.isArray(value) ? filterChartData(value, visibleFindingKeys) : value;
  }
  return output;
}

function normalizeSlug(value: unknown): string {
  return String(value ?? "").trim().replace(/_/g, "-").toLowerCase();
}

function normalizeChartKey(value: unknown): string {
  const [moduleSlug, chartSlug] = String(value ?? "").split(":");
  if (!moduleSlug || !chartSlug) return "";
  return `${normalizeSlug(moduleSlug)}:${chartSlug.trim().toLowerCase()}`;
}

function normalizeFindingKey(value: unknown): string {
  return String(value ?? "").trim().replace(/-/g, "_").toLowerCase();
}

function normalizeEvidenceId(value: unknown): string {
  return String(value ?? "").trim();
}

function chartFindingKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return normalizeFindingKey(record.finding_key ?? record.finding_id ?? record.id);
}

function confidenceBadgeData(findings: EngineMethodologyBlock["findings"]) {
  return {
    alta: findings.filter((finding) => finding.confidence === "alta").length,
    media: findings.filter((finding) => finding.confidence === "media").length,
    baja_direccional: findings.filter((finding) => finding.confidence === "baja_direccional").length
  };
}
