import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseSignalWorkspaceInterpretationClusterV1, signalWorkspaceInterpretationReferenceIdV1,
  type SignalWorkspaceInterpretationClusterV1, type SignalWorkspaceInterpretationReferenceV1 } from "@noisia/query-engine";
import type { WorkspaceEngineOutputV1 } from "./signal-workspace-engine-process";

const fail = (): never => { throw new Error("workspace_engine_evidence_integrity_invalid"); };
type Occurrence = { ordinal: number; root_id: string; chunk_index: number; start: number; end: number;
  chunk_sha256: string; text?: string; stable_cluster_id?: string | null; local_label?: number; strength?: number };
type Representative = Occurrence & { strength: number; selection_reason: SignalWorkspaceInterpretationReferenceV1["selection_reason"] };
type Cluster = { stable_cluster_id: string; local_label: number; lane: "open" | "guided"; root_count: number;
  chunk_count: number; terms: string[]; representatives: Representative[]; representative_selection_policy: string };
async function* records(path: string): AsyncGenerator<Occurrence> {
  const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of lines) {
    if (!line || line.length > 16384) fail();
    let parsed: unknown; try { parsed = JSON.parse(line); } catch { fail(); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail();
    yield parsed as Occurrence;
  } }
  finally { lines.close(); stream.destroy(); }
}
const identity = (row: Occurrence) => ({ ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index,
  start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 });

/** Join every assignment back to its immutable source occurrence. Memory holds
 * cluster summaries and at most ten texts per cluster, never the corpus matrix.
 * Each group digest includes ALL of its occurrences, including unquoted ones. */
export async function readWorkspaceEngineInterpretationEvidenceV1(args: {
  input_directory: string; output_directory: string; output: WorkspaceEngineOutputV1;
}): Promise<SignalWorkspaceInterpretationClusterV1[]> {
  const result: SignalWorkspaceInterpretationClusterV1[] = [];
  const lanes = new Set<string>();
  for (const lane of args.output.lanes) {
    if (!["open", "guided"].includes(lane.lane) || lanes.has(lane.lane)) fail();
    lanes.add(lane.lane);
    if (lane.assignments_file !== `assignments.${lane.lane}.jsonl` || lane.clusters_file !== `clusters.${lane.lane}.json`) fail();
    const path = join(args.output_directory, lane.clusters_file);
    // Capacity failure is explicit; it never drops groups to fit a prompt.
    if ((await stat(path)).size > 64 * 1024 * 1024) throw new Error("workspace_engine_evidence_capacity_exceeded");
    let clusters: Cluster[]; try { clusters = JSON.parse(await readFile(path, "utf8")) as Cluster[]; } catch { return fail(); }
    if (!Array.isArray(clusters) || clusters.length !== lane.clusters) fail();
    const census = new Map(clusters.map(cluster => {
      if (cluster.lane !== lane.lane || cluster.representative_selection_policy !== "distinct-roots-affiliation-boundary-v1"
        || !Number.isSafeInteger(cluster.local_label) || cluster.local_label < 0
        || !Array.isArray(cluster.representatives) || cluster.representatives.length !== Math.min(10, cluster.root_count)
        || cluster.representatives.filter(rep => rep.selection_reason === "low_affiliation_boundary").length !== (cluster.root_count > 1 ? 1 : 0)) fail();
      return [cluster.stable_cluster_id, { cluster, hash: createHash("sha256"), chunks: 0, roots: 0,
        lastRoot: "", refs: new Map<number, SignalWorkspaceInterpretationReferenceV1>() }] as [string, { cluster: Cluster; hash: ReturnType<typeof createHash>; chunks: number; roots: number; lastRoot: string; refs: Map<number, SignalWorkspaceInterpretationReferenceV1> }];
    }));
    if (census.size !== clusters.length || new Set(clusters.map(cluster => cluster.local_label)).size !== clusters.length) fail();
    const source = records(join(args.input_directory, "chunks.jsonl"));
    let ordinal = 0, populationRoots = 0, lastRoot = "", outliers = 0;
    try {
      for await (const assigned of records(join(args.output_directory, lane.assignments_file))) {
        const next = await source.next(), original = next.value;
        if (next.done || assigned.ordinal !== ordinal || JSON.stringify(identity(assigned)) !== JSON.stringify(identity(original))) fail();
        if (assigned.root_id !== lastRoot) {
          if (assigned.root_id <= lastRoot) fail();
          populationRoots++; lastRoot = assigned.root_id;
        }
        if (!Number.isSafeInteger(assigned.local_label) || !Number.isFinite(assigned.strength)
          || assigned.strength! < 0 || assigned.strength! > 1) fail();
        if (assigned.stable_cluster_id !== null) {
          const entry = census.get(assigned.stable_cluster_id!) ?? fail();
          if (assigned.local_label !== entry.cluster.local_label) fail();
          entry.hash.update(JSON.stringify(identity(assigned)) + "\n"); entry.chunks++;
          if (entry.lastRoot !== assigned.root_id) { entry.roots++; entry.lastRoot = assigned.root_id; }
          for (const rep of entry.cluster.representatives.filter(item => item.ordinal === ordinal)) {
            if (JSON.stringify(identity(rep)) !== JSON.stringify(identity(original)) || rep.strength !== assigned.strength || !original.text) fail();
            const { root_id, chunk_index, start, end, chunk_sha256 } = original;
            const ref = { root_id, chunk_index, start, end, chunk_sha256 };
            if (entry.refs.has(ordinal)) fail();
            entry.refs.set(ordinal, { ...ref, ref_id: signalWorkspaceInterpretationReferenceIdV1(ref), text: original.text,
              strength: rep.strength, selection_reason: rep.selection_reason });
          }
        } else { if (assigned.local_label !== -1) fail(); outliers++; }
        ordinal++;
      }
      if (!(await source.next()).done || ordinal !== lane.occurrences || ordinal !== args.output.counts.occurrences
        || populationRoots !== lane.roots || populationRoots !== args.output.counts.roots) fail();
      const declaredOutliers = (lane as typeof lane & { outlier_occurrences?: number }).outlier_occurrences;
      if (declaredOutliers !== undefined && declaredOutliers !== outliers) fail();
    } finally { await source.return(undefined); }
    for (const { cluster, hash, roots, chunks, refs } of census.values()) {
      if (roots !== cluster.root_count || chunks !== cluster.chunk_count || refs.size !== cluster.representatives.length) fail();
      result.push(parseSignalWorkspaceInterpretationClusterV1({ cluster_id: `${lane.lane}:${cluster.stable_cluster_id}`,
        lane: lane.lane, cluster_digest: `sha256:${hash.digest("hex")}`, root_count: roots, chunk_count: chunks,
        // BERTopic pads a short vocabulary with empty terms. Keep the sealed
        // raw artifact and every nonempty term, citation and census unchanged.
        terms: Array.isArray(cluster.terms)
          ? cluster.terms.filter(term => typeof term !== "string" || term.trim().length > 0)
          : cluster.terms,
        representatives: cluster.representatives.map(rep => refs.get(rep.ordinal)) }));
    }
  }
  if (!lanes.has("open")) fail();
  return result.sort((a, b) => a.cluster_id < b.cluster_id ? -1 : a.cluster_id > b.cluster_id ? 1 : 0);
}
