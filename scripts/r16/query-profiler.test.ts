import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { R16QueryProfilerV1 } from "./query-profiler";

const hash = (sql: string) => `sha256:${createHash("sha256").update(sql.replace(/\s+/gu, " ").trim()).digest("hex")}`;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test("R16 SQL profiler propagates store labels through async Pool and PoolClient proxy calls", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values }); await pause(2); return { rows: [{ ok: true }], rowCount: 1 };
  }, release() {} };
  const database = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values }); await pause(1); return { rows: [{ ok: true }], rowCount: 1 };
  }, async connect() { await pause(1); return client; } };
  const profiler = new R16QueryProfilerV1();
  const wrappedDatabase = profiler.wrapDatabase(database);
  const originalSql = "SELECT value FROM synthetic_table WHERE id = $1";
  const secretParameter = "private-root-identifier-should-not-be-recorded";
  const store = profiler.wrapStore({
    async apply(_run: unknown, rows: Array<{ id: string }>) {
      await Promise.all(rows.map(async row => {
        await pause(1);
        await wrappedDatabase.query("SELECT value FROM synthetic_table WHERE id = $1", [row.id]);
      }));
      const connection = await wrappedDatabase.connect!();
      await connection.query("UPDATE synthetic_table SET value = $1 WHERE id = $2", ["synthetic", secretParameter]);
      connection.release();
      return rows.length;
    },
  });

  await Promise.all([store.apply({}, [{ id: "root-a" }, { id: "root-b" }]), store.apply({}, [{ id: "root-c" }])]);
  assert.equal(calls.length, 5, "the wrapper forwards every query exactly once");
  assert.ok(calls.some(call => call.sql === originalSql && call.values.includes("root-a")),
    "bind values are forwarded unchanged to the real query method");
  const profile = profiler.snapshot();
  const apply = profile.operations.find(item => item.operation === "apply");
  assert.equal(apply?.duration_ms.calls, 2);
  assert.equal(apply?.batch_size?.count, 2);
  assert.equal(apply?.batch_size?.total, 3);
  assert.equal(apply?.batch_size?.p50, 1);
  assert.equal(apply?.batch_size?.p95, 2);
  assert.equal(apply?.batch_size?.max, 2);
  const selects = profile.queries.find(item => item.operation === "apply" && item.sql_template_sha256 === hash(originalSql));
  assert.equal(selects?.duration_ms.calls, 3);
  assert.ok(selects?.duration_ms.total_ms && selects.duration_ms.p95_ms > 0);
  assert.equal(profile.queries.find(item => item.sql_template_sha256 === hash("UPDATE synthetic_table SET value = $1 WHERE id = $2"))
    ?.operation, "apply", "PoolClient queries inherit the active operation label");
  assert.equal(profile.sql_text_recorded, false);
  assert.equal(profile.bind_values_recorded, false);
  const serialized = JSON.stringify(profile);
  assert.doesNotMatch(serialized, /synthetic_table|private-root-identifier|root-a|synthetic/u,
    "profiling output contains only operation names, timings, and SQL template hashes");
});

test("R16 SQL profiler keeps concurrent async operation labels isolated", async () => {
  const database = { async query(_sql: string) { await pause(2); return { rows: [] }; } };
  const profiler = new R16QueryProfilerV1();
  const wrappedDatabase = profiler.wrapDatabase(database);
  const store = profiler.wrapStore({
    async inputs(_run: unknown) { await pause(1); await wrappedDatabase.query("SELECT 'inputs'::text"); return [{ id: 1 }]; },
    async finish(_run: unknown) { await pause(1); await wrappedDatabase.query("SELECT 'finish'::text"); return "completed"; },
  });
  await Promise.all([store.inputs({}), store.finish({})]);
  const profile = profiler.snapshot();
  assert.ok(profile.queries.some(item => item.operation === "inputs" && item.sql_template_sha256 === hash("SELECT 'inputs'::text")));
  assert.ok(profile.queries.some(item => item.operation === "finish" && item.sql_template_sha256 === hash("SELECT 'finish'::text")));
  assert.equal(profile.queries.filter(item => item.operation === "unlabeled").length, 0);
});
