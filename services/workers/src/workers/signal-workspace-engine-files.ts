import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import {
  SIGNAL_WORKSPACE_ENGINE_INPUT_V1,
  type SignalWorkspaceEngineChunkV1, type SignalWorkspaceEngineGuideV1,
  type SignalWorkspaceEngineInputManifestV1, type SignalWorkspaceEngineSnapshotV1
} from "@noisia/query-engine";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const fail = (reason: string): never => { throw new Error(`workspace_engine_${reason}`); };
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export async function hashWorkspaceEngineFileV1(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

/** Reject symlink escapes as well as lexical traversal. The caller owns both
 * directories; no client-supplied path reaches this function from the API. */
export async function assertWorkspaceEngineDirectoryV1(directory: string, storageRoot: string) {
  if (!isAbsolute(directory) || !isAbsolute(storageRoot)) return fail("storage_path_invalid");
  const root = await realpath(storageRoot), target = await realpath(directory);
  const child = relative(root, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) return fail("storage_path_invalid");
  return target;
}

async function writeAll(file: FileHandle, buffer: Buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) return fail("storage_write_failed");
    offset += bytesWritten;
  }
}
function npyHeader(rows: number, dimensions: number) {
  if (!Number.isSafeInteger(rows) || rows < 0 || dimensions !== 1024) return fail("vector_shape_invalid");
  const dictionary = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rows}, ${dimensions}), }`;
  const padding = (64 - ((10 + Buffer.byteLength(dictionary) + 1) % 64)) % 64;
  const header = Buffer.from(dictionary + " ".repeat(padding) + "\n", "ascii");
  const prefix = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, 0, 0]);
  prefix.writeUInt16LE(header.length, 8);
  return Buffer.concat([prefix, header]);
}
function encodeVector(vector: number[], dimensions: number) {
  if (!Array.isArray(vector) || vector.length !== dimensions) return fail("vector_shape_invalid");
  const bytes = Buffer.allocUnsafe(dimensions * 4);
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    const value = Math.fround(vector[i]!);
    if (!Number.isFinite(value)) return fail("vector_value_invalid");
    bytes.writeFloatLE(value, i * 4); norm += value * value;
  }
  if (!norm) return fail("vector_value_invalid");
  return bytes;
}

/** Spool every prepared fragment directly into a NumPy-compatible matrix. The
 * header and final manifest reconcile population; EOF never silently samples. */
export async function spoolSignalWorkspaceEngineInputV1(args: {
  storage_root: string; directory: string; snapshot: SignalWorkspaceEngineSnapshotV1;
  chunks: AsyncIterable<ReadonlyArray<SignalWorkspaceEngineChunkV1>>;
  guides: AsyncIterable<ReadonlyArray<SignalWorkspaceEngineGuideV1>>;
  onProgress?: (counts: { roots: number; chunks: number; guides: number }) => Promise<void>;
}): Promise<SignalWorkspaceEngineInputManifestV1> {
  const s = args.snapshot;
  if (![s.workspace_id, s.preparation_run_id, s.embedding_run_id].every(value => uuidPattern.test(value))
    || ![s.embedding_config_digest, s.context_digest, s.catalog_digest].every(value => digestPattern.test(value))
    || ![s.roots, s.chunks, s.guides, s.input_revision].every(value => Number.isSafeInteger(value) && value >= 0)
    || s.dimensions !== 1024 || s.chunk_policy_version !== "corpus-text-chunks-v1") return fail("snapshot_invalid");
  if (!isAbsolute(args.directory) || !isAbsolute(args.storage_root)) return fail("storage_path_invalid");
  const storageRoot = await realpath(args.storage_root);
  const parent = await realpath(dirname(args.directory));
  const parentRelative = relative(storageRoot, parent);
  const targetRelative = relative(storageRoot, join(parent, basename(args.directory)));
  if (parentRelative.startsWith("..") || isAbsolute(parentRelative)
    || !targetRelative || targetRelative.startsWith("..") || isAbsolute(targetRelative)) return fail("storage_path_invalid");
  await mkdir(args.directory, { mode: 0o700 });
  const directory = await assertWorkspaceEngineDirectoryV1(args.directory, args.storage_root);
  const files: FileHandle[] = [];
  try {
    for (const name of ["chunks.jsonl", "vectors.npy", "guides.jsonl", "guide-vectors.npy"]) {
      files.push(await open(join(directory, name), "wx", 0o600));
    }
    const [records, vectors, guides, guideVectors] = files as [FileHandle, FileHandle, FileHandle, FileHandle];
    await writeAll(vectors, npyHeader(s.chunks, s.dimensions));
    await writeAll(guideVectors, npyHeader(s.guides, s.dimensions));
    let roots = 0, chunks = 0, guideCount = 0;
    let root: SignalWorkspaceEngineChunkV1 | null = null, index = 0, end = 0;
    let rootHash = createHash("sha256");
    const closeRoot = () => {
      if (root && (index !== root.expected_chunks || `sha256:${rootHash.digest("hex")}` !== root.asset_sha256)) {
        return fail("root_coverage_invalid");
      }
    };
    for await (const page of args.chunks) {
      for (const row of page) {
        if (!uuidPattern.test(row.root_id) || !digestPattern.test(row.root_fingerprint)
          || !digestPattern.test(row.asset_sha256) || !Number.isSafeInteger(row.expected_chunks)
          || row.expected_chunks < 1) return fail("root_identity_invalid");
        if (row.root_id !== root?.root_id) {
          closeRoot();
          if (root && row.root_id <= root.root_id) return fail("root_order_invalid");
          root = row; index = 0; end = 0; roots++; rootHash = createHash("sha256");
        }
        if (row.root_fingerprint !== root.root_fingerprint || row.asset_sha256 !== root.asset_sha256
          || row.expected_chunks !== root.expected_chunks || row.chunk_index !== index || row.start !== end
          || !row.text || row.text.length > 1400 || row.end !== row.start + row.text.length
          || sha(row.text) !== row.chunk_sha256) return fail("chunk_integrity_invalid");
        await writeAll(records, Buffer.from(JSON.stringify({ ordinal: chunks, root_id: row.root_id,
          root_fingerprint: row.root_fingerprint, asset_sha256: row.asset_sha256, expected_chunks: row.expected_chunks,
          chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256,
          text: row.text }) + "\n", "utf8"));
        await writeAll(vectors, encodeVector(row.vector, s.dimensions));
        rootHash.update(row.text, "utf8"); chunks++; index++; end = row.end;
        if (chunks > s.chunks || roots > s.roots) return fail("population_overflow");
      }
      await args.onProgress?.({ roots, chunks, guides: guideCount });
    }
    closeRoot();
    if (roots !== s.roots || chunks !== s.chunks) return fail("population_incomplete");
    const guideIdentities = new Set<string>();
    for await (const page of args.guides) {
      for (const row of page) {
        if (!row.guide_key || row.guide_key.length > 200 || !digestPattern.test(row.input_digest)
          || !["topic_positive", "topic_negative", "scope_positive", "scope_negative"].includes(row.role)) return fail("guide_identity_invalid");
        const identity = JSON.stringify([row.guide_key, row.role, row.input_digest]);
        if (guideIdentities.has(identity)) return fail("guide_duplicate");
        guideIdentities.add(identity);
        await writeAll(guides, Buffer.from(JSON.stringify({ ordinal: guideCount, guide_key: row.guide_key,
          role: row.role, input_digest: row.input_digest }) + "\n", "utf8"));
        await writeAll(guideVectors, encodeVector(row.vector, s.dimensions)); guideCount++;
        if (guideCount > s.guides) return fail("guide_count_invalid");
      }
      await args.onProgress?.({ roots, chunks, guides: guideCount });
    }
    if (guideCount !== s.guides) return fail("guide_count_invalid");
    for (const file of files) await file.sync();
    const { roots: _roots, chunks: _chunks, guides: _guides, dimensions: _dimensions, ...snapshot } = s;
    const manifest: SignalWorkspaceEngineInputManifestV1 = {
      contract_version: SIGNAL_WORKSPACE_ENGINE_INPUT_V1, ...snapshot,
      records: { file: "chunks.jsonl", sha256: await hashWorkspaceEngineFileV1(join(directory, "chunks.jsonl")), rows: chunks, roots },
      vectors: { file: "vectors.npy", sha256: await hashWorkspaceEngineFileV1(join(directory, "vectors.npy")), rows: chunks, dimensions: 1024, dtype: "float32" },
      guides: { file: "guides.jsonl", sha256: await hashWorkspaceEngineFileV1(join(directory, "guides.jsonl")), rows: guideCount },
      guide_vectors: { file: "guide-vectors.npy", sha256: await hashWorkspaceEngineFileV1(join(directory, "guide-vectors.npy")), rows: guideCount, dimensions: 1024, dtype: "float32" }
    };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest) + "\n", { flag: "wx", mode: 0o600 });
    return manifest;
  } finally {
    for (const file of files) await file.close();
  }
}
