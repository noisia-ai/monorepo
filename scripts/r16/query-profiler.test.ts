import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { R16QueryProfilerV1, R16_OPERATION_TIMELINE_MAX_SPANS_V1 } from "./query-profiler";

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


test("R16 operation timeline records overlapping completion spans and failures without leaking private data or invoking selected Mark", { timeout: 5000 }, async () => {
  const gate = () => {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
  };
  const reserveEntered = gate(), applyEntered = gate(), reserveGate = gate(), applyGate = gate();
  const profiler = new R16QueryProfilerV1();
  let now = 10, clockReads = 0, selections = 0;
  const clock = () => { clockReads++; return now; };
  const primary = new Error("private-error-message-must-not-be-recorded");
  const privateRun = { id: "private-run-identifier" };
  const rows = [{ id: "private-root-a" }, { id: "private-root-b" }];
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const database = profiler.wrapDatabase({ async query(sql: string, binds: unknown[] = []) {
    statements.push({ sql, binds }); return { rows: [] };
  } });
  const applyObservations: Array<{ start_ms: number; end_ms: number; roots: number }> = [];
  const store = profiler.wrapStore({
    async reserve(run: typeof privateRun, proposed: typeof rows) {
      assert.equal(run, privateRun); assert.equal(proposed, rows);
      reserveEntered.resolve(); await reserveGate.promise; return proposed;
    },
    async apply(run: typeof privateRun, proposed: typeof rows) {
      assert.equal(run, privateRun); assert.equal(proposed, rows);
      applyEntered.resolve(); await applyGate.promise; throw primary;
    },
    async markSubmittingSelected(run: typeof privateRun, select: () => typeof rows) {
      assert.equal(run, privateRun);
      await database.query("SELECT secret_value FROM private_table WHERE id=$1", [privateRun.id]);
      const chosen = select();
      await database.query("UPDATE private_table SET secret_value=$1", [rows[0]!.id]);
      return chosen;
    },
  }, value => applyObservations.push(value), clock);
  const reserved = store.reserve(privateRun, rows); await reserveEntered.promise;
  now = 20;
  const failed = store.apply(privateRun, rows);
  const rejected = assert.rejects(failed, error => error === primary);
  await applyEntered.promise;
  try {
  const pending = profiler.snapshot().operation_timeline;
  assert.deepEqual([pending.started_spans, pending.completed_spans, pending.in_flight_spans, pending.dropped_spans], [2, 0, 2, 0]);
  assert.equal(pending.complete, false); assert.deepEqual(pending.spans, []);
  now = 30; applyGate.resolve(); await rejected;
  now = 40; reserveGate.resolve(); assert.equal(await reserved, rows);
  now = 50;
  assert.equal(await store.markSubmittingSelected(privateRun, () => { selections++; return rows; }), rows);
  assert.equal(selections, 1, "only the real store may invoke its selected Mark callback");
  assert.equal(statements.length, 2, "observation must not add queries");
  assert.equal(statements[0]!.binds[0], privateRun.id); assert.equal(statements[1]!.binds[0], rows[0]!.id);
  const snapshot = profiler.snapshot(), timeline = snapshot.operation_timeline;
  assert.deepEqual(timeline.spans, [
    { operation: "apply", start_ms: 20, end_ms: 30, batch_size: 2, outcome: "failed" },
    { operation: "reserve", start_ms: 10, end_ms: 40, batch_size: 2, outcome: "completed" },
    { operation: "markSubmitting", start_ms: 50, end_ms: 50, batch_size: 2, outcome: "completed" },
  ]);
  assert.equal(timeline.order, "completion"); assert.equal(timeline.clock, "caller_elapsed_ms");
  assert.deepEqual([timeline.started_spans, timeline.completed_spans, timeline.in_flight_spans, timeline.dropped_spans], [3, 3, 0, 0]);
  assert.equal(timeline.complete, true);
  assert.deepEqual(applyObservations, [{ start_ms: 20, end_ms: 30, roots: 2 }]);
  assert.equal(clockReads, 6, "each wrapper uses one start and one end reading, including the APPLY observer");
  for (const operation of ["apply", "reserve", "markSubmitting"]) {
    const aggregate = snapshot.operations.find(row => row.operation === operation)!;
    assert.equal(aggregate.duration_ms.calls, 1); assert.equal(aggregate.batch_size?.total, 2);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|private_table|secret_value|SELECT |UPDATE |error-message/u);
  timeline.spans[0]!.start_ms = 999;
  assert.equal(profiler.snapshot().operation_timeline.spans[0]!.start_ms, 20, "snapshot mutation must not alter retained observations");
  } finally {
    applyGate.resolve(); reserveGate.resolve(); await Promise.allSettled([reserved, rejected]);
  }
});

test("R16 operation timeline reports overflow after 8192 closed spans while exact aggregates continue", async () => {
  const profiler = new R16QueryProfilerV1();
  let tick = 0;
  const store = profiler.wrapStore({ async finish() { return "completed"; } }, undefined, () => ++tick);
  for (let index = 0; index <= R16_OPERATION_TIMELINE_MAX_SPANS_V1; index++) assert.equal(await store.finish(), "completed");
  const snapshot = profiler.snapshot(), timeline = snapshot.operation_timeline;
  assert.equal(timeline.max_spans, 8192); assert.equal(timeline.spans.length, 8192);
  assert.deepEqual([timeline.started_spans, timeline.completed_spans, timeline.in_flight_spans, timeline.dropped_spans], [8193, 8193, 0, 1]);
  assert.equal(timeline.complete, false, "a truncated timeline must never claim complete capture");
  assert.deepEqual(timeline.spans[0], { operation: "finish", start_ms: 1, end_ms: 2, batch_size: null, outcome: "completed" });
  assert.equal(timeline.spans.at(-1)!.end_ms, 16384);
  assert.equal(snapshot.operations.find(row => row.operation === "finish")?.duration_ms.calls, 8193, "timeline truncation must not truncate historical aggregates");
  assert.ok(Buffer.byteLength(JSON.stringify(timeline)) < 2 * 1024 * 1024, "bounded synthetic timeline adds under 2MiB, without relaxing the artifact cap");
});
