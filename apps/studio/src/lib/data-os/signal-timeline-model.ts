import type { DataOsMonthlySeriesPoint } from "@/lib/data-os/readiness";

export type SignalDataOsMetric = {
  key: string;
  label: string;
  unit: string | null;
  family: string;
  overlappingMonths: number;
};

export type SignalDataOsTimelinePoint = {
  month: string;
  mentions: number;
  values: Record<string, number | null>;
};

export type SignalDataOsTimelineModel = {
  refKey: "cross_source_timeline";
  metrics: SignalDataOsMetric[];
  points: SignalDataOsTimelinePoint[];
  overlappingMonths: number;
};

const METRIC_PRIORITY = [
  "sales_monthly",
  "revenue_monthly",
  "orders_monthly",
  "units_monthly",
  "search_volume_monthly",
  "support_tickets_monthly",
  "spend_monthly",
  "margin_monthly"
];

export function buildSignalDataOsTimeline(
  series: DataOsMonthlySeriesPoint[]
): SignalDataOsTimelineModel | null {
  const mentionsByMonth = new Map<string, number>();
  const observationsByMetric = new Map<string, {
    family: string;
    unit: string | null;
    values: Map<string, number>;
  }>();

  for (const point of series) {
    if (point.source === "listening_mentions" && point.metricKey === "mentions_monthly") {
      mentionsByMonth.set(point.month, (mentionsByMonth.get(point.month) ?? 0) + point.value);
      continue;
    }
    if (point.source !== "data_observations") continue;
    const metric = observationsByMetric.get(point.metricKey) ?? {
      family: point.metricFamily,
      unit: point.unit,
      values: new Map<string, number>()
    };
    metric.values.set(point.month, (metric.values.get(point.month) ?? 0) + point.value);
    observationsByMetric.set(point.metricKey, metric);
  }

  if (mentionsByMonth.size === 0 || observationsByMetric.size === 0) return null;

  const metrics = Array.from(observationsByMetric.entries())
    .map(([key, metric]) => ({
      key,
      label: metricLabel(key),
      unit: metric.unit,
      family: metric.family,
      overlappingMonths: Array.from(metric.values.keys()).filter((month) => mentionsByMonth.has(month)).length
    }))
    .filter((metric) => metric.overlappingMonths > 0)
    .sort((left, right) => {
      const leftPriority = priorityForMetric(left.key);
      const rightPriority = priorityForMetric(right.key);
      return leftPriority - rightPriority || right.overlappingMonths - left.overlappingMonths || left.label.localeCompare(right.label);
    })
    .slice(0, 8);

  if (metrics.length === 0) return null;

  const months = Array.from(mentionsByMonth.keys())
    .filter((month) => metrics.some((metric) => observationsByMetric.get(metric.key)?.values.has(month)))
    .sort();
  const points = months.map((month) => ({
    month,
    mentions: mentionsByMonth.get(month) ?? 0,
    values: Object.fromEntries(metrics.map((metric) => [
      metric.key,
      observationsByMetric.get(metric.key)?.values.get(month) ?? null
    ]))
  }));

  return {
    refKey: "cross_source_timeline",
    metrics,
    points,
    overlappingMonths: months.length
  };
}

function priorityForMetric(key: string) {
  const index = METRIC_PRIORITY.indexOf(key);
  return index === -1 ? METRIC_PRIORITY.length : index;
}

function metricLabel(key: string) {
  return key
    .replace(/_monthly$/, "")
    .replace(/_observed$/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
