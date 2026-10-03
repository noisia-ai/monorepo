import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { Client } = createRequire(import.meta.url)('pg');
const mode = process.argv[2];
const expected = {
  RAILWAY_PROJECT_ID: 'b7b7b325-f273-4eb6-80e0-d66e266159b2',
  RAILWAY_ENVIRONMENT_ID: '13f17965-6ae3-4b5f-bcf3-08b496ff5d54',
  RAILWAY_SERVICE_ID: '184f8966-0cac-4bb0-85bb-9348abde594f',
  RAILWAY_ENVIRONMENT_NAME: 'uat',
  RAILWAY_SERVICE_NAME: 'studio-uat',
};
const sqlPath = new URL('../migrations/0185_signal_topic_consolidation_snapshot_binding.sql', import.meta.url);
const expectedSha = '49b5162506f9fef4127c58a4310aa172cafea8975b90654319e3c2cefeb96a92';
const procedure = 'public.prepare_signal_topic_consolidation_snapshot_v1(uuid,uuid,uuid,text)';
const previousBinding = /\bsource\s*:=\s*signal_topic_editorial_source_v1\s*\(/u;
const correctedBinding = /\bsource_binding\s*:=\s*signal_topic_editorial_source_v1\s*\(/u;

function guard(condition, message) {
  if (!condition) throw new Error(message);
}

guard(['--preflight', '--apply', '--verify'].includes(mode), 'mode_required');
for (const [key, value] of Object.entries(expected)) guard(process.env[key] === value, `wrong_target_${key}`);
guard(Boolean(process.env.DATABASE_URL), 'database_missing');
if (mode === '--apply') guard(process.env.NOISIA_UAT_0185_APPROVED === 'true', 'approval_missing');
const sql = await readFile(sqlPath, 'utf8');
const actualSha = createHash('sha256').update(sql).digest('hex');
guard(actualSha === expectedSha, 'sql_hash_mismatch');

const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'noisia-uat-0185-snapshot-binding' });
await client.connect();

async function inspect() {
  const { rows } = await client.query(`SELECT current_database() database_name,
      current_user database_user,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') table_count,
      to_regclass('public.signal_topic_consolidation_revisions')::text revision_table,
      p.oid::regprocedure::text procedure_name,
      p.proowner::regrole::text function_owner,
      p.proacl::text function_acl,
      pg_get_functiondef(p.oid) definition,
      (SELECT count(*)::int FROM signal_topic_consolidation_revisions) revision_count,
      (SELECT count(*)::int FROM signal_topic_consolidation_snapshots) snapshot_count
    FROM pg_proc p WHERE p.oid=to_regprocedure($1)`, [procedure]);
  const row = rows[0];
  guard(row?.revision_table && row.procedure_name, '0181_prerequisite_missing');
  guard(row.database_name !== 'noisia_dev_test', 'dev_test_is_not_uat');
  const state = correctedBinding.test(row.definition) ? 'corrected'
    : previousBinding.test(row.definition) ? 'previous' : 'unknown';
  guard(state !== 'unknown', 'function_body_drift');
  const { definition, ...safe } = row;
  return { ...safe, state };
}

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
  const before = await inspect();
  if (mode === '--preflight') {
    guard(before.state === 'previous', '0185_already_applied');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ mode, sql_sha256: actualSha, before, committed: false }));
  } else if (mode === '--verify') {
    guard(before.state === 'corrected', '0185_not_applied');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ mode, sql_sha256: actualSha, observed: before, committed: false }));
  } else {
    guard(before.state === 'previous', '0185_already_applied');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('uat-migration-0185',0))");
    const locked = await inspect();
    guard(JSON.stringify(locked) === JSON.stringify(before), 'preflight_drift');
    await client.query(sql);
    const after = await inspect();
    guard(after.state === 'corrected', '0185_install_missing');
    for (const key of ['database_name', 'database_user', 'table_count', 'revision_table', 'procedure_name',
      'function_owner', 'function_acl', 'revision_count', 'snapshot_count']) {
      guard(after[key] === before[key], `protected_state_changed_${key}`);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode, sql_sha256: actualSha, before, after, committed: true }));
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(JSON.stringify({ mode, error: error?.message ?? 'unknown', committed: false }));
  process.exitCode = 1;
} finally {
  await client.end();
}
