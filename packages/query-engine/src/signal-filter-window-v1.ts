import {
  canonicalSignalFilterQueryV1,
  normalizeSignalFilterV1,
  parseSignalFilterQueryParamsV1,
  type SignalDateRangeV1,
  type SignalFilterV1
} from "./signal-backend-v1";

export const SIGNAL_COMPARISON_MODES_V1 = [
  "none",
  "previous_period",
  "previous_year",
  "previous_year_same_weekday",
  "custom"
] as const;

export type SignalComparisonModeV1 = (typeof SIGNAL_COMPARISON_MODES_V1)[number];

export type SignalComparisonV1 = {
  mode: SignalComparisonModeV1;
  date_range: SignalDateRangeV1 | null;
};

export type SignalAnalyticsQueryV1 = {
  filter: SignalFilterV1;
  comparison: SignalComparisonV1;
};

export function resolveSignalComparisonV1(args: {
  filter: SignalFilterV1;
  mode?: unknown;
  custom_date_range?: unknown;
}): SignalComparisonV1 {
  const mode = normalizeComparisonMode(args.mode ?? "previous_period");
  if (mode === "none") return { mode, date_range: null };

  const primary = args.filter.date_range;
  let dateRange: SignalDateRangeV1;
  if (mode === "previous_period") {
    const duration = inclusiveDays(primary);
    const end = addDays(primary.start, -1);
    dateRange = { start: addDays(end, -(duration - 1)), end };
  } else if (mode === "previous_year") {
    const start = shiftCalendarYear(primary.start, -1);
    dateRange = {
      start,
      end: addDays(start, inclusiveDays(primary) - 1)
    };
  } else if (mode === "previous_year_same_weekday") {
    dateRange = {
      start: addDays(primary.start, -364),
      end: addDays(primary.end, -364)
    };
  } else {
    dateRange = normalizeDateRange(args.custom_date_range);
  }

  assertComparisonCompatible(primary, dateRange);
  return { mode, date_range: dateRange };
}

export function parseSignalAnalyticsQueryParamsV1(
  input: string | URLSearchParams | Record<string, string | string[] | null | undefined>
): SignalAnalyticsQueryV1 {
  const params = toSearchParams(input);
  const filterParams = new URLSearchParams(params);
  for (const key of [
    "compare",
    "comparison",
    "comparison_mode",
    "compareStart",
    "compareEnd",
    "comparison_start",
    "comparison_end",
    "view"
  ]) {
    filterParams.delete(key);
  }
  const filter = parseSignalFilterQueryParamsV1(filterParams);
  const mode = firstParam(params, ["compare", "comparison", "comparison_mode"]);
  const customStart = firstParam(params, ["compareStart", "comparison_start"]);
  const customEnd = firstParam(params, ["compareEnd", "comparison_end"]);
  return {
    filter,
    comparison: resolveSignalComparisonV1({
      filter,
      mode,
      ...(customStart || customEnd
        ? { custom_date_range: { start: customStart, end: customEnd } }
        : {})
    })
  };
}

export function canonicalSignalAnalyticsQueryV1(input: SignalAnalyticsQueryV1): string {
  const params = new URLSearchParams(canonicalSignalFilterQueryV1(input.filter));
  params.set("compare", input.comparison.mode);
  if (input.comparison.mode === "custom" && input.comparison.date_range) {
    params.set("compareStart", input.comparison.date_range.start);
    params.set("compareEnd", input.comparison.date_range.end);
  }
  return params.toString();
}

function normalizeComparisonMode(input: unknown): SignalComparisonModeV1 {
  if (typeof input !== "string") throw new Error("comparison mode must be a string.");
  const normalized = input.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (SIGNAL_COMPARISON_MODES_V1.includes(normalized as SignalComparisonModeV1)) {
    return normalized as SignalComparisonModeV1;
  }
  throw new Error(`Unsupported Signal comparison mode: ${normalized}.`);
}

function normalizeDateRange(input: unknown): SignalDateRangeV1 {
  return normalizeSignalFilterV1({
    date_range: input,
    timezone: "UTC",
    granularity: "day",
    dimensions: {}
  }).date_range;
}

function assertComparisonCompatible(primary: SignalDateRangeV1, comparison: SignalDateRangeV1) {
  const primaryStart = epochDay(primary.start);
  const primaryEnd = epochDay(primary.end);
  const comparisonStart = epochDay(comparison.start);
  const comparisonEnd = epochDay(comparison.end);
  if (primaryStart <= comparisonEnd && comparisonStart <= primaryEnd) {
    throw new Error("comparison date range cannot overlap the primary date range.");
  }
  if (primaryEnd - primaryStart !== comparisonEnd - comparisonStart) {
    throw new Error("comparison date range must contain the same number of calendar days.");
  }
}

function inclusiveDays(range: SignalDateRangeV1) {
  return Math.round((epochDay(range.end) - epochDay(range.start)) / 86_400_000) + 1;
}

function addDays(value: string, amount: number) {
  return new Date(epochDay(value) + amount * 86_400_000).toISOString().slice(0, 10);
}

function shiftCalendarYear(value: string, amount: number) {
  const date = new Date(epochDay(value));
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(date.getUTCFullYear() + amount, month, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), month + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

function epochDay(value: string) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function firstParam(params: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = params.get(key);
    if (value != null && value.trim()) return value;
  }
  return undefined;
}

function toSearchParams(
  input: string | URLSearchParams | Record<string, string | string[] | null | undefined>
) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value != null) {
      params.append(key, value);
    }
  }
  return params;
}
