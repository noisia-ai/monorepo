import type { JobsOptions } from "bullmq";

export function isSignalRefreshSchedulerEnabled(
  env: Record<string, string | undefined> = process.env
) {
  return env.NOISIA_DATA_OS_WORKER_ENABLED === "true"
    && env.NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED === "true";
}

export function buildSignalRefreshTickOptions(): JobsOptions {
  return {
    jobId: "signal-refresh-tick-v1",
    repeat: { every: 60_000 },
    attempts: 1,
    removeOnComplete: { age: 60 * 60, count: 10 },
    removeOnFail: { age: 60 * 60 * 24 * 7, count: 100 }
  };
}

export function buildSignalRefreshRunOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 2_000 },
    removeOnFail: { age: 60 * 60 * 24 * 14, count: 2_000 }
  };
}

