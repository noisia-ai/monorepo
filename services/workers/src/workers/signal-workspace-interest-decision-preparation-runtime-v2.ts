import type { Job } from "bullmq";
import type { Pool } from "pg";
import { prepareSignalWorkspaceInterestDecisionWithDatabaseV2 } from "./signal-workspace-interest-decision-preparation-store-v2";

export const SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V2 = "signal-workspace-interest-decision-preparation-v2";
type Environment = Readonly<Record<string, string | undefined>>;
type Database = Pick<Pool, "connect">;
type Queue = {
  getJob(id: string): Promise<{ getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { owner_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
type Identity = { owner_id: string; workspace_id: string; actor_user_id: string;
  generation_id: string; source_execution_id: string };
type Options = { env?: Environment; database?: Database; queue?: Queue };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const jobIdFor = (ownerId: string) => `interest-decision-preparation-v2-${ownerId}`;
const fail = (code: string): never => { throw new Error(`workspace_interest_preparation_runtime_${code}`); };

export function signalWorkspaceInterestDecisionPreparationEnabledV2(env: Environment = process.env) {
  return env.NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED === "true"
    && env.NOISIA_SIGNAL_INTEREST_DECISION_PREPARATION_ENABLED === "true";
}

export async function signalWorkspaceInterestDecisionPreparationSchemaReadyV2(database: Database): Promise<boolean> {
  const client = await database.connect();
  try {
    const result = await client.query<{ ready: boolean }>(`SELECT
      to_regclass('public.signal_interest_decision_owners_v1') IS NOT NULL
      AND to_regclass('public.signal_interest_decision_pages_v1') IS NOT NULL
      AND to_regclass('public.signal_interest_decision_batches_v1') IS NOT NULL
      AND to_regprocedure('public.request_signal_interest_decision_v2(uuid,uuid,uuid,uuid,text)') IS NOT NULL
      AND to_regprocedure('public.append_signal_interest_decision_page_v2(uuid,jsonb,text,text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.prepare_signal_interest_decision_batch_v2(uuid,uuid,text[],text)') IS NOT NULL
      AS ready`);
    return result.rows[0]?.ready === true;
  } finally { client.release(); }
}

async function readOwners(database: Database): Promise<Identity[]> {
  const client = await database.connect();
  try {
    const result = await client.query<Identity>(`SELECT o.id::text owner_id,o.workspace_id::text,
      o.actor_user_id::text,o.generation_id::text,o.source_execution_id::text
      FROM signal_interest_decision_owners_v1 o
      WHERE o.provider_contract_version=2
        AND (o.status='open' AND NOT o.manifest_complete
        OR o.status='ready' AND o.manifest_complete AND EXISTS (
          SELECT 1 FROM signal_interest_decision_pages_v1 p
          WHERE p.owner_id=o.id AND NOT EXISTS (
            SELECT 1 FROM signal_interest_decision_batches_v1 b
            WHERE b.owner_id=o.id AND b.page_id=p.id
              AND b.submission_key='interest-decision-page:'||p.id::text)))
        AND signal_interest_decision_source_current_v2(o.generation_id,o.source_execution_id)
      ORDER BY o.created_at,o.id LIMIT 100`);
    return result.rows;
  } finally { client.release(); }
}

/** Redis carries one owner ID; PostgreSQL owns the cursor and all money state. */
export async function drainSignalWorkspaceInterestDecisionPreparationsV2(options: Options = {}) {
  if (!signalWorkspaceInterestDecisionPreparationEnabledV2(options.env))
    return { disabled: true, schema_ready: false, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionPreparationSchemaReadyV2(database))
    return { disabled: false, schema_ready: false, dispatched: 0 };
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const owners = await readOwners(database);
  let dispatched = 0;
  for (const owner of owners) {
    if (dispatched === 10) break;
    if (![owner.owner_id, owner.workspace_id, owner.actor_user_id,
      owner.generation_id, owner.source_execution_id].every(value => uuid.test(value))) fail("owner_invalid");
    const jobId = jobIdFor(owner.owner_id);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== "completed" && state !== "failed") continue;
      await existing.retry(state);
    } else await queue.add(SIGNAL_WORKSPACE_INTEREST_DECISION_PREPARATION_JOB_V2,
      { owner_id: owner.owner_id }, { jobId, attempts: 3,
        backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true,
        removeOnFail: { age: 604800, count: 500 } });
    dispatched++;
  }
  return { disabled: false, schema_ready: true, dispatched };
}

export function startSignalWorkspaceInterestDecisionPreparationDrainerV2(options: Options & {
  interval_ms?: number; run_immediately?: boolean;
} = {}) {
  const enabled = signalWorkspaceInterestDecisionPreparationEnabledV2(options.env);
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= drainSignalWorkspaceInterestDecisionPreparationsV2(options).catch(() => {
      console.warn("workspace_interest_preparation_dispatch_failed");
    }).finally(() => { pending = null; });
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 5000) : null;
  timer?.unref?.();
  if (enabled && options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}

export async function signalWorkspaceInterestDecisionPreparationJobV2(
  job: Pick<Job<{ owner_id: string }>, "id" | "data">,
  options: { env?: Environment; database?: Database;
    prepare?: typeof prepareSignalWorkspaceInterestDecisionWithDatabaseV2 } = {},
) {
  if (!signalWorkspaceInterestDecisionPreparationEnabledV2(options.env)) return { disabled: true };
  const ownerId = job.data?.owner_id;
  if (typeof ownerId !== "string" || !uuid.test(ownerId) || job.id !== jobIdFor(ownerId))
    return fail("job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionPreparationSchemaReadyV2(database)) return fail("schema_unavailable");
  const client = await database.connect();
  let owner: Identity | undefined;
  try {
    owner = (await client.query<Identity>(`SELECT id::text owner_id,workspace_id::text,
      actor_user_id::text,generation_id::text,source_execution_id::text
      FROM signal_interest_decision_owners_v1 WHERE id=$1::uuid AND provider_contract_version=2`, [ownerId])).rows[0];
  } finally { client.release(); }
  const verifiedOwner = owner ?? fail("owner_invalid");
  if (verifiedOwner.owner_id !== ownerId || ![verifiedOwner.workspace_id, verifiedOwner.actor_user_id,
    verifiedOwner.generation_id, verifiedOwner.source_execution_id].every(value => uuid.test(value))) fail("owner_invalid");
  const result = await (options.prepare ?? prepareSignalWorkspaceInterestDecisionWithDatabaseV2)({
    database, ...verifiedOwner, max_pages: 8, max_batches: 8 });
  return { disabled: false, result };
}
