import type { PoolClient } from 'pg';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import { beginSignalWorkspaceIncrementalEngineV1, loadSignalWorkspaceIncrementalParentV1 } from './signal-workspace-engine-incremental';
import { loadSignalWorkspaceEnginePreflightV1, SignalWorkspaceEngineError,
  type SignalWorkspaceEngineDatabaseV1 } from './signal-workspace-engine';

type Queryable = Pick<PoolClient, 'query'>;
export type SignalWorkspaceNumericAdmissionV1 = { opt_in_execution_id: string; input_revision: string };
export type SignalWorkspaceNumericReadinessV1 = {
  contract_version: 'workspace-numeric-readiness-v1'; workspace_id: string; desired_revision: string | null;
  state: 'not_enabled' | 'waiting_preparation' | 'waiting_embeddings' | 'blocked' | 'ready_to_schedule' | 'already_handled';
  reason_code: string | null; has_pending_work: boolean; execution_id: string | null; embedding_run_id: string | null;
};
type Seed = { id: string; actor_user_id: string; input_revision: string;
  input_snapshot: { context_digest: string; catalog_digest: string; engine_config: Record<string, unknown>;
    guides: Array<{guide_key: string; role: string; input_digest: string}> } };
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceEngineError(code, status); };

// The first explicit native analysis is durable consent for provider-free updates.
// A numeric child, legacy study, or Topic selection never expands paid authority.
async function seed(queryable: Queryable, workspace: string): Promise<Seed | null> {
  return (await queryable.query<Seed>(`SELECT id, actor_user_id, input_revision::text, input_snapshot
    FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid
      AND input_contract='workspace-topic-engine-v1' AND NOT input_snapshot ? 'numeric_descriptor'
    ORDER BY created_at DESC,id DESC LIMIT 1`, [workspace])).rows[0] ?? null;
}

/** Called inside begin's existing taxonomy + input-state locks, after exact-key replay. */
export async function assertSignalWorkspaceNumericAdmissionWithClientV1(args: {
  queryable: Queryable; workspace_id: string; actor_user_id: string; input_revision: string;
  admission: SignalWorkspaceNumericAdmissionV1;
}) {
  const current = await seed(args.queryable, args.workspace_id);
  if (!current || current.id !== args.admission.opt_in_execution_id || current.actor_user_id !== args.actor_user_id
    || !/^\d+$/u.test(args.admission.input_revision) || args.admission.input_revision !== args.input_revision
    || BigInt(current.input_revision) >= BigInt(args.input_revision)) fail('workspace_numeric_admission_stale');
  const handled = (await args.queryable.query(`SELECT id FROM signal_topic_catalog_executions
    WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND input_revision=$2::bigint LIMIT 1`,
  [args.workspace_id, args.input_revision])).rows[0];
  if (handled) fail('workspace_numeric_revision_already_handled');
}

async function plan(database: SignalWorkspaceEngineDatabaseV1, workspace_id: string) {
  const state = (await database.query<{ input_revision: string }>(`SELECT input_revision::text
    FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid`, [workspace_id])).rows[0];
  const view: SignalWorkspaceNumericReadinessV1 = { contract_version: 'workspace-numeric-readiness-v1', workspace_id,
    desired_revision: state?.input_revision ?? null, state: 'not_enabled', reason_code: 'native_analysis_required',
    has_pending_work: false, execution_id: null, embedding_run_id: null };
  const change = (status: SignalWorkspaceNumericReadinessV1['state'], reason: string | null, pending = false) => {
    view.state = status; view.reason_code = reason; view.has_pending_work = pending; return { view, start: null };
  };
  const opted = await seed(database, workspace_id);
  if (!opted || !state) return { view, start: null };
  const handled = (await database.query<{ id: string }>(`SELECT id FROM signal_topic_catalog_executions
    WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND input_revision=$2::bigint
    ORDER BY created_at DESC,id DESC LIMIT 1`, [workspace_id, state.input_revision])).rows[0];
  if (handled) { view.execution_id = handled.id; return change('already_handled', null); }
  if (BigInt(state.input_revision) <= BigInt(opted.input_revision)) return change('not_enabled', 'new_input_revision_required');
  const capability = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: database, workspace_id, actor_user_id: opted.actor_user_id });
  if (!capability.can_execute_topics) return change('blocked', 'numeric_actor_forbidden');
  const prep = (await database.query<{ id: string; status: string; policy_current: boolean }>(`SELECT id,status,
    (policy_valid_until IS NULL OR policy_valid_until>clock_timestamp()) policy_current
    FROM signal_corpus_preparation_runs WHERE workspace_id=$1::uuid AND (input_revision=$2::bigint
      OR (input_revision IS NULL AND status IN('queued','running')))
    ORDER BY created_at DESC,id DESC LIMIT 1`, [workspace_id, state.input_revision])).rows[0];
  if (!prep) return change('blocked', 'corpus_preparation_required');
  if (prep.status === 'queued' || prep.status === 'running') return change('waiting_preparation', null, true);
  if (prep.status !== 'completed' || !prep.policy_current) return change('blocked', 'corpus_preparation_not_current');
  const embedding = (await database.query<{ id: string; status: string; policy_current: boolean }>(`SELECT id,status,
    (policy_valid_until IS NULL OR policy_valid_until>clock_timestamp()) policy_current
    FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid AND input_contract='corpus'
      AND preparation_run_id=$2::uuid AND input_revision=$3::bigint
    ORDER BY (status='completed') DESC,created_at DESC,id DESC LIMIT 1`, [workspace_id, prep.id, state.input_revision])).rows[0];
  if (!embedding) return change('blocked', 'corpus_embeddings_required');
  view.embedding_run_id = embedding.id;
  if (embedding.status === 'queued' || embedding.status === 'running') return change('waiting_embeddings', null, true);
  if (embedding.status !== 'completed' || !embedding.policy_current) return change('blocked', 'corpus_embeddings_not_current');
  try {
    const preflight = await loadSignalWorkspaceEnginePreflightV1({ database, workspace_id, actor_user_id: opted.actor_user_id });
    if (preflight.expected_context_digest !== opted.input_snapshot.context_digest
      || preflight.expected_catalog_digest !== opted.input_snapshot.catalog_digest) return change('blocked', 'numeric_parent_context_changed');
    if (preflight.missing_guides) return change('blocked', 'workspace_engine_guides_required');
    const parent = await loadSignalWorkspaceIncrementalParentV1({ queryable: database, workspace_id,
      actor_user_id: opted.actor_user_id, embedding_config_digest: (await database.query<{ config_digest: string }>(
        'SELECT config_digest FROM signal_workspace_embedding_runs WHERE id=$1::uuid', [embedding.id])).rows[0]!.config_digest,
      context_digest: preflight.expected_context_digest, catalog_digest: preflight.expected_catalog_digest,
      engine_config: opted.input_snapshot.engine_config, guides: opted.input_snapshot.guides });
    if (!parent.available) return change('blocked', 'workspace_engine_incremental_parent_unavailable');
    view.state = 'ready_to_schedule'; view.reason_code = null; view.has_pending_work = true;
    return { view, start: { database, workspace_id, actor_user_id: opted.actor_user_id,
      idempotency_key: `workspace-numeric-auto:${workspace_id}:${state.input_revision}`, embedding_run_id: embedding.id,
      expected_context_digest: preflight.expected_context_digest, expected_catalog_digest: preflight.expected_catalog_digest,
      engine_config: opted.input_snapshot.engine_config, close_requested: true,
      automatic_admission: { opt_in_execution_id: opted.id, input_revision: state.input_revision } } };
  } catch (error) {
    if (error instanceof SignalWorkspaceEngineError) return change('blocked', error.code);
    throw error;
  }
}

/** Read-only UI contract. The viewer never replaces the original authorizing actor. */
export async function loadSignalWorkspaceNumericReadinessV1(args: {
  database: SignalWorkspaceEngineDatabaseV1; workspace_id: string; actor_user_id: string;
}) {
  const capability = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: args.database, ...args });
  if (!capability.can_view) fail('workspace_engine_forbidden', 403);
  return (await plan(args.database, args.workspace_id)).view;
}

/** Every candidate is revalidated by begin under its existing locks. No paid calls or retries. */
export async function admitSignalWorkspaceNumericUpdateV1(args: { database: SignalWorkspaceEngineDatabaseV1; workspace_id: string }) {
  const planned = await plan(args.database, args.workspace_id);
  if (!planned.start) return { ...planned.view, admitted: false, replayed: false };
  try {
    const started = await beginSignalWorkspaceIncrementalEngineV1(planned.start);
    return { ...planned.view, state: 'already_handled' as const, has_pending_work: false,
      execution_id: started.execution_id, admitted: !started.replayed, replayed: started.replayed };
  } catch (error) {
    if (error instanceof SignalWorkspaceEngineError) {
      if (error.code === 'workspace_numeric_revision_already_handled' || error.code === 'workspace_numeric_admission_stale')
        return { ...(await plan(args.database, args.workspace_id)).view, admitted: false, replayed: false };
      return { ...planned.view, state: 'blocked' as const, reason_code: error.code,
        has_pending_work: false, admitted: false, replayed: false };
    }
    // In particular a lost COMMIT acknowledgement is not converted to a fresh intent.
    throw error;
  }
}

/** Bounded metadata scan; cursor fairness prevents a blocked workspace starving later ones. */
export async function scheduleSignalWorkspaceNumericUpdatesV1(args: {
  database: SignalWorkspaceEngineDatabaseV1; after_workspace_id?: string | null; limit?: number;
  admit?: typeof admitSignalWorkspaceNumericUpdateV1;
}) {
  const limit = args.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) fail('workspace_numeric_page_invalid', 422);
  const candidates = (await args.database.query<{ workspace_id: string }>(`SELECT state.workspace_id
    FROM signal_corpus_preparation_input_state state
    WHERE ($1::uuid IS NULL OR state.workspace_id>$1::uuid)
      AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions optin WHERE optin.workspace_id=state.workspace_id
        AND optin.input_contract='workspace-topic-engine-v1' AND NOT optin.input_snapshot ? 'numeric_descriptor'
        AND optin.input_revision<state.input_revision)
      AND EXISTS(SELECT 1 FROM signal_workspace_embedding_runs embedded WHERE embedded.workspace_id=state.workspace_id
        AND embedded.input_contract='corpus' AND embedded.status='completed' AND embedded.input_revision=state.input_revision
        AND (embedded.policy_valid_until IS NULL OR embedded.policy_valid_until>clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions handled WHERE handled.workspace_id=state.workspace_id
        AND handled.input_contract='workspace-topic-engine-v1' AND handled.input_revision=state.input_revision)
    ORDER BY state.workspace_id LIMIT $2`, [args.after_workspace_id ?? null, limit + 1])).rows;
  const page = candidates.slice(0, limit);
  const results = [];
  const failures: Array<{workspace_id:string;error_code:'workspace_numeric_admission_unavailable'}> = [];
  for (const candidate of page) {
    try { results.push(await (args.admit ?? admitSignalWorkspaceNumericUpdateV1)({ database: args.database, ...candidate })); }
    catch {
      // A compiler fault or ambiguous COMMIT belongs to this candidate. Keep the
      // durable request untouched and advance so it cannot starve other queues.
      failures.push({...candidate,error_code:'workspace_numeric_admission_unavailable'});
    }
  }
  return { inspected: page.length, admitted: results.filter(row => row.admitted).length, results,
    failures,
    next_cursor: candidates.length > limit ? page[page.length - 1]!.workspace_id : null };
}
