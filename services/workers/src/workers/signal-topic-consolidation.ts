import type { Job } from "bullmq";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  loadSignalTopicConsolidationRootMetadataV1,
  loadSignalTopicConsolidationSourceV1,
  computeSignalTopicConsolidationCentroidsV1,
  persistSignalTopicConsolidationCentroidArtifactV1,
  materializeSignalTopicAtomicCensusV1,
  materializeSignalTopicCommunityPlanV1,
  parseSignalTopicAtomicCensusV1,
  signalTopicConsolidationDigestV1,
  stableSignalTopicConsolidationJsonV1,
  type SignalTopicAtomicCensusV1,
  type SignalTopicAtomicGroupV1,
  type SignalTopicConsolidationConfigurationV1,
  type SignalTopicConsolidationCentroidMembershipV1,
  type SignalTopicConsolidationCentroidV1,
  type SignalTopicConsolidationCommunityPlanV1,
  type SignalTopicConsolidationRootMetadataV1,
  type SignalTopicConsolidationSourceV1,
  type SignalTopicConsolidationStoredArtifactV1,
} from "@noisia/db";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FILE = /^[a-z][a-z0-9_.-]{0,100}$/u;
const fail = (code: string): never => { throw new Error(`signal_topic_consolidation_${code}`); };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("artifact_invalid");
const natural = (value: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : fail("artifact_invalid");
const text = (value: unknown, max: number): string =>
  typeof value === "string" && value.length > 0 && value.trim() === value && Buffer.byteLength(value, "utf8") <= max
    ? value : fail("artifact_invalid");
const digest = (bytes: Uint8Array | string): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const consolidationCode = /(?:^|\b)(signal_topic_consolidation_[a-z_]{1,100})(?:\b|$)/u;
const databaseFailure = new Map([
  ["57014", "timeout"],
  ["23514", "constraint"],
  ["23503", "foreign_key"],
  ["23505", "conflict"],
  ["22001", "value_too_long"],
]);
function stageFailure(stage: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  const known = message.match(consolidationCode)?.[1];
  if (known) return new Error(known);
  const sqlState = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : null;
  return new Error(`signal_topic_consolidation_${stage}_${databaseFailure.get(sqlState ?? "") ?? "failed"}`);
}
async function atStage<T>(stage: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw stageFailure(stage, error); }
}

type Population = { ordinal: number; root_id: string; root_fingerprint: string; expected_chunks: number;
  chunk_index: number; start: number; end: number; chunk_sha256: string };
type OccurrenceIdentity = Pick<Population, "ordinal" | "root_id" | "chunk_index" | "start" | "end" | "chunk_sha256">;
type Assignment = OccurrenceIdentity & { local_label: number; stable_cluster_id: string | null; strength: number };
type Representative = Pick<Assignment, "ordinal" | "root_id" | "chunk_index" | "start" | "end" | "chunk_sha256" | "strength"> & {
  selection_reason: "high_affiliation" | "low_affiliation_boundary";
};
type Cluster = { stable_cluster_id: string; local_label: number; lane: "open" | "guided"; root_count: number;
  chunk_count: number; terms: string[]; representative_selection_policy: string; representatives: Representative[] };
type Lane = { lane: "open" | "guided"; assignments_file: string; clusters_file: string;
  occurrences: number; roots: number; clusters: number; outlier_occurrences?: number };
type OutputManifest = { workspace_id: string; input_manifest_sha256: string; input_identity: Record<string, unknown>;
  status: string; counts: { occurrences: number; roots: number; guides: number }; lanes: Lane[];
  artifacts: Array<{ file: string; sha256: string; bytes: number }> };
type RootReceipt = { root_id: string; root_fingerprint: string; chunk_count: number; open: string[]; guided: string[] };
type MutableRoot = { root_id: string; chunk_count: number; strength_total: number; assignments: Array<{
  ordinal: number; chunk_index: number; start: number; end: number; chunk_sha256: string; strength: number }> };
type MutableGroup = { cluster: Cluster; hash: ReturnType<typeof createHash>; roots: Map<string, MutableRoot>;
  chunk_count: number; representativeOrdinals: Set<number> };

async function* jsonLines(path: string): AsyncGenerator<Record<string, unknown>> {
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line || Buffer.byteLength(line, "utf8") > 64 * 1024) fail("artifact_invalid");
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { fail("artifact_invalid"); }
      yield object(parsed);
    }
  } finally { lines.close(); stream.destroy(); }
}

function parsePopulation(value: Record<string, unknown>): Population {
  const row = { ordinal: natural(value.ordinal), root_id: text(value.root_id, 36),
    root_fingerprint: text(value.root_fingerprint, 256), expected_chunks: natural(value.expected_chunks, 1_000_000),
    chunk_index: natural(value.chunk_index, 1_000_000), start: natural(value.start), end: natural(value.end),
    chunk_sha256: text(value.chunk_sha256, 71) };
  if (!UUID.test(row.root_id) || !DIGEST.test(row.chunk_sha256) || row.end <= row.start || row.expected_chunks < 1) fail("artifact_invalid");
  return row;
}
function parseAssignment(value: Record<string, unknown>): Assignment {
  const base = { ordinal: natural(value.ordinal), root_id: text(value.root_id, 36),
    chunk_index: natural(value.chunk_index, 1_000_000), start: natural(value.start), end: natural(value.end),
    chunk_sha256: text(value.chunk_sha256, 71) };
  if (!UUID.test(base.root_id) || !DIGEST.test(base.chunk_sha256) || base.end <= base.start) fail("artifact_invalid");
  const local = Number(value.local_label), strength = Number(value.strength);
  if (!Number.isSafeInteger(local) || local < -1 || !Number.isFinite(strength) || strength < 0 || strength > 1) fail("artifact_invalid");
  const stable = value.stable_cluster_id === null ? null : text(value.stable_cluster_id, 180);
  if ((local === -1) !== (stable === null)) fail("artifact_invalid");
  return { ...base, local_label: local, stable_cluster_id: stable, strength };
}
const identity = (row: OccurrenceIdentity) => ({ ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index,
  start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 });
const assignmentIdentity = (row: Assignment) => ({ ...identity(row), strength: row.strength });

function parseClusters(value: unknown, lane: Lane): Cluster[] {
  if (!Array.isArray(value) || value.length !== lane.clusters) fail("cluster_census_invalid");
  const rawClusters = value as unknown[];
  const ids = new Set<string>(), labels = new Set<number>();
  return rawClusters.map((raw: unknown) => {
    const row = object(raw), stable = text(row.stable_cluster_id, 180), local = natural(row.local_label), declaredLane = row.lane;
    if (declaredLane !== lane.lane || ids.has(stable) || labels.has(local)
      || row.representative_selection_policy !== "distinct-roots-affiliation-boundary-v1") fail("cluster_census_invalid");
    ids.add(stable); labels.add(local);
    if (!Array.isArray(row.terms) || row.terms.length > 64 || !Array.isArray(row.representatives)) fail("cluster_census_invalid");
    const rawTerms = row.terms as unknown[], rawRepresentatives = row.representatives as unknown[];
    const rootCount = natural(row.root_count), chunkCount = natural(row.chunk_count);
    if (rawRepresentatives.length !== Math.min(10, rootCount)) fail("cluster_census_invalid");
    const representatives = rawRepresentatives.map((rawRep: unknown) => {
      const rep = object(rawRep), strength = Number(rep.strength);
      if (rep.selection_reason !== "high_affiliation" && rep.selection_reason !== "low_affiliation_boundary") fail("cluster_census_invalid");
      const parsed = { ordinal: natural(rep.ordinal), root_id: text(rep.root_id, 36), chunk_index: natural(rep.chunk_index, 1_000_000),
        start: natural(rep.start), end: natural(rep.end), chunk_sha256: text(rep.chunk_sha256, 71) };
      if (!UUID.test(parsed.root_id) || !DIGEST.test(parsed.chunk_sha256) || parsed.end <= parsed.start
        || !Number.isFinite(strength) || strength < 0 || strength > 1) fail("cluster_census_invalid");
      return { ...parsed, strength, selection_reason: rep.selection_reason } as Representative;
    });
    if (new Set(representatives.map(rep => rep.ordinal)).size !== representatives.length
      || representatives.filter(rep => rep.selection_reason === "low_affiliation_boundary").length !== (rootCount > 1 ? 1 : 0))
      fail("cluster_census_invalid");
    const terms = rawTerms.filter((term: unknown): term is string => typeof term === "string" && term.trim().length > 0)
      .map((term: string) => text(term, 200));
    if (new Set(terms).size !== terms.length) fail("cluster_census_invalid");
    return { stable_cluster_id: stable, local_label: local, lane: lane.lane,
      root_count: rootCount, chunk_count: chunkCount, terms,
      representative_selection_policy: "distinct-roots-affiliation-boundary-v1", representatives };
  });
}

async function readRootReceipts(path: string): Promise<Map<string, RootReceipt>> {
  const result = new Map<string, RootReceipt>();
  for await (const raw of jsonLines(path)) {
    const root = text(raw.root_id, 36), open = raw.open, guided = raw.guided;
    if (!UUID.test(root) || result.has(root) || !Array.isArray(open) || !Array.isArray(guided)
      || open.some(item => typeof item !== "string") || guided.some(item => typeof item !== "string")) fail("root_receipt_invalid");
    result.set(root, { root_id: root, root_fingerprint: text(raw.root_fingerprint, 256),
      chunk_count: natural(raw.chunk_count, 1_000_000), open: [...open as string[]], guided: [...guided as string[]] });
  }
  return result;
}

function parseManifest(value: unknown, source: SignalTopicConsolidationSourceV1): OutputManifest {
  const row = object(value), counts = object(row.counts), inputIdentity = object(row.input_identity);
  if (row.contract_version !== "workspace-topic-engine-output-v1" || row.workspace_id !== source.workspace_id
    || row.status !== "completed" || inputIdentity.context_digest !== source.context_digest
    || !Array.isArray(row.lanes) || !Array.isArray(row.artifacts)) fail("manifest_invalid");
  const rawLanes = row.lanes as unknown[], rawArtifacts = row.artifacts as unknown[];
  const lanes: Lane[] = rawLanes.map((raw: unknown) => {
    const lane = object(raw), name = lane.lane;
    if (name !== "open" && name !== "guided") fail("manifest_invalid");
    const assignments = text(lane.assignments_file, 101), clusters = text(lane.clusters_file, 101);
    if (assignments !== `assignments.${name}.jsonl` || clusters !== `clusters.${name}.json`) fail("manifest_invalid");
    return { lane: name as "open" | "guided", assignments_file: assignments, clusters_file: clusters,
      occurrences: natural(lane.occurrences), roots: natural(lane.roots), clusters: natural(lane.clusters, 100_000),
      ...(lane.outlier_occurrences === undefined ? {} : { outlier_occurrences: natural(lane.outlier_occurrences) }) };
  });
  if (!lanes.some(lane => lane.lane === "open") || new Set(lanes.map(lane => lane.lane)).size !== lanes.length) fail("manifest_invalid");
  const artifacts = rawArtifacts.map((raw: unknown) => { const artifact = object(raw), file = text(artifact.file, 101), sha256 = text(artifact.sha256, 71);
    if (!FILE.test(file) || file.includes("..") || !DIGEST.test(sha256)) fail("manifest_invalid");
    return { file, sha256, bytes: natural(artifact.bytes, 2 ** 40) }; });
  if (new Set(artifacts.map(item => item.file)).size !== artifacts.length) fail("manifest_invalid");
  const expected = lanes.reduce((sum, lane) => sum + lane.clusters, 0);
  if (expected !== source.expected_group_count) fail("group_coverage_invalid");
  return { workspace_id: source.workspace_id, input_manifest_sha256: text(row.input_manifest_sha256, 71), input_identity: inputIdentity,
    status: "completed", counts: { occurrences: natural(counts.occurrences), roots: natural(counts.roots), guides: natural(counts.guides) }, lanes, artifacts };
}

async function verifyFile(path: string, artifact: SignalTopicConsolidationStoredArtifactV1) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== artifact.size_bytes || await hashWorkspaceEngineFileV1(path) !== artifact.sha256)
    fail("artifact_receipt_mismatch");
}

export type SignalTopicConsolidationMetadataReaderV1 = (rootIds: readonly string[]) => Promise<SignalTopicConsolidationRootMetadataV1[]>;
export type SignalTopicConsolidationCentroidResolverV1 = (memberships: readonly SignalTopicConsolidationCentroidMembershipV1[],
  configuration: SignalTopicConsolidationConfigurationV1) => Promise<{ artifact_id: string; artifact_sha256: string;
    centroids: SignalTopicConsolidationCentroidV1[] }>;

function buildCommunities(centroids: readonly SignalTopicConsolidationCentroidV1[], configurationDigest: string,
  minSimilarity: number): SignalTopicConsolidationCommunityPlanV1 {
  const parent = new Map(centroids.map(item => [item.group_key,item.group_key]));
  const find = (key: string): string => { const value = parent.get(key) ?? fail("centroid_coverage_invalid");
    if (value === key) return key; const root = find(value); parent.set(key,root); return root; };
  const union = (left: string, right: string) => { const a = find(left), b = find(right);
    if (a !== b) parent.set(compare(a,b) < 0 ? b : a,compare(a,b) < 0 ? a : b); };
  for (const centroid of centroids) for (const neighbor of centroid.neighbors)
    if (neighbor.similarity >= minSimilarity) union(centroid.group_key,neighbor.group_key);
  const components = new Map<string,string[]>();
  for (const key of parent.keys()) { const root = find(key), members = components.get(root) ?? []; members.push(key); components.set(root,members); }
  const byKey = new Map(centroids.map(item => [item.group_key,item]));
  const communities = [...components.values()].map(rawMembers => {
    const members = rawMembers.sort(compare), memberSet = new Set(members);
    const scored = members.map(group_key => { const internal = (byKey.get(group_key)?.neighbors ?? [])
      .filter(item => memberSet.has(item.group_key)).map(item => item.similarity);
      return { group_key, similarity: internal.length ? Math.max(...internal) : 1 }; })
      .sort((a,b) => b.similarity-a.similarity || compare(a.group_key,b.group_key))
      .map((item,rank) => ({ ...item, rank }));
    const community_digest = signalTopicConsolidationDigestV1({ members: scored });
    return { community_key: `community:${community_digest.slice(7,31)}`, community_digest, members: scored };
  }).sort((a,b) => compare(a.community_key,b.community_key));
  return { contract_version: "signal-topic-centroid-community-plan-v1", configuration_digest: configurationDigest, communities };
}

/** Build the exact atomic census from sealed numerical output. The current
 * bundle intentionally exposes no group centroids, so affinities, neighbors
 * and cohesion remain empty/null instead of being inferred from labels. */
export async function buildSignalTopicAtomicCensusFromBundleV1(args: {
  directory: string; source: SignalTopicConsolidationSourceV1; metadata: SignalTopicConsolidationMetadataReaderV1;
  configuration?: SignalTopicConsolidationConfigurationV1; centroids?: SignalTopicConsolidationCentroidResolverV1;
}): Promise<{ census: SignalTopicAtomicCensusV1; community_status: "ready" | "blocked_missing_group_centroids";
  community_plan: SignalTopicConsolidationCommunityPlanV1 | null }> {
  const source = args.source, bundle = new Map(source.bundle.map(item => [item.name, item]));
  const manifestArtifact: SignalTopicConsolidationStoredArtifactV1 = bundle.get("manifest.json") ?? fail("bundle_incomplete");
  await verifyFile(join(args.directory, "manifest.json"), manifestArtifact);
  const manifest = parseManifest(JSON.parse(await readFile(join(args.directory, "manifest.json"), "utf8")), source);
  const required = new Set(["population.jsonl", "roots.jsonl", ...manifest.lanes.flatMap(lane => [lane.assignments_file, lane.clusters_file])]);
  for (const name of required) {
    const declared = manifest.artifacts.find(item => item.file === name), stored = bundle.get(name);
    if (!declared || !stored || declared.sha256 !== stored.sha256 || declared.bytes !== stored.size_bytes) fail("bundle_incomplete");
    await verifyFile(join(args.directory, name), stored as SignalTopicConsolidationStoredArtifactV1);
  }
  // Neither the output manifest nor the explicit bundle contains a per-group
  // centroid artifact. guide-center.npy is one global transform center and is
  // never treated as 1,652 atomic centroids.
  if (manifest.artifacts.some(item => /^centroids\.(open|guided)\.(?:npy|json)$/u.test(item.file)))
    fail("centroid_contract_unsupported");
  const rootReceipts = await readRootReceipts(join(args.directory, "roots.jsonl"));
  if (rootReceipts.size !== manifest.counts.roots) fail("root_receipt_invalid");
  const groups: MutableGroup[] = [];
  for (const lane of manifest.lanes) {
    const clusters = parseClusters(JSON.parse(await readFile(join(args.directory, lane.clusters_file), "utf8")), lane);
    const byStable = new Map(clusters.map(cluster => [cluster.stable_cluster_id, { cluster, hash: createHash("sha256"), roots: new Map(),
      chunk_count: 0, representativeOrdinals: new Set(cluster.representatives.map(rep => rep.ordinal)) } as MutableGroup]));
    const byLabel = new Map(clusters.map(cluster => [cluster.local_label, cluster.stable_cluster_id]));
    const population = jsonLines(join(args.directory, "population.jsonl"));
    let ordinal = 0, roots = 0, lastRoot = "", outliers = 0;
    const populationChunks = new Map<string, number>();
    try {
      for await (const rawAssigned of jsonLines(join(args.directory, lane.assignments_file))) {
        const assigned = parseAssignment(rawAssigned), next = await population.next();
        if (next.done) fail("assignment_coverage_invalid");
        const original = parsePopulation(next.value);
        if (assigned.ordinal !== ordinal || JSON.stringify(identity(assigned)) !== JSON.stringify(identity(original))) fail("assignment_identity_invalid");
        if (original.chunk_index >= original.expected_chunks) fail("assignment_identity_invalid");
        populationChunks.set(original.root_id, (populationChunks.get(original.root_id) ?? 0) + 1);
        if (assigned.root_id !== lastRoot) { if (lastRoot && assigned.root_id <= lastRoot) fail("population_order_invalid"); roots++; lastRoot = assigned.root_id; }
        if (assigned.stable_cluster_id === null) outliers++;
        else {
          if (byLabel.get(assigned.local_label) !== assigned.stable_cluster_id) fail("assignment_cluster_invalid");
          const group = byStable.get(assigned.stable_cluster_id) ?? fail("assignment_cluster_invalid");
          group.hash.update(JSON.stringify(identity(assigned)) + "\n"); group.chunk_count++;
          let root = group.roots.get(assigned.root_id);
          if (!root) { root = { root_id: assigned.root_id, chunk_count: 0, strength_total: 0, assignments: [] }; group.roots.set(assigned.root_id, root); }
          root.chunk_count++; root.strength_total += assigned.strength; root.assignments.push(assignmentIdentity(assigned));
          const representative = group.cluster.representatives.find(rep => rep.ordinal === ordinal);
          if (representative && (JSON.stringify(identity(representative)) !== JSON.stringify(identity(original))
            || representative.strength !== assigned.strength)) fail("representative_identity_invalid");
        }
        ordinal++;
      }
      if (!(await population.next()).done || ordinal !== lane.occurrences || ordinal !== manifest.counts.occurrences
        || roots !== lane.roots || roots !== manifest.counts.roots || lane.outlier_occurrences !== undefined && outliers !== lane.outlier_occurrences)
        fail("assignment_coverage_invalid");
    } finally { await population.return(undefined); }
    for (const [rootId, chunks] of populationChunks) {
      const receipt = rootReceipts.get(rootId) ?? fail("root_receipt_invalid");
      if (receipt.chunk_count !== chunks) fail("root_receipt_invalid");
    }
    for (const group of byStable.values()) {
      if (group.chunk_count !== group.cluster.chunk_count || group.roots.size !== group.cluster.root_count) fail("cluster_census_invalid");
      const received = new Set<number>();
      for (const rep of group.cluster.representatives) {
        const root = group.roots.get(rep.root_id);
        if (!root || !root.assignments.some(item => item.ordinal === rep.ordinal)) fail("representative_identity_invalid");
        received.add(rep.ordinal);
      }
      if (received.size !== group.representativeOrdinals.size) fail("representative_identity_invalid");
      for (const root of group.roots.values()) {
        const receipt = rootReceipts.get(root.root_id) ?? fail("root_receipt_invalid");
        if (receipt.root_fingerprint.length < 1 || !receipt[lane.lane].includes(group.cluster.stable_cluster_id)) fail("root_receipt_invalid");
      }
      groups.push(group);
    }
    const derivedByRoot = new Map<string, string[]>();
    for (const group of byStable.values()) for (const rootId of group.roots.keys()) {
      const values = derivedByRoot.get(rootId) ?? []; values.push(group.cluster.stable_cluster_id); derivedByRoot.set(rootId, values);
    }
    for (const receipt of rootReceipts.values()) {
      const derived = (derivedByRoot.get(receipt.root_id) ?? []).sort(compare);
      const declared = [...receipt[lane.lane]].sort(compare);
      if (JSON.stringify(derived) !== JSON.stringify(declared)) fail("root_receipt_invalid");
    }
  }
  if (groups.length !== source.expected_group_count) fail("group_coverage_invalid");
  const allRootIds = [...new Set(groups.flatMap(group => [...group.roots.keys()]))].sort(compare);
  const metadata = new Map<string, SignalTopicConsolidationRootMetadataV1>();
  for (let offset = 0; offset < allRootIds.length; offset += 2_000) {
    const page = allRootIds.slice(offset, offset + 2_000), rows = await args.metadata(page);
    if (rows.length !== page.length) fail("root_metadata_incomplete");
    for (const row of rows) {
      if (!page.includes(row.root_id) || metadata.has(row.root_id)) fail("root_metadata_incomplete");
      metadata.set(row.root_id, row);
    }
  }
  const configuration = args.configuration ?? { contract_version: "signal-topic-consolidation-config-v1",
    dossier_version: "signal-topic-group-dossier-v1", representative_limit: 10, neighbor_limit: 10,
    community_algorithm: "centroid-knn-v1", neighbor_k: 10, min_similarity_ppm: 720_000,
    assignment_policy: "partition-all-groups-v1" };
  const configurationDigest = signalTopicConsolidationDigestV1(configuration);
  const centroidMemberships = groups.flatMap(group => [...group.roots.values()].flatMap(root => root.assignments.map(item => ({
    group_key: `${group.cluster.lane}:${group.cluster.stable_cluster_id}`, ordinal: item.ordinal, chunk_sha256: item.chunk_sha256 }))));
  const resolved = args.centroids ? await args.centroids(centroidMemberships,configuration) : null;
  if (resolved && (!UUID.test(resolved.artifact_id) || !DIGEST.test(resolved.artifact_sha256)
    || new Set(resolved.centroids.map(item => item.group_key)).size !== resolved.centroids.length
    || resolved.centroids.some(item => item.vector.length !== 1024 || item.vector.some(value => !Number.isFinite(value))
      || signalTopicConsolidationDigestV1(item.vector) !== item.centroid_digest
      || !item.brand_affinity || Object.values(item.brand_affinity).some(values => !Array.isArray(values)
        || values.length > 8 || new Set(values.map(value => value.guide_key)).size !== values.length
        || values.some(value => !value.guide_key || !Number.isFinite(value.score) || value.score < 0 || value.score > 1))
      || new Set(item.neighbors.map(neighbor => neighbor.group_key)).size !== item.neighbors.length
      || item.neighbors.some(neighbor => neighbor.group_key === item.group_key || !Number.isFinite(neighbor.similarity)
        || neighbor.similarity < 0 || neighbor.similarity > 1)))) fail("centroid_contract_invalid");
  const centroidByGroup = new Map(resolved?.centroids.map(item => [item.group_key,item]) ?? []);
  if (resolved && (resolved.centroids.length !== groups.length || groups.some(group => !centroidByGroup.has(`${group.cluster.lane}:${group.cluster.stable_cluster_id}`))))
    fail("centroid_coverage_invalid");
  const count = (values: Array<string | null>) => [...values.reduce((map, value) => {
    if (value !== null) map.set(value, (map.get(value) ?? 0) + 1); return map;
  }, new Map<string, number>())].map(([key, value]) => ({ key, count: value })).sort((a, b) => compare(a.key, b.key));
  const parsedGroups: SignalTopicAtomicGroupV1[] = groups.map(group => {
    const roots = [...group.roots.values()].sort((a, b) => compare(a.root_id, b.root_id)).map(root => ({ root_id: root.root_id,
      chunk_count: root.chunk_count, strength: root.strength_total / root.chunk_count,
      assignment_digest: signalTopicConsolidationDigestV1(root.assignments) }));
    const rootMetadata = roots.map(root => metadata.get(root.root_id) ?? fail("root_metadata_incomplete"));
    const scope_counts = { brand: 0, competitor: 0, category: 0, unknown: 0 };
    for (const item of rootMetadata) scope_counts[item.scope]++;
    const evidence = group.cluster.representatives.map(rep => {
      const meta = metadata.get(rep.root_id) ?? fail("root_metadata_incomplete");
      return { ref_id: signalTopicConsolidationDigestV1({ root_id: rep.root_id, chunk_index: rep.chunk_index, start: rep.start,
          end: rep.end, chunk_sha256: rep.chunk_sha256 }), root_id: rep.root_id, chunk_index: rep.chunk_index,
        start: rep.start, end: rep.end, chunk_sha256: rep.chunk_sha256, locale: meta.locale,
        platform: meta.platform, occurred_at: meta.occurred_at };
    });
    const dossier = { contract_version: "signal-topic-group-dossier-v1" as const, scope_counts,
      locale_counts: count(rootMetadata.map(item => item.locale)), platform_counts: count(rootMetadata.map(item => item.platform)),
      month_counts: count(rootMetadata.map(item => item.occurred_at?.slice(0, 7) ?? null)),
      brand_affinity: centroidByGroup.get(`${group.cluster.lane}:${group.cluster.stable_cluster_id}`)?.brand_affinity
        ?? { positive: [], negative: [], abstention: [] },
      neighbors: (centroidByGroup.get(`${group.cluster.lane}:${group.cluster.stable_cluster_id}`)?.neighbors ?? [])
        .slice(0,configuration.neighbor_limit).sort((a,b) => b.similarity-a.similarity || compare(a.group_key,b.group_key)),
      // Neighbor similarity is an inter-group affinity. It must not be
      // mislabeled as the group's internal cohesion; the current fit does not
      // export the within-group dispersion required for that metric.
      metrics: { cohesion: null, outlier_ratio: null }, evidence };
    const centroid = centroidByGroup.get(`${group.cluster.lane}:${group.cluster.stable_cluster_id}`);
    return { group_key: `${group.cluster.lane}:${group.cluster.stable_cluster_id}`, lane: group.cluster.lane,
      stable_cluster_id: group.cluster.stable_cluster_id, local_label: group.cluster.local_label,
      group_digest: `sha256:${group.hash.digest("hex")}`, root_count: group.cluster.root_count,
      chunk_count: group.cluster.chunk_count, terms: group.cluster.terms, dossier,
      dossier_digest: signalTopicConsolidationDigestV1(dossier), centroid: centroid && resolved ? { artifact_id: resolved.artifact_id,
        artifact_sha256: resolved.artifact_sha256, centroid_key: centroid.group_key, centroid_digest: centroid.centroid_digest } : null, roots };
  });
  const census = parseSignalTopicAtomicCensusV1({ contract_version: "signal-topic-consolidation-v1",
    workspace_id: source.workspace_id, source_execution_id: source.source_execution_id,
    source_checkpoint_digest: source.source_checkpoint_digest, output_artifact_id: source.output_artifact_id,
    output_artifact_sha256: source.output_artifact_sha256, model_artifact_id: source.model_artifact_id,
    model_artifact_sha256: source.model_artifact_sha256, centroid_artifact_id: resolved?.artifact_id ?? null,
    centroid_artifact_sha256: resolved?.artifact_sha256 ?? null,
    context_digest: source.context_digest,
    configuration, configuration_digest: configurationDigest,
    expected_group_count: source.expected_group_count, groups: parsedGroups });
  const communityPlan = resolved ? buildCommunities(resolved.centroids,configurationDigest,configuration.min_similarity_ppm / 1_000_000) : null;
  return { census, community_status: resolved ? "ready" : "blocked_missing_group_centroids", community_plan: communityPlan };
}

type Database = Parameters<typeof materializeSignalTopicAtomicCensusV1>[0]["database"] & Parameters<typeof loadSignalTopicConsolidationSourceV1>[0]["queryable"];
const defaultStores = {
  source: async (database: Database, executionId: string, control?: {
    execution_id: string; execution_token: string; workspace_id: string; actor_user_id: string;
  }) => loadSignalTopicConsolidationSourceV1({ queryable: database, source_execution_id: executionId,
    control_execution: control }),
  metadata: async (database: Database, workspaceId: string, roots: readonly string[]) =>
    loadSignalTopicConsolidationRootMetadataV1({ queryable: database, workspace_id: workspaceId, root_ids: roots }),
  materialize: materializeSignalTopicAtomicCensusV1,
  centroids: computeSignalTopicConsolidationCentroidsV1,
  persistCentroids: persistSignalTopicConsolidationCentroidArtifactV1,
  communities: materializeSignalTopicCommunityPlanV1,
};
type Stores = typeof defaultStores;

/** Provider-free worker seam. Queue scheduling remains intentionally separate.
 * It derives exact group centroids from the sealed fit memberships and the
 * existing workspace embedding cache, then seals the derived artifact before
 * materializing the census and communities. */
export async function signalTopicConsolidationJobV1(
  job: Pick<Job<{ source_execution_id: string }>, "id" | "data" | "updateProgress">,
  options: { database?: Database; stores?: Stores; storage?: WorkspaceEngineStorageV1; storage_root?: string;
    control_execution?: { execution_id: string; execution_token: string; workspace_id: string; actor_user_id: string } } = {},
) {
  if (!job.id || !UUID.test(job.data?.source_execution_id ?? "")) fail("job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const stores = options.stores ?? defaultStores;
  const source = await atStage("source", () => stores.source(database, job.data.source_execution_id, options.control_execution));
  if (source.expected_group_count > 5_000) fail("exact_knn_capacity_exceeded");
  const storage = options.storage ?? createWorkspaceEngineStorageV1();
  const root = resolve(options.storage_root ?? process.env.NOISIA_WORKSPACE_ENGINE_SCRATCH_ROOT ?? join(tmpdir(), "noisia-workspace-engine"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, `topic-consolidation-${source.source_execution_id}-`));
  try {
    const manifest = source.bundle.find(item => item.name === "manifest.json") ?? fail("bundle_incomplete");
    await atStage("manifest_download", () => storage.get({ workspace_id: source.workspace_id,
      execution_id: source.source_execution_id, stored: manifest, destination: join(directory, manifest.name) }));
    await verifyFile(join(directory, manifest.name), manifest);
    const parsed = parseManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")), source);
    const names = new Set(["population.jsonl", "roots.jsonl", ...parsed.lanes.flatMap(lane => [lane.assignments_file, lane.clusters_file])]);
    let completed = 0;
    for (const name of [...names].sort(compare)) {
      const artifact = source.bundle.find(item => item.name === name) ?? fail("bundle_incomplete");
      await atStage("bundle_download", () => storage.get({ workspace_id: source.workspace_id,
        execution_id: source.source_execution_id, stored: artifact, destination: join(directory, artifact.name) }));
      await verifyFile(join(directory, artifact.name), artifact);
      completed++;
      await job.updateProgress({ phase: "reading_sealed_bundle", completed, total: names.size }).catch(() => undefined);
    }
    const built = await atStage("census_build", () => buildSignalTopicAtomicCensusFromBundleV1({ directory, source,
      metadata: roots => stores.metadata(database, source.workspace_id, roots),
      centroids: async (memberships,configuration) => {
        const centroids = await atStage("centroids", () => stores.centroids({ database, workspace_id: source.workspace_id,
          actor_user_id: source.actor_user_id, source_execution_id: source.source_execution_id,
          embedding_run_id: source.embedding_run_id, embedding_config_digest: source.embedding_config_digest,
          memberships, neighbor_k: configuration.neighbor_k, control_execution: options.control_execution }));
        const centroidSetDigest = signalTopicConsolidationDigestV1(centroids.map(item => ({ group_key: item.group_key,
          centroid_digest: item.centroid_digest })));
        const filename = `centroids.consolidation.${centroidSetDigest.slice(7,23)}.json`;
        const artifactCentroids = centroids.map(item => ({ group_key: item.group_key, vector: item.vector,
          centroid_digest: item.centroid_digest }));
        const body = stableSignalTopicConsolidationJsonV1({ contract_version: "signal-topic-centroid-artifact-v1",
          source_execution_id: source.source_execution_id, source_checkpoint_digest: source.source_checkpoint_digest,
          embedding_run_id: source.embedding_run_id, embedding_config_digest: source.embedding_config_digest,
          dimensions: 1024, aggregation: "normalized-mean-document-embeddings-v1", centroids: artifactCentroids });
        const file = join(directory,filename); await writeFile(file,body,{ flag: "wx", mode: 0o600 });
        const artifactSha = digest(body);
        const stored = await atStage("centroid_upload", () => storage.put({ workspace_id: source.workspace_id,
          execution_id: source.source_execution_id, file, sha256: artifactSha,
          size_bytes: Buffer.byteLength(body), media_type: "application/json" }));
        const persisted = await atStage("centroid_persist", () => stores.persistCentroids({ database, workspace_id: source.workspace_id,
          actor_user_id: source.actor_user_id, source_execution_id: source.source_execution_id,
          source_checkpoint_digest: source.source_checkpoint_digest, artifact: { name: filename,...stored },
          centroid_count: centroids.length, centroid_set_digest: centroidSetDigest,
          control_execution: options.control_execution }));
        return { artifact_id: persisted.artifact_id, artifact_sha256: artifactSha, centroids };
      } }));
    const materialized = await atStage("census_materialize", () => stores.materialize({ database,
      actor_user_id: source.actor_user_id, census: built.census, control_execution: options.control_execution }));
    const communities = built.community_plan ? await atStage("community_materialize", () => stores.communities({ database, workspace_id: source.workspace_id,
      actor_user_id: source.actor_user_id, source_execution_id: source.source_execution_id,
      consolidation_run_id: materialized.consolidation_run_id, plan: built.community_plan,
      control_execution: options.control_execution })) : null;
    await job.updateProgress({ phase: "census_ready", groups: built.census.groups.length,
      expected_groups: source.expected_group_count }).catch(() => undefined);
    return { source_execution_id: source.source_execution_id, ...materialized, communities,
      community_status: built.community_status, centroid_source: "exact_cached_chunk_embeddings_normalized_mean_v1" as const };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
