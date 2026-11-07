import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { syntheticClientWorkspaceFixtureV1, type SyntheticTransactionV1 } from './signal-client-workspace-entry.synthetic.fixture';

/** Migrated PostgreSQL CI fixture for still-live workspace v1 readers/writers.
 * It creates only invented import, preparation, embedding and engine rows inside
 * one physical transaction; all product BEGIN/COMMIT operations are savepoints. */
export async function signalMfpLegacyWorkspaceFixtureV1() {
  assert.equal(process.env.NOISIA_MFP_PG_CI, 'true', 'the fixture is limited to disposable migrated-schema CI');
  const { openDatabase } = await import(new URL('../../../scripts/dev-corpus/guard.mjs', import.meta.url).href);
  const pool: Pool = await openDatabase();
  const physical = await pool.connect();
  await physical.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
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
    return await syntheticClientWorkspaceFixtureV1(transaction);
  } catch (error) {
    await cleanup();
    throw error;
  }
}
