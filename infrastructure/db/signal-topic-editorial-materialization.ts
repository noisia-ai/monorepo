import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type SignalTopicEditorialMaterializationDatabaseV1 = Pick<Pool, 'connect'>;
export type SignalTopicEditorialMaterializationResultV1 = {
  contract_version: 'signal-topic-editorial-materialization-v1';
  execution_id: string;
  revision_id: string;
  revision: number;
  status: 'completed';
  concept_count: number;
  decision_count: number;
  topic_count: number;
  narrative_count: number;
  noise_count: number;
  unresolved_count: number;
  target_range_met: boolean;
  activation: 'not_activated';
  replayed: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const natural = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
const fail = (code: string): never => { throw new Error(code); };

function result(value: unknown): SignalTopicEditorialMaterializationResultV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('topic_editorial_materialization_result_invalid');
  const item = value as Record<string, unknown>;
  if (item.contract_version !== 'signal-topic-editorial-materialization-v1' || item.status !== 'completed'
    || item.activation !== 'not_activated' || !uuid.test(String(item.execution_id)) || !uuid.test(String(item.revision_id))
    || !natural(item.revision, 1_000_000) || Number(item.revision) < 1
    || !natural(item.concept_count, 120)
    || !natural(item.decision_count, 5_000) || Number(item.decision_count) < 1
    || !natural(item.topic_count, 120) || !natural(item.narrative_count, 120)
    || Number(item.topic_count) + Number(item.narrative_count) !== Number(item.concept_count)
    || !natural(item.noise_count, 5_000) || !natural(item.unresolved_count, 5_000)
    || typeof item.target_range_met !== 'boolean' || item.target_range_met !== (Number(item.concept_count) >= 24 && Number(item.concept_count) <= 80)
    || typeof item.replayed !== 'boolean') fail('topic_editorial_materialization_result_invalid');
  return item as SignalTopicEditorialMaterializationResultV1;
}

/** Materializes an already completed and paid editorial state. This function
 * has no provider transport and never changes Signal serving authority. */
export async function materializeSignalTopicEditorialSuccessorV1(args: {
  database: SignalTopicEditorialMaterializationDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  execution_id: string;
  expected_state_digest: string;
  expected_group_count: number;
}): Promise<SignalTopicEditorialMaterializationResultV1> {
  if (!uuid.test(args.workspace_id) || !uuid.test(args.actor_user_id) || !uuid.test(args.execution_id)
    || !digest.test(args.expected_state_digest) || !natural(args.expected_group_count, 5_000) || args.expected_group_count < 1)
    fail('topic_editorial_materialization_scope_invalid');
  const client = await args.database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const row = (await client.query<{ value: unknown }>(
      'SELECT materialize_signal_topic_editorial_successor_v1($1::uuid,$2::uuid,$3::uuid,$4::text) value',
      [args.workspace_id, args.actor_user_id, args.execution_id, args.expected_state_digest],
    )).rows[0];
    const parsed = result(row?.value ?? fail('topic_editorial_materialization_result_missing'));
    if (parsed.execution_id !== args.execution_id || parsed.decision_count !== args.expected_group_count)
      fail('topic_editorial_materialization_result_invalid');
    await client.query('COMMIT');
    return parsed;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { (client as PoolClient).release(); }
}

/** Common provider-free service for the Studio CTA and Worker finalization.
 * Expected state/count are derived from the immutable owner, never from the UI. */
export async function materializeSignalTopicEditorialExecutionV1(args: {
  database: SignalTopicEditorialMaterializationDatabaseV1; workspace_id: string; actor_user_id: string; execution_id: string;
}): Promise<SignalTopicEditorialMaterializationResultV1> {
  if (![args.workspace_id,args.actor_user_id,args.execution_id].every(value => uuid.test(value))) fail('topic_editorial_materialization_scope_invalid');
  const client = await args.database.connect();
  let stateDigest: string, expectedCount: number;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public,extensions,pg_temp');
    const row = (await client.query<{ status: string; state_body: string | null; state_digest: string | null; expected_group_count: string }>(
      `SELECT status,state_body,state_digest,source_binding->>'expected_group_count' AS expected_group_count
       FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3
       AND signal_brand_context_processing_actor_v1($2,$3)`,
      [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
    if (!row) return fail('topic_editorial_materialization_scope_invalid');
    if (!['review_ready','completed'].includes(row.status)) fail('topic_editorial_materialization_not_ready');
    const body = row.state_body ?? fail('topic_editorial_materialization_state_invalid');
    const sealedDigest = row.state_digest ?? fail('topic_editorial_materialization_state_invalid');
    if (!body || !digest.test(sealedDigest)
      || `sha256:${createHash('sha256').update(body).digest('hex')}` !== sealedDigest) fail('topic_editorial_materialization_state_invalid');
    let state: { phase?: unknown; execution_key?: unknown };
    try { state = JSON.parse(body); } catch { return fail('topic_editorial_materialization_state_invalid'); }
    if (state?.phase !== 'completed' || state.execution_key !== args.execution_id) fail('topic_editorial_materialization_state_invalid');
    expectedCount = Number(row.expected_group_count);
    if (!natural(expectedCount,5_000) || expectedCount < 1) fail('topic_editorial_materialization_state_invalid');
    stateDigest = sealedDigest;
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
  // The SQL write rechecks exact state/owner under lock. A crash after its commit
  // replays the existing validated revision rather than creating another one.
  return materializeSignalTopicEditorialSuccessorV1({ ...args, expected_state_digest: stateDigest, expected_group_count: expectedCount });
}

/** Queue-only adapter: a terminal claim has no active lease, so validate its
 * durable job identity before using the same provider-free application service. */
export async function materializeSignalTopicEditorialWorkerExecutionV1(args: {
  database: SignalTopicEditorialMaterializationDatabaseV1; execution_id: string; worker_job_id: string;
}): Promise<SignalTopicEditorialMaterializationResultV1> {
  if (!uuid.test(args.execution_id) || typeof args.worker_job_id !== 'string') fail('topic_editorial_materialization_scope_invalid');
  const client = await args.database.connect();
  let owner: { workspace_id: string; actor_user_id: string };
  try {
    const row = (await client.query<{ workspace_id: string; actor_user_id: string }>(
      `SELECT workspace_id,actor_user_id FROM signal_topic_editorial_executions
       WHERE id=$1 AND 'topic-editorial-'||id::text||'-'||dispatch_generation::text=$2
       AND status IN ('review_ready','completed')`, [args.execution_id,args.worker_job_id])).rows[0];
    if (!row) return fail('topic_editorial_materialization_scope_invalid');
    owner = row;
  } finally { client.release(); }
  return materializeSignalTopicEditorialExecutionV1({ database: args.database, execution_id: args.execution_id, ...owner });
}
