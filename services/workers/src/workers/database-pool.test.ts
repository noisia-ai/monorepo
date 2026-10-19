import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("production Worker evaluations reserve numeric capacity within the same total connection bound", () => {
  const first = new URL("../db/client.ts?production-pool-first", import.meta.url).href;
  const second = new URL("../db/client.ts?production-pool-second", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    const first = await import(${JSON.stringify(first)});
    const second = await import(${JSON.stringify(second)});
    try {
      assert.equal(first.pool === second.pool, true, 'separate production module evaluations must reuse one pool');
      assert.equal(first.pool.options.max, 2);
      assert.equal(first.numericPool === second.numericPool, true);
      assert.notEqual(first.pool, first.numericPool);
      assert.equal(first.numericPool.options.max, 1);
      assert.equal(first.pool.options.max + first.numericPool.options.max, 3);
      assert.equal(first.pool.options.connectionTimeoutMillis, 10000);
      assert.equal(first.pool.options.idleTimeoutMillis, 10000);
      assert.equal(first.pool.options.statement_timeout, 600000);
      assert.equal(first.numericPool.options.statement_timeout, 600000);
      assert.equal(first.pool.listenerCount('error'), 1);
      assert.equal(first.numericPool.listenerCount('error'), 1);
      for (const pool of [first.pool, first.numericPool]) {
        assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('private database URL and SQL'), {code:'ECONNRESET'})));
      }
    } finally {
      await first.closeWorkerDatabasePoolsV1();
    }
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:1/noisia_test", DATABASE_SSL: "false" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /private database URL and SQL/u);
});
