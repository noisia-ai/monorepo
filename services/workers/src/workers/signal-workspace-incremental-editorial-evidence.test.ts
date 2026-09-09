import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseSignalWorkspaceIncrementalOutputV1, signalWorkspaceIncrementalDigestV1 as digest,
  signalWorkspaceInterpretationUniverseDigestV1, signalWorkspaceIncrementalMembershipSchemaV1,
  type SignalWorkspaceIncrementalProjectionRootV1 } from "@noisia/query-engine";
import { prepareWorkspaceIncrementalEditorialEvidenceV1 as prepare, streamWorkspaceIncrementalEditorialEvidenceV1 as stream,
  type WorkspaceIncrementalEditorialOriginV1 as Origin } from "./signal-workspace-incremental-editorial-evidence";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

type Args = Parameters<typeof prepare>[0];
type Output = ReturnType<typeof parseSignalWorkspaceIncrementalOutputV1>;
type Population = { ordinal: number; root_id: string; root_fingerprint: string; asset_sha256: string; expected_chunks: number;
  chunk_index: number; start: number; end: number; chunk_sha256: string };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (s: string | Buffer) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row) + "\n").join("");
const rows = async (file: string) => (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
async function fileRef(directory: string, file: string) { const bytes = await readFile(join(directory, file)); return { file, bytes: bytes.length, sha256: sha(bytes) }; }
async function files(storage_root: string, directory: string): Promise<Args["current"]> {
  const output = parseSignalWorkspaceIncrementalOutputV1(await json(join(directory, "manifest.json")));
  return { storage_root, directory, manifest_ref: await fileRef(directory, "manifest.json"), checkpoint: {
    contract_version: "workspace-incremental-numeric-checkpoint-v1", checkpoint_digest: sha("local fixture checkpoint"),
    workspace_id: output.workspace_id, execution_id: output.execution_id, population_digest: output.population_digest,
    roots: output.counts.roots, occurrences: output.counts.occurrences, components: output.counts.components,
    component_digest: digest([...output.components].sort((a, b) => a.component_key < b.component_key ? -1 : 1)
      .map(c => [c.component_key, c.lane, c.model_origin, c.units.length, digest(c.units)])),
    model_bank_bytes: output.counts.model_bank_bytes, discovery_status: output.discovery_status,
    relations_status: output.relations_status, numeric_complete: true, analysis_complete: false } };
}
const metadataFiles = ["manifest.json", "roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json", "candidate-groups.json"];
async function reseal(directory: string, name: string, body: string) {
  await writeFile(join(directory, name), body);
  const manifest = await json(join(directory, "manifest.json"));
  Object.assign(manifest.artifacts.find((ref: { file: string }) => ref.file === name), await fileRef(directory, name));
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
}
async function synthetic() {
  const root = await mkdtemp(join(tmpdir(), "noisia-editorial-evidence-")), directory = join(root, "born"); await mkdir(directory);
  const model_origin = { execution_id: id(900), model_artifact_sha256: sha("model never opened") }, lane = "open" as const;
  const component_key = digest([model_origin.execution_id, model_origin.model_artifact_sha256, lane]), unit_key = `open:${id(901)}`;
  const population: Population[] = [], chunks: Array<Population & { text: string }> = [];
  const memberships: Array<ReturnType<typeof signalWorkspaceIncrementalMembershipSchemaV1.parse>> = [], roots: SignalWorkspaceIncrementalProjectionRootV1[] = [];
  // A long root plus twelve independent roots. The first root's best example
  // is its FINAL (133rd) fragment; root 2 is the low-affiliation boundary.
  for (let r = 1; r <= 13; r++) {
    const count = r === 1 ? 133 : 1, root_id = id(r), root_fingerprint = sha(`root${r}`), asset_sha256 = sha("a".repeat(count));
    const parts = [];
    for (let i = 0; i < count; i++) {
      const row = { ordinal: population.length, root_id, root_fingerprint, asset_sha256, expected_chunks: count,
        chunk_index: i, start: i, end: i + 1, chunk_sha256: sha("a") };
      population.push(row); parts.push(row); chunks.push({ ...row, text: "a" });
    }
    roots.push({ root_id, root_fingerprint, asset_sha256, expected_chunks: count,
      chunk_coverage_digest: sha(parts.map(c => JSON.stringify([c.chunk_index, c.start, c.end, c.chunk_sha256]) + "\n").join("")),
      correction_digest: sha("correction"), unit_keys: [unit_key], state: "computed", discovery_pending: false });
  }
  const popDigest = digest(population), birth = digest(population.map(({ ordinal, root_id, chunk_index, start, end, chunk_sha256 }) => ({ ordinal, root_id, chunk_index, start, end, chunk_sha256 })));
  for (const row of population) memberships.push({ root_id: row.root_id, root_fingerprint: row.root_fingerprint,
    chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256, lane, unit_key,
    model_component_key: component_key, model_origin, carried_from: null,
    strength: row.root_id === id(1) ? row.chunk_index === 132 ? 1 : 0.6 : row.root_id === id(2) ? 0.1 : 0.8,
    evaluation_origin: { execution_id: model_origin.execution_id, input_population_digest: popDigest,
      evaluation_key: digest([model_origin.execution_id, component_key, popDigest, "fitted_member"]), basis: "fitted_member" } });
  const rep = (ordinal: number, reason: "high_affiliation" | "low_affiliation_boundary") => {
    const { root_id, chunk_index, start, end, chunk_sha256 } = population[ordinal]!;
    return { ordinal, root_id, chunk_index, start, end, chunk_sha256, strength: memberships[ordinal]!.strength, selection_reason: reason };
  };
  const candidate = { unit_key, component_key, birth_membership_digest: birth, root_count: roots.length, chunk_count: population.length,
    terms: ["fragmentos", "reserva"], representatives: [rep(132, "high_affiliation"), ...Array.from({ length: 8 }, (_, i) => rep(134 + i, "high_affiliation")), rep(133, "low_affiliation_boundary")] };
  const component = { component_key, lane, model_origin, model: { file: "model.open.joblib", sha256: model_origin.model_artifact_sha256, bytes: 20 },
    center: null, units: [{ local_label: 0, unit_key, birth_membership_digest: birth }] };
  const bodies: Record<string, string> = { "population.jsonl": jsonl(population), "roots.jsonl": jsonl(roots), "memberships.jsonl": jsonl(memberships),
    "pending-cohort.jsonl": "", "model-components.json": JSON.stringify([component]), "candidate-groups.json": JSON.stringify([candidate]) };
  for (const [name, body] of Object.entries(bodies)) await writeFile(join(directory, name), body);
  const artifacts = Object.entries(bodies).map(([file, body]) => ({ file, bytes: Buffer.byteLength(body), sha256: sha(body) }));
  for (const file of ["root-transitions.jsonl", "relations.json", "guides.jsonl", "guide-vectors.npy"]) artifacts.push({ file, bytes: 0, sha256: sha("") });
  artifacts.push(component.model);
  const output: Output = parseSignalWorkspaceIncrementalOutputV1({ contract_version: "workspace-topic-incremental-output-v1", workspace_id: id(999), execution_id: model_origin.execution_id,
    request_digest: sha("request"), previous_manifest_sha256: sha("previous"), compatibility: { embedding_config_digest: sha("embedding"), chunk_policy_version: "corpus-text-chunks-v1",
      context_digest: sha("context"), input_interest_catalog_digest: sha("interests"), guides_digest: sha("guides"), fit_config_digest: sha("fit"), runtime_digest: sha("runtime") },
    policy_version: "workspace-frozen-model-cohort-v1", status: "completed", quality: "uncalibrated", approval_policy: "none", discovery_status: "complete", relations_status: "pending", population_digest: popDigest,
    counts: { roots: roots.length, occurrences: population.length, added_roots: roots.length, content_changed_roots: 0, metadata_changed_roots: 0, unchanged_roots: 0, removed_roots: 0,
      delta_occurrences: population.length, cohort_occurrences: population.length, pending_occurrences: 0, memberships: memberships.length, components: 1, new_components: 1, model_bank_bytes: 20 },
    components: [component], artifacts, coverage: [{ component_key, population_digest: popDigest, expected_occurrences: population.length, copied_occurrences: 0, transformed_occurrences: 0, fitted_occurrences: population.length }],
    operations: { fit: [{ component_key, occurrences: population.length, population_digest: popDigest }], transform: [] }, metrics: { resident_bytes: 0, elapsed_seconds: 0 }, limitations: ["Manually constructed file-contract fixture; no numerical or provider execution."] });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(output));
  const current = join(root, "current"); await mkdir(current);
  for (const name of metadataFiles) await cp(join(directory, name), join(current, name));
  let reads = 0;
  const read_fragments: Args["read_fragments"] = async refs => { reads++; assert.ok(refs.length <= 10);
    return refs.map(ref => ({ ...ref, text: chunks.find(row => row.root_id === ref.root_id && row.chunk_index === ref.chunk_index)!.text })); };
  const args = async (): Promise<Args> => ({ current: await files(root, current), origins: [{ kind: "incremental", files: await files(root, directory) }], exclusions: [], read_fragments });
  return { root, directory, current, candidate, roots, population, memberships, args, reads: () => reads, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("complete 133-fragment root is counted once; deterministic ten-root policy includes its final fragment and a boundary", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network prohibited"); });
  const f = await synthetic(); try {
    const result = await prepare(await f.args()), cluster = result.clusters[0]!;
    assert.equal(result.census.roots, 13); assert.equal(result.census.chunks, 145); assert.equal(cluster.root_count, 13); assert.equal(cluster.chunk_count, 145);
    assert.equal(cluster.representatives.length, 10); assert.equal(new Set(cluster.representatives.map(ref => ref.root_id)).size, 10);
    assert.equal(cluster.representatives[0]!.chunk_index, 132); assert.equal(cluster.representatives.at(-1)!.root_id, id(2));
    assert.equal(cluster.representatives.at(-1)!.selection_reason, "low_affiliation_boundary");
    assert.equal(result.units[0]!.birth_membership_digest, f.candidate.birth_membership_digest);
    assert.deepEqual(result.numeric_component_order, [f.candidate.component_key]);
    assert.notEqual(cluster.cluster_digest, f.candidate.birth_membership_digest); assert.equal(f.reads(), 1);
    assert.equal(existsSync(join(f.directory, "model.open.joblib")), false);
    assert.deepEqual(await prepare(await f.args()), result, "replay of evidence bytes is deterministic");
  } finally { await f.cleanup(); }
});
test("typed exclusions skip text lookup without dropping units or census", async () => {
  const f = await synthetic(); try {
    for (const reason of ["already_interpreted", "editorial_claimed"] as const) {
      const args = await f.args(), { unit_key, component_key, birth_membership_digest } = f.candidate;
      const result = await prepare({ ...args, exclusions: [{ unit_key, component_key, birth_membership_digest, reason }] });
      assert.equal(result.units[0]!.status, reason); assert.equal(result.clusters.length, 0); assert.equal(result.census.chunks, 145);
      assert.equal(result.target_unit_digest, sha(""));
      assert.equal(result.target_binding_digest, digest([]));
    }
    assert.equal(f.reads(), 0);
  } finally { await f.cleanup(); }
});
test("changing an unquoted member changes the complete editorial digest, never its birth identity", async () => {
  const f = await synthetic(); try {
    const prior = await prepare(await f.args());
    const changed = f.memberships.map((member, i) => i === 0 ? { ...member, strength: 0.65 } : member);
    await reseal(f.current, "memberships.jsonl", jsonl(changed));
    const next = await prepare(await f.args());
    assert.deepEqual(next.clusters[0]!.representatives, prior.clusters[0]!.representatives);
    assert.notEqual(next.clusters[0]!.cluster_digest, prior.clusters[0]!.cluster_digest);
    assert.equal(next.units[0]!.birth_membership_digest, prior.units[0]!.birth_membership_digest);
  } finally { await f.cleanup(); }
});
test("origin, birth, current EOF and text corruption fail rather than normalize or omit units", async t => {
  for (const kind of ["origin_missing", "foreign_origin", "birth_count", "birth_sha", "candidate_bytes", "candidate_extra", "current_eof", "exclusion", "text", "fragment_swap"] as const) await t.test(kind, async () => {
    const f = await synthetic(); try {
      if (kind === "birth_count") await reseal(f.directory, "candidate-groups.json", JSON.stringify([{ ...f.candidate, root_count: 12 }]));
      if (kind === "birth_sha") await reseal(f.directory, "candidate-groups.json", JSON.stringify([{ ...f.candidate, birth_membership_digest: sha("bad") }]));
      if (kind === "candidate_extra") await reseal(f.directory, "candidate-groups.json", JSON.stringify([f.candidate, f.candidate]));
      if (kind === "candidate_bytes") await writeFile(join(f.directory, "candidate-groups.json"), "[]");
      if (kind === "current_eof") await reseal(f.current, "memberships.jsonl", jsonl(f.memberships).trimEnd());
      const args = await f.args();
      if (kind === "origin_missing") args.origins = [];
      if (kind === "foreign_origin") (args.origins[0] as Extract<Origin, { kind: "incremental" }>).files.checkpoint.workspace_id = id(77);
      if (kind === "exclusion") args.exclusions = [{ ...f.candidate, birth_membership_digest: sha("bad"), reason: "already_interpreted" }];
      if (kind === "text") args.read_fragments = async refs => refs.map(ref => ({ ...ref, text: "b" }));
      if (kind === "fragment_swap") args.read_fragments = async refs => refs.map(ref => ({ ...ref, text: "a" })).reverse();
      await assert.rejects(prepare(args), /workspace_incremental_editorial_evidence_/u);
      if (!["text", "fragment_swap"].includes(kind)) assert.equal(f.reads(), 0, "metadata failure occurs before any text lookup");
    } finally { await f.cleanup(); }
  });
});

test("1,000 units stream more than 8 MiB of complete evidence with bounded callbacks and an EOF digest", { timeout: 120000 }, async t => {
  const f = await synthetic();
  try {
    const count = 1000, rootCount = 10, text = "🙂" + "a".repeat(1398), chunk_sha256 = sha(text), asset_sha256 = sha(text.repeat(count));
    const manifest = await json(join(f.directory, "manifest.json")), component = manifest.components[0];
    const population: Population[] = [], memberships: unknown[] = [], roots: SignalWorkspaceIncrementalProjectionRootV1[] = [];
    const candidates: unknown[] = [], units = [];
    const unitKey = (i: number) => `open:${id(10000 + i)}`;
    for (let r = 0; r < rootCount; r++) {
      const root_id = id(r + 1), root_fingerprint = sha(`large root${r}`), chunks: Population[] = [];
      for (let i = 0; i < count; i++) chunks.push({ ordinal: r * count + i, root_id, root_fingerprint, asset_sha256,
        expected_chunks: count, chunk_index: i, start: i * text.length, end: (i + 1) * text.length, chunk_sha256 });
      population.push(...chunks);
      roots.push({ root_id, root_fingerprint, asset_sha256, expected_chunks: count,
        chunk_coverage_digest: sha(chunks.map(c => JSON.stringify([c.chunk_index, c.start, c.end, c.chunk_sha256]) + "\n").join("")),
        correction_digest: sha("correction"), unit_keys: Array.from({ length: count }, (_, i) => unitKey(i)), state: "computed", discovery_pending: false });
    }
    const populationDigest = digest(population);
    const strength = (root: number) => root === 0 ? 1 : root === 1 ? 0.1 : 0.8;
    for (const row of population) memberships.push({ root_id: row.root_id, root_fingerprint: row.root_fingerprint,
      chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256, lane: "open", unit_key: unitKey(row.chunk_index),
      model_component_key: component.component_key, model_origin: component.model_origin, carried_from: null,
      strength: strength(Math.floor(row.ordinal / count)), evaluation_origin: { execution_id: manifest.execution_id,
        input_population_digest: populationDigest, evaluation_key: digest([manifest.execution_id, component.component_key, populationDigest, "fitted_member"]), basis: "fitted_member" } });
    for (let i = 0; i < count; i++) {
      const refs = Array.from({ length: rootCount }, (_, root) => { const row = population[root * count + i]!;
        return { ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256 }; });
      const birth_membership_digest = digest(refs), unit_key = unitKey(i);
      units.push({ local_label: i, unit_key, birth_membership_digest });
      const representatives = [0, 2, 3, 4, 5, 6, 7, 8, 9, 1].map(root => ({ ...refs[root], strength: strength(root),
        selection_reason: root === 1 ? "low_affiliation_boundary" : "high_affiliation" }));
      candidates.push({ unit_key, component_key: component.component_key, birth_membership_digest,
        root_count: rootCount, chunk_count: rootCount, terms: ["complete local evidence"], representatives });
    }
    component.units = units; manifest.population_digest = populationDigest;
    Object.assign(manifest.counts, { roots: rootCount, occurrences: population.length, added_roots: rootCount,
      delta_occurrences: population.length, cohort_occurrences: population.length, memberships: memberships.length });
    Object.assign(manifest.coverage[0], { population_digest: populationDigest, expected_occurrences: population.length, fitted_occurrences: population.length });
    Object.assign(manifest.operations.fit[0], { population_digest: populationDigest, occurrences: population.length });
    await writeFile(join(f.directory, "manifest.json"), JSON.stringify(manifest));
    for (const [name, body] of [["roots.jsonl", jsonl(roots)], ["population.jsonl", jsonl(population)], ["memberships.jsonl", jsonl(memberships)],
      ["model-components.json", JSON.stringify([component])], ["candidate-groups.json", JSON.stringify(candidates)]]) await reseal(f.directory, name!, body!);
    const current = await files(f.root, f.directory), path = join(f.root, "editorial.jsonl"), handle = await open(path, "wx");
    let written = 0, active = 0, maximumActive = 0, maximumTextBatch = 0, lastKey = "";
    const args: Args = { current, origins: [{ kind: "incremental", files: current }], exclusions: [], read_fragments: async refs => {
      maximumTextBatch = Math.max(maximumTextBatch, refs.length); return refs.map(ref => ({ ...ref, text })); } };
    let descriptor;
    try { descriptor = await stream({ ...args, write_cluster: async row => {
      active++; maximumActive = Math.max(maximumActive, active);
      assert.equal(row.index, written); assert.ok(row.unit_key > lastKey); lastKey = row.unit_key;
      const packet = JSON.parse(row.jsonl); assert.equal(packet.cluster.representatives.length, rootCount);
      assert.equal(packet.unit.unit_key, row.unit_key); assert.equal(packet.cluster.root_count, rootCount);
      assert.ok(packet.cluster.representatives.every((ref: { text: string }) => ref.text.length === 1400));
      await handle.writeFile(row.jsonl); written++; active--;
    } }); } finally { await handle.close(); }
    assert.equal(written, count); assert.equal(maximumActive, 1); assert.equal(maximumTextBatch, 10);
    assert.equal(descriptor.stream.rows, count); assert.ok(descriptor.stream.bytes > 8 * 1024 * 1024);
    assert.equal(descriptor.stream.bytes, (await stat(path)).size); assert.equal("clusters" in descriptor, false);
    assert.equal(descriptor.stream.sha256, await hashWorkspaceEngineFileV1(path));
    assert.equal(descriptor.census.chunks, 10000); assert.equal(descriptor.units.length, count);
    assert.equal(descriptor.target_unit_digest, signalWorkspaceInterpretationUniverseDigestV1(units.map(unit => unit.unit_key)));
    assert.equal(descriptor.target_binding_digest, digest(units.map(unit => ({ component_key: component.component_key,
      unit, model_origin: component.model_origin }))));
    assert.notEqual(descriptor.target_binding_digest, descriptor.target_unit_digest);
    assert.deepEqual(descriptor.units.map(unit => unit.local_label), units.map(unit => unit.local_label));
    assert.equal(existsSync(join(f.directory, "model.open.joblib")), false);
    t.diagnostic(JSON.stringify({ streamed_units: descriptor.stream.rows, streamed_bytes: descriptor.stream.bytes,
      source_roots: descriptor.census.roots, source_chunks: descriptor.census.chunks, max_callback_concurrency: maximumActive,
      max_fragment_batch: maximumTextBatch, final_file_sha_verified: true }));
  } finally { await f.cleanup(); }
});

test("last callback failure or source mutation leaves orphan lines but never a final descriptor", async t => {
  for (const kind of ["last_write", "source_changed"] as const) await t.test(kind, async () => {
    const f = await synthetic(); let written = 0, descriptor: unknown;
    try {
      await assert.rejects(async () => { descriptor = await stream({ ...await f.args(), write_cluster: async row => {
        await writeFile(join(f.root, "partial.jsonl"), row.jsonl); written++;
        if (kind === "last_write") throw Object.assign(new Error("storage detail must stay private"), { code: "ECONNRESET" });
        await writeFile(join(f.directory, "candidate-groups.json"), "[]");
      } }); }, /workspace_incremental_editorial_evidence_(invalid|source_changed)/u);
      assert.equal(written, 1); assert.equal(descriptor, undefined); assert.ok(existsSync(join(f.root, "partial.jsonl")));
    } finally { await f.cleanup(); }
  });
});

// Optional already-calculated, synthetic BERTopic fixtures. No Python runs here.
const real = process.env.NOISIA_INCREMENTAL_EDITORIAL_FIXTURE_DIR ?? resolve(import.meta.dirname, "../../../../.data/workspace-incremental-2026-09-09/pytest-final/incremental-real0");
test("three calculated waves retain six unnamed inherited units, current membership counts and all 401 retired roots", { skip: !existsSync(join(real, "output3", "manifest.json")) }, async () => {
  const storage = await mkdtemp(join(tmpdir(), "noisia-editorial-calculated-"));
  try {
    for (const name of ["output2", "output3", "empty-output"]) { await mkdir(join(storage, name));
      for (const file of metadataFiles) await cp(join(real, name, file), join(storage, name, file)); }
    const birth = await files(storage, join(storage, "output2")), born = parseSignalWorkspaceIncrementalOutputV1(await json(join(storage, "output2", "manifest.json")));
    const legacy: Origin[] = born.components.filter(c => c.model_origin.execution_id !== born.execution_id).map(c => ({ kind: "full_fit", model_origin: c.model_origin }));
    const sources: Origin[] = [...legacy, { kind: "incremental", files: birth }];
    for (const [name, input, rootCount, chunkCount] of [["output2", "input2", 390, 523], ["output3", "input3", 401, 534], ["empty-output", "empty-input", 0, 0]] as const) {
      const raw = name === "empty-output" ? [] : await rows(join(real, input, "chunks.jsonl")); let reads = 0;
      const result = await prepare({ current: await files(storage, join(storage, name)), origins: sources, exclusions: [],
        read_fragments: async refs => { reads++; assert.ok(refs.length <= 10); return refs.map(ref => {
          const found = raw.find(row => row.root_id === ref.root_id && row.chunk_index === ref.chunk_index); assert.ok(found);
          assert.equal(found.root_fingerprint, ref.root_fingerprint); assert.equal(found.asset_sha256, ref.asset_sha256);
          return { ...ref, text: found.text }; }); } });
      assert.equal(result.census.roots, rootCount); assert.equal(result.census.chunks, chunkCount); assert.equal(result.units.length, 11);
      const originalOrder = (await json(join(storage, name, "manifest.json"))).components.map((c: { component_key: string }) => c.component_key);
      assert.deepEqual(result.numeric_component_order, originalOrder);
      assert.notDeepEqual(originalOrder, [...originalOrder].sort(), "preserve the original sealed order, not lexical normalization");
      assert.equal(result.units.filter(u => u.status === "legacy_full_fit").length, 5);
      assert.equal(result.clusters.length, name === "empty-output" ? 0 : 6);
      if (name === "output3") { assert.equal(result.census.pending_roots, 13); assert.equal((await json(join(storage, name, "candidate-groups.json"))).length, 0); }
      const all = await rows(join(storage, name, "memberships.jsonl"));
      for (const cluster of result.clusters) {
        const matches = all.filter(member => member.unit_key === cluster.cluster_id);
        assert.equal(cluster.chunk_count, matches.length); assert.equal(cluster.root_count, new Set(matches.map(m => m.root_id)).size);
        const original = (await json(join(storage, "output2", "candidate-groups.json"))).find((c: { unit_key: string }) => c.unit_key === cluster.cluster_id);
        if (name === "output3") assert.notEqual(cluster.root_count, original.root_count, "birth census must not substitute the current population");
      }
      if (name === "empty-output") { assert.equal(reads, 0); assert.equal(result.units.filter(u => u.status === "no_current_members").length, 6); }
      assert.equal(result.target_unit_digest, signalWorkspaceInterpretationUniverseDigestV1(result.clusters.map(c => c.cluster_id)));
    }
  } finally { await rm(storage, { recursive: true, force: true }); }
});
