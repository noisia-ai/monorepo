import type { Job } from "bullmq";
import type { SignalWorkspaceClassificationDatabaseV1 } from "@noisia/db";
import { materializeSignalWorkspaceInterestDecisionV1 } from "./signal-workspace-interest-decision-materialization-v1";

export const SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1 = "signal-workspace-interest-decision-materialization-v1";
type Environment = Readonly<Record<string,string | undefined>>;
type Database = SignalWorkspaceClassificationDatabaseV1;
type Queue = {
  getJob(id: string): Promise<{ name: string; getState(): Promise<string>;
    retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { execution_id: string }, options: Record<string,unknown>): Promise<unknown>;
};
type Options = { env?: Environment; database?: Database; queue?: Queue };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const jobIdFor = (executionId: string) => `workspace-classification-${executionId}`;
const fail = (code: string): never => { throw new Error(`workspace_interest_materialization_runtime_${code}`); };

export function signalWorkspaceInterestDecisionMaterializationEnabledV1(env: Environment = process.env) {
  return env.NOISIA_SIGNAL_INTEREST_DECISION_MATERIALIZATION_ENABLED === "true";
}

export async function signalWorkspaceInterestDecisionMaterializationSchemaReadyV1(database: Database) {
  const result = await database.query<{ ready: boolean }>(`SELECT
    to_regclass('public.signal_interest_decision_owners_v1') IS NOT NULL
    AND to_regclass('public.signal_interest_decision_root_evidence_v1') IS NOT NULL
    AND to_regclass('public.signal_interest_decision_calls_v1') IS NOT NULL
    AND to_regclass('public.signal_classification_generation_items') IS NOT NULL
    AND to_regprocedure('public.signal_interest_decision_source_current_v1(uuid,uuid)') IS NOT NULL
    AS ready`);
  return result.rows[0]?.ready === true;
}

/** PostgreSQL owner + execution status is the durable dispatch ledger. A
 * completed BullMQ job is retried only while its SQL cursor is still open. */
export async function drainSignalWorkspaceInterestDecisionMaterializationsV1(options: Options = {}) {
  if (!signalWorkspaceInterestDecisionMaterializationEnabledV1(options.env))
    return { disabled: true, schema_ready: false, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionMaterializationSchemaReadyV1(database))
    return { disabled: false, schema_ready: false, dispatched: 0 };
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const rows = (await database.query<{ execution_id: string }>(`SELECT execution.id::text execution_id
    FROM signal_interest_decision_owners_v1 owner
    JOIN signal_classification_generations generation ON generation.id=owner.generation_id
    JOIN signal_topic_catalog_executions execution ON execution.generation_id=generation.id
    JOIN signal_topic_catalog_executions source ON source.id=owner.source_execution_id
      AND source.workspace_id=owner.workspace_id
    WHERE owner.status='completed' AND owner.completed_at IS NOT NULL AND owner.manifest_complete
      AND owner.workspace_id=execution.workspace_id AND owner.expected_roots=execution.denominator
      AND generation.status='open' AND generation.input_contract='workspace-topic-classification-v1'
      AND generation.input_snapshot->>'interest_term_key'=owner.term_key
      AND execution.input_contract='workspace-topic-classification-v1'
      AND source.input_contract='workspace-topic-computation-v1' AND source.status='ready'
      AND source.processed_roots=source.denominator AND source.processed_chunks=source.expected_chunks
      AND source.preparation_run_id=generation.preparation_run_id
      AND source.embedding_run_id=generation.embedding_run_id
      AND source.taxonomy_profile_id=generation.taxonomy_profile_id
      AND source.input_revision=generation.input_revision
      AND source.input_snapshot->>'context_digest'=generation.input_snapshot->>'context_digest'
      AND (source.policy_valid_until IS NULL OR source.policy_valid_until>clock_timestamp())
      AND (execution.status='queued' OR execution.status='running'
        AND (execution.execution_expires_at IS NULL OR execution.execution_expires_at<=clock_timestamp()))
    ORDER BY owner.completed_at,execution.id LIMIT 10`)).rows;
  let dispatched = 0;
  for (const row of rows) {
    if (!uuid.test(row.execution_id)) return fail("execution_id_invalid");
    const jobId = jobIdFor(row.execution_id);
    const existing = await queue.getJob(jobId);
    if (existing) {
      if (existing.name !== SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1)
        return fail("job_name_conflict");
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.retry(state);
    } else await queue.add(SIGNAL_WORKSPACE_INTEREST_DECISION_MATERIALIZATION_JOB_V1,
      { execution_id: row.execution_id }, { jobId, attempts: 1,
        removeOnComplete: true, removeOnFail: { age: 604800, count: 500 } });
    dispatched++;
  }
  return { disabled: false, schema_ready: true, dispatched };
}

export function startSignalWorkspaceInterestDecisionMaterializationDrainerV1(options: Options & {
  interval_ms?: number; run_immediately?: boolean;
} = {}) {
  const enabled = signalWorkspaceInterestDecisionMaterializationEnabledV1(options.env);
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= drainSignalWorkspaceInterestDecisionMaterializationsV1(options).catch(() => {
      console.warn("workspace_interest_materialization_dispatch_failed");
    }).finally(() => { pending = null; });
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 5000) : null;
  timer?.unref?.();
  if (enabled && options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}

export async function signalWorkspaceInterestDecisionMaterializationJobV1(
  job: Pick<Job<{ execution_id: string }>, "id" | "data">,
  options: { env?: Environment; database?: Database } = {},
) {
  if (!signalWorkspaceInterestDecisionMaterializationEnabledV1(options.env)) return { disabled: true };
  const executionId = job.data?.execution_id;
  if (typeof executionId !== "string" || !uuid.test(executionId) || job.id !== jobIdFor(executionId))
    return fail("job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionMaterializationSchemaReadyV1(database))
    return fail("schema_unavailable");
  const result = await materializeSignalWorkspaceInterestDecisionV1({ database,
    execution_id: executionId, worker_job_id: job.id });
  return { disabled: false, result };
}
