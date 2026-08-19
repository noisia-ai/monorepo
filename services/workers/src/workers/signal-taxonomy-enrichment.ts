import type { Job } from "bullmq";

import type { SignalTaxonomyEnrichmentJobDataV1 } from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON,
  SignalTaxonomyEnrichmentRetiredError
} from "./signal-taxonomy-enrichment-runtime";

/**
 * Historical compatibility tombstone. The old full-pop Anthropic/Voyage
 * implementation was removed in Gate 10B. Even a direct invocation only marks
 * an existing durable run blocked and never imports or calls a provider.
 */
export async function signalTaxonomyEnrichmentJob(
  job: Pick<Job<SignalTaxonomyEnrichmentJobDataV1>, "data">
) {
  const runId = job.data?.run_id;
  if (runId) {
    await pool.query(`
      UPDATE signal_refresh_runs
      SET status='blocked',
          error_code=$2,
          error_summary=jsonb_build_object('code',$2,'retryable',false),
          result_summary=COALESCE(result_summary,'{}'::jsonb)
            || jsonb_build_object('kill_switch','gate-10b','provider_calls',0),
          completed_at=COALESCE(completed_at,now()),
          heartbeat_at=now()
      WHERE id=$1::uuid AND run_type='taxonomy_enrichment'
        AND status IN ('queued','running','partial','failed')
    `, [runId, SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON]);
  }
  throw new SignalTaxonomyEnrichmentRetiredError();
}
