import { createHash } from "node:crypto";
import type { Pool } from "pg";

type Database = Pick<Pool, "connect">;
type Environment = Readonly<Record<string, string | undefined>>;
type Candidate = { owner_id: string; actor_user_id: string; page_id: string;
  request_digest: string; prior_call_id: string; attempt_index: number;
  batch_state: string; batch_error_code: string | null; call_status: string;
  outcome: string | null; validation_status: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const fail = (code: string): never => { throw new Error(`workspace_interest_retry_v2_${code}`); };

export function signalWorkspaceInterestDecisionRetryEnabledV2(env: Environment = process.env) {
  return env.NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED === "true"
    && env.NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED === "true"
    && env.NOISIA_SIGNAL_INTEREST_DECISION_BATCH_PROVIDER_ENABLED === "true";
}

export async function signalWorkspaceInterestDecisionRetrySchemaReadyV2(database: Database) {
  const client = await database.connect();
  try {
    const result = await client.query<{ ready: boolean }>(`SELECT
      to_regprocedure('public.request_signal_interest_decision_v2(uuid,uuid,uuid,uuid,text)') IS NOT NULL
      AND to_regprocedure('public.renew_signal_interest_decision_admission_v2(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.prepare_signal_interest_decision_batch_v2(uuid,uuid,text[],text)') IS NOT NULL
      AS ready`);
    return result.rows[0]?.ready === true;
  } finally { client.release(); }
}

/** Only an applied failed item or a Batch proven absent by a complete provider
 * inventory may be retried. An explicit HTTP rejection remains paused for
 * operator diagnosis. SQL repeats the request/call checks under the owner lock. */
async function readCandidates(database: Database): Promise<Candidate[]> {
  const client = await database.connect();
  try {
    return (await client.query<Candidate>(`SELECT o.id::text owner_id,o.actor_user_id::text,
      r.page_id::text,r.request_digest,c.id::text prior_call_id,c.attempt_index,
      b.state batch_state,b.last_error_code batch_error_code,
      c.status call_status,c.outcome,c.validation_status
      FROM signal_interest_decision_requests_v1 r
      JOIN signal_interest_decision_owners_v1 o ON o.id=r.owner_id
      JOIN LATERAL (SELECT call.* FROM signal_interest_decision_calls_v1 call
        WHERE call.request_id=r.id ORDER BY call.attempt_index DESC LIMIT 1) c ON true
      JOIN signal_interest_decision_batches_v1 b ON b.id=c.batch_id
      WHERE o.provider_contract_version=2 AND r.provider_contract_version=2
        AND o.status='ready' AND o.manifest_complete
        AND c.attempt_index<5 AND (
          b.state='applied' AND c.status='settled'
            AND (c.outcome='errored' OR c.outcome='succeeded'
              AND c.validation_status IN ('invalid_output','refusal','max_tokens','invalid_message'))
          OR b.state='rejected' AND b.last_error_code='provider_inventory_absent'
            AND c.status='definitely_not_sent')
        AND NOT EXISTS (SELECT 1 FROM signal_interest_decision_root_evidence_v1 e
          WHERE e.request_id=r.id)
      ORDER BY o.created_at,r.page_id,r.request_index LIMIT 64`)).rows;
  } finally { client.release(); }
}

export async function drainSignalWorkspaceInterestDecisionRetriesV2(options: {
  env?: Environment; database?: Database;
} = {}) {
  if (!signalWorkspaceInterestDecisionRetryEnabledV2(options.env))
    return { disabled: true, schema_ready: false, prepared: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  if (!await signalWorkspaceInterestDecisionRetrySchemaReadyV2(database))
    return { disabled: false, schema_ready: false, prepared: 0 };
  const candidates = await readCandidates(database);
  const groups = new Map<string, Candidate[]>();
  for (const row of candidates) {
    if (![row.owner_id,row.actor_user_id,row.page_id,row.prior_call_id].every(value => uuid.test(value))
      || !digest.test(row.request_digest) || !Number.isSafeInteger(row.attempt_index)
      || row.attempt_index < 1 || row.attempt_index >= 5) fail("candidate_invalid");
    const settledFailure = row.batch_state === "applied" && row.call_status === "settled"
      && (row.outcome === "errored" || row.outcome === "succeeded"
        && ["invalid_output","refusal","max_tokens","invalid_message"].includes(row.validation_status ?? ""));
    const inventoryAbsent = row.batch_state === "rejected"
      && row.batch_error_code === "provider_inventory_absent"
      && row.call_status === "definitely_not_sent";
    if (!settledFailure && !inventoryAbsent)
      continue;
    const key = `${row.owner_id}:${row.page_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let prepared = 0;
  for (const rows of groups.values()) {
    const first = rows[0]!;
    if (rows.some(row => row.owner_id !== first.owner_id || row.page_id !== first.page_id
      || row.actor_user_id !== first.actor_user_id)
      || new Set(rows.map(row => row.request_digest)).size !== rows.length) fail("group_invalid");
    const retryIdentity = rows.map(row => `${row.request_digest}:${row.prior_call_id}`).sort().join("|");
    const keyDigest = createHash("sha256").update(retryIdentity).digest("hex").slice(0, 32);
    const submissionKey = `interest-decision-retry:${first.page_id}:${keyDigest}`;
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path=public,extensions,pg_temp");
      const renewal = (await client.query<{ result: { admission_id?: string } }>(
        `SELECT renew_signal_interest_decision_admission_v2($1::uuid,$2::uuid) result`,
        [first.owner_id,first.actor_user_id])).rows[0]?.result;
      if (!renewal || !uuid.test(String(renewal.admission_id))) fail("renewal_invalid");
      const result = (await client.query<{ result: { batch_id?: string; replayed?: boolean } }>(
        `SELECT prepare_signal_interest_decision_batch_v2($1::uuid,$2::uuid,$3::text[],$4::text) result`,
        [first.owner_id,first.page_id,rows.map(row => row.request_digest),submissionKey])).rows[0]?.result;
      if (!result || !uuid.test(String(result.batch_id)) || typeof result.replayed !== "boolean")
        fail("prepare_receipt_invalid");
      const receipt = result ?? fail("prepare_receipt_invalid");
      await client.query("COMMIT");
      if (!receipt.replayed) prepared++;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  return { disabled: false, schema_ready: true, prepared };
}

export function startSignalWorkspaceInterestDecisionRetryDrainerV2(options: {
  env?: Environment; database?: Database; interval_ms?: number; run_immediately?: boolean;
} = {}) {
  const enabled = signalWorkspaceInterestDecisionRetryEnabledV2(options.env);
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= drainSignalWorkspaceInterestDecisionRetriesV2(options).catch(() => {
      console.warn("workspace_interest_retry_v2_dispatch_failed");
    }).finally(() => { pending = null; });
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 30_000) : null;
  timer?.unref?.();
  if (enabled && options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}
