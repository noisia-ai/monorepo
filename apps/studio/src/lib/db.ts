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

  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: resolveDatabaseSsl(process.env.DATABASE_SSL),
    // This is a per-process budget shared by all Next route/RSC module evaluations.
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000
  });
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
