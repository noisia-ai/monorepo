import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { parseSignalWorkspaceIncrementalOutputV1, signalWorkspaceIncrementalMembershipSchemaV1,
  signalWorkspaceIncrementalProjectionRootSchemaV1, signalWorkspaceIncrementalDigestV1 as digest,
  signalWorkspaceInterpretationUniverseDigestV1,
  type SignalWorkspaceIncrementalProjectionRootV1 as Root,
  type SignalWorkspaceIncrementalProjectionChunkV1 as Chunk } from "@noisia/query-engine";
import { assertWorkspaceEngineDirectoryV1, hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

const MAX_BYTES = 8 * 1024 * 1024;
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const natural = z.number().int().nonnegative().safe();
const reference = z.object({ file: z.string().regex(/^[a-z][a-z0-9_.-]{0,100}$/u).refine(name => !name.includes("..")),
  sha256: hash, bytes: natural, rows: natural.optional() }).strict();
type Ref = z.infer<typeof reference>;
type Output = ReturnType<typeof parseSignalWorkspaceIncrementalOutputV1>;
type Member = z.infer<typeof signalWorkspaceIncrementalMembershipSchemaV1>;
const population = z.object({ ordinal: natural, root_id: uuid, root_fingerprint: hash, asset_sha256: hash,
  expected_chunks: natural.positive(), chunk_index: natural, start: natural, end: natural, chunk_sha256: hash }).strict()
  .refine(row => row.end > row.start && row.end - row.start <= 1400);
type Population = z.infer<typeof population>;
const checkpointSchema = z.object({ contract_version: z.literal("workspace-incremental-numeric-checkpoint-v1"),
  checkpoint_digest: hash, workspace_id: uuid, execution_id: uuid, population_digest: hash,
  roots: natural, occurrences: natural, components: natural, component_digest: hash, model_bank_bytes: natural,
  discovery_status: z.enum(["complete", "pending_insufficient_population", "pending_cohort_close"]),
  relations_status: z.enum(["pending", "none"]), numeric_complete: z.literal(true), analysis_complete: z.literal(false)
});
/** The server supplies these values from the authorized source and 0145
 * checkpoint. This file reader does not select a parent or confer DB authority. */
export type WorkspaceIncrementalProjectionFileCheckpointV1 = z.infer<typeof checkpointSchema>;
export type WorkspaceIncrementalProjectionFileRootV1 = { root: Root; chunks: Chunk[]; memberships: Member[] };
export type WorkspaceIncrementalProjectionFileCensusV1 = {
  roots: number; chunks: number; memberships: number; pending_roots: number; pending_occurrences: number;
  expected_unit_count: number; expected_unit_digest: string; population_digest: string;
};
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
function fail(code: string): never { throw new Error(`workspace_incremental_projection_files_${code}`); }
function safe(error: unknown): never {
  if (error instanceof Error && /^workspace_incremental_projection_files_[a-z_]+$/u.test(error.message)) throw error;
  return fail("invalid");
}
function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort()
      .map(key => [key, sorted((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(sorted(value));
}
function arrayDigest() {
  const state = createHash("sha256").update("["); let seen = 0;
  return { add(value: unknown) { if (seen++) state.update(","); state.update(canonical(value)); },
    finish() { return `sha256:${state.update("]").digest("hex")}`; } };
}
function decode(bytes: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("json_invalid"); }
}
async function checked(directory: string, ref: Ref) {
  const path = join(directory, ref.file), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== ref.bytes
    || await hashWorkspaceEngineFileV1(path) !== ref.sha256) return fail("artifact_invalid");
  return path;
}
async function json(directory: string, ref: Ref) {
  if (ref.bytes > MAX_BYTES) return fail("json_capacity_exceeded");
  return decode(await readFile(await checked(directory, ref)));
}
async function* lines<T>(path: string, schema: z.ZodType<T>): AsyncGenerator<T> {
  let buffer = Buffer.alloc(0);
  for await (const raw of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    buffer = Buffer.concat([buffer, raw as Buffer]); let next: number;
    while ((next = buffer.indexOf(10)) !== -1) {
      if (next < 1 || next > MAX_BYTES) return fail("jsonl_invalid");
      yield schema.parse(decode(buffer.subarray(0, next))); buffer = buffer.subarray(next + 1);
    }
    if (buffer.length > MAX_BYTES) return fail("json_capacity_exceeded");
  }
  if (buffer.length) return fail("jsonl_incomplete");
}
function cursor<T>(source: AsyncIterable<T>) {
  const iterator = source[Symbol.asyncIterator](); let loaded = false, value: IteratorResult<T>;
  return { async peek(): Promise<T | null> { if (!loaded) { value = await iterator.next(); loaded = true; } return value.done ? null : value.value; },
    async take(): Promise<T | null> { if (!loaded) value = await iterator.next(); loaded = false; return value.done ? null : value.value; },
    async close() { await iterator.return?.(); } };
}
const occurrenceOrder = (a: Pick<Population, "root_id" | "chunk_index">, b: Pick<Population, "root_id" | "chunk_index">) =>
  order(a.root_id, b.root_id) || a.chunk_index - b.chunk_index;
const memberOrder = (a: Member, b: Member) => occurrenceOrder(a, b) || order(a.model_component_key, b.model_component_key);
function assertEvaluation(member: Member, output: Output) {
  const evaluation = member.evaluation_origin;
  if (member.carried_from) {
    if (member.carried_from.output_manifest_sha256 !== output.previous_manifest_sha256
      || evaluation.execution_id === output.execution_id || member.model_origin.execution_id === output.execution_id) fail("carry_invalid");
    // The prior membership digest is preserved verbatim; checking its source
    // bytes belongs to the already-sealed 0145 checkpoint, not this projection.
  } else {
    if (evaluation.execution_id !== output.execution_id) fail("evaluation_invalid");
    const populationDigest = evaluation.basis === "predicted_member" ? output.population_digest
      : output.operations.fit.find(op => op.component_key === member.model_component_key)?.population_digest;
    if (!populationDigest || evaluation.input_population_digest !== populationDigest) fail("evaluation_invalid");
  }
}
function componentDigest(output: Output) {
  return digest([...output.components].sort((a, b) => order(a.component_key, b.component_key)).map(component =>
    [component.component_key, component.lane, component.model_origin, component.units.length, digest(component.units)]));
}

/** Complete preflight precedes the first externally visible root. The second
 * pass keeps at most one complete root (8 MiB of JSON), never a corpus array.
 * Only the numeric metadata streams and model-components.json are opened.
 * Neither model bytes nor text/embeddings, parent inputs or providers are read. */
export async function prepareWorkspaceIncrementalProjectionFilesV1(args: {
  storage_root: string; directory: string; manifest_ref: Ref; checkpoint: WorkspaceIncrementalProjectionFileCheckpointV1;
  max_root_bytes?: number;
}): Promise<{ manifest: Output; census: WorkspaceIncrementalProjectionFileCensusV1;
  roots: () => AsyncIterable<WorkspaceIncrementalProjectionFileRootV1> }> {
  try {
    const directory = await assertWorkspaceEngineDirectoryV1(args.directory, args.storage_root);
    const manifestRef = reference.parse(args.manifest_ref), checkpoint = checkpointSchema.parse(args.checkpoint);
    const maxRootBytes = args.max_root_bytes ?? MAX_BYTES;
    if (!Number.isSafeInteger(maxRootBytes) || maxRootBytes < 1 || maxRootBytes > MAX_BYTES) fail("capacity_invalid");
    if (manifestRef.file !== "manifest.json") fail("manifest_invalid");
    const output = parseSignalWorkspaceIncrementalOutputV1(await json(directory, manifestRef));
    if (output.workspace_id !== checkpoint.workspace_id || output.execution_id !== checkpoint.execution_id
      || output.population_digest !== checkpoint.population_digest || output.counts.roots !== checkpoint.roots
      || output.counts.occurrences !== checkpoint.occurrences || output.counts.components !== checkpoint.components
      || componentDigest(output) !== checkpoint.component_digest || output.counts.model_bank_bytes !== checkpoint.model_bank_bytes
      || output.discovery_status !== checkpoint.discovery_status || output.relations_status !== checkpoint.relations_status) fail("checkpoint_invalid");
    const refs = new Map(output.artifacts.map(raw => { const ref = reference.parse(raw); return [ref.file, ref] as const; }));
    const names = ["roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json"];
    const checkedRefs = [manifestRef, ...names.map(name => refs.get(name) ?? fail("artifact_missing"))];
    const checkFiles = async () => { for (const ref of checkedRefs) await checked(directory, ref); };
    await checkFiles();
    if (!same(await json(directory, refs.get("model-components.json")!), output.components)) fail("bank_invalid");
    const components = new Map(output.components.map(component => [component.component_key, component]));
    const units = new Map<string, string>();
    for (const component of output.components) for (const unit of component.units) {
      if (units.has(unit.unit_key)) fail("unit_duplicate"); units.set(unit.unit_key, component.component_key);
    }
    const base = { expected_unit_count: units.size, expected_unit_digest: signalWorkspaceInterpretationUniverseDigestV1([...units.keys()].sort(order)),
      population_digest: output.population_digest };
    const freshCensus = (): WorkspaceIncrementalProjectionFileCensusV1 => ({ ...base, roots: 0, chunks: 0, memberships: 0, pending_roots: 0, pending_occurrences: 0 });
    async function* scan(census: WorkspaceIncrementalProjectionFileCensusV1): AsyncGenerator<WorkspaceIncrementalProjectionFileRootV1> {
      const pop = cursor(lines(join(directory, "population.jsonl"), population));
      const members = cursor(lines(join(directory, "memberships.jsonl"), signalWorkspaceIncrementalMembershipSchemaV1));
      const pending = cursor(lines(join(directory, "pending-cohort.jsonl"), population));
      const populationHash = arrayDigest(); let previousRoot = "", previousMember: Member | null = null;
      try {
        for await (const root of lines(join(directory, "roots.jsonl"), signalWorkspaceIncrementalProjectionRootSchemaV1)) {
          if (root.root_id <= previousRoot) fail("root_order_invalid"); previousRoot = root.root_id;
          const packet: WorkspaceIncrementalProjectionFileRootV1 = { root, chunks: [], memberships: [] };
          let bytes = Buffer.byteLength(JSON.stringify({ ...packet })), end = 0;
          const budget = (row: unknown) => { bytes += Buffer.byteLength(JSON.stringify(row)) + 1; if (bytes > maxRootBytes) fail("root_capacity_exceeded"); };
          budget(null); const coverage = createHash("sha256"), rootUnits = new Set<string>();
          for (let index = 0; index < root.expected_chunks; index++) {
            const row = await pop.take();
            if (!row || row.ordinal !== census.chunks || row.root_id !== root.root_id || row.chunk_index !== index
              || row.start !== end || row.expected_chunks !== root.expected_chunks || row.asset_sha256 !== root.asset_sha256
              || row.root_fingerprint !== root.root_fingerprint) fail("population_invalid");
            end = row.end; populationHash.add(row); census.chunks++;
            const chunk: Chunk = { chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 };
            coverage.update(JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n");
            budget(chunk); packet.chunks.push(chunk);
            if (root.discovery_pending) {
              if (!same(await pending.take(), row)) fail("pending_invalid"); census.pending_occurrences++;
            } else if (await pending.peek() && occurrenceOrder((await pending.peek())!, row) <= 0) fail("pending_invalid");
            while (await members.peek() && occurrenceOrder((await members.peek())!, row) <= 0) {
              const member = (await members.take())!, component = components.get(member.model_component_key);
              if (previousMember && memberOrder(previousMember, member) >= 0) fail("membership_order_invalid"); previousMember = member;
              if (occurrenceOrder(member, row) !== 0 || member.root_fingerprint !== root.root_fingerprint
                || member.start !== chunk.start || member.end !== chunk.end || member.chunk_sha256 !== chunk.chunk_sha256
                || !component || component.lane !== member.lane || !same(component.model_origin, member.model_origin)
                || units.get(member.unit_key) !== component.component_key) fail("membership_invalid");
              assertEvaluation(member, output); budget(member); packet.memberships.push(member); census.memberships++; rootUnits.add(member.unit_key);
            }
          }
          if (`sha256:${coverage.digest("hex")}` !== root.chunk_coverage_digest || !same([...rootUnits].sort(order), root.unit_keys)) fail("root_coverage_invalid");
          census.roots++; if (root.discovery_pending) census.pending_roots++;
          yield packet;
        }
        if (await pop.peek() || await members.peek() || await pending.peek()) fail("stream_incomplete");
        if (populationHash.finish() !== output.population_digest || census.roots !== output.counts.roots
          || census.chunks !== output.counts.occurrences || census.memberships !== output.counts.memberships
          || census.pending_occurrences !== output.counts.pending_occurrences
          || (output.discovery_status === "complete") !== (census.pending_roots === 0)) fail("census_invalid");
        for (const [name, count] of [["roots.jsonl", census.roots], ["population.jsonl", census.chunks],
          ["memberships.jsonl", census.memberships], ["pending-cohort.jsonl", census.pending_occurrences]] as const) {
          if (refs.get(name)!.rows !== undefined && refs.get(name)!.rows !== count) fail("census_invalid");
        }
      } finally { await Promise.allSettled([pop.close(), members.close(), pending.close()]); }
    }
    const census = freshCensus();
    for await (const packet of scan(census)) { void packet; }
    await checkFiles();
    return { manifest: structuredClone(output), census: { ...census }, roots: async function* () {
      try {
        // Files are server-owned immutable scratch. Recheck at pass boundaries,
        // not per root; a changed download never becomes a completed generation.
        await checkFiles(); const replayCensus = freshCensus();
        yield* scan(replayCensus); await checkFiles();
        if (!same(replayCensus, census)) fail("census_invalid");
      } catch (error) { safe(error); }
    } };
  } catch (error) { return safe(error); }
}
