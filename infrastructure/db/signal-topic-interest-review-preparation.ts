import type { PoolClient } from 'pg';
import { signalTopicEditorialDigestV1 as digest, validateSignalTopicInterestReviewV1,
  type SignalTopicInterestReviewV1 } from '@noisia/query-engine';
import { loadSignalTopicInheritedContextStoreV1 } from './signal-topic-catalog';
import { SignalTopicEditorialStoreError, type SignalTopicEditorialDatabaseV1 } from './signal-topic-consolidation-editorial';

/** Preparations are immutable input snapshots, not provider admissions or jobs. */
export type SignalTopicInterestReviewPreparationV1 = {
  preparation_id: string; workspace_id: string; numeric_run_id: string;
  review_digest: string; input_digest: string; provider_execution_enabled: false;
};
type Scope = { database: SignalTopicEditorialDatabaseV1; workspace_id: string; actor_user_id: string };
const dependencies = { context: loadSignalTopicInheritedContextStoreV1 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = /^sha256:[a-f0-9]{64}$/u;
const fail = (code: string): never => { throw new SignalTopicEditorialStoreError(`topic_interest_review_${code}`); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : fail('preparation_invalid');
function identity(workspace: string, actor: string, target: string) {
  if (![workspace, actor, target].every(value => uuid.test(value))) fail('identity_invalid');
}
function receipt(value: unknown, workspace: string): SignalTopicInterestReviewPreparationV1 {
  const row = object(value);
  if (row.workspace_id !== workspace || typeof row.preparation_id !== 'string' || !uuid.test(row.preparation_id)
    || typeof row.numeric_run_id !== 'string' || !uuid.test(row.numeric_run_id)
    || typeof row.review_digest !== 'string' || !hash.test(row.review_digest)
    || typeof row.input_digest !== 'string' || !hash.test(row.input_digest)
    || row.provider_execution_enabled !== false) return fail('preparation_invalid');
  return { preparation_id: row.preparation_id, workspace_id: workspace, numeric_run_id: row.numeric_run_id,
    review_digest: row.review_digest, input_digest: row.input_digest, provider_execution_enabled: false };
}
function checkedReview(raw: unknown): SignalTopicInterestReviewV1 {
  try { return validateSignalTopicInterestReviewV1(structuredClone(raw) as SignalTopicInterestReviewV1); }
  catch { return fail('preparation_invalid'); }
}
async function tx<T>(database: SignalTopicEditorialDatabaseV1, readOnly: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ${readOnly ? ' READ ONLY' : ''}`);
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const result = await work(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function currentContext(client: PoolClient, workspace: string, review: SignalTopicInterestReviewV1, read: typeof dependencies.context) {
  const context = await read({ queryable: client, workspace_id: workspace, complete_context: true,
    require_current_semantic_authority: true, semantic_authority_check: 'database', include_editorial_context: true });
  if (context.context_digest !== review.manifest.source_context_digest || !context.editorial_context
    || digest(context.editorial_context) !== review.manifest.editorial_context_digest) fail('source_stale');
}
/** Server-only input from loadSignalTopicInterestReviewInputV1. SQL independently
 * checks the numeric source, exact active catalog and immutable request identity.
 * Neither caller input nor a successful receipt can authorize provider spending. */
export async function prepareSignalTopicInterestReviewV1(args: Scope & {
  numeric_run_id: string; review: SignalTopicInterestReviewV1; idempotency_key: string;
}, readers: typeof dependencies = dependencies): Promise<SignalTopicInterestReviewPreparationV1 & { replayed: boolean }> {
  const { database, workspace_id, actor_user_id, numeric_run_id, idempotency_key } = args;
  const readContext = readers.context;
  identity(workspace_id, actor_user_id, numeric_run_id);
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(idempotency_key)) fail('request_key_invalid');
  const review = checkedReview(args.review);
  if (review.manifest.workspace_id !== workspace_id) fail('identity_invalid');
  return tx(database, false, async client => {
    const raw = (await client.query<{ value: unknown }>('SELECT prepare_signal_topic_interest_review_v1($1,$2,$3,$4::jsonb,$5) value',
      [workspace_id, actor_user_id, numeric_run_id, JSON.stringify(review), idempotency_key])).rows[0]?.value;
    const result = receipt(raw, workspace_id), replayed = object(raw).replayed;
    if (result.numeric_run_id !== numeric_run_id || result.review_digest !== review.review_digest
      || result.input_digest !== review.input_digest || typeof replayed !== 'boolean') fail('preparation_invalid');
    await currentContext(client, workspace_id, review, readContext);
    return { ...result, replayed: replayed as boolean };
  });
}
export async function loadSignalTopicInterestReviewPreparationV1(args: Scope & { preparation_id: string },
  readers: typeof dependencies = dependencies): Promise<SignalTopicInterestReviewPreparationV1 & { review: SignalTopicInterestReviewV1 }> {
  const { database, workspace_id, actor_user_id, preparation_id } = args, readContext = readers.context;
  identity(workspace_id, actor_user_id, preparation_id);
  return tx(database, true, async client => {
    const raw = (await client.query<{ value: unknown }>('SELECT load_signal_topic_interest_review_preparation_v1($1,$2,$3) value',
      [workspace_id, actor_user_id, preparation_id])).rows[0]?.value;
    const result = receipt(raw, workspace_id), review = checkedReview(object(raw).review);
    if (result.preparation_id !== preparation_id || review.manifest.workspace_id !== workspace_id
      || result.review_digest !== review.review_digest || result.input_digest !== review.input_digest) fail('preparation_invalid');
    await currentContext(client, workspace_id, review, readContext);
    return { ...result, review };
  });
}
