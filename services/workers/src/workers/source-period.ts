import {
  canonicalSourceMetricKey,
  type SourceObservation,
  type SourceRecord
} from "@noisia/query-engine";

export type SourcePeriodInput = {
  title: string;
  original_file_name: string | null;
  source_period_start: string | null;
  source_period_end: string | null;
  created_at: string | null;
};

export type InferredSourcePeriod = {
  start: string;
  end: string;
  grain: "day" | "month";
  inference: "declared_source_period" | "file_name" | "source_created_at_snapshot";
};

export function inferSourceSnapshotPeriod(source: SourcePeriodInput): InferredSourcePeriod | null {
  if (source.source_period_start) {
    const start = validIsoDatePrefix(source.source_period_start);
    const end = validIsoDatePrefix(source.source_period_end ?? source.source_period_start);
    if (start && end) {
      return {
        start,
        end,
        grain: isFullCalendarMonth(start, end) ? "month" : "day",
        inference: "declared_source_period"
      };
    }
  }

  const fileName = source.original_file_name ?? source.title;
  const monthDayYear = fileName.match(/(?:^|[_\-.])(\d{1,2})[_\-.](\d{1,2})[_\-.](20\d{2})(?:[_\-.]|$)/);
  if (monthDayYear) {
    const date = isoDate(Number(monthDayYear[3]), Number(monthDayYear[1]), Number(monthDayYear[2]));
    if (date) return { start: date, end: date, grain: "day", inference: "file_name" };
  }

  const yearMonthDay = fileName.match(/(?:^|[_\-.])(20\d{2})[_\-.](\d{1,2})[_\-.](\d{1,2})(?:[_\-.]|$)/);
  if (yearMonthDay) {
    const date = isoDate(Number(yearMonthDay[1]), Number(yearMonthDay[2]), Number(yearMonthDay[3]));
    if (date) return { start: date, end: date, grain: "day", inference: "file_name" };
  }

  const createdAt = validIsoDatePrefix(source.created_at);
  if (createdAt) {
    return {
      start: createdAt,
      end: createdAt,
      grain: "day",
      inference: "source_created_at_snapshot"
    };
  }

  return null;
}

const CAPTURE_SNAPSHOT_FAMILIES = new Set([
  "price",
  "competitor_price",
  "cost",
  "margin",
  "discount",
  "stock",
  "inventory",
  "followers",
  "search_volume",
  "search_position",
  "share_of_search",
  "share_of_voice"
]);

const CAPTURE_SNAPSHOT_DATASET_ROLES = new Set([
  "product_catalog",
  "search_demand",
  "pricing_inventory",
  "competitive_intelligence",
  "organic_social"
]);

/**
 * Applies source-level time only when its meaning is defensible. A declared coverage
 * period can govern any undated measure; a date inferred from a filename is only a
 * capture date for snapshot-style datasets and must never turn static catalog rows or
 * undated sales into a fake event series.
 */
export function applySourcePeriodInference(
  observation: SourceObservation,
  sourcePeriod: InferredSourcePeriod | null
): SourceObservation {
  if (observation.periodStart || !sourcePeriod || observation.periodSemantics === "static") {
    return observation;
  }

  const canApply = sourcePeriod.inference === "declared_source_period"
    || (
      CAPTURE_SNAPSHOT_FAMILIES.has(observation.metricFamily)
      && CAPTURE_SNAPSHOT_DATASET_ROLES.has(observation.datasetRole ?? "")
    );
  if (!canApply) return observation;

  const periodSemantics = sourcePeriod.inference !== "declared_source_period"
    || CAPTURE_SNAPSHOT_FAMILIES.has(observation.metricFamily)
    ? "snapshot"
    : sourcePeriod.grain === "day" ? "event" : "measurement";
  const qualityIssues = observation.qualityIssues.filter(
    (issue) => !["measurement_period_missing", "snapshot_date_missing"].includes(issue)
  );

  return {
    ...observation,
    periodStart: sourcePeriod.start,
    periodEnd: sourcePeriod.end,
    periodGrain: sourcePeriod.grain,
    periodSemantics,
    metricKey: canonicalSourceMetricKey(observation.metricVariant, sourcePeriod.grain, periodSemantics),
    qualityIssues,
    qualityStatus: statusForIssues(qualityIssues),
    lineage: {
      ...observation.lineage,
      inferred_period_grain: sourcePeriod.grain,
      period_semantics: periodSemantics,
      period_inference: sourcePeriod.inference,
      source_period_start: sourcePeriod.start,
      source_period_end: sourcePeriod.end
    }
  };
}

const FILE_SNAPSHOT_DATASET_ROLES = new Set([
  "search_demand",
  "pricing_inventory",
  "competitive_intelligence",
  "organic_social"
]);

/**
 * Applies a defensible source period to canonical source rows. Filename dates are
 * capture dates only for snapshot-style datasets; they must not turn product master
 * data or undated sales into events. Declared source coverage can govern a temporal
 * dataset when the row itself has no period.
 */
export function applySourceRecordPeriodInference(
  record: SourceRecord,
  sourcePeriod: InferredSourcePeriod | null
): SourceRecord {
  if (record.periodStart || !sourcePeriod || record.periodSemantics === "static") {
    return record;
  }

  const canApply = sourcePeriod.inference === "declared_source_period"
    || FILE_SNAPSHOT_DATASET_ROLES.has(record.datasetRole ?? "");
  if (!canApply) return record;

  const isSnapshot = FILE_SNAPSHOT_DATASET_ROLES.has(record.datasetRole ?? "");
  const periodSemantics = isSnapshot
    ? "snapshot"
    : sourcePeriod.grain === "day" ? "event" : "measurement";
  const qualityIssues = record.qualityIssues.filter(
    (issue) => !["period_unparseable", "period_field_missing"].includes(issue)
  );

  return {
    ...record,
    periodStart: sourcePeriod.start,
    periodEnd: sourcePeriod.end,
    periodGrain: sourcePeriod.grain,
    periodSemantics,
    qualityIssues,
    qualityStatus: recordStatusForIssues(qualityIssues),
    lineage: {
      ...record.lineage,
      inferred_period_grain: sourcePeriod.grain,
      period_semantics: periodSemantics,
      period_inference: sourcePeriod.inference,
      source_period_start: sourcePeriod.start,
      source_period_end: sourcePeriod.end
    }
  };
}

function statusForIssues(issues: string[]): SourceObservation["qualityStatus"] {
  if (issues.some((issue) => ["metric_value_below_minimum", "metric_value_above_maximum", "negative_count", "negative_duration", "non_finite_metric_value"].includes(issue))) {
    return "rejected";
  }
  return issues.length > 0 ? "needs_mapping_review" : "accepted";
}

function recordStatusForIssues(issues: string[]): SourceRecord["qualityStatus"] {
  if (issues.includes("empty_record")) {
    return "rejected";
  }
  return issues.length > 0 ? "needs_mapping_review" : "accepted";
}

function validIsoDatePrefix(value: string | null) {
  const date = value?.slice(0, 10) ?? "";
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null;
  const [yearText, monthText, dayText] = date.split("-");
  if (!yearText || !monthText || !dayText) return null;
  return isoDate(Number(yearText), Number(monthText), Number(dayText));
}

function isFullCalendarMonth(start: string, end: string) {
  const [yearText, monthText, dayText] = start.split("-");
  if (!yearText || !monthText || !dayText) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (day !== 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return end === isoDate(year, month, lastDay);
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date.toISOString().slice(0, 10);
}
