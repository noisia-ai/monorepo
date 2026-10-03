import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, type Socket } from "node:net";
import test from "node:test";
import pg from "pg";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const { resolveDatabaseSsl, createStudioPool, pool: studioPool } = await import("./db");

test("database SSL can be disabled for local smoke databases", () => {
  assert.equal(resolveDatabaseSsl("false"), false);
  assert.equal(resolveDatabaseSsl("0"), false);
  assert.equal(resolveDatabaseSsl("disable"), false);
  assert.deepEqual(resolveDatabaseSsl(undefined), { rejectUnauthorized: false });
  assert.deepEqual(resolveDatabaseSsl("true"), { rejectUnauthorized: false });
});

test("production module evaluations share one bounded Studio pool", () => {
  const first = new URL("./db.ts?production-pool-first", import.meta.url).href;
  const second = new URL("./db.ts?production-pool-second", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    const first = await import(${JSON.stringify(first)});
    const second = await import(${JSON.stringify(second)});
    try {
      assert.equal(first.pool === second.pool, true, 'separate production module evaluations must reuse one pool');
      assert.equal(first.pool.options.max, 3);
      assert.equal(first.pool.options.connectionTimeoutMillis, 10000);
      assert.equal(first.pool.options.idleTimeoutMillis, 10000);
      assert.equal(first.pool.options.query_timeout, undefined);
      assert.equal(first.pool.options.keepAlive, true);
      assert.equal(first.pool.options.keepAliveInitialDelayMillis, 10000);
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

/** Minimal PostgreSQL wire peer: real pg sockets authenticate normally, but the
 * peer withholds every response to INSERT. No database or provider is contacted. */
async function startUnresponsivePostgresPeer() {
  const sockets = new Set<Socket>();
  const statements: string[] = [];
  let connections = 0;
  const pendingWrites: Array<() => void> = [];
  const parameterValues: string[][] = [];
  const frame = (type: string, body: Buffer) => {
    const header = Buffer.alloc(5);
    header.write(type, 0);
    header.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([header, body]);
  };
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => { /* The client destroys timed-out sockets. */ });
    let buffered = Buffer.alloc(0);
    let started = false;
    let inTransaction = false;
    let preparedSql = "";
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!started) {
        if (buffered.length < 4 || buffered.length < buffered.readInt32BE(0)) return;
        buffered = buffered.subarray(buffered.readInt32BE(0));
        started = true;
        socket.write(Buffer.concat([frame("R", Buffer.alloc(4)), frame("Z", Buffer.from("I"))]));
      }
      while (buffered.length >= 5 && buffered.length >= buffered.readInt32BE(1) + 1) {
        const type = String.fromCharCode(buffered[0]!);
        const length = buffered.readInt32BE(1);
        const body = buffered.subarray(5, length + 1);
        buffered = buffered.subarray(length + 1);
        if (type === "X") { socket.end(); continue; }
        if (type === "P") {
          preparedSql = body.subarray(body.indexOf(0) + 1, body.length - 3).toString("utf8");
          socket.write(frame("1", Buffer.alloc(0)));
          continue;
        }
        if (type === "B") {
          let offset = body.indexOf(0) + 1;
          offset = body.indexOf(0, offset) + 1;
          const formatCount = body.readInt16BE(offset); offset += 2 + formatCount * 2;
          const valueCount = body.readInt16BE(offset); offset += 2;
          const values: string[] = [];
          for (let i = 0; i < valueCount; i++) {
            const length = body.readInt32BE(offset); offset += 4;
            values.push(length === -1 ? "NULL" : body.subarray(offset, offset + length).toString("utf8"));
            if (length !== -1) offset += length;
          }
          parameterValues.push(values);
          socket.write(frame("2", Buffer.alloc(0)));
          continue;
        }
        if (type === "D") { socket.write(frame("n", Buffer.alloc(0))); continue; }
        if (type === "E") {
          statements.push(preparedSql);
          socket.write(frame("C", Buffer.from("SELECT 0\0")));
          continue;
        }
        if (type === "S") { socket.write(frame("Z", Buffer.from(inTransaction ? "T" : "I"))); continue; }
        if (type !== "Q") { socket.destroy(new Error("Unexpected test protocol message")); return; }
        const sql = body.subarray(0, -1).toString("utf8");
        statements.push(sql);
        if (sql.startsWith("INSERT")) {
          pendingWrites.push(() => socket.write(Buffer.concat([
            frame("C", Buffer.from("INSERT 0 1\0")), frame("Z", Buffer.from(inTransaction ? "T" : "I"))
          ])));
          continue;
        }
        if (sql === "BEGIN") inTransaction = true;
        if (sql === "ROLLBACK") inTransaction = false;
        const command = sql === "BEGIN" || sql === "ROLLBACK" ? sql : "SELECT 0";
        socket.write(Buffer.concat([
          frame("C", Buffer.from(`${command}\0`)),
          frame("Z", Buffer.from(inTransaction ? "T" : "I"))
        ]));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    statements,
    parameterValues,
    completePendingWrites: () => pendingWrites.splice(0).forEach(complete => complete()),
    get connections() { return connections; },
    pool: () => createStudioPool({
      ...studioPool.options,
      connectionString: `postgres://fixture:fixture@127.0.0.1:${address.port}/timeout_test`,
      ssl: false,
      // Exercise production behavior with a shorter deadline, not a minute-long test.
      connectionTimeoutMillis: 1_000
    }, 100),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

test("unanswered writes time out, restore all pool capacity and are never replayed", { timeout: 5_000 }, async () => {
  const peer = await startUnresponsivePostgresPeer();
  const pool = peer.pool();
  try {
    assert.equal(pool.options.max, 3);
    const writes = Array.from({ length: 3 }, (_, i) => `INSERT INTO timeout_probe VALUES (${i})`);
    await Promise.all(writes.map(sql => assert.rejects(pool.query(sql), /Query read timeout/u)));
    assert.equal(pool.totalCount, 0, "pool.query must evict every unresponsive connection");
    assert.deepEqual(peer.statements.slice().sort(), writes.slice().sort(), "each write is sent exactly once");

    // Hold three recovered checkouts simultaneously to prove full capacity returned.
    const clients = await Promise.all(Array.from({ length: 3 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map(client => client.query("SELECT healthy")));
      assert.ok(results.every(result => result.command === "SELECT"));
    } finally { clients.forEach(client => client.release()); }
    assert.equal(peer.connections, 6, "recovery uses fresh sockets, not the stalled protocol streams");
    assert.equal(pool.idleCount, 3);
    assert.deepEqual(peer.statements.filter(sql => sql.startsWith("INSERT")).sort(), writes.slice().sort());
  } finally { await pool.end(); await peer.close(); }
});

test("explicit checkout waits for a late write and rolls back before reuse", { timeout: 5_000 }, async () => {
  const peer = await startUnresponsivePostgresPeer();
  const pool = peer.pool();
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    let settled = false;
    const write = client.query("INSERT INTO timeout_probe VALUES (99)").finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(settled, false, "pool.query deadline must not affect transaction-owned clients");
    assert.equal(pool.idleCount, 0);
    peer.completePendingWrites();
    assert.equal((await write).command, "INSERT");
    await client.query("ROLLBACK");
    client.release();
    client = undefined;
    assert.equal((await pool.query("SELECT healthy")).command, "SELECT");
    assert.equal(peer.connections, 1);
    assert.deepEqual(peer.statements, ["BEGIN", "INSERT INTO timeout_probe VALUES (99)", "ROLLBACK", "SELECT healthy"]);
  } finally { client?.release(true); await pool.end(); await peer.close(); }
});

test("bounded pool queries preserve config, values and callback overloads", { timeout: 5_000 }, async () => {
  const peer = await startUnresponsivePostgresPeer();
  const pool = peer.pool();
  try {
    const config = Object.freeze({ text: "SELECT $1", values: ["configured"], rowMode: "array" as const });
    assert.equal((await pool.query(config)).command, "SELECT");
    assert.equal((await pool.query("SELECT $1", ["promised"])).command, "SELECT");
    await new Promise<void>((resolve, reject) => {
      pool.query("SELECT $1", ["callback"], (error, result) => {
        if (error) { reject(error); return; }
        assert.equal(result.command, "SELECT"); resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      pool.query({ text: "SELECT $1", values: ["config-callback"] }, (error, result) => {
        if (error) { reject(error); return; }
        assert.equal(result.command, "SELECT"); resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      pool.query("SELECT healthy", (error, result) => {
        if (error) { reject(error); return; }
        assert.equal(result.command, "SELECT"); resolve();
      });
    });
    assert.deepEqual(peer.parameterValues, [["configured"], ["promised"], ["callback"], ["config-callback"]]);
    assert.equal("query_timeout" in config, false);
  } finally { await pool.end(); await peer.close(); }
});
