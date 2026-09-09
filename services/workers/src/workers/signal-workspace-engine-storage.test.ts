import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
const scope = { workspace_id: "00000000-0000-4000-8000-000000000001", execution_id: "00000000-0000-4000-8000-000000000002" };
function server(allowedMimeTypes?: readonly string[]) {
  const objects = new Map<string, Uint8Array>(), writes: number[] = [];
  let publicBucket = false, corrupt = false;
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal((init?.headers as Record<string, string>).apikey, "unit-test-key");
    assert.equal(init?.redirect, "error");
    if (url.includes("/bucket/")) return Response.json({ id: "corpus-files", public: publicBucket });
    const path = url.split("/corpus-files/")[1]!;
    if (init?.method === "POST") {
      const body = init.body as Uint8Array; writes.push(body.byteLength);
      if (allowedMimeTypes && !allowedMimeTypes.includes((init.headers as Record<string,string>)["Content-Type"]!)) {
        return Response.json({ error: "InvalidMimeType" }, { status: 400 });
      }
      if (objects.has(path)) return Response.json({ error: "Duplicate" }, { status: 400 });
      objects.set(path, Uint8Array.from(body)); return Response.json({ Key: path });
    }
    const body = objects.get(path);
    if (!body) return new Response("", { status: 404 });
    return new Response(corrupt && path.includes(".part-") ? new Uint8Array(body.length).fill(9) : new Uint8Array(body));
  };
  const storage = createWorkspaceEngineStorageV1({ url: "https://example.supabase.co", service_role_key: "unit-test-key", fetch: transport });
  return { storage, objects, writes, makePublic: () => { publicBucket = true; }, corrupt: () => { corrupt = true; } };
}
test("JSON envelopes roundtrip in a private import bucket with binary-only artifact MIME permission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "noisia-storage-mime-"));
  try {
    const f = server(["text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream"]);
    const file = join(directory, "manifest.json"), payload = '{"contract_version":"workspace-engine-output-v1"}\n';
    await writeFile(file, payload);
    const args = { ...scope, file, size_bytes: Buffer.byteLength(payload),
      sha256: await hashWorkspaceEngineFileV1(file), media_type: "application/json" };
    const stored = await f.storage.put(args);
    assert.equal(stored.media_type, "application/json", "The artifact's logical type must remain intact.");
    assert.equal(f.objects.size, 2, "Both the binary part and its JSON envelope were accepted.");
    const envelope = JSON.parse(Buffer.from(f.objects.get(stored.storage_key)!).toString("utf8"));
    assert.equal(envelope.contract_version, "workspace-engine-parts-v1");
    assert.equal(envelope.sha256, args.sha256); assert.equal(envelope.size_bytes, args.size_bytes);
    assert.deepEqual(await f.storage.put(args), stored, "An existing object still requires exact read verification.");
    const restored = join(directory, "restored.json");
    await f.storage.get({ ...scope, stored, destination: restored });
    assert.equal(await readFile(restored, "utf8"), payload);
    assert.equal(await hashWorkspaceEngineFileV1(restored), args.sha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("private model multipart roundtrip crosses 48MiB and immutable replay verifies bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "noisia-storage-"));
  try { const f = server(), file = join(directory, "model.open.joblib"), payload = Buffer.alloc(49 * 1024 * 1024, 7);
    payload[payload.length - 1] = 31; await writeFile(file, payload);
    const args = { ...scope, file, size_bytes: payload.length, sha256: await hashWorkspaceEngineFileV1(file), media_type: "application/octet-stream" };
    const stored = await f.storage.put(args); assert.equal(f.objects.size, 3); assert.ok(f.writes.every(size => size <= 48 * 1024 * 1024));
    assert.deepEqual(await f.storage.put(args), stored); assert.equal(f.objects.size, 3);
    const destination = join(directory, "restored.joblib"); await f.storage.get({ ...scope, stored, destination });
    assert.equal(await hashWorkspaceEngineFileV1(destination), args.sha256);
    f.corrupt(); await assert.rejects(f.storage.get({ ...scope, stored, destination: join(directory, "invalid.joblib") }), /part_invalid/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("public buckets and foreign artifact references are rejected before model download", async () => {
  const directory = await mkdtemp(join(tmpdir(), "noisia-storage-"));
  try { const file = join(directory, "manifest.json"); await writeFile(file, "{}");
    const args = { ...scope, file, size_bytes: 2, sha256: await hashWorkspaceEngineFileV1(file), media_type: "application/json" };
    const publicServer = server(); publicServer.makePublic();
    await assert.rejects(publicServer.storage.put(args), /bucket_not_private/u); assert.equal(publicServer.writes.length, 0);
    const f = server(), stored = await f.storage.put(args);
    await assert.rejects(f.storage.get({ ...scope, workspace_id: "00000000-0000-4000-8000-000000000003", stored,
      destination: join(directory, "foreign.json") }), /reference_invalid/u);
    await assert.rejects(readFile(join(directory, "foreign.json")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
