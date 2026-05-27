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
    ssl: { rejectUnauthorized: false }
  });
}

// TODO mejora-futura: mover a un db client compartido con retry, tracing y
// health metrics cuando Studio y workers compartan observabilidad.
export const pool = globalThis.noisiaStudioPgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.noisiaStudioPgPool = pool;
}

export const db = drizzle(pool, { schema });
