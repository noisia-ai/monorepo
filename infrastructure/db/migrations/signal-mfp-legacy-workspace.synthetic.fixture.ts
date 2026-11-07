import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { insertSignalTaxonomyDraftCoreV1 } from '../signal-taxonomy-profile';
import { loadSignalTopicInheritedContextStoreV1 } from '../signal-topic-catalog';
import { fixtureSha } from './signal-workspace-topic-projection.fixture';
import { seedSignalTopicEditorialRenewalSourceV1 } from './signal-topic-editorial-renewal.synthetic.fixture';
import type { SyntheticTransactionV1 } from './signal-client-workspace-entry.synthetic.fixture';

/** Migrated PostgreSQL CI fixture for still-live workspace v1 readers/writers.
 * It creates only invented import, preparation, embedding and engine rows inside
 * one physical transaction; all product BEGIN/COMMIT operations are savepoints. */
export async function signalMfpLegacyWorkspaceFixtureV1(options: { root_count?: number } = {}) {
  assert.equal(process.env.NOISIA_MFP_PG_CI, 'true', 'the fixture is limited to disposable migrated-schema CI');
  const { openDatabase } = await import(new URL('../../../scripts/dev-corpus/guard.mjs', import.meta.url).href);
  const pool: Pool = await openDatabase();
  const physical = await pool.connect();
  await physical.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await physical.query('SET LOCAL search_path=public,extensions,pg_temp');
  const stack: string[] = [];
  let sequence = 0;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('BEGIN')) {
      const key = `legacy_fixture_${++sequence}`;
      stack.push(key);
      return physical.query(`SAVEPOINT ${key}`);
    }
    if (sql === 'COMMIT') return physical.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if (sql === 'ROLLBACK') {
      const key = stack.pop();
      assert.ok(key, 'the synthetic fixture transaction is balanced');
      await physical.query(`ROLLBACK TO SAVEPOINT ${key}`);
      return physical.query(`RELEASE SAVEPOINT ${key}`);
    }
    return physical.query(sql, values);
  };
  const scoped = Object.assign(Object.create(physical) as PoolClient, { query, release: () => {} });
  const database = { query, connect: async () => scoped } as unknown as Pool;
  const cleanup = async () => {
    assert.equal(stack.length, 0, 'product transactions are closed before physical rollback');
    await physical.query('ROLLBACK');
    physical.release();
    await pool.end();
  };
  const transaction: SyntheticTransactionV1 = { database, scoped, query: query as never, cleanup };
  try {
    const seed = await seedSignalTopicEditorialRenewalSourceV1({ ...transaction, root_count: options.root_count });
    const workspace_id = seed.scope.workspace_id, actor_user_id = seed.scope.actor_user_id;
    const engine = (await query(`SELECT embedding_run_id FROM signal_topic_catalog_executions
      WHERE id=$1::uuid AND input_contract='workspace-topic-engine-v1'`, [seed.source_engine_execution_id])).rows[0];
    assert.ok(engine?.embedding_run_id, 'the source engine execution retains its actual embedding run');
    const embedding_run_id = engine.embedding_run_id as string;
    const access = { database, workspace_id, actor_user_id };
    const catalog = async () => {
      const context = await loadSignalTopicInheritedContextStoreV1({ queryable: database, workspace_id, complete_context: true });
      return insertSignalTaxonomyDraftCoreV1({ client: scoped, workspace_id, kind: 'topic',
        context_hash: fixtureSha('mfp-legacy-empty-catalog'), terms: [], rules: { topics: [] }, rule_set_metadata: {},
        provider: 'operator', model_version: 'synthetic-test', prompt_hash: fixtureSha('synthetic'), model_metadata: {},
        profile_metadata: { contract_version: 'signal-topic-catalog-v1' }, context_refs: context.context_refs });
    };
    return { ...transaction, ...seed, database, query, workspace_id, actor_user_id, embedding_run_id, access, catalog, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
