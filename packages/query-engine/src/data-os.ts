export const DATA_OS_QUEUE_NAME = "noisia-data-os";
export const DATA_OS_SHADOW_RUN_JOB_NAME = "data_os_shadow_run";
export const DATA_OS_ALLOWED_REMOTE_TARGETS = ["staging", "throwaway", "preview"] as const;

export type DataOsShadowRunJobData = {
  corpusId: string;
  outputId: string;
  strict?: boolean;
  includeServingSmoke?: boolean;
  includeReviewQueue?: boolean;
  includeEvidence?: boolean;
};

type DataOsEnv = Record<string, string | undefined>;

export function isDataOsRemoteTargetAllowed(env: DataOsEnv = process.env): boolean {
  const target = env.NOISIA_REMOTE_DATABASE_TARGET?.trim().toLowerCase();
  return DATA_OS_ALLOWED_REMOTE_TARGETS.includes(target as typeof DATA_OS_ALLOWED_REMOTE_TARGETS[number]);
}

export function isDataOsWorkerEnabled(env: DataOsEnv = process.env): boolean {
  return env.NOISIA_DATA_OS_WORKER_ENABLED === "true";
}

export function isDataOsWorkerRunEnabled(env: DataOsEnv = process.env): boolean {
  return env.NOISIA_DATA_OS_WORKER_RUNS_ENABLED === "true";
}

export function isDataOsWorkerRemoteApproved(env: DataOsEnv = process.env): boolean {
  return env.NOISIA_DATA_OS_WORKER_REMOTE_APPROVED === "true" && isDataOsRemoteTargetAllowed(env);
}
