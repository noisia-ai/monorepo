import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SignalTopicEditorialStoreError, type SignalTopicEditorialDatabaseV1, type SignalTopicEditorialLeaseV1 } from './signal-topic-consolidation-editorial';
type Scope = { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1 };
export type SignalTopicEditorialRecoveredCallStoreV1 = {
  call_id: string; attempt_token: string; request_digest: string; request_body: string;
  status: 'reserved' | 'in_flight' | 'response_persisted' | 'settled' | 'definitely_not_sent' | 'outcome_unknown';
  reserved_micro_usd: string; settled_micro_usd: string | null;
  response: null | { body: string; sha256: string; storage_key: string; http_status: number; complete: boolean; provider_request_id: string | null };
};
type Receipt = { request_digest: string; idempotency_key: string; bytes: Uint8Array; sha256: string;
  http_status: number; complete: boolean; provider_request_id: string | null };
const fail = (code: string): never => { throw new SignalTopicEditorialStoreError(code); };
const sha = (value: Uint8Array | string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const amount = /^(?:0|[1-9][0-9]*)$/u;
async function transaction<T>(database: SignalTopicEditorialDatabaseV1, readOnly: boolean, work: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query(`${readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'}; SET LOCAL search_path=public,extensions,pg_temp`);
    const result = await work(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function owner(client: PoolClient, lease: SignalTopicEditorialLeaseV1, live: boolean) {
  const row = (await client.query(`SELECT id FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2
    AND actor_user_id=$3 AND numeric_run_id=$4 AND source_engine_execution_id=$5`,
  [lease.execution_id, lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id])).rows[0];
  if (!row) fail('topic_editorial_lease_conflict');
  if (live) await client.query('SELECT signal_topic_editorial_assert_lease_v1($1,$2,false)', [lease.execution_id, lease.execution_token]);
}

/** Read the exact request's attempts without reserve, send, or current-source checks. */
export async function readSignalTopicEditorialRecoveryV1(args: Scope & { request_digest: string }): Promise<SignalTopicEditorialRecoveredCallStoreV1 | null> {
  return transaction(args.database, true, async client => {
    await owner(client, args.lease, true);
    const rows = (await client.query<{
      call_id: string; attempt_token: string; retry_of_call_id: string | null; request_digest: string; request_body: string;
      status: SignalTopicEditorialRecoveredCallStoreV1['status']; reserved_micro_usd: string; settled_micro_usd: string | null;
      response_body_private: string | null; response_sha256: string | null; response_storage_key: string | null;
      response_http_status: number | null; response_complete: boolean | null; response_provider_request_id: string | null;
    }>(`SELECT c.id call_id,c.attempt_token,c.retry_of_call_id,r.request_digest,r.request_body,c.status,
      c.reserved_micro_usd::text,c.settled_micro_usd::text,c.response_body_private,c.response_sha256,c.response_storage_key,
      c.response_http_status,c.response_complete,c.response_provider_request_id
      FROM signal_topic_editorial_requests r JOIN signal_topic_editorial_calls c ON c.request_id=r.id AND c.execution_id=r.execution_id
      WHERE r.execution_id=$1 AND r.workspace_id=$2 AND r.request_digest=$3
      ORDER BY c.reserved_at,c.id`, [args.lease.execution_id, args.lease.workspace_id, args.request_digest])).rows;
    if (rows.length === 0) return null;
    if (rows.length > 3) fail('topic_editorial_recovery_ambiguous');
    for (const [index, row] of rows.entries()) {
      if (row.request_digest !== args.request_digest || row.retry_of_call_id !== (rows[index - 1]?.call_id ?? null)
        || index < rows.length - 1 && row.status !== 'definitely_not_sent'
        || !amount.test(row.reserved_micro_usd) || row.settled_micro_usd !== null && !amount.test(row.settled_micro_usd))
        fail('topic_editorial_recovery_ambiguous');
    }
    const row = rows.at(-1)!;
    let response: SignalTopicEditorialRecoveredCallStoreV1['response'] = null;
    if (row.response_body_private !== null) {
      if (row.response_sha256 !== sha(row.response_body_private) || !row.response_storage_key
        || !Number.isInteger(row.response_http_status) || row.response_http_status! < 100 || row.response_http_status! > 599
        || typeof row.response_complete !== 'boolean'
        || row.response_provider_request_id !== null && !/^[A-Za-z0-9_.:-]{1,200}$/u.test(row.response_provider_request_id)
        || !['response_persisted', 'settled', 'outcome_unknown'].includes(row.status)) fail('topic_editorial_recovery_receipt_invalid');
      response = { body: row.response_body_private, sha256: row.response_sha256!, storage_key: row.response_storage_key!,
        http_status: row.response_http_status!, complete: row.response_complete!, provider_request_id: row.response_provider_request_id };
    } else if (row.response_sha256 !== null || row.response_storage_key !== null || row.response_http_status !== null
      || row.response_complete !== null || row.response_provider_request_id !== null || ['response_persisted', 'settled'].includes(row.status))
      fail('topic_editorial_recovery_receipt_invalid');
    if (row.status === 'settled' && (row.settled_micro_usd === null || BigInt(row.settled_micro_usd) > BigInt(row.reserved_micro_usd)
      || response?.http_status !== 200 || response.complete !== true)) fail('topic_editorial_recovery_settlement_invalid');
    return { call_id: row.call_id, attempt_token: row.attempt_token, request_digest: row.request_digest, request_body: row.request_body,
      status: row.status, reserved_micro_usd: row.reserved_micro_usd, settled_micro_usd: row.settled_micro_usd, response };
  });
}

/** A received response can be durably recorded after lease loss or revocation.
 * The immutable owner/request/attempt binding remains mandatory. */
export async function persistSignalTopicEditorialReceiptV1(args: Scope & { call_id: string; attempt_token: string; receipt: Receipt; storage_key: string }): Promise<void> {
  const receipt = args.receipt;
  if (receipt.bytes.byteLength > 8 * 1024 * 1024 || sha(receipt.bytes) !== receipt.sha256
    || !Number.isInteger(receipt.http_status) || receipt.http_status < 100 || receipt.http_status > 599
    || typeof receipt.complete !== 'boolean' || receipt.provider_request_id !== null && !/^[A-Za-z0-9_.:-]{1,200}$/u.test(receipt.provider_request_id))
    fail('topic_editorial_receipt_invalid');
  let body: string;
  try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(receipt.bytes); }
  catch { return fail('topic_editorial_receipt_encoding_invalid'); }
  if (sha(body) !== receipt.sha256) fail('topic_editorial_receipt_encoding_invalid');
  await transaction(args.database, false, async client => {
    await owner(client, args.lease, false);
    const bound = (await client.query(`SELECT r.phase,r.batch_index,r.request_digest FROM signal_topic_editorial_calls c
      JOIN signal_topic_editorial_requests r ON r.id=c.request_id AND r.execution_id=c.execution_id
      WHERE c.id=$1 AND c.attempt_token=$2 AND c.execution_id=$3 AND c.workspace_id=$4 AND r.request_digest=$5`,
    [args.call_id, args.attempt_token, args.lease.execution_id, args.lease.workspace_id, receipt.request_digest])).rows[0];
    if (!bound) fail('topic_editorial_response_attempt_invalid');
    await client.query('SELECT persist_signal_topic_editorial_receipt_v1($1,$2,$3,$4,$5,$6,$7,$8)',
      [args.call_id, args.attempt_token, receipt.request_digest, body, args.storage_key,
        receipt.http_status, receipt.complete, receipt.provider_request_id]);
  });
}
