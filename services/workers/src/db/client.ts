import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

// TODO mejora-futura: extraer este cliente a paquete compartido con tracing,
// retry y healthcheck para Studio + workers.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
