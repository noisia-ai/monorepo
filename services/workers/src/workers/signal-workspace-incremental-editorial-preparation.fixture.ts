import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSignalWorkspaceIncrementalOutputV1, signalWorkspaceIncrementalDigestV1 as digest,
  signalWorkspaceIncrementalMembershipSchemaV1,
  type SignalWorkspaceIncrementalProjectionRootV1 } from "@noisia/query-engine";
import { prepareWorkspaceIncrementalEditorialEvidenceV1 as prepare } from "./signal-workspace-incremental-editorial-evidence";

type Args = Parameters<typeof prepare>[0];
type Output = ReturnType<typeof parseSignalWorkspaceIncrementalOutputV1>;
type Population = { ordinal: number; root_id: string; root_fingerprint: string; asset_sha256: string; expected_chunks: number;
  chunk_index: number; start: number; end: number; chunk_sha256: string };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (s: string | Buffer) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row) + "\n").join("");
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
export async function preparationEvidenceFixtureV1() {
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
