import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "bullmq";
import { createSignalWorkspaceInterestDecisionBatchStoresV1 } from "@noisia/db";
import { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { runSignalWorkspaceInterestDecisionBatchTickV1,
  SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V1,
  type SignalWorkspaceInterestDecisionBatchStoresV1 } from "./signal-workspace-interest-decision-queue-v1";

type Environment = Readonly<Record<string, string | undefined>>;
type Database = Parameters<typeof createSignalWorkspaceInterestDecisionBatchStoresV1>[0]["database"];
type Queue = {
  getJob(id: string): Promise<{ getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { batch_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
type Options = { env?: Environment; database?: Database; queue?: Queue };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const jobIdFor = (batchId: string) => `interest-decision-batch-v1-${batchId}`;
const fail = (code: string): never => { throw new Error(`workspace_interest_batch_runtime_${code}`); };

export function signalWorkspaceInterestDecisionRuntimeConfigurationV1(env: Environment = process.env) {
  const enabled = env.NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED === "true";
  return { enabled, provider_enabled: enabled && env.NOISIA_SIGNAL_INTEREST_DECISION_BATCH_PROVIDER_ENABLED === "true" };
}

/** Do not wake a paid job against an unapplied or partially applied SQL0211/0214. */
export async function signalWorkspaceInterestDecisionSchemaReadyV1(database: Database): Promise<boolean> {
  const client = await database.connect();
  try {
    const result = await client.query<{ ready: boolean }>(`SELECT
      to_regclass('public.signal_interest_decision_batches_v1') IS NOT NULL
      AND to_regclass('public.signal_interest_decision_calls_v1') IS NOT NULL
      AND to_regclass('public.signal_interest_decision_requests_v1') IS NOT NULL
      AND to_regclass('public.signal_interest_decision_pages_v1') IS NOT NULL
      AND to_regprocedure('public.claim_signal_interest_decision_batch_v1(uuid,integer)') IS NOT NULL
      AND to_regprocedure('public.release_signal_interest_decision_batch_v1(uuid,uuid,timestamp with time zone,text)') IS NOT NULL
      AND to_regprocedure('public.mark_submitting_signal_interest_decision_batch_v1(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.attach_provider_signal_interest_decision_batch_v1(uuid,uuid,text,text)') IS NOT NULL
      AND to_regprocedure('public.poll_signal_interest_decision_batch_v1(uuid,uuid,text,text,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.quarantine_signal_interest_decision_batch_v1(uuid,uuid,text,text,text)') IS NOT NULL
      AND to_regprocedure('public.reject_signal_interest_decision_batch_v1(uuid,uuid,integer,text,text)') IS NOT NULL
      AND to_regprocedure('public.persist_signal_interest_decision_item_v1(uuid,uuid,text,text,text,text)') IS NOT NULL
      AND to_regprocedure('public.apply_signal_interest_decision_item_v1(uuid)') IS NOT NULL
      AND to_regprocedure('public.finish_signal_interest_decision_batch_v1(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.renew_signal_interest_decision_admission_v1(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.rollover_prepared_signal_interest_decision_batch_v1(uuid,uuid,uuid)') IS NOT NULL AS ready`);
    return result.rows[0]?.ready === true;
  } finally { client.release(); }
}

/** The existing private workspace-engine store owns object bytes and replay.
 * The database adapter checks this exact key again before settlement. */
export function createSignalWorkspaceInterestDecisionRuntimeStoresV1(options: {
  database: Database; storage?: WorkspaceEngineStorageV1;
  create_storage?: () => WorkspaceEngineStorageV1; temporary_root?: string;
  batch_stores?: SignalWorkspaceInterestDecisionBatchStoresV1;
}): SignalWorkspaceInterestDecisionBatchStoresV1 {
  let storage = options.storage;
  const getStorage = () => storage ??= (options.create_storage ?? createWorkspaceEngineStorageV1)();
  const db = createSignalWorkspaceInterestDecisionBatchStoresV1({ database: options.database,
    storeRawReceipt: async ({ workspace_id, owner_id, batch_id, call_id, raw_text, raw_sha256 }) => {
      if (![workspace_id, owner_id, batch_id, call_id].every(value => uuid.test(value))
        || !digest.test(raw_sha256) || sha(raw_text) !== raw_sha256
        || Buffer.byteLength(raw_text, "utf8") > 8 * 1024 * 1024) return fail("receipt_invalid");
      const filename = `interest-decision-${batch_id}-${call_id}.json`;
      const directory = await mkdtemp(join(options.temporary_root ?? tmpdir(), "noisia-interest-decision-"));
      try {
        const file = join(directory, filename);
        const size = Buffer.byteLength(raw_text, "utf8");
        await writeFile(file, raw_text, { mode: 0o600, flag: "wx" });
        const stored = await getStorage().put({ workspace_id, execution_id: owner_id,
          file, sha256: raw_sha256, size_bytes: size, media_type: "application/json" });
        const expected = `workspace-engine/${workspace_id}/${owner_id}/${filename}.${raw_sha256.slice(7)}.parts.json`;
        if (stored.storage_key !== expected || stored.sha256 !== raw_sha256
          || stored.size_bytes !== size || stored.media_type !== "application/json") return fail("receipt_storage_invalid");
        return stored.storage_key;
      } finally { await rm(directory, { recursive: true, force: true }); }
    } });
  // SQL returns the sealed manifest as JSON. The worker validates the full page
  // before provider I/O; the DB adapter validates it independently at claim.
  const stores = options.batch_stores ?? db as unknown as SignalWorkspaceInterestDecisionBatchStoresV1;
  return { ...stores, async claimDue(batch_id) {
    const lease = await stores.claimDue(batch_id);
    if (!lease || lease.state !== "prepared") return lease;
    const client = await options.database.connect();
    try {
      const preflight = (await client.query<{ owner_id: string; actor_user_id: string; prior_day: boolean }>(`SELECT
        owner.id::text owner_id,owner.actor_user_id::text actor_user_id,
        admission.budget_date<(clock_timestamp() AT TIME ZONE admission.budget_timezone)::date prior_day
        FROM signal_interest_decision_batches_v1 batch
        JOIN signal_interest_decision_owners_v1 owner ON owner.id=batch.owner_id
        JOIN signal_processing_admissions admission ON admission.id=batch.admission_id
        WHERE batch.id=$1::uuid AND batch.lease_token=$2::uuid
          AND batch.state='prepared' AND batch.lease_expires_at>clock_timestamp()`,
      [lease.batch_id, lease.lease_token])).rows[0];
      if (!preflight || !uuid.test(preflight.owner_id) || !uuid.test(preflight.actor_user_id)
        || typeof preflight.prior_day !== "boolean") return fail("rollover_preflight_unavailable");
      if (!preflight.prior_day) return lease;
      // SQL0211 refuses renewal when the policy/source is no longer current.
      // A failed renewal leaves the old prepared lease untouched for inspection;
      // neither it nor a subsequent SQL0214 error may authorize a provider POST.
      const renewal = (await client.query<{ result: { admission_id?: string; replayed?: boolean } }>(
        `SELECT renew_signal_interest_decision_admission_v1($1::uuid,$2::uuid) result`,
        [preflight.owner_id, preflight.actor_user_id])).rows[0]?.result;
      if (!renewal || !uuid.test(String(renewal.admission_id)) || typeof renewal.replayed !== "boolean")
        return fail("renewal_receipt_invalid");
      const result = (await client.query<{ result: { batch_id?: string; expired_batch_id?: string;
        manifest_digest?: string; replayed?: boolean } }>(
        `SELECT rollover_prepared_signal_interest_decision_batch_v1($1::uuid,$2::uuid,$3::uuid) result`,
        [lease.batch_id, lease.lease_token, preflight.actor_user_id])).rows[0]?.result;
      if (!result || result.expired_batch_id !== lease.batch_id
        || !uuid.test(String(result.batch_id)) || result.batch_id === lease.batch_id
        || result.manifest_digest !== lease.manifest.manifest_digest || typeof result.replayed !== "boolean")
        return fail("rollover_receipt_invalid");
      // SQL0214 clears the old lease and creates a new prepared Batch. The next
      // drainer pass dispatches its new ID; this job must never POST the old ID.
      return null;
    } finally { client.release(); }
  }, async reserveAndMarkSubmitting(lease) {
    await getStorage().assertReady?.();
    // SQL0211 binds a prepared batch to its original admission. A new owner-day
    // admission cannot move that batch or its reserved calls across midnight.
    // Stop before provider I/O and let the durable batch remain inspectable.
    const client = await options.database.connect();
    try {
      const row = (await client.query<{ admission_current: boolean; policy_current: boolean }>(`SELECT
        a.budget_date=(clock_timestamp() AT TIME ZONE a.budget_timezone)::date
          AND a.admission_not_after>clock_timestamp() admission_current,
        p.status='active' AND p.valid_from<=clock_timestamp()
          AND p.valid_until>clock_timestamp() policy_current
        FROM signal_interest_decision_batches_v1 batch
        JOIN signal_processing_admissions a ON a.id=batch.admission_id
        JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
        WHERE batch.id=$1::uuid AND batch.lease_token=$2::uuid
          AND batch.lease_expires_at>clock_timestamp()`,
      [lease.batch_id, lease.lease_token])).rows[0];
      if (!row) return fail("admission_unavailable");
      if (!row.policy_current) return fail("policy_expired_or_changed");
      if (!row.admission_current) return fail("admission_expired");
    } finally { client.release(); }
    await stores.reserveAndMarkSubmitting(lease);
  } };
}

/** Postgres is the scheduler. Redis jobs carry only immutable batch identity. */
export async function drainSignalWorkspaceInterestDecisionBatchesV1(options: Options = {}) {
  const flags = signalWorkspaceInterestDecisionRuntimeConfigurationV1(options.env);
  if (!flags.enabled || !flags.provider_enabled) return { disabled: true, schema_ready: false, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionSchemaReadyV1(database))
    return { disabled: false, schema_ready: false, dispatched: 0 };
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const client = await database.connect();
  let ids: string[];
  try {
    const result = await client.query<{ id: string }>(`SELECT id::text FROM signal_interest_decision_batches_v1
      WHERE state IN ('prepared','submitting','in_progress','canceling','ended')
        AND next_poll_at <= clock_timestamp()
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      ORDER BY next_poll_at,id LIMIT 10`);
    ids = result.rows.map(row => row.id);
  } finally { client.release(); }
  let dispatched = 0;
  for (const batch_id of ids) {
    if (!uuid.test(batch_id)) return fail("batch_id_invalid");
    const jobId = jobIdFor(batch_id);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.retry(state);
    } else await queue.add(SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V1, { batch_id }, {
      jobId, attempts: 3, backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true, removeOnFail: { age: 604800, count: 500 },
    });
    dispatched++;
  }
  return { disabled: false, schema_ready: true, dispatched };
}

export function startSignalWorkspaceInterestDecisionBatchDrainerV1(options: Options & {
  interval_ms?: number; run_immediately?: boolean;
} = {}) {
  const enabled = signalWorkspaceInterestDecisionRuntimeConfigurationV1(options.env).provider_enabled;
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= drainSignalWorkspaceInterestDecisionBatchesV1(options).catch(() => {
      console.warn("workspace_interest_batch_runtime_dispatch_failed");
    }).finally(() => { pending = null; });
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 5000) : null;
  timer?.unref?.();
  if (enabled && options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}

export async function signalWorkspaceInterestDecisionBatchJobV1(
  job: Pick<Job<{ batch_id: string }>, "id" | "data">,
  options: { env?: Environment; database?: Database; storage?: WorkspaceEngineStorageV1;
    create_storage?: () => WorkspaceEngineStorageV1; fetch?: typeof globalThis.fetch } = {},
) {
  const flags = signalWorkspaceInterestDecisionRuntimeConfigurationV1(options.env);
  if (!flags.enabled || !flags.provider_enabled) return { disabled: true };
  const batchId = job.data?.batch_id;
  if (typeof batchId !== "string" || !uuid.test(batchId) || job.id !== jobIdFor(batchId))
    return fail("job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionSchemaReadyV1(database)) return fail("schema_unavailable");
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({ database,
    storage: options.storage, create_storage: options.create_storage });
  const provider = createAnthropicMessageBatchesClient({
    apiKey: (options.env ?? process.env).ANTHROPIC_API_KEY ?? "", fetch: options.fetch });
  const result = await runSignalWorkspaceInterestDecisionBatchTickV1({ stores, provider, batch_id: batchId });
  return { disabled: false, result };
}
