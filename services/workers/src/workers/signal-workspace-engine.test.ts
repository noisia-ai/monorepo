import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1, type SignalWorkspaceEngineInputManifestV1 } from "@noisia/query-engine";
import type { SignalWorkspaceEngineLeaseV1 } from "@noisia/db";
import { signalWorkspaceEngineJobV1 } from "./signal-workspace-engine";
import { runWorkspaceEngineProcessV1 } from "./signal-workspace-engine-process";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type WorkerOptions = NonNullable<Parameters<typeof signalWorkspaceEngineJobV1>[1]>;
type StoredEngineArtifact = NonNullable<Awaited<ReturnType<NonNullable<WorkerOptions["stores"]>["checkpoint"]>>>;

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
    const texts = ["Primera evidencia 🚗", " segunda parte completa"], artifacts = new Map<string, StoredEngineArtifact>(), objects = new Map<string, Buffer>();
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

test("real job routes a sealed full bundle to interpretation and resumes without zero-cost finish, provider or refit", async t => {
  const root = await mkdtemp(join(tmpdir(), "noisia-worker-interpret-route-"));
  try {
    type Options = NonNullable<Parameters<typeof signalWorkspaceEngineJobV1>[1]>;
    type Stores = NonNullable<Options["stores"]>;
    type Checkpoint = NonNullable<Awaited<ReturnType<Stores["checkpoint"]>>>;
    const contextRefs = [{ kind: "brand_os", digest: sha("brand context") }];
    const lease: SignalWorkspaceEngineLeaseV1 = { execution_id: id(10), workspace_id: id(1), execution_token: id(20), input_digest: sha("sealed"),
      snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: id(1), taxonomy_profile_id: id(2), preparation_run_id: id(3),
        embedding_run_id: id(4), input_revision: "1", embedding_profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
        context_digest: sha("context"), catalog_digest: sha("catalog"), prototype_plan_digest: sha("plan"),
        expected_roots: 6, expected_chunks: 6, expected_guides: 1, parent_execution_id: null, context_refs: contextRefs,
        engine_config: { ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 }, claude_cap_micro_usd: 30_000_000,
        interpretation_config: { call_configuration: SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,
          daily_cap_micro_usd: 30_000_000, budget_timezone: "UTC" } } };
    const vector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
    const chunks = Array.from({ length: 6 }, (_, i) => {
      const text = `Complete local conversation ${i} 🚗`;
      return { root_id: id(30 + i), root_fingerprint: sha(`root ${i}`), asset_sha256: sha(text), expected_root_chunks: 1,
        chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text, vector };
    });
    const artifacts = new Map<string, Checkpoint>(), objects = new Map<string, Buffer>();
    let status = "queued", processes = 0, interpretations = 0, finishes = 0, providerRequests = 0, puts = 0, gets = 0;
    let firstFit: unknown, firstGroups: unknown;
    t.mock.method(globalThis, "fetch", async () => { providerRequests++; throw new Error("External transport is forbidden in this fixture"); });
    const stores: Stores = {
      claim: async () => { if (status === "ready") return null; status = "running"; return lease; },
      chunks: async () => ({ items: chunks, next_cursor: null, done: true }),
      guides: async () => ({ items: [{ guide_key: "interest", role: "topic_positive", input_digest: sha("guide"), text_sha256: sha("guide text"), vector }], next_cursor: null, done: true }),
      parent: async () => ({ available: false, reason: "no_parent", items: [], next_cursor: null, done: true }),
      heartbeat: async () => { assert.equal(status, "running"); }, checkpoint: async () => artifacts.get("manifest.json") ?? null,
      persist: async ({ artifact }) => {
        if (artifact.artifact_key.startsWith("clusters.")) assert.equal(artifact.artifact_type, "engine_output", "Computational groups precede interpretation authority");
        const stored: Checkpoint = { artifact_id: id(100 + artifacts.size), artifact_key: artifact.artifact_key,
          content: { storage_key: artifact.storage_key, sha256: artifact.sha256, size_bytes: artifact.size_bytes, media_type: artifact.media_type }, metadata: artifact.metadata };
        const old = artifacts.get(artifact.artifact_key);
        if (old) { assert.deepEqual(old.content, stored.content); assert.deepEqual(old.metadata, stored.metadata); return { artifact_id: old.artifact_id, replayed: true }; }
        if (artifact.artifact_key === "manifest.json") {
          const bundle = artifact.metadata.bundle as Array<{ storage_key: string }>;
          assert.ok(bundle.length > 8); assert.ok(bundle.every(item => objects.has(item.storage_key)), "Bundle is durable before checkpoint");
        }
        artifacts.set(artifact.artifact_key, stored); return { artifact_id: stored.artifact_id, replayed: false };
      },
      finish: async () => { finishes++; throw new Error("Fit-only completion is forbidden with interpretation_config"); },
      fail: async () => { if (status !== "ready") status = "failed"; },
    };
    const storage: WorkspaceEngineStorageV1 = {
      put: async args => { puts++; const bytes = await readFile(args.file); assert.equal(sha(bytes), args.sha256);
        const storage_key = `workspace-engine/${args.workspace_id}/${args.execution_id}/${basename(args.file)}.${args.sha256.slice(7)}.parts.json`;
        objects.set(storage_key, bytes); return { storage_key, sha256: args.sha256, size_bytes: bytes.length, media_type: args.media_type }; },
      get: async args => { gets++; const bytes = objects.get(args.stored.storage_key)!; assert.equal(sha(bytes), args.stored.sha256);
        await writeFile(args.destination, bytes, { flag: "wx" }); },
    };
    const options: Options = { database: {} as Options["database"], stores, storage, storage_root: root,
      process: async args => {
        processes++;
        // Numerical fit is simulated; the real job's spool, hashes, complete
        // evidence join, storage/checkpoint and dispatch branch are exercised.
        const manifestBytes = await readFile(join(args.input_directory, "manifest.json"));
        const input = JSON.parse(manifestBytes.toString()) as SignalWorkspaceEngineInputManifestV1;
        const source = (await readFile(join(args.input_directory, "chunks.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as {
          ordinal: number; root_id: string; chunk_index: number; start: number; end: number; chunk_sha256: string;
        });
        await mkdir(args.output_directory);
        const files: Record<string, string> = { "roots.jsonl": source.map(row => JSON.stringify({ root_id: row.root_id }) + "\n").join(""), "lineage.json": "[]" };
        const lanes = (["open", "guided"] as const).map(lane => {
          const assigned = source.map(row => ({ ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index, start: row.start,
            end: row.end, chunk_sha256: row.chunk_sha256, local_label: row.ordinal, stable_cluster_id: `group_${row.ordinal}`, strength: 0.9 }));
          files[`assignments.${lane}.jsonl`] = assigned.map(row => JSON.stringify(row) + "\n").join("");
          files[`clusters.${lane}.json`] = JSON.stringify(assigned.map(row => ({ stable_cluster_id: row.stable_cluster_id,
            local_label: row.local_label, lane, root_count: 1, chunk_count: 1, terms: ["conversation", "", " \t"],
            representative_selection_policy: "distinct-roots-affiliation-boundary-v1", representatives: [{ ...row, selection_reason: "high_affiliation" }] })));
          files[`model.${lane}.joblib`] = "local fixture model marker, never deserialize";
          return { lane, assignments_file: `assignments.${lane}.jsonl`, clusters_file: `clusters.${lane}.json`,
            model_file: `model.${lane}.joblib`, occurrences: 6, roots: 6, clusters: 6, outlier_occurrences: 0 };
        });
        for (const [name, body] of Object.entries(files)) await writeFile(join(args.output_directory, name), body);
        await writeFile(join(args.output_directory, "manifest.json"), JSON.stringify({ contract_version: "workspace-topic-engine-output-v1",
          workspace_id: input.workspace_id, input_manifest_sha256: sha(manifestBytes), previous_manifest_sha256: null,
          input_identity: { embedding_config_digest: input.embedding_config_digest, context_digest: input.context_digest,
            catalog_digest: input.catalog_digest, chunk_policy_version: input.chunk_policy_version }, config: input.config, versions: { fixture: "no model load" },
          status: "completed", counts: { occurrences: 6, roots: 6, guides: 1, common_unchanged_roots: 0 }, lanes,
          artifacts: Object.entries(files).map(([file, body]) => ({ file, sha256: sha(body), bytes: Buffer.byteLength(body) })),
          quality: "uncalibrated", approval_policy: "none" }));
      },
      interpret: async args => {
        interpretations++; assert.ok(artifacts.has("manifest.json")); assert.ok(artifacts.has("model-manifest.json"));
        assert.equal(args.lease.snapshot.interpretation_config, lease.snapshot.interpretation_config);
        assert.equal(args.lease.snapshot.context_digest, sha("context")); assert.deepEqual(args.lease.snapshot.context_refs, contextRefs);
        assert.deepEqual(args.fit.coverage, { roots: 6, chunks: 6, guides: 1 });
        assert.equal(args.fit.result_kind, "computational_grouping"); assert.equal(args.fit.runtime_kind, "python");
        assert.equal(args.fit.artifact_format, "workspace-model-bundle-v1"); assert.ok(args.fit.model_artifact_id); assert.ok(args.fit.output_artifact_id);
        assert.deepEqual(args.fit.model_configuration.versions, { fixture: "no model load" });
        assert.equal(args.clusters.length, 12);
        assert.ok(args.clusters.every(row => JSON.stringify(row.terms) === '["conversation"]'));
        assert.deepEqual(args.clusters.map(row => row.cluster_id), ["guided", "open"].flatMap(lane => Array.from({ length: 6 }, (_, i) => `${lane}:group_${i}`)));
        assert.ok(args.clusters.every(row => row.representatives.length === 1 && row.representatives[0]!.text.startsWith("Complete local")));
        await args.heartbeat("interpreting");
        if (interpretations === 1) { firstFit = structuredClone(args.fit); firstGroups = structuredClone(args.clusters); throw new Error("workspace_engine_worker_failed"); }
        assert.deepEqual(args.fit, firstFit); assert.deepEqual(args.clusters, firstGroups);
        await args.heartbeat("materializing"); status = "ready";
        return { execution_id: lease.execution_id, model_version_id: id(300), output_catalog_profile_id: id(301), topic_count: 12 };
      },
    };
    const job = { id: "fixture-interpretation-job", data: { execution_id: lease.execution_id }, updateProgress: async () => undefined };
    await assert.rejects(signalWorkspaceEngineJobV1(job, options), /workspace_engine_worker_failed/u);
    const firstPuts = puts; assert.equal(status, "failed"); assert.equal(processes, 1); assert.equal(interpretations, 1);
    assert.deepEqual(await readdir(root), []);
    const sealedDigests = [...objects].map(([key, bytes]) => [key, sha(bytes)]);
    await t.test("a required output checkpoint failure never falls back to Python or uploads", async () => {
      const saved = stores.checkpoint;
      stores.checkpoint = async () => { throw new Error("workspace_engine_checkpoint_invalid"); };
      try {
        await assert.rejects(signalWorkspaceEngineJobV1(job, options), /workspace_engine_checkpoint_invalid/u);
        assert.equal(processes, 1); assert.equal(puts, firstPuts); assert.equal(gets, 0);
        assert.equal(interpretations, 1); assert.equal(providerRequests, 0);
        assert.deepEqual(await readdir(root), []);
      } finally { stores.checkpoint = saved; }
    });
    await t.test("restored padding is normalized without refit, upload or mutation of the sealed raw model and groups", async () => {
      const before = { processes, puts, providerRequests };
      await signalWorkspaceEngineJobV1(job, options);
      assert.deepEqual({ processes, puts, providerRequests }, before);
      assert.deepEqual([...objects].map(([key, bytes]) => [key, sha(bytes)]), sealedDigests);
      const rawGroups = [...objects].filter(([key]) => /\/clusters\.(open|guided)\.json\./u.test(key));
      assert.equal(rawGroups.length, 2);
      for (const [, bytes] of rawGroups) {
        const groups = JSON.parse(bytes.toString()) as Array<{ terms: string[] }>;
        assert.ok(groups.every(group => JSON.stringify(group.terms) === '["conversation",""," \\t"]'));
      }
    });
    assert.equal(status, "ready"); assert.equal(processes, 1); assert.equal(interpretations, 2); assert.equal(finishes, 0);
    assert.equal(puts, firstPuts); assert.equal(gets, objects.size); assert.equal(providerRequests, 0);
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await signalWorkspaceEngineJobV1(job, options), { execution_id: lease.execution_id, replayed: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
