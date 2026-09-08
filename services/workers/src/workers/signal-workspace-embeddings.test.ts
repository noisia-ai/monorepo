import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { signalWorkspaceEmbeddingsJobV1 } from "./signal-workspace-embeddings";
import { drainSignalWorkspaceEmbeddingsV1 } from "./signal-workspace-embeddings-outbox";
import { WorkspaceEmbeddingProviderErrorV1, type WorkspaceEmbeddingProviderV1 } from "./signal-workspace-embeddings-provider";

type Options = NonNullable<Parameters<typeof signalWorkspaceEmbeddingsJobV1>[1]>;
type Stores = NonNullable<Options["stores"]>;
type Lease = Awaited<ReturnType<Stores["claim"]>> & object;
type Call = Awaited<ReturnType<Stores["reserve"]>> & object;
const database = {} as NonNullable<Options["database"]>;
const input = (text: string) => ({ text, chunk_sha256: `sha256:${createHash("sha256").update(text).digest("hex")}` });
const chunks = [input("First full document chunk."), input("Full document after the historical chunk limit.")];
const job = { id: "job", data: { run_id: "run" }, updateProgress: async () => undefined };
const vector = [1, ...Array.from({ length: 1023 }, () => 0)];

function fixture() {
  let cursor: Lease["cursor"] = null;
  let blocked = false, ended = false, sends = 0;
  const ledger = new Map<string, Call>();
  const cache = new Set<string>();
  const outcomes: string[] = [];
  const events: string[] = [];
  const makeLease = (): Lease => ({ run_id: "run", workspace_id: "workspace", execution_token: "token",
    profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, cursor });
  const store: Stores = {
    claim: async () => blocked || ended ? null : makeLease(),
    readBatch: async ({ lease }) => {
      const ordinal = lease.cursor ? 1 : 0;
      const chunk = chunks[ordinal]!;
      const next_cursor = { asset_sha256: "asset", chunk_index: ordinal === 0 ? 80 : 81 };
      return { cursor: lease.cursor, next_cursor, done: ordinal === 1, batch_digest: `batch-${ordinal}`,
        items: [{ asset_sha256: "asset", chunk_index: next_cursor.chunk_index, chunk_sha256: chunk.chunk_sha256,
          root_count: 1, asset_chunk_count: 82, cached: cache.has(chunk.chunk_sha256) }],
        inputs: cache.has(chunk.chunk_sha256) ? [] : [chunk], tokens_upper: 128, reserved_micro_usd: 16 };
    },
    reserve: async ({ batch }) => {
      if (!batch.inputs.length) return null;
      const existing = ledger.get(batch.batch_digest);
      if (existing) return existing;
      const call: Call = { call_id: batch.batch_digest, attempt_token: `attempt-${batch.batch_digest}`,
        state: "reserved", response_body: null, response_http_status: null, provider_request_id: null };
      ledger.set(batch.batch_digest, call); return call;
    },
    markSent: async ({ call_id }) => { events.push(`mark:${call_id}`); },
    persistResponse: async ({ call_id, response }) => {
      events.push(`persist:${call_id}`);
      Object.assign(ledger.get(call_id)!, { state: "response_persisted", response_body: response.body,
        response_http_status: response.http_status, provider_request_id: response.provider_request_id });
    },
    commit: async ({ batch, call_id, validated }) => {
      if (call_id) {
        assert.equal(ledger.get(call_id)?.state, "response_persisted");
        assert.equal(validated?.vectors.length, batch.inputs.length);
        validated!.vectors.forEach(entry => cache.add(entry.chunk_sha256));
        ledger.get(call_id)!.state = "settled";
      }
      cursor = batch.next_cursor; events.push(`commit:${batch.batch_digest}`); return makeLease();
    },
    finish: async () => { ended = true; return { status: "completed" }; },
    fail: async ({ outcome }) => { outcomes.push(outcome); blocked = outcome === "outcome_unknown"; }
  };
  const provider: WorkspaceEmbeddingProviderV1 = { embedBatch: async inputs => {
    sends++; events.push("provider");
    return { body: JSON.stringify({ model: "voyage-4-large", usage: { total_tokens: 5 },
      data: inputs.map((_input, index) => ({ index, embedding: vector })) }),
    http_status: 200, provider_request_id: "fixture" };
  } };
  return { store, provider, ledger, cache, events, outcomes, sends: () => sends };
}

test("embedding Worker seals each send and advances every chunk beyond ordinal80", async () => {
  const f = fixture();
  const result = await signalWorkspaceEmbeddingsJobV1({ ...job,
    updateProgress: async () => { throw new Error("Redis progress unavailable"); }
  }, { database, stores: f.store, provider: f.provider });
  assert.ok("status" in result); assert.equal(result.status, "completed");
  assert.equal(f.sends(), 2); assert.equal(f.cache.size, 2);
  assert.deepEqual(f.events, ["mark:batch-0", "provider", "persist:batch-0", "commit:batch-0",
    "mark:batch-1", "provider", "persist:batch-1", "commit:batch-1"]);
  assert.deepEqual(f.outcomes, []);
});

test("persisted response resumes after local commit failure without another paid send", async () => {
  const f = fixture(); const commit = f.store.commit; let crash = true;
  f.store.commit = async args => { if (crash) { crash = false; throw new Error("database unavailable"); }
    return commit(args); };
  await assert.rejects(signalWorkspaceEmbeddingsJobV1(job, { database, stores: f.store, provider: f.provider }), /worker_failed/u);
  assert.equal(f.sends(), 1); assert.equal(f.ledger.get("batch-0")?.state, "response_persisted");
  assert.deepEqual(f.outcomes, ["local_failure"]);
  const result = await signalWorkspaceEmbeddingsJobV1(job, { database, stores: f.store, provider: f.provider });
  assert.ok("status" in result); assert.equal(result.status, "completed");
  assert.equal(f.sends(), 2, "the recovered first batch does not call the provider again");
});

test("response received without durable receipt remains unknown and replay sends nothing", async () => {
  const f = fixture(); f.store.persistResponse = async () => { throw new Error("connection lost"); };
  await assert.rejects(signalWorkspaceEmbeddingsJobV1(job, { database, stores: f.store, provider: f.provider }), /worker_failed/u);
  assert.deepEqual(f.outcomes, ["outcome_unknown"]);
  const replay = await signalWorkspaceEmbeddingsJobV1(job, { database, stores: f.store, provider: f.provider });
  assert.equal(replay.replayed, true); assert.equal(f.sends(), 1); assert.equal(f.cache.size, 0);
});

test("invalid provider vectors are persisted for accounting but never cached", async () => {
  const f = fixture();
  const provider: WorkspaceEmbeddingProviderV1 = { embedBatch: async () => ({ body: JSON.stringify({
    model: "voyage-4-large", usage: { total_tokens: 5 }, data: [] }), http_status: 200, provider_request_id: "fixture" }) };
  await assert.rejects(signalWorkspaceEmbeddingsJobV1(job, { database, stores: f.store, provider }), /response_invalid/u);
  assert.equal(f.ledger.get("batch-0")?.state, "response_persisted");
  assert.deepEqual(f.outcomes, ["known_response_invalid"]); assert.equal(f.cache.size, 0);
});

test("cache-only batches complete with provider transport disabled", async () => {
  const f = fixture(); chunks.forEach(chunk => f.cache.add(chunk.chunk_sha256));
  const provider: WorkspaceEmbeddingProviderV1 = { embedBatch: async () => {
    throw new WorkspaceEmbeddingProviderErrorV1("workspace_embedding_provider_disabled", "definitely_not_sent");
  } };
  const result = await signalWorkspaceEmbeddingsJobV1(job, { database, stores: f.store, provider });
  assert.ok("status" in result); assert.equal(result.status, "completed");
  assert.equal(f.ledger.size, 0); assert.deepEqual(f.outcomes, []);
});

test("embedding outbox recovers Redis accept before ACK and uses one-attempt jobs", async () => {
  type OutboxOptions = NonNullable<Parameters<typeof drainSignalWorkspaceEmbeddingsV1>[0]>;
  const row = { run_id: "run", workspace_id: "workspace", worker_job_id: "durable", dispatch_token: "token" };
  let acknowledged = false, stored = false, adds = 0, retries = 0;
  let state = "waiting";
  const stores: NonNullable<OutboxOptions["stores"]> = {
    schedule: async () => 0, claim: async () => acknowledged ? [] : [row],
    acknowledge: async () => { acknowledged = true; }, fail: async () => undefined
  };
  const queue = {
    getJob: async () => stored ? { getState: async () => state, retry: async () => { retries++; } } : null,
    add: async (_name: string, data: { run_id: string }, options: Record<string, unknown>) => {
      assert.deepEqual(data, { run_id: "run" }); assert.equal(options.attempts, 1);
      assert.equal(options.jobId, "durable"); adds++; stored = true; throw new Error("Redis ACK lost");
    }
  };
  assert.equal((await drainSignalWorkspaceEmbeddingsV1({ database, stores, queue })).failed, 1);
  assert.equal((await drainSignalWorkspaceEmbeddingsV1({ database, stores, queue })).recovered, 1);
  assert.equal(adds, 1); assert.equal(retries, 0);
  acknowledged = false; state = "completed";
  assert.equal((await drainSignalWorkspaceEmbeddingsV1({ database, stores, queue })).dispatched, 1);
  assert.equal(retries, 1, "a terminal Redis job can resume a DB-authorized persisted response");
});
