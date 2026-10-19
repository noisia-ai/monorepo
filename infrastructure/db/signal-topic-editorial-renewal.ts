import type { Pool } from 'pg';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import { SignalTopicEditorialStoreError } from './signal-topic-consolidation-editorial';

type Database = Pick<Pool, 'connect'>;
type Scope = { database: Database; workspace_id: string; actor_user_id: string; execution_id: string };
type Quote = { status: string; quote_reference?: string; quote_expires_at?: string; grant_cap_micro_usd?: string;
  budget_date?: string; budget_timezone?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const key = /^[A-Za-z0-9._:-]{8,200}$/u;
const reference = /^v1\.[0-9]{10}\.[a-f0-9]{64}$/u;
const money = /^[1-9][0-9]*$/u;
function invalid(): never { throw new SignalTopicEditorialStoreError('topic_editorial_renewal_invalid', 422); }
function validateScope(args: Scope) {
  if (![args.workspace_id,args.actor_user_id,args.execution_id].every(value => uuid.test(value))) invalid();
}

export async function quoteSignalTopicEditorialRenewalV1(args: Scope & { deadline?: number }): Promise<Quote> {
  validateScope(args);
  if (args.deadline !== undefined && (!Number.isSafeInteger(args.deadline) || args.deadline <= 0 || args.deadline > 9_999_999_999)) invalid();
  const client = await args.database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const access = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id,
      actor_user_id: args.actor_user_id });
    if (!access.can_view) throw new SignalTopicEditorialStoreError('processing_forbidden', 403);
    const row = (await client.query<{ value: Quote }>('SELECT signal_topic_editorial_renewal_quote_v1($1,$2,$3,$4::bigint) value',
      [args.workspace_id,args.actor_user_id,args.execution_id,args.deadline ?? null])).rows[0];
    await client.query('COMMIT');
    return row?.value ?? { status: 'unavailable' };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function renewSignalTopicEditorialExecutionV1(args: Scope & {
  idempotency_key: string; quote_reference: string; confirmed_cap_micro_usd: string;
}): Promise<{ renewal_id: string; execution_id: string; replayed: boolean }> {
  validateScope(args);
  if (!key.test(args.idempotency_key) || !reference.test(args.quote_reference)
    || !money.test(args.confirmed_cap_micro_usd) || args.confirmed_cap_micro_usd.length>8
    || BigInt(args.confirmed_cap_micro_usd)>30_000_000n) invalid();
  const client = await args.database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    // SQL rechecks actor, current policy, exact quote, owner/plan, old receipts,
    // the owner lifetime cap and the organization's current-day exposure.
    const row = (await client.query<{ value: { renewal_id: string; execution_id: string; replayed: boolean } }>(
      'SELECT renew_signal_topic_editorial_execution_v1($1,$2,$3,$4,$5,$6::bigint) value',
      [args.workspace_id,args.actor_user_id,args.execution_id,args.idempotency_key,
        args.quote_reference,args.confirmed_cap_micro_usd])).rows[0];
    if (!row) throw new SignalTopicEditorialStoreError('topic_editorial_renewal_unavailable');
    await client.query('COMMIT');
    return row.value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof Error && /^(?:topic_editorial|processing|brand_context)_[a-z_]{1,120}$/u.test(error.message))
      throw new SignalTopicEditorialStoreError(error.message);
    throw error;
  } finally { client.release(); }
}
