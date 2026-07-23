import { createHash } from "node:crypto";

export const SIGNAL_REFRESH_CONTRACT_VERSION = "signal-refresh-v1" as const;
export const SIGNAL_REFRESH_TICK_JOB_NAME = "signal_refresh_tick" as const;
export const SIGNAL_REFRESH_RUN_JOB_NAME = "signal_refresh_run" as const;
export const SIGNAL_INVALIDATION_JOB_NAME = "signal_data_invalidation" as const;

export const SIGNAL_REFRESH_CADENCES = ["manual", "hourly", "daily", "weekly", "monthly"] as const;
export type SignalRefreshCadenceV1 = (typeof SIGNAL_REFRESH_CADENCES)[number];

export const SIGNAL_REFRESH_TOLERANCE_MS_V1: Record<SignalRefreshCadenceV1, number | null> = {
  manual: null,
  hourly: 15 * 60 * 1_000,
  daily: 6 * 60 * 60 * 1_000,
  weekly: 24 * 60 * 60 * 1_000,
  monthly: 72 * 60 * 60 * 1_000
};

export type SignalRefreshTickJobDataV1 = {
  contract_version: typeof SIGNAL_REFRESH_CONTRACT_VERSION;
};

export type SignalRefreshRunJobDataV1 = {
  contract_version: typeof SIGNAL_REFRESH_CONTRACT_VERSION;
  refresh_policy_id: string;
  workspace_id: string;
  source_key: string;
  scheduled_for: string;
  idempotency_key: string;
};

export type SignalInvalidationJobDataV1 = {
  contract_version: typeof SIGNAL_REFRESH_CONTRACT_VERSION;
  invalidation_id: string;
};

export function buildSignalRefreshRunIdempotencyKeyV1(input: {
  refresh_policy_id: string;
  scheduled_for: string | Date;
}) {
  const scheduledFor = new Date(input.scheduled_for);
  if (Number.isNaN(scheduledFor.getTime())) throw new Error("scheduled_for must be a valid instant.");
  const canonical = JSON.stringify({
    contract_version: SIGNAL_REFRESH_CONTRACT_VERSION,
    refresh_policy_id: input.refresh_policy_id.trim().toLowerCase(),
    scheduled_for: scheduledFor.toISOString()
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function deriveSignalStaleAfterV1(input: {
  cadence: SignalRefreshCadenceV1;
  timezone: string;
  expected_next_run: string | Date | null;
}) {
  assertSignalRefreshCadence(input.cadence);
  assertIanaTimezone(input.timezone);
  const tolerance = SIGNAL_REFRESH_TOLERANCE_MS_V1[input.cadence];
  if (tolerance == null) return null;
  if (input.expected_next_run == null) {
    throw new Error(`${input.cadence} refresh requires expected_next_run.`);
  }
  const expectedNextRun = new Date(input.expected_next_run);
  if (Number.isNaN(expectedNextRun.getTime())) throw new Error("expected_next_run must be a valid instant.");
  return new Date(expectedNextRun.getTime() + tolerance);
}

export function evaluateSignalFreshnessV1(input: {
  stale_after: string | Date | null;
  accepted_at: string | Date;
  materialized_at: string | Date | null;
  max_observed_at: string | Date | null;
  now?: string | Date;
}) {
  const now = requiredInstant(input.now ?? new Date(), "now");
  const acceptedAt = requiredInstant(input.accepted_at, "accepted_at");
  const materializedAt = input.materialized_at == null
    ? null
    : requiredInstant(input.materialized_at, "materialized_at");
  const staleAfter = input.stale_after == null
    ? null
    : requiredInstant(input.stale_after, "stale_after");
  const source = staleAfter && staleAfter <= now ? "stale" : "fresh";
  const data = input.max_observed_at == null ? "partial" : source;
  const materialization = materializedAt == null
    ? "not_available"
    : materializedAt < acceptedAt
      ? "stale"
      : data;
  return {
    source_freshness: source,
    data_freshness: data,
    materialization_freshness: materialization
  } as const;
}

export function expandSignalVelocityInvalidationThroughV1(value: string | Date | null) {
  if (value == null) return null;
  const instant = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : requiredInstant(value, "affected_through");
  if (Number.isNaN(instant.getTime())) throw new Error("affected_through must be a valid date.");
  const expanded = new Date(Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth() + 2,
    0
  ));
  return expanded.toISOString().slice(0, 10);
}

function assertSignalRefreshCadence(value: string): asserts value is SignalRefreshCadenceV1 {
  if (!(SIGNAL_REFRESH_CADENCES as readonly string[]).includes(value)) {
    throw new Error(`Unsupported Signal refresh cadence: ${value}`);
  }
}

function assertIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error(`Invalid Signal refresh timezone: ${value}`);
  }
}

function requiredInstant(value: string | Date, field: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`${field} must be a valid instant.`);
  return instant;
}
