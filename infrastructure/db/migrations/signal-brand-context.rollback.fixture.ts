import assert from "node:assert/strict";
import type { Pool, PoolClient, QueryConfig } from "pg";

/** Test-only transaction harness. The caller must validate the destination before
 * supplying this connected client. This module has no credentials, connection
 * constructor, migration, schema bypass, queue or provider.
 *
 * verify("before") must acquire the dedicated runner's locks and validate empty
 * tables/schema. verify("after") checks the same baseline in a fresh snapshot. */
export async function withBrandContextSyntheticRollbackV1<T>(args: {
  client: PoolClient;
  verify: (client: PoolClient, phase: "before" | "after") => Promise<void>;
  run: (tx: { database: Pool; scoped: PoolClient }) => Promise<T>;
}): Promise<T> {
  const physical = args.client;
  const stack: string[] = [];
  let serial = 0;
  const query = async (sql: string | QueryConfig, values?: unknown[]) => {
    const text = (typeof sql === "string" ? sql : sql.text).trim();
    if (/^BEGIN\b/iu.test(text)) {
      assert.ok(!text.replace(/;$/u, "").includes(";"), "fixture transaction control must be one statement");
      const savepoint = `brand_context_fixture_${++serial}`;
      const result = await physical.query(`SAVEPOINT ${savepoint}`);
      stack.push(savepoint);
      return result;
    }
    if (/^(?:COMMIT|ROLLBACK)\b/iu.test(text)) {
      assert.match(text, /^(?:COMMIT|ROLLBACK)\s*;?$/iu, "fixture does not forward outer transaction control");
      const savepoint = stack.at(-1);
      assert.ok(savepoint, "fixture transaction is unbalanced");
      if (/^ROLLBACK/iu.test(text)) await physical.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      const result = await physical.query(`RELEASE SAVEPOINT ${savepoint}`);
      stack.pop();
      return result;
    }
    assert.ok(!/^(?:START\s+TRANSACTION|END|ABORT)\b/iu.test(text), "fixture transaction control unsupported");
    return physical.query(sql, values);
  };
  const scoped = Object.assign(Object.create(physical) as PoolClient, { query, release: () => {} });
  const database = { query, connect: async () => scoped } as unknown as Pool;
  await physical.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    await args.verify(physical, "before");
    const result = await args.run({ database, scoped });
    assert.equal(stack.length, 0, "fixture left a product transaction open");
    return result;
  } finally {
    // Only the physical connection owns this ROLLBACK. A lost ACK from the body
    // never permits replay/reconnect here; rollback verification must also pass.
    await physical.query("ROLLBACK");
    await physical.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try { await args.verify(physical, "after"); }
    finally { await physical.query("ROLLBACK"); }
  }
}
