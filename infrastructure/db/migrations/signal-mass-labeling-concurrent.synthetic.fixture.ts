import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg, { type Pool, type PoolClient } from "pg";
import { retryMassLabelingProductV2 } from "../signal-mass-labeling-product";
import { recoverMassLabelingJevReceiptsV1 } from "../../../services/workers/src/workers/signal-mass-labeling-jev-recovery";
import type { LabelingDatabaseV1 } from "../signal-mention-facets";
import type { WorkspaceEngineStorageV1 } from "../../../services/workers/src/workers/signal-workspace-engine-storage";

/** Concurrency needs committed invented rows in an isolated database. The
 * ordinary integration fixtures retain their physical rollback behavior. */
export async function createMassLabelingConcurrencyDatabaseV1(admin: Pool) {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.NOISIA_MFP_PG_CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "5432");
  assert.equal(target.pathname, "/noisia_mfp_ci");
  assert.equal(target.username, "postgres");
  const name = `noisia_mfp_recovery_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)} TEMPLATE template0`);
  target.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: target.href, max: 8 });
  const cleanup = async () => {
    try { await pool.end(); }
    finally { await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`); }
  };
  try {
    const result = await promisify(execFile)(process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("../scripts/smoke-migrations.ts", import.meta.url))], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)), maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, DATABASE_URL: target.href, DATABASE_SSL: "false",
          NOISIA_DB_SMOKE_RESET_SCHEMA: "true", NOISIA_DB_SMOKE_EMULATE_SUPABASE_ROLES: "true",
          NOISIA_MFP_PG_CI: "false" },
      });
    assert.match(result.stdout, /"ok": true/u);
    const migrations = (await readdir(new URL("./", import.meta.url))).filter(file => /^\d{4}_.+\.sql$/u.test(file)).length;
    assert.ok(result.stdout.includes(`"migrationsApplied": ${migrations}`));
    console.log(`# concurrent recovery database migrated independently with ${migrations} migrations`);
    return { pool, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/** Two receipt readers observe the original unknown call. Both reconcile on
 * independent PostgreSQL sessions while an operator's Retry waits on the same
 * workspace lock. The first mutation is held until both competitors wait. */
export async function assertConcurrentMassLabelingJevRecoveryV1(args: {
  database: LabelingDatabaseV1; run_id: string; workspace_id: string; actor_user_id: string;
  storage: WorkspaceEngineStorageV1;
}) {
  let openReaders!: () => void, firstLocked!: () => void, openFirst!: () => void, threeAttempts!: () => void;
  const readersGate = new Promise<void>(resolve => { openReaders = resolve; });
  const firstGate = new Promise<void>(resolve => { firstLocked = resolve; });
  const releaseGate = new Promise<void>(resolve => { openFirst = resolve; });
  const attemptsGate = new Promise<void>(resolve => { threeAttempts = resolve; });
  let readers = 0, lockAttempts = 0, paused = false;
  const pids = new Set<number>();
  const database = Object.assign(Object.create(args.database), {
    query: args.database.query.bind(args.database),
    connect: async () => {
      const client = await args.database.connect();
      pids.add((await client.query("SELECT pg_backend_pid() pid")).rows[0].pid);
      const query = async (sql: string, values?: unknown[]) => {
        const workspaceLock = sql.includes("pg_advisory_xact_lock") && sql.includes("'mfp-labeling:'");
        const result = client.query(sql, values);
        if (workspaceLock && ++lockAttempts === 3) threeAttempts();
        const response = await result;
        if (sql === "BEGIN") await client.query("SET LOCAL statement_timeout='15s'");
        if (workspaceLock && !paused) { paused = true; firstLocked(); await releaseGate; }
        return response;
      };
      return Object.assign(Object.create(client), { query, release: () => client.release() }) as PoolClient;
    },
  }) as Pool;
  const storage = { ...args.storage, async recoverIncomplete(input) {
    const stored = await args.storage.recoverIncomplete!(input);
    if (++readers === 2) openReaders();
    await readersGate;
    return stored;
  } } satisfies WorkspaceEngineStorageV1;
  const first = recoverMassLabelingJevReceiptsV1({ ...args, database, storage });
  const second = recoverMassLabelingJevReceiptsV1({ ...args, database, storage });
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("concurrent_recovery_gate_timeout")), 20_000);
  });
  first.catch(rejectFailure); second.catch(rejectFailure);
  let retry: ReturnType<typeof retryMassLabelingProductV2> | undefined;
  try {
    await Promise.race([firstGate, failure, deadline]);
    retry = retryMassLabelingProductV2({ ...args, database });
    retry.catch(rejectFailure);
    await Promise.race([attemptsGate, failure, deadline]);
    let blocked = 0;
    for (let attempt = 0; attempt < 20 && blocked !== 2; attempt++) {
      blocked = (await args.database.query(`SELECT count(*)::int n FROM pg_stat_activity
        WHERE pid=ANY($1::int[]) AND wait_event_type='Lock' AND wait_event='advisory'`, [[...pids]])).rows[0].n;
      if (blocked !== 2) await args.database.query("SELECT pg_sleep(0.01)");
    }
    assert.equal(blocked, 2, "second reconciler and Retry both wait behind the first real transaction");
  } finally {
    clearTimeout(timeout!);
    openReaders(); openFirst();
    await Promise.allSettled(retry ? [first, second, retry] : [first, second]);
  }
  const results = await Promise.all([first, second, retry!]);
  assert.equal(results[0].recovered + results[1].recovered, 1);
  assert.equal(results[2].run_id, args.run_id);
  assert.equal(pids.size, 3, "reconciliation and Retry use three independent PostgreSQL sessions");
  console.log("# two real reconciler sessions and one Retry session serialized; one receipt recovery committed");
}
