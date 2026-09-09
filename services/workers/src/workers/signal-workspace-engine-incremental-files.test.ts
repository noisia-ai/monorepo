import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 as config, SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1 as policy,
  signalWorkspaceIncrementalDigestV1 as digest, signalWorkspaceIncrementalMembershipDigestV1 as memberDigest,
  buildSignalWorkspaceIncrementalRootDeltaV1,
  type SignalWorkspaceEngineChunkV1 as Chunk, type SignalWorkspaceIncrementalRootV1 as Root,
} from "@noisia/query-engine";
import { spoolSignalWorkspaceEngineInputV1, hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import { prepareSignalWorkspaceIncrementalInputFilesV1 as prepare, validateSignalWorkspaceIncrementalOutputFilesV1 as validate,
  type WorkspaceIncrementalNumericDescriptorV1 as Descriptor, type WorkspaceIncrementalFileRefV1 as Ref } from "./signal-workspace-engine-incremental-files";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const lines = async (path: string) => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(value => JSON.parse(value));
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value) + "\n");
const writeLines = (path: string, rows: unknown[]) => writeFile(path, rows.map(row => JSON.stringify(row) + "\n").join(""));
async function ref(directory: string, file: string): Promise<Ref> {
  return { file, sha256: await hashWorkspaceEngineFileV1(join(directory, file)), bytes: (await lstat(join(directory, file))).size };
}
async function* pages<T>(rows: T[], size = 128) { for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size); }
function rootMetadata(chunks: Chunk[], corrections = sha("")): Root {
  const first = chunks[0]!, h = createHash("sha256");
  for (const row of chunks) h.update(JSON.stringify([row.chunk_index, row.start, row.end, row.chunk_sha256]) + "\n");
  return { root_id: first.root_id, root_fingerprint: first.root_fingerprint, asset_sha256: first.asset_sha256,
    expected_chunks: chunks.length, chunk_coverage_digest: `sha256:${h.digest("hex")}`, correction_digest: corrections };
}
function chunks(root: number, count: number): Chunk[] {
  const texts = Array.from({ length: count }, (_, i) => `Local fixture ${root}/${i} 🌎`), full = texts.join(""); let start = 0;
  return texts.map((text, chunk_index) => { const row = { root_id: uuid(root), root_fingerprint: sha(`root:${root}`), asset_sha256: sha(full),
    expected_chunks: count, chunk_index, start, end: start + text.length, chunk_sha256: sha(text), text,
    vector: Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0) }; start = row.end; return row; });
}
const population = (rows: Chunk[]) => rows.map((row, ordinal) => ({ ordinal, root_id: row.root_id, root_fingerprint: row.root_fingerprint,
  asset_sha256: row.asset_sha256, expected_chunks: row.expected_chunks, chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 }));
function occurrence(row: ReturnType<typeof population>[number]) { return { ordinal: row.ordinal, root_id: row.root_id,
  chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 }; }
async function fixture() {
  const storage = await mkdtemp(join(tmpdir(), "noisia-incremental-files-")), parent = join(storage, "parent"), input1 = join(storage, "input1"), input2 = join(storage, "input2"), output = join(storage, "output");
  await mkdir(parent); await mkdir(output);
  const previousChunks = [...chunks(1, 133), ...chunks(2, 1)];
  const currentChunks = [...chunks(1, 133).map(row => ({ ...row, root_fingerprint: sha("changed-metadata") })), ...chunks(3, 2)];
  const snapshot = (rows: Chunk[]) => ({ workspace_id: uuid(99), input_revision: 1, preparation_run_id: uuid(100), embedding_run_id: uuid(101),
    embedding_config_digest: sha("embedding"), context_digest: sha("context"), catalog_digest: sha("catalog"),
    chunk_policy_version: "corpus-text-chunks-v1" as const, roots: new Set(rows.map(r => r.root_id)).size, chunks: rows.length, guides: 0, dimensions: 1024 as const, config: { ...config } });
  const before = await spoolSignalWorkspaceEngineInputV1({ storage_root: storage, directory: input1, snapshot: snapshot(previousChunks), chunks: pages(previousChunks), guides: pages([]) });
  await spoolSignalWorkspaceEngineInputV1({ storage_root: storage, directory: input2, snapshot: { ...snapshot(currentChunks), input_revision: 2 }, chunks: pages(currentChunks), guides: pages([]) });
  const records = population(previousChunks), current = population(currentChunks), unit = `open:${uuid(800)}`;
  const priorRoots = [rootMetadata(previousChunks.slice(0, 133)), rootMetadata(previousChunks.slice(133))];
  const currentRoots = [rootMetadata(currentChunks.slice(0, 133), sha("human-correction")), rootMetadata(currentChunks.slice(133))];
  await writeLines(join(parent, "population.jsonl"), records);
  await writeLines(join(parent, "roots.jsonl"), priorRoots.map(root => ({ root_id: root.root_id, root_fingerprint: root.root_fingerprint,
    chunk_count: root.expected_chunks, open: root.root_id === uuid(1) ? [uuid(800)] : [], guided: [] })));
  await writeLines(join(parent, "assignments.open.jsonl"), records.map(row => ({ ...occurrence(row), local_label: row.root_id === uuid(1) ? 0 : -1,
    stable_cluster_id: row.root_id === uuid(1) ? uuid(800) : null, strength: 0.75 })));
  await writeJson(join(parent, "clusters.open.json"), [{ local_label: 0, stable_cluster_id: uuid(800) }]);
  await writeFile(join(parent, "model.open.joblib"), "opaque local model bytes; never deserialize");
  for (const name of ["guides.jsonl", "guide-vectors.npy"]) await cp(join(input1, name), join(parent, name));
  const names = ["population.jsonl", "roots.jsonl", "assignments.open.jsonl", "clusters.open.json", "model.open.joblib", "guides.jsonl", "guide-vectors.npy"];
  const parentManifest = { contract_version: "workspace-topic-engine-output-v1", workspace_id: uuid(99), status: "completed", quality: "uncalibrated", approval_policy: "none",
    input_identity: { embedding_config_digest: before.embedding_config_digest, chunk_policy_version: before.chunk_policy_version,
      context_digest: before.context_digest, catalog_digest: before.catalog_digest }, config, versions: { runtime: "isolated-transport-fixture" },
    counts: { roots: 2, occurrences: records.length }, artifacts: await Promise.all(names.map(file => ref(parent, file))),
    lanes: [{ lane: "open", model_file: "model.open.joblib", assignments_file: "assignments.open.jsonl", clusters_file: "clusters.open.json" }] };
  await writeJson(join(parent, "manifest.json"), parentManifest);
  const descriptor: Descriptor = { contract_version: "workspace-incremental-numeric-descriptor-v1", policy_version: policy,
    parent: { execution_id: uuid(201), output_artifact_id: uuid(900), manifest_sha256: (await ref(parent, "manifest.json")).sha256, manifest_contract: "workspace-topic-engine-output-v1" },
    compatibility: { embedding_config_digest: before.embedding_config_digest, chunk_policy_version: before.chunk_policy_version, context_digest: before.context_digest,
      input_interest_catalog_digest: before.catalog_digest, guides_digest: digest({ rows: [], vectors: (await ref(parent, "guide-vectors.npy")).sha256 }),
      fit_config_digest: digest(config), runtime_digest: digest(parentManifest.versions) }, discovery: { close_requested: false } };
  const parentFiles = await Promise.all(["manifest.json", ...names].map(file => ref(parent, file)));
  const prepareArgs = () => ({ storage_root: storage, input_directory: input2, input_manifest_ref: undefined as unknown as Ref,
    execution_id: uuid(202), descriptor, roots: pages(currentRoots), parent: { directory: parent, files: pages(parentFiles) } });
  const firstArgs = prepareArgs(); firstArgs.input_manifest_ref = await ref(input2, "manifest.json");
  const prepared = await prepare(firstArgs);
  const model = parentFiles.find(r => r.file === "model.open.joblib")!, componentKey = digest([uuid(201), model.sha256, "open"]);
  const component = { component_key: componentKey, lane: "open" as const, model_origin: { execution_id: uuid(201), model_artifact_sha256: model.sha256 },
    model, center: null, units: [{ local_label: 0, unit_key: unit, birth_membership_digest: digest(records.slice(0, 133).map(occurrence)) }] };
  const originalMembers = records.slice(0, 133).map(row => ({ root_id: row.root_id, root_fingerprint: row.root_fingerprint, chunk_index: row.chunk_index,
    start: row.start, end: row.end, chunk_sha256: row.chunk_sha256, lane: "open", unit_key: unit, model_component_key: componentKey, strength: 0.75,
    model_origin: component.model_origin, evaluation_origin: { execution_id: uuid(201), input_population_digest: digest(records),
      evaluation_key: digest([uuid(201), componentKey, digest(records), "fitted_member"]), basis: "fitted_member" }, carried_from: null }));
  const members = originalMembers.map(row => ({ ...row, root_fingerprint: currentRoots[0]!.root_fingerprint,
    carried_from: { output_manifest_sha256: descriptor.parent.manifest_sha256, membership_digest: memberDigest(row) } }));
  await writeLines(join(output, "population.jsonl"), current);
  await writeLines(join(output, "roots.jsonl"), currentRoots.map(root => ({ ...root, unit_keys: root.root_id === uuid(1) ? [unit] : [],
    state: root.root_id === uuid(1) ? "computed" : "discovery_pending", discovery_pending: root.root_id !== uuid(1) })));
  await writeLines(join(output, "root-transitions.jsonl"), buildSignalWorkspaceIncrementalRootDeltaV1(priorRoots, currentRoots));
  await writeLines(join(output, "memberships.jsonl"), members);
  await writeLines(join(output, "pending-cohort.jsonl"), current.slice(133));
  await writeJson(join(output, "model-components.json"), [component]); await writeJson(join(output, "candidate-groups.json"), []); await writeJson(join(output, "relations.json"), []);
  for (const name of ["model.open.joblib", "guides.jsonl", "guide-vectors.npy"]) await cp(join(parent, name), join(output, name));
  const outputNames = ["population.jsonl", "roots.jsonl", "root-transitions.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json", "candidate-groups.json", "relations.json", "model.open.joblib", "guides.jsonl", "guide-vectors.npy"];
  const manifest = { contract_version: "workspace-topic-incremental-output-v1", workspace_id: uuid(99), execution_id: uuid(202),
    request_digest: prepared.request_digest, previous_manifest_sha256: descriptor.parent.manifest_sha256, compatibility: descriptor.compatibility,
    policy_version: policy, status: "completed", quality: "uncalibrated", approval_policy: "none", discovery_status: "pending_insufficient_population", relations_status: "none",
    population_digest: digest(current), counts: { ...prepared.counts, pending_occurrences: 2, memberships: 133, components: 1, new_components: 0, model_bank_bytes: model.bytes },
    components: [component], coverage: [{ component_key: componentKey, population_digest: digest(current), expected_occurrences: 135,
      copied_occurrences: 133, transformed_occurrences: 2, fitted_occurrences: 0 }], operations: { fit: [], transform: [{ component_key: componentKey, occurrences: 2, pages: 1, maximum_page_rows: 2 }] },
    artifacts: await Promise.all(outputNames.map(file => ref(output, file))), metrics: { resident_bytes: 0, elapsed_seconds: 0 }, limitations: ["Local structural fixture, no model execution."] };
  await writeJson(join(output, "manifest.json"), manifest);
  const args = () => ({ storage_root: storage, input_directory: input2, output_directory: output, input_ref: prepared.input_ref,
    descriptor, parent: { directory: parent, files: pages(parentFiles) } });
  const reseal = async (file: string) => { const manifest = await read(join(output, "manifest.json"));
    manifest.artifacts = await Promise.all((manifest.artifacts as Ref[]).map(r => r.file === file ? ref(output, file) : r)); await writeJson(join(output, "manifest.json"), manifest); };
  return { storage, parent, input2, output, descriptor, prepared, parentFiles, currentRoots, currentChunks, args, reseal,
    async prepareAgain() { const args = prepareArgs(); args.input_manifest_ref = await ref(input2, "manifest.json"); return prepare(args); },
    cleanup: () => rm(storage, { recursive: true, force: true }) };
}

test("incremental files reconcile all 133 fragments, metadata-only carry, removed roots and a pending cohort", async () => {
  const f = await fixture(); try {
    const result = await validate(f.args()); assert.equal(result.validation.occurrences, 135); assert.equal(result.validation.memberships, 133);
    assert.equal(result.validation.pending_occurrences, 2); assert.equal(result.manifest.counts.metadata_changed_roots, 1);
    assert.equal(result.manifest.counts.removed_roots, 1); assert.equal(result.validation.relations_scope, "new_candidates_in_this_execution");
    assert.deepEqual(await f.prepareAgain(), f.prepared);
    assert.deepEqual(await validate(f.args()), result);
  } finally { await f.cleanup(); }
});

test("incremental preparation rejects incomplete, reordered or oversized server root pages before publication", async () => {
  const f = await fixture(); try {
    for (const roots of [pages(f.currentRoots.slice(1)), pages([...f.currentRoots].reverse()), pages(Array.from({ length: 129 }, () => f.currentRoots[0]!), 129)]) {
      await assert.rejects(prepare({ storage_root: f.storage, input_directory: f.input2, input_manifest_ref: await ref(f.input2, "manifest.json"),
        execution_id: uuid(202), descriptor: f.descriptor, roots, parent: { directory: f.parent, files: pages(f.parentFiles) } }), /root_(coverage|order|page)_invalid/u);
    }
    assert.deepEqual(await f.prepareAgain(), f.prepared);
  } finally { await f.cleanup(); }
});

test("resealed numerical output cannot replace population, coverage, origins, corrections or inherited memberships", async () => {
  const mutations: Array<[string, (rows: Record<string, unknown>[]) => void]> = [
    ["population.jsonl", rows => { rows[0]!.root_fingerprint = sha("other"); }],
    ["population.jsonl", rows => { rows.splice(132, 1); }],
    ["roots.jsonl", rows => { rows[0]!.correction_digest = sha("other-correction"); }],
    ["root-transitions.jsonl", rows => { rows[0]!.transition = "content_changed"; }],
    ["memberships.jsonl", rows => { (rows[0]!.carried_from as Record<string, unknown>).membership_digest = sha("false-receipt"); }],
    ["memberships.jsonl", rows => { rows[0]!.strength = 0.8; }],
    ["memberships.jsonl", rows => { rows.splice(132, 1); }],
    ["memberships.jsonl", rows => { (rows[0]!.evaluation_origin as Record<string, unknown>).execution_id = uuid(555); }],
    ["memberships.jsonl", rows => { rows[0]!.root_id = uuid(55); }],
    ["pending-cohort.jsonl", rows => { rows.pop(); }],
  ];
  const f = await fixture(); try {
    for (const [file, mutate] of mutations) {
      const original = await readFile(join(f.output, file)); const rows = await lines(join(f.output, file)); mutate(rows);
      await writeLines(join(f.output, file), rows); await f.reseal(file);
      await assert.rejects(validate(f.args()), file);
      await writeFile(join(f.output, file), original); await f.reseal(file);
    }
    await validate(f.args());
  } finally { await f.cleanup(); }
});

test("parent references, runtime and file boundaries are checked independently of output hashes", async () => {
  const f = await fixture(); try {
    await assert.rejects(validate({ ...f.args(), descriptor: { ...f.descriptor, compatibility: { ...f.descriptor.compatibility, runtime_digest: sha("other-runtime") } } }), /input_identity_invalid|rebuild_required/u);
    await assert.rejects(validate({ ...f.args(), parent: { directory: f.parent, files: pages(f.parentFiles.slice(1)) } }), /previous_manifest_hash_mismatch/u);
    await assert.rejects(validate({ ...f.args(), parent: { directory: f.parent, files: pages([...f.parentFiles, f.parentFiles[0]!]) } }), /artifact_invalid/u);
    await assert.rejects(validate({ ...f.args(), parent: { directory: f.parent, files: pages([{ file: "../manifest.json", bytes: 0, sha256: sha("") }]) } }));
    const memberPath = join(f.output, "memberships.jsonl"), original = await readFile(memberPath);
    await writeFile(memberPath, original.subarray(0, original.length - 1)); await f.reseal("memberships.jsonl");
    await assert.rejects(validate(f.args()), /jsonl_incomplete/u);
    await writeFile(memberPath, original); await f.reseal("memberships.jsonl");
    await rm(memberPath); await symlink(join(f.parent, "population.jsonl"), memberPath);
    await assert.rejects(validate(f.args()), /artifact_invalid/u);
  } finally { await f.cleanup(); }
});

test("a resealed current root file cannot detach the input census or correction identity from the sealed request", async () => {
  const f = await fixture(); try {
    const raw = await read(join(f.input2, "incremental.json")), roots = await lines(join(f.input2, "current-roots.jsonl")); roots[0].asset_sha256 = sha("other");
    await writeLines(join(f.input2, "current-roots.jsonl"), roots);
    raw.current_roots = { ...await ref(f.input2, "current-roots.jsonl"), rows: roots.length }; await writeJson(join(f.input2, "incremental.json"), raw);
    await assert.rejects(validate({ ...f.args(), input_ref: await ref(f.input2, "incremental.json") }), /root_coverage_invalid/u);
  } finally { await f.cleanup(); }
});

test("resealed invalid vectors and over-capacity JSONL fail explicitly before a receipt is accepted", async () => {
  const f = await fixture(); try {
    const vectorPath = join(f.input2, "vectors.npy"), bytes = await readFile(vectorPath);
    bytes.writeFloatLE(Number.NaN, 10 + bytes.readUInt16LE(8)); await writeFile(vectorPath, bytes);
    const manifest = await read(join(f.input2, "manifest.json")); manifest.vectors.sha256 = (await ref(f.input2, "vectors.npy")).sha256;
    await writeJson(join(f.input2, "manifest.json"), manifest);
    const input = await read(join(f.input2, "incremental.json")); input.current_input_manifest = await ref(f.input2, "manifest.json");
    await writeJson(join(f.input2, "incremental.json"), input);
    await assert.rejects(validate({ ...f.args(), input_ref: await ref(f.input2, "incremental.json") }), /vector_value_invalid/u);
  } finally { await f.cleanup(); }
  const g = await fixture(); try {
    await writeFile(join(g.output, "memberships.jsonl"), " ".repeat(8 * 1024 * 1024 + 1)); await g.reseal("memberships.jsonl");
    await assert.rejects(validate(g.args()), /json_capacity_exceeded/u);
  } finally { await g.cleanup(); }
});

const realFixture = resolve(import.meta.dirname, "../../../../.data/workspace-incremental-2026-09-09/pytest-final/incremental-real0");
test("already-computed real Python waves validate bootstrap-to-delta, further delta and final references without any fit", { skip: !existsSync(realFixture) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "noisia-incremental-real-files-"));
  try {
    await cp(realFixture, join(root, "waves"), { recursive: true }); const base = join(root, "waves");
    for (const wave of [2, 3, 4]) {
      const inputDirectory = join(base, wave === 4 ? "empty-input" : `input${wave}`), outputDirectory = join(base, wave === 4 ? "empty-output" : `output${wave}`), parentDirectory = join(base, `output${wave - 1}`);
      const input = await read(join(inputDirectory, "incremental.json")), parentManifest = await read(join(parentDirectory, "manifest.json"));
      const descriptor: Descriptor = { contract_version: "workspace-incremental-numeric-descriptor-v1", policy_version: policy,
        parent: { ...input.parent, output_artifact_id: uuid(950 + wave), manifest_contract: parentManifest.contract_version },
        compatibility: input.compatibility, discovery: { close_requested: input.discovery.close_requested } };
      const parentRefs = [await ref(parentDirectory, "manifest.json"), ...parentManifest.artifacts];
      const prepared = await prepare({ storage_root: root, input_directory: inputDirectory, input_manifest_ref: input.current_input_manifest,
        execution_id: input.execution_id, descriptor, roots: pages(await lines(join(inputDirectory, "current-roots.jsonl"))),
        parent: { directory: parentDirectory, files: pages(parentRefs) } });
      assert.deepEqual(prepared.input, input, "canonical input is byte-replay compatible with the Python fixture");
      const args = { storage_root: root, input_directory: inputDirectory, output_directory: outputDirectory, input_ref: prepared.input_ref,
        descriptor, parent: { directory: parentDirectory, files: pages(parentRefs) } };
      const result = await validate(args);
      assert.equal(result.validation.roots, wave === 2 ? 390 : wave === 3 ? 401 : 0); assert.equal(result.validation.occurrences, wave === 2 ? 523 : wave === 3 ? 534 : 0);
      assert.equal(result.validation.memberships, wave === 2 ? 1919 : wave === 3 ? 1955 : 0); assert.equal(result.manifest.counts.components, 4);
      if (wave === 4) { assert.equal(result.manifest.counts.removed_roots, 401); assert.deepEqual(result.manifest.operations, { fit: [], transform: [] }); }
      if (wave === 2) {
        const groups = await read(join(outputDirectory, "candidate-groups.json")); groups[0].representatives[0].chunk_sha256 = sha("wrong-reference");
        await writeJson(join(outputDirectory, "candidate-groups.json"), groups);
        const raw = await read(join(outputDirectory, "manifest.json")); raw.artifacts = await Promise.all(raw.artifacts.map((r: Ref) => r.file === "candidate-groups.json" ? ref(outputDirectory, r.file) : r));
        await writeJson(join(outputDirectory, "manifest.json"), raw);
        await assert.rejects(validate({ ...args, parent: { directory: parentDirectory, files: pages(parentRefs) } }), /candidate_reference_invalid/u);
        // Restore exactly before using this output as the next authorized parent.
        await cp(join(realFixture, "output2"), outputDirectory, { recursive: true, force: true });
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
