import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { openR16CiPostgresV1, openR16LocalPostgresV1, assertR16LocalPostgresPoolV1 } from './signal-r16-local-pg.fixture';
import { syntheticImportedWorkspaceFixtureV1, type SyntheticTransactionV1 } from './signal-client-workspace-entry.synthetic.fixture';
import { requestSignalWorkspaceCorpusPreparationStoreV1 } from '../signal-workspace-corpus-preparation-management';
import type { SignalWorkspaceCorpusPreparationDatabaseV1 } from '../signal-workspace-corpus-preparation';
import { signalWorkspaceCorpusPreparationJobV1 } from '../../../services/workers/src/workers/signal-workspace-corpus-preparation';

test('corpus preparation page sizes 3 and 100 preserve prepared text, hashes, chunks, status and census', {
  skip: process.env.NOISIA_R16_LOCAL_PG_LAB !== 'r16-benchmark-pg17', timeout: 180_000,
}, async () => {
  const pool = process.env.GITHUB_ACTIONS === 'true'
    ? await openR16CiPostgresV1() : await openR16LocalPostgresV1();
  assertR16LocalPostgresPoolV1(pool);
  const client = await pool.connect();
  await client.query('BEGIN');
  let savepoint = 0;
  const savepoints: string[] = [];
  const scopedClient = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN') {
        const name = `preparation_page_${++savepoint}`;
        savepoints.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${savepoints.pop()!}`);
      if (sql === 'ROLLBACK') {
        const name = savepoints.pop()!;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      return client.query(sql, values as never);
    },
    release: () => {},
  } as unknown as PoolClient;
  const database = Object.assign(Object.create(pool), {
    query: (sql: string, values?: unknown[]) => client.query(sql, values as never),
    connect: async () => scopedClient,
  }) as Pool & SignalWorkspaceCorpusPreparationDatabaseV1;
  const tx: SyntheticTransactionV1 = {
    database: pool,
    scoped: client,
    query: (sql, values) => client.query(sql, values as never) as never,
    cleanup: async () => {},
  };
  try {
    const smallPage = await syntheticImportedWorkspaceFixtureV1(tx, undefined, { root_count: 16, batch_size: 8 });
    const largePage = await syntheticImportedWorkspaceFixtureV1(tx, undefined, { root_count: 16, batch_size: 8 });
    const prepare = async (fixture: typeof smallPage, pageSize: number) => {
      const requested = await requestSignalWorkspaceCorpusPreparationStoreV1({ database,
        workspace_id: fixture.workspace_id, actor_user_id: fixture.actor_user_id, idempotency_key: randomUUID() });
      const workerJob = (await client.query('SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid',
        [requested.run_id])).rows[0]?.worker_job_id;
      assert.equal(typeof workerJob, 'string');
      const result = await signalWorkspaceCorpusPreparationJobV1({ id: workerJob as string,
        data: { run_id: requested.run_id }, updateProgress: async () => {} }, { database, page_size: pageSize });
      assert.equal(result.run_id, requested.run_id);
      await client.query('DROP TABLE IF EXISTS pg_temp.corpus_preparation_snapshot_roots, pg_temp.corpus_preparation_snapshot_sources');
      const census = (await client.query(`SELECT status,phase,counts FROM signal_corpus_preparation_runs
        WHERE id=$1::uuid`, [requested.run_id])).rows[0];
      const prepared = (await client.query(`SELECT mention.text_raw,mention.text_hash,item.disposition,
          item.semantic_eligible,asset.full_text,asset.text_sha256,asset.chunks
        FROM signal_corpus_preparation_items item
        JOIN mentions mention ON mention.id=item.root_id AND mention.workspace_id=item.workspace_id
        LEFT JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
          AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
        WHERE item.run_id=$1::uuid ORDER BY mention.text_raw`, [requested.run_id])).rows;
      return { census, prepared };
    };
    const three = await prepare(smallPage, 3);
    const hundred = await prepare(largePage, 100);
    assert.equal(three.census.status, 'completed');
    assert.equal(hundred.census.status, 'completed');
    assert.deepEqual(hundred.census, three.census);
    assert.deepEqual(hundred.prepared, three.prepared);
    assert.equal(hundred.prepared.length, 16);
    assert.ok(hundred.prepared.every(row => row.full_text === row.text_raw
      && row.text_hash === row.text_sha256 && row.disposition === 'eligible'
      && Array.isArray(row.chunks?.chunks)));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
