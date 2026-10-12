import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {createHash} from "node:crypto";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

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
