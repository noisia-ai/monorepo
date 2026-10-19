import pg from "pg";

declare global {
  var noisiaWorkerPgPool: pg.Pool | undefined;
  var noisiaWorkerNumericPgPool: pg.Pool | undefined;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const SSL_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disable", "disabled"]);

function databaseSslConfig() {
  const value = process.env.DATABASE_SSL?.trim().toLowerCase();
  return value && SSL_DISABLED_VALUES.has(value) ? false : { rejectUnauthorized: false };
}

// TODO mejora-futura: extraer este cliente a paquete compartido con tracing,
// retry y healthcheck para Studio + workers.
//
// Heavy analysis steps (T&B step 3 hierarchy, RAG corpus_sql, step 6 synthesis)
// aggregate over large corpora and can exceed Supabase's default 2min
// statement_timeout. The worker connects via the DIRECT connection
// (db.<ref>.supabase.co, see services/workers/.env which env/load applies last),
// where node-postgres' `statement_timeout` option is honored reliably for every
// pool.query() — no connect-event race needed. NOTE: this option is silently
// dropped by the Supabase POOLER (pooler.supabase.com), so it only works because
// the worker uses the direct host.
function createWorkerPool(max: number, lane: "control" | "numeric") {
  const database = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: databaseSslConfig(), max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 600_000,
  });
  // pg removes broken idle clients itself. Handle its EventEmitter error so a
  // transient socket failure does not terminate unrelated durable jobs. Query
  // and transaction failures still reject to their callers; no retry is added.
  database.on("error", () => console.warn(`[worker-db:${lane}] idle_connection_error`));
  return database;
}

// Preserve the existing total budget of three sessions. A long numeric
// transaction and its waiting heartbeat leave one shared session for drainers.
export const pool = globalThis.noisiaWorkerPgPool ??= createWorkerPool(2, "control");
export const numericPool = globalThis.noisiaWorkerNumericPgPool ??= createWorkerPool(1, "numeric");

export async function closeWorkerDatabasePoolsV1() {
  await Promise.all([pool.end(), numericPool.end()]);
}
