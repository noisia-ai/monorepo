import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "@noisia/db";

declare global {
  var noisiaStudioPgPool: pg.Pool | undefined;
}

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  return createStudioPool({
    connectionString: process.env.DATABASE_URL,
    ssl: resolveDatabaseSsl(process.env.DATABASE_SSL),
    // This is a per-process budget shared by all Next route/RSC module evaluations.
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000
  });
}

/** Bound one-shot queries only: pg.Pool evicts their client on query errors.
 * A deadline on checked-out clients would require every transaction owner
 * (including Drizzle) to destroy the client when rollback cannot complete.
 * The optional deadline keeps socket-level regression tests fast; it is not
 * exposed as a runtime environment setting. No timed-out write is retried.
 */
export function createStudioPool(config: pg.PoolConfig, queryTimeoutMillis = 60_000): pg.Pool {
  const databasePool = new pg.Pool({ ...config, query_timeout: undefined });
  const query = databasePool.query;
  databasePool.query = function (this: pg.Pool, ...args: unknown[]) {
    const [input, ...rest] = args;
    if (typeof input === "string" || (input !== null && typeof input === "object" && !("submit" in input))) {
      const queryConfig = typeof input === "string" ? { text: input } : input;
      return Reflect.apply(query, this, [{ ...queryConfig, query_timeout: queryTimeoutMillis }, ...rest]);
    }
    // Preserve pg's custom Submittable and invalid-argument behavior unchanged.
    return Reflect.apply(query, this, args);
  } as pg.Pool["query"];
  return databasePool;
}

export function resolveDatabaseSsl(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "disable" || normalized === "disabled") {
    return false;
  }
  return { rejectUnauthorized: false };
}

// TODO mejora-futura: mover a un db client compartido con retry, tracing y
// health metrics cuando Studio y workers compartan observabilidad.
// Production bundles can evaluate this module independently, just like development reloads.
export const pool = globalThis.noisiaStudioPgPool ??= createPool();

export const db = drizzle(pool, { schema });
