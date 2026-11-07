import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { main, openDatabase } from './guard.mjs';

await main(async () => {
  let phase = 'open_database';
  const pool = await openDatabase();
  const client = await pool.connect();
  const schema = `mfp_digest_${process.pid}_${Date.now().toString(36)}`;
  const mark = (next: string) => {
    phase = next;
    console.log(JSON.stringify({ gate: 'mentions_text_digest_postgres', phase }));
  };
  try {
    mark('seed_legacy_rows');
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path=${schema},public,extensions`);
    await client.query('CREATE TABLE mentions(id uuid PRIMARY KEY,text_clean text NOT NULL,metadata text)');
    const legacy = [
      ['00000000-0000-4000-8000-000000000001', 'plain legacy text'],
      ['00000000-0000-4000-8000-000000000002', 'Texto con acento: canción'],
      ['00000000-0000-4000-8000-000000000003', 'NFD: café ☕'],
    ];
    for (const [id, text] of legacy) await client.query('INSERT INTO mentions(id,text_clean) VALUES($1,$2)', [id, text]);
    const migration = async (name: string) => {
      const sql = await readFile(new URL(`../../infrastructure/db/migrations/${name}`, import.meta.url), 'utf8');
      // The numbered migrations have already run in public. Reapply their exact
      // DDL in a rollback-only synthetic schema; the function path must resolve
      // that schema so it operates on these invented rows only.
      return client.query(sql.replaceAll('SET search_path=pg_catalog,public,extensions',
        `SET search_path=pg_catalog,${schema},public,extensions`));
    };
    mark('apply_initial_migration');
    await migration('0167_signal_mentions_text_digest.sql');
    mark('assert_backfill_acl');
    const missingBeforeBackfill = await client.query('SELECT count(*)::int count FROM mentions WHERE text_clean_sha256 IS NULL');
    assert.equal(missingBeforeBackfill.rows[0].count, 3, 'stage one does not rewrite legacy rows');
    const publicExecute = await client.query(`SELECT NOT EXISTS(
      SELECT 1 FROM pg_proc function CROSS JOIN LATERAL
        aclexplode(COALESCE(function.proacl,acldefault('f',function.proowner))) privilege
      WHERE function.oid='backfill_signal_mention_text_clean_sha256_v1(integer)'::regprocedure
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') revoked`);
    assert.equal(publicExecute.rows[0].revoked, true, 'PUBLIC cannot execute the backfill helper');
    const publicRead = await client.query(`SELECT NOT EXISTS(
      SELECT 1 FROM pg_class relation CROSS JOIN LATERAL
        aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) privilege
      WHERE relation.oid='signal_mention_text_digest_backfill_state'::regclass AND privilege.grantee=0) revoked`);
    assert.equal(publicRead.rows[0].revoked, true, 'PUBLIC cannot access backfill state');
    const apiAcl = await client.query(`SELECT count(*)::int role_count,
      bool_and(NOT (has_function_privilege(role.oid,'backfill_signal_mention_text_clean_sha256_v1(integer)'::regprocedure,'EXECUTE')
        OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'SELECT')
        OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'INSERT')
        OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'UPDATE')
        OR has_table_privilege(role.oid,'signal_mention_text_digest_backfill_state'::regclass,'DELETE'))) protected
      FROM pg_roles role WHERE role.rolname=ANY(ARRAY['anon','authenticated'])`);
    assert.deepEqual(apiAcl.rows[0], { role_count: 2, protected: true }, 'API roles cannot execute or access backfill state');
    mark('incomplete_finalize_guard');
    await client.query('SAVEPOINT incomplete_backfill');
    await assert.rejects(migration('0168_signal_mentions_text_digest_finalize.sql'), /signal_mentions_text_digest_backfill_incomplete/u);
    await client.query('ROLLBACK TO SAVEPOINT incomplete_backfill');
    await client.query('RELEASE SAVEPOINT incomplete_backfill');
    mark('bounded_backfill');
    for (let index = 0; index < legacy.length; index += 1) {
      const changed = await client.query('SELECT backfill_signal_mention_text_clean_sha256_v1(1) changed');
      assert.equal(changed.rows[0].changed, 1, 'bounded calls advance by one legacy row');
    }
    assert.equal((await client.query('SELECT backfill_signal_mention_text_clean_sha256_v1(1) changed')).rows[0].changed, 0);
    const invalidLimit = async (limit: number) => {
      await client.query('SAVEPOINT bad_backfill_limit');
      await assert.rejects(client.query('SELECT backfill_signal_mention_text_clean_sha256_v1($1)', [limit]),
        /signal_mentions_text_digest_backfill_limit_invalid/u);
      await client.query('ROLLBACK TO SAVEPOINT bad_backfill_limit');
      await client.query('RELEASE SAVEPOINT bad_backfill_limit');
    };
    await invalidLimit(0);
    await invalidLimit(10001);
    const behindCursorId = legacy[0]![0];
    await client.query('ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256');
    await client.query('UPDATE mentions SET text_clean_sha256=NULL WHERE id=$1::uuid', [behindCursorId]);
    await client.query('ALTER TABLE mentions ENABLE TRIGGER trg_signal_mention_text_clean_sha256');
    await client.query("UPDATE mentions SET metadata='repair-null' WHERE id=$1::uuid", [behindCursorId]);
    assert.notEqual((await client.query('SELECT text_clean_sha256 FROM mentions WHERE id=$1::uuid', [behindCursorId])).rows[0].text_clean_sha256,
      null, 'ordinary metadata updates repair a legacy NULL digest');

    await client.query('ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256');
    await client.query('UPDATE mentions SET text_clean_sha256=NULL WHERE id=$1::uuid', [behindCursorId]);
    await client.query('ALTER TABLE mentions ENABLE TRIGGER trg_signal_mention_text_clean_sha256');
    assert.equal((await client.query('SELECT backfill_signal_mention_text_clean_sha256_v1(1) changed')).rows[0].changed, 1,
      'backfill resets its cursor and drains a NULL introduced behind the last ID');
    assert.equal((await client.query('SELECT backfill_signal_mention_text_clean_sha256_v1(1) changed')).rows[0].changed, 0,
      'cursor reset reaches completion after the late NULL has been repaired');
    mark('finalize_migrations');
    await migration('0168_signal_mentions_text_digest_finalize.sql');
    await migration('0169_signal_mentions_text_digest_validate.sql');
    mark('verify_digest_trigger');
    const digests = await client.query(`SELECT count(*)::int count,
      bool_and(text_clean_sha256='sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex')) exact,
      bool_and(text_clean_sha256 IS NOT NULL) present FROM mentions`);
    assert.deepEqual(digests.rows[0], { count: 3, exact: true, present: true });
    await client.query(`INSERT INTO mentions(id,text_clean) VALUES('00000000-0000-4000-8000-000000000004','trigger computed')`);
    const triggered = await client.query(`SELECT text_clean_sha256='sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') exact
      FROM mentions WHERE id='00000000-0000-4000-8000-000000000004'`);
    assert.equal(triggered.rows[0].exact, true, 'new rows receive a byte-exact digest');
    await client.query("UPDATE mentions SET text_clean='changed with λ' WHERE id='00000000-0000-4000-8000-000000000004'");
    const updated = await client.query(`SELECT text_clean_sha256='sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') exact
      FROM mentions WHERE id='00000000-0000-4000-8000-000000000004'`);
    assert.equal(updated.rows[0].exact, true, 'text updates recalculate the digest');
    const repaired = await client.query(`UPDATE mentions SET text_clean_sha256=$1 WHERE id='00000000-0000-4000-8000-000000000004'
      RETURNING text_clean_sha256='sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex') exact`, [`sha256:${'0'.repeat(64)}`]);
    assert.equal(repaired.rows[0].exact, true, 'the trigger repairs direct digest adulteration');
    await client.query('SAVEPOINT exact_digest_check');
    await client.query('ALTER TABLE mentions DISABLE TRIGGER trg_signal_mention_text_clean_sha256');
    await assert.rejects(client.query("UPDATE mentions SET text_clean_sha256=$1 WHERE id='00000000-0000-4000-8000-000000000004'",
      [`sha256:${'f'.repeat(64)}`]), (error: unknown) => Boolean(error && typeof error === 'object'
        && 'constraint' in error && error.constraint === 'mentions_text_clean_sha256_exact'),
    'the exact CHECK still rejects adulteration when the trigger is disabled');
    await client.query('ROLLBACK TO SAVEPOINT exact_digest_check');
    await client.query('RELEASE SAVEPOINT exact_digest_check');
    assert.equal((await client.query("SELECT to_regprocedure('backfill_signal_mention_text_clean_sha256_v1(integer)') IS NULL removed")).rows[0].removed, true,
      'finalization removes the bounded helper');
    assert.equal((await client.query("SELECT to_regclass('signal_mention_text_digest_backfill_state') IS NULL removed")).rows[0].removed, true,
      'finalization removes private backfill state');
    console.log(JSON.stringify({ status: 'passed', gate: 'mentions_text_digest_postgres', rows: 4, providers: 0 }));
  } catch (error) {
    throw new Error(`mfp_mentions_digest_${phase}`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
