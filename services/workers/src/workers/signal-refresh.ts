import type { Job } from "bullmq";

import { recordSignalDataAcceptance } from "@noisia/db";
import {
  SIGNAL_INVALIDATION_JOB_NAME,
  SIGNAL_REFRESH_CONTRACT_VERSION,
  SIGNAL_REFRESH_RUN_JOB_NAME,
  buildSignalRefreshRunIdempotencyKeyV1,
  type SignalInvalidationJobDataV1,
  type SignalRefreshRunJobDataV1,
  type SignalRefreshTickJobDataV1
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { getSignalRefreshQueue } from "../queues/signal-refresh";
import { buildSignalRefreshRunOptions } from "./signal-refresh-runtime";

type DuePolicy = {
  id: string;
  workspace_id: string;
  source_key: string;
  scheduled_for: Date;
};

export async function signalRefreshTickJob(_job: Job<SignalRefreshTickJobDataV1>) {
  const due = await pool.query<DuePolicy>(`
    WITH due AS (
      SELECT id, workspace_id, source_key, cadence, timezone, expected_next_run
      FROM signal_refresh_policies
      WHERE enabled = true
        AND expected_next_run <= now()
      ORDER BY expected_next_run, id
      FOR UPDATE SKIP LOCKED
      LIMIT 100
    )
    UPDATE signal_refresh_policies policy
    SET expected_next_run = CASE due.cadence
          WHEN 'hourly' THEN ((due.expected_next_run AT TIME ZONE due.timezone) + interval '1 hour') AT TIME ZONE due.timezone
          WHEN 'daily' THEN ((due.expected_next_run AT TIME ZONE due.timezone) + interval '1 day') AT TIME ZONE due.timezone
          WHEN 'weekly' THEN ((due.expected_next_run AT TIME ZONE due.timezone) + interval '1 week') AT TIME ZONE due.timezone
          WHEN 'monthly' THEN ((due.expected_next_run AT TIME ZONE due.timezone) + interval '1 month') AT TIME ZONE due.timezone
          ELSE NULL
        END,
        updated_at = now()
    FROM due
    WHERE policy.id = due.id
    RETURNING due.id::text, due.workspace_id::text, due.source_key,
      due.expected_next_run AS scheduled_for
  `);

  const queue = getSignalRefreshQueue();
  for (const policy of due.rows) {
    const idempotencyKey = buildSignalRefreshRunIdempotencyKeyV1({
      refresh_policy_id: policy.id,
      scheduled_for: policy.scheduled_for
    });
    const data: SignalRefreshRunJobDataV1 = {
      contract_version: SIGNAL_REFRESH_CONTRACT_VERSION,
      refresh_policy_id: policy.id,
      workspace_id: policy.workspace_id,
      source_key: policy.source_key,
      scheduled_for: policy.scheduled_for.toISOString(),
      idempotency_key: idempotencyKey
    };
    await queue.add(
      SIGNAL_REFRESH_RUN_JOB_NAME,
      data,
      buildSignalRefreshRunOptions(`signal-refresh-${idempotencyKey.slice(7, 39)}`)
    );
  }

  const invalidations = await pool.query<{ id: string }>(`
    SELECT id::text
    FROM signal_data_invalidations
    WHERE status IN ('pending', 'failed')
      AND attempt < 3
    ORDER BY created_at, id
    LIMIT 100
  `);
  for (const invalidation of invalidations.rows) {
    const data: SignalInvalidationJobDataV1 = {
      contract_version: SIGNAL_REFRESH_CONTRACT_VERSION,
      invalidation_id: invalidation.id
    };
    await queue.add(
      SIGNAL_INVALIDATION_JOB_NAME,
      data,
      buildSignalRefreshRunOptions(`signal-invalidation-${invalidation.id}`)
    );
  }
  return { policies_enqueued: due.rowCount ?? 0, invalidations_enqueued: invalidations.rowCount ?? 0 };
}

export async function signalRefreshRunJob(job: Job<SignalRefreshRunJobDataV1>) {
  const client = await pool.connect();
  const lockKey = `${job.data.workspace_id}:${job.data.source_key}`;
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [lockKey]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) throw new Error("refresh_lock_unavailable");

    const policy = await client.query<{
      policy_id: string;
      workspace_id: string;
      source_key: string;
      adapter_key: string;
      data_source_id: string | null;
      study_corpus_id: string | null;
    }>(`
      SELECT
        policy.id::text AS policy_id,
        policy.workspace_id::text,
        policy.source_key,
        policy.adapter_key,
        policy.data_source_id::text,
        COALESCE(ds.study_corpus_id, membership.study_corpus_id)::text AS study_corpus_id
      FROM signal_refresh_policies policy
      LEFT JOIN data_sources ds ON ds.id = policy.data_source_id
      LEFT JOIN LATERAL (
        SELECT swc.study_corpus_id
        FROM signal_workspace_corpora swc
        WHERE swc.workspace_id = policy.workspace_id
          AND swc.valid_to IS NULL
        ORDER BY CASE swc.role WHEN 'operational' THEN 0 WHEN 'legacy' THEN 1 ELSE 2 END,
          swc.valid_from DESC
        LIMIT 1
      ) membership ON true
      WHERE policy.id = $1::uuid
        AND policy.workspace_id = $2::uuid
        AND policy.source_key = $3
        AND policy.enabled = true
      LIMIT 1
    `, [job.data.refresh_policy_id, job.data.workspace_id, job.data.source_key]);
    const selected = policy.rows[0];
    if (!selected?.study_corpus_id) return completeSkipped(client, job, "policy_or_corpus_not_available");
    const studyCorpusId = selected.study_corpus_id;

    const run = await client.query<{ id: string; status: string }>(`
      INSERT INTO signal_refresh_runs (
        refresh_policy_id, workspace_id, study_corpus_id, source_key,
        idempotency_key, bullmq_job_id, trigger, status, attempt, scheduled_for, started_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'scheduled', 'running', $7, $8, now())
      ON CONFLICT (idempotency_key) DO UPDATE SET
        bullmq_job_id = EXCLUDED.bullmq_job_id,
        attempt = GREATEST(signal_refresh_runs.attempt, EXCLUDED.attempt),
        status = CASE
          WHEN signal_refresh_runs.status IN ('completed', 'skipped') THEN signal_refresh_runs.status
          ELSE 'running'
        END,
        started_at = CASE
          WHEN signal_refresh_runs.status IN ('completed', 'skipped') THEN signal_refresh_runs.started_at
          ELSE now()
        END,
        updated_at = now()
      RETURNING id::text, status
    `, [
      selected.policy_id,
      selected.workspace_id,
      studyCorpusId,
      selected.source_key,
      job.data.idempotency_key,
      job.id ?? null,
      job.attemptsMade + 1,
      job.data.scheduled_for
    ]);
    if (run.rows[0]?.status === "completed" || run.rows[0]?.status === "skipped") {
      return { run_id: run.rows[0].id, reconciliation_only: true };
    }

    const event = await resolveLatestAcceptedEvent(client, { ...selected, study_corpus_id: studyCorpusId });
    if (!event) {
      await client.query(`
        UPDATE signal_refresh_runs
        SET status = 'skipped', completed_at = now(),
            result_summary = '{"reason":"no_completed_source_event"}'::jsonb,
            updated_at = now()
        WHERE id = $1::uuid
      `, [run.rows[0]?.id]);
      return { run_id: run.rows[0]?.id, status: "skipped" };
    }

    const acceptances = await recordSignalDataAcceptance(client, {
      studyCorpusId,
      sourceKey: selected.source_key,
      dataSourceId: selected.data_source_id,
      sourceSyncRunId: event.sourceSyncRunId,
      importBatchId: event.importBatchId,
      materializedAt: new Date()
    });
    await client.query(`
      UPDATE signal_refresh_runs
      SET status = 'completed', completed_at = now(),
          result_summary = jsonb_build_object(
            'watermarks_changed', $2::int,
            'invalidations_created', $3::int
          ),
          error_code = NULL, error_summary = '{}'::jsonb, updated_at = now()
      WHERE id = $1::uuid
    `, [
      run.rows[0]?.id,
      acceptances.filter((item) => item.changed).length,
      acceptances.filter((item) => item.invalidationId).length
    ]);
    return { run_id: run.rows[0]?.id, status: "completed", acceptances: acceptances.length };
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
    await client.query(`
      INSERT INTO signal_refresh_runs (
        refresh_policy_id, workspace_id, source_key, idempotency_key,
        bullmq_job_id, trigger, status, attempt, scheduled_for, completed_at,
        error_code, error_summary
      ) VALUES (
        (SELECT id FROM signal_refresh_policies WHERE id = $5::uuid),
        $6::uuid, $7, $1, $8, 'scheduled', $2, $9, $10, now(),
        $3, jsonb_build_object('message', $4)
      )
      ON CONFLICT (idempotency_key) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = now(),
        attempt = GREATEST(signal_refresh_runs.attempt, EXCLUDED.attempt),
        error_code = EXCLUDED.error_code,
        error_summary = EXCLUDED.error_summary,
        updated_at = now()
    `, [
      job.data.idempotency_key,
      finalAttempt ? "dead_letter" : "failed",
      safeErrorCode(error),
      safeErrorMessage(error),
      job.data.refresh_policy_id,
      job.data.workspace_id,
      job.data.source_key,
      job.id ?? null,
      job.attemptsMade + 1,
      job.data.scheduled_for
    ]).catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey]).catch(() => undefined);
    client.release();
  }
}

export async function signalInvalidationJob(job: Job<SignalInvalidationJobDataV1>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query<{
      id: string;
      workspace_id: string;
      study_corpus_id: string;
      source_key: string;
      affected_from: string | null;
      affected_through: string | null;
    }>(`
      UPDATE signal_data_invalidations
      SET status = 'processing', attempt = attempt + 1, error_summary = '{}'::jsonb
      WHERE id = $1::uuid
        AND status IN ('pending', 'failed')
        AND attempt < 3
      RETURNING id::text, workspace_id::text, study_corpus_id::text, source_key,
        affected_from::text, affected_through::text
    `, [job.data.invalidation_id]);
    const invalidation = claimed.rows[0];
    if (!invalidation) {
      await client.query("COMMIT");
      return { reconciliation_only: true };
    }

    const materializations = await client.query(`
      UPDATE metric_materializations materialization
      SET stale_after = LEAST(COALESCE(materialization.stale_after, now()), now())
      WHERE materialization.study_corpus_id = $1::uuid
        AND (
          materialization.period_id IS NULL
          OR EXISTS (
            SELECT 1 FROM report_periods period
            WHERE period.id = materialization.period_id
              AND ($2::date IS NULL OR period.period_end >= $2::date)
              AND ($3::date IS NULL OR period.period_start <= $3::date)
          )
        )
    `, [invalidation.study_corpus_id, invalidation.affected_from, invalidation.affected_through]);
    const interpretations = await client.query(`
      UPDATE signal_interpretation_freshness freshness
      SET state = 'stale', reason = 'data_watermark_advanced', updated_at = now()
      WHERE freshness.workspace_id = $1::uuid
        AND freshness.state <> 'not_available'
        AND (
          freshness.data_scope->'study_corpus_ids' ? $2
          OR freshness.data_scope->'source_keys' ? $3
        )
    `, [invalidation.workspace_id, invalidation.study_corpus_id, invalidation.source_key]);
    await client.query(`
      UPDATE signal_data_invalidations
      SET status = 'completed', processed_at = now(),
          scope = scope || jsonb_build_object(
            'materializations_invalidated', $2::int,
            'interpretations_invalidated', $3::int
          )
      WHERE id = $1::uuid
    `, [invalidation.id, materializations.rowCount ?? 0, interpretations.rowCount ?? 0]);
    await client.query("COMMIT");
    return {
      materializations_invalidated: materializations.rowCount ?? 0,
      interpretations_invalidated: interpretations.rowCount ?? 0
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
    await pool.query(`
      UPDATE signal_data_invalidations
      SET status = $2, error_summary = jsonb_build_object('message', $3)
      WHERE id = $1::uuid AND status <> 'completed'
    `, [job.data.invalidation_id, finalAttempt ? "dead_letter" : "failed", safeErrorMessage(error)]).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function resolveLatestAcceptedEvent(
  client: import("pg").PoolClient,
  policy: { adapter_key: string; study_corpus_id: string; data_source_id: string | null }
) {
  if (policy.adapter_key === "manual_import") {
    const result = await client.query<{ id: string }>(`
      SELECT id::text
      FROM import_batches
      WHERE study_corpus_id = $1::uuid AND status = 'completed'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [policy.study_corpus_id]);
    return result.rows[0] ? { importBatchId: result.rows[0].id, sourceSyncRunId: null } : null;
  }
  if (policy.adapter_key === "data_source_sync" && policy.data_source_id) {
    const result = await client.query<{ id: string }>(`
      SELECT id::text
      FROM source_sync_runs
      WHERE data_source_id = $1::uuid AND status = 'completed'
      ORDER BY finished_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT 1
    `, [policy.data_source_id]);
    return result.rows[0] ? { importBatchId: null, sourceSyncRunId: result.rows[0].id } : null;
  }
  throw new Error("refresh_adapter_not_available");
}

async function completeSkipped(
  client: import("pg").PoolClient,
  job: Job<SignalRefreshRunJobDataV1>,
  reason: string
) {
  await client.query(`
    INSERT INTO signal_refresh_runs (
      refresh_policy_id, workspace_id, source_key, idempotency_key,
      bullmq_job_id, trigger, status, attempt, scheduled_for, completed_at, result_summary
    ) VALUES ((SELECT id FROM signal_refresh_policies WHERE id = $1::uuid), $2::uuid, $3, $4, $5, 'scheduled', 'skipped', $6, $7, now(), jsonb_build_object('reason', $8))
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [
    job.data.refresh_policy_id,
    job.data.workspace_id,
    job.data.source_key,
    job.data.idempotency_key,
    job.id ?? null,
    job.attemptsMade + 1,
    job.data.scheduled_for,
    reason
  ]);
  return { status: "skipped", reason };
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "refresh_lock_unavailable") return message;
  if (message === "refresh_adapter_not_available") return message;
  return "refresh_failed";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/\S+/giu, "[redacted-database-url]").slice(0, 500);
}
