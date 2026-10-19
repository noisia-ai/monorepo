import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readWorkspaceEngineInterpretationEvidenceV1 } from "./signal-workspace-engine-evidence.js";
import type { WorkspaceEngineOutputV1 } from "./signal-workspace-engine-process.js";
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const source = Array.from({ length: 13 }, (_, root) => Array.from({ length: root === 0 ? 12 : 1 }, (_, chunk_index) => {
    const text = `Fixture ${root + 1}/${chunk_index} 🌞.`;
    return { ordinal: 0, root_id: id(root + 1), chunk_index, start: chunk_index * text.length, end: (chunk_index + 1) * text.length,
      chunk_sha256: sha(text), text };
  })).flat().map((row, ordinal) => ({ ...row, ordinal }));
  const assignments = source.map(row => ({ ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index,
    start: row.start, end: row.end, chunk_sha256: row.chunk_sha256, local_label: row.root_id === id(13) ? -1 : 0,
    stable_cluster_id: row.root_id === id(13) ? null : "stable", strength: row.root_id === id(12) ? 0.01 : 0.9 }));
  const representatives = assignments.filter(row => row.chunk_index === 0 && (row.root_id <= id(9) || row.root_id === id(12)))
    .map(row => ({ ...row, selection_reason: row.root_id === id(12) ? "low_affiliation_boundary" : "high_affiliation" }));
  const clusters = [{ stable_cluster_id: "stable", local_label: 0, lane: "open" as "open" | "guided", root_count: 12,
    chunk_count: source.length - 1, terms: ["fixture"], representatives, representative_selection_policy: "distinct-roots-affiliation-boundary-v1" }];
  const output: WorkspaceEngineOutputV1 = { contract_version: "workspace-topic-engine-output-v1", workspace_id: id(99),
    input_manifest_sha256: sha("input"), previous_manifest_sha256: null, input_identity: {}, config: {}, versions: {}, status: "completed",
    counts: { occurrences: source.length, roots: 13, guides: 0, common_unchanged_roots: 0 },
    lanes: [{ lane: "open", model_file: "model.open.joblib", assignments_file: "assignments.open.jsonl", clusters_file: "clusters.open.json",
      occurrences: source.length, roots: 13, clusters: 1 }], artifacts: [], quality: "uncalibrated", approval_policy: "none" };
  return { source, assignments, clusters, output };
}
async function execute(f: ReturnType<typeof fixture>) {
  const root = await mkdtemp(join(tmpdir(), "noisia-evidence-"));
  try {
    const input_directory = join(root, "input"), output_directory = join(root, "output");
    await mkdir(input_directory); await mkdir(output_directory);
    await writeFile(join(input_directory, "chunks.jsonl"), f.source.map(row => JSON.stringify(row) + "\n").join(""));
    for (const lane of f.output.lanes) {
      await writeFile(join(output_directory, lane.assignments_file), f.assignments.map(row => JSON.stringify(row) + "\n").join(""));
      await writeFile(join(output_directory, lane.clusters_file), JSON.stringify(f.clusters.map(cluster => ({ ...cluster, lane: lane.lane }))));
    }
    return await readWorkspaceEngineInterpretationEvidenceV1({ input_directory, output_directory, output: f.output });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test("full membership digest changes for an unquoted occurrence, while exact representatives stay unchanged", async () => {
  const f = fixture(), original = await execute(f), index = 11;
  const expected = f.assignments.filter(row => row.stable_cluster_id).map(row => JSON.stringify({ ordinal: row.ordinal, root_id: row.root_id,
    chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 }) + "\n").join("");
  assert.equal(original[0]!.cluster_digest, sha(expected));
  assert.equal(f.clusters[0]!.representatives.some(row => row.ordinal === index), false);
  // A new sealed source/assignment generation changes an unquoted chunk.
  f.source[index]!.text = f.source[index]!.text.replace("Fixture", "Changed");
  f.source[index]!.chunk_sha256 = sha(f.source[index]!.text); f.assignments[index]!.chunk_sha256 = f.source[index]!.chunk_sha256;
  const changed = await execute(f);
  assert.notEqual(changed[0]!.cluster_digest, original[0]!.cluster_digest);
  assert.deepEqual(changed[0]!.representatives, original[0]!.representatives);
});
test("both lanes retain separate keys, distinct-root evidence and low-affiliation boundary; outlier stays unassigned", async () => {
  const f = fixture(); f.output.lanes.push({ ...f.output.lanes[0]!, lane: "guided", model_file: "model.guided.joblib",
    assignments_file: "assignments.guided.jsonl", clusters_file: "clusters.guided.json" });
  const result = await execute(f);
  assert.deepEqual(result.map(row => row.cluster_id), ["guided:stable", "open:stable"]);
  for (const row of result) {
    assert.equal(row.root_count, 12); assert.equal(row.chunk_count, 23); assert.equal(row.representatives.length, 10);
    assert.equal(new Set(row.representatives.map(ref => ref.root_id)).size, 10);
    assert.equal(row.representatives.at(-1)!.selection_reason, "low_affiliation_boundary");
    assert.equal(row.representatives.at(-1)!.strength, 0.01);
    assert.equal(row.representatives.some(ref => ref.root_id === id(13)), false);
    for (const ref of row.representatives) assert.equal(sha(ref.text), ref.chunk_sha256);
  }
});
test("complete join rejects swapped identities, changed roots/counts, truncation and false outliers", async () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { [f.assignments[0], f.assignments[1]] = [f.assignments[1]!, f.assignments[0]!]; },
    f => { f.assignments[0]!.root_id = id(77); },
    f => { f.clusters[0]!.root_count++; }, f => { f.clusters[0]!.chunk_count++; },
    f => { f.output.lanes[0]!.roots++; }, f => { f.output.counts.occurrences++; },
    f => { f.assignments.pop(); }, f => { f.source.pop(); },
    f => { f.assignments[0]!.stable_cluster_id = null; },
    f => { f.assignments[0]!.local_label = 99; },
    f => { f.assignments.at(-1)!.local_label = 0; },
    f => { f.clusters[0]!.representatives[0]!.strength = 0.1; },
    f => { f.clusters[0]!.representatives.at(-1)!.selection_reason = "high_affiliation"; },
    f => { f.output.lanes.push(f.output.lanes[0]!); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); await assert.rejects(execute(f), /workspace_engine_evidence_integrity_invalid/u); }
});
test("all-outlier population is accounted for without fabricated clusters", async () => {
  const f = fixture(); f.assignments.forEach(row => { row.stable_cluster_id = null; row.local_label = -1; });
  f.clusters = []; f.output.lanes[0]!.clusters = 0;
  Object.assign(f.output.lanes[0]!, { outlier_occurrences: f.source.length });
  assert.deepEqual(await execute(f), []);
  Object.assign(f.output.lanes[0]!, { outlier_occurrences: f.source.length - 1 });
  await assert.rejects(execute(f), /workspace_engine_evidence_integrity_invalid/u);
});
test("BERTopic empty vocabulary padding is omitted without changing real terms, evidence or full membership", async () => {
  const f = fixture(), original = await execute(f);
  f.clusters[0]!.terms = ["", " \t\n", "fixture", "\u00a0"];
  assert.deepEqual(await execute(f), original);
  f.clusters[0]!.terms = ["  unchanged real term  "];
  assert.deepEqual((await execute(f))[0]!.terms, ["  unchanged real term  "]);
  for (const invalid of ["x".repeat(257), 42, null, {}]) {
    f.clusters[0]!.terms = ["", invalid as string];
    await assert.rejects(execute(f), /workspace_engine_interpretation_cluster_invalid/u);
  }
  f.clusters[0]!.terms = ["", "\t"];
  const noTerms = await execute(f);
  assert.deepEqual(noTerms[0]!.terms, []);
  assert.equal(noTerms[0]!.cluster_digest, original[0]!.cluster_digest);
  assert.deepEqual(noTerms[0]!.representatives, original[0]!.representatives);
});
