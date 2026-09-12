import type { Pool, PoolClient } from 'pg';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';

export type SignalTopicConsolidationControlDatabaseV1 = Pick<Pool, 'connect'>;
export class SignalTopicConsolidationControlError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'SignalTopicConsolidationControlError'; }
}
export type SignalTopicConsolidationExecutionLeaseV1 = {
  execution_id: string; workspace_id: string; actor_user_id: string; source_execution_id: string;
  execution_token: string; worker_job_id: string;
};
export type SignalTopicConsolidationDispatchV1 = {
  dispatch_id: string; execution_id: string; workspace_id: string; worker_job_id: string;
  lease_token: string; attempt: number;
};
export type SignalTopicConsolidationRequestResultV1 = { execution_id: string; replayed: boolean; worker_job_id: string };
export type SignalTopicConsolidationStatusV1 = {
  contract_version: 'signal-topic-consolidation-status-v1'; workspace_id: string;
  status: 'access_required' | 'source_required' | 'source_stale' | 'policy_required' | 'policy_action_required'
    | 'policy_expired' | 'budget_unavailable' | 'ready_to_prepare' | 'queued' | 'running' | 'ready' | 'failed';
  can_request: boolean; provider_execution_enabled: false; maximum_micro_usd: string;
  confirmed_micro_usd: '0'; reserved_micro_usd: '0'; expected_group_count: number | null; group_count: number;
  source_execution_id: string | null; quote_reference: string | null; quote_expires_at: string | null;
  execution: null | { execution_id: string; status: 'queued' | 'running' | 'ready' | 'failed'; retry_available: boolean; error_code: string | null };
};
type Database = SignalTopicConsolidationControlDatabaseV1;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const key = /^[A-Za-z0-9._:-]{8,200}$/u;
const fail = (code: string, status = 409): never => { throw new SignalTopicConsolidationControlError(code, status); };
const scope = (workspace: string, actor: string) => { if (!uuid.test(workspace) || !uuid.test(actor)) fail('topic_consolidation_scope_invalid', 422); };
const errorCode = (value: string) => /^signal_topic_consolidation_[a-z_]{1,100}$/u.test(value)
  || /^topic_consolidation_[a-z_]{1,100}$/u.test(value) ? value : 'topic_consolidation_worker_failed';

async function tx<T>(database: Database, work: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await database.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const value = await work(client); await client.query('COMMIT'); return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error ? error.message : '';
    if (/^(?:topic_consolidation|processing)_[a-z_]{1,100}$/u.test(message))
      throw new SignalTopicConsolidationControlError(message, message === 'processing_forbidden' ? 403 : 409);
    throw error;
  } finally { client.release(); }
}
async function value<T>(client: PoolClient, sql: string, params: unknown[]): Promise<T> {
  const result = (await client.query<{ value: T }>(sql, params)).rows[0];
  if (!result) return fail('topic_consolidation_control_unavailable'); return result.value;
}

/** Read-only, redacted control state. An opaque quote is NOT a spending grant.
 * This release can only prepare numeric C2; no provider ledger or sender exists. */
export async function loadSignalTopicConsolidationStatusV1(args: {
  database: Database; workspace_id: string; actor_user_id: string; source_execution_id?: string;
}): Promise<SignalTopicConsolidationStatusV1> {
  scope(args.workspace_id, args.actor_user_id);
  if (args.source_execution_id !== undefined && !uuid.test(args.source_execution_id)) fail('topic_consolidation_scope_invalid', 422);
  return tx(args.database, async client => {
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
    if (!capabilities.can_view) return fail('processing_forbidden', 403);
    return value(client, 'SELECT signal_topic_consolidation_status_v1($1::uuid,$2::uuid,$3::uuid) value',
      [args.workspace_id, args.actor_user_id, args.source_execution_id ?? null]);
  }, true);
}

export async function requestSignalTopicConsolidationV1(args: {
  database: Database; workspace_id: string; actor_user_id: string; source_execution_id: string;
  idempotency_key: string; quote_reference: string;
}): Promise<SignalTopicConsolidationRequestResultV1> {
  scope(args.workspace_id, args.actor_user_id);
  if (!uuid.test(args.source_execution_id) || !key.test(args.idempotency_key)
    || !/^v1\.[0-9]{10}\.[0-9a-f]{64}$/u.test(args.quote_reference)) fail('topic_consolidation_request_invalid', 422);
  return tx(args.database, client => value(client,
    'SELECT request_signal_topic_consolidation_v1($1::uuid,$2::uuid,$3::uuid,$4,$5) value',
    [args.workspace_id,args.actor_user_id,args.source_execution_id,args.idempotency_key,args.quote_reference]));
}
export async function retrySignalTopicConsolidationV1(args: {
  database: Database; workspace_id: string; actor_user_id: string; execution_id: string; idempotency_key: string;
}): Promise<SignalTopicConsolidationRequestResultV1> {
  scope(args.workspace_id,args.actor_user_id);
  if (!uuid.test(args.execution_id) || !key.test(args.idempotency_key)) fail('topic_consolidation_request_invalid',422);
  return tx(args.database, client => value(client,
    'SELECT retry_signal_topic_consolidation_v1($1::uuid,$2::uuid,$3::uuid,$4) value',
    [args.workspace_id,args.actor_user_id,args.execution_id,args.idempotency_key]));
}
export async function claimSignalTopicConsolidationDispatchV1(args: {
  database: Database; worker_id: string; limit?: number; lease_seconds?: number;
}): Promise<SignalTopicConsolidationDispatchV1[]> {
  if (!key.test(args.worker_id)) fail('topic_consolidation_worker_invalid',422);
  return tx(args.database, client => value(client,
    'SELECT claim_signal_topic_consolidation_dispatch_v1($1,$2::integer,$3::integer) value',
    [args.worker_id,args.limit ?? 10,args.lease_seconds ?? 30]));
}
export async function acknowledgeSignalTopicConsolidationDispatchV1(args: { database: Database; dispatch_id: string; lease_token: string }): Promise<boolean> {
  return tx(args.database, client => value(client,
    'SELECT acknowledge_signal_topic_consolidation_dispatch_v1($1::uuid,$2::uuid) value',[args.dispatch_id,args.lease_token]));
}
export async function failSignalTopicConsolidationDispatchV1(args: { database: Database; dispatch_id: string; lease_token: string; error_code: string }): Promise<boolean> {
  return tx(args.database, client => value(client,
    'SELECT fail_signal_topic_consolidation_dispatch_v1($1::uuid,$2::uuid,$3) value',[args.dispatch_id,args.lease_token,errorCode(args.error_code)]));
}
export async function claimSignalTopicConsolidationExecutionV1(args: {
  database: Database; execution_id: string; worker_job_id: string; lease_seconds?: number;
}): Promise<SignalTopicConsolidationExecutionLeaseV1 | { completed: true; execution_id: string } | null> {
  return tx(args.database, client => value(client,
    'SELECT claim_signal_topic_consolidation_execution_v1($1::uuid,$2,$3::integer) value',
    [args.execution_id,args.worker_job_id,args.lease_seconds ?? 180]));
}
export async function heartbeatSignalTopicConsolidationExecutionV1(args: { database: Database; lease: SignalTopicConsolidationExecutionLeaseV1 }): Promise<boolean> {
  return tx(args.database, client => value(client,
    'SELECT heartbeat_signal_topic_consolidation_execution_v1($1::uuid,$2::uuid) value',[args.lease.execution_id,args.lease.execution_token]));
}
export async function completeSignalTopicConsolidationExecutionV1(args: {
  database: Database; lease: SignalTopicConsolidationExecutionLeaseV1; consolidation_run_id: string;
}): Promise<boolean> {
  return tx(args.database, client => value(client,
    'SELECT complete_signal_topic_consolidation_execution_v1($1::uuid,$2::uuid,$3::uuid) value',
    [args.lease.execution_id,args.lease.execution_token,args.consolidation_run_id]));
}
export async function failSignalTopicConsolidationExecutionV1(args: {
  database: Database; lease: SignalTopicConsolidationExecutionLeaseV1; error_code: string;
}): Promise<boolean> {
  return tx(args.database, client => value(client,
    'SELECT fail_signal_topic_consolidation_execution_v1($1::uuid,$2::uuid,$3) value',
    [args.lease.execution_id,args.lease.execution_token,errorCode(args.error_code)]));
}
export async function recoverSignalTopicConsolidationExecutionsV1(args: { database: Database; limit?: number }): Promise<number> {
  return tx(args.database, client => value(client,
    'SELECT recover_signal_topic_consolidation_executions_v1($1::integer) value',[args.limit ?? 20]));
}
