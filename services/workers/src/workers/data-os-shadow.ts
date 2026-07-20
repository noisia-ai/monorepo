import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";

import {
  isDataOsWorkerRemoteApproved,
  isDataOsWorkerRunEnabled,
  type DataOsShadowRunJobData
} from "@noisia/query-engine";

type StepResult = {
  step: string;
  duration_ms: number;
};

type DataOsShadowRunJobLike = {
  data: DataOsShadowRunJobData;
  updateProgress(progress: number): Promise<unknown>;
};

type DataOsStepRunner = (step: string, args: string[], env: NodeJS.ProcessEnv) => Promise<StepResult>;

const WORKER_REMOTE_FLAGS = [
  "NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE",
  "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE",
  "NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE",
  "NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE",
  "NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE",
  "NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE",
  "NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE",
  "NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE"
];

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Data OS worker job missing ${label}.`);
  }
  return value.trim();
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export function buildDataOsShadowRunStepEnv(
  data: DataOsShadowRunJobData,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const corpusId = requiredString(data.corpusId, "corpusId");
  const outputId = requiredString(data.outputId, "outputId");
  const strict = data.strict !== false;
  const remoteApproved = isDataOsWorkerRemoteApproved(baseEnv);

  return {
    ...baseEnv,
    NOISIA_DATA_OS_BACKFILL_CORPUS_ID: corpusId,
    NOISIA_DATA_OS_SHADOW_OUTPUT_ID: outputId,
    NOISIA_DATA_OS_SHADOW_RUN_ENABLED: "true",
    NOISIA_DATA_OS_SHADOW_RUN_STRICT: strict ? "true" : "false",
    NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS: "false",
    NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT: "false",
    ...(remoteApproved ? Object.fromEntries(WORKER_REMOTE_FLAGS.map((flag) => [flag, "true"])) : {})
  };
}

function runPnpmStep(step: string, args: string[], env: NodeJS.ProcessEnv) {
  const startedAt = Date.now();

  return new Promise<StepResult>((resolveStep, reject) => {
    const child = spawn("corepack", ["pnpm", "--silent", ...args], {
      cwd: repoRoot(),
      env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        resolveStep({ step, duration_ms: durationMs });
        return;
      }
      reject(new Error(`Data OS worker step ${step} exited with code ${code ?? "unknown"}.`));
    });
  });
}

export async function runDataOsShadowRunJob(
  job: DataOsShadowRunJobLike,
  options: { env?: NodeJS.ProcessEnv; runStep?: DataOsStepRunner } = {}
) {
  const baseEnv = options.env ?? process.env;
  const runStep = options.runStep ?? runPnpmStep;

  if (!isDataOsWorkerRunEnabled(baseEnv)) {
    throw new Error("Data OS worker jobs are disabled. Set NOISIA_DATA_OS_WORKER_RUNS_ENABLED=true for an approved staging run.");
  }

  const corpusId = requiredString(job.data.corpusId, "corpusId");
  const outputId = requiredString(job.data.outputId, "outputId");
  const env = buildDataOsShadowRunStepEnv(job.data, baseEnv);
  const includeAnalyze = job.data.includeServingSmoke !== false || job.data.includeEvidence !== false;
  const includeReviewQueue =
    job.data.includeReviewQueue !== false && (job.data.includeServingSmoke !== false || job.data.includeEvidence !== false);
  const steps: StepResult[] = [];

  await job.updateProgress(10);
  steps.push(await runStep("shadow_run", ["--filter", "@noisia/db", "data-os:shadow-run"], env));

  if (includeAnalyze) {
    await job.updateProgress(45);
    steps.push(await runStep("analyze", ["--filter", "@noisia/db", "data-os:analyze"], env));
  }

  if (job.data.includeServingSmoke !== false) {
    await job.updateProgress(70);
    steps.push(await runStep(
      "serving_smoke",
      ["--filter", "@noisia/studio", "data-os:serving-smoke"],
      {
        ...env,
        NOISIA_DATA_OS_ENABLED: "true",
        NOISIA_DATA_OS_SERVING_ENABLED: "true",
        NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
        NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID: corpusId,
        NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID: outputId
      }
    ));
  }

  if (includeReviewQueue) {
    await job.updateProgress(82);
    steps.push(await runStep("review_queue", ["--filter", "@noisia/db", "data-os:review-queue"], env));
  }

  if (job.data.includeEvidence !== false) {
    await job.updateProgress(90);
    steps.push(await runStep("evidence", ["--filter", "@noisia/db", "data-os:evidence"], env));
  }

  await job.updateProgress(100);
  return {
    ok: true,
    corpus_id: corpusId,
    output_id: outputId,
    strict: job.data.strict !== false,
    remote_approved: isDataOsWorkerRemoteApproved(baseEnv),
    steps,
    ready_for_internal_shadow: true
  };
}

export async function dataOsShadowRunJob(job: Job<DataOsShadowRunJobData>) {
  return runDataOsShadowRunJob(job);
}
