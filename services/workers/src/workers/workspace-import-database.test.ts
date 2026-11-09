import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { createWorkspaceImportDatabase } from "./workspace-import-database";

const checkoutTimeout = () => new Error("timeout exceeded when trying to connect");

function fixture(acquisitionFailures: Error[], queryError?: Error) {
  let acquisitions = 0;
  let queries = 0;
  let releases = 0;
  const result = { rows: [{ included: 500 }], rowCount: 1 };
  const client = {
    query: async (sql: string, values: unknown[]) => {
      queries += 1;
      assert.equal(sql, "SELECT persist_csv_chunk($1)");
      assert.deepEqual(values, ["chunk-one"]);
      if (queryError) throw queryError;
      return result;
    },
    release() { releases += 1; }
  };
  const connect = async () => {
    acquisitions += 1;
    const error = acquisitionFailures.shift();
    if (error) throw error;
    return client;
  };
  const pool = {
    connect,
    query: async (sql: string, values: unknown[]) => {
      const acquired = await connect();
      try { return await acquired.query(sql, values); }
      finally { acquired.release(); }
    }
  } as unknown as Pick<Pool, "connect" | "query">;
  return { pool, result, counts: () => ({ acquisitions, queries, releases }) };
}

test("a CSV query survives temporary pool checkout timeouts and executes SQL once", async () => {
  const f = fixture([checkoutTimeout(), checkoutTimeout()]);
  const db = createWorkspaceImportDatabase(f.pool, { acquisitionAttempts: 3, retryDelayMs: 1 });
  assert.equal(await db.query("SELECT persist_csv_chunk($1)", ["chunk-one"]), f.result);
  assert.deepEqual(f.counts(), { acquisitions: 3, queries: 1, releases: 1 });
});

test("exhausted acquisition attempts stop before any SQL or client release", async () => {
  const last = checkoutTimeout();
  const f = fixture([checkoutTimeout(), last, checkoutTimeout()]);
  const db = createWorkspaceImportDatabase(f.pool, { acquisitionAttempts: 2, retryDelayMs: 1 });
  await assert.rejects(db.query("SELECT persist_csv_chunk($1)", ["chunk-one"]), error => error === last);
  assert.deepEqual(f.counts(), { acquisitions: 2, queries: 0, releases: 0 });
});

test("an acquisition failure unrelated to contention propagates without retry", async () => {
  const denied = Object.assign(new Error("password authentication failed"), { code: "28P01" });
  const f = fixture([denied]);
  const db = createWorkspaceImportDatabase(f.pool, { acquisitionAttempts: 3, retryDelayMs: 1 });
  await assert.rejects(db.query("SELECT persist_csv_chunk($1)", ["chunk-one"]), error => error === denied);
  assert.deepEqual(f.counts(), { acquisitions: 1, queries: 0, releases: 0 });
});

test("SQL failure is executed once and always releases the acquired connection", async () => {
  for (const error of [checkoutTimeout(), Object.assign(new Error("lost socket during write"), { code: "ECONNRESET" })]) {
    const f = fixture([checkoutTimeout()], error);
    const db = createWorkspaceImportDatabase(f.pool, { acquisitionAttempts: 3, retryDelayMs: 1 });
    await assert.rejects(db.query("SELECT persist_csv_chunk($1)", ["chunk-one"]), reason => reason === error);
    assert.deepEqual(f.counts(), { acquisitions: 2, queries: 1, releases: 1 });
  }
});

test("transaction checkout waits before handing one client to duplicate-import completion", async () => {
  const f = fixture([checkoutTimeout()]);
  const db = createWorkspaceImportDatabase(f.pool, { acquisitionAttempts: 2, retryDelayMs: 1 });
  const client = await db.connect();
  assert.deepEqual(f.counts(), { acquisitions: 2, queries: 0, releases: 0 });
  client.release();
  assert.deepEqual(f.counts(), { acquisitions: 2, queries: 0, releases: 1 });
});
