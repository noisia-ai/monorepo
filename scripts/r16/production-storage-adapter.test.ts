import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceEngineStorageV1 } from "../../services/workers/src/workers/signal-workspace-engine-storage";
import { startR16HttpFilesystemStorageV1 } from "./http-filesystem-storage";

test("R16 local HTTP storage emulator runs the production storage adapter, including part manifest and readback", async t => {
  const root = await mkdtemp(join(tmpdir(), "r16-product-storage-"));
  const server = await startR16HttpFilesystemStorageV1(join(root, "objects"));
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });

  const workspaceId = randomUUID(), executionId = randomUUID();
  const raw = Buffer.from('{"contract_version":"synthetic-r16","row":1}\n');
  const sha256 = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  const input = join(root, "source.jsonl"), output = join(root, "readback.jsonl");
  await writeFile(input, raw, { mode: 0o600 });
  const storage = createWorkspaceEngineStorageV1({ url: server.base_url, service_role_key: "r16-local-synthetic", bucket: "r16bench" });
  await storage.assertReady?.();
  const stored = await storage.put({ workspace_id: workspaceId, execution_id: executionId,
    file: input, sha256, size_bytes: raw.length, media_type: "application/x-ndjson" });
  await storage.get({ workspace_id: workspaceId, execution_id: executionId, stored, destination: output });
  assert.deepEqual(await readFile(output), raw);
});
