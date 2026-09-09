import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, parseSignalWorkspaceIncrementalOutputV1,
  signalWorkspaceIncrementalDigestV1 as digest, type SignalWorkspaceIncrementalInputV1 as Input,
  type SignalWorkspaceIncrementalRootV1 as Root } from "@noisia/query-engine";
import { isSignalWorkspaceEngineRetryableErrorV1, type SignalWorkspaceEngineLeaseV1 as Lease,
  type SignalWorkspaceEngineArtifactV1 as Artifact, type SignalWorkspaceIncrementalArtifactRefV1 as ArtifactRef,
  type SignalWorkspaceIncrementalDescriptorV1 as Descriptor } from "@noisia/db";
import { runSignalWorkspaceIncrementalJobV1 as run, safeWorkspaceIncrementalErrorV1, type WorkspaceIncrementalJobOptionsV1 as Options } from "./signal-workspace-engine-incremental";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

type Stores = NonNullable<Options["stores"]>;
type Checkpoint = Awaited<ReturnType<Stores["checkpoint"]>>;
const fixtureRoot = resolve(import.meta.dirname, "../../../../.data/workspace-incremental-2026-09-09/pytest-final/incremental-real0");
const available = existsSync(fixtureRoot);
const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const rows = async <T>(path: string): Promise<T[]> => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as T);
const media = (name: string) => name.endsWith(".json") ? "application/json" : name.endsWith(".jsonl") ? "application/x-ndjson" : "application/octet-stream";
function vector(bytes: Buffer, ordinal: number) {
  const offset = 10 + bytes.readUInt16LE(8) + ordinal * 4096;
  return Array.from({ length: 1024 }, (_, index) => bytes.readFloatLE(offset + index * 4));
}
type InputRecord = { ordinal: number; root_id: string; root_fingerprint: string; asset_sha256: string; expected_chunks: number;
  chunk_index: number; start: number; end: number; chunk_sha256: string; text: string };
type GuideRecord = { ordinal: number; guide_key: string; input_digest: string; role: "topic_positive" | "topic_negative" | "scope_positive" | "scope_negative" };
type Stored = Awaited<ReturnType<WorkspaceEngineStorageV1["put"]>>;

/** Real previously-computed numeric bytes, mocked durable ledger/storage. COPY
 * never executes Python or fits a model; only the request envelope is rebound to
 * the fresh Node spool's byte identity. Memberships, models and origins stay exact. */
async function harness(wave = 2) {
  const scratch = await mkdtemp(join(tmpdir(), "noisia-incremental-job-"));
  const inputDirectory = join(fixtureRoot, wave === 4 ? "empty-input" : `input${wave}`);
  const outputDirectory = join(fixtureRoot, wave === 4 ? "empty-output" : `output${wave}`), parentDirectory = join(fixtureRoot, `output${wave - 1}`);
  const input = await read(join(inputDirectory, "incremental.json")) as Input, manifest = await read(join(inputDirectory, "manifest.json"));
  const expected = parseSignalWorkspaceIncrementalOutputV1(await read(join(outputDirectory, "manifest.json")));
  const parentManifest = await read(join(parentDirectory, "manifest.json"));
  const descriptorBody = { contract_version: "workspace-incremental-numeric-descriptor-v1" as const, mode: "frozen-model-delta" as const,
    policy_version: input.policy_version, parent: { ...input.parent, output_artifact_id: id(600), manifest_contract: parentManifest.contract_version,
      checkpoint_digest: sha("parent-checkpoint"), model_version_id: id(601), model_bank_artifact_id: id(602) },
    compatibility: input.compatibility, discovery: { close_requested: input.discovery.close_requested }, root_correction_epoch: sha("correction-epoch"),
    editorial_cut: { unit_count: 0, unit_digest: sha("") } };
  const descriptor: Descriptor = { ...descriptorBody, descriptor_digest: digest(descriptorBody) };
  const lease: Lease = { execution_id: input.execution_id, workspace_id: input.workspace_id, execution_token: id(610), input_digest: sha("server-input"),
    snapshot: { contract_version: "workspace-topic-engine-v1", workspace_id: input.workspace_id, taxonomy_profile_id: id(611),
      preparation_run_id: manifest.preparation_run_id, embedding_run_id: manifest.embedding_run_id, input_revision: String(manifest.input_revision),
      embedding_profile: { ...SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, config_digest: manifest.embedding_config_digest }, context_digest: manifest.context_digest,
      catalog_digest: manifest.catalog_digest, prototype_plan_digest: sha("prototype-plan"), expected_roots: manifest.records.roots,
      expected_chunks: manifest.records.rows, expected_guides: manifest.guides.rows, parent_execution_id: input.parent.execution_id,
      context_refs: [], engine_config: manifest.config, claude_cap_micro_usd: 0, numeric_descriptor: descriptor } };
  const recordRows = await rows<InputRecord>(join(inputDirectory, "chunks.jsonl")), vectorBytes = await readFile(join(inputDirectory, "vectors.npy"));
  const chunks = recordRows.map(({ ordinal, expected_chunks, ...row }) => ({ ...row, expected_root_chunks: expected_chunks, vector: vector(vectorBytes, ordinal) }));
  const guideBytes = await readFile(join(inputDirectory, "guide-vectors.npy"));
  const guides = (await rows<GuideRecord>(join(inputDirectory, "guides.jsonl"))).map(({ ordinal, ...row }) => ({ ...row, text_sha256: sha(`guide:${ordinal}`), vector: vector(guideBytes, ordinal) }));
  const roots = await rows<Root>(join(inputDirectory, "current-roots.jsonl"));
  const objects = new Map<string, Buffer>(), ledger = new Map<string, ArtifactRef>(), artifacts = new Map<string, Artifact>(), aliases = new Map<string, Parameters<Stores["components"]>[0]["components"][number]>();
  const checkpoint: Checkpoint = { input_artifact: null, output_index_artifact: null, numeric_checkpoint: null };
  const events: string[] = [], failures: string[] = [], counts = { process: 0, chunks: 0, roots: 0, guides: 0, get: 0, put: 0, index: 0, input: 0, finish: 0, checkpoint: 0, history: 0 };
  let failInputAck = false, failIndexAck = false, failNumericAck = false, failPersistAfter: number | null = null, nextId = 1000, attempts = 0;
  const prefix = (execution: string) => `workspace-engine/${lease.workspace_id}/${execution}/`;
  const storage: WorkspaceEngineStorageV1 = {
    async put(args) { counts.put++; events.push(`put:${basename(args.file)}`);
      assert.equal(args.workspace_id, lease.workspace_id); assert.equal(args.execution_id, lease.execution_id);
      const body = await readFile(args.file); assert.equal(sha(body), args.sha256); assert.equal(body.length, args.size_bytes);
      const storage_key = `${prefix(args.execution_id)}${basename(args.file)}.${args.sha256.slice(7)}.parts.json`;
      const existing = objects.get(storage_key); if (existing) assert.deepEqual(body, existing); objects.set(storage_key, body);
      return { storage_key, sha256: args.sha256, size_bytes: body.length, media_type: args.media_type }; },
    async get(args) { counts.get++; events.push(`get:${basename(args.destination)}`);
      assert.equal(args.workspace_id, lease.workspace_id); assert.ok(args.stored.storage_key.startsWith(prefix(args.execution_id)));
      const body = objects.get(args.stored.storage_key); if (!body || sha(body) !== args.stored.sha256 || body.length !== args.stored.size_bytes)
        throw new Error("workspace_engine_storage_verification_failed");
      await writeFile(args.destination, body, { flag: "wx" }); }
  };
  const parentRefs: ArtifactRef[] = [];
  for (const name of ["manifest.json", ...parentManifest.artifacts.map((ref: { file: string }) => ref.file)].sort()) {
    const body = await readFile(join(parentDirectory, name)), storage_key = `${prefix(input.parent.execution_id)}${name}.${sha(body).slice(7)}.parts.json`;
    objects.set(storage_key, body); parentRefs.push({ artifact_id: id(nextId++), owner_execution_id: input.parent.execution_id, artifact_key: name,
      storage_key, sha256: sha(body), size_bytes: body.length, media_type: media(name), metadata: { filename: name } });
  }
  function save(artifact: Artifact, metadata = artifact.metadata) {
    const old = ledger.get(artifact.artifact_key), stored: ArtifactRef = { artifact_id: old?.artifact_id ?? id(nextId++), owner_execution_id: lease.execution_id,
      artifact_key: artifact.artifact_key, storage_key: artifact.storage_key, sha256: artifact.sha256, size_bytes: artifact.size_bytes, media_type: artifact.media_type, metadata };
    assert.equal(sha(objects.get(stored.storage_key)!), stored.sha256);
    if (old) assert.deepEqual(stored, old); else { ledger.set(artifact.artifact_key, stored); artifacts.set(artifact.artifact_key, artifact); }
    return { stored, result: { artifact_id: stored.artifact_id, replayed: Boolean(old) } };
  }
  const indexJson = () => JSON.parse(objects.get(checkpoint.output_index_artifact!.storage_key)!.toString()) as { files: Array<Stored & { name: string }>; input_artifact_id: string };
  const stores: Stores = {
    checkpoint: async () => { counts.checkpoint++; events.push("checkpoint"); return checkpoint; },
    heartbeat: async args => { assert.equal(args.lease.execution_id, lease.execution_id);
      if (args.exported) assert.deepEqual({ roots: args.exported.roots, chunks: args.exported.chunks, guides: args.exported.guides },
        { roots: expected.counts.roots, chunks: expected.counts.occurrences, guides: guides.length }); },
    fail: async args => { failures.push(args.error_code); events.push(`fail:${args.error_code}`); },
    parent: async args => { assert.equal(args.limit, 128); const all = parentRefs.filter(row => !args.after_artifact_key || row.artifact_key > args.after_artifact_key);
      const items = all.slice(0, 128); return { items, next_cursor: items.at(-1)?.artifact_key ?? null, done: all.length <= 128 }; },
    chunks: async args => { counts.chunks++; assert.equal(args.limit, 128);
      const after = args.after, all = chunks.filter(row => !after || row.root_id > after.root_id || row.root_id === after.root_id && row.chunk_index > after.chunk_index);
      const items = all.slice(0, 128), last = items.at(-1); return { items, next_cursor: last ? { root_id: last.root_id, chunk_index: last.chunk_index } : after, done: all.length <= 128 }; },
    guides: async args => { counts.guides++; assert.equal(args.limit, 128);
      const after = args.after, all = guides.filter(row => !after || row.guide_key > after.guide_key || row.guide_key === after.guide_key && row.input_digest > after.input_digest);
      const items = all.slice(0, 128), last = items.at(-1); return { items, next_cursor: last ? { guide_key: last.guide_key, input_digest: last.input_digest } : after, done: all.length <= 128 }; },
    roots: async args => { counts.roots++; assert.equal(args.limit, 128); const all = roots.filter(row => !args.after_root_id || row.root_id > args.after_root_id);
      const items = all.slice(0, 128); return { items, next_cursor: items.at(-1)?.root_id ?? args.after_root_id, done: all.length <= 128 }; },
    input: async args => { counts.input++; events.push("input:durable"); assert.equal(counts.process, 0);
      assert.equal(args.roots_count, roots.length); assert.equal(args.chunks_count, chunks.length); assert.equal(args.input_files.length, 6);
      for (const file of args.input_files) assert.equal(sha(objects.get(file.storage_key)!), file.sha256);
      const saved = save(args.artifact, { input: args.input, input_files: args.input_files }); checkpoint.input_artifact = saved.stored;
      if (failInputAck) { failInputAck = false; throw Object.assign(new Error("local COMMIT acknowledgement lost"), { code: "ECONNRESET" }); } return saved.result; },
    index: async args => { counts.index++; events.push("index:durable"); assert.ok(checkpoint.input_artifact); assert.equal(args.input_artifact_id, checkpoint.input_artifact.artifact_id);
      const body = JSON.parse(objects.get(args.artifact.storage_key)!.toString());
      assert.equal(body.input_artifact_id, args.input_artifact_id); assert.equal(body.files.length, args.file_count);
      for (const file of body.files as Stored[]) assert.equal(sha(objects.get(file.storage_key)!), file.sha256);
      assert.equal(ledger.size, 1, "output file rows must not precede durable output index");
      const saved = save(args.artifact, { file_count: args.file_count, output_manifest: args.output_manifest }); checkpoint.output_index_artifact = saved.stored;
      if (failIndexAck) { failIndexAck = false; throw Object.assign(new Error("local index COMMIT acknowledgement lost"), { code: "ECONNRESET" }); } return saved.result; },
    persist: async args => { assert.ok(checkpoint.output_index_artifact); events.push(`persist:${args.artifact.artifact_key}`);
      const file = indexJson().files.find(ref => ref.name === args.artifact.artifact_key); assert.ok(file);
      assert.equal(args.artifact.sha256, file.sha256); assert.equal(args.artifact.size_bytes, file.size_bytes);
      assert.equal(args.artifact.artifact_type, args.artifact.artifact_key.endsWith(".joblib") || args.artifact.artifact_key === "model-manifest.json" ? "engine_model" : "engine_output");
      const saved = save(args.artifact);
      if (failPersistAfter !== null && --failPersistAfter === 0) { failPersistAfter = null; throw Object.assign(new Error("local partial output COMMIT acknowledgement lost"), { code: "ECONNRESET" }); }
      return saved.result; },
    bank: async args => { events.push("bank"); assert.equal(args.model_bank_artifact_id, ledger.get("model-manifest.json")?.artifact_id);
      assert.equal(args.output_artifact_id, ledger.get("manifest.json")?.artifact_id); return { model_version_id: id(700) }; },
    components: async args => { events.push("components"); assert.ok(args.components.length <= 128); assert.equal(args.model_version_id, id(700));
      return { items: args.components.map(component => { const expectedComponent = expected.components.find(row => row.component_key === component.component_key)!;
        assert.deepEqual(component.model_origin, expectedComponent.model_origin); assert.equal(component.unit_count, expectedComponent.units.length);
        assert.equal(component.unit_digest, digest(expectedComponent.units));
        assert.equal(component.model_artifact_id, ledger.get(expectedComponent.model.file)?.artifact_id);
        assert.equal(component.center_artifact_id, expectedComponent.center ? ledger.get(expectedComponent.center.file)?.artifact_id : null);
        const old = aliases.get(component.component_key); if (old) assert.deepEqual(component, old); aliases.set(component.component_key, component);
        return { artifact_id: id(800 + aliases.size), component_key: component.component_key, replayed: Boolean(old) }; }) }; },
    history: async args => { counts.history++; assert.equal(args.limit, 128); return { parent_history: null, items: [], next_cursor: null, done: true }; },
    persistHistory: async args => { events.push("history:durable"); assert.equal(args.relations_artifact_id, ledger.get("relations.json")?.artifact_id); return save(args.artifact).result; },
    checkpointOutput: async args => { events.push("numeric:durable"); const output = parseSignalWorkspaceIncrementalOutputV1(args.output);
      assert.equal(args.output_index_artifact_id, checkpoint.output_index_artifact?.artifact_id); assert.equal(args.input_artifact_id, checkpoint.input_artifact?.artifact_id);
      assert.equal(args.output_artifact_id, ledger.get("manifest.json")?.artifact_id); assert.equal(args.history_artifact_id, ledger.get("incremental-history.json")?.artifact_id);
      assert.equal(args.validation.roots, expected.counts.roots); assert.equal(args.validation.memberships, expected.counts.memberships);
      assert.equal(args.validation.occurrences, expected.counts.occurrences); assert.equal(aliases.size, expected.components.length);
      for (const file of output.artifacts) assert.equal(file.sha256, ledger.get(file.file)?.sha256);
      checkpoint.numeric_checkpoint = { contract_version: "workspace-incremental-numeric-checkpoint-v1", checkpoint_digest: digest(args.validation),
        descriptor_digest: descriptor.descriptor_digest, input_artifact_id: args.input_artifact_id, output_index_artifact_id: args.output_index_artifact_id,
        output_artifact_id: args.output_artifact_id, model_bank_artifact_id: args.model_bank_artifact_id, model_version_id: args.model_version_id,
        population_digest: output.population_digest, roots: output.counts.roots, occurrences: output.counts.occurrences, components: output.components.length,
        component_digest: digest(output.components), model_bank_bytes: output.counts.model_bank_bytes, discovery_status: output.discovery_status,
        relations_status: output.relations_status, history_artifact_id: args.history_artifact_id, numeric_complete: true, analysis_complete: false };
      if (failNumericAck) { failNumericAck = false; throw Object.assign(new Error("local numeric COMMIT acknowledgement lost"), { code: "ECONNRESET" }); } return checkpoint.numeric_checkpoint; },
    finish: async args => { counts.finish++; events.push("finish"); assert.ok(checkpoint.numeric_checkpoint);
      assert.equal(args.checkpoint_digest, checkpoint.numeric_checkpoint.checkpoint_digest);
      return { execution_id: lease.execution_id, numeric_complete: true, analysis_complete: false, checkpoint: checkpoint.numeric_checkpoint }; }
  };
  const options: Options = { stores, storage, storage_root: scratch,
    process: async args => { counts.process++; events.push("process:COPY"); assert.equal(args.mode, "incremental_numeric"); assert.ok(checkpoint.input_artifact);
      assert.equal(args.previous?.manifest_sha256, descriptor.parent.manifest_sha256);
      const actual = await read(join(args.input_directory, "incremental.json")) as Input;
      assert.deepEqual(actual.compatibility, input.compatibility); assert.deepEqual(actual.discovery, input.discovery);
      assert.deepEqual(await rows(join(args.input_directory, "chunks.jsonl")), await rows(join(inputDirectory, "chunks.jsonl")));
      for (const name of ["vectors.npy", "guide-vectors.npy"]) assert.deepEqual(await readFile(join(args.input_directory, name)), await readFile(join(inputDirectory, name)));
      assert.deepEqual(await rows(join(args.input_directory, "guides.jsonl")), await rows(join(inputDirectory, "guides.jsonl")));
      assert.deepEqual(await rows(join(args.input_directory, "current-roots.jsonl")), roots);
      await cp(outputDirectory, args.output_directory, { recursive: true });
      await writeFile(join(args.output_directory, "manifest.json"), JSON.stringify({ ...expected,
        request_digest: digest({ input: actual, runtime_digest: actual.compatibility.runtime_digest }) }) + "\n"); }
  };
  const database = {} as Parameters<typeof run>[0]["database"];
  const job = { id: "isolated-incremental-job", data: { execution_id: lease.execution_id }, updateProgress: async () => undefined };
  const invoke = async (override: Options = {}) => { lease.execution_token = id(900 + ++attempts); return run({ database, lease, job }, { ...options, ...override }); };
  return { invoke, scratch, options, lease, counts, events, failures, checkpoint, ledger, artifacts, aliases, objects, expected, indexJson,
    faults: { inputAck: () => { failInputAck = true; }, indexAck: () => { failIndexAck = true; }, numericAck: () => { failNumericAck = true; }, persist: (after: number) => { failPersistAfter = after; } },
    cleanup: () => rm(scratch, { recursive: true, force: true }) };
}

test("incremental Worker persists input, validates all computed files, seals index before rows and registers real origins", { skip: !available }, async t => {
  let network = 0; t.mock.method(globalThis, "fetch", async () => { network++; throw new Error("Provider forbidden"); });
  const h = await harness(); try {
    const result = await h.invoke(); assert.equal(result.numeric_complete, true); assert.equal(result.analysis_complete, false);
    assert.equal(h.counts.process, 1); assert.equal(h.counts.input, 1); assert.equal(h.counts.index, 1); assert.equal(h.counts.finish, 1);
    assert.equal(h.counts.chunks, 5); assert.equal(h.counts.roots, 4); assert.equal(h.counts.guides, 1);
    assert.equal(h.aliases.size, 4); assert.equal(new Set([...h.aliases.values()].map(c => c.model_origin.execution_id)).size, 2);
    assert.ok(h.events.indexOf("input:durable") < h.events.indexOf("process:COPY"));
    assert.ok(h.events.indexOf("index:durable") < h.events.findIndex(event => event.startsWith("persist:")));
    assert.ok(h.events.indexOf("numeric:durable") < h.events.indexOf("finish"));
    assert.deepEqual(await readdir(h.scratch), []); assert.equal(network, 0); assert.deepEqual(h.failures, []);
  } finally { await h.cleanup(); }
});

for (const fault of ["indexAck", "inputAck", "partialPersist"] as const) test(`incremental Worker recovers ${fault} using durable bytes without duplicate export or refit`, { skip: !available }, async () => {
  const h = await harness(); try {
    if (fault === "partialPersist") h.faults.persist(3); else h.faults[fault]();
    await assert.rejects(h.invoke(), /workspace_engine_incremental_transport_unavailable/u);
    assert.equal(h.failures.at(-1), "workspace_engine_incremental_transport_unavailable"); assert.equal(isSignalWorkspaceEngineRetryableErrorV1(h.failures.at(-1)!), false, "numeric transport does not expand legacy retry authority");
    const before = { ...h.counts }, ids = new Map([...h.ledger].map(([key, value]) => [key, value.artifact_id]));
    assert.ok(h.checkpoint.input_artifact); assert.equal(h.counts.process, fault === "inputAck" ? 0 : 1);
    if (fault !== "inputAck") assert.ok(h.checkpoint.output_index_artifact);
    await h.invoke(); assert.equal(h.counts.process, 1); assert.equal(h.counts.input, 1);
    assert.equal(h.counts.chunks, before.chunks); assert.equal(h.counts.roots, before.roots); assert.equal(h.counts.guides, before.guides);
    if (fault !== "inputAck") { assert.equal(h.counts.put, before.put); assert.equal(h.counts.index, before.index); }
    for (const [key, value] of ids) assert.equal(h.ledger.get(key)?.artifact_id, value);
    assert.equal(h.checkpoint.numeric_checkpoint?.analysis_complete, false); assert.deepEqual(await readdir(h.scratch), []);
  } finally { await h.cleanup(); }
});

for (const target of ["index", "membership"] as const) for (const fault of ["missing", "tampered"] as const) test(`durable output ${target} with ${fault} bytes fails closed and cannot fall back to export/process`, { skip: !available }, async () => {
  const h = await harness(); try {
    h.faults.indexAck(); await assert.rejects(h.invoke(), /workspace_engine_incremental_transport_unavailable/u);
    const stored = target === "index" ? h.checkpoint.output_index_artifact! : h.indexJson().files.find(ref => ref.name === "memberships.jsonl")!;
    if (fault === "missing") h.objects.delete(stored.storage_key); else h.objects.set(stored.storage_key, Buffer.from("changed bytes"));
    const before = { ...h.counts };
    await assert.rejects(h.invoke(), /workspace_engine_storage_verification_failed/u);
    assert.equal(h.counts.process, before.process); assert.equal(h.counts.chunks, before.chunks); assert.equal(h.counts.put, before.put);
    assert.equal(h.checkpoint.numeric_checkpoint, null); assert.equal(h.counts.finish, 0); assert.deepEqual(await readdir(h.scratch), []);
  } finally { await h.cleanup(); }
});

test("durable numeric checkpoint resumes finish without storage configuration, export, process or artifact IO", { skip: !available }, async () => {
  const h = await harness(); try {
    h.faults.numericAck(); await assert.rejects(h.invoke(), /workspace_engine_incremental_transport_unavailable/u); assert.ok(h.checkpoint.numeric_checkpoint);
    const before = { ...h.counts };
    const result = await h.invoke({ storage: undefined, process: async () => { throw new Error("Process must not run"); }, storage_root: "/path/that/must/not/be/created" });
    assert.equal(result.numeric_complete, true); assert.equal(result.analysis_complete, false);
    assert.deepEqual({ ...h.counts, checkpoint: before.checkpoint, finish: before.finish }, before);
    assert.equal(h.counts.checkpoint, before.checkpoint + 1); assert.equal(h.counts.finish, before.finish + 1);
  } finally { await h.cleanup(); }
});

for (const wave of [3, 4]) test(`incremental Worker consumes computed wave ${wave === 4 ? "401-root complete retirement" : wave} with no new interpretation`, { skip: !available }, async () => {
  const h = await harness(wave); try {
    const result = await h.invoke(); assert.equal(result.analysis_complete, false); assert.equal(result.numeric_complete, true);
    assert.equal(h.counts.process, 1); assert.equal(h.aliases.size, 4);
    assert.equal(result.checkpoint.roots, wave === 3 ? 401 : 0); assert.equal(result.checkpoint.occurrences, wave === 3 ? 534 : 0);
    if (wave === 4) { assert.equal(h.expected.counts.removed_roots, 401); assert.deepEqual(h.expected.operations, { fit: [], transform: [] }); }
    assert.deepEqual(await readdir(h.scratch), []);
  } finally { await h.cleanup(); }
});

// Only explicit transport codes may make a numerical request retryable.
test("incremental error classification preserves integrity errors and distinguishes real transport failures", () => {
  for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "57P01", "57P02", "57P03", "08000", "08003", "08006", "40001", "40P01"])
    assert.equal(safeWorkspaceIncrementalErrorV1(Object.assign(new Error("private driver details"), {code})), "workspace_engine_incremental_transport_unavailable");
  for (const error of [new Error("connection problem"), Object.assign(new Error("private SQL details"), {code:"23514"}), {cause:{code:"ECONNRESET"}}, null])
    assert.equal(safeWorkspaceIncrementalErrorV1(error), "workspace_engine_worker_failed");
  assert.equal(safeWorkspaceIncrementalErrorV1(new Error("workspace_engine_incremental_history_invalid")), "workspace_engine_incremental_history_invalid");
  assert.equal(safeWorkspaceIncrementalErrorV1(new Error("workspace_engine_storage_verification_failed")), "workspace_engine_storage_verification_failed");
});
