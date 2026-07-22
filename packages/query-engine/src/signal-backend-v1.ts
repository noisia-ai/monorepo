import { createHash } from "node:crypto";

export const SIGNAL_BACKEND_CONTRACT_VERSION = "signal-backend-v1" as const;
export const SIGNAL_FILTER_HASH_ALGORITHM = "sha256" as const;

export const SIGNAL_GRANULARITIES = ["day", "week", "month"] as const;
export type SignalGranularityV1 = (typeof SIGNAL_GRANULARITIES)[number];

export const SIGNAL_DIMENSIONS = [
  "platform",
  "source_type",
  "entity",
  "product",
  "campaign",
  "topic",
  "taxonomy",
  "signal",
  "signal_lifecycle",
  "audience",
  "demographic",
  "journey_stage",
  "trigger",
  "barrier",
  "sentiment_polarity",
  "emotion",
  "country",
  "language",
  "content_format"
] as const;

export type SignalDimensionV1 = (typeof SIGNAL_DIMENSIONS)[number];
export type SignalDimensionValuesV1 = Partial<Record<SignalDimensionV1, string[]>>;

export type SignalDateRangeV1 = {
  start: string;
  end: string;
};

export type SignalFilterV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  date_range: SignalDateRangeV1;
  timezone: string;
  granularity: SignalGranularityV1;
  dimensions: SignalDimensionValuesV1;
};

export type SignalWorkspaceLocatorV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  organization_id: string;
  workspace_id?: string;
  workspace_slug?: string;
};

export type SignalWorkspaceIdentityV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  workspace_id: string;
  organization_id: string;
  workspace_slug: string;
  subject: {
    type: "brand" | "theme";
    id: string;
  };
  timezone: string;
};

export type DataWatermarkV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  workspace_id: string;
  corpus_id: string;
  corpus_revision: number;
  source_sync_run_ids: string[];
  data_through_at: string | null;
  accepted_at: string;
  materialized_at: string;
};

export type DataFreshnessStateV1 = "fresh" | "stale" | "partial" | "not_available";
export type InterpretationFreshnessStateV1 =
  | "fresh"
  | "stale"
  | "pending"
  | "partial"
  | "not_available";

export type DataFreshnessV1 = {
  state: DataFreshnessStateV1;
  evaluated_at: string;
  stale_after: string | null;
  watermark: DataWatermarkV1 | null;
  reason: string | null;
};

export type InterpretationFreshnessV1 = {
  state: InterpretationFreshnessStateV1;
  evaluated_at: string;
  filters_hash: string;
  data_watermark_hash: string | null;
  interpretation_watermark_hash: string | null;
  reason: string | null;
};

export type SignalMetricQueryV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  workspace: SignalWorkspaceLocatorV1;
  metric_key: string;
  metric_version: number;
  filter: SignalFilterV1;
  filters_hash: string;
  comparison_date_range?: SignalDateRangeV1;
  breakdown_dimension?: SignalDimensionV1;
};

export type SignalMetricValueStateV1 = "available" | "stale" | "partial" | "not_available";

export type SignalMetricPointV1 = {
  period_start: string;
  period_end: string;
  value: number | null;
  denominator: number | null;
  sample_size: number;
  state: SignalMetricValueStateV1;
};

export type SignalTimeSeriesV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  metric_key: string;
  metric_version: number;
  filters_hash: string;
  granularity: SignalGranularityV1;
  watermark: DataWatermarkV1;
  freshness: DataFreshnessV1;
  points: SignalMetricPointV1[];
};

export type SignalBreakdownBucketV1 = {
  key: string;
  label: string;
  value: number | null;
  denominator: number | null;
  sample_size: number;
  state: SignalMetricValueStateV1;
};

export type SignalBreakdownV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  metric_key: string;
  metric_version: number;
  filters_hash: string;
  dimension: SignalDimensionV1;
  watermark: DataWatermarkV1;
  freshness: DataFreshnessV1;
  buckets: SignalBreakdownBucketV1[];
};

export type SignalDrillDownCursorV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  metric_key: string;
  filters_hash: string;
  direction: "next";
  sort: {
    occurred_at: string;
    subject_id: string;
  };
};

export const SIGNAL_BACKEND_ERROR_CODES = [
  "invalid_filter",
  "unsupported_dimension",
  "stale",
  "partial",
  "not_available"
] as const;

export type SignalBackendErrorCodeV1 = (typeof SIGNAL_BACKEND_ERROR_CODES)[number];

export type SignalBackendErrorBodyV1 = {
  contract_version: typeof SIGNAL_BACKEND_CONTRACT_VERSION;
  error: SignalBackendErrorCodeV1;
  message: string;
  details: Record<string, unknown>;
};

export class SignalBackendContractError extends Error {
  readonly code: SignalBackendErrorCodeV1;
  readonly details: Record<string, unknown>;

  constructor(code: SignalBackendErrorCodeV1, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SignalBackendContractError";
    this.code = code;
    this.details = details;
  }

  toJSON(): SignalBackendErrorBodyV1 {
    return {
      contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      error: this.code,
      message: this.message,
      details: this.details
    };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const METRIC_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

const GRANULARITY_ALIASES: Record<string, SignalGranularityV1> = {
  day: "day",
  daily: "day",
  week: "week",
  weekly: "week",
  month: "month",
  monthly: "month"
};

const DIMENSION_ALIASES: Record<string, SignalDimensionV1> = {
  platforms: "platform",
  source: "source_type",
  source_types: "source_type",
  entity_id: "entity",
  entities: "entity",
  products: "product",
  campaigns: "campaign",
  topics: "topic",
  tag: "taxonomy",
  tags: "taxonomy",
  signals: "signal",
  lifecycle: "signal_lifecycle",
  audiences: "audience",
  demographics: "demographic",
  journey: "journey_stage",
  triggers: "trigger",
  barriers: "barrier",
  sentiment: "sentiment_polarity",
  polarity: "sentiment_polarity",
  emotions: "emotion",
  countries: "country",
  languages: "language",
  content_type: "content_format",
  format: "content_format"
};

const SIGNAL_DIMENSION_SET = new Set<string>(SIGNAL_DIMENSIONS);
const SIGNAL_ERROR_CODE_SET = new Set<string>(SIGNAL_BACKEND_ERROR_CODES);
const METRIC_VALUE_STATE_SET = new Set<string>(["available", "stale", "partial", "not_available"]);
const DATA_FRESHNESS_STATE_SET = new Set<string>(["fresh", "stale", "partial", "not_available"]);
const INTERPRETATION_FRESHNESS_STATE_SET = new Set<string>([
  "fresh",
  "stale",
  "pending",
  "partial",
  "not_available"
]);

export function normalizeSignalWorkspaceLocatorV1(input: unknown): SignalWorkspaceLocatorV1 {
  const value = objectValue(input, "workspace locator");
  assertContractVersionIfPresent(value);
  const organizationId = uuidValue(value.organization_id ?? value.organizationId, "organization_id");
  const workspaceId = optionalUuidValue(value.workspace_id ?? value.workspaceId, "workspace_id");
  const workspaceSlug = optionalSlugValue(value.workspace_slug ?? value.workspaceSlug, "workspace_slug");

  if (Number(Boolean(workspaceId)) + Number(Boolean(workspaceSlug)) !== 1) {
    throw invalidFilter("Workspace locator requires exactly one of workspace_id or workspace_slug.", {
      field: "workspace"
    });
  }

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    organization_id: organizationId,
    ...(workspaceId ? { workspace_id: workspaceId } : { workspace_slug: workspaceSlug as string })
  };
}

export function validateSignalWorkspaceIdentityV1(input: unknown): SignalWorkspaceIdentityV1 {
  const value = objectValue(input, "workspace identity");
  assertContractVersionIfPresent(value);
  const subject = objectValue(value.subject, "workspace subject");
  const subjectType = stringValue(subject.type, "subject.type").toLowerCase();
  if (subjectType !== "brand" && subjectType !== "theme") {
    throw invalidFilter("subject.type must be brand or theme.", { field: "subject.type" });
  }

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace_id: uuidValue(value.workspace_id, "workspace_id"),
    organization_id: uuidValue(value.organization_id, "organization_id"),
    workspace_slug: slugValue(value.workspace_slug, "workspace_slug"),
    subject: {
      type: subjectType,
      id: uuidValue(subject.id, "subject.id")
    },
    timezone: canonicalizeSignalTimezone(value.timezone)
  };
}

export function normalizeSignalFilterV1(input: unknown): SignalFilterV1 {
  const value = objectValue(input, "Signal filter");
  assertContractVersionIfPresent(value);
  const rawDateRange = value.date_range ?? value.dateRange;
  const dateRangeValue = objectValue(rawDateRange, "date_range");
  const dateRange = normalizeSignalDateRangeV1(dateRangeValue);
  const timezone = canonicalizeSignalTimezone(value.timezone ?? value.tz ?? "UTC");
  const granularity = normalizeGranularity(value.granularity ?? value.grain ?? "day");
  const dimensions = normalizeDimensions(value.dimensions ?? value.dimension_values ?? {});

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    date_range: dateRange,
    timezone,
    granularity,
    dimensions
  };
}

export function parseSignalFilterQueryParamsV1(
  input: string | URLSearchParams | Record<string, string | string[] | null | undefined>
): SignalFilterV1 {
  const params = toSearchParams(input);
  const start = firstParam(params, ["start", "from", "date_from", "dateRange.start", "date_range.start"]);
  const end = firstParam(params, ["end", "to", "date_to", "dateRange.end", "date_range.end"]);
  const timezone = firstParam(params, ["timezone", "tz"]);
  const granularity = firstParam(params, ["granularity", "grain"]);
  const controlKeys = new Set([
    "start", "from", "date_from", "dateRange.start", "date_range.start",
    "end", "to", "date_to", "dateRange.end", "date_range.end",
    "timezone", "tz", "granularity", "grain", "contract_version"
  ]);
  const dimensions: Record<string, string[]> = {};

  for (const [rawKey, rawValue] of params.entries()) {
    if (controlKeys.has(rawKey)) continue;
    const dimensionKey = rawKey.startsWith("dimension.")
      ? rawKey.slice("dimension.".length)
      : rawKey.startsWith("dimensions.")
        ? rawKey.slice("dimensions.".length)
        : rawKey;
    const canonicalDimension = canonicalSignalDimension(dimensionKey);
    dimensions[canonicalDimension] ??= [];
    dimensions[canonicalDimension]?.push(...rawValue.split(","));
  }

  return normalizeSignalFilterV1({
    date_range: { start, end },
    timezone,
    granularity,
    dimensions
  });
}

export function canonicalSignalDimension(input: unknown): SignalDimensionV1 {
  const normalized = normalizeKey(stringValue(input, "dimension"));
  const canonical = DIMENSION_ALIASES[normalized] ?? normalized;
  if (!SIGNAL_DIMENSION_SET.has(canonical)) {
    throw new SignalBackendContractError(
      "unsupported_dimension",
      `Unsupported Signal dimension: ${normalized}.`,
      { dimension: normalized, supported_dimensions: SIGNAL_DIMENSIONS }
    );
  }
  return canonical as SignalDimensionV1;
}

export function canonicalizeSignalTimezone(input: unknown): string {
  const timezone = stringValue(input, "timezone");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw invalidFilter(`Invalid IANA timezone: ${timezone}.`, { field: "timezone", value: timezone });
  }
}

export function canonicalSignalFilterJsonV1(filterInput: unknown): string {
  const filter = normalizeSignalFilterV1(filterInput);
  const dimensionEntries = SIGNAL_DIMENSIONS.flatMap((dimension) => {
    const values = filter.dimensions[dimension];
    return values && values.length > 0 ? [[dimension, values] as const] : [];
  });

  return JSON.stringify({
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    date_range: { start: filter.date_range.start, end: filter.date_range.end },
    timezone: filter.timezone,
    granularity: filter.granularity,
    dimensions: dimensionEntries
  });
}

export function signalFiltersHashV1(filterInput: unknown): string {
  return sha256(canonicalSignalFilterJsonV1(filterInput));
}

export function canonicalSignalFilterQueryV1(filterInput: unknown): string {
  const filter = normalizeSignalFilterV1(filterInput);
  const params = new URLSearchParams();
  params.append("start", filter.date_range.start);
  params.append("end", filter.date_range.end);
  params.append("timezone", filter.timezone);
  params.append("granularity", filter.granularity);
  for (const dimension of SIGNAL_DIMENSIONS) {
    for (const value of filter.dimensions[dimension] ?? []) {
      params.append(`dimension.${dimension}`, value);
    }
  }
  return params.toString();
}

export function validateDataWatermarkV1(input: unknown): DataWatermarkV1 {
  const value = objectValue(input, "data watermark");
  assertContractVersionIfPresent(value);
  const sourceSyncRunIds = sortedUniqueStrings(value.source_sync_run_ids, {
    field: "source_sync_run_ids",
    normalize: (item) => uuidValue(item, "source_sync_run_ids[]")
  });
  const acceptedAt = isoInstantValue(value.accepted_at, "accepted_at");
  const materializedAt = isoInstantValue(value.materialized_at, "materialized_at");
  const dataThroughAt = nullableIsoInstantValue(value.data_through_at, "data_through_at");

  if (Date.parse(materializedAt) < Date.parse(acceptedAt)) {
    throw invalidFilter("materialized_at cannot be earlier than accepted_at.", {
      field: "materialized_at"
    });
  }
  if (dataThroughAt && Date.parse(dataThroughAt) > Date.parse(acceptedAt)) {
    throw invalidFilter("data_through_at cannot be later than accepted_at.", {
      field: "data_through_at"
    });
  }

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace_id: uuidValue(value.workspace_id, "workspace_id"),
    corpus_id: uuidValue(value.corpus_id, "corpus_id"),
    corpus_revision: nonNegativeInteger(value.corpus_revision, "corpus_revision"),
    source_sync_run_ids: sourceSyncRunIds,
    data_through_at: dataThroughAt,
    accepted_at: acceptedAt,
    materialized_at: materializedAt
  };
}

export function dataWatermarkHashV1(input: unknown): string {
  return sha256(JSON.stringify(validateDataWatermarkV1(input)));
}

export function validateDataFreshnessV1(input: unknown): DataFreshnessV1 {
  const value = objectValue(input, "data freshness");
  assertContractVersionIfPresent(value);
  const state = enumValue(value.state, DATA_FRESHNESS_STATE_SET, "data freshness state") as DataFreshnessStateV1;
  const watermark = value.watermark == null ? null : validateDataWatermarkV1(value.watermark);
  const reason = nullableTextValue(value.reason, "reason");
  if (state === "not_available" && watermark !== null) {
    throw invalidFilter("not_available data freshness cannot include a watermark.", { field: "watermark" });
  }
  if (state !== "not_available" && watermark === null) {
    throw invalidFilter(`${state} data freshness requires a watermark.`, { field: "watermark" });
  }
  if ((state === "stale" || state === "partial") && !reason) {
    throw invalidFilter(`${state} data freshness requires a reason.`, { field: "reason" });
  }

  return {
    state,
    evaluated_at: isoInstantValue(value.evaluated_at, "evaluated_at"),
    stale_after: nullableIsoInstantValue(value.stale_after, "stale_after"),
    watermark,
    reason
  };
}

export function validateInterpretationFreshnessV1(input: unknown): InterpretationFreshnessV1 {
  const value = objectValue(input, "interpretation freshness");
  assertContractVersionIfPresent(value);
  const state = enumValue(
    value.state,
    INTERPRETATION_FRESHNESS_STATE_SET,
    "interpretation freshness state"
  ) as InterpretationFreshnessStateV1;
  const reason = nullableTextValue(value.reason, "reason");
  if ((state === "stale" || state === "partial" || state === "not_available") && !reason) {
    throw invalidFilter(`${state} interpretation freshness requires a reason.`, { field: "reason" });
  }

  return {
    state,
    evaluated_at: isoInstantValue(value.evaluated_at, "evaluated_at"),
    filters_hash: hashValue(value.filters_hash, "filters_hash"),
    data_watermark_hash: nullableHashValue(value.data_watermark_hash, "data_watermark_hash"),
    interpretation_watermark_hash: nullableHashValue(
      value.interpretation_watermark_hash,
      "interpretation_watermark_hash"
    ),
    reason
  };
}

export function normalizeSignalMetricQueryV1(input: unknown): SignalMetricQueryV1 {
  const value = objectValue(input, "metric query");
  assertContractVersionIfPresent(value);
  const filter = normalizeSignalFilterV1(value.filter);
  const filtersHash = signalFiltersHashV1(filter);
  if (value.filters_hash !== undefined && hashValue(value.filters_hash, "filters_hash") !== filtersHash) {
    throw invalidFilter("filters_hash does not match the canonical filter.", {
      field: "filters_hash",
      expected: filtersHash
    });
  }
  const comparisonDateRange = value.comparison_date_range == null
    ? undefined
    : normalizeSignalDateRangeV1(objectValue(value.comparison_date_range, "comparison_date_range"));
  if (comparisonDateRange) validateCompatibleComparison(filter.date_range, comparisonDateRange);

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    workspace: normalizeSignalWorkspaceLocatorV1(value.workspace),
    metric_key: metricKeyValue(value.metric_key),
    metric_version: positiveInteger(value.metric_version ?? 1, "metric_version"),
    filter,
    filters_hash: filtersHash,
    ...(comparisonDateRange ? { comparison_date_range: comparisonDateRange } : {}),
    ...(value.breakdown_dimension == null
      ? {}
      : { breakdown_dimension: canonicalSignalDimension(value.breakdown_dimension) })
  };
}

export function validateSignalTimeSeriesV1(input: unknown): SignalTimeSeriesV1 {
  const value = objectValue(input, "time series");
  assertContractVersionIfPresent(value);
  const points = arrayValue(value.points, "points").map(validateMetricPoint);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous && current && previous.period_start >= current.period_start) {
      throw invalidFilter("Time-series points must be strictly ordered by period_start.", { field: "points" });
    }
    if (previous && current && previous.period_end >= current.period_start) {
      throw invalidFilter("Time-series periods cannot overlap.", { field: "points" });
    }
  }

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: metricKeyValue(value.metric_key),
    metric_version: positiveInteger(value.metric_version, "metric_version"),
    filters_hash: hashValue(value.filters_hash, "filters_hash"),
    granularity: normalizeGranularity(value.granularity),
    watermark: validateDataWatermarkV1(value.watermark),
    freshness: validateDataFreshnessV1(value.freshness),
    points
  };
}

export function validateSignalBreakdownV1(input: unknown): SignalBreakdownV1 {
  const value = objectValue(input, "breakdown");
  assertContractVersionIfPresent(value);
  const seen = new Set<string>();
  const buckets = arrayValue(value.buckets, "buckets").map((item) => {
    const bucket = objectValue(item, "breakdown bucket");
    const key = normalizedDimensionValue(bucket.key, "bucket.key");
    if (seen.has(key)) throw invalidFilter(`Duplicate breakdown bucket: ${key}.`, { field: "buckets" });
    seen.add(key);
    const normalizedBucket = {
      key,
      label: stringValue(bucket.label, "bucket.label").normalize("NFC").trim(),
      value: nullableFiniteNumber(bucket.value, "bucket.value"),
      denominator: nullableNonNegativeNumber(bucket.denominator, "bucket.denominator"),
      sample_size: nonNegativeInteger(bucket.sample_size, "bucket.sample_size"),
      state: metricValueState(bucket.state)
    } satisfies SignalBreakdownBucketV1;
    validateMetricValueSemantics(normalizedBucket.value, normalizedBucket.state, "bucket.value");
    return normalizedBucket;
  });

  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: metricKeyValue(value.metric_key),
    metric_version: positiveInteger(value.metric_version, "metric_version"),
    filters_hash: hashValue(value.filters_hash, "filters_hash"),
    dimension: canonicalSignalDimension(value.dimension),
    watermark: validateDataWatermarkV1(value.watermark),
    freshness: validateDataFreshnessV1(value.freshness),
    buckets
  };
}

export function encodeSignalDrillDownCursorV1(input: unknown): string {
  const cursor = validateSignalDrillDownCursorV1(input);
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSignalDrillDownCursorV1(input: unknown): SignalDrillDownCursorV1 {
  const encoded = stringValue(input, "cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw invalidFilter("Drill-down cursor is not valid base64url JSON.", { field: "cursor" });
  }
  return validateSignalDrillDownCursorV1(parsed);
}

export function validateSignalDrillDownCursorV1(input: unknown): SignalDrillDownCursorV1 {
  const value = objectValue(input, "drill-down cursor");
  const sort = objectValue(value.sort, "drill-down cursor sort");
  if (value.contract_version !== SIGNAL_BACKEND_CONTRACT_VERSION) {
    throw invalidFilter("Drill-down cursor contract version is unsupported.", {
      field: "contract_version"
    });
  }
  if (value.direction !== "next") {
    throw invalidFilter("Drill-down cursor direction must be next.", { field: "direction" });
  }
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    metric_key: metricKeyValue(value.metric_key),
    filters_hash: hashValue(value.filters_hash, "filters_hash"),
    direction: "next",
    sort: {
      occurred_at: isoInstantValue(sort.occurred_at, "sort.occurred_at"),
      subject_id: uuidValue(sort.subject_id, "sort.subject_id")
    }
  };
}

export function validateSignalBackendErrorV1(input: unknown): SignalBackendErrorBodyV1 {
  const value = objectValue(input, "Signal backend error");
  assertContractVersionIfPresent(value);
  const code = enumValue(value.error, SIGNAL_ERROR_CODE_SET, "Signal backend error code") as SignalBackendErrorCodeV1;
  return {
    contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
    error: code,
    message: stringValue(value.message, "message"),
    details: value.details == null ? {} : objectValue(value.details, "details")
  };
}

function normalizeSignalDateRangeV1(value: Record<string, unknown>): SignalDateRangeV1 {
  const start = isoDateValue(value.start ?? value.from, "date_range.start");
  const end = isoDateValue(value.end ?? value.to, "date_range.end");
  if (start > end) {
    throw invalidFilter("date_range.start cannot be later than date_range.end.", {
      field: "date_range"
    });
  }
  return { start, end };
}

function normalizeDimensions(input: unknown): SignalDimensionValuesV1 {
  const dimensions = objectValue(input, "dimensions");
  const grouped = new Map<SignalDimensionV1, string[]>();
  for (const [rawDimension, rawValues] of Object.entries(dimensions)) {
    const dimension = canonicalSignalDimension(rawDimension);
    const existing = grouped.get(dimension) ?? [];
    existing.push(...rawDimensionValues(rawValues));
    grouped.set(dimension, existing);
  }

  const normalized: SignalDimensionValuesV1 = {};
  for (const dimension of SIGNAL_DIMENSIONS) {
    const values = grouped.get(dimension);
    if (!values) continue;
    const canonicalValues = Array.from(
      new Set(values.map((value) => normalizedDimensionValue(value, dimension)).filter(Boolean))
    ).sort(compareUtf8);
    if (canonicalValues.length > 0) normalized[dimension] = canonicalValues;
  }
  return normalized;
}

function rawDimensionValues(input: unknown): string[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input.flatMap(rawDimensionValues);
  if (typeof input === "string") return input.split(",");
  throw invalidFilter("Dimension values must be strings, arrays of strings, or null.", {
    field: "dimensions"
  });
}

function normalizedDimensionValue(input: unknown, field: string): string {
  if (typeof input !== "string") {
    throw invalidFilter(`${field} must be a string.`, { field });
  }
  return input
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function normalizeGranularity(input: unknown): SignalGranularityV1 {
  const raw = normalizeKey(stringValue(input, "granularity"));
  const granularity = GRANULARITY_ALIASES[raw];
  if (!granularity) {
    throw invalidFilter(`Unsupported granularity: ${raw}.`, {
      field: "granularity",
      supported_granularities: SIGNAL_GRANULARITIES
    });
  }
  return granularity;
}

function validateCompatibleComparison(primary: SignalDateRangeV1, comparison: SignalDateRangeV1): void {
  const primaryStart = Date.parse(`${primary.start}T00:00:00.000Z`);
  const primaryEnd = Date.parse(`${primary.end}T00:00:00.000Z`);
  const comparisonStart = Date.parse(`${comparison.start}T00:00:00.000Z`);
  const comparisonEnd = Date.parse(`${comparison.end}T00:00:00.000Z`);
  const overlaps = primaryStart <= comparisonEnd && comparisonStart <= primaryEnd;
  if (overlaps) {
    throw invalidFilter("comparison_date_range cannot overlap date_range.", {
      field: "comparison_date_range"
    });
  }
  if (primaryEnd - primaryStart !== comparisonEnd - comparisonStart) {
    throw invalidFilter("comparison_date_range must contain the same number of calendar days as date_range.", {
      field: "comparison_date_range"
    });
  }
}

function validateMetricPoint(input: unknown): SignalMetricPointV1 {
  const value = objectValue(input, "time-series point");
  const periodStart = isoDateValue(value.period_start, "point.period_start");
  const periodEnd = isoDateValue(value.period_end, "point.period_end");
  if (periodStart > periodEnd) {
    throw invalidFilter("point.period_start cannot be later than point.period_end.", {
      field: "points"
    });
  }
  const point = {
    period_start: periodStart,
    period_end: periodEnd,
    value: nullableFiniteNumber(value.value, "point.value"),
    denominator: nullableNonNegativeNumber(value.denominator, "point.denominator"),
    sample_size: nonNegativeInteger(value.sample_size, "point.sample_size"),
    state: metricValueState(value.state)
  } satisfies SignalMetricPointV1;
  validateMetricValueSemantics(point.value, point.state, "point.value");
  return point;
}

function validateMetricValueSemantics(
  value: number | null,
  state: SignalMetricValueStateV1,
  field: string
): void {
  if (state === "available" && value === null) {
    throw invalidFilter(`${field} cannot be null when state is available.`, { field });
  }
  if (state === "not_available" && value !== null) {
    throw invalidFilter(`${field} must be null when state is not_available.`, { field });
  }
}

function metricValueState(input: unknown): SignalMetricValueStateV1 {
  return enumValue(input, METRIC_VALUE_STATE_SET, "metric value state") as SignalMetricValueStateV1;
}

function toSearchParams(
  input: string | URLSearchParams | Record<string, string | string[] | null | undefined>
): URLSearchParams {
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(input)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) if (value != null) params.append(key, value);
  }
  return params;
}

function firstParam(params: URLSearchParams, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const value = params.get(alias);
    if (value != null) return value;
  }
  return undefined;
}

function objectValue(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidFilter(`${field} must be an object.`, { field });
  }
  return input as Record<string, unknown>;
}

function assertContractVersionIfPresent(value: Record<string, unknown>): void {
  if (
    value.contract_version !== undefined
    && value.contract_version !== SIGNAL_BACKEND_CONTRACT_VERSION
  ) {
    throw invalidFilter("Unsupported Signal backend contract version.", {
      field: "contract_version",
      supported_version: SIGNAL_BACKEND_CONTRACT_VERSION
    });
  }
}

function arrayValue(input: unknown, field: string): unknown[] {
  if (!Array.isArray(input)) throw invalidFilter(`${field} must be an array.`, { field });
  return input;
}

function stringValue(input: unknown, field: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw invalidFilter(`${field} must be a non-empty string.`, { field });
  }
  return input.trim();
}

function nullableTextValue(input: unknown, field: string): string | null {
  if (input == null || input === "") return null;
  return stringValue(input, field).normalize("NFC").trim();
}

function uuidValue(input: unknown, field: string): string {
  const value = stringValue(input, field).toLowerCase();
  if (!UUID_PATTERN.test(value)) throw invalidFilter(`${field} must be a UUID.`, { field });
  return value;
}

function optionalUuidValue(input: unknown, field: string): string | undefined {
  return input == null || input === "" ? undefined : uuidValue(input, field);
}

function slugValue(input: unknown, field: string): string {
  const value = stringValue(input, field).normalize("NFC").trim().toLowerCase();
  if (!SLUG_PATTERN.test(value)) throw invalidFilter(`${field} must be a canonical slug.`, { field });
  return value;
}

function optionalSlugValue(input: unknown, field: string): string | undefined {
  return input == null || input === "" ? undefined : slugValue(input, field);
}

function isoDateValue(input: unknown, field: string): string {
  const value = stringValue(input, field);
  const match = DATE_PATTERN.exec(value);
  if (!match) throw invalidFilter(`${field} must use YYYY-MM-DD.`, { field });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw invalidFilter(`${field} is not a valid calendar date.`, { field });
  }
  return value;
}

function isoInstantValue(input: unknown, field: string): string {
  const value = stringValue(input, field);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || !/[zZ]|[+-]\d{2}:\d{2}$/u.test(value)) {
    throw invalidFilter(`${field} must be an ISO-8601 instant with an explicit offset.`, { field });
  }
  return new Date(timestamp).toISOString();
}

function nullableIsoInstantValue(input: unknown, field: string): string | null {
  return input == null || input === "" ? null : isoInstantValue(input, field);
}

function metricKeyValue(input: unknown): string {
  const value = normalizeKey(stringValue(input, "metric_key"));
  if (!METRIC_KEY_PATTERN.test(value)) {
    throw invalidFilter("metric_key has an invalid format.", { field: "metric_key" });
  }
  return value;
}

function hashValue(input: unknown, field: string): string {
  const value = stringValue(input, field).toLowerCase();
  if (!HASH_PATTERN.test(value)) throw invalidFilter(`${field} must be a sha256 hash.`, { field });
  return value;
}

function nullableHashValue(input: unknown, field: string): string | null {
  return input == null || input === "" ? null : hashValue(input, field);
}

function nonNegativeInteger(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    throw invalidFilter(`${field} must be a non-negative integer.`, { field });
  }
  return input;
}

function positiveInteger(input: unknown, field: string): number {
  const value = nonNegativeInteger(input, field);
  if (value === 0) throw invalidFilter(`${field} must be greater than zero.`, { field });
  return value;
}

function nullableFiniteNumber(input: unknown, field: string): number | null {
  if (input == null) return null;
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw invalidFilter(`${field} must be a finite number or null.`, { field });
  }
  return input;
}

function nullableNonNegativeNumber(input: unknown, field: string): number | null {
  const value = nullableFiniteNumber(input, field);
  if (value !== null && value < 0) throw invalidFilter(`${field} cannot be negative.`, { field });
  return value;
}

function sortedUniqueStrings(
  input: unknown,
  options: { field: string; normalize: (item: unknown) => string }
): string[] {
  if (!Array.isArray(input)) throw invalidFilter(`${options.field} must be an array.`, { field: options.field });
  return Array.from(new Set(input.map(options.normalize))).sort(compareUtf8);
}

function enumValue(input: unknown, allowed: Set<string>, field: string): string {
  const value = normalizeKey(stringValue(input, field));
  if (!allowed.has(value)) throw invalidFilter(`Unsupported ${field}: ${value}.`, { field, value });
  return value;
}

function normalizeKey(input: string): string {
  return input.normalize("NFC").trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value: string): string {
  return `${SIGNAL_FILTER_HASH_ALGORITHM}:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function invalidFilter(message: string, details: Record<string, unknown>): SignalBackendContractError {
  return new SignalBackendContractError("invalid_filter", message, details);
}
