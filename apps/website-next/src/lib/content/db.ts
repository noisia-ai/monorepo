import "server-only";
import { Pool, type PoolConfig } from "pg";

/**
 * Connection to the content database (its own Supabase project, never Studio's).
 * The site connects as `website_runtime`, which can only read published content; UAT connects
 * as `website_review`, which also sees drafts. Without CONTENT_DATABASE_URL the site reads the
 * JSON files in the repo instead, so local work and older environments keep running.
 */

let pool: Pool | null = null;

function sslFor(url: string): PoolConfig["ssl"] {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (host === "localhost" || host === "127.0.0.1") return undefined;
  // Supabase signs its certificates with its own root CA. Pass it to verify the server;
  // without it the connection is still encrypted but the certificate is not checked.
  const ca = process.env.CONTENT_DATABASE_CA?.replace(/\\n/g, "\n");
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function contentDatabaseConfigured(): boolean {
  return Boolean(process.env.CONTENT_DATABASE_URL);
}

export function contentDb(): Pool {
  const url = process.env.CONTENT_DATABASE_URL;
  if (!url) throw new Error("CONTENT_DATABASE_URL is not set");
  pool ??= new Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000
  });
  return pool;
}

/** Drafts are visible only in UAT, where the founder reviews a study before it goes live. */
export function showsDrafts(): boolean {
  return process.env.NOISIA_UAT === "1";
}
