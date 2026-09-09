import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { signalWorkspaceIncrementalDigestV1 as digest, signalWorkspaceIncrementalMembershipDigestV1,
  signalWorkspaceInterpretationUniverseDigestV1, signalWorkspaceInterpretationReferenceIdV1,
  parseSignalWorkspaceInterpretationClusterV1, type SignalWorkspaceInterpretationClusterV1,
  type SignalWorkspaceInterpretationReferenceV1 } from "@noisia/query-engine";
import { prepareWorkspaceIncrementalProjectionFilesV1 as prepare } from "./signal-workspace-incremental-projection-files";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

type Files = Parameters<typeof prepare>[0];
type Prepared = Awaited<ReturnType<typeof prepare>>;
type Component = Prepared["manifest"]["components"][number];
type Origin = Component["model_origin"];
const MAX_BYTES = 8 * 1024 * 1024;
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u), natural = z.number().int().nonnegative().safe();
const originSchema = z.object({ execution_id: z.string().uuid(), model_artifact_sha256: hash }).strict();
const refSchema = z.object({ ordinal: natural, root_id: z.string().uuid(), chunk_index: natural,
  start: natural, end: natural, chunk_sha256: hash, strength: z.number().finite().min(0).max(1),
  selection_reason: z.enum(["high_affiliation", "low_affiliation_boundary"]) }).strict();
const candidateSchema = z.object({ unit_key: z.string(), component_key: hash, birth_membership_digest: hash,
  root_count: natural.positive(), chunk_count: natural.positive(), terms: z.array(z.string().min(1).max(256)
    .refine(s => Boolean(s.trim()))).max(100), representatives: z.array(refSchema).max(10) }).strict();
type Ref = z.infer<typeof refSchema>;
type BareRef = Omit<Ref, "selection_reason">;
export type WorkspaceIncrementalEditorialUnitV1 = { unit_key: string; component_key: string; local_label: number;
  birth_membership_digest: string; model_origin: Origin; lane: "open" | "guided" };
export type WorkspaceIncrementalEditorialExclusionV1 = Pick<WorkspaceIncrementalEditorialUnitV1,
  "unit_key" | "component_key" | "birth_membership_digest"> & { reason: "already_interpreted" | "editorial_claimed" };
export type WorkspaceIncrementalEditorialUnitStateV1 = "already_interpreted" | "editorial_claimed"
  | "legacy_full_fit" | "no_current_members" | "evidence_ready";
export type WorkspaceIncrementalEditorialFragmentV1 = Pick<SignalWorkspaceInterpretationReferenceV1,
  "root_id" | "chunk_index" | "start" | "end" | "chunk_sha256"> & { root_fingerprint: string; asset_sha256: string };
export type WorkspaceIncrementalEditorialOriginV1 = { kind: "full_fit"; model_origin: Origin }
  | { kind: "incremental"; files: Files };
export type WorkspaceIncrementalEditorialEvidenceArgsV1 = {
  current: Files; origins: readonly WorkspaceIncrementalEditorialOriginV1[];
  exclusions: readonly WorkspaceIncrementalEditorialExclusionV1[];
  read_fragments: (refs: readonly WorkspaceIncrementalEditorialFragmentV1[]) => Promise<readonly
    (WorkspaceIncrementalEditorialFragmentV1 & { text: string })[]>;
};
export type WorkspaceIncrementalEditorialEvidenceWriteV1 = {
  index: number; unit_key: string; jsonl: string;
};
const fail = (code: string): never => { throw new Error(`workspace_incremental_editorial_evidence_${code}`); };
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const high = (a: BareRef, b: BareRef) => b.strength - a.strength || a.ordinal - b.ordinal;
const low = (a: BareRef, b: BareRef) => a.strength - b.strength || a.ordinal - b.ordinal;
const identity = ({ ordinal, root_id, chunk_index, start, end, chunk_sha256 }: BareRef) =>
  ({ ordinal, root_id, chunk_index, start, end, chunk_sha256 });
function selection() {
  // Same distinct-roots-affiliation-boundary-v1 policy as workspace_engine.py.
  // Ten best roots plus two lowest roots suffice even when the final anchor changes.
  let best: BareRef[] = [], weakest: BareRef[] = [];
  const add = (list: BareRef[], item: BareRef, compare: typeof high, limit: number) => {
    const prior = list.find(row => row.root_id === item.root_id);
    if (prior && compare(prior, item) <= 0) return list;
    return [...list.filter(row => row.root_id !== item.root_id), item].sort(compare).slice(0, limit);
  };
  return { add(item: BareRef) { best = add(best, item, high, 10); weakest = add(weakest, item, low, 2); },
    finish(): Ref[] {
      const boundary = weakest.find(row => row.root_id !== best[0]?.root_id);
      return [...best.filter(row => row.root_id !== boundary?.root_id).slice(0, boundary ? 9 : 10)
        .map(row => ({ ...row, selection_reason: "high_affiliation" as const })),
      ...(boundary ? [{ ...boundary, selection_reason: "low_affiliation_boundary" as const }] : [])];
    } };
}
function arrayHash() {
  const h = createHash("sha256").update("["); let count = 0;
  return { add(ref: BareRef) { if (count++) h.update(",");
    h.update(JSON.stringify(Object.fromEntries(Object.entries(identity(ref)).sort(([a], [b]) => order(a, b))))); },
  finish() { return `sha256:${h.update("]").digest("hex")}`; } };
}
function stats() {
  return { roots: 0, chunks: 0, lastRoot: "", selection: selection(), birth: arrayHash(), current: createHash("sha256") };
}
function count(value: ReturnType<typeof stats>, ref: BareRef) {
  value.chunks++; if (value.lastRoot !== ref.root_id) { value.roots++; value.lastRoot = ref.root_id; }
  value.selection.add(ref);
}
async function candidates(files: Files, prepared: Prepared) {
  const ref = prepared.manifest.artifacts.find(row => row.file === "candidate-groups.json") ?? fail("candidate_missing");
  if (ref.bytes > MAX_BYTES) fail("capacity_exceeded");
  const path = join(files.directory, ref.file), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== ref.bytes) fail("candidate_invalid");
  const bytes = await readFile(path);
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== ref.sha256) fail("candidate_invalid");
  return { ref, rows: z.array(candidateSchema).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) };
}

/** LOCAL evidence adapter, not spending or editorial ownership authority.
 * Caller supplies server-authorized, immutable current/origin checkpoints and
 * exclusions. All metadata reaches EOF before text lookup; only exact current
 * representative fragments are requested. No model, input matrix or provider IO.
 * Only one cluster's text is resident. Await each storage callback (backpressure),
 * then verify source files again before returning the final descriptor. Partial
 * writes are NOT a checkpoint: caller publishes only after successful return. */
export async function streamWorkspaceIncrementalEditorialEvidenceV1(args: WorkspaceIncrementalEditorialEvidenceArgsV1 & {
  write_cluster: (row: WorkspaceIncrementalEditorialEvidenceWriteV1) => Promise<void>;
}) {
  try {
    const current = await prepare(args.current), units = new Map<string, WorkspaceIncrementalEditorialUnitV1>();
    const checkedFiles = new Map<string, Files["manifest_ref"]>();
    const remember = (files: Files, source: Prepared, candidate = false) => {
      const names = ["roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json",
        ...(candidate ? ["candidate-groups.json"] : [])];
      for (const ref of [files.manifest_ref, ...names.map(name => source.manifest.artifacts.find(ref => ref.file === name)!)]) {
        const path = join(files.directory, ref.file), previous = checkedFiles.get(path);
        if (previous && !same(previous, ref)) fail("origin_invalid");
        checkedFiles.set(path, ref);
      }
    };
    remember(args.current, current);
    for (const component of current.manifest.components) for (const unit of component.units)
      units.set(unit.unit_key, { unit_key: unit.unit_key, component_key: component.component_key, local_label: unit.local_label,
        birth_membership_digest: unit.birth_membership_digest, model_origin: component.model_origin, lane: component.lane });
    const originKinds = new Map<string, "full_fit" | "incremental">(), terms = new Map<string, string[]>();
    let termBytes = 0;
    const birthRefs: Array<{ execution_id: string; manifest_sha256: string; candidate_sha256: string }> = [];
    for (const origin of args.origins) {
      if (origin.kind === "full_fit") {
        const model = originSchema.parse(origin.model_origin), matches = current.manifest.components.filter(c => same(c.model_origin, model));
        if (!matches.length || matches.some(c => originKinds.has(c.component_key))) fail("origin_invalid");
        for (const component of matches) originKinds.set(component.component_key, "full_fit");
        continue;
      }
      if (origin.kind !== "incremental") fail("origin_invalid");
      const source = await prepare(origin.files), born = source.manifest.components.filter(c => c.model_origin.execution_id === source.manifest.execution_id);
      if (source.manifest.workspace_id !== current.manifest.workspace_id || !born.length
        || !same(source.manifest.compatibility, current.manifest.compatibility)
        || !same([...source.manifest.operations.fit.map(op => op.component_key)].sort(), born.map(c => c.component_key).sort())) fail("origin_invalid");
      for (const component of born) {
        const actual = current.manifest.components.find(c => c.component_key === component.component_key), key = component.component_key;
        // File names may change when the same immutable model is flattened into a child bank.
        if (!actual || originKinds.has(key) || !same(actual.model_origin, component.model_origin)
          || !same(actual.units, component.units) || actual.lane !== component.lane) fail("origin_invalid");
        originKinds.set(key, "incremental");
      }
      const raw = await candidates(origin.files, source), expected = born.flatMap(c => c.units.map(u => ({ ...u, component_key: c.component_key })));
      remember(origin.files, source, true);
      if (raw.rows.length !== expected.length || new Set(raw.rows.map(row => row.unit_key)).size !== expected.length) fail("candidate_invalid");
      const census = new Map(expected.map(unit => [unit.unit_key, stats()]));
      for (const row of raw.rows) {
        const unit = expected.find(unit => unit.unit_key === row.unit_key);
        if (!unit || unit.component_key !== row.component_key || unit.birth_membership_digest !== row.birth_membership_digest) fail("candidate_invalid");
      }
      let ordinal = 0;
      for await (const packet of source.roots()) {
        for (const member of packet.memberships) if (census.has(member.unit_key)
          && member.evaluation_origin.basis === "fitted_member") {
          if (member.strength < 0 || member.strength > 1) fail("strength_invalid");
          const value = census.get(member.unit_key)!, ref = { ...identity({ ...member, ordinal: ordinal + member.chunk_index }), strength: member.strength };
          count(value, ref); value.birth.add(ref);
        }
        ordinal += packet.chunks.length;
      }
      for (const row of raw.rows) {
        const value = census.get(row.unit_key)!;
        if (value.birth.finish() !== row.birth_membership_digest || value.roots !== row.root_count || value.chunks !== row.chunk_count
          || !same(value.selection.finish(), row.representatives)) fail("birth_census_invalid");
        termBytes += Buffer.byteLength(JSON.stringify([row.unit_key, row.terms]));
        if (termBytes > MAX_BYTES) fail("capacity_exceeded");
        terms.set(row.unit_key, row.terms);
      }
      birthRefs.push({ execution_id: source.manifest.execution_id, manifest_sha256: origin.files.manifest_ref.sha256, candidate_sha256: raw.ref.sha256 });
    }
    for (const component of current.manifest.components) if (!originKinds.has(component.component_key)) fail("origin_missing");
    const exclusions = new Map<string, WorkspaceIncrementalEditorialExclusionV1>();
    for (const exclusion of args.exclusions) {
      const unit = units.get(exclusion.unit_key);
      if (!unit || exclusions.has(exclusion.unit_key) || !["already_interpreted", "editorial_claimed"].includes(exclusion.reason)
        || unit.component_key !== exclusion.component_key || unit.birth_membership_digest !== exclusion.birth_membership_digest) fail("exclusion_invalid");
      exclusions.set(exclusion.unit_key, exclusion);
    }
    const census = new Map([...units.keys()].map(key => [key, stats()]));
    const fragmentSources = new Map<string, { root_fingerprint: string; asset_sha256: string }>();
    let ordinal = 0;
    for await (const packet of current.roots()) {
      for (const member of packet.memberships) {
        if (member.strength < 0 || member.strength > 1) fail("strength_invalid");
        const value = census.get(member.unit_key)!, ref = { ...identity({ ...member, ordinal: ordinal + member.chunk_index }), strength: member.strength };
        count(value, ref);
        value.current.update(JSON.stringify([packet.root.root_fingerprint, packet.root.asset_sha256, packet.root.chunk_coverage_digest,
          packet.root.correction_digest, signalWorkspaceIncrementalMembershipDigestV1(member)]) + "\n");
      }
      ordinal += packet.chunks.length;
    }
    const rows = [...units.values()].sort((a, b) => order(a.unit_key, b.unit_key)).map(unit => {
      const value = census.get(unit.unit_key)!;
      const status: WorkspaceIncrementalEditorialUnitStateV1 = exclusions.get(unit.unit_key)?.reason ?? (originKinds.get(unit.component_key) === "full_fit"
        ? "legacy_full_fit" : value.roots === 0 ? "no_current_members" : "evidence_ready");
      return { ...unit, status, root_count: value.roots, chunk_count: value.chunks,
        cluster_digest: `sha256:${value.current.digest("hex")}`, representatives: value.selection.finish() };
    });
    const targets = rows.filter(row => row.status === "evidence_ready"), wanted = new Set(targets.flatMap(row => row.representatives.map(ref => ref.root_id)));
    // The second complete scan supplies current root identity for selected refs;
    // no corpus-wide text or root map is retained.
    for await (const packet of current.roots()) if (wanted.has(packet.root.root_id))
      fragmentSources.set(packet.root.root_id, { root_fingerprint: packet.root.root_fingerprint, asset_sha256: packet.root.asset_sha256 });
    // This cap concerns metadata only, never the sum of cited texts. Bank/roots
    // already use the existing bounded numeric reader; text may exceed 8 MiB.
    if (Buffer.byteLength(JSON.stringify({ rows, birthRefs, census: current.census })) + termBytes + 2048 > MAX_BYTES) fail("capacity_exceeded");
    const streamHash = createHash("sha256"); let streamBytes = 0, streamRows = 0;
    for (const row of targets) {
      const requests = row.representatives.map(ref => { const { root_id, chunk_index, start, end, chunk_sha256 } = ref;
        return { root_id, chunk_index, start, end, chunk_sha256, ...fragmentSources.get(root_id)! }; });
      const texts = await args.read_fragments(requests);
      if (texts.length !== requests.length || texts.some((text, index) => !same(Object.fromEntries(Object.entries(text)
        .filter(([key]) => key !== "text")), requests[index]))) fail("fragment_invalid");
      const cluster = parseSignalWorkspaceInterpretationClusterV1({ cluster_id: row.unit_key, lane: row.lane,
        cluster_digest: row.cluster_digest, root_count: row.root_count, chunk_count: row.chunk_count, terms: terms.get(row.unit_key),
        representatives: row.representatives.map((ref, index) => { const { root_id, chunk_index, start, end, chunk_sha256, strength, selection_reason } = ref;
          const key = { root_id, chunk_index, start, end, chunk_sha256 };
          return { ...key, strength, selection_reason, ref_id: signalWorkspaceInterpretationReferenceIdV1(key), text: texts[index]!.text }; }) });
      const { representatives: _refs, ...unit } = row;
      const jsonl = JSON.stringify({ contract_version: "workspace-incremental-editorial-evidence-unit-v1", unit, cluster }) + "\n";
      const bytes = Buffer.byteLength(jsonl);
      if (bytes > MAX_BYTES || !Number.isSafeInteger(streamBytes + bytes)) fail("capacity_exceeded");
      await args.write_cluster({ index: streamRows, unit_key: row.unit_key, jsonl });
      streamHash.update(jsonl); streamBytes += bytes; streamRows++;
    }
    // A late write failure, text error or source mutation leaves no final seal.
    // Never deserialize or even read the model files during this verification.
    for (const [path, ref] of checkedFiles) {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== ref.bytes
        || await hashWorkspaceEngineFileV1(path) !== ref.sha256) fail("source_changed");
    }
    const result = { contract_version: "workspace-incremental-editorial-evidence-stream-v1" as const,
      numeric_execution_id: current.manifest.execution_id, numeric_checkpoint_digest: args.current.checkpoint.checkpoint_digest,
      numeric_manifest_sha256: args.current.manifest_ref.sha256, population_digest: current.manifest.population_digest,
      numeric_component_order: current.manifest.components.map(component => component.component_key),
      representative_selection_policy: "distinct-roots-affiliation-boundary-v1" as const,
      census: current.census, origins: birthRefs.sort((a, b) => order(a.execution_id, b.execution_id)),
      units: rows.map(({ representatives: _refs, ...row }) => row),
      target_unit_digest: signalWorkspaceInterpretationUniverseDigestV1(targets.map(row => row.unit_key)),
      // Separate domains: batching keys vs immutable bank identity for DB claims.
      target_binding_digest: digest(targets.map(({ component_key, local_label, unit_key, birth_membership_digest, model_origin }) =>
        ({ component_key, unit: { local_label, unit_key, birth_membership_digest }, model_origin }))),
      stream: { contract_version: "workspace-incremental-editorial-evidence-jsonl-v1" as const,
        rows: streamRows, bytes: streamBytes, sha256: `sha256:${streamHash.digest("hex")}` } };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) fail("capacity_exceeded");
    return { ...result, evidence_digest: digest(result) };
  } catch (error) {
    if (error instanceof Error && /^workspace_incremental_editorial_evidence_[a-z_]+$/u.test(error.message)) throw error;
    return fail("invalid");
  }
}

export type WorkspaceIncrementalEditorialEvidenceDescriptorV1 =
  Awaited<ReturnType<typeof streamWorkspaceIncrementalEditorialEvidenceV1>>;
export type WorkspaceIncrementalEditorialEvidenceUnitV1 = WorkspaceIncrementalEditorialEvidenceDescriptorV1["units"][number];

/** Convenience wrapper for small fixtures/callers. Product flows use streaming;
 * this deliberate aggregate limit does not restrict the streaming universe. */
export async function prepareWorkspaceIncrementalEditorialEvidenceV1(args: WorkspaceIncrementalEditorialEvidenceArgsV1) {
  const clusters: SignalWorkspaceInterpretationClusterV1[] = []; let bytes = 0;
  const { contract_version: _contract, stream: _stream, evidence_digest: _digest, ...metadata } =
    await streamWorkspaceIncrementalEditorialEvidenceV1({ ...args, write_cluster: async row => {
      bytes += Buffer.byteLength(row.jsonl); if (bytes > MAX_BYTES) fail("capacity_exceeded");
      clusters.push(parseSignalWorkspaceInterpretationClusterV1(JSON.parse(row.jsonl).cluster));
    } });
  const result = { contract_version: "workspace-incremental-editorial-evidence-v1" as const, ...metadata, clusters };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) fail("capacity_exceeded");
  return { ...result, evidence_digest: digest(result) };
}
