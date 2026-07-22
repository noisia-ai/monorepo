import { createHash } from "node:crypto";

export const SIGNAL_REFRESH_CONTRACT_VERSION = "signal-refresh-v1" as const;
export const SIGNAL_REFRESH_TICK_JOB_NAME = "signal_refresh_tick" as const;
export const SIGNAL_REFRESH_RUN_JOB_NAME = "signal_refresh_run" as const;
export const SIGNAL_INVALIDATION_JOB_NAME = "signal_data_invalidation" as const;

export const SIGNAL_REFRESH_CADENCES = ["manual", "hourly", "daily", "weekly", "monthly"] as const;
export type SignalRefreshCadenceV1 = (typeof SIGNAL_REFRESH_CADENCES)[number];

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

