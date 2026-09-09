import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';
import * as engine from '../signal-workspace-engine';
import * as producer from '../signal-workspace-numeric-producer';

/** Deterministic admission interleaving on the real rollback fixture, not a
 * parallel-connection or throughput benchmark. No execution job is consumed. */
export async function assertSignalWorkspaceNumericProducerAdmissionRacesV1(args: {
  database: Pool;
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  access: { database: Pool; workspace_id: string; actor_user_id: string };
  parent_lease: engine.SignalWorkspaceEngineLeaseV1;
  prepare: () => Promise<{ revision: string; embedding_run_id: string }>;
  sameOriginal: () => Promise<void>;
}) {
  const rollback = async (work: () => Promise<void>) => {
    await args.query('BEGIN');
    try { await work(); } finally { await args.query('ROLLBACK'); }
  };
  const manualArgs = (embedding_run_id: string) => ({
    ...args.access, embedding_run_id, idempotency_key: randomUUID(),
    expected_context_digest: args.parent_lease.snapshot.context_digest,
    expected_catalog_digest: args.parent_lease.snapshot.catalog_digest,
    engine_config: args.parent_lease.snapshot.engine_config,
    claude_cap_micro_usd: 0, parent_execution_id: null,
  });
  const executions = async (revision: string) => (await args.query(
    `SELECT id,input_snapshot,status FROM signal_topic_catalog_executions
     WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1'
       AND input_revision=$2::bigint ORDER BY id`, [args.access.workspace_id, revision])).rows;

  await rollback(async () => {
    const next = await args.prepare();
    let connections = 0;
    let manualId: string | null = null;
    let admissionTaxonomyLocks = 0;
    let admissionInputLocks = 0;
    const wrapped = Object.assign(Object.create(args.database) as Pool, {
      connect: async () => {
        connections++;
        // Connection 1 is the read-only preflight. A manual native analysis
        // wins after that plan, immediately before automatic begin takes locks.
        if (connections === 2) {
          manualId = (await engine.beginSignalWorkspaceEngineV1(manualArgs(next.embedding_run_id))).execution_id;
        }
        const client = await args.database.connect();
        const isAdmission = connections === 2;
        const scoped = Object.create(client) as PoolClient;
        scoped.query = (async (sql: string, params?: unknown[]) => {
          if (isAdmission && sql.includes('pg_advisory_xact_lock')
            && params?.[0] === `signal-taxonomy:${args.access.workspace_id}:topic`) admissionTaxonomyLocks++;
          if (isAdmission && sql.includes('signal_corpus_preparation_input_state') && sql.includes('FOR UPDATE')) admissionInputLocks++;
          return client.query(sql, params);
        }) as PoolClient['query'];
        scoped.release = () => client.release();
        return scoped;
      },
    });
    const recovered = await producer.admitSignalWorkspaceNumericUpdateV1({ database: wrapped, workspace_id: args.access.workspace_id });
    assert.ok(manualId, 'manual admission actually interleaved after preflight');
    assert.ok(admissionTaxonomyLocks >= 1, 'automatic begin takes the existing taxonomy lock (catalog ensure may reacquire it)');
    assert.ok(admissionInputLocks >= 1, 'automatic begin takes the existing input revision row lock');
    assert.equal(recovered.state, 'already_handled');
    assert.equal(recovered.admitted, false);
    assert.equal(recovered.execution_id, manualId);
    const rows = await executions(next.revision);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, manualId);
    assert.equal(rows[0]!.input_snapshot.numeric_descriptor, undefined, 'the producer did not create a numeric or fallback intent');
    assert.equal((await args.query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid', [manualId])).rows[0]!.n, 1);
    assert.equal((await args.query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid', [manualId])).rows[0]!.n, 0);
    await args.sameOriginal();
  });

  await rollback(async () => {
    const next = await args.prepare();
    const admitted = await producer.admitSignalWorkspaceNumericUpdateV1({ database: args.database, workspace_id: args.access.workspace_id });
    assert.equal(admitted.admitted, true);
    await assert.rejects(engine.beginSignalWorkspaceEngineV1(manualArgs(next.embedding_run_id)), /workspace_engine_execution_active/u);
    const rows = await executions(next.revision);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, admitted.execution_id);
    assert.equal(rows[0]!.input_snapshot.numeric_descriptor.discovery.close_requested, true);
    assert.equal(rows[0]!.input_snapshot.claude_cap_micro_usd, 0);
    assert.equal(rows[0]!.input_snapshot.interpretation_config, undefined);
    assert.equal((await args.query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid', [admitted.execution_id])).rows[0]!.n, 1);
    assert.equal((await args.query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid', [admitted.execution_id])).rows[0]!.n, 0);
    assert.equal((await producer.admitSignalWorkspaceNumericUpdateV1({ database: args.database, workspace_id: args.access.workspace_id })).execution_id, admitted.execution_id);
    await args.sameOriginal();
  });
}
