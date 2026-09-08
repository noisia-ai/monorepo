import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1,
  signalWorkspaceTopicPrototypeDigestV1,
  type SignalWorkspaceSearchTopicV1,
  type SignalWorkspaceTopicPrototypeV1
} from "@noisia/query-engine";
import type { SignalWorkspaceTopicLeaseV1, SignalWorkspaceTopicRootV1 } from "@noisia/db";
import { signalWorkspaceTopicComputationJobV1 as run, safeWorkspaceTopicErrorV1 } from "./signal-workspace-topic-computation";

type Stores = NonNullable<NonNullable<Parameters<typeof run>[1]>["stores"]>;
const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const vector = (index: number) => Array.from({ length: 1024 }, (_, position) => position === index ? 1 : 0);

function fixture(topicCount = 67) {
  let cursor: string | null = null, active = false, finished = false;
  let failSecondPage = false, omitChunk = false, omitPrototype = false;
  const committed: Array<Parameters<Stores["commitRoot"]>[0]> = [];
  const failures: string[] = [];
  const chunksRead: Array<{ root: string; after: number | null }> = [];
  const roots: SignalWorkspaceTopicRootV1[] = [1, 2].map(index => ({
    root_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    asset_sha256: digest(`asset${index}`), fingerprint: digest(`root${index}`), expected_chunks: index === 1 ? 1 : 130,
    root_metadata: {}, scopes: [], semantic_scope_available: false
  }));
  const prototypes: SignalWorkspaceTopicPrototypeV1[] = [];
  const topics: SignalWorkspaceSearchTopicV1[] = Array.from({ length: topicCount }, (_, index) => {
    const term = `topic_${String(index).padStart(3, "0")}`;
    const local: SignalWorkspaceTopicPrototypeV1[] = Array.from({ length: index === 0 ? 132 : 2 }, (_, input): SignalWorkspaceTopicPrototypeV1 => ({
      term_key: term, input_digest: digest(`${term}:${input}`),
      role: input === 0 ? "topic_positive" : input === 1 ? "topic_negative" : "scope_positive",
      vector: vector(input === 0 && index === topicCount - 1 ? 0 : 1),
      embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1
    })).sort((a, b) => a.input_digest < b.input_digest ? -1 : 1);
    prototypes.push(...local);
    return { taxonomy_term_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      term_key: term, scope: "primary_brand", definition_digest: digest(`definition${index}`), compiler_digest: digest(`compiler${index}`),
      prototype_count: local.length, prototype_digest: signalWorkspaceTopicPrototypeDigestV1(local) };
  });
  const makeLease = (): SignalWorkspaceTopicLeaseV1 => ({ execution_id: "20000000-0000-4000-8000-000000000001",
    workspace_id: "30000000-0000-4000-8000-000000000001", execution_token: "40000000-0000-4000-8000-000000000001",
    cursor_root_id: cursor, input_digest: digest("snapshot") });
  const store: Stores = {
    claim: async () => { if (active || finished) return null; active = true; return makeLease(); },
    readRoots: async args => { const available = roots.filter(root => args.lease.cursor_root_id === null || root.root_id > args.lease.cursor_root_id);
      const items = available.slice(0, args.limit); return { items, done: items.length === available.length }; },
    readTopics: async args => {
      const available = topics.filter(topic => args.after_term_key === null || topic.term_key > args.after_term_key);
      const items = available.slice(0, args.limit);
      return { items, done: items.length === available.length, next_term_key: items.at(-1)?.term_key ?? args.after_term_key };
    },
    readPrototypes: async args => {
      const available = prototypes.filter(item => args.term_keys.includes(item.term_key)
        && (args.after === null || `${item.term_key}:${item.input_digest}` > `${args.after.term_key}:${args.after.input_digest}`));
      const items = available.slice(0, args.limit);
      if (omitPrototype) items.pop();
      const last = items.at(-1);
      return { items, done: omitPrototype || items.length === available.length,
        next_cursor: last ? { term_key: last.term_key, input_digest: last.input_digest } : args.after };
    },
    readChunks: async args => {
      const root = roots.find(item => item.root_id === args.root_id)!;
      chunksRead.push({ root: root.root_id, after: args.after_chunk_index });
      if (failSecondPage && root === roots[1] && args.after_chunk_index !== null) {
        failSecondPage = false; throw new Error("simulated process interruption");
      }
      const start = (args.after_chunk_index ?? -1) + 1;
      const end = Math.min(root.expected_chunks, start + (args.limit ?? 128));
      const items = Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        return { chunk_index: index, start: index * 1400, end: (index + 1) * 1400,
          chunk_sha256: digest(`chunk${index}`), text: "x".repeat(1400), vector: vector(index === root.expected_chunks - 1 ? 0 : 1) };
      });
      if (omitChunk) items.pop();
      return { root_id: root.root_id, asset_sha256: root.asset_sha256, expected_chunks: root.expected_chunks,
        after_chunk_index: args.after_chunk_index, items, next_chunk_index: items.at(-1)?.chunk_index ?? args.after_chunk_index,
        done: omitChunk || end === root.expected_chunks };
    },
    commitRoot: async args => { committed.push(args); cursor = args.root_id; return makeLease(); },
    finish: async () => { finished = true; active = false; return { status: "ready", execution_id: makeLease().execution_id }; },
    fail: async args => { active = false; failures.push(args.error_code ?? ""); }
  };
  const job = { id: "workspace-topic-fixture-1", data: { execution_id: makeLease().execution_id }, updateProgress: async () => undefined };
  return { store, roots, committed, failures, chunksRead, job,
    interrupt() { failSecondPage = true; }, omitChunk() { omitChunk = true; }, omitPrototype() { omitPrototype = true; } };
}

test("workspace topic Worker evaluates all 67 Topics, all 130 chunks and paged prototypes before bounded results", async () => {
  const f = fixture();
  const result = await run(f.job, { database: {} as never, stores: f.store });
  assert.ok("status" in result && result.status === "ready");
  assert.equal(f.committed.length, 2);
  const saved = f.committed[1]!.result;
  assert.equal(saved.evaluated_topic_count, 67);
  assert.equal(saved.processed_chunks, 130);
  assert.equal(saved.retained_candidate_count, 32);
  assert.equal(saved.omitted_candidate_count, 35);
  assert.equal(saved.candidates[0]?.term_key, "topic_066");
  assert.equal(saved.candidates[0]?.evidence.best_chunk.chunk_index, 129);
  assert.equal(saved.candidates[0]?.evidence.evaluated_chunk_count, 130);
  assert.ok(saved.candidates.every(item => item.disposition === "doubt" && item.evidence.approval_policy === "none"));
  assert.equal(saved.semantic_scope_available, false);
  const replay = await run(f.job, { database: {} as never, stores: f.store });
  assert.ok("replayed" in replay && replay.replayed === true);
});

test("interruption preserves completed root and retries only the unfinished complete root", async () => {
  const f = fixture(); f.interrupt();
  await assert.rejects(run(f.job, { database: {} as never, stores: f.store }), { message: "workspace_topic_worker_failed" });
  assert.equal(f.committed.length, 1);
  assert.deepEqual(f.failures, ["workspace_topic_worker_failed"]);
  f.chunksRead.length = 0;
  await run(f.job, { database: {} as never, stores: f.store });
  assert.equal(f.committed.length, 2);
  assert.ok(f.chunksRead.every(item => item.root === f.roots[1]!.root_id));
  assert.equal(f.chunksRead[0]?.after, null);
});

test("incomplete chunks or prototypes never commit a partial root", async () => {
  for (const kind of ["chunk", "prototype"]) {
    const f = fixture(1);
    if (kind === "chunk") f.omitChunk(); else f.omitPrototype();
    await assert.rejects(run(f.job, { database: {} as never, stores: f.store }), /coverage_incomplete/u);
    assert.equal(f.committed.length, 0);
  }
});

test("no compatible topics still verifies every chunk and Redis progress errors do not fail durable results", async () => {
  const f = fixture(0);
  await run({ ...f.job, updateProgress: async () => { throw new Error("redis unavailable"); } },
    { database: {} as never, stores: f.store });
  assert.equal(f.committed.length, 2);
  assert.equal(f.committed[1]?.result.processed_chunks, 130);
  assert.equal(f.committed[1]?.result.evaluated_topic_count, 0);
  assert.equal(f.failures.length, 0);
});

test("Worker rejects stalled input and emits safe local error codes", async () => {
  const f = fixture();
  await assert.rejects(run(f.job, { database: {} as never, stores: { ...f.store,
    readTopics: async () => ({ items: [], done: false, next_term_key: null }) } }), /definition_page_stalled/u);
  assert.equal(f.committed.length, 0);
  assert.equal(safeWorkspaceTopicErrorV1(new Error("private corpus text")), "workspace_topic_worker_failed");
  await assert.rejects(run(f.job, { database: {} as never, stores: { ...f.store,
    claim: async () => { throw new Error("private SQL value before acquiring lease"); } } }),
  { message: "workspace_topic_worker_failed" });
});
