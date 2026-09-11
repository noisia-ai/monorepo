import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient, QueryConfig } from "pg";
import { withBrandContextSyntheticRollbackV1 } from "./signal-brand-context.rollback.fixture";

function recording() {
  const queries: Array<string | QueryConfig> = [];
  const queryValues: Array<unknown[] | undefined> = [];
  const client = { query: async (sql: string | QueryConfig, values?: unknown[]) => {
    queries.push(sql); queryValues.push(values); return { rows: [], rowCount: 0 };
  } } as unknown as PoolClient;
  return { client, queries, queryValues };
}

test("injected PG harness maps string and Drizzle controls to savepoints and rolls back physically", async () => {
  const { client, queries, queryValues } = recording();
  const verified: string[] = [];
  const config = { text: "SELECT $1::text AS invented", rowMode: "array" };
  const parameters = ["synthetic"];
  await withBrandContextSyntheticRollbackV1({ client,
    verify: async (_, phase) => { verified.push(phase); },
    run: async ({ database }) => {
      const first = await database.connect();
      await first.query("BEGIN");
      await first.query(config, parameters);
      const nested = await database.connect();
      await nested.query({ text: "begin isolation level serializable" });
      await nested.query({ text: "rollback" });
      await first.query("COMMIT");
    } });
  assert.deepEqual(verified, ["before", "after"]);
  assert.strictEqual(queries[2], config, "ordinary Drizzle query config must be preserved");
  assert.strictEqual(queryValues[2], parameters, "Drizzle supplies parameters separately from QueryConfig");
  assert.deepEqual(queries.filter(row => typeof row === "string"), [
    "BEGIN ISOLATION LEVEL READ COMMITTED", "SAVEPOINT brand_context_fixture_1",
    "SAVEPOINT brand_context_fixture_2", "ROLLBACK TO SAVEPOINT brand_context_fixture_2",
    "RELEASE SAVEPOINT brand_context_fixture_2", "RELEASE SAVEPOINT brand_context_fixture_1",
    "ROLLBACK", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "ROLLBACK" ]);
});

test("lost ACK after logical commit still requires physical rollback and fresh verification", async () => {
  const { client, queries } = recording();
  const verified: string[] = [];
  const lost = new Error("synthetic lost ACK");
  await assert.rejects(withBrandContextSyntheticRollbackV1({ client,
    verify: async (_, phase) => { verified.push(phase); },
    run: async ({ database }) => { await database.query("BEGIN"); await database.query("COMMIT"); throw lost; }
  }), error => error === lost);
  assert.deepEqual(verified, ["before", "after"]);
  assert.deepEqual(queries.slice(-3), ["ROLLBACK", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "ROLLBACK"]);
});

test("guard failure prevents body and unbalanced product controls cannot commit the outer fixture", async () => {
  const first = recording(); let bodyCalls = 0;
  await assert.rejects(withBrandContextSyntheticRollbackV1({ client: first.client,
    verify: async (_, phase) => { if (phase === "before") throw Error("synthetic target blocked"); },
    run: async () => { bodyCalls++; }
  }), /target blocked/);
  assert.equal(bodyCalls, 0);
  const second = recording();
  await assert.rejects(withBrandContextSyntheticRollbackV1({ client: second.client, verify: async () => {},
    run: async ({ database }) => { await database.query("COMMIT"); }
  }), /unbalanced/);
  assert.equal(second.queries.includes("COMMIT"), false);
});
