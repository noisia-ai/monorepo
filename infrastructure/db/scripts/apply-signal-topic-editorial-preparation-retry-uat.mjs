import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const requireStudio = createRequire(resolve(root, 'apps/studio/package.json'));
const { parse } = requireStudio('dotenv');
const { Client } = await import('pg');
const mode = process.argv[2];
const expected = {
  direct: 'sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19',
  pooler: 'sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815',
  project: 'sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32',
  migration: 'sha256:8308232dc89318797214a3ae2b936a5c3bf9f5d885d2ff6d34131e2c620c9142',
};
const filename = '0197_signal_topic_editorial_preparation_retry.sql';
const appName = 'noisia-uat-editorial-preparation-retry-0197';

function guard(condition, message) { if (!condition) throw new Error(message); }
function sha256(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function fingerprint(value) {
  const parsed = new URL(value);
  return sha256([parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || '5432',
    parsed.pathname.replace(/^\//u, ''), parsed.username].join('|'));
}
function projectHash(value, kind) {
  const parsed = new URL(value);
  const ref = kind === 'direct'
    ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];
  guard(ref, 'project_identity_unavailable');
  return sha256(ref);
}
function deriveDirect(value) {
  const parsed = new URL(value);
  const ref = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  guard(ref, 'canonical_pooler_shape_invalid');
  parsed.hostname = `db.${ref}.supabase.co`;
  parsed.port = '5432';
  parsed.username = 'postgres';
  return parsed.toString();
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

guard(['preflight', 'apply', 'verify'].includes(mode), 'mode_required');
guard(process.env.NOISIA_REMOTE_DATABASE_TARGET === 'noisia-staging', 'target_not_noisia_staging');
if (mode === 'apply') guard(process.env.NOISIA_UAT_EDITORIAL_PREPARATION_RETRY_0197_APPROVED === 'true', 'approval_missing');
const envPath = process.env.NOISIA_UAT_EDITORIAL_MIGRATION_ENV_FILE;
guard(Boolean(envPath), 'canonical_environment_file_required');
const env = parse(await readFile(envPath, 'utf8'));
const poolerUrl = env.DATABASE_URL?.trim();
guard(poolerUrl && env.DATABASE_SSL === 'true', 'canonical_staging_connection_unavailable');
const directUrl = deriveDirect(poolerUrl);
guard(fingerprint(poolerUrl) === expected.pooler && fingerprint(directUrl) === expected.direct
  && projectHash(poolerUrl, 'pooler') === expected.project && projectHash(directUrl, 'direct') === expected.project,
  'direct_pooler_target_mismatch');
const sql = await readFile(resolve(root, 'infrastructure/db/migrations', filename), 'utf8');
guard(sha256(sql) === expected.migration, 'migration_checksum_mismatch');

const signatures = {
  mark: 'public.mark_signal_topic_editorial_batch_preparation_failed_v2(uuid)',
  retry: 'public.retry_signal_topic_editorial_batch_preparation_v2(uuid,uuid,uuid,text)',
  guard: 'public.signal_topic_editorial_preparation_state_guard_v2()',
};
const functionName = (signature) => signature.slice('public.'.length).split('(')[0];
const protectedTables = [
  'signal_topic_editorial_batch_owners_v2',
  'signal_topic_editorial_provider_batches_v2',
  'signal_topic_editorial_batch_items_v2',
  'signal_topic_editorial_reused_decisions_v2',
];
let inspectStage = 'identity';

async function inspect(client) {
  const identity = (await client.query(`SELECT current_database() database_name,
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') table_count`)).rows[0];
  guard(identity.database_name === 'postgres', 'unexpected_database');
  inspectStage = 'functions';
  const { rows: functionRows } = await client.query(`SELECT p.proname function_name, p.oid::regprocedure::text signature,
      p.proowner::regrole::text owner_name, p.proacl::text acl,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') public_execute,
      CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
        THEN has_function_privilege('anon',p.oid,'EXECUTE') ELSE false END anon_execute,
      CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
        THEN has_function_privilege('authenticated',p.oid,'EXECUTE') ELSE false END authenticated_execute
    FROM pg_proc p WHERE p.oid IN (
      to_regprocedure($1),to_regprocedure($2),to_regprocedure($3))`, Object.values(signatures));
  const found = Object.fromEntries(functionRows.map(row => [row.function_name, {
    signature: row.signature,
    owner_name: row.owner_name, acl: row.acl,
    public_execute: row.public_execute, anon_execute: row.anon_execute,
    authenticated_execute: row.authenticated_execute,
  }]));
  inspectStage = 'constraint';
  const { rows: relations } = await client.query(`SELECT c.relname name,
      pg_get_constraintdef(co.oid) constraint_definition
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='signal_topic_editorial_batch_owners_v2'
      AND co.conname='signal_topic_editorial_batch_owners_v2_stage_check'`);
  const stageConstraint = relations[0]?.constraint_definition ?? null;
  inspectStage = 'trigger';
  const trigger = (await client.query(`SELECT EXISTS(SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='signal_topic_editorial_provider_batches_v2'
      AND t.tgname='topic_editorial_preparation_state_guard_v2' AND NOT t.tgisinternal) present`)).rows[0].present;
  inspectStage = 'base_objects';
  const baseObjects = (await client.query(`SELECT
    to_regclass('public.signal_topic_editorial_batch_owners_v2') IS NOT NULL owner_table,
    to_regclass('public.signal_topic_editorial_provider_batches_v2') IS NOT NULL batches_table,
    to_regclass('public.signal_topic_editorial_batch_items_v2') IS NOT NULL items_table,
    to_regclass('public.signal_topic_editorial_reused_decisions_v2') IS NOT NULL reuse_table`)).rows[0];
  const data = {};
  for (const name of protectedTables) {
    inspectStage = `protected_${name}`;
    const quoted = `public.${name}`;
    data[name] = (await client.query(`SELECT count(*)::int row_count,
      md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) row_digest
      FROM ${quoted} t`)).rows[0];
  }
  inspectStage = 'active_executions';
  const activeExecutions = (await client.query(`SELECT count(*)::int count
    FROM signal_topic_editorial_executions WHERE status IN ('queued','running')`)).rows[0].count;
  const present = Object.keys(signatures).every(key => found[functionName(signatures[key])]?.signature
    === signatures[key].slice('public.'.length));
  const complete = present && Boolean(baseObjects.owner_table && baseObjects.batches_table
      && baseObjects.items_table && baseObjects.reuse_table)
    && Boolean(stageConstraint?.includes('preparation_failed')) && trigger
    && Object.keys(data).length === protectedTables.length
    && Object.values(found).every(value => !value.public_execute && !value.anon_execute && !value.authenticated_execute);
  const absent = Object.keys(signatures).every(key => !found[functionName(signatures[key])]) && !trigger
    && Boolean(stageConstraint && !stageConstraint.includes('preparation_failed'));
  return { identity, baseObjects, functionObjects: found, stageConstraint, trigger,
    protectedData: data, activeExecutions, state: complete ? 'complete' : absent ? 'absent' : 'partial' };
}

function compareProtected(before, after) {
  guard(stable(before.protectedData) === stable(after.protectedData), 'protected_data_changed');
  guard(before.identity.table_count === after.identity.table_count, 'table_count_changed');
  guard(before.activeExecutions === after.activeExecutions, 'active_execution_count_changed');
}
function sameDb(left, right) {
  guard(left.state === right.state && stable(left.protectedData) === stable(right.protectedData)
    && left.identity.table_count === right.identity.table_count, 'direct_pooler_state_mismatch');
}
function emit(record) {
  console.log(JSON.stringify({ contract: 'noisia-uat-editorial-retry-migration-v1',
    target: 'noisia-staging', direct_fingerprint: expected.direct,
    pooler_fingerprint: expected.pooler, project_ref_hash: expected.project,
    migration: filename, checksum: expected.migration, ...record }));
}

const direct = new Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false }, application_name: appName });
let stage = 'connect_direct';
await direct.connect();
let committed = false;
try {
  stage = 'configure_direct';
  await direct.query("SET lock_timeout='5s'; SET statement_timeout='30s'; SET search_path=public,extensions,pg_temp");
  const pooler = new Client({ connectionString: poolerUrl, ssl: { rejectUnauthorized: false }, application_name: `${appName}-peer` });
  stage = 'connect_pooler';
  await pooler.connect();
  try {
    stage = 'configure_pooler';
    await pooler.query("SET statement_timeout='30s'; SET search_path=public,extensions,pg_temp");
    stage = 'inspect_before';
    const before = await inspect(direct);
    const peerBefore = await inspect(pooler);
    sameDb(before, peerBefore);
    guard(before.state !== 'partial', 'partial_migration_state_blocked');
    if (mode === 'preflight') {
      emit({ mode, state: before.state, writes_performed: false, active_executions: before.activeExecutions,
        tables: before.identity.table_count, sentinels: { base: before.baseObjects, functions: Object.keys(before.functionObjects),
          stage_constraint: before.stageConstraint, trigger: before.trigger }, protected_data: before.protectedData });
    } else if (mode === 'verify') {
      guard(before.state === 'complete', 'migration_not_complete');
      emit({ mode, state: before.state, writes_performed: false, tables: before.identity.table_count,
        sentinels: { base: before.baseObjects, functions: Object.keys(before.functionObjects), trigger: before.trigger },
        protected_data: before.protectedData });
    } else if (before.state === 'complete') {
      emit({ mode, state: 'complete', action: 'verified_existing', writes_performed: false,
        tables: before.identity.table_count, protected_data: before.protectedData });
    } else {
      guard(before.state === 'absent', 'migration_precondition_invalid');
      guard(before.activeExecutions === 0, 'active_v2_execution_blocks_migration');
      await direct.query("SELECT pg_advisory_lock(hashtextextended('noisia:uat:0197:editorial-preparation-retry',0))");
      try {
        await direct.query('BEGIN');
        await direct.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=public,extensions,pg_temp");
        await direct.query("SELECT pg_advisory_xact_lock(hashtextextended('noisia:uat:0197:editorial-preparation-retry',0))");
        const locked = await inspect(direct);
        guard(locked.state === 'absent' && locked.activeExecutions === 0, 'preflight_state_changed');
        guard(stable(locked.protectedData) === stable(before.protectedData), 'protected_state_changed_before_apply');
        await direct.query(sql);
        const after = await inspect(direct);
        guard(after.state === 'complete', 'migration_sentinels_incomplete');
        compareProtected(before, after);
        await direct.query('COMMIT');
        committed = true;
        const verifiedDirect = await inspect(direct);
        const verifiedPooler = await inspect(pooler);
        guard(verifiedDirect.state === 'complete' && verifiedPooler.state === 'complete', 'post_commit_verify_failed');
        compareProtected(before, verifiedDirect);
        sameDb(verifiedDirect, verifiedPooler);
        emit({ mode, state: 'complete', action: 'applied', writes_performed: true,
          tables: verifiedDirect.identity.table_count,
          sentinels: { base: verifiedDirect.baseObjects, functions: Object.keys(verifiedDirect.functionObjects),
            stage_constraint: verifiedDirect.stageConstraint, trigger: verifiedDirect.trigger },
          protected_data: verifiedDirect.protectedData });
      } catch (error) {
        await direct.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        await direct.query("SELECT pg_advisory_unlock(hashtextextended('noisia:uat:0197:editorial-preparation-retry',0))");
      }
    }
  } finally { await pooler.end(); }
  } catch (error) {
  console.error(JSON.stringify({ contract: 'noisia-uat-editorial-retry-migration-v1', mode, stage,
    inspect_stage: inspectStage,
    error: /^[a-z0-9_:-]{1,96}$/u.test(error?.message ?? '') ? error.message : 'migration_failed',
    sqlstate: /^[0-9A-Z]{5}$/u.test(error?.code ?? '') ? error.code : null,
    missing_function: /^function ([a-z_]+)\(/u.exec(error?.message ?? '')?.[1] ?? null,
    missing_operator: /^operator does not exist: ([a-z_]+) ([a-z_]+) ([a-z_]+)$/u.exec(error?.message ?? '')?.slice(1) ?? null,
    position: Number.isSafeInteger(Number(error?.position)) ? Number(error.position) : null,
    routine: /^[A-Za-z_]{1,80}$/u.test(error?.routine ?? '') ? error.routine : null,
    writes_performed: committed }));
  process.exitCode = 1;
} finally { await direct.end(); }
