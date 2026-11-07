import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';

test('migrated topic editorial configuration is exact, provider sends stay disabled, and private tables/functions remain private', {
  skip: process.env.NOISIA_MFP_PG_CI !== 'true', timeout: 30_000,
}, async () => {
  const { openDatabase } = await import(new URL('../../../scripts/dev-corpus/guard.mjs', import.meta.url).href);
  const pool: pg.Pool = await openDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const configuration = (await client.query('SELECT signal_topic_editorial_configuration_v1() body')).rows[0].body;
    assert.equal(configuration.screening.model, 'claude-sonnet-4-6');
    assert.equal(configuration.screening_batch_size, 40);
    assert.equal((await client.query(`SELECT signal_topic_editorial_source_v1($1::uuid) body`,
      ['00000000-0000-4000-8000-000000000001'])).rows[0].body, null,
    'an absent source cannot manufacture an editorial payload');
    for (const sql of [
      'SELECT reserve_signal_topic_editorial_call_v1(NULL,NULL,NULL,false)',
      'SELECT mark_sent_signal_topic_editorial_call_v1(NULL,NULL,NULL,false)',
      'SELECT assert_signal_topic_consolidation_worker_lease_v1(NULL,NULL,NULL,NULL)',
    ]) {
      await client.query('SAVEPOINT denied_provider_operation');
      await assert.rejects(client.query(sql), /topic_editorial_provider_disabled|topic_consolidation_lease_conflict/u);
      await client.query('ROLLBACK TO SAVEPOINT denied_provider_operation');
      await client.query('RELEASE SAVEPOINT denied_provider_operation');
    }
    const tables = (await client.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN
      ('signal_topic_editorial_executions','signal_topic_editorial_requests','signal_topic_editorial_calls',
       'signal_topic_editorial_outbox','signal_topic_editorial_request_keys') ORDER BY relname`)).rows;
    assert.equal(tables.length, 5);
    assert.ok(tables.every((table) => table.relrowsecurity), 'every private editorial table enforces RLS');
    const publicFunctions = (await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE n.nspname='public' AND (p.proname LIKE '%topic_editorial%v1'
        OR p.proname='assert_signal_topic_consolidation_worker_lease_v1') AND acl.grantee=0`)).rows;
    assert.deepEqual(publicFunctions, [], 'no editorial operational function is executable by PUBLIC');
    for (const table of tables) {
      assert.equal((await client.query(`SELECT count(*)::int count FROM ${table.relname}`)).rows[0].count, 0,
        'the migrated CI database starts without editorial execution data');
    }
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});

test('migrated numeric consolidation control stays private and empty without an authorized request', {
  skip: process.env.NOISIA_MFP_PG_CI !== 'true', timeout: 30_000,
}, async () => {
  const { openDatabase } = await import(new URL('../../../scripts/dev-corpus/guard.mjs', import.meta.url).href);
  const pool: pg.Pool = await openDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const config = (await client.query('SELECT signal_topic_consolidation_numeric_configuration_v1() body')).rows[0].body;
    assert.equal(config.contract_version, 'signal-topic-consolidation-config-v1');
    const tables = (await client.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN
      ('signal_topic_consolidation_executions','signal_topic_consolidation_request_keys','signal_topic_consolidation_outbox')`)).rows;
    assert.equal(tables.length, 3);
    assert.ok(tables.every((table) => table.relrowsecurity), 'control ledger tables enforce RLS');
    const publicFunctions = (await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE n.nspname='public' AND (p.proname LIKE '%signal_topic_consolidation%v1'
        OR p.proname='request_signal_topic_consolidation_v1') AND acl.grantee=0`)).rows;
    assert.deepEqual(publicFunctions, [], 'control functions are unavailable to PUBLIC');
    for (const table of tables) {
      assert.equal((await client.query(`SELECT count(*)::int count FROM ${table.relname}`)).rows[0].count, 0,
        'no synthetic request exists before the positive lifecycle test starts');
    }
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
