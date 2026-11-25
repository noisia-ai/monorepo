import "server-only";
import { Pool, type PoolConfig } from "pg";
import { poolerBusy } from "./pooler";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The content pool. `next build` renders the study pages in several workers at once, each with its
 * own pool, and Supabase's session pooler allows 15 clients in all; one build went over and failed.
 * So during the build each worker opens one connection, and a query the pooler turns away because
 * it is full waits and tries again (up to 5 times, about 8 s in all) instead of failing the page.
 */
export function contentDb(): Pick<Pool, "query"> {
  const url = process.env.CONTENT_DATABASE_URL;
  if (!url) throw new Error("CONTENT_DATABASE_URL is not set");
  pool ??= new Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: process.env.NEXT_PHASE === "phase-production-build" ? 1 : 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000
  });
  const target = pool;
  const query = (async (...args: unknown[]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await (target.query as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        if (attempt >= 4 || !poolerBusy(error)) throw error;
        await sleep(400 * 2 ** attempt + Math.random() * 400);
      }
    }
  }) as Pool["query"];
  return { query };
}

/** Drafts are visible only in UAT, where the founder reviews a study before it goes live. */
export function showsDrafts(): boolean {
  return process.env.NOISIA_UAT === "1";
}
