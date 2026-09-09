import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { signalWorkspaceIncrementalDigestV1 as digest } from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import { streamWorkspaceIncrementalEditorialEvidenceV1 as streamEvidence,
  type WorkspaceIncrementalEditorialEvidenceArgsV1 } from "./signal-workspace-incremental-editorial-evidence";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const STREAM_NAME = "incremental-editorial-evidence.jsonl", DESCRIPTOR_NAME = "incremental-editorial-evidence.json";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const fail = (code: string): never => { throw new Error(`workspace_incremental_editorial_evidence_storage_${code}`); };
type Stored = Awaited<ReturnType<WorkspaceEngineStorageV1["put"]>>;
export type WorkspaceIncrementalEditorialEvidenceStorageArgsV1 = {
  workspace_id: string; numeric_execution_id: string; scratch_root: string;
  evidence: WorkspaceIncrementalEditorialEvidenceArgsV1; storage: WorkspaceEngineStorageV1;
};

/** Files/storage only. The caller supplies server-authorized sources and storage;
 * successful return is NOT a DB checkpoint, unit claim or spending permission.
 * stream is injectable solely to test this composition independently of numerical
 * fixtures. The production default is the full verified evidence adapter. */
export async function storeWorkspaceIncrementalEditorialEvidenceV1(args: WorkspaceIncrementalEditorialEvidenceStorageArgsV1,
  options: { stream?: typeof streamEvidence } = {}) {
  let attempt: string | undefined;
  try {
    const checkpoint = args.evidence.current.checkpoint;
    if (!uuid.test(args.workspace_id) || !uuid.test(args.numeric_execution_id) || !isAbsolute(args.scratch_root)
      || checkpoint.workspace_id !== args.workspace_id || checkpoint.execution_id !== args.numeric_execution_id) fail("scope_invalid");
    await mkdir(args.scratch_root, { recursive: true, mode: 0o700 });
    attempt = await mkdtemp(join(await realpath(args.scratch_root), "editorial-evidence-"));
    const file = join(attempt, STREAM_NAME), handle = await open(file, "wx", 0o600);
    let rows = 0, bytes = 0, previous = "";
    let descriptor;
    try {
      descriptor = await (options.stream ?? streamEvidence)({ ...args.evidence, write_cluster: async row => {
        const size = Buffer.byteLength(row.jsonl);
        if (row.index !== rows || row.unit_key <= previous || !row.jsonl.endsWith("\n")
          || row.jsonl.indexOf("\n") !== row.jsonl.length - 1 || size > MAX_METADATA_BYTES
          || !Number.isSafeInteger(bytes + size)) fail("stream_invalid");
        await handle.writeFile(row.jsonl); rows++; bytes += size; previous = row.unit_key;
      } });
      await handle.sync();
    } finally { await handle.close(); }
    const { evidence_digest, ...body } = descriptor;
    if (descriptor.contract_version !== "workspace-incremental-editorial-evidence-stream-v1"
      || descriptor.numeric_execution_id !== args.numeric_execution_id || descriptor.numeric_checkpoint_digest !== checkpoint.checkpoint_digest
      || descriptor.numeric_manifest_sha256 !== args.evidence.current.manifest_ref.sha256
      || descriptor.population_digest !== checkpoint.population_digest || evidence_digest !== digest(body)
      || descriptor.stream.rows !== rows || descriptor.stream.bytes !== bytes) fail("descriptor_invalid");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes
      || await hashWorkspaceEngineFileV1(file) !== descriptor.stream.sha256) fail("stream_invalid");
    const stream = await upload(file, descriptor.stream.sha256, bytes, "application/x-ndjson");
    const packet = { contract_version: "workspace-incremental-editorial-evidence-storage-v1" as const,
      workspace_id: args.workspace_id, numeric_execution_id: args.numeric_execution_id, evidence: descriptor, stream };
    const json = JSON.stringify(packet) + "\n", size = Buffer.byteLength(json);
    if (size > MAX_METADATA_BYTES) fail("capacity_exceeded");
    const metadataFile = join(attempt, DESCRIPTOR_NAME), metadata = await open(metadataFile, "wx", 0o600);
    try { await metadata.writeFile(json); await metadata.sync(); } finally { await metadata.close(); }
    const stored = await upload(metadataFile, await hashWorkspaceEngineFileV1(metadataFile), size, "application/json");
    return { ...packet, descriptor: stored };
  } catch (error) {
    if (error instanceof Error && /^(?:workspace_incremental_editorial_evidence(?:_storage)?|workspace_engine_storage)_[a-z_]+$/u.test(error.message)) throw error;
    return fail("failed");
  } finally { if (attempt) await rm(attempt, { recursive: true, force: true }).catch(() => undefined); }

  async function upload(file: string, sha256: string, size_bytes: number, media_type: string): Promise<Stored> {
    const result = await args.storage.put({ workspace_id: args.workspace_id, execution_id: args.numeric_execution_id,
      file, sha256, size_bytes, media_type });
    const name = file.endsWith(STREAM_NAME) ? STREAM_NAME : DESCRIPTOR_NAME;
    const key = `workspace-engine/${args.workspace_id}/${args.numeric_execution_id}/${name}.${sha256.slice(7)}.parts.json`;
    if (result.storage_key !== key || result.sha256 !== sha256 || result.size_bytes !== size_bytes || result.media_type !== media_type)
      fail("reference_invalid");
    return result;
  }
}
