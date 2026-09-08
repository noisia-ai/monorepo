import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import type { SignalWorkspaceEngineLeaseV1 } from "@noisia/db";
import { signalWorkspaceEngineJobV1 } from "./signal-workspace-engine";
import { runWorkspaceEngineProcessV1 } from "./signal-workspace-engine-process";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("actual numerical worker recovers a durable fit after partial DB persistence without refitting or retaining scratch", {
  skip: !process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "noisia-worker-engine-"));
  try {
    const lease: SignalWorkspaceEngineLeaseV1 = { execution_id: id(10), workspace_id: id(1), execution_token: id(20), input_digest: sha("sealed"),
      snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: id(1), taxonomy_profile_id: id(2), preparation_run_id: id(3),
        embedding_run_id: id(4), input_revision: "1", embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
        context_digest: sha("context"), catalog_digest: sha("catalog"), prototype_plan_digest: sha("plan"),
        expected_roots: 1, expected_chunks: 2, expected_guides: 0, parent_execution_id: null, context_refs: [],
        engine_config: { ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 }, claude_cap_micro_usd: 0 } };
    const texts = ["Primera evidencia 🚗", " segunda parte completa"], artifacts = new Map<string, any>(), objects = new Map<string, Buffer>();
    let failAfterCheckpoint = true, processes = 0, finishes = 0, status = "queued", offset = 0;
    const chunks = texts.map((text, chunk_index) => { const item = { root_id: id(30), root_fingerprint: sha("fingerprint"),
      asset_sha256: sha(texts.join("")), expected_root_chunks: 2, chunk_index, start: offset, end: offset + text.length,
      chunk_sha256: sha(text), text, vector: Array.from({ length: 1024 }, (_, n) => n === 0 ? 1 : 0) }; offset = item.end; return item; });
    type Options = NonNullable<Parameters<typeof signalWorkspaceEngineJobV1>[1]>;
    const stores: NonNullable<Options["stores"]> = {
      claim: async () => { if (status === "ready") return null; status = "running"; return lease; },
      chunks: async () => ({ items: chunks, next_cursor: null, done: true }),
      guides: async () => ({ items: [], next_cursor: null, done: true }),
      parent: async () => ({ available: false, reason: "no_parent", items: [], next_cursor: null, done: true }),
      heartbeat: async () => { assert.equal(status, "running"); },
      checkpoint: async () => artifacts.get("manifest.json") ?? null,
      persist: async ({ artifact }) => {
        const old = artifacts.get(artifact.artifact_key);
        if (old) { assert.deepEqual(old.content, { storage_key: artifact.storage_key, sha256: artifact.sha256, size_bytes: artifact.size_bytes, media_type: artifact.media_type });
          assert.deepEqual(old.metadata, artifact.metadata); return { artifact_id: old.artifact_id, replayed: true }; }
        const stored = { artifact_id: id(100 + artifacts.size), artifact_key: artifact.artifact_key,
          content: { storage_key: artifact.storage_key, sha256: artifact.sha256, size_bytes: artifact.size_bytes, media_type: artifact.media_type }, metadata: artifact.metadata };
        artifacts.set(artifact.artifact_key, stored);
        if (failAfterCheckpoint) { failAfterCheckpoint = false; throw new Error("fixture connection lost after checkpoint"); }
        return { artifact_id: stored.artifact_id, replayed: false };
      },
      finish: async args => { assert.equal(args.result_kind, "insufficient_population"); assert.equal(args.model_artifact_id, null);
        assert.deepEqual(args.coverage, { roots: 1, chunks: 2, guides: 0 }); finishes++; status = "ready";
        return { execution_id: lease.execution_id, model_version_id: null }; },
      fail: async () => { if (status !== "ready") status = "failed"; }
    };
    const storage: WorkspaceEngineStorageV1 = {
      put: async args => { const bytes = await readFile(args.file); assert.equal(sha(bytes), args.sha256);
        const storage_key = `workspace-engine/${args.workspace_id}/${args.execution_id}/${basename(args.file)}.${args.sha256.slice(7)}.parts.json`;
        objects.set(storage_key, bytes); return { storage_key, sha256: args.sha256, size_bytes: bytes.length, media_type: args.media_type }; },
      get: async args => { const bytes = objects.get(args.stored.storage_key)!; assert.equal(sha(bytes), args.stored.sha256);
        await writeFile(args.destination, bytes, { flag: "wx" }); }
    };
    const options: Options = { database: {} as Options["database"], stores, storage, storage_root: root,
      python: process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON!, module_root: resolve("../../tools/signal-semantic-lab/src"),
      process: async args => { processes++; await runWorkspaceEngineProcessV1(args); } };
    const job = { id: "fixture-numerical-worker", data: { execution_id: lease.execution_id }, updateProgress: async () => undefined };
    await assert.rejects(signalWorkspaceEngineJobV1(job, options), /workspace_engine_worker_failed/u);
    assert.equal(status, "failed"); assert.equal(artifacts.size, 1); assert.equal(processes, 1); assert.deepEqual(await readdir(root), []);
    await signalWorkspaceEngineJobV1(job, options);
    assert.equal(status, "ready"); assert.equal(processes, 1); assert.equal(finishes, 1); assert.ok(artifacts.size > 1);
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await signalWorkspaceEngineJobV1(job, options), { execution_id: lease.execution_id, replayed: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
