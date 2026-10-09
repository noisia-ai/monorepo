import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { privateAddress } from '../../infrastructure/db/scripts/noi19-dev-test/target-guard.mjs';
export const fail = code => { throw new Error(`mfp_${code}`); };
export function assertDisposableFixture(identity, suite) {
  if (!/^[a-z0-9-]+$/u.test(suite) || !new RegExp(`^${suite}-[a-z0-9]{6,}$`, 'u').test(identity?.fixture_key ?? ''))
    fail('disposable_fixture_required');
  return identity;
}
export async function verifyDisposableFixtureInDatabase(database, identity, suite) {
  assertDisposableFixture(identity, suite);
  const { rows } = await database.query(`SELECT 1
    FROM organizations o
    JOIN signal_workspaces w ON w.organization_id=o.id
    JOIN brands b ON b.id=w.brand_id AND b.organization_id=o.id
    JOIN users internal ON internal.id=$4 AND internal.organization_id=o.id
      AND internal.user_type='noisia_internal' AND internal.primary_role='noisia_admin' AND internal.status='active'
    JOIN users actor ON actor.id=$5 AND actor.organization_id=o.id
      AND actor.user_type='client' AND actor.primary_role='client_admin' AND actor.status='active'
    JOIN data_sources source ON source.id=$6 AND source.workspace_id=w.id
      AND source.organization_id=o.id AND source.brand_id=b.id
    WHERE o.id=$1 AND o.slug=$7 AND w.id=$2 AND b.id=$3`, [
      identity?.organization_id, identity?.workspace_id, identity?.brand_id,
      identity?.internal_user_id, identity?.actor_user_id, identity?.source_id,
      `mfp-${identity?.fixture_key}`,
    ]);
  if (rows.length !== 1) fail('fixture_database_identity_mismatch');
  return identity;
}
export async function readTarget() { return JSON.parse(await readFile(new URL('./target.json', import.meta.url), 'utf8')); }
export function checkTarget(env, target) {
  if (target.environment_id !== '5bad359d-cfa4-4e8f-aa41-98e6f075375a'
    || target.database_service_id !== '8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0'
    || target.database_host !== 'pgvector.railway.internal' || target.database_name !== 'noisia_mfp'
    || target.database_user !== 'noisia_mfp' || target.system_identifier !== '7683766906362679330') fail('target_invalid');
  if (!target.runner_service_id || !target.redis_service_id) fail('resources_not_registered');
  if (env.RAILWAY_ENVIRONMENT_ID !== target.environment_id || env.RAILWAY_ENVIRONMENT_NAME !== target.environment_name
    || env.RAILWAY_SERVICE_ID !== target.runner_service_id || env.NOISIA_MFP_ENABLED !== 'true') fail('remote_execution_required');
  if (Object.keys(env).some(key => /^(PG[A-Z_]*|DATABASE_PUBLIC_URL|NODE_OPTIONS|NODE_PATH)$/u.test(key) && env[key])) fail('connection_override');
  let db, redis;
  try { db = new URL(env.DATABASE_URL); redis = new URL(env.REDIS_URL); } catch { fail('private_connections_required'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== target.database_host || db.port !== '5432'
    || db.pathname !== `/${target.database_name}` || db.username !== target.database_user || !db.password || db.search || db.hash) fail('database_target_mismatch');
  if (redis.protocol !== 'redis:' || redis.hostname !== target.redis_host || redis.port !== '6379'
    || !redis.password || !['', '/', '/0'].includes(redis.pathname) || redis.search || redis.hash) fail('redis_target_mismatch');
  return { db, redis };
}
export async function openDatabase() {
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.NOISIA_MFP_PG_CI === 'true') {
    const db = new URL(process.env.DATABASE_URL ?? '');
    if (db.protocol !== 'postgresql:' || db.hostname !== '127.0.0.1' || db.port !== '5432'
      || db.pathname !== '/noisia_mfp_ci' || db.username !== 'postgres') fail('ci_database_target_mismatch');
    const { default: pg } = await import('../../infrastructure/db/node_modules/pg/lib/index.js');
    const pool = new pg.Pool({ connectionString: db.href, max: 4, connectionTimeoutMillis: 10000 });
    try {
      const { rows: [row] } = await pool.query(`SELECT current_database() AS database,
        current_setting('server_version_num')::int AS version,
        EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS pgvector`);
      if (row.database !== 'noisia_mfp_ci' || row.version < 170000 || row.version >= 180000
        || !row.pgvector) fail('ci_database_identity_mismatch');
      globalThis.noisiaStudioPgPool = pool;
      globalThis.noisiaWorkerPgPool = pool;
      globalThis.noisiaWorkerNumericPgPool = pool;
      return pool;
    } catch (error) { await pool.end(); throw error; }
  }
  const target = await readTarget();
  const { db, redis } = checkTarget(process.env, target);
  const [addresses, redisAddresses] = await Promise.all([lookup(db.hostname, { all: true }), lookup(redis.hostname, { all: true })]);
  if ([addresses, redisAddresses].some(rows => !rows.length || rows.some(row => !privateAddress(row.address)))) fail('dns_not_private');
  const { default: pg } = await import('../../infrastructure/db/node_modules/pg/lib/index.js');
  const pool = new pg.Pool({ host: addresses[0].address, port: 5432, database: target.database_name,
    user: target.database_user, password: decodeURIComponent(db.password), max: 4, connectionTimeoutMillis: 10000 });
  try {
    const { rows: [row] } = await pool.query(`SELECT current_database() AS database,current_user AS role,
      current_setting('server_version_num')::int AS version,host(inet_server_addr()) AS address,
      system_identifier::text FROM pg_control_system()`);
    if (row.database !== target.database_name || row.role !== target.database_user || row.version < 170000 || row.version >= 180000
      || row.system_identifier !== target.system_identifier || !addresses.some(address => address.address === row.address)) fail('database_identity_mismatch');
    const { rows } = await pool.query("SELECT extname FROM pg_extension WHERE extname='vector'");
    if (!rows.length) fail('pgvector_required');
    // Studio stores must reuse the verified, privately pinned pool.
    globalThis.noisiaStudioPgPool = pool;
    globalThis.noisiaWorkerPgPool = pool;
    globalThis.noisiaWorkerNumericPgPool = pool;
    return pool;
  } catch (error) { await pool.end(); throw error; }
}
export async function main(operation) {
  try { await operation(); }
  catch (error) {
    const code = /^mfp_[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'mfp_operation_failed';
    console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1;
  }
}
