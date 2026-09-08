import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("production Worker module evaluations share a bounded pool and preserve the analysis timeout", () => {
  const first = new URL("../db/client.ts?production-pool-first", import.meta.url).href;
  const second = new URL("../db/client.ts?production-pool-second", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    const first = await import(${JSON.stringify(first)});
    const second = await import(${JSON.stringify(second)});
    try {
      assert.equal(first.pool === second.pool, true, 'separate production module evaluations must reuse one pool');
      assert.equal(first.pool.options.max, 3);
      assert.equal(first.pool.options.connectionTimeoutMillis, 10000);
      assert.equal(first.pool.options.idleTimeoutMillis, 10000);
      assert.equal(first.pool.options.statement_timeout, 600000);
    } finally {
      await first.pool.end();
      if (second.pool !== first.pool) await second.pool.end();
    }
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:1/noisia_test", DATABASE_SSL: "false" }
  });
  assert.equal(result.status, 0, result.stderr);
});
