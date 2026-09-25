import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

import { guardEnvironment, guardDns, guardDatabase, sealedTableCount } from './target-guard.mjs';
import { identitySql, publicTables, verifyEmpty, schemaFingerprint } from './database-checks.mjs';
import { savepointQueryable } from './signal-imported-transaction.mjs';

const seal = JSON.parse(await readFile(new URL('./target-seal.json', import.meta.url), 'utf8'));
const report = { contract_version: 'consolidated-editor-private-receipt-v1', status: 'blocked', stage: 'preflight',
  remote_connected: false, fixture_mutations_started: false, provider_transports: 0,
  assertions: [], physical_rollback: false, post_rollback_empty: false };
let pool, client, outer = false, deadline, beforeSchema, tables;
const fixedError = error => /^noi19_dev_test_[a-z_]+$/u.test(error?.message ?? '')
  ? error.message : 'noi19_dev_test_editor_execution_failed';
// Only source path and line numbers; never SQL, parameters, fixture text or secrets.
const failureOrigin = error => (String(error?.stack ?? '').split('\n').slice(1)
  .map(line => line.match(/(?:file:\/\/)?\/app\/(infrastructure\/db\/[a-zA-Z0-9_./-]+|services\/workers\/src\/[a-zA-Z0-9_./-]+):(\d+):(\d+)/u))
  .find(Boolean)?.slice(1).join(':')) ?? null;
try {
  if (process.argv.length !== 2) throw Error('noi19_dev_test_arguments_invalid');
  if (sealedTableCount(seal, { requireExplicit: true }) !== 299) throw Error('noi19_dev_test_schema_mismatch');
  const connection = guardEnvironment(process.env, seal, 'NOISIA_CONSOLIDATED_EDITOR_PRIVATE_TEST_APPROVED');
  const addresses = await lookup(connection.host, { all: true }); guardDns(addresses);
  const denied = () => { report.provider_transports++; throw Error('noi19_dev_test_transport_forbidden'); };
  globalThis.fetch = denied; http.request = denied; http.get = denied; https.request = denied; https.get = denied;
  const { default: pg } = await import('pg');
  pool = new pg.Pool({ ...connection, host: addresses[0].address, ssl: false, max: 1,
    connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 360_000, application_name: 'consolidated-editor-private-synthetic-test' });
  client = await pool.connect(); report.remote_connected = true;
  deadline = setTimeout(() => { client.release(true); process.stderr.write('noi19_dev_test_timeout\n'); process.exit(1); }, 330_000);
  guardDatabase((await client.query(identitySql)).rows[0], seal, addresses.map(row => row.address));
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); outer = true;
  await client.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL jit=off; SET LOCAL lock_timeout='5s'");
  if (!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('noi19-private-dev-test-single-runner-v1',0)) locked")).rows[0].locked)
    throw Error('noi19_dev_test_runner_busy');
  tables = await publicTables(client, 299);
  await client.query(`LOCK TABLE ${tables.map(row => row.quoted).join(',')} IN SHARE MODE`);
  const empty = () => verifyEmpty(client, tables, 299);
  await empty();
  beforeSchema = await schemaFingerprint(client);
  if (beforeSchema !== seal.schema_sha256) throw Error('noi19_dev_test_schema_mismatch');
  const signatures = (await client.query(`SELECT
    to_regclass('public.signal_topic_consolidation_revisions') IS NOT NULL revisions,
    to_regclass('public.signal_topic_consolidation_decisions') IS NOT NULL decisions,
    to_regprocedure('public.prepare_signal_topic_consolidation_snapshot_v1(uuid,uuid,uuid,text)') IS NOT NULL prepare`)).rows[0];
  if (Object.values(signatures).some(value => value !== true)) throw Error('noi19_dev_test_schema_mismatch');
  const nested = savepointQueryable(client), query = nested.query;
  const scoped = Object.create(client); scoped.query = query; scoped.release = () => {};
  const database = Object.assign(Object.create(pool), { query, connect: async () => scoped });
  const { register } = await import('tsx/esm/api'); register();
  const { assertSignalTopicConsolidationEditionV1 } = await import('../../migrations/signal-topic-consolidation-edition.assertions.ts');
  report.fixture_mutations_started = true;
  await assertSignalTopicConsolidationEditionV1({ test: async (name, fn) => {
    await fn(); report.assertions.push({ name, status: 'passed' });
  } }, { database, scoped, query, onStage: stage => { report.stage = stage; } });
  if (nested.depth || report.assertions.length !== 1 || report.provider_transports !== 0)
    throw Error('noi19_dev_test_assertions_incomplete');
  await client.query('ROLLBACK'); outer = false; report.physical_rollback = true;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); outer = true;
  report.stage = 'rollback_verification'; await empty();
  if (await schemaFingerprint(client) !== beforeSchema) throw Error('noi19_dev_test_schema_changed');
  await client.query('ROLLBACK'); outer = false; report.post_rollback_empty = true;
  report.table_count = 299; report.schema_sha256 = beforeSchema; report.status = 'passed';
} catch (error) {
  report.error_code = fixedError(error);
  report.failure_origin = failureOrigin(error);
  report.error_class = ['AssertionError', 'SignalTopicConsolidationContractError', 'Error'].includes(error?.name) ? error.name : 'other';
  if (/^[A-Z0-9]{5}$/u.test(error?.code ?? '')) report.sqlstate = error.code;
  report.status = report.fixture_mutations_started ? 'failed' : 'blocked'; process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (client) {
    if (outer) await client.query('ROLLBACK').then(() => { report.physical_rollback = true; }).catch(() => {});
    if (process.exitCode && report.physical_rollback && tables && beforeSchema) {
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await verifyEmpty(client, tables, 299);
        if (await schemaFingerprint(client) !== beforeSchema) throw Error('noi19_dev_test_schema_changed');
        await client.query('ROLLBACK'); report.post_rollback_empty = true;
      } catch {
        await client.query('ROLLBACK').catch(() => {});
        report.error_code = 'noi19_dev_test_rollback_verification_failed';
      }
    }
    client.release();
  }
  if (pool) await pool.end().catch(() => {});
  process.stdout.write(JSON.stringify(report) + '\n');
}
