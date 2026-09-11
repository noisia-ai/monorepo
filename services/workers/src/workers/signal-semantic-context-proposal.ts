import type { Job } from "bullmq";

import { processSignalSemanticContextProposalRunV1, advanceSignalBrandContextPreparationsV1, signalBrandContextPreparationRuntimeFromEnvV1,
  type SignalBrandContextPreparationRuntimeV1 } from "@noisia/db";
import { validateSignalSemanticContextProposalJobDataV1 } from "@noisia/query-engine";
import type { Pool } from "pg";
import type { SignalSemanticContextProposalProviderV1 } from "@noisia/query-engine";
import { createAnthropicSemanticContextProposalProviderV1 } from "../providers/anthropic-bounded-text";

export async function signalSemanticContextProposalJob(job: Pick<Job,'data'|'updateProgress'>,options:{database?:Pick<Pool,'connect'|'query'>;
  provider?:SignalSemanticContextProposalProviderV1;preparation_runtime?:SignalBrandContextPreparationRuntimeV1}={}) {
  const pool=options.database??(await import('../db/client')).pool;
  const data = validateSignalSemanticContextProposalJobDataV1(job.data);
  await job.updateProgress(5);
  try {
    const result = await processSignalSemanticContextProposalRunV1({ pool, run_id: data.run_id,
      provider: options.provider??createAnthropicSemanticContextProposalProviderV1() });
    const scope=await pool.query<{workspace_id:string}>(`SELECT workspace_id::text FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`,[data.run_id]);
    if(scope.rows[0]){
      const progress=await advanceSignalBrandContextPreparationsV1({database:pool,workspace_id:scope.rows[0].workspace_id,
        runtime:options.preparation_runtime??signalBrandContextPreparationRuntimeFromEnvV1(process.env,{queue_configured:true,worker_alive:true,recovery_alive:true})});
      const failed=progress.find(item=>item.state==='failed');if(failed)throw Object.assign(new Error('brand_context_coordinator_failed'),{code:failed.error_code});
    }
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
