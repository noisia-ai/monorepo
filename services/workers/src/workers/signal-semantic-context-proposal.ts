import type { Job } from "bullmq";

import { processSignalSemanticContextProposalRunV1, advanceSignalBrandContextComposedProcessingV1,
  advanceSignalBrandContextPreparationsV1, signalBrandContextPreparationRuntimeFromEnvV1,
  type SignalBrandContextPreparationRuntimeV1 } from "@noisia/db";
import { validateSignalSemanticContextProposalJobDataV1 } from "@noisia/query-engine";
import type { Pool } from "pg";
import type { SignalSemanticContextProposalProviderV1 } from "@noisia/query-engine";
import { createAnthropicSemanticContextProposalProviderV1 } from "../providers/anthropic-bounded-text";

export async function signalSemanticContextProposalJob(job: Pick<Job,'data'|'updateProgress'>,options:{database?:Pick<Pool,'connect'|'query'>;
  provider?:SignalSemanticContextProposalProviderV1;preparation_runtime?:SignalBrandContextPreparationRuntimeV1;
  process_run?:typeof processSignalSemanticContextProposalRunV1;
  advance_composed?:typeof advanceSignalBrandContextComposedProcessingV1;
  advance_preparation?:typeof advanceSignalBrandContextPreparationsV1}={}) {
  const pool=options.database??(await import('../db/client')).pool;
  const data = validateSignalSemanticContextProposalJobDataV1(job.data);
  await job.updateProgress(5);
  try {
    const runtime=options.preparation_runtime??signalBrandContextPreparationRuntimeFromEnvV1(process.env,
      {queue_configured:true,worker_alive:true,recovery_alive:true});
    const result = await (options.process_run??processSignalSemanticContextProposalRunV1)({ pool, run_id: data.run_id,
      provider: options.provider??createAnthropicSemanticContextProposalProviderV1() });
    let composed;
    try { composed=await (options.advance_composed??advanceSignalBrandContextComposedProcessingV1)({database:pool,
      semantic_run_id:data.run_id,provider_available:runtime.prototype.available}); }
    catch(error){composed={contract_version:'brand-context-composed-advance-v1' as const,state:'blocked' as const,
      semantic_run_id:data.run_id,error_code:safeComposedError(error)};}
    const scope=await pool.query<{workspace_id:string}>(`SELECT workspace_id::text FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`,[data.run_id]);
    if(scope.rows[0]){
      const progress=await (options.advance_preparation??advanceSignalBrandContextPreparationsV1)({database:pool,workspace_id:scope.rows[0].workspace_id,
        runtime});
      const failed=progress.find(item=>item.state==='failed');if(failed)throw Object.assign(new Error('brand_context_coordinator_failed'),{code:failed.error_code});
    }
    await job.updateProgress(result.status === "completed" ? 100 : 99);
    return {...result,brand_context_composed:composed};
  } catch (error) {
    const safe = new Error(error instanceof Error && "code" in error
      && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : "semantic_context_proposal_job_failed");
    safe.name = "SignalSemanticContextProposalJobError";
    throw safe;
  }
}

function safeComposedError(error:unknown){
  const code=error!==null&&typeof error==='object'?Reflect.get(error,'code'):null;
  return typeof code==='string'&&/^[a-z_]{1,140}$/u.test(code)?code:'brand_context_composed_advance_failed';
}
