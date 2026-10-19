import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { getDatabaseSslConfig } from "./connection.js";
import { requireEnv } from "./env.js";

export const pool = new pg.Pool({
  connectionString: requireEnv("DATABASE_URL"),
  ssl: getDatabaseSslConfig()
});

export const db = drizzle(pool);
