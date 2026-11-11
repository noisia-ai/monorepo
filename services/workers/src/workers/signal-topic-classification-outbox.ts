import type { Pool } from "pg";
import { safeWorkspaceClassificationErrorV1 } from "./signal-workspace-classification";

import { SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME, SIGNAL_WORKSPACE_ENGINE_JOB_V1 } from "@noisia/query-engine";
import { scheduleSignalWorkspaceTopicComputationsV1, scheduleSignalWorkspaceTopicProjectionsV1,
  scheduleSignalWorkspaceNumericUpdatesV1, recoverSignalWorkspaceIncrementalEditorialPreparationsV1, SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1,
  scheduleSignalWorkspaceEngineProgressV1, SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1,
  scheduleSignalWorkspaceIncrementalProjectionsV1,
  SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_V1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME } from "./signal-workspace-topic-computation";
import { SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME } from "./signal-workspace-incremental-derivation";
import { SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME } from "./signal-workspace-incremental-projection";
import { SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME } from "./signal-workspace-incremental-editorial-job";

type QueueLike = {
  add(name: string, data: unknown, options: Record<string, unknown>): Promise<unknown>;
  getJob(id: string): Promise<{ name: string; getState(): Promise<string>;
    updateData?(data: unknown): Promise<void>;
    retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
};
type Options = { database?: Pick<Pool, "query" | "connect">; queue?: QueueLike; interval_ms?: number;
  run_immediately?: boolean; batch_size?: number; lease_seconds?: number; max_attempts?: number;
  numeric_cursor?: { after_workspace_id: string | null };
  schedule?: typeof scheduleSignalWorkspaceTopicComputationsV1 };

// Historical paid pilots retain their private operator. Native product runs
// cross this boundary only with the exact typed profile and their own current,
// workspace/actor/target-bound admission, or an immutable receipt-only V2
// disposition. The consumer derives replay mode again; the DB forbids sends.
const massLabelingDispatchGuard = `NOT EXISTS(
  SELECT 1 FROM signal_topic_catalog_executions pilot
  WHERE pilot.id=signal_topic_classification_outbox.execution_id
    AND ((pilot.input_snapshot#>>'{engine_config,profile_version}' IN
      ('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
      AND pilot.input_snapshot ? 'interpretation_config') OR pilot.input_snapshot ? 'mass_labeling_product')
    AND NOT (
      signal_mass_labeling_product_engine_v2(pilot.workspace_id,pilot.input_contract,pilot.input_snapshot)
      AND pilot.status IN ('queued','running')
      AND signal_brand_context_processing_actor_v1(pilot.workspace_id,pilot.actor_user_id)
      AND pilot.workspace_id=signal_topic_classification_outbox.workspace_id
      AND (EXISTS(
        SELECT 1 FROM signal_processing_admissions admission
        JOIN signal_processing_policy_versions policy ON policy.id=admission.policy_version_id
          AND policy.organization_id=admission.organization_id AND policy.status='active'
          AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
        JOIN signal_workspaces workspace ON workspace.id=pilot.workspace_id AND workspace.status='active'
          AND workspace.organization_id=admission.organization_id AND workspace.brand_id=admission.brand_id
        WHERE admission.id=pilot.processing_admission_id
          AND admission.workspace_id=pilot.workspace_id AND admission.actor_user_id=pilot.actor_user_id
          AND admission.target_id=pilot.id AND admission.request_digest=pilot.request_digest
          AND admission.action='topic_interpretation' AND admission.provider='anthropic'
          AND admission.model=pilot.input_snapshot#>>'{interpretation_config,call_configuration,model}'
          AND signal_processing_configuration_allows_v1(admission.action,admission.configuration,
            pilot.input_snapshot#>'{interpretation_config,call_configuration}')
          AND admission.admission_not_after>clock_timestamp()
      ) OR EXISTS(
        SELECT 1 FROM signal_mass_labeling_global_receipt_decisions disposition
        JOIN engine_cost_events receipt ON receipt.id=disposition.call_id
          AND receipt.workspace_id=disposition.workspace_id AND receipt.catalog_execution_id=disposition.execution_id
          AND receipt.actor_user_id=disposition.created_by_user_id
        JOIN signal_corpus_preparation_input_state source ON source.workspace_id=pilot.workspace_id
          AND source.input_revision=pilot.input_revision
        JOIN signal_workspaces workspace ON workspace.id=pilot.workspace_id AND workspace.status='active'
        WHERE disposition.id::text=pilot.result_summary->>'global_receipt_recovery_decision_id'
          AND disposition.workspace_id=pilot.workspace_id AND disposition.execution_id=pilot.id
          AND disposition.created_by_user_id=pilot.actor_user_id
          AND disposition.input_digest=pilot.input_digest
          AND disposition.fit_checkpoint_digest=pilot.result_summary#>>'{fit_checkpoint,checkpoint_digest}'
          AND (pilot.policy_valid_until IS NULL OR pilot.policy_valid_until>clock_timestamp())
          AND disposition.decision->>'contract_version'='workspace-mass-labeling-receipt-recovery-v2'
          AND disposition.decision->>'workspace_id'=pilot.workspace_id::text
          AND disposition.decision->>'execution_id'=pilot.id::text
          AND disposition.decision->>'call_id'=receipt.id::text
          AND disposition.decision->>'request_digest'=receipt.request_digest
          AND disposition.decision->>'response_sha256'=receipt.response_sha256
          AND disposition.decision->>'source_groups_digest'=disposition.source_groups_digest
          AND disposition.decision_digest='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(disposition.decision),'UTF8')),'hex')
          AND receipt.workspace_contract='workspace-engine-interpretation-v1' AND receipt.call_state='settled'
          AND receipt.settled_micro_usd IS NOT NULL AND receipt.response_http_status=200
          AND receipt.response_storage_key IS NOT NULL AND receipt.response_size_bytes>0
          AND COALESCE((receipt.metadata->>'response_complete')::boolean,true)
          AND receipt.request_digest=disposition.request_digest AND receipt.response_sha256=disposition.response_sha256
          AND receipt.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
          AND receipt.metadata#>>'{mass_labeling_stage,source_groups_digest}'=disposition.source_groups_digest
          AND NOT receipt.metadata ? 'editorial_repair'
          AND receipt.call_configuration=workspace_engine_interpretation_configuration_v1(pilot.id,receipt.metadata->>'interpretation_revision_digest')
      ))
    )
)`;

export async function drainSignalTopicClassificationOutboxV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const maxAttempts = options.max_attempts ?? 8;
  // Recovers only workspace execution ledgers, not legacy corpus tables.
  if(options.schedule) await options.schedule({database});
  else {
    // Operational rollout gate; this producer admits only zero-cost numeric work.
    if (process.env.NOISIA_WORKSPACE_NUMERIC_PRODUCER_ENABLED === 'true') {
      const numeric = await scheduleSignalWorkspaceNumericUpdatesV1({database,
        after_workspace_id: options.numeric_cursor?.after_workspace_id});
      if (options.numeric_cursor) options.numeric_cursor.after_workspace_id = numeric.next_cursor;
      if (numeric.failures.length) console.warn("Workspace numeric admissions deferred", { failures: numeric.failures });
    }
    await scheduleSignalWorkspaceTopicComputationsV1({database});
    // Enable once every replica understands dispatch_kind. Older drainers
    // route by execution contract and cannot safely consume derived jobs.
    if (process.env.NOISIA_WORKSPACE_TOPIC_PROGRESS_ENABLED === 'true')
      await scheduleSignalWorkspaceEngineProgressV1({database});
    await scheduleSignalWorkspaceTopicProjectionsV1({database});
    if (process.env.NOISIA_WORKSPACE_INCREMENTAL_PROJECTION_ENABLED === 'true')
      await scheduleSignalWorkspaceIncrementalProjectionsV1({database});
  }
  await database.query(`
    WITH dead AS(
      UPDATE signal_topic_classification_outbox
      SET status='dead_letter',error_code=COALESCE(error_code,'dispatch_attempts_exhausted'),
        lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE ${massLabelingDispatchGuard}
        AND attempt_count >= $1 AND status IN('pending','failed','dispatching')
        AND (dispatch_kind<>'incremental_editorial_evidence' OR preparation_token IS NULL)
        AND (status<>'dispatching' OR lease_expires_at<=now())
        AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions editorial
          WHERE editorial.id=signal_topic_classification_outbox.execution_id
            AND editorial.input_contract='workspace-incremental-editorial-v1' AND editorial.status NOT IN('queued','running'))
      RETURNING execution_id,dispatch_kind,error_code
    ) UPDATE signal_topic_catalog_executions execution
      SET status='failed',error_code=CASE WHEN execution.input_contract='workspace-incremental-editorial-v1'
       OR execution.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
       THEN dead.error_code ELSE 'topic_queue_unavailable' END,completed_at=now(),updated_at=now()
      FROM dead WHERE execution.id=dead.execution_id AND dead.dispatch_kind='execution' AND execution.status='queued'
  `, [maxAttempts]);
  await recoverSignalWorkspaceIncrementalEditorialPreparationsV1({database});
  const claimed = await database.query<{ outbox_id: string; execution_id: string; workspace_id: string;
    lease_token: string; worker_job_id: string; attempt_count: number; input_contract: string;
    source_projection: boolean; source_projection_contract: string | null; dispatch_kind: string; actor_user_id: string }>(`
    WITH candidates AS(
      SELECT id FROM signal_topic_classification_outbox
      WHERE ${massLabelingDispatchGuard}
        AND attempt_count<$1
        AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions editorial
          WHERE editorial.id=signal_topic_classification_outbox.execution_id
            AND editorial.input_contract='workspace-incremental-editorial-v1' AND editorial.status NOT IN('queued','running'))
        AND (dispatch_kind<>'incremental_editorial_evidence' OR status<>'failed' OR error_code='workspace_incremental_editorial_preparation_transport_unavailable')
        AND (dispatch_kind<>'incremental_editorial_evidence' OR preparation_token IS NULL)
        AND (dispatch_kind<>'incremental_projection' OR status<>'failed' OR error_code IN('workspace_incremental_projection_transport_unavailable','workspace_classification_transport_unavailable'))
        AND ((status IN('pending','failed') AND available_at<=now())
        OR (status='dispatching' AND lease_expires_at<=now()))
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE signal_topic_classification_outbox outbox SET status='dispatching',
      attempt_count=outbox.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>$3),error_code=NULL,updated_at=now()
    FROM candidates,signal_topic_catalog_executions execution
    WHERE outbox.id=candidates.id AND execution.id=outbox.execution_id
    RETURNING outbox.id::text outbox_id,outbox.execution_id::text,
      outbox.workspace_id::text,outbox.lease_token::text,outbox.worker_job_id,outbox.attempt_count,
      execution.input_contract,execution.input_snapshot->'source_projection' IS NOT NULL source_projection,
      execution.input_snapshot->'source_projection'->>'contract_version' source_projection_contract,
      outbox.dispatch_kind,CASE WHEN outbox.dispatch_kind='incremental_editorial_evidence' THEN (SELECT actor_user_id::text FROM signal_classification_operations WHERE id=outbox.preparation_operation_id) ELSE execution.actor_user_id::text END actor_user_id
  `, [maxAttempts, options.batch_size ?? 20, options.lease_seconds ?? 60]);
  const result = { claimed: claimed.rows.length, dispatched: 0, failed: 0, dead_lettered: 0 };
  for (const row of claimed.rows) {
    try {
      const jobName = topicExecutionJobNameV1(row.input_contract,row.source_projection,row.dispatch_kind,row.source_projection_contract);
      const data = row.dispatch_kind === 'engine_progress' || row.dispatch_kind === 'incremental_projection' || row.dispatch_kind === 'incremental_editorial_evidence'
        ? { execution_id: row.execution_id, workspace_id: row.workspace_id, actor_user_id: row.actor_user_id }
        : { execution_id: row.execution_id };
      const prior = await queue.getJob(row.worker_job_id);
      if (prior) {
        if (prior.name !== jobName) throw new Error("topic_dispatch_contract_mismatch");
        const state = await prior.getState();
        if (state === "completed" || state === "failed") {
          // An explicit free recovery can be requested by another authorized actor.
          // Keep the durable job, but bind its next attempt to the current receipt.
          // Never replace data on a queued/running job or weaken the Worker claim.
          if (row.dispatch_kind === 'incremental_editorial_evidence') {
            if (!prior.updateData) throw new Error("topic_dispatch_contract_mismatch");
            await prior.updateData(data);
          }
          await prior.retry(state);
        }
      } else await queue.add(jobName, data, {
        jobId: row.worker_job_id,
        attempts: row.input_contract === "legacy-topic-catalog-v1" ? 2 : 1,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 200 },
        removeOnFail: { age: 604_800, count: 500 }
      });
      const completed = await database.query(`
        UPDATE signal_topic_classification_outbox SET status='dispatched',dispatched_at=now(),
          lease_token=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='dispatching'
      `, [row.outbox_id, row.lease_token]);
      if ((completed.rowCount ?? 0) === 1) result.dispatched += 1;
    } catch (error) {
      const dead = row.attempt_count >= maxAttempts;
      const errorCode = row.dispatch_kind==='incremental_editorial_evidence' && safeWorkspaceClassificationErrorV1(error)==='workspace_classification_transport_unavailable'
        ? 'workspace_incremental_editorial_preparation_transport_unavailable' : row.input_contract==='workspace-incremental-editorial-v1'
        && safeWorkspaceClassificationErrorV1(error)==='workspace_classification_transport_unavailable'
        ? 'workspace_incremental_editorial_transport_unavailable' : safeError(error);
      if (dead) await database.query(`
        WITH exhausted AS(
          UPDATE signal_topic_classification_outbox SET status='dead_letter',
            lease_token=NULL,lease_expires_at=NULL,error_code=$3,updated_at=now()
          WHERE id=$1::uuid AND lease_token=$2::uuid AND status='dispatching'
            AND (dispatch_kind<>'incremental_editorial_evidence' OR preparation_token IS NULL)
          RETURNING execution_id,dispatch_kind,error_code
        ) UPDATE signal_topic_catalog_executions execution
          SET status='failed',error_code=CASE WHEN execution.input_contract='workspace-incremental-editorial-v1'
           OR execution.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
           THEN exhausted.error_code ELSE 'topic_queue_unavailable' END,completed_at=now(),updated_at=now()
          FROM exhausted WHERE execution.id=exhausted.execution_id AND exhausted.dispatch_kind='execution' AND execution.status='queued'
      `, [row.outbox_id, row.lease_token, errorCode]);
      else await database.query(`
        UPDATE signal_topic_classification_outbox SET status='failed',
          available_at=now()+make_interval(secs=>$3),lease_token=NULL,lease_expires_at=NULL,
          error_code=$4,updated_at=now()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND status='dispatching'
          AND (dispatch_kind<>'incremental_editorial_evidence' OR preparation_token IS NULL)
      `, [row.outbox_id, row.lease_token,
        Math.min(900, 5 * (2 ** Math.max(0, row.attempt_count - 1))), errorCode]);
      if (dead) result.dead_lettered += 1;
      else result.failed += 1;
    }
  }
  return result;
}

export function topicExecutionJobNameV1(inputContract: string, sourceProjection = false, dispatchKind = 'execution', projectionContract?: string | null) {
  if (dispatchKind === 'incremental_editorial_evidence' && inputContract === 'workspace-topic-engine-v1') return SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1;
  if (dispatchKind === 'engine_progress' && inputContract === 'workspace-topic-engine-v1') return SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1;
  if (dispatchKind === 'incremental_projection' && inputContract === 'workspace-topic-engine-v1') return SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME;
  if (dispatchKind !== 'execution') throw new Error("topic_dispatch_contract_unknown");
  if (inputContract === "legacy-topic-catalog-v1") return SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME;
  if (inputContract === "workspace-topic-computation-v1") return SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME;
  if (inputContract === "workspace-topic-engine-v1") return SIGNAL_WORKSPACE_ENGINE_JOB_V1;
  if (inputContract === "workspace-incremental-editorial-v1") return SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME;
  if(inputContract === "workspace-topic-classification-v1" && sourceProjection) {
    if (projectionContract === 'workspace-topic-incremental-projection-v1') return SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME;
    if (!projectionContract || projectionContract === 'workspace-topic-projection-v1') return SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_V1;
  }
  throw new Error("topic_dispatch_contract_unknown");
}

export function startSignalTopicClassificationOutboxDrainerV1(options: Options = {}) {
  options = {...options, numeric_cursor: options.numeric_cursor ?? {after_workspace_id:null}};
  let closed = false;
  let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalTopicClassificationOutboxV1(options).catch((error) => {
      console.warn(`[topic-classification-outbox] ${safeError(error)}`);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => { void drainNow(); }, options.interval_ms ?? 2_500);
  timer.unref?.();
  if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}

function safeError(error: unknown) {
  if (safeWorkspaceClassificationErrorV1(error) === "workspace_classification_transport_unavailable") return "workspace_classification_transport_unavailable";
  return (error instanceof Error ? error.name : "unknown_error").slice(0, 120);
}
