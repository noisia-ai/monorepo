import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  SIGNAL_WORKSPACE_INCREMENTAL_INPUT_V1, SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1,
  SIGNAL_WORKSPACE_INCREMENTAL_MODEL_BANK_MAX_BYTES_V1,
  SIGNAL_WORKSPACE_ENGINE_CONFIG_V1,
  parseSignalWorkspaceIncrementalInputV1, parseSignalWorkspaceIncrementalOutputV1,
  signalWorkspaceIncrementalRootSchemaV1, signalWorkspaceIncrementalMembershipSchemaV1,
  signalWorkspaceIncrementalDigestV1 as digest, signalWorkspaceIncrementalMembershipDigestV1,
  buildSignalWorkspaceIncrementalRootDeltaV1,
  type SignalWorkspaceIncrementalRootV1 as Root, type SignalWorkspaceIncrementalInputV1 as Input,
  type SignalWorkspaceEngineInputManifestV1,
} from "@noisia/query-engine";
import { assertWorkspaceEngineDirectoryV1, hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u), uuid = z.string().uuid().refine(v => v === v.toLowerCase());
const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const refSchema = z.object({ file: z.string().regex(/^[a-z][a-z0-9_.-]{0,100}$/u).refine(v => !v.includes("..")),
  sha256: hash, bytes: natural, rows: natural.optional() }).strict();
export type WorkspaceIncrementalFileRefV1 = z.infer<typeof refSchema>;
/** These are server-derived references, not an authorization mechanism. The DB
 * caller still owns parent selection, model retention, rights and registry checks. */
export type WorkspaceIncrementalNumericDescriptorV1 = {
  contract_version: "workspace-incremental-numeric-descriptor-v1";
  policy_version: typeof SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1;
  parent: { execution_id: string; output_artifact_id: string; manifest_sha256: string;
    manifest_contract: "workspace-topic-engine-output-v1" | "workspace-topic-incremental-output-v1" };
  compatibility: Input["compatibility"]; discovery: { close_requested: boolean };
};
export type WorkspaceIncrementalParentFilesV1 = { directory: string;
  files: AsyncIterable<ReadonlyArray<WorkspaceIncrementalFileRefV1>> };
type Output = ReturnType<typeof parseSignalWorkspaceIncrementalOutputV1>;
type Component = Output["components"][number];
type Member = z.infer<typeof signalWorkspaceIncrementalMembershipSchemaV1>;
const populationSchema = z.object({ ordinal: natural, root_id: uuid, root_fingerprint: hash, asset_sha256: hash,
  expected_chunks: natural.refine(v => v > 0), chunk_index: natural, start: natural, end: natural, chunk_sha256: hash }).strict()
  .refine(v => v.end > v.start && v.end - v.start <= 1400);
type Population = z.infer<typeof populationSchema>;
type Json = Record<string, unknown>;
function fail(code: string): never { throw new Error(`workspace_engine_incremental_${code}`); }
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("shape_invalid");
  return value as Json;
}
function canonical(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered((v as Json)[k])])) : v;
  return JSON.stringify(ordered(value));
}
function arrayDigest(prefix = "[", suffix = "]") {
  const h = createHash("sha256"); h.update(prefix); let count = 0;
  return { add(value: unknown) { if (count++) h.update(","); h.update(canonical(value)); },
    finish() { h.update(suffix); return `sha256:${h.digest("hex")}`; } };
}
async function checked(directory: string, raw: unknown, manifest = false) {
  const ref = refSchema.parse(raw);
  if (!manifest && ref.file === "manifest.json") fail("artifact_invalid");
  const path = join(directory, ref.file), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== ref.bytes
    || await hashWorkspaceEngineFileV1(path) !== ref.sha256) fail("artifact_invalid");
  return path;
}
async function json(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) fail("json_capacity_exceeded");
  return parseJson(await readFile(path));
}
function parseJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("json_invalid"); }
}
/** Strict UTF8/JSONL and bounded line buffering. Missing newline and blank rows
 * are not silently discarded. No model bytes are interpreted here. */
async function* lines(path: string): AsyncGenerator<unknown> {
  let buffer = Buffer.alloc(0);
  for await (const raw of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    buffer = Buffer.concat([buffer, raw as Buffer]);
    let index: number;
    while ((index = buffer.indexOf(10)) !== -1) {
      if (!index || index > MAX_JSON_BYTES) fail("jsonl_invalid");
      yield parseJson(buffer.subarray(0, index));
      buffer = buffer.subarray(index + 1);
    }
    if (buffer.length > MAX_JSON_BYTES) fail("json_capacity_exceeded");
  }
  if (buffer.length) fail("jsonl_incomplete");
}
function cursor<T>(iterable: AsyncIterable<T>) {
  const iterator = iterable[Symbol.asyncIterator](); let loaded = false, value: IteratorResult<T>;
  return { async peek(): Promise<T | null> { if (!loaded) { value = await iterator.next(); loaded = true; } return value.done ? null : value.value; },
    async take(): Promise<T | null> { if (!loaded) value = await iterator.next(); loaded = false; return value.done ? null : value.value; },
    async close() { await iterator.return?.(); } };
}
async function* rootRows(path: string) {
  let previous = "";
  for await (const raw of lines(path)) {
    const root = signalWorkspaceIncrementalRootSchemaV1.parse(raw);
    if (root.root_id <= previous) fail("root_order_invalid"); previous = root.root_id; yield root;
  }
}
async function* populationRows(path: string, text = false) {
  let ordinal = 0, prior: Population | null = null, coverage = createHash("sha256"), asset = createHash("sha256");
  const close = () => {
    if (prior && prior.chunk_index + 1 !== prior.expected_chunks) fail("population_incomplete");
    if (text && prior && `sha256:${asset.digest("hex")}` !== prior.asset_sha256) fail("asset_hash_invalid");
  };
  for await (const raw of lines(path)) {
    const value = object(raw), { text: body, ...rest } = value;
    const row = populationSchema.parse(text ? rest : value);
    if (row.ordinal !== ordinal++) fail("population_order_invalid");
    if (!prior || row.root_id !== prior.root_id) {
      close(); if (prior && row.root_id <= prior.root_id) fail("population_order_invalid");
      if (row.chunk_index !== 0 || row.start !== 0) fail("chunk_coverage_invalid");
      coverage = createHash("sha256"); asset = createHash("sha256");
    } else if (row.chunk_index !== prior.chunk_index + 1 || row.start !== prior.end
      || row.root_fingerprint !== prior.root_fingerprint || row.asset_sha256 !== prior.asset_sha256
      || row.expected_chunks !== prior.expected_chunks) fail("chunk_coverage_invalid");
    if (text) {
      if (typeof body !== "string" || body.length !== row.end - row.start || sha(body) !== row.chunk_sha256) fail("chunk_hash_invalid");
      asset.update(body);
    }
    coverage.update(JSON.stringify([row.chunk_index, row.start, row.end, row.chunk_sha256]) + "\n"); prior = row;
    yield { row, root_coverage: row.chunk_index + 1 === row.expected_chunks ? `sha256:${coverage.digest("hex")}` : null };
  }
  close();
}
async function checkNpy(path: string, rows: number) {
  const file = await open(path, "r");
  try {
    const prefix = Buffer.alloc(10); if ((await file.read(prefix, 0, 10, 0)).bytesRead !== 10
      || !prefix.subarray(0, 8).equals(Buffer.from([147, 78, 85, 77, 80, 89, 1, 0]))) fail("vector_shape_invalid");
    const size = prefix.readUInt16LE(8), header = Buffer.alloc(size);
    if ((await file.read(header, 0, size, 10)).bytesRead !== size
      || !/^\{'descr': '<f4', 'fortran_order': False, 'shape': \(\d+, 1024\), \} *\n$/u.test(header.toString("ascii"))
      || Number(header.toString("ascii").match(/'shape': \((\d+),/u)?.[1]) !== rows
      || (await file.stat()).size !== 10 + size + rows * 4096) fail("vector_shape_invalid");
    const buffer = Buffer.alloc(128 * 4096); let offset = 10 + size, seen = 0;
    while (seen < rows) {
      const bytes = Math.min(128, rows - seen) * 4096;
      if ((await file.read(buffer, 0, bytes, offset)).bytesRead !== bytes) fail("vector_shape_invalid");
      for (let i = 0; i < bytes; i += 4096) {
        let nonzero = false;
        for (let j = i; j < i + 4096; j += 4) { const n = buffer.readFloatLE(j); if (!Number.isFinite(n)) fail("vector_value_invalid"); nonzero ||= n !== 0; }
        if (!nonzero) fail("vector_value_invalid");
      }
      offset += bytes; seen += bytes / 4096;
    }
  } finally { await file.close(); }
}
function rootOf(row: Population, coverage: string, correction_digest: string): Root {
  return { root_id: row.root_id, root_fingerprint: row.root_fingerprint, asset_sha256: row.asset_sha256,
    expected_chunks: row.expected_chunks, chunk_coverage_digest: coverage, correction_digest };
}
async function checkCurrent(directory: string, ref: WorkspaceIncrementalFileRefV1, compatibility: Input["compatibility"], rootsFile: string) {
  if (ref.file !== "manifest.json") fail("input_identity_invalid");
  const raw = object(await json(await checked(directory, ref, true))), input = raw as unknown as SignalWorkspaceEngineInputManifestV1;
  if (input.contract_version !== "workspace-topic-engine-input-v1" || !uuid.safeParse(input.workspace_id).success
    || !same(input.config, SIGNAL_WORKSPACE_ENGINE_CONFIG_V1) || digest(input.config) !== compatibility.fit_config_digest
    || input.embedding_config_digest !== compatibility.embedding_config_digest || input.context_digest !== compatibility.context_digest
    || input.catalog_digest !== compatibility.input_interest_catalog_digest || input.chunk_policy_version !== compatibility.chunk_policy_version
    || input.records?.file !== "chunks.jsonl" || input.vectors?.file !== "vectors.npy" || input.guides?.file !== "guides.jsonl"
    || input.guide_vectors?.file !== "guide-vectors.npy") fail("input_identity_invalid");
  for (const value of [input.records, input.vectors, input.guides, input.guide_vectors]) {
    natural.parse(value.rows); hash.parse(value.sha256);
    const info = await lstat(join(directory, value.file)); await checked(directory, { ...{ file: value.file, sha256: value.sha256 }, bytes: info.size });
  }
  const roots = cursor(rootRows(rootsFile)); let count = 0, rootCount = 0;
  try {
    for await (const { row, root_coverage } of populationRows(join(directory, "chunks.jsonl"), true)) {
      count++; if (root_coverage) {
        const root = await roots.take();
        if (!root || !same(rootOf(row, root_coverage, root.correction_digest), root)) fail("root_coverage_invalid"); rootCount++;
      }
    }
    if (await roots.peek() || count !== input.records.rows || rootCount !== input.records.roots
      || count !== input.vectors.rows || input.guides.rows !== input.guide_vectors.rows
      || input.vectors.dimensions !== 1024 || input.guide_vectors.dimensions !== 1024
      || input.vectors.dtype !== "float32" || input.guide_vectors.dtype !== "float32") fail("population_incomplete");
  } finally { await roots.close(); }
  const guideHash = arrayDigest('{"rows":[', `],"vectors":${JSON.stringify(input.guide_vectors.sha256)}}`);
  const seen = new Set<string>(); let countGuides = 0, guideBytes = 0;
  for await (const raw of lines(join(directory, "guides.jsonl"))) {
    const row = z.object({ ordinal: natural, guide_key: z.string().min(1).max(200), input_digest: hash,
      role: z.enum(["topic_positive", "topic_negative", "scope_positive", "scope_negative"]) }).strict().parse(raw);
    const key = JSON.stringify([row.guide_key, row.role, row.input_digest]);
    if (row.ordinal !== countGuides++ || seen.has(key)) fail("guide_invalid");
    guideBytes += Buffer.byteLength(key); if (guideBytes > MAX_JSON_BYTES) fail("json_capacity_exceeded");
    seen.add(key); guideHash.add(row);
  }
  if (countGuides !== input.guides.rows || guideHash.finish() !== compatibility.guides_digest) fail("guide_invalid");
  await checkNpy(join(directory, "vectors.npy"), count); await checkNpy(join(directory, "guide-vectors.npy"), countGuides);
  return input;
}

type Parent = { directory: string; execution_id: string; manifest_sha256: string; raw: Json;
  native: Output | null; refs: Map<string, WorkspaceIncrementalFileRefV1>; components: Component[];
  population_digest: string; roots: () => AsyncGenerator<Root>; members: () => AsyncGenerator<Member> };
async function openParent(storageRoot: string, source: WorkspaceIncrementalParentFilesV1, descriptor: WorkspaceIncrementalNumericDescriptorV1): Promise<Parent> {
  const directory = await assertWorkspaceEngineDirectoryV1(source.directory, storageRoot), refs = new Map<string, WorkspaceIncrementalFileRefV1>();
  let bytes = 0;
  for await (const page of source.files) {
    if (!page.length || page.length > 128) fail("artifact_page_invalid");
    for (const value of page) { const ref = refSchema.parse(value); bytes += Buffer.byteLength(JSON.stringify(ref));
      if (refs.has(ref.file) || bytes > MAX_JSON_BYTES) fail("artifact_invalid");
      await checked(directory, ref, ref.file === "manifest.json"); refs.set(ref.file, ref); }
  }
  const manifestRef = refs.get("manifest.json");
  if (!manifestRef || manifestRef.sha256 !== descriptor.parent.manifest_sha256) fail("previous_manifest_hash_mismatch");
  const raw = object(await json(join(directory, "manifest.json")));
  if (raw.contract_version !== descriptor.parent.manifest_contract) fail("previous_contract_invalid");
  const native = raw.contract_version === "workspace-topic-incremental-output-v1" ? parseSignalWorkspaceIncrementalOutputV1(raw) : null;
  if (native && native.execution_id !== descriptor.parent.execution_id) fail("previous_execution_invalid");
  if (!Array.isArray(raw.artifacts) || refs.size !== raw.artifacts.length + 1) fail("previous_artifact_missing");
  const names = new Set<string>();
  for (const value of raw.artifacts) { const ref = refSchema.parse(value); if (names.has(ref.file) || ref.file === "manifest.json"
    || !same(ref, refs.get(ref.file))) fail("previous_artifact_missing"); names.add(ref.file); }
  for (const key of ["population.jsonl", "roots.jsonl", "guides.jsonl", "guide-vectors.npy"]) if (!refs.has(key)) fail("previous_artifact_missing");
  const guideRows: unknown[] = []; let guideBytes = 0;
  for await (const row of lines(join(directory, "guides.jsonl"))) { guideBytes += Buffer.byteLength(canonical(row));
    if (guideBytes > MAX_JSON_BYTES) fail("json_capacity_exceeded"); guideRows.push(row); }
  const compatibility = native?.compatibility ?? { embedding_config_digest: object(raw.input_identity).embedding_config_digest,
    chunk_policy_version: object(raw.input_identity).chunk_policy_version, context_digest: object(raw.input_identity).context_digest,
    input_interest_catalog_digest: object(raw.input_identity).catalog_digest, fit_config_digest: digest(raw.config),
    guides_digest: digest({ rows: guideRows, vectors: refs.get("guide-vectors.npy")!.sha256 }), runtime_digest: digest(raw.versions) };
  if (!same(compatibility, descriptor.compatibility)) fail("rebuild_required");
  const populationHash = arrayDigest(); let occurrences = 0;
  for await (const { row } of populationRows(join(directory, "population.jsonl"))) { populationHash.add(row); occurrences++; }
  const population_digest = populationHash.finish();
  if (native && native.population_digest !== population_digest || object(raw.counts).occurrences !== occurrences) fail("previous_population_invalid");
  let components: Component[];
  if (native) { components = native.components;
    if (!same(await json(join(directory, "model-components.json")), components)) fail("previous_component_invalid");
  } else {
    if (!["completed", "insufficient_population"].includes(String(raw.status)) || raw.quality !== "uncalibrated" || raw.approval_policy !== "none"
      || !Array.isArray(raw.lanes)) fail("previous_contract_invalid");
    components = [];
    for (const value of raw.lanes as unknown[]) {
      const lane = object(value); if (lane.model_file === null) continue;
      if (!["open", "guided"].includes(String(lane.lane)) || components.some(c => c.lane === lane.lane)) fail("previous_component_invalid");
      for (const field of ["model_file", "clusters_file", "assignments_file"]) {
        if (typeof lane[field] !== "string" || !refs.has(lane[field] as string) || lane[field] === "manifest.json") fail("previous_artifact_missing");
      }
      const model = refs.get(String(lane.model_file)), center = lane.lane === "guided" ? refs.get("guide-center.npy") : null;
      if (!model || lane.lane === "guided" && !center) fail("previous_artifact_missing");
      const clusters = await json(join(directory, String(lane.clusters_file)));
      if (!Array.isArray(clusters)) fail("previous_component_invalid");
      const labels = new Map<number, ReturnType<typeof arrayDigest>>();
      for (const value of clusters) { const cluster = object(value); const label = natural.parse(cluster.local_label);
        uuid.parse(cluster.stable_cluster_id); if (labels.has(label)) fail("previous_component_invalid"); labels.set(label, arrayDigest()); }
      for await (const value of lines(join(directory, String(lane.assignments_file)))) {
        const row = object(value); if (row.local_label === -1) continue;
        const h = labels.get(Number(row.local_label)); if (!h) fail("previous_component_invalid"); h.add(occurrence(row));
      }
      components.push({ lane: lane.lane as "open" | "guided", component_key: digest([descriptor.parent.execution_id, model.sha256, lane.lane]),
        model_origin: { execution_id: descriptor.parent.execution_id, model_artifact_sha256: model.sha256 }, model, center: center ?? null,
        units: clusters.map(value => { const row = object(value); return { local_label: Number(row.local_label),
          unit_key: `${lane.lane}:${row.stable_cluster_id}`, birth_membership_digest: labels.get(Number(row.local_label))!.finish() }; }) });
    }
  }
  const parent: Parent = { directory, execution_id: descriptor.parent.execution_id, manifest_sha256: manifestRef.sha256, raw, native, refs,
    components, population_digest, roots: () => parentRoots(parent), members: () => parentMembers(parent) };
  let rootCount = 0; for await (const row of parent.roots()) { void row; rootCount++; }
  if (rootCount !== object(raw.counts).roots) fail("previous_population_invalid");
  const bank = new Map(components.flatMap(c => [c.model, ...(c.center ? [c.center] : [])]).map(ref => [ref.file, ref]));
  if ([...bank.values()].reduce((sum, ref) => sum + ref.bytes, 0) > SIGNAL_WORKSPACE_INCREMENTAL_MODEL_BANK_MAX_BYTES_V1)
    fail("model_bank_capacity_exceeded");
  await checkParentPending(parent);
  return parent;
}
function occurrence(row: Json | Population) { return { ordinal: row.ordinal, root_id: row.root_id, chunk_index: row.chunk_index,
  start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 }; }
async function* parentRoots(parent: Parent): AsyncGenerator<Root> {
  const rootFile = cursor(lines(join(parent.directory, "roots.jsonl")));
  try {
    for await (const { row, root_coverage } of populationRows(join(parent.directory, "population.jsonl"))) if (root_coverage) {
      const raw = object(await rootFile.take());
      const root = rootOf(row, root_coverage, parent.native ? hash.parse(raw.correction_digest) : sha(""));
      if (parent.native) {
        const metadata = { ...raw }; delete metadata.unit_keys; delete metadata.state; delete metadata.discovery_pending;
        if (!same(signalWorkspaceIncrementalRootSchemaV1.parse(metadata), root)) fail("previous_root_coverage_invalid");
      } else if (raw.root_id !== root.root_id || raw.root_fingerprint !== root.root_fingerprint || raw.chunk_count !== root.expected_chunks)
        fail("previous_root_coverage_invalid");
      yield root;
    }
    if (await rootFile.peek()) fail("previous_root_coverage_invalid");
  } finally { await rootFile.close(); }
}
async function* parentMembers(parent: Parent): AsyncGenerator<Member> {
  if (parent.native) { let prior = "", count = 0;
    const population = cursor(populationRows(join(parent.directory, "population.jsonl")));
    const models = new Map(parent.components.map(c => [c.component_key, c]));
    try {
      for await (const raw of lines(join(parent.directory, "memberships.jsonl"))) {
        const row = signalWorkspaceIncrementalMembershipSchemaV1.parse(raw), key = memberKey(row);
        if (key <= prior) fail("previous_membership_invalid"); prior = key;
        while (await population.peek() && occurrenceKey((await population.peek())!.row) < occurrenceKey(row)) await population.take();
        const record = (await population.peek())?.row, model = models.get(row.model_component_key);
        if (!record || !model || row.root_id !== record.root_id || row.chunk_index !== record.chunk_index
          || row.root_fingerprint !== record.root_fingerprint || row.start !== record.start || row.end !== record.end
          || row.chunk_sha256 !== record.chunk_sha256 || !same(row.model_origin, model.model_origin) || row.lane !== model.lane
          || !model.units.some(unit => unit.unit_key === row.unit_key)) fail("previous_membership_invalid");
        count++; yield row;
      }
      if (count !== parent.native.counts.memberships) fail("previous_membership_invalid");
    } finally { await population.close(); }
    return;
  }
  const lanes = (parent.raw.lanes as Json[]).filter(lane => lane.model_file !== null).map(lane => ({ lane,
    stream: cursor(lines(join(parent.directory, String(lane.assignments_file)))), component: parent.components.find(c => c.lane === lane.lane)! }));
  try {
    for await (const { row } of populationRows(join(parent.directory, "population.jsonl"))) {
      const members: Member[] = [];
      for (const { stream, component } of lanes) {
        const assignment = object(await stream.take()); if (!same(occurrence(assignment), occurrence(row))) fail("previous_population_invalid");
        if (assignment.local_label === -1) continue;
        const unit = component.units.find(unit => unit.local_label === assignment.local_label);
        if (!unit || unit.unit_key !== `${component.lane}:${assignment.stable_cluster_id}`) fail("previous_membership_invalid");
        members.push(signalWorkspaceIncrementalMembershipSchemaV1.parse({ root_id: row.root_id, root_fingerprint: row.root_fingerprint,
          chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256, lane: component.lane,
          unit_key: unit.unit_key, model_component_key: component.component_key, strength: assignment.strength,
          model_origin: component.model_origin, evaluation_origin: { execution_id: parent.execution_id, input_population_digest: parent.population_digest,
            evaluation_key: digest([parent.execution_id, component.component_key, parent.population_digest, "fitted_member"]), basis: "fitted_member" }, carried_from: null }));
      }
      members.sort((a, b) => a.model_component_key < b.model_component_key ? -1 : 1); yield* members;
    }
    for (const lane of lanes) if (await lane.stream.peek()) fail("previous_population_invalid");
  } finally { for (const lane of lanes) await lane.stream.close(); }
}
const occurrenceKey = (row: { root_id: string; chunk_index: number }) => `${row.root_id}:${String(row.chunk_index).padStart(16, "0")}`;
const memberKey = (row: Member) => `${occurrenceKey(row)}:${row.model_component_key}`;
async function* pendingRoots(parent: Parent) {
  if (!parent.native) { if (!parent.components.length) for await (const root of parent.roots()) yield root.root_id; return; }
  let last = "";
  for await (const raw of lines(join(parent.directory, "pending-cohort.jsonl"))) {
    const row = populationSchema.parse(raw); if (row.root_id !== last) { if (row.root_id <= last) fail("previous_pending_invalid");
      last = row.root_id; yield last; }
  }
}
async function checkParentPending(parent: Parent) {
  if (!parent.native) return;
  const pending = cursor(lines(join(parent.directory, "pending-cohort.jsonl"))); let count = 0, pendingRoot = "";
  try {
    for await (const { row } of populationRows(join(parent.directory, "population.jsonl"))) {
      const next = await pending.peek();
      if (next && object(next).root_id === row.root_id || row.root_id === pendingRoot) {
        if (!next || !same(row, next)) fail("previous_pending_invalid");
        if (row.chunk_index === 0) pendingRoot = row.root_id;
        await pending.take(); count++;
      }
    }
    if (await pending.peek() || count !== parent.native.counts.pending_occurrences) fail("previous_pending_invalid");
  } finally { await pending.close(); }
}

async function* transitions(parent: Parent, rootsFile: string) {
  const before = cursor(parent.roots()), after = cursor(rootRows(rootsFile));
  try {
    for (;;) {
      const a = await before.peek(), b = await after.peek(); if (!a && !b) break;
      if (!b || a && a.root_id < b.root_id) { yield buildSignalWorkspaceIncrementalRootDeltaV1([a!], [])[0]!; await before.take(); }
      else if (!a || b.root_id < a.root_id) { yield buildSignalWorkspaceIncrementalRootDeltaV1([], [b])[0]!; await after.take(); }
      else { yield buildSignalWorkspaceIncrementalRootDeltaV1([a], [b])[0]!; await before.take(); await after.take(); }
    }
  } finally { await before.close(); await after.close(); }
}
async function* walkCurrent(parent: Parent, directory: string, rootsFile: string) {
  const changes = cursor(transitions(parent, rootsFile)), pending = cursor(pendingRoots(parent));
  try {
    for await (const { row } of populationRows(join(directory, "chunks.jsonl"), true)) {
      while (await changes.peek() && (await changes.peek())!.root_id < row.root_id) await changes.take();
      const change = await changes.peek(); if (!change || change.root_id !== row.root_id || !change.current) fail("root_coverage_invalid");
      while (await pending.peek() !== null && (await pending.peek())! < row.root_id) await pending.take();
      const isDelta = change.transition === "added" || change.transition === "content_changed";
      yield { row, root: change.current, change, isDelta, cohort: isDelta || await pending.peek() === row.root_id };
    }
  } finally { await changes.close(); await pending.close(); }
}
async function analyze(parent: Parent, directory: string, rootsFile: string) {
  const counts = { added_roots: 0, content_changed_roots: 0, metadata_changed_roots: 0, unchanged_roots: 0,
    removed_roots: 0, roots: 0, occurrences: 0, delta_occurrences: 0, cohort_occurrences: 0 };
  for await (const change of transitions(parent, rootsFile)) {
    if (change.transition === "removed_or_ineligible") counts.removed_roots++;
    else { counts.roots++; counts[`${change.transition}_roots`]++; }
  }
  const population = arrayDigest(), cohort = arrayDigest();
  const cohortKey = arrayDigest(`{"policy_version":${JSON.stringify(SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1)},"population":[`, "]}");
  for await (const { row, isDelta, cohort: included } of walkCurrent(parent, directory, rootsFile)) {
    population.add(row); counts.occurrences++; if (isDelta) counts.delta_occurrences++;
    if (included) { cohort.add(row); cohortKey.add(row); counts.cohort_occurrences++; }
  }
  return { counts, population_digest: population.finish(), cohort_digest: cohort.finish(), cohort_key: cohortKey.finish() };
}
function descriptorCheck(descriptor: WorkspaceIncrementalNumericDescriptorV1) {
  if (descriptor.contract_version !== "workspace-incremental-numeric-descriptor-v1"
    || descriptor.policy_version !== SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1 || typeof descriptor.discovery.close_requested !== "boolean") fail("descriptor_invalid");
  uuid.parse(descriptor.parent.execution_id); uuid.parse(descriptor.parent.output_artifact_id); hash.parse(descriptor.parent.manifest_sha256);
}
async function reference(path: string, file: string, rows?: number): Promise<WorkspaceIncrementalFileRefV1> {
  return { file, sha256: await hashWorkspaceEngineFileV1(path), bytes: (await lstat(path)).size, ...(rows === undefined ? {} : { rows }) };
}
async function publish(path: string, temporary: string) {
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== (await lstat(temporary)).size
      || await hashWorkspaceEngineFileV1(path) !== await hashWorkspaceEngineFileV1(temporary)) fail("input_replay_mismatch");
  }
  await unlink(temporary);
}
export async function prepareSignalWorkspaceIncrementalInputFilesV1(args: {
  storage_root: string; input_directory: string; input_manifest_ref: WorkspaceIncrementalFileRefV1; execution_id: string;
  descriptor: WorkspaceIncrementalNumericDescriptorV1; roots: AsyncIterable<ReadonlyArray<Root>>; parent: WorkspaceIncrementalParentFilesV1;
}) {
  descriptorCheck(args.descriptor); uuid.parse(args.execution_id);
  const directory = await assertWorkspaceEngineDirectoryV1(args.input_directory, args.storage_root);
  const parent = await openParent(args.storage_root, args.parent, args.descriptor);
  const temporaryRoots = join(directory, `current-roots-${randomUUID()}.jsonl`), temporaryInput = join(directory, `incremental-${randomUUID()}.json`);
  const file = await open(temporaryRoots, "wx", 0o600); let count = 0, previous = "";
  try {
    for await (const page of args.roots) {
      if (!page.length || page.length > 128) fail("root_page_invalid");
      for (const raw of page) {
        const root = signalWorkspaceIncrementalRootSchemaV1.parse(raw);
        if (root.root_id <= previous) fail("root_order_invalid"); previous = root.root_id;
        await file.writeFile(canonical(root) + "\n"); count++;
      }
    }
    await file.sync(); await file.close();
    const input = await checkCurrent(directory, args.input_manifest_ref, args.descriptor.compatibility, temporaryRoots);
    if (input.workspace_id !== parent.raw.workspace_id || args.execution_id === parent.execution_id) fail("input_identity_invalid");
    const analyzed = await analyze(parent, directory, temporaryRoots);
    const descriptor = parseSignalWorkspaceIncrementalInputV1({ contract_version: SIGNAL_WORKSPACE_INCREMENTAL_INPUT_V1,
      workspace_id: input.workspace_id, execution_id: args.execution_id, mode: "frozen-model-delta",
      policy_version: SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1, current_input_manifest: args.input_manifest_ref,
      current_roots: await reference(temporaryRoots, "current-roots.jsonl", count),
      parent: { execution_id: parent.execution_id, manifest_sha256: parent.manifest_sha256 }, compatibility: args.descriptor.compatibility,
      discovery: { cohort_key: analyzed.cohort_key, close_requested: args.descriptor.discovery.close_requested } });
    const output = await open(temporaryInput, "wx", 0o600);
    try { await output.writeFile(canonical(descriptor) + "\n"); await output.sync(); } finally { await output.close(); }
    // incremental.json is the publication marker; a partial roots file cannot run.
    await publish(join(directory, "current-roots.jsonl"), temporaryRoots);
    await publish(join(directory, "incremental.json"), temporaryInput);
    return { input: descriptor, input_ref: await reference(join(directory, "incremental.json"), "incremental.json"),
      request_digest: digest({ input: descriptor, runtime_digest: descriptor.compatibility.runtime_digest }), counts: analyzed.counts };
  } finally {
    await file.close().catch(() => undefined);
    for (const path of [temporaryRoots, temporaryInput]) await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

const rootOutputSchema = signalWorkspaceIncrementalRootSchemaV1.extend({ unit_keys: z.array(z.string()),
  state: z.enum(["computed", "outlier", "discovery_pending"]), discovery_pending: z.boolean() }).strict();
function modelIdentity(component: Component) {
  return { component_key: component.component_key, lane: component.lane, model_origin: component.model_origin,
    model: { sha256: component.model.sha256, bytes: component.model.bytes },
    center: component.center && { sha256: component.center.sha256, bytes: component.center.bytes }, units: component.units };
}
function sameMemberContent(a: Member, b: Member) {
  return Object.is(a.strength, b.strength)
    && same({ ...a, root_fingerprint: null, carried_from: null }, { ...b, root_fingerprint: null, carried_from: null });
}
/** Verify every numerical row against the sealed current input and the authorized
 * parent. The returned receipt grants no Topic, provider or registry authority. */
export async function validateSignalWorkspaceIncrementalOutputFilesV1(args: {
  storage_root: string; input_directory: string; output_directory: string; input_ref: WorkspaceIncrementalFileRefV1;
  descriptor: WorkspaceIncrementalNumericDescriptorV1; parent: WorkspaceIncrementalParentFilesV1;
  output_manifest_ref?: WorkspaceIncrementalFileRefV1;
}) {
  descriptorCheck(args.descriptor);
  const directory = await assertWorkspaceEngineDirectoryV1(args.input_directory, args.storage_root);
  const outputDirectory = await assertWorkspaceEngineDirectoryV1(args.output_directory, args.storage_root);
  if (args.input_ref.file !== "incremental.json") fail("input_identity_invalid");
  const input = parseSignalWorkspaceIncrementalInputV1(await json(await checked(directory, args.input_ref)));
  const parent = await openParent(args.storage_root, args.parent, args.descriptor);
  if (!same(input.parent, { execution_id: parent.execution_id, manifest_sha256: parent.manifest_sha256 })
    || !same(input.compatibility, args.descriptor.compatibility)
    || input.discovery.close_requested !== args.descriptor.discovery.close_requested) fail("input_identity_invalid");
  const rootsFile = await checked(directory, input.current_roots);
  const spool = await checkCurrent(directory, input.current_input_manifest, input.compatibility, rootsFile);
  if (input.workspace_id !== spool.workspace_id || input.workspace_id !== parent.raw.workspace_id || input.execution_id === parent.execution_id) fail("input_identity_invalid");
  const analyzed = await analyze(parent, directory, rootsFile);
  if (analyzed.cohort_key !== input.discovery.cohort_key || input.current_roots.rows !== analyzed.counts.roots) fail("cohort_invalid");
  const manifestRef = args.output_manifest_ref ?? await reference(join(outputDirectory, "manifest.json"), "manifest.json");
  if (manifestRef.file !== "manifest.json") fail("output_manifest_invalid");
  const output = parseSignalWorkspaceIncrementalOutputV1(await json(await checked(outputDirectory, manifestRef, true)));
  if (output.workspace_id !== input.workspace_id || output.execution_id !== input.execution_id
    || output.previous_manifest_sha256 !== parent.manifest_sha256 || !same(output.compatibility, input.compatibility)
    || output.request_digest !== digest({ input, runtime_digest: input.compatibility.runtime_digest })
    || output.population_digest !== analyzed.population_digest
    || Object.entries(analyzed.counts).some(([key, value]) => output.counts[key as keyof Output["counts"]] !== value)) fail("output_identity_invalid");
  const refs = new Map<string, WorkspaceIncrementalFileRefV1>();
  for (const page of chunkArray(output.artifacts)) for (const ref of page) {
    await checked(outputDirectory, ref); refs.set(ref.file, ref);
    if (ref.rows !== undefined) { let count = 0; for await (const row of lines(join(outputDirectory, ref.file))) { void row; count++; }
      if (count !== ref.rows) fail("artifact_rows_invalid"); }
  }
  if (!same(await json(join(outputDirectory, "model-components.json")), output.components)
    || refs.get("guide-vectors.npy")!.sha256 !== parent.refs.get("guide-vectors.npy")!.sha256) fail("output_component_invalid");
  const guideHash = arrayDigest(); for await (const row of lines(join(outputDirectory, "guides.jsonl"))) guideHash.add(row);
  const priorGuideHash = arrayDigest(); for await (const row of lines(join(parent.directory, "guides.jsonl"))) priorGuideHash.add(row);
  if (guideHash.finish() !== priorGuideHash.finish()) fail("guide_invalid");
  const old = new Map(parent.components.map(c => [c.component_key, c])), components = new Map(output.components.map(c => [c.component_key, c]));
  for (const component of parent.components) if (!components.has(component.component_key)
    || !same(modelIdentity(component), modelIdentity(components.get(component.component_key)!))) fail("component_origin_invalid");
  const newer = output.components.filter(c => !old.has(c.component_key));
  if (newer.some(c => c.model_origin.execution_id !== input.execution_id) || newer.length !== output.counts.new_components) fail("component_origin_invalid");
  for (const component of newer) for (const unit of component.units) {
    const name = `${input.discovery.cohort_key}:${component.lane}:${unit.local_label}:${unit.birth_membership_digest}`;
    if (unit.unit_key !== `${component.lane}:${uuid5(input.workspace_id, name)}`) fail("unit_origin_invalid");
  }
  const minimum = Math.max(...["hdbscan_min_cluster_size", "hdbscan_min_samples", "umap_n_neighbors"].map(key => Number(spool.config[key])));
  const fit = input.discovery.close_requested && analyzed.counts.cohort_occurrences > minimum;
  const positiveGuide = new Set<string>();
  for await (const raw of lines(join(directory, "guides.jsonl"))) if (String(object(raw).role).endsWith("positive")) positiveGuide.add("guided");
  const lanes = fit ? ["open", ...positiveGuide] : [];
  if (!same(newer.map(c => c.lane).sort(), lanes.sort())) fail("component_coverage_invalid");
  const pendingExpected = fit ? 0 : analyzed.counts.cohort_occurrences;
  const discovery = fit || !pendingExpected ? "complete" : analyzed.counts.cohort_occurrences <= minimum
    ? "pending_insufficient_population" : "pending_cohort_close";
  if (output.counts.pending_occurrences !== pendingExpected || output.discovery_status !== discovery) fail("pending_cohort_invalid");
  for (const component of output.components) {
    const known = old.has(component.component_key), coverage = output.coverage.find(c => c.component_key === component.component_key)!;
    const transformed = known ? analyzed.counts.delta_occurrences : analyzed.counts.occurrences - analyzed.counts.cohort_occurrences;
    if (coverage.copied_occurrences !== (known ? analyzed.counts.occurrences - analyzed.counts.delta_occurrences : 0)
      || coverage.transformed_occurrences !== transformed || coverage.fitted_occurrences !== (known ? 0 : analyzed.counts.cohort_occurrences)) fail("component_coverage_invalid");
    const transforms = output.operations.transform.filter(op => op.component_key === component.component_key);
    if (transformed ? transforms.length !== 1 || transforms[0]!.occurrences !== transformed
      || transforms[0]!.pages !== Math.ceil(transformed / 128) || transforms[0]!.maximum_page_rows !== Math.min(transformed, 128) : transforms.length !== 0)
      fail("component_coverage_invalid");
    const fits = output.operations.fit.filter(op => op.component_key === component.component_key);
    if (known ? fits.length !== 0 : fits.length !== 1 || fits[0]!.occurrences !== analyzed.counts.cohort_occurrences
      || fits[0]!.population_digest !== analyzed.cohort_digest) fail("component_coverage_invalid");
  }
  if (output.operations.transform.some(op => !components.has(op.component_key))) fail("component_coverage_invalid");
  const actualTransitions = cursor(lines(join(outputDirectory, "root-transitions.jsonl")));
  try { for await (const expected of transitions(parent, rootsFile)) if (!same(await actualTransitions.take(), expected)) fail("root_delta_invalid");
    if (await actualTransitions.peek()) fail("root_delta_invalid"); } finally { await actualTransitions.close(); }
  const population = cursor(lines(join(outputDirectory, "population.jsonl"))), roots = cursor(lines(join(outputDirectory, "roots.jsonl")));
  const members = cursor(lines(join(outputDirectory, "memberships.jsonl"))), previous = cursor(parent.members());
  const pending = cursor(lines(join(outputDirectory, "pending-cohort.jsonl")));
  const candidatesRaw = await json(join(outputDirectory, "candidate-groups.json"));
  const relationsRaw = await json(join(outputDirectory, "relations.json"));
  const candidateStats = candidates(output, newer, candidatesRaw);
  const oldUnits = new Set(parent.components.flatMap(c => c.units.map(u => u.unit_key)));
  const allUnits = new Set(output.components.flatMap(c => c.units.map(u => u.unit_key)));
  if (allUnits.size !== output.components.reduce((n, c) => n + c.units.length, 0)) fail("unit_duplicate");
  const unitRoots = new Map<string, number>(), overlaps = new Map<string, Map<string, number>>();
  let memberCount = 0, currentRoot = "", rootUnits = new Set<string>(), priorMemberKey = "", relationBytes = 0;
  try {
    for await (const { row, root, isDelta, cohort } of walkCurrent(parent, directory, rootsFile)) {
      if (!same(await population.take(), row)) fail("population_invalid");
      if (row.root_id !== currentRoot) { currentRoot = row.root_id; rootUnits = new Set(); }
      if (!fit && cohort && !same(await pending.take(), row)) fail("pending_cohort_invalid");
      while (await previous.peek() && occurrenceKey((await previous.peek())!) < occurrenceKey(row)) await previous.take();
      const priorByComponent = new Map<string, Member>();
      while (await previous.peek() && occurrenceKey((await previous.peek())!) === occurrenceKey(row)) {
        const item = (await previous.take())!; priorByComponent.set(item.model_component_key, item);
      }
      const carried = new Set<string>();
      while (await members.peek() && occurrenceKey(object(await members.peek()) as { root_id: string; chunk_index: number }) <= occurrenceKey(row)) {
        const item = signalWorkspaceIncrementalMembershipSchemaV1.parse(await members.take()), key = memberKey(item);
        if (key <= priorMemberKey) fail("membership_order_invalid"); priorMemberKey = key;
        const component = components.get(item.model_component_key), original = priorByComponent.get(item.model_component_key);
        if (!component || item.root_id !== row.root_id || item.chunk_index !== row.chunk_index || item.root_fingerprint !== row.root_fingerprint
          || item.start !== row.start || item.end !== row.end || item.chunk_sha256 !== row.chunk_sha256 || item.lane !== component.lane
          || !same(item.model_origin, component.model_origin) || !component.units.some(unit => unit.unit_key === item.unit_key)) fail("membership_invalid");
        if (old.has(component.component_key) && !isDelta) {
          if (!original || !sameMemberContent(item, original) || !same(item.carried_from, {
            output_manifest_sha256: parent.manifest_sha256, membership_digest: signalWorkspaceIncrementalMembershipDigestV1(original) })) fail("carry_invalid");
          carried.add(component.component_key);
        } else {
          const fitted = !old.has(component.component_key) && cohort;
          const basis = fitted ? "fitted_member" : "predicted_member", pop = fitted ? analyzed.cohort_digest : analyzed.population_digest;
          if (item.carried_from !== null || !same(item.evaluation_origin, { execution_id: input.execution_id, input_population_digest: pop,
            evaluation_key: digest([input.execution_id, component.component_key, pop, basis]), basis })) fail("evaluation_origin_invalid");
          if (fitted) countCandidate(candidateStats, item, row);
        }
        rootUnits.add(item.unit_key); memberCount++;
      }
      if (!isDelta && [...priorByComponent.keys()].some(key => !carried.has(key))) fail("carry_incomplete");
      if (row.chunk_index + 1 === row.expected_chunks) {
        const actual = rootOutputSchema.parse(await roots.take()), keys = [...rootUnits].sort();
        if (!same(actual, { ...root, unit_keys: keys, discovery_pending: !fit && cohort,
          state: keys.length ? "computed" : !fit && cohort ? "discovery_pending" : "outlier" })) fail("root_output_invalid");
        for (const key of keys) unitRoots.set(key, (unitRoots.get(key) ?? 0) + 1);
        for (const candidate of candidateStats.keys()) if (rootUnits.has(candidate)) {
          const shared = overlaps.get(candidate) ?? new Map<string, number>();
          for (const key of keys) if (oldUnits.has(key)) {
            if (!shared.has(key)) { relationBytes += Buffer.byteLength(candidate) + Buffer.byteLength(key) + 48;
              if (relationBytes > MAX_JSON_BYTES) fail("json_capacity_exceeded"); }
            shared.set(key, (shared.get(key) ?? 0) + 1);
          }
          overlaps.set(candidate, shared);
        }
      }
    }
    if (await population.peek() || await roots.peek() || await members.peek() || await pending.peek()
      || memberCount !== output.counts.memberships) fail("output_coverage_incomplete");
    // Drain removed parent roots too, validating the complete ordered parent stream.
    while (await previous.take()) { /* intentionally excluded by the full root join */ }
  } finally { for (const stream of [population, roots, members, previous, pending]) await stream.close(); }
  finishCandidates(candidateStats);
  const expectedRelations = [...candidateStats.keys()].map(key => ({ candidate_unit_key: key, candidate_roots: unitRoots.get(key) ?? 0,
    overlaps: [...(overlaps.get(key) ?? new Map<string, number>())].sort(([a], [b]) => a < b ? -1 : 1)
      .map(([unit_key, shared_roots]) => ({ unit_key, shared_roots, known_roots: unitRoots.get(unit_key) ?? 0 })), status: "proposed", alias: null }));
  if (!same(relationsRaw, expectedRelations) || output.relations_status !== (candidateStats.size ? "pending" : "none")) fail("relations_invalid");
  // Detect concurrent scratch mutation before handing file identities to storage.
  for (const ref of refs.values()) await checked(outputDirectory, ref);
  await checked(outputDirectory, manifestRef, true); await checked(directory, args.input_ref);
  return { manifest: output, manifest_ref: manifestRef, files: [manifestRef, ...refs.values()],
    validation: { contract_version: "workspace-incremental-file-validation-v1" as const,
      request_digest: output.request_digest, population_digest: analyzed.population_digest,
      complete_file_digest: digest([manifestRef, ...refs.values()].sort((a, b) => a.file < b.file ? -1 : 1)),
      origin_digest: digest(output.components.map(modelIdentity)), roots: output.counts.roots,
      occurrences: output.counts.occurrences, memberships: memberCount, pending_occurrences: pendingExpected,
      relations_scope: "new_candidates_in_this_execution" as const } };
}
function* chunkArray<T>(rows: T[]) { for (let i = 0; i < rows.length; i += 128) yield rows.slice(i, i + 128); }
function uuid5(namespace: string, value: string) {
  const bytes = createHash("sha1").update(Buffer.from(namespace.replaceAll("-", ""), "hex")).update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
type CandidateStats = { raw: Json; birth: ReturnType<typeof arrayDigest>; chunks: number; roots: number; lastRoot: string; found: Set<number> };
const candidateSchema = z.object({ unit_key: z.string(), component_key: hash, birth_membership_digest: hash,
  root_count: natural.refine(n => n > 0), chunk_count: natural.refine(n => n > 0),
  terms: z.array(z.string().max(256).refine(term => Boolean(term.trim()))),
  representatives: z.array(z.object({ ordinal: natural, root_id: uuid, chunk_index: natural, start: natural, end: natural,
    chunk_sha256: hash, strength: z.number().finite(), selection_reason: z.enum(["high_affiliation", "low_affiliation_boundary"]) }).strict()).max(10) }).strict();
function candidates(output: Output, newer: Component[], raw: unknown) {
  if (!Array.isArray(raw)) fail("candidate_invalid");
  const wanted = newer.flatMap(component => component.units.map(unit => ({ component, unit }))), stats = new Map<string, CandidateStats>();
  if (raw.length !== wanted.length) fail("candidate_invalid");
  for (let i = 0; i < raw.length; i++) {
    const row = candidateSchema.parse(raw[i]), { component, unit } = wanted[i]!;
    if (row.unit_key !== unit.unit_key || row.component_key !== component.component_key || row.birth_membership_digest !== unit.birth_membership_digest
      || row.representatives.filter(ref => ref.selection_reason === "low_affiliation_boundary").length !== (row.root_count > 1 ? 1 : 0)) fail("candidate_invalid");
    stats.set(unit.unit_key, { raw: row, birth: arrayDigest(), chunks: 0, roots: 0, lastRoot: "", found: new Set() });
  }
  if (output.counts.new_components !== newer.length) fail("candidate_invalid");
  return stats;
}
function countCandidate(stats: Map<string, CandidateStats>, item: Member, population: Population) {
  const value = stats.get(item.unit_key); if (!value) fail("candidate_invalid");
  value.birth.add(occurrence(population)); value.chunks++;
  if (value.lastRoot !== item.root_id) { value.roots++; value.lastRoot = item.root_id; }
  for (const [index, raw] of (value.raw.representatives as unknown[]).entries()) {
    const ref = object(raw);
    if (ref.root_id === item.root_id && ref.chunk_index === item.chunk_index) {
      if (!same(occurrence(ref), occurrence(population)) || ref.strength !== item.strength) fail("candidate_reference_invalid"); value.found.add(index);
    }
  }
}
function finishCandidates(stats: Map<string, CandidateStats>) {
  for (const value of stats.values()) {
    const refs = value.raw.representatives as Json[];
    if (value.birth.finish() !== value.raw.birth_membership_digest || value.chunks !== value.raw.chunk_count
      || value.roots !== value.raw.root_count || value.found.size !== refs.length
      || refs.length !== Math.min(10, value.roots) || new Set(refs.map(ref => ref.root_id)).size !== refs.length)
      fail("candidate_reference_invalid");
  }
}
