import type { Job } from "bullmq";

import { processSignalSemanticContextProposalRunV1 } from "@noisia/db";
import { validateSignalSemanticContextProposalJobDataV1 } from "@noisia/query-engine";
import { pool } from "../db/client";
import { createAnthropicSemanticContextProposalProviderV1 } from "../providers/anthropic-bounded-text";

export async function signalSemanticContextProposalJob(job: Job) {
  const data = validateSignalSemanticContextProposalJobDataV1(job.data);
  await job.updateProgress(5);
  try {
    const result = await processSignalSemanticContextProposalRunV1({ pool, run_id: data.run_id,
      provider: createAnthropicSemanticContextProposalProviderV1() });
    await job.updateProgress(result.status === "completed" ? 100 : 99);
    return result;
  } catch (error) {
    const safe = new Error(error instanceof Error && "code" in error
      && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "semantic_context_proposal_job_failed");
    safe.name = "SignalSemanticContextProposalJobError";
    throw safe;
  }
}
