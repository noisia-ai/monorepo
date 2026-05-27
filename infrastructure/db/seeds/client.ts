import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { requireEnv } from "./env.js";

export const pool = new pg.Pool({
  connectionString: requireEnv("DATABASE_URL"),
  ssl: { rejectUnauthorized: false }
});

export const db = drizzle(pool);
