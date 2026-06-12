import pg from "pg";

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
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig(),
  statement_timeout: 600_000
});
