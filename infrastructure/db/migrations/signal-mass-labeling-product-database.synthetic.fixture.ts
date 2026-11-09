import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg, { type Pool } from "pg";

/** Cross-connection product journeys need real commits. Keep them outside the
 * migrated CI database used by legacy rollback fixtures and their empty census.
 * No caller-provided host, database name, or cleanup target is accepted. */
export async function createMassLabelingProductDatabaseFixtureV1(): Promise<{
  database: Pool; cleanup: () => Promise<void>;
}> {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.NOISIA_MFP_PG_CI, "true");
  const pinned = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(pinned.protocol, "postgresql:");
  assert.equal(pinned.hostname, "127.0.0.1");
  assert.equal(pinned.port, "5432");
  assert.equal(pinned.pathname, "/noisia_mfp_ci");
  assert.equal(pinned.username, "postgres");
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const owner: Pool = await openDatabase(); // Existing PG17/vector/identity guard.
  const census=async()=>(await owner.query(`SELECT (SELECT count(*) FROM organizations)::text organizations,
    (SELECT count(*) FROM users)::text users,(SELECT count(*) FROM brands)::text brands,
    (SELECT count(*) FROM signal_labeling_runs)::text runs,(SELECT count(*) FROM engine_cost_events)::text costs`)).rows[0];
  const baseline=await census();
  const name = `noisia_mfp_ci_product_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^noisia_mfp_ci_product_[a-f0-9]{32}$/u);
  const identifier = pg.escapeIdentifier(name);
  const globals=globalThis as typeof globalThis & {
    noisiaStudioPgPool?:Pool;noisiaWorkerPgPool?:Pool;noisiaWorkerNumericPgPool?:Pool;
  };
  let database: Pool | undefined, created = false, cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      for(const key of ['noisiaStudioPgPool','noisiaWorkerPgPool','noisiaWorkerNumericPgPool'] as const){
        if(globals[key]===database)delete globals[key];
      }
      await database?.end();
      if (created) await owner.query(`DROP DATABASE ${identifier}`);
      assert.deepEqual(await census(),baseline,"product journey leaves the pinned CI database census unchanged");
    } finally { await owner.end(); }
  };
  try {
    await owner.query(`CREATE DATABASE ${identifier} TEMPLATE template0`);
    created = true;
    const target = new URL(pinned);
    target.pathname = `/${name}`;
    const env = { ...process.env, DATABASE_URL: target.href, DATABASE_SSL: "false",
      NOISIA_DB_SMOKE_RESET_SCHEMA: "false", NOISIA_DB_SMOKE_EMULATE_SUPABASE_ROLES: "false",
      NOISIA_DB_SMOKE_ALLOW_REMOTE: "false" };
    const migration = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../scripts/smoke-migrations.ts", import.meta.url))],
      { env, encoding: "utf8", timeout: 180_000, maxBuffer: 2_000_000 });
    assert.equal(migration.status, 0, migration.stdout + migration.stderr);
    assert.match(migration.stdout, /"ok": true/u);
    database = new pg.Pool({ connectionString: target.href, ssl: false, max: 4, connectionTimeoutMillis: 10_000 });
    const identity = (await database.query(`SELECT current_database() name,current_user role,
      current_setting('server_version_num')::int version,EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') vector`)).rows[0]!;
    assert.equal(identity.name, name); assert.equal(identity.role, "postgres");
    assert.ok(identity.version >= 170000 && identity.version < 180000); assert.equal(identity.vector, true);
    globals.noisiaStudioPgPool = database;
    globals.noisiaWorkerPgPool = database;
    globals.noisiaWorkerNumericPgPool = database;
    return { database, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
