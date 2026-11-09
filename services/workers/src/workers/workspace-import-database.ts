import { setTimeout } from "node:timers/promises";
import type { Pool, QueryResultRow } from "pg";

export function createWorkspaceImportDatabase(
  database: Pick<Pool, "connect" | "query">,
  options: { acquisitionAttempts?: number; retryDelayMs?: number } = {}
) {
  const acquisitionAttempts = options.acquisitionAttempts ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 250;
  if (!Number.isSafeInteger(acquisitionAttempts) || acquisitionAttempts < 1 || acquisitionAttempts > 4
      || !Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 250) {
    throw new RangeError("Invalid workspace import connection wait.");
  }

  async function connect() {
    for (let attempt = 1; ; attempt += 1) {
      try { return await database.connect(); }
      catch (error) {
        if (attempt >= acquisitionAttempts || !(error instanceof Error)
            || error.message !== "timeout exceeded when trying to connect") throw error;
        await setTimeout(retryDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  // CSV callers use promise-based SQL only. Once a client is acquired, a write
  // may have committed even when its response fails, so execute it exactly once.
  async function query<R extends QueryResultRow>(text: string, values?: unknown[]) {
    const client = await connect();
    let queryError: Error | undefined;
    try { return await client.query<R>(text, values); }
    catch (error) {
      queryError = error instanceof Error ? error : new Error("Workspace import query failed.");
      throw error;
    } finally { client.release(queryError); }
  }

  return { connect, query: query as Pool["query"] };
}
