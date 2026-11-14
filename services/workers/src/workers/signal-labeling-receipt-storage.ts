import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {createHash} from "node:crypto";
import { buildWorkspaceEngineStorageKeyV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

export async function readSignalLabelingReceiptV1(args: {
  storage: WorkspaceEngineStorageV1;
  workspace_id: string;
  run_id: string;
  storage_key: string;
  raw_sha256: string;
  size_bytes: number;
}) {
  const directory = await mkdtemp(join(tmpdir(), "noisia-labeling-receipt-"));
  const file = join(directory, "receipt.json");
  try {
    await args.storage.get({ workspace_id: args.workspace_id, execution_id: args.run_id,
      stored: { storage_key: args.storage_key, sha256: args.raw_sha256, size_bytes: args.size_bytes,
        media_type: "application/json" }, destination: file });
    const raw=await readFile(file,"utf8");
    if(Buffer.byteLength(raw)!==args.size_bytes
      ||`sha256:${createHash("sha256").update(raw).digest("hex")}`!==args.raw_sha256)
      throw new Error("labeling_raw_receipt_invalid");
    return raw;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** One page is one verified immutable artifact; the DB owns its JSONL/member codec. */
export function createLabelingRawPagesStorageV1(storage: WorkspaceEngineStorageV1) {
  type Scope = { workspace_id: string; run_id: string; page_id: string };
  const reference = (args: Scope & { name: string; raw_sha256: string; size_bytes: number }) => ({
    storage_key: buildWorkspaceEngineStorageKeyV1(args.workspace_id, args.run_id, args.name, args.raw_sha256),
  });
  return {
    reference,
    async store(args: Scope & { name: string; raw_text: string; raw_sha256: string; size_bytes: number }) {
      if (Buffer.byteLength(args.raw_text) !== args.size_bytes || args.size_bytes > 32 * 1024 * 1024
        || `sha256:${createHash("sha256").update(args.raw_text).digest("hex")}` !== args.raw_sha256
        || args.name !== `page-${args.raw_sha256.slice(7)}.jsonl`) throw Error("labeling_raw_page_invalid");
      const directory = await mkdtemp(join(tmpdir(), "noisia-labeling-page-"));
      try {
        const file = join(directory, args.name); await writeFile(file, args.raw_text, { mode: 0o600 });
        const stored = await storage.put({ workspace_id: args.workspace_id, execution_id: args.run_id,
          file, sha256: args.raw_sha256, size_bytes: args.size_bytes, media_type: "application/x-ndjson" });
        if (stored.storage_key !== reference(args).storage_key || stored.sha256 !== args.raw_sha256
          || stored.size_bytes !== args.size_bytes) throw Error("labeling_raw_page_reference_invalid");
        return { storage_key: stored.storage_key, sha256: stored.sha256, size_bytes: stored.size_bytes, verified: true as const };
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async load(args: Scope & { storage_key: string; sha256: string; size_bytes: number }) {
      const name = `page-${args.sha256.slice(7)}.jsonl`;
      if (args.size_bytes < 1 || args.size_bytes > 32 * 1024 * 1024
        || args.storage_key !== buildWorkspaceEngineStorageKeyV1(args.workspace_id, args.run_id, name, args.sha256))
        throw Error("labeling_raw_page_reference_invalid");
      try { return await readSignalLabelingReceiptV1({ storage, workspace_id: args.workspace_id, run_id: args.run_id,
        storage_key: args.storage_key, raw_sha256: args.sha256, size_bytes: args.size_bytes }); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "workspace_engine_storage_object_missing" || !storage.recoverVerifiedPage) throw error;
        const recovered = await storage.recoverVerifiedPage({ workspace_id: args.workspace_id, execution_id: args.run_id,
          name, sha256: args.sha256, size_bytes: args.size_bytes });
        if (!recovered || recovered.storage_key !== args.storage_key || recovered.sha256 !== args.sha256
          || recovered.size_bytes !== args.size_bytes || Buffer.byteLength(recovered.raw_text) !== args.size_bytes
          || `sha256:${createHash("sha256").update(recovered.raw_text).digest("hex")}` !== args.sha256)
          throw Error("labeling_raw_page_recovery_invalid");
        return recovered.raw_text;
      }
    },
  };
}
