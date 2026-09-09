import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from '@noisia/query-engine';
import { workspaceProjectionFixtureV1, fixtureSha } from './signal-workspace-topic-projection.fixture';
import { assertSignalWorkspaceNumericProducerAdmissionRacesV1 } from './signal-workspace-numeric-producer-race.assertions';
import * as engine from '../signal-workspace-engine';
import * as numeric from '../signal-workspace-engine-incremental';
import * as producer from '../signal-workspace-numeric-producer';
import * as preparation from '../signal-workspace-corpus-preparation';
import { requestSignalWorkspaceCorpusPreparationStoreV1 } from '../signal-workspace-corpus-preparation-management';
import * as embeddings from '../signal-workspace-embeddings';
import { quoteSignalWorkspaceEmbeddingsStoreV1, requestSignalWorkspaceEmbeddingsStoreV1 } from '../signal-workspace-embeddings-management';

const enabled = process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED === 'true';

test('automatic numeric producer admits only new, current, explicitly opted-in corpus revisions',
  { skip: !enabled, timeout: 90_000 }, async t => {
  const done = new Error('numeric producer local test complete');
  let reached = false;
  await assert.rejects(workspaceProjectionFixtureV1({
    migrations: ['0141_signal_workspace_editorial_repair.sql', '0142_signal_workspace_terminal_transport.sql',
      '0143_signal_workspace_editorial_revision.sql', '0144_signal_workspace_engine_progress.sql'],
    model_configuration: { fixture: true, versions: { python: 'local-numeric-admission-contract' } },
    onCheckpoint: async f => {
      await f.query(await readFile(new URL('./0145_signal_workspace_incremental_numeric.sql', import.meta.url), 'utf8'));
      await f.query(await readFile(new URL('./0146_signal_workspace_incremental_projection.sql', import.meta.url), 'utf8'));
      const { database, workspace_id, actor_user_id } = f.access;
      await engine.persistSignalWorkspaceEngineArtifactV1({ database, lease: f.lease, artifact: {
        artifact_key: 'guide-vectors.npy', artifact_type: 'engine_output', title: 'Local numeric admission fixture',
        storage_key: `workspace-engine/${workspace_id}/${f.lease.execution_id}/guide-vectors.npy`,
        sha256: fixtureSha('local guide-vector fixture'), size_bytes: 26, media_type: 'application/octet-stream', metadata: { filename: 'guide-vectors.npy' }
      } });
      await engine.failSignalWorkspaceEngineV1({ database, lease: f.lease, error_code: 'workspace_engine_interpretation_daily_authority_expired' });
      const original = (await f.query('SELECT to_jsonb(e) value FROM signal_topic_catalog_executions e WHERE id=$1', [f.lease.execution_id])).rows[0]!.value;
      const money = (await f.query('SELECT to_jsonb(c) value FROM engine_cost_events c WHERE catalog_execution_id=$1 ORDER BY id', [f.lease.execution_id])).rows;
      const initialRevision = f.lease.snapshot.input_revision;
      const savepoint = async (work: () => Promise<void>) => {
        await f.query('BEGIN'); try { await work(); } finally { await f.query('ROLLBACK'); }
      };
      const mutate = async () => {
        // A real accepted-root metadata edit triggers a new revision without changing text or cache keys.
        await f.query(`UPDATE mentions SET country=CASE WHEN country='MX' THEN 'US' ELSE 'MX' END
          WHERE id=(SELECT root_id FROM signal_corpus_preparation_items WHERE run_id=$1::uuid
            AND disposition='eligible' ORDER BY root_id LIMIT 1)`, [f.lease.snapshot.preparation_run_id]);
        const revision = (await f.query('SELECT input_revision::text FROM signal_corpus_preparation_input_state WHERE workspace_id=$1', [workspace_id])).rows[0]!.input_revision;
        assert.ok(BigInt(revision) > BigInt(initialRevision)); return String(revision);
      };
      const prepare = async (checkStages = false) => {
        const revision = await mutate();
        const requested = await requestSignalWorkspaceCorpusPreparationStoreV1({ ...f.access, idempotency_key: randomUUID() });
        if (checkStages) assert.equal((await producer.loadSignalWorkspaceNumericReadinessV1(f.access)).state, 'waiting_preparation');
        const prepJob = (await f.query('SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1', [requested.run_id])).rows[0]!.worker_job_id;
        const claimed = await preparation.claimSignalWorkspaceCorpusPreparationRunV1({ database, run_id: requested.run_id, worker_job_id: prepJob });
        assert.ok(claimed);
        let lease = await preparation.snapshotSignalWorkspaceCorpusPreparationV1({ database, lease: claimed });
        for (;;) {
          const page = await preparation.readSignalWorkspaceCorpusPreparationPageV1({ database, lease });
          lease = await preparation.commitSignalWorkspaceCorpusPreparationPageV1({ database, lease, page, assets: [] });
          if (page.done) break;
        }
        assert.equal((await preparation.finishSignalWorkspaceCorpusPreparationV1({ database, lease })).status, 'completed');
        if (checkStages) {
          const state = await producer.loadSignalWorkspaceNumericReadinessV1(f.access);
          assert.equal(state.reason_code, 'corpus_embeddings_required'); assert.equal(state.has_pending_work, false);
        }
        const quote = await quoteSignalWorkspaceEmbeddingsStoreV1({ ...f.access, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 });
        assert.equal(quote.estimated_upper_micro_usd, 0, 'existing full-text cache is reused');
        const requestedEmbedding = await requestSignalWorkspaceEmbeddingsStoreV1({ ...f.access, idempotency_key: randomUUID(),
          preparation_run_id: requested.run_id, quote_digest: quote.quote_digest, hard_cap_micro_usd: 0, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 });
        if (checkStages) assert.equal((await producer.loadSignalWorkspaceNumericReadinessV1(f.access)).state, 'waiting_embeddings');
        const embeddingJob = (await f.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1', [requestedEmbedding.run_id])).rows[0]!.worker_job_id;
        let embeddingLease = await embeddings.claimSignalWorkspaceEmbeddingRunV1({ database, run_id: requestedEmbedding.run_id, worker_job_id: embeddingJob });
        assert.ok(embeddingLease);
        for (;;) {
          const batch = await embeddings.readSignalWorkspaceEmbeddingBatchV1({ database, lease: embeddingLease });
          assert.equal(batch.inputs.length, 0, 'the fixture never has permission to send');
          embeddingLease = await embeddings.commitSignalWorkspaceEmbeddingBatchV1({ database, lease: embeddingLease, batch, call_id: null });
          if (batch.done) break;
        }
        await embeddings.finishSignalWorkspaceEmbeddingsV1({ database, lease: embeddingLease });
        return { revision, embedding_run_id: requestedEmbedding.run_id };
      };
      const sameOriginal = async () => {
        assert.deepEqual((await f.query('SELECT to_jsonb(e) value FROM signal_topic_catalog_executions e WHERE id=$1', [f.lease.execution_id])).rows[0]!.value, original);
        assert.deepEqual((await f.query('SELECT to_jsonb(c) value FROM engine_cost_events c WHERE catalog_execution_id=$1 ORDER BY id', [f.lease.execution_id])).rows, money);
      };

      await t.test('same revision and a workspace with no native opt-in create no new intents', () => savepoint(async () => {
        const current = await producer.admitSignalWorkspaceNumericUpdateV1({ database, workspace_id });
        assert.equal(current.state, 'already_handled'); assert.equal(current.admitted, false);
        assert.equal(current.execution_id, f.lease.execution_id);
        const unrelated = (await f.query(`SELECT workspace.id FROM signal_workspaces workspace
          WHERE NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions e WHERE e.workspace_id=workspace.id
            AND e.input_contract='workspace-topic-engine-v1') ORDER BY workspace.id LIMIT 1`)).rows[0];
        assert.ok(unrelated, 'local database contains a workspace without native opt-in');
        assert.equal((await producer.admitSignalWorkspaceNumericUpdateV1({ database, workspace_id: unrelated.id })).state, 'not_enabled');
        await sameOriginal();
      }));

      await t.test('real input revision waits for preparation and separately authorized cache-only embeddings', () => savepoint(async () => {
        const next = await prepare(true);
        const state = await producer.loadSignalWorkspaceNumericReadinessV1(f.access);
        assert.equal(state.state, 'ready_to_schedule'); assert.equal(state.desired_revision, next.revision);
        assert.equal(state.embedding_run_id, next.embedding_run_id);
        assert.equal((await f.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE run_id=$1', [next.embedding_run_id])).rows[0]!.n, 0);
        await sameOriginal();
      }));

      await t.test('scheduler admits one cap-zero child and outbox; repeated stale admissions cannot duplicate it', () => savepoint(async () => {
        const next = await prepare();
        const args = { ...f.access, idempotency_key: `workspace-numeric-auto:${workspace_id}:${next.revision}`,
          embedding_run_id: next.embedding_run_id, expected_context_digest: f.lease.snapshot.context_digest,
          expected_catalog_digest: f.lease.snapshot.catalog_digest, engine_config: f.lease.snapshot.engine_config, close_requested: true,
          automatic_admission: { opt_in_execution_id: f.lease.execution_id, input_revision: next.revision } };
        let after: string | null = null, found: producer.SignalWorkspaceNumericReadinessV1 | undefined;
        for (let page = 0; page < 100; page++) {
          const scheduled = await producer.scheduleSignalWorkspaceNumericUpdatesV1({ database, after_workspace_id: after, limit: 1 });
          found = scheduled.results.find(row => row.workspace_id === workspace_id) ?? found;
          if (!scheduled.next_cursor) break; after = scheduled.next_cursor;
        }
        assert.ok(found?.execution_id); const id = found.execution_id;
        const replay = await numeric.beginSignalWorkspaceIncrementalEngineV1(args);
        assert.equal(replay.execution_id, id); assert.equal(replay.replayed, true);
        await assert.rejects(numeric.beginSignalWorkspaceIncrementalEngineV1({ ...args, idempotency_key: randomUUID() }), /revision_already_handled/u);
        const execution = (await f.query('SELECT input_snapshot,status FROM signal_topic_catalog_executions WHERE id=$1', [id])).rows[0]!;
        assert.equal(execution.input_snapshot.claude_cap_micro_usd, 0); assert.equal(execution.input_snapshot.interpretation_config, undefined);
        assert.equal(execution.input_snapshot.numeric_descriptor.parent.execution_id, f.lease.execution_id);
        assert.equal(execution.input_snapshot.numeric_descriptor.discovery.close_requested, true);
        assert.equal(execution.input_snapshot.expected_roots, 3); assert.equal(execution.input_snapshot.expected_chunks, 133);
        assert.equal((await f.query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1', [id])).rows[0]!.n, 1);
        assert.equal((await f.query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1', [id])).rows[0]!.n, 0);
        assert.equal((await producer.admitSignalWorkspaceNumericUpdateV1({ database, workspace_id })).execution_id, id);
        await sameOriginal();
      }));

      await t.test('lost admission COMMIT acknowledgement is recovered from the same durable revision', () => savepoint(async () => {
        await prepare();
        let inserted = false, lost = false;
        const wrapped = Object.assign(Object.create(database) as Pool, { connect: async () => {
          const client = await database.connect();
          const query = async (sql: string, params?: unknown[]) => {
            if (sql.startsWith('INSERT INTO signal_topic_catalog_executions')) inserted = true;
            const result = await client.query(sql, params);
            if (sql === 'COMMIT' && inserted && !lost) { lost = true; throw Object.assign(new Error('local acknowledgement loss'), { code: 'ECONNRESET' }); }
            // The real transaction has committed. Its best-effort rollback cannot undo it.
            return result;
          };
          const scoped = Object.create(client) as PoolClient;
          scoped.query = ((sql: string, params?: unknown[]) => lost && sql === 'ROLLBACK'
            ? Promise.resolve({ rows: [], rowCount: 0 }) : query(sql, params)) as PoolClient['query'];
          scoped.release = () => client.release(); return scoped;
        } });
        await assert.rejects(producer.admitSignalWorkspaceNumericUpdateV1({ database: wrapped, workspace_id }), /acknowledgement loss/u);
        assert.equal(lost, true);
        const recovered = await producer.admitSignalWorkspaceNumericUpdateV1({ database, workspace_id });
        assert.equal(recovered.state, 'already_handled'); assert.equal(recovered.admitted, false); assert.ok(recovered.execution_id);
        assert.equal((await f.query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1', [recovered.execution_id])).rows[0]!.n, 1);
        await sameOriginal();
      }));

      await t.test('revoked actor, stale context, missing model runtime and changed revision fail closed', () => savepoint(async () => {
        const next = await prepare();
        await assert.rejects(numeric.beginSignalWorkspaceIncrementalEngineV1({ ...f.access, idempotency_key: randomUUID(),
          embedding_run_id: next.embedding_run_id, expected_context_digest: fixtureSha('stale context'),
          expected_catalog_digest: f.lease.snapshot.catalog_digest, engine_config: f.lease.snapshot.engine_config, close_requested: true,
          automatic_admission: { opt_in_execution_id: f.lease.execution_id, input_revision: next.revision } }), /inputs_stale/u);
        await savepoint(async () => {
          await f.query("UPDATE users SET status='inactive' WHERE id=$1", [actor_user_id]);
          const blocked = await producer.admitSignalWorkspaceNumericUpdateV1({ database, workspace_id });
          assert.equal(blocked.reason_code, 'numeric_actor_forbidden'); assert.equal(blocked.has_pending_work, false);
          await assert.rejects(producer.loadSignalWorkspaceNumericReadinessV1(f.access), /forbidden/u);
        });
        // Model registry and context are immutable in product; parent lookup rejection is tested with a scoped query fault,
        // leaving the actual stored model intact. No fallback is authorized by a compatibility failure.
        const unavailable = Object.assign(Object.create(database) as Pool, { query: ((sql: string, params?: unknown[]) =>
          sql === 'SELECT configuration FROM tagging_model_versions WHERE id=$1::uuid'
            ? Promise.resolve({ rows: [{ configuration: {} }] }) : database.query(sql, params)) as Pool['query'] });
        assert.equal((await producer.admitSignalWorkspaceNumericUpdateV1({ database: unavailable, workspace_id })).reason_code,
          'workspace_engine_incremental_parent_runtime_missing');
        await mutate();
        await assert.rejects(numeric.beginSignalWorkspaceIncrementalEngineV1({ ...f.access, idempotency_key: randomUUID(),
          embedding_run_id: next.embedding_run_id, expected_context_digest: f.lease.snapshot.context_digest,
          expected_catalog_digest: f.lease.snapshot.catalog_digest, engine_config: f.lease.snapshot.engine_config, close_requested: false,
          automatic_admission: { opt_in_execution_id: f.lease.execution_id, input_revision: next.revision } }), /complete_embeddings_required/u);
        await sameOriginal();
      }));
      await t.test('manual and automatic admission interleavings preserve one execution and existing locks',
        () => savepoint(() => assertSignalWorkspaceNumericProducerAdmissionRacesV1({ database, query: f.query,
          access: f.access, parent_lease: f.lease, prepare, sameOriginal })));
      reached = true; throw done;
    }
  }), error => error === done);
  assert.equal(reached, true);
});
