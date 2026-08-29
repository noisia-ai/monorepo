import type { Job } from "bullmq";

import { processSignalTopicEvaluationRunV1 } from "@noisia/db";
import { signalTopicEvaluationJobDataV1 } from "@noisia/query-engine";
import { pool } from "../db/client";
import { createAnthropicTopicEvaluationProviderV1 } from "../providers/anthropic-bounded-text";

export async function signalTopicEvaluationJob(job: Job) {
  const data = signalTopicEvaluationJobDataV1(job.data);
  await job.updateProgress(5);
  try {
    const executionEnabled = process.env.NOISIA_TOPIC_EVALUATION_ENABLED === "true";
    if (!executionEnabled) {
      throw Object.assign(new Error("topic_evaluation_disabled"), {
        code: "topic_evaluation_disabled"
      });
    }
    const result = await processSignalTopicEvaluationRunV1({ pool, run_id: data.run_id,
      execution_enabled: executionEnabled,
      provider: createAnthropicTopicEvaluationProviderV1() });
    await job.updateProgress(100);
    return result;
  } catch (error) {
    const safe = new Error(error instanceof Error && "code" in error
      && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "topic_evaluation_job_failed");
    safe.name = "SignalTopicEvaluationJobError";
    throw safe;
  }
}
