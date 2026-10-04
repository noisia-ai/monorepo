import assert from "node:assert/strict";
import { test } from "node:test";
import { readSignalLabelingReceiptV1 } from "./signal-labeling-receipt-storage";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

test("receipt loader reads the immutable scoped object reference", async () => {
  let request: unknown;
  const body = JSON.stringify({ latency_ms: 42 });
  const storage: WorkspaceEngineStorageV1 = {
    async put() { throw new Error("unexpected_upload"); },
    async get(args: any) {
      request = { workspace_id: args.workspace_id, execution_id: args.execution_id, stored: args.stored };
      const { writeFile } = await import("node:fs/promises");
      await writeFile(args.destination, body, { flag: "wx", mode: 0o600 });
    },
  };
  const result = await readSignalLabelingReceiptV1({ storage, workspace_id: "workspace", run_id: "run",
    storage_key: "private/receipt.parts.json", raw_sha256: "sha256:" + "a".repeat(64), size_bytes: body.length });
  assert.equal(result, body);
  assert.deepEqual(request, { workspace_id: "workspace", execution_id: "run",
    stored: { storage_key: "private/receipt.parts.json", sha256: "sha256:" + "a".repeat(64),
      size_bytes: body.length, media_type: "application/json" } });
});
