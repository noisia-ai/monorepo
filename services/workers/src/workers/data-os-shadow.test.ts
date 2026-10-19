import assert from "node:assert/strict";
import test from "node:test";

import { buildDataOsShadowRunStepEnv, runDataOsShadowRunJob } from "./data-os-shadow";

function job(data: Parameters<typeof runDataOsShadowRunJob>[0]["data"]) {
  const progress: number[] = [];
  return {
    progress,
    job: {
      data,
      updateProgress: async (value: number) => {
        progress.push(value);
      }
    }
  };
}

test("Data OS worker jobs fail closed without the execution gate", async () => {
  const fake = job({ corpusId: "corpus-1", outputId: "output-1" });
  const calls: string[] = [];

  await assert.rejects(
    runDataOsShadowRunJob(fake.job, {
      env: {},
      runStep: async (step) => {
        calls.push(step);
        return { step, duration_ms: 1 };
      }
    }),
    /NOISIA_DATA_OS_WORKER_RUNS_ENABLED=true/
  );

  assert.deepEqual(calls, []);
  assert.deepEqual(fake.progress, []);
});

test("Data OS worker executes shadow, analyze, serving smoke, review queue and evidence with explicit env", async () => {
  const fake = job({ corpusId: "corpus-1", outputId: "output-1", strict: true });
  const calls: Array<{ step: string; args: string[]; env: NodeJS.ProcessEnv }> = [];

  const result = await runDataOsShadowRunJob(fake.job, {
    env: {
      NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT: "true",
      NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS: "true",
      NOISIA_DATA_OS_WORKER_RUNS_ENABLED: "true"
    },
    runStep: async (step, args, env) => {
      calls.push({ step, args, env });
      return { step, duration_ms: 1 };
    }
  });

  assert.deepEqual(fake.progress, [10, 45, 70, 82, 90, 100]);
  assert.deepEqual(calls.map((call) => call.step), ["shadow_run", "analyze", "serving_smoke", "review_queue", "evidence"]);
  assert.deepEqual(calls[0]?.args, ["--filter", "@noisia/db", "data-os:shadow-run"]);
  assert.deepEqual(calls[1]?.args, ["--filter", "@noisia/db", "data-os:analyze"]);
  assert.deepEqual(calls[2]?.args, ["--filter", "@noisia/studio", "data-os:serving-smoke"]);
  assert.deepEqual(calls[3]?.args, ["--filter", "@noisia/db", "data-os:review-queue"]);
  assert.deepEqual(calls[4]?.args, ["--filter", "@noisia/db", "data-os:evidence"]);
  assert.equal(calls[0]?.env.NOISIA_DATA_OS_BACKFILL_CORPUS_ID, "corpus-1");
  assert.equal(calls[0]?.env.NOISIA_DATA_OS_SHADOW_OUTPUT_ID, "output-1");
  assert.equal(calls[0]?.env.NOISIA_DATA_OS_SHADOW_RUN_ENABLED, "true");
  assert.equal(calls[0]?.env.NOISIA_DATA_OS_SHADOW_RUN_STRICT, "true");
  assert.equal(calls[3]?.env.NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS, "false");
  assert.equal(calls[3]?.env.NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT, "false");
  assert.equal(calls[2]?.env.NOISIA_DATA_OS_ENABLED, "true");
  assert.equal(calls[2]?.env.NOISIA_DATA_OS_SERVING_ENABLED, "true");
  assert.equal(calls[2]?.env.NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED, "true");
  assert.equal(calls[2]?.env.NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID, "corpus-1");
  assert.equal(calls[2]?.env.NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID, "output-1");
  assert.equal(result.ready_for_internal_shadow, true);
});

test("Data OS worker can run only the shadow step for focused debugging", async () => {
  const fake = job({
    corpusId: "corpus-1",
    outputId: "output-1",
    strict: false,
    includeServingSmoke: false,
    includeEvidence: false
  });
  const calls: string[] = [];

  const result = await runDataOsShadowRunJob(fake.job, {
    env: { NOISIA_DATA_OS_WORKER_RUNS_ENABLED: "true" },
    runStep: async (step) => {
      calls.push(step);
      return { step, duration_ms: 1 };
    }
  });

  assert.deepEqual(fake.progress, [10, 100]);
  assert.deepEqual(calls, ["shadow_run"]);
  assert.equal(result.strict, false);
});

test("Data OS worker can skip review queue during focused serving smoke debugging", async () => {
  const fake = job({
    corpusId: "corpus-1",
    outputId: "output-1",
    includeEvidence: false,
    includeReviewQueue: false
  });
  const calls: string[] = [];

  await runDataOsShadowRunJob(fake.job, {
    env: { NOISIA_DATA_OS_WORKER_RUNS_ENABLED: "true" },
    runStep: async (step) => {
      calls.push(step);
      return { step, duration_ms: 1 };
    }
  });

  assert.deepEqual(fake.progress, [10, 45, 70, 100]);
  assert.deepEqual(calls, ["shadow_run", "analyze", "serving_smoke"]);
});

test("Data OS worker remote approval adds only the reviewed remote overrides", () => {
  const unscopedRemote = buildDataOsShadowRunStepEnv(
    { corpusId: "corpus-1", outputId: "output-1" },
    { NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "true" }
  );
  assert.equal(unscopedRemote.NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE, undefined);

  const env = buildDataOsShadowRunStepEnv(
    { corpusId: "corpus-1", outputId: "output-1" },
    {
      NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "true",
      NOISIA_REMOTE_DATABASE_TARGET: "staging"
    }
  );

  for (const flag of [
    "NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE",
    "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE",
    "NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE",
    "NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE",
    "NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE",
    "NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE",
    "NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE",
    "NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE"
  ]) {
    assert.equal(env[flag], "true");
  }

  assert.equal(env.NOISIA_REMOTE_DATABASE_TARGET, "staging");
});
