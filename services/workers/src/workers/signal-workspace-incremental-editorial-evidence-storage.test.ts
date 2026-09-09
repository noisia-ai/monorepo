import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { signalWorkspaceIncrementalDigestV1 as digest, signalWorkspaceInterpretationUniverseDigestV1 as universe,
  signalWorkspaceInterpretationReferenceIdV1, parseSignalWorkspaceInterpretationClusterV1,
  parseSignalWorkspaceIncrementalOutputV1 } from "@noisia/query-engine";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { storeWorkspaceIncrementalEditorialEvidenceV1 as store, type WorkspaceIncrementalEditorialEvidenceStorageArgsV1 as Args } from "./signal-workspace-incremental-editorial-evidence-storage";
import type { WorkspaceIncrementalEditorialEvidenceDescriptorV1 as Descriptor, WorkspaceIncrementalEditorialEvidenceArgsV1 as Evidence } from "./signal-workspace-incremental-editorial-evidence";

type Producer = NonNullable<NonNullable<Parameters<typeof store>[1]>["stream"]>;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const scope = { workspace_id: id(1), numeric_execution_id: id(2) };
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
function server(events: string[]) {
  const objects = new Map<string, Uint8Array>(); let corrupt = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(init?.redirect, "error"); const url = String(input);
    if (url.includes("/bucket/")) return Response.json({ id: "corpus-files", public: false });
    const key = url.split("/corpus-files/")[1]!;
    if (init?.method === "POST") {
      assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/octet-stream");
      if (objects.has(key)) return Response.json({ error: "Duplicate" }, { status: 409 });
      objects.set(key, Uint8Array.from(init.body as Uint8Array)); return new Response("", { status: 200 });
    }
    const value = objects.get(key); if (!value) return new Response("", { status: 404 });
    return new Response(corrupt && key.includes(".part-") ? new Uint8Array(value.length).fill(0) : Uint8Array.from(value));
  };
  const actual = createWorkspaceEngineStorageV1({ url: "https://local-test.invalid", service_role_key: "local-fake-key", fetch });
  const storage: WorkspaceEngineStorageV1 = { get: actual.get, put: async args => {
    events.push(`put:${basename(args.file)}`); assert.equal((await lstat(args.file)).mode & 0o777, 0o600);
    return actual.put(args);
  } };
  return { storage, objects, corrupt: () => { corrupt = true; } };
}
function fakeEvidence(): Evidence {
  return { current: { storage_root: "/fixture", directory: "/fixture/current", manifest_ref: { file: "manifest.json", sha256: sha("manifest"), bytes: 1 },
    checkpoint: { contract_version: "workspace-incremental-numeric-checkpoint-v1", checkpoint_digest: sha("checkpoint"),
      workspace_id: scope.workspace_id, execution_id: scope.numeric_execution_id, population_digest: sha("population"), roots: 10,
      occurrences: 10, components: 1, component_digest: sha("components"), model_bank_bytes: 0,
      discovery_status: "complete", relations_status: "pending", numeric_complete: true, analysis_complete: false } },
    origins: [], exclusions: [], read_fragments: async () => { throw new Error("composition producer owns the fixture"); } };
}
// A test-only verified-adapter stand-in exercises file/storage composition, not
// numerical lineage. Every cluster still passes the existing strict text schema.
function producer(events: string[], count = 1, mode = "ok"): Producer {
  return async args => {
    const units: Descriptor["units"] = [], streamHash = createHash("sha256"); let bytes = 0;
    const component_key = sha("component"), model_origin = { execution_id: id(3), model_artifact_sha256: sha("no model IO") };
    for (let i = 0; i < count; i++) {
      const unit_key = `open:${id(1000 + i)}`, text = "🙂" + "a".repeat(1398);
      const unit = { unit_key, local_label: i, component_key, model_origin, birth_membership_digest: sha(`birth${i}`),
        lane: "open" as const, status: "evidence_ready" as const, root_count: 10, chunk_count: 10, cluster_digest: sha(`current${i}`) };
      const cluster = parseSignalWorkspaceInterpretationClusterV1({ cluster_id: unit_key, lane: unit.lane, cluster_digest: unit.cluster_digest,
        root_count: unit.root_count, chunk_count: unit.chunk_count, terms: ["local storage fixture"],
        representatives: Array.from({ length: 10 }, (_, r) => {
          const ref = { root_id: id(10 + r), chunk_index: i, start: i * 1400, end: (i + 1) * 1400, chunk_sha256: sha(text) };
          return { ...ref, text, strength: r === 9 ? 0.1 : 0.9, selection_reason: r === 9 ? "low_affiliation_boundary" : "high_affiliation",
            ref_id: signalWorkspaceInterpretationReferenceIdV1(ref) };
        }) });
      // The strict cluster parser does not accept arbitrary unit metadata.
      const line = JSON.stringify({ contract_version: "workspace-incremental-editorial-evidence-unit-v1", unit, cluster }) + "\n";
      await args.write_cluster({ index: mode === "cursor" ? 2 : i, unit_key, jsonl: line });
      units.push(unit); bytes += Buffer.byteLength(line); streamHash.update(line);
    }
    if (mode === "late_failure") throw new Error("workspace_incremental_editorial_evidence_source_changed");
    const base = { contract_version: "workspace-incremental-editorial-evidence-stream-v1" as const,
      numeric_execution_id: scope.numeric_execution_id, numeric_checkpoint_digest: args.current.checkpoint.checkpoint_digest,
      numeric_manifest_sha256: args.current.manifest_ref.sha256, population_digest: args.current.checkpoint.population_digest,
      numeric_component_order: [component_key],
      representative_selection_policy: "distinct-roots-affiliation-boundary-v1" as const,
      census: { expected_unit_count: count, expected_unit_digest: universe(units.map(u => u.unit_key)), population_digest: args.current.checkpoint.population_digest,
        roots: 10, chunks: count * 10, memberships: count * 10, pending_roots: 0, pending_occurrences: 0 }, origins: [], units,
      target_unit_digest: universe(units.map(u => u.unit_key)), target_binding_digest: digest(units.map(({ component_key, local_label, unit_key, birth_membership_digest, model_origin }) =>
        ({ component_key, unit: { local_label, unit_key, birth_membership_digest }, model_origin }))),
      stream: { contract_version: "workspace-incremental-editorial-evidence-jsonl-v1" as const, rows: count, bytes,
        sha256: mode === "hash" ? sha("wrong") : `sha256:${streamHash.digest("hex")}` } };
    if (mode === "bytes") base.stream.bytes++;
    if (mode === "scope") base.numeric_execution_id = id(99);
    events.push("adapter-complete"); const evidence_digest = digest(base);
    if (mode === "component_order") base.numeric_component_order = [sha("foreign component")];
    return { ...base, evidence_digest };
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "noisia-editorial-storage-")), scratch = join(root, "scratch"), events: string[] = [];
  const local = server(events); const args: Args = { ...scope, evidence: fakeEvidence(), scratch_root: scratch, storage: local.storage };
  return { root, scratch, events, args, local, cleanup: () => rm(root, { recursive: true, force: true }) };
}
test("foreign workspace is rejected before the adapter, scratch or storage is touched", async () => {
  const f = await fixture(); let invoked = false;
  try { await assert.rejects(store({ ...f.args, workspace_id: id(99) }, { stream: async args => {
      invoked = true; return producer(f.events)(args);
    } }), /scope_invalid/u);
    assert.equal(invoked, false); assert.equal(existsSync(f.scratch), false); assert.equal(f.local.objects.size, 0);
  } finally { await f.cleanup(); }
});
test("complete evidence larger than 8 MiB uploads stream before descriptor; restore and replay preserve exact bytes", async t => {
  const f = await fixture(); try {
    const result = await store(f.args, { stream: producer(f.events, 1000) });
    assert.ok(result.stream.size_bytes > 8 * 1024 * 1024); assert.equal(result.evidence.stream.rows, 1000);
    assert.deepEqual(f.events, ["adapter-complete", "put:incremental-editorial-evidence.jsonl", "put:incremental-editorial-evidence.json"]);
    assert.deepEqual(await readdir(f.scratch), []);
    const restored = join(f.root, "descriptor.json"); await f.local.storage.get({ workspace_id: scope.workspace_id,
      execution_id: scope.numeric_execution_id, stored: result.descriptor, destination: restored });
    const { descriptor: _ref, ...packet } = result; assert.deepEqual(await json(restored), packet);
    const evidenceFile = join(f.root, "evidence.jsonl"); await f.local.storage.get({ workspace_id: scope.workspace_id,
      execution_id: scope.numeric_execution_id, stored: result.stream, destination: evidenceFile });
    const bytes = await readFile(evidenceFile); assert.equal(bytes.length, result.evidence.stream.bytes);
    assert.equal(sha(bytes), result.evidence.stream.sha256); assert.equal(bytes.toString("utf8").split("\n").length - 1, 1000);
    const keys = [...f.local.objects.keys()]; assert.deepEqual(await store(f.args, { stream: producer(f.events, 1000) }), result);
    assert.deepEqual([...f.local.objects.keys()], keys, "same storage keys and descriptor; no new immutable objects");
    t.diagnostic(JSON.stringify({ rows: 1000, bytes: bytes.length, actual_storage_roundtrip: true, providers: 0 }));
  } finally { await f.cleanup(); }
});
test("scope, cursor, late adapter error, reported bytes and final hash all reject before uploading", async t => {
  for (const mode of ["scope", "cursor", "late_failure", "bytes", "hash", "component_order"]) await t.test(mode, async () => {
    const f = await fixture(); let result: unknown;
    try { await assert.rejects(async () => { result = await store(f.args, { stream: producer(f.events, 1, mode) }); });
      assert.equal(result, undefined); assert.equal(f.local.objects.size, 0); assert.deepEqual(await readdir(f.scratch), []);
    } finally { await f.cleanup(); }
  });
});
test("upload ACK loss never returns a plan; replay verifies existing stream/descriptor objects", async t => {
  for (const loseAt of [1, 2]) await t.test(`upload ${loseAt}`, async () => {
    const f = await fixture(); let result: unknown, calls = 0;
    const storage: WorkspaceEngineStorageV1 = { ...f.local.storage, put: async args => {
      const saved = await f.local.storage.put(args); if (++calls === loseAt) throw new Error("workspace_engine_storage_transport_failed"); return saved;
    } };
    try { await assert.rejects(async () => { result = await store({ ...f.args, storage }, { stream: producer(f.events) }); }, /transport_failed/u);
      assert.equal(result, undefined); assert.deepEqual(await readdir(f.scratch), []); assert.equal(f.local.objects.size, loseAt * 2);
      const before = [...f.local.objects.keys()]; const recovered = await store(f.args, { stream: producer(f.events) });
      assert.ok(before.every(key => f.local.objects.has(key))); assert.equal(f.local.objects.size, 4);
      assert.equal(recovered.stream.sha256, recovered.evidence.stream.sha256);
    } finally { await f.cleanup(); }
  });
});
test("corrupt storage verification or foreign returned reference cannot publish a descriptor", async t => {
  for (const corrupt of [true, false]) await t.test(String(corrupt), async () => {
    const f = await fixture(); let puts = 0, result: unknown;
    if (corrupt) f.local.corrupt();
    const storage: WorkspaceEngineStorageV1 = { ...f.local.storage, put: async args => {
      puts++; const saved = await f.local.storage.put(args);
      return corrupt ? saved : { ...saved, storage_key: saved.storage_key.replace(scope.numeric_execution_id, id(99)) };
    } };
    try { await assert.rejects(async () => { result = await store({ ...f.args, storage }, { stream: producer(f.events) }); }, /verification_failed|reference_invalid/u);
      assert.equal(result, undefined); assert.equal(puts, 1); assert.deepEqual(await readdir(f.scratch), []);
    } finally { await f.cleanup(); }
  });
});

// Existing calculated synthetic algorithms only; this test does not run Python.
const real = process.env.NOISIA_INCREMENTAL_EDITORIAL_FIXTURE_DIR ?? resolve(import.meta.dirname, "../../../../.data/workspace-incremental-2026-09-09/pytest-final/incremental-real0");
test("default verified adapter persists the complete third-wave evidence from saved numerical artifacts", { skip: !existsSync(join(real, "output3", "manifest.json")) }, async () => {
  const f = await fixture();
  try {
    async function source(name: string): Promise<Evidence["current"]> {
      const directory = join(f.root, name); await mkdir(directory);
      for (const file of ["manifest.json", "roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json", "candidate-groups.json"])
        await cp(join(real, name, file), join(directory, file));
      const bytes = await readFile(join(directory, "manifest.json")), m = parseSignalWorkspaceIncrementalOutputV1(JSON.parse(bytes.toString("utf8")));
      return { directory, storage_root: f.root, manifest_ref: { file: "manifest.json", sha256: sha(bytes), bytes: bytes.length }, checkpoint: {
        contract_version: "workspace-incremental-numeric-checkpoint-v1", checkpoint_digest: sha("local numeric checkpoint"), workspace_id: m.workspace_id, execution_id: m.execution_id,
        population_digest: m.population_digest, roots: m.counts.roots, occurrences: m.counts.occurrences, components: m.counts.components,
        component_digest: digest([...m.components].sort((a, b) => a.component_key < b.component_key ? -1 : 1)
          .map(c => [c.component_key, c.lane, c.model_origin, c.units.length, digest(c.units)])), model_bank_bytes: m.counts.model_bank_bytes,
        discovery_status: m.discovery_status, relations_status: m.relations_status, numeric_complete: true, analysis_complete: false } };
    }
    const current = await source("output3"), birth = await source("output2"), m = parseSignalWorkspaceIncrementalOutputV1(await json(join(birth.directory, "manifest.json")));
    const chunks = (await readFile(join(real, "input3", "chunks.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
    const evidence: Evidence = { current, origins: [...m.components.filter(c => c.model_origin.execution_id !== m.execution_id)
      .map(c => ({ kind: "full_fit" as const, model_origin: c.model_origin })), { kind: "incremental", files: birth }], exclusions: [],
      read_fragments: async refs => refs.map(ref => { const row = chunks.find(c => c.root_id === ref.root_id && c.chunk_index === ref.chunk_index); assert.ok(row);
        return { ...ref, text: row.text }; }) };
    const result = await store({ ...f.args, workspace_id: current.checkpoint.workspace_id, numeric_execution_id: current.checkpoint.execution_id, evidence });
    assert.equal(result.evidence.census.roots, 401); assert.equal(result.evidence.census.chunks, 534);
    assert.equal(result.evidence.census.pending_roots, 13); assert.equal(result.evidence.units.length, 11); assert.equal(result.evidence.stream.rows, 6);
    assert.equal(result.evidence.units.filter(u => u.status === "legacy_full_fit").length, 5);
    assert.equal(f.local.objects.size, 4); assert.deepEqual(await readdir(f.scratch), []);
  } finally { await f.cleanup(); }
});
