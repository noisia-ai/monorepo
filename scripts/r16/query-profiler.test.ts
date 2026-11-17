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

test("R16 profiler counts the committed selected Mark cohort under the existing operation without invoking its selector", async () => {
  const profiler = new R16QueryProfilerV1();
  const statements: string[] = [];
  const database = profiler.wrapDatabase({ async query(sql: string) {
    statements.push(sql); return { rows: [] };
  } });
  const chosen = [{ id: "private-committed-a" }, { id: "private-committed-b" }];
  let selections = 0;
  const store = profiler.wrapStore({
    async markSubmitting(_run: unknown, rows: typeof chosen) {
      await database.query("SELECT 'legacy_mark'::text");
      return rows.length;
    },
    async markSubmittingSelected(_run: unknown, select: () => readonly { id: string }[]) {
      await database.query("SELECT 'authority_before_selection'::text");
      const rows = select();
      await database.query("SELECT 'commit_after_selection'::text");
      return rows;
    },
  });
  assert.equal(await store.markSubmitting({}, chosen.slice(0, 1)), 1);
  const result = await store.markSubmittingSelected({}, () => {
    selections++;
    assert.deepEqual(statements, ["SELECT 'legacy_mark'::text", "SELECT 'authority_before_selection'::text"]);
    return chosen;
  });
  assert.equal(result, chosen, "observation must forward the exact returned cohort");
  assert.equal(selections, 1, "only the store invokes the selector");
  const snapshot = profiler.snapshot();
  const mark = snapshot.operations.find(row => row.operation === "markSubmitting");
  assert.equal(mark?.duration_ms.calls, 2);
  assert.equal(mark?.batch_size?.count, 2);
  assert.equal(mark?.batch_size?.total, 3);
  assert.equal(snapshot.operations.length, 1, "old and selected methods measure the same Mark operation");
  assert.equal(snapshot.queries.length, 3);
  assert.ok(snapshot.queries.every(row => row.operation === "markSubmitting"));
  assert.doesNotMatch(JSON.stringify(snapshot), /private-committed|authority_before_selection|commit_after_selection/u);
});
