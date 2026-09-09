import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseSignalWorkspaceIncrementalOutputV1, signalWorkspaceIncrementalDigestV1 as digest,
  signalWorkspaceInterpretationUniverseDigestV1, signalWorkspaceIncrementalMembershipDigestV1,
  type SignalWorkspaceIncrementalProjectionRootV1 as Root } from "@noisia/query-engine";
import { prepareWorkspaceIncrementalProjectionFilesV1 as prepare,
  type WorkspaceIncrementalProjectionFileCheckpointV1 as Checkpoint } from "./signal-workspace-incremental-projection-files";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (v: string | Buffer) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
const jsonl = (values: unknown[]) => values.map(value => JSON.stringify(value) + "\n").join("");
const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const readRows = async (file: string) => (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
type Output = ReturnType<typeof parseSignalWorkspaceIncrementalOutputV1>;
function checkpoint(manifest: Output): Checkpoint {
  return { contract_version: "workspace-incremental-numeric-checkpoint-v1", checkpoint_digest: sha("server checkpoint"),
    workspace_id: manifest.workspace_id, execution_id: manifest.execution_id, population_digest: manifest.population_digest,
    roots: manifest.counts.roots, occurrences: manifest.counts.occurrences, components: manifest.components.length,
    component_digest: digest([...manifest.components].sort((a, b) => a.component_key < b.component_key ? -1 : 1)
      .map(component => [component.component_key, component.lane, component.model_origin, component.units.length, digest(component.units)])),
    model_bank_bytes: manifest.counts.model_bank_bytes, discovery_status: manifest.discovery_status,
    relations_status: manifest.relations_status, numeric_complete: true, analysis_complete: false };
}
async function ref(directory: string, file: string) {
  const bytes = await readFile(join(directory, file)); return { file, sha256: sha(bytes), bytes: bytes.length };
}
async function fixture(pending = false) {
  const storageRoot = await mkdtemp(join(tmpdir(), "noisia-projection-files-")), directory = join(storageRoot, "output");
  await mkdir(directory);
  const modelOrigin = { execution_id: id(90), model_artifact_sha256: sha("opaque model") };
  const componentKey = digest([modelOrigin.execution_id, modelOrigin.model_artifact_sha256, "open"]), unitKey = `open:${id(50)}`;
  const previousManifest = sha("parent manifest"), originalPopulation = sha("original population");
  const pops = [], members = [], roots: Root[] = [];
  for (const [rootIndex, count] of [133, 1].entries()) {
    const rootId = id(rootIndex + 1), fingerprint = sha(`root:${rootIndex}`), asset = sha("a".repeat(count));
    const chunks = Array.from({ length: count }, (_, index) => ({ ordinal: pops.length + index, root_id: rootId,
      root_fingerprint: fingerprint, asset_sha256: asset, expected_chunks: count,
      chunk_index: index, start: index, end: index + 1, chunk_sha256: sha("a") }));
    pops.push(...chunks);
    for (const chunk of rootIndex === 0 ? chunks : []) {
      const member = { root_id: rootId, root_fingerprint: fingerprint, chunk_index: chunk.chunk_index, start: chunk.start,
        end: chunk.end, chunk_sha256: chunk.chunk_sha256, lane: "open" as const, unit_key: unitKey,
        model_component_key: componentKey, strength: 0.625, model_origin: modelOrigin,
        evaluation_origin: { execution_id: modelOrigin.execution_id, input_population_digest: originalPopulation,
          evaluation_key: digest([modelOrigin.execution_id, componentKey, originalPopulation, "fitted_member"]), basis: "fitted_member" as const },
        carried_from: { output_manifest_sha256: previousManifest, membership_digest: sha(`validated parent member:${chunk.chunk_index}`) } };
      members.push(member);
    }
    roots.push({ root_id: rootId, root_fingerprint: fingerprint, asset_sha256: asset, expected_chunks: count,
      chunk_coverage_digest: sha(chunks.map(c => JSON.stringify([c.chunk_index, c.start, c.end, c.chunk_sha256]) + "\n").join("")),
      correction_digest: sha(""), unit_keys: rootIndex === 0 ? [unitKey] : [],
      state: rootIndex === 0 ? "computed" : "outlier", discovery_pending: pending && rootIndex === 0 });
  }
  const component = { component_key: componentKey, lane: "open" as const, model_origin: modelOrigin,
    model: { file: "model.open.joblib", sha256: modelOrigin.model_artifact_sha256, bytes: 12 }, center: null,
    units: [{ local_label: 0, unit_key: unitKey, birth_membership_digest: sha("birth") }] };
  const bodies = new Map<string, string>([["roots.jsonl", jsonl(roots)], ["population.jsonl", jsonl(pops)],
    ["memberships.jsonl", jsonl(members)], ["pending-cohort.jsonl", jsonl(pending ? pops.slice(0, 133) : [])],
    ["model-components.json", JSON.stringify([component])]]);
  for (const [name, body] of bodies) await writeFile(join(directory, name), body);
  const artifacts = [...bodies].map(([file, body]) => ({ file, bytes: Buffer.byteLength(body), sha256: sha(body) }));
  for (const file of ["root-transitions.jsonl", "candidate-groups.json", "relations.json", "guides.jsonl", "guide-vectors.npy"])
    artifacts.push({ file, bytes: 0, sha256: sha("") });
  artifacts.push(component.model);
  const populationDigest = digest(pops);
  const manifest = parseSignalWorkspaceIncrementalOutputV1({ contract_version: "workspace-topic-incremental-output-v1",
    workspace_id: id(100), execution_id: id(101), request_digest: sha("request"), previous_manifest_sha256: previousManifest,
    compatibility: { embedding_config_digest: sha("embedding"), chunk_policy_version: "corpus-text-chunks-v1",
      context_digest: sha("context"), input_interest_catalog_digest: sha("interests"), guides_digest: sha("guides"),
      fit_config_digest: sha("fit"), runtime_digest: sha("runtime") }, policy_version: "workspace-frozen-model-cohort-v1",
    status: "completed", quality: "uncalibrated", approval_policy: "none", discovery_status: pending ? "pending_cohort_close" : "complete",
    relations_status: "none", population_digest: populationDigest,
    counts: { roots: 2, occurrences: 134, added_roots: 0, content_changed_roots: 0, metadata_changed_roots: 0, unchanged_roots: 2,
      removed_roots: 0, delta_occurrences: 0, cohort_occurrences: pending ? 133 : 0, pending_occurrences: pending ? 133 : 0,
      memberships: members.length, components: 1, new_components: 0, model_bank_bytes: 12 }, components: [component], artifacts,
    coverage: [{ component_key: componentKey, population_digest: populationDigest, expected_occurrences: 134,
      copied_occurrences: 134, transformed_occurrences: 0, fitted_occurrences: 0 }], operations: { fit: [], transform: [] },
    metrics: { resident_bytes: 0, elapsed_seconds: 0 }, limitations: ["Synthetic file reader fixture; no numerical algorithm executes."] });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  const args = async () => ({ storage_root: storageRoot, directory, manifest_ref: await ref(directory, "manifest.json"), checkpoint: checkpoint(manifest) });
  const reseal = async (name: string, body: string) => { await writeFile(join(directory, name), body);
    const stored = manifest.artifacts.find(row => row.file === name)!; Object.assign(stored, await ref(directory, name));
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest)); };
  return { directory, manifest, roots, pops, members, args, reseal, cleanup: () => rm(storageRoot, { recursive: true, force: true }) };
}
async function packets(result: Awaited<ReturnType<typeof prepare>>) {
  const items = []; for await (const item of result.roots()) items.push(item); return items;
}

test("file preflight preserves all 133 chunks, carry identities and known membership while discovery stays pending", async t => {
  let network = 0; t.mock.method(globalThis, "fetch", async () => { network++; throw new Error("network prohibited"); });
  const f = await fixture(true); try {
    const result = await prepare(await f.args());
    assert.deepEqual(result.census, { roots: 2, chunks: 134, memberships: 133, pending_roots: 1, pending_occurrences: 133,
      expected_unit_count: 1, expected_unit_digest: signalWorkspaceInterpretationUniverseDigestV1([f.members[0]!.unit_key]),
      population_digest: f.manifest.population_digest });
    const all = await packets(result); assert.equal(all.length, 2); assert.equal(all[0]!.chunks.length, 133);
    assert.deepEqual(all[0]!.chunks.at(-1), { chunk_index: 132, start: 132, end: 133, chunk_sha256: sha("a") });
    assert.deepEqual(all[0]!.memberships, f.members); assert.equal(all[0]!.root.state, "computed"); assert.equal(all[0]!.root.discovery_pending, true);
    assert.deepEqual(all[1]!.memberships, []); assert.equal(all[1]!.root.state, "outlier"); assert.equal(network, 0);
    assert.equal(existsSync(join(f.directory, "model.open.joblib")), false, "projection needs no opaque model bytes");
    assert.deepEqual(await packets(result), all, "repeatable passes preserve exact lineage and coverage");
  } finally { await f.cleanup(); }
});

const corruptions: Array<[string, (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>]> = [
  ["last root truncated", async f => f.reseal("roots.jsonl", jsonl(f.roots.slice(0, 1)))],
  ["population order changed", async f => f.reseal("population.jsonl", jsonl([f.pops[1], f.pops[0], ...f.pops.slice(2)]))],
  ["last chunk identity changed", async f => f.reseal("population.jsonl", jsonl(f.pops.map((row, i) => i === 133 ? { ...row, root_fingerprint: sha("other") } : row)))],
  ["missing sparse membership", async f => f.reseal("memberships.jsonl", jsonl(f.members.slice(1)))],
  ["duplicate membership", async f => f.reseal("memberships.jsonl", jsonl([f.members[0], ...f.members]))],
  ["root units differ from complete membership union", async f => f.reseal("roots.jsonl", jsonl([{ ...f.roots[0], unit_keys: [], state: "discovery_pending" }, f.roots[1]]))],
  ["pending cohort excludes a fragment", async f => f.reseal("pending-cohort.jsonl", jsonl(f.pops.slice(0, 132)))],
  ["cross-root pending row", async f => f.reseal("pending-cohort.jsonl", jsonl(f.pops.slice(1)))],
  ["cross-unit membership", async f => f.reseal("memberships.jsonl", jsonl(f.members.map((row, i) => i === 0 ? { ...row, unit_key: `open:${id(51)}` } : row)))],
  ["wrong carry manifest", async f => f.reseal("memberships.jsonl", jsonl(f.members.map((row, i) => i === 0 ? { ...row,
    carried_from: { ...row.carried_from, output_manifest_sha256: sha("unrelated") } } : row)))],
  ["unknown evaluation execution without carry", async f => f.reseal("memberships.jsonl", jsonl(f.members.map((row, i) => i === 0 ? { ...row, carried_from: null } : row)))],
  ["coverage partition changed", async f => f.reseal("roots.jsonl", jsonl([{ ...f.roots[0], chunk_coverage_digest: sha("different partition") }, f.roots[1]]))],
  ["model bank units changed", async f => f.reseal("model-components.json", JSON.stringify([{ ...f.manifest.components[0], units: [] }]))],
  ["EOF newline removed", async f => f.reseal("memberships.jsonl", jsonl(f.members).trimEnd())],
  ["undeclared whitespace row", async f => f.reseal("population.jsonl", jsonl(f.pops) + "\n")]
];
test("resealed corrupt streams fail complete preflight before any root is externally iterable", async t => {
  for (const [name, corrupt] of corruptions) await t.test(name, async () => {
    const f = await fixture(true); try { await corrupt(f); await assert.rejects(prepare(await f.args()), /^Error: workspace_incremental_projection_files_/u); }
    finally { await f.cleanup(); }
  });
});

test("rejects scope, population, component and census checkpoint disagreement", async t => {
  const f = await fixture(); try {
    const args = await f.args();
    for (const patch of [{ workspace_id: id(999) }, { execution_id: id(999) }, { population_digest: sha("wrong population") },
      { roots: 1 }, { occurrences: 133 }, { components: 0 }, { component_digest: sha("wrong bank") },
      { model_bank_bytes: 0 }, { analysis_complete: true }, { numeric_complete: false }]) await t.test(JSON.stringify(patch), async () => {
      await assert.rejects(prepare({ ...args, checkpoint: { ...args.checkpoint, ...patch } as Checkpoint }), /workspace_incremental_projection_files_/u);
    });
  } finally { await f.cleanup(); }
});

test("file references and private path cannot be missing, modified, symlinked or traversed", async t => {
  for (const kind of ["missing", "bytes", "symlink", "traversal"] as const) await t.test(kind, async () => {
    const f = await fixture(); try {
      const args = await f.args(), target = join(f.directory, "memberships.jsonl");
      if (kind === "missing") await rm(target);
      if (kind === "bytes") await writeFile(target, "altered");
      if (kind === "symlink") { await rm(target); await symlink(join(f.directory, "population.jsonl"), target); }
      if (kind === "traversal") args.manifest_ref.file = "../manifest.json";
      await assert.rejects(prepare(args), /workspace_incremental_projection_files_/u);
    } finally { await f.cleanup(); }
  });
});

test("root and JSON budgets fail explicitly; no root or model population is silently clipped", async () => {
  const f = await fixture(); try {
    await assert.rejects(prepare({ ...await f.args(), max_root_bytes: 4096 }), /root_capacity_exceeded/u);
    await assert.rejects(prepare({ ...await f.args(), max_root_bytes: 8 * 1024 * 1024 + 1 }), /capacity_invalid/u);
    const body = JSON.stringify(f.manifest) + " ".repeat(8 * 1024 * 1024);
    await writeFile(join(f.directory, "manifest.json"), body);
    await assert.rejects(prepare(await f.args()), /json_capacity_exceeded/u);
  } finally { await f.cleanup(); }
});

test("modification after preflight is rejected before the iterator emits any root", async () => {
  const f = await fixture(); try {
    const prepared = await prepare(await f.args()); await writeFile(join(f.directory, "memberships.jsonl"), "changed");
    let emitted = 0; await assert.rejects(async () => { for await (const packet of prepared.roots()) { void packet; emitted++; } }, /artifact_invalid/u);
    assert.equal(emitted, 0);
  } finally { await f.cleanup(); }
});

test("mutation during the second pass prevents EOF success even if the stream had buffered the original bytes", async () => {
  const f = await fixture(); try {
    const prepared = await prepare(await f.args()), iterator = prepared.roots()[Symbol.asyncIterator]();
    try {
      assert.equal((await iterator.next()).value.root.root_id, f.roots[0]!.root_id);
      await writeFile(join(f.directory, "memberships.jsonl"), jsonl(f.members) + "\n");
      let completed = false;
      await assert.rejects(async () => { while (true) { const result = await iterator.next(); if (result.done) { completed = true; return; } } }, /artifact_invalid|jsonl_invalid/u);
      assert.equal(completed, false);
    } finally { await iterator.return?.(); }
  } finally { await f.cleanup(); }
});

test("an empty bank keeps every pending root visible without manufacturing a unit or membership", async () => {
  const f = await fixture(true); try {
    f.manifest.components = []; f.manifest.coverage = [];
    f.manifest.counts.components = 0; f.manifest.counts.model_bank_bytes = 0; f.manifest.counts.memberships = 0;
    f.manifest.counts.cohort_occurrences = 134; f.manifest.counts.pending_occurrences = 134;
    f.manifest.artifacts = f.manifest.artifacts.filter(file => file.file !== "model.open.joblib");
    await f.reseal("model-components.json", "[]"); await f.reseal("memberships.jsonl", "");
    await f.reseal("pending-cohort.jsonl", jsonl(f.pops));
    await f.reseal("roots.jsonl", jsonl(f.roots.map(root => ({ ...root, unit_keys: [], state: "discovery_pending", discovery_pending: true }))));
    const result = await prepare(await f.args()), all = await packets(result);
    assert.equal(result.census.pending_roots, 2); assert.equal(result.census.chunks, 134);
    assert.equal(result.census.expected_unit_count, 0); assert.equal(result.census.expected_unit_digest, sha(""));
    assert.equal(result.census.memberships, 0); assert.equal(all.length, 2);
    assert.ok(all.every(packet => packet.root.discovery_pending && packet.root.state === "discovery_pending" && !packet.memberships.length));
  } finally { await f.cleanup(); }
});

const real = resolve(import.meta.dirname, "../../../../.data/workspace-incremental-2026-09-09/pytest-final/incremental-real0");
test("previously computed three-wave corpus and complete retirement reconcile without fitting or opening models", { skip: !existsSync(real) }, async () => {
  for (const [name, rootCount, chunkCount, memberCount, pendingRoots] of [
    ["output2", 390, 523, 1919, 0], ["output3", 401, 534, 1955, 13], ["empty-output", 0, 0, 0, 0]
  ] as const) {
    const directory = join(real, name), manifest = parseSignalWorkspaceIncrementalOutputV1(await readJson(join(directory, "manifest.json")));
    const prepared = await prepare({ storage_root: real, directory, manifest_ref: await ref(directory, "manifest.json"), checkpoint: checkpoint(manifest) });
    assert.equal(prepared.census.roots, rootCount); assert.equal(prepared.census.chunks, chunkCount);
    assert.equal(prepared.census.memberships, memberCount); assert.equal(prepared.census.pending_roots, pendingRoots);
    const unitKeys = manifest.components.flatMap(component => component.units.map(unit => unit.unit_key)).sort();
    assert.equal(prepared.census.expected_unit_count, unitKeys.length);
    assert.equal(prepared.census.expected_unit_digest, signalWorkspaceInterpretationUniverseDigestV1(unitKeys));
    const sourceMembers = await readRows(join(directory, "memberships.jsonl")), expectedDigest = digest(sourceMembers.map(signalWorkspaceIncrementalMembershipDigestV1));
    const consumed = []; let roots = 0, chunks = 0, knownPending = 0;
    for await (const packet of prepared.roots()) { roots++; chunks += packet.chunks.length; consumed.push(...packet.memberships);
      if (packet.root.discovery_pending && packet.memberships.length) knownPending++; }
    assert.equal(roots, rootCount); assert.equal(chunks, chunkCount);
    assert.equal(digest(consumed.map(signalWorkspaceIncrementalMembershipDigestV1)), expectedDigest);
    if (name === "output3") assert.ok(knownPending > 0, "known memberships do not hide discovery backlog");
    if (name === "empty-output") assert.equal(manifest.counts.removed_roots, 401);
  }
  const directory = join(real, "output1"), numeric = parseSignalWorkspaceIncrementalOutputV1(await readJson(join(real, "output2", "manifest.json")));
  await assert.rejects(prepare({ storage_root: real, directory, manifest_ref: await ref(directory, "manifest.json"), checkpoint: checkpoint(numeric) }), /workspace_incremental_projection_files_/u);
});
