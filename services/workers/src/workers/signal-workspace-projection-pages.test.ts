import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1,
  signalWorkspaceClassificationReuseKeyV1,
  type SignalWorkspaceClassificationOutcomeV1 as Outcome,
} from "@noisia/query-engine";
import type {
  SignalWorkspaceClassificationPageV1 as RootPage,
  SignalWorkspaceClassificationChunksPageV1 as ChunkPage,
} from "@noisia/db";
import type {
  SignalWorkspaceClassificationLeaseV1 as Lease,
  SignalWorkspaceClassificationRootV1 as Root,
  SignalWorkspaceClassificationEngineV1 as Engine,
} from "./signal-workspace-classification";
import {
  projectWorkspaceClassificationPagesV1 as run,
  WORKSPACE_PROJECTION_PAGE_BYTES_V1,
  type WorkspaceProjectionPageStoresV1 as Stores,
} from "./signal-workspace-projection-pages";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const identity: Lease["identity"] = { contract_version: SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1,
  workspace_id: id(9000), engine_key: "local-projection-fixture", engine_version: 1,
  engine_artifact_digest: sha("fixture artifact"), embedding_config_digest: sha("fixture cache"),
  catalog_digest: sha("catalog"), compiler_digest: sha("compiler"), context_digest: sha("context"),
  decision_policy_digest: sha("policy") };
const rootIdentity = (root: Root) => ({ root_id: root.root_id, fingerprint: root.fingerprint,
  correction_digest: root.correction_digest });

function source(index: number, count: number) {
  let offset = 0;
  const fragments = Array.from({ length: count }, (_, chunk_index) => {
    const text = `Synthetic root ${index}, fragment ${chunk_index} 🌞 ${chunk_index === count - 1 ? "FINAL EVIDENCE" : "body"}.`;
    const start = offset; offset += text.length;
    return { chunk_index, start, end: offset, text, chunk_sha256: sha(text) };
  });
  const root: Root = { root_id: id(index), fingerprint: sha(`source:${index}`),
    correction_digest: sha(`correction:${index}`), asset_sha256: sha(fragments.map(row => row.text).join("")),
    expected_chunks: count, chunk_coverage_digest: sha(fragments.map(row => JSON.stringify([
      row.chunk_index, row.start, row.end, row.chunk_sha256]) + "\n").join("")), reuse_item_id: null };
  return { root, chunks: fragments.map(row => ({ ...row, root_id: root.root_id,
    asset_sha256: root.asset_sha256, expected_chunks: count })) };
}

function fixture(counts: number[], decisionCount = 0) {
  const inputs = counts.map((count, index) => source(index + 1, count));
  let cursor: string | null = null, ackLostAt = 0, failRoot: string | null = null, progressFails = false;
  let forbidden = false, finishCalls = 0, rootReads = 0, chunkReads = 0;
  const writes = new Map<string, Outcome>(), commits: string[][] = [], failures: Array<{code: string; cursor: string | null}> = [];
  const engineCalls: string[] = [], streams = new Map<string, number[]>(), texts = new Map<string, string>();
  const rootRequests: Array<{cursor: string|null; limit: number}> = [];
  const chunkRequests: Array<{cursor: string|null; roots: string[]; after: ChunkPage["next_cursor"]; limit: number; rows: number}> = [];
  const progress: unknown[] = [];
  const hooks: { root?: (page: RootPage, call: number) => void; chunk?: (page: ChunkPage, call: number) => void;
    checkpoint?: (lease: Lease) => Lease; engine?: (root: Root, chunks: Parameters<Engine["classifyRoot"]>[0]["chunks"]) => Promise<void> } = {};
  const lease = (): Lease => ({ execution_id: id(9001), workspace_id: identity.workspace_id,
    execution_token: id(9002), input_digest: sha("input"), identity, cursor_root_id: cursor });
  const remaining = () => inputs.filter(item => cursor === null || item.root.root_id > cursor);
  const authority = () => { if (forbidden) throw new Error("workspace_classification_forbidden"); };
  const outcome = (root: Root): Outcome => ({ contract_version: SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1,
    root: rootIdentity(root), reuse_key: signalWorkspaceClassificationReuseKeyV1(identity, rootIdentity(root)),
    resolution_state: decisionCount ? "approved" : "pending", has_unresolved_topics: !decisionCount,
    reason_code: "local_fixture", technical_error_code: null, evidence_digest: sha(`evidence:${root.root_id}`),
    coverage: { expected_chunks: root.expected_chunks, processed_chunks: root.expected_chunks,
      chunk_coverage_digest: root.chunk_coverage_digest },
    decisions: Array.from({ length: decisionCount }, (_, index) => ({ taxonomy_term_id: id(10000 + index),
      term_key: `fixture_${index}`, definition_revision: 1, definition_digest: sha(`definition:${index}`),
      disposition: "approved", resolution_method: "human", model_version_id: null, labeling_function_version_id: null,
      approval_policy_id: null, decided_by_user_id: id(9003), correction_operation_id: id(20000 + index), score: null,
      evidence_digest: sha(`evidence:${index}`), lineage_digest: sha(`lineage:${index}`) })) });
  const stores: Stores<object> = {
    readPage: async args => {
      authority(); assert.equal(args.lease.cursor_root_id, cursor);
      rootRequests.push({ cursor, limit: args.limit });
      const available = remaining(), page = { items: available.slice(0, args.limit).map(item => ({ root: structuredClone(item.root), corrections: [] })),
        done: available.length <= args.limit };
      hooks.root?.(page, ++rootReads); return page;
    },
    readChunksPage: async args => {
      authority(); assert.equal(args.lease.cursor_root_id, cursor);
      assert.deepEqual(args.root_ids, remaining().slice(0, args.root_ids.length).map(item => item.root.root_id),
        "chunks must stay within the next uncommitted root prefix");
      assert.ok(args.after === null || args.root_ids.includes(args.after.root_id));
      const available = inputs.filter(item => args.root_ids.includes(item.root.root_id)).flatMap(item => item.chunks)
        .filter(row => args.after === null || row.root_id > args.after.root_id
          || row.root_id === args.after.root_id && row.chunk_index > args.after.chunk_index);
      const items = structuredClone(available.slice(0, args.limit)), last = items.at(-1);
      const page: ChunkPage = { items, next_cursor: last ? { root_id: last.root_id, chunk_index: last.chunk_index } : args.after,
        done: available.length <= args.limit };
      hooks.chunk?.(page, ++chunkReads);
      chunkRequests.push({ cursor, roots: [...args.root_ids], after: args.after, limit: args.limit, rows: page.items.length });
      return page;
    },
    commitPage: async args => {
      authority(); assert.equal(args.lease.cursor_root_id, cursor, "CAS uses the last durable prefix");
      const expected = remaining().slice(0, args.outcomes.length).map(item => item.root.root_id);
      assert.deepEqual(args.outcomes.map(row => row.root.root_id), expected);
      for (const value of args.outcomes) {
        assert.ok(!writes.has(value.root.root_id), "durable roots must never be written twice");
        writes.set(value.root.root_id, structuredClone(value));
      }
      commits.push(expected); cursor = expected.at(-1) ?? cursor;
      if (commits.length === ackLostAt) throw new Error("private database COMMIT acknowledgement lost");
      return hooks.checkpoint?.(lease()) ?? lease();
    },
    finish: async args => {
      authority(); finishCalls++; assert.equal(args.lease.cursor_root_id, cursor);
      if (writes.size !== inputs.length) throw new Error("workspace_classification_generation_incomplete");
      return { status: "ready", roots: writes.size };
    },
    fail: async args => { failures.push({ code: args.error_code, cursor: args.lease.cursor_root_id }); },
  };
  const engine: Engine = { ...identity, classifyRoot: async ({ root, chunks }) => {
    engineCalls.push(root.root_id);
    if (failRoot === root.root_id) throw new Error("private engine input must not reach the queue");
    if (hooks.engine) await hooks.engine(root, chunks);
    else {
      const lengths: number[] = [], parts: string[] = [];
      for await (const page of chunks) { lengths.push(page.length); parts.push(...page.map(row => row.text)); }
      streams.set(root.root_id, lengths); texts.set(root.root_id, parts.join(""));
    }
    return outcome(root);
  } };
  const job = { id: "local-projection-pages", data: { execution_id: id(9001) }, updateProgress: async (value: unknown) => {
    progress.push(value); if (progressFails) throw new Error("Redis progress unavailable"); } };
  const execute = (extra: Partial<Parameters<typeof run<object>>[0]> = {}) => run({ database: {}, stores, engine, job, lease: lease(), ...extra });
  return { inputs, stores, hooks, engine, job, lease, outcome, execute, writes, commits, failures,
    engineCalls, streams, texts, rootRequests, chunkRequests, progress, finished: () => finishCalls,
    loseAck: (at: number) => { ackLostAt = at; }, failAt: (root: string|null) => { failRoot = root; },
    progressFails: () => { progressFails = true; }, revoke: () => { forbidden = true; } };
}

test("128-root and 128-chunk pages preserve all 260 roots, final fragment133 and sparse memberships beyond32", async () => {
  const counts = Array(260).fill(1); counts[0] = 133;
  const f = fixture(counts, 67);
  assert.deepEqual(await f.execute(), { status: "ready", roots: 260 });
  assert.deepEqual(f.commits.map(page => page.length), [128, 128, 4]);
  assert.deepEqual(f.rootRequests.map(row => row.limit), [128, 128, 128]);
  assert.deepEqual(f.chunkRequests.map(row => row.rows), [128, 128, 4, 128, 4]);
  assert.deepEqual(f.streams.get(id(1)), [128, 5]);
  assert.equal(f.texts.get(id(1)), f.inputs[0]!.chunks.map(row => row.text).join(""));
  assert.ok(f.texts.get(id(1))!.endsWith("FINAL EVIDENCE."));
  assert.equal([...f.writes.values()].reduce((sum, row) => sum + row.coverage.processed_chunks, 0), 392);
  assert.ok([...f.writes.values()].every(row => row.decisions.length === 67));
  assert.equal(new Set(f.engineCalls).size, 260); assert.deepEqual(f.failures, []);
});

test("byte flush uses complete root prefixes and retains prefetched chunks beyond the new durable cursor", async () => {
  const f = fixture([1, 1, 133, 1, 1]);
  const pageBytes = Buffer.byteLength(JSON.stringify(f.inputs.slice(1, 3).map(item => f.outcome(item.root))));
  assert.ok(pageBytes < WORKSPACE_PROJECTION_PAGE_BYTES_V1);
  await f.execute({ page_bytes: pageBytes, chunk_page_size: 2 });
  assert.deepEqual(f.commits.map(rows => rows.length), [2, 2, 1]);
  for (const keys of f.commits) assert.ok(Buffer.byteLength(JSON.stringify(keys.map(key => f.writes.get(key)))) <= pageBytes);
  assert.ok(f.chunkRequests.some(row => row.cursor === id(2) && row.roots[0] === id(3)));
  assert.equal(f.writes.get(id(3))!.coverage.processed_chunks, 133);
  assert.equal(f.texts.get(id(3)), f.inputs[2]!.chunks.map(row => row.text).join(""));
});

test("lost acknowledgement after a durable page resumes only its suffix without duplicate writes", async () => {
  const f = fixture([1, 1, 133, 1, 1, 1, 1]);
  const pageBytes = Buffer.byteLength(JSON.stringify(f.inputs.slice(1, 3).map(item => f.outcome(item.root))));
  f.loseAck(2);
  await assert.rejects(f.execute({ page_bytes: pageBytes, chunk_page_size: 3 }), /workspace_classification_worker_failed/);
  assert.equal(f.writes.size, 4); assert.equal(f.finished(), 0);
  assert.equal(f.lease().cursor_root_id, id(4));
  assert.equal(f.failures[0]!.cursor, id(2), "an uncertain ACK cannot invent a local checkpoint");
  const before = f.engineCalls.length;
  await f.execute({ page_bytes: pageBytes, chunk_page_size: 3 });
  assert.ok(f.engineCalls.slice(before).every(root => root > id(4)));
  assert.deepEqual(f.commits, [[id(1), id(2)], [id(3), id(4)], [id(5), id(6)], [id(7)]]);
  assert.equal(f.writes.size, 7); assert.equal(f.finished(), 1);
});

test("engine interruption keeps the previously committed prefix and never manufactures a root outcome", async () => {
  const f = fixture([1, 1, 1, 1, 1]);
  f.failAt(id(4));
  await assert.rejects(f.execute({ root_page_size: 2 }), /workspace_classification_worker_failed/);
  assert.deepEqual([...f.writes.keys()], [id(1), id(2)]); assert.equal(f.finished(), 0);
  f.failAt(null); const before = f.engineCalls.length;
  await f.execute({ root_page_size: 2 });
  assert.deepEqual(f.engineCalls.slice(before), [id(3), id(4), id(5)]);
  assert.equal(f.writes.size, 5); assert.ok(f.failures.every(row => !row.code.includes("private")));
});

test("a root larger than the requested output byte capacity fails without clipping its decisions", async () => {
  const f = fixture([1], 67), size = Buffer.byteLength(JSON.stringify([f.outcome(f.inputs[0]!.root)]));
  await assert.rejects(f.execute({ page_bytes: size - 1 }), /workspace_classification_page_capacity_exceeded/);
  assert.equal(f.writes.size, 0); assert.equal(f.finished(), 0);
  await f.execute({ page_bytes: size });
  assert.equal(f.writes.get(id(1))!.decisions.length, 67);
});

test("progress transport errors cannot undo durable pages or prevent completion", async () => {
  const f = fixture([1, 133]); f.progressFails();
  assert.deepEqual(await f.execute({ root_page_size: 1 }), { status: "ready", roots: 2 });
  assert.equal(f.progress.at(-1), 100); assert.deepEqual(f.failures, []);
});

test("empty census finishes without a chunk read; premature EOF is rejected by the authoritative finish", async () => {
  const empty = fixture([]); assert.deepEqual(await empty.execute(), { status: "ready", roots: 0 });
  assert.deepEqual(empty.chunkRequests, []); assert.deepEqual(empty.commits, []);
  const truncated = fixture([1]); truncated.hooks.root = page => { page.items = []; page.done = true; };
  await assert.rejects(truncated.execute(), /workspace_classification_generation_incomplete/);
  assert.equal(truncated.writes.size, 0);
});

test("malformed root/chunk pages and cursors fail before a partial result is committed", async () => {
  const cases: Array<{code: string; alter: (f: ReturnType<typeof fixture>) => void}> = [
    { code: "root_sequence_invalid", alter: f => { f.hooks.root = page => { page.items.reverse(); }; } },
    { code: "root_page_invalid", alter: f => { f.hooks.root = page => { page.items = []; page.done = false; }; } },
    { code: "chunk_page_invalid", alter: f => { f.hooks.chunk = page => { page.items = []; page.done = false; }; } },
    { code: "chunk_cursor_invalid", alter: f => { f.hooks.chunk = page => { page.next_cursor = null; }; } },
    { code: "chunk_cursor_invalid", alter: f => { f.hooks.chunk = page => { page.items[0]!.root_id = id(999); }; } },
    { code: "chunk_cursor_invalid", alter: f => { f.hooks.chunk = page => { page.items[1] = { ...page.items[0]! }; }; } },
    { code: "chunk_integrity_failed", alter: f => { f.hooks.chunk = page => { page.items[0]!.text = "altered private text"; }; } },
    { code: "chunk_integrity_failed", alter: f => { f.hooks.chunk = page => { page.items[0]!.expected_chunks++; }; } },
    { code: "chunk_integrity_failed", alter: f => { f.hooks.chunk = page => { page.items[0]!.asset_sha256 = sha("other asset"); }; } },
    { code: "chunk_coverage_incomplete", alter: f => { f.hooks.root = page => { page.items[0]!.root.chunk_coverage_digest = sha("wrong receipt"); }; } },
    { code: "chunk_coverage_incomplete", alter: f => { f.hooks.chunk = page => { page.items = []; page.done = true; page.next_cursor = null; }; } },
  ];
  for (const example of cases) {
    const f = fixture([2, 1]); example.alter(f);
    await assert.rejects(f.execute(), new RegExp(`workspace_classification_${example.code}`));
    assert.equal(f.writes.size, 0); assert.equal(f.finished(), 0);
  }
});

test("identical full text with a changed partition cannot impersonate the prepared chunk receipt", async () => {
  const f = fixture([2]); f.hooks.chunk = page => {
    const first = page.items[0]!, second = page.items[1]!, moved = first.text.slice(-1);
    first.text = first.text.slice(0, -1); first.end--; first.chunk_sha256 = sha(first.text);
    second.text = moved + second.text; second.start--; second.chunk_sha256 = sha(second.text);
  };
  await assert.rejects(f.execute(), /workspace_classification_chunk_coverage_incomplete/);
  assert.equal(f.writes.size, 0);
});

test("an engine cannot claim consumed coverage without reading, stopping early, or reading a stream twice", async () => {
  for (const mode of ["none", "partial", "twice"] as const) {
    const f = fixture([133]); f.hooks.engine = async (_root, chunks) => {
      if (mode === "none") return;
      for await (const page of chunks) { assert.ok(page.length); if (mode === "partial") break; }
      if (mode === "twice") for await (const page of chunks) assert.ok(page.length);
    };
    await assert.rejects(f.execute(), /workspace_classification_chunk_(coverage_incomplete|stream_reused)/);
    assert.equal(f.writes.size, 0); assert.equal(f.finished(), 0);
  }
});

test("surplus fragments are rejected in a prefetched buffer or an explicit EOF read", async () => {
  for (const tail of [false, true]) {
    const f = fixture([1]); f.hooks.chunk = (page, call) => {
      if (tail && call === 1) { page.done = false; return; }
      const first = f.inputs[0]!.chunks[0]!, extra = { ...first, chunk_index: 1,
        start: first.end, end: first.end + first.text.length };
      page.items.push(extra); page.next_cursor = { root_id: extra.root_id, chunk_index: 1 }; page.done = true;
    };
    await assert.rejects(f.execute(), /workspace_classification_chunk_coverage_incomplete/);
    assert.equal(f.writes.size, 0); assert.equal(f.finished(), 0);
  }
});

test("changed checkpoint identity or actor authority prevents completion", async () => {
  for (const field of ["cursor_root_id", "execution_id", "workspace_id", "execution_token", "input_digest", "identity"] as const) {
    const f = fixture([1]); f.hooks.checkpoint = lease => ({ ...lease,
      [field]: field === "identity" ? { ...lease.identity, context_digest: sha("changed") }
        : field === "input_digest" ? sha("changed") : id(9099) });
    await assert.rejects(f.execute(), /workspace_classification_checkpoint_invalid/);
    assert.equal(f.finished(), 0);
  }
  const f = fixture([1, 1]); f.hooks.engine = async (_root, chunks) => { for await (const page of chunks) assert.ok(page.length); f.revoke(); };
  await assert.rejects(f.execute(), /workspace_classification_forbidden/);
  assert.equal(f.writes.size, 0); assert.equal(f.finished(), 0);
});

test("invalid page bounds and mismatched engine identities cannot enter a store read", async () => {
  for (const option of [{root_page_size:129},{chunk_page_size:129},{page_bytes:WORKSPACE_PROJECTION_PAGE_BYTES_V1+1},
    {root_page_size:0},{chunk_page_size:NaN},{page_bytes:1.5}]) {
    const f = fixture([1]); await assert.rejects(f.execute(option), /workspace_classification_page_size_invalid/);
    assert.deepEqual(f.rootRequests, []); assert.deepEqual(f.commits, []);
  }
  const f = fixture([1]); await assert.rejects(f.execute({engine:{ ...f.engine, engine_artifact_digest:sha("different") }}),
    /workspace_classification_engine_identity_mismatch/);
  assert.deepEqual(f.rootRequests, []);
});
