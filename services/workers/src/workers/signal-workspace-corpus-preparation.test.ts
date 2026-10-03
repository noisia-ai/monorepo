import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { signalWorkspaceCorpusPreparationJobV1 } from "./signal-workspace-corpus-preparation";
import { drainSignalWorkspaceCorpusPreparationV1 } from "./signal-workspace-corpus-preparation-outbox";

type RuntimeOptions = NonNullable<Parameters<typeof signalWorkspaceCorpusPreparationJobV1>[1]>;
type RuntimeStores = NonNullable<RuntimeOptions["stores"]>;
type OutboxOptions = NonNullable<Parameters<typeof drainSignalWorkspaceCorpusPreparationV1>[0]>;
type OutboxStores = NonNullable<OutboxOptions["stores"]>;
const database = {} as NonNullable<RuntimeOptions["database"]>;
const text = "The complete synthetic source evidence is preserved. 🌎\n";
const textHash = `sha256:${createHash("sha256").update(text).digest("hex")}`;
const lease = { run_id: "run", workspace_id: "workspace", execution_token: "token",
  phase: "chunking" as const, cursor: null as string | null };

function runtimeFixture() {
  let cursor: string | null = null;
  const committed: string[] = [];
  const failures: string[] = [];
  let reads = 0;
  const store: RuntimeStores = {
    claim: async () => ({ ...lease, cursor }),
    snapshot: async () => { throw new Error("snapshot must not repeat on resume"); },
    readPage: async ({ lease: current }) => ({ cursor: current.cursor,
      next_cursor: current.cursor === null ? "root-a" : "root-b", done: current.cursor !== null,
      items: [{ root_id: current.cursor === null ? "root-a" : "root-b", asset_sha256: textHash,
        asset_ready: current.cursor !== null, disposition: "eligible" }] }),
    readAssets: async () => { reads++; return [{ text, text_sha256: textHash, chunks: null }]; },
    commitPage: async ({ lease: current, page, assets }) => {
      assert.equal(current.cursor, cursor);
      assert.equal(assets.length, cursor === null ? 1 : 0);
      cursor = page.next_cursor;
      committed.push(cursor!);
      return { ...current, cursor };
    },
    finish: async () => ({ status: "completed" }),
    fail: async ({ error_code }) => { failures.push(error_code!); }
  };
  return { store, committed, failures, reads: () => reads };
}

test("preparation processes sealed pages and reuses assets despite advisory progress failure", async () => {
  const fixture = runtimeFixture();
  const result = await signalWorkspaceCorpusPreparationJobV1({ id: "job", data: { run_id: "run" },
    updateProgress: async () => { throw new Error("Redis progress unavailable"); }
  }, { database, stores: fixture.store });
  assert.ok("status" in result);
  assert.equal(result.status, "completed");
  assert.deepEqual(fixture.committed, ["root-a", "root-b"]);
  assert.equal(fixture.reads(), 1);
  assert.deepEqual(fixture.failures, []);
});

test("preparation resumes from a committed checkpoint after an interrupted attempt", async () => {
  const fixture = runtimeFixture();
  const original = fixture.store.commitPage;
  let interrupt = true;
  fixture.store.commitPage = async (args) => {
    const saved = await original(args);
    if (interrupt) { interrupt = false; throw new Error("connection ended after page commit"); }
    return saved;
  };
  const job = { id: "job", data: { run_id: "run" }, updateProgress: async () => undefined };
  await assert.rejects(signalWorkspaceCorpusPreparationJobV1(job, { database, stores: fixture.store }),
    /connection ended after page commit/u);
  const result = await signalWorkspaceCorpusPreparationJobV1(job, { database, stores: fixture.store });
  assert.ok("status" in result);
  assert.equal(result.status, "completed");
  assert.deepEqual(fixture.committed, ["root-a", "root-b"]);
  assert.equal(fixture.reads(), 1, "the committed first asset is not rechunked");
  assert.deepEqual(fixture.failures, ["corpus_preparation_worker_failed"]);
});

test("preparation rejects a changed asset before checkpoint and does not turn it into another identity", async () => {
  const fixture = runtimeFixture();
  fixture.store.readAssets = async () => [{ text: "Changed", text_sha256: textHash, chunks: null }];
  await assert.rejects(signalWorkspaceCorpusPreparationJobV1({ id: "job", data: { run_id: "run" },
    updateProgress: async () => undefined }, { database, stores: fixture.store }), /asset_hash_mismatch/u);
  assert.deepEqual(fixture.committed, []);
  assert.deepEqual(fixture.failures, ["corpus_preparation_asset_hash_mismatch"]);
});

test("terminal or unclaimable preparation replay cannot snapshot or advance pages", async () => {
  const fixture = runtimeFixture();
  fixture.store.claim = async () => null;
  const result = await signalWorkspaceCorpusPreparationJobV1({ id: "job", data: { run_id: "run" },
    updateProgress: async () => undefined }, { database, stores: fixture.store });
  assert.equal(result.replayed, true);
  assert.deepEqual(fixture.committed, []);
  assert.equal(fixture.reads(), 0);
});

function dispatchFixture() {
  const row = { run_id: "run", workspace_id: "workspace", worker_job_id: "durable-job", dispatch_token: "token" };
  let acknowledged = false;
  let failures = 0;
  const store = {
    schedule: async () => 0,
    claim: async () => acknowledged ? [] : [row],
    acknowledge: async (args: { run_id: string; dispatch_token: string }) => {
      assert.equal(args.run_id, row.run_id); assert.equal(args.dispatch_token, row.dispatch_token);
      acknowledged = true;
    },
    fail: async () => { failures++; }
  } as OutboxStores;
  return { store, row, failures: () => failures, acknowledged: () => acknowledged };
}

test("preparation outbox recovers Redis accept before ACK without creating another job", async () => {
  const fixture = dispatchFixture();
  let stored = false;
  let adds = 0;
  const queue = {
    getJob: async () => stored ? { getState: async () => "waiting", retry: async () => undefined } : null,
    add: async (_name: string, data: { run_id: string }, options: Record<string, unknown>) => {
      assert.deepEqual(data, { run_id: fixture.row.run_id });
      assert.equal(options.jobId, fixture.row.worker_job_id);
      adds++; stored = true; throw new Error("ACK lost after Redis accepted");
    }
  };
  assert.equal((await drainSignalWorkspaceCorpusPreparationV1({ database, queue, stores: fixture.store })).failed, 1);
  const replay = await drainSignalWorkspaceCorpusPreparationV1({ database, queue, stores: fixture.store });
  assert.equal(replay.recovered, 1);
  assert.equal(replay.dispatched, 1);
  assert.equal(adds, 1);
  assert.equal(fixture.acknowledged(), true);
});

test("preparation outbox retries retained terminal jobs authorized by its database claim", async () => {
  for (const state of ["completed", "failed"] as const) {
    const fixture = dispatchFixture();
    const retried: string[] = [];
    const queue = {
      getJob: async () => ({ getState: async () => state, retry: async (value: string) => { retried.push(value); } }),
      add: async () => { throw new Error("a retained job must be retried"); }
    };
    const result = await drainSignalWorkspaceCorpusPreparationV1({ database, queue, stores: fixture.store });
    assert.equal(result.dispatched, 1);
    assert.deepEqual(retried, [state]);
    assert.equal(fixture.acknowledged(), true);
  }
});
