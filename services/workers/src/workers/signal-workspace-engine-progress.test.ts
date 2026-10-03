import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { signalWorkspaceEngineProgressJobV1 as run } from "./signal-workspace-engine-progress";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
type Options = NonNullable<Parameters<typeof run>[1]>;
type Stores = NonNullable<Options['stores']>;

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "engine-progress-test-"));
  const scope = { execution_id: id(1), workspace_id: id(2), actor_user_id: id(3) };
  const bodies = [JSON.stringify({ interpretations: ["first"] }), JSON.stringify({ interpretations: ["second"] })];
  const items = bodies.map((body, index) => ({ artifact_id: id(10 + index), artifact_key: `interpretation-${id(10 + index)}.json`,
    storage_key: `private/${index}`, sha256: sha(body), size_bytes: Buffer.byteLength(body), media_type: "application/json" }));
  let confirmed = false, breakComplete = false, insideTransaction = false;
  const events: string[] = [], failures: string[] = [];
  const coverage = { unit_count: 2, unit_digest: sha('available units') };
  const metadata = { contract_version: "workspace-topic-materialization-progress-v1" as const, execution_id: scope.execution_id,
    interpretation_units_digest: coverage.unit_digest, interpreted_unit_count: 2,
    expected_interpretation_units_digest: sha('all units'), expected_interpretation_unit_count: 4, interpretation_complete: false,
    output_catalog_profile_id: id(4), output_catalog_revision: 2, topic_count: 2, discovered_topic_count: 2, mapping_digest: sha('mapping') };
  const stores = {
    heartbeat: async () => undefined,
    source: async () => { events.push('source'); return { ...scope, coverage, catalog_profile_id: id(5), needs_materialization: !confirmed }; },
    checkpoints: async ({ after_artifact_id }: { after_artifact_id?: string | null }) => {
      assert.equal(insideTransaction, false, "checkpoint DB reads must finish before the catalog transaction");
      events.push('page'); const index = after_artifact_id === null ? 0 : 1;
      return { items: [items[index]], next_artifact_id: items[index]!.artifact_id, done: index === 1 };
    },
    materialize: async (args: Parameters<Stores['materialize']>[0]) => {
      events.push('materialize'); insideTransaction = true;
      const received = [];
      for await (const proposal of args.proposals) received.push(proposal);
      insideTransaction = false;
      assert.deepEqual(received, bodies.map((body, index) => ({ artifact_id: items[index]!.artifact_id, body })));
      assert.deepEqual(args.expected_coverage, coverage); assert.equal(args.expected_catalog_profile_id, id(5));
      return { ...metadata, mapping: [], replayed: false };
    },
    persist: async (args: Parameters<Stores['persist']>[0]) => {
      events.push('persist'); assert.equal(args.artifact.artifact_key, `materialization-progress-${id(4)}.json`);
      assert.deepEqual(args.artifact.metadata, metadata); confirmed = true;
      return { artifact_id: id(6), projection_execution_id: id(7), generation_id: id(8), replayed: false };
    },
    complete: async () => { events.push('complete'); if (breakComplete) { breakComplete = false; throw new Error('private connection error'); } },
    fail: async (args: { error_code: string }) => { failures.push(args.error_code); }
  } as unknown as Stores;
  const options: Options = { database: {} as never, stores, storage_root: scratch, storage: {
    get: async args => {
      assert.equal(insideTransaction, false); events.push('get');
      const index = items.findIndex(item => item.storage_key === args.stored.storage_key);
      await writeFile(args.destination, bodies[index]!, { flag: 'wx', mode: 0o600 });
    },
    put: async args => {
      events.push('put'); assert.equal(insideTransaction, false);
      const body = await readFile(args.file); assert.equal(sha(body), args.sha256); assert.equal(body.byteLength, args.size_bytes);
      assert.equal(JSON.parse(body.toString()).interpretation_complete, false);
      return { storage_key: 'private/materialization', sha256: args.sha256, size_bytes: args.size_bytes, media_type: args.media_type };
    }
  } };
  return { items, options, events, failures,
    job: { id: 'durable-progress-job', data: scope, updateProgress: async () => undefined },
    breakCompletion: () => { breakComplete = true; },
    close: async () => { assert.deepEqual(await readdir(scratch), []); await rmdir(scratch); }
  };
}

test("paid checkpoints are fully spooled before catalog locks, then persisted and dispatched without engine work", async () => {
  const f = await fixture(); try {
    assert.deepEqual(await run(f.job, f.options), { artifact_id: id(6), projection_execution_id: id(7), generation_id: id(8), replayed: false });
    assert.deepEqual(f.events, ['source', 'page', 'get', 'page', 'get', 'materialize', 'put', 'persist', 'complete']);
    assert.deepEqual(f.failures, []);
  } finally { await f.close(); }
});

test("lost dispatch acknowledgement replays the durable receipt without downloading or writing the catalog twice", async () => {
  const f = await fixture(); try {
    f.breakCompletion(); await assert.rejects(run(f.job, f.options), /^Error: workspace_engine_progress_failed$/u);
    const before = f.events.length;
    assert.deepEqual(await run(f.job, f.options), { execution_id: id(1), replayed: true });
    assert.deepEqual(f.events.slice(before), ['source', 'complete']);
    assert.deepEqual(f.failures, ['workspace_engine_progress_failed']);
  } finally { await f.close(); }
});

test("invalid checkpoint integrity or pagination never reaches materialization", async () => {
  for (const mode of ['hash', 'size', 'mime', 'cursor'] as const) {
    const f = await fixture(); try {
      if (mode === 'hash') f.items[0]!.sha256 = sha('corrupt');
      if (mode === 'size') f.items[0]!.size_bytes = 2 * 1024 * 1024 + 1;
      if (mode === 'mime') f.items[0]!.media_type = 'text/html';
      if (mode === 'cursor') f.items[1]!.artifact_id = f.items[0]!.artifact_id;
      await assert.rejects(run(f.job, f.options), /workspace_engine_interpretation_checkpoint_invalid/u);
      assert.equal(f.events.includes('materialize'), false);
    } finally { await f.close(); }
  }
});

test("a stale catalog or revoked authority remains an explicit rejection and cannot complete the derived dispatch", async () => {
  for (const method of ['source', 'materialize', 'persist'] as const) {
    const f = await fixture(); try {
      f.options.stores![method] = async () => { throw new Error('workspace_engine_progress_catalog_changed'); };
      await assert.rejects(run(f.job, f.options), /workspace_engine_progress_catalog_changed/u);
      assert.equal(f.events.includes('complete'), false);
      assert.deepEqual(f.failures, ['workspace_engine_progress_catalog_changed']);
    } finally { await f.close(); }
  }
});
