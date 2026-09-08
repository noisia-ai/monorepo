import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { basename } from "node:path";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";

const PART_BYTES = 48 * 1024 * 1024;
const hash = (data: Uint8Array) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const digest = /^sha256:[0-9a-f]{64}$/u;
const fileName = /^[a-z][a-z0-9_.-]{0,100}$/u;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const fail = (code: string): never => { throw new Error(`workspace_engine_storage_${code}`); };
type StoredFile = { storage_key: string; sha256: string; size_bytes: number; media_type: string };
type Envelope = { contract_version: "workspace-engine-parts-v1"; sha256: string; size_bytes: number;
  parts: Array<{ key: string; sha256: string; size_bytes: number }> };
export type WorkspaceEngineStorageV1 = {
  put(args: { workspace_id: string; execution_id: string; file: string; sha256: string; size_bytes: number;
    media_type: string }): Promise<StoredFile>;
  get(args: { workspace_id: string; execution_id: string; stored: StoredFile; destination: string }): Promise<void>;
};

async function bytes(response: Response, limit: number): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) { await response.body?.cancel(); return fail("response_too_large"); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const result = await reader.read(); if (result.done) break;
    size += result.value.byteLength; if (size > limit) return fail("response_too_large"); chunks.push(result.value);
  } return Buffer.concat(chunks, size); } finally { await reader.cancel().catch(() => undefined); }
}
const prefixFor = (workspace: string, execution: string) => {
  if (!uuid.test(workspace) || !uuid.test(execution)) return fail("scope_invalid");
  return `workspace-engine/${workspace}/${execution}/`;
};

/** Existing private Supabase corpus bucket, deterministic immutable keys and
 * bounded parts. Models survive worker replacement; no local path becomes a receipt. */
export function createWorkspaceEngineStorageV1(options: {
  url?: string; service_role_key?: string; bucket?: string; fetch?: typeof fetch; timeout_ms?: number;
} = {}): WorkspaceEngineStorageV1 {
  const url = (options.url ?? process.env.SUPABASE_URL ?? "").replace(/\/$/u, "");
  const key = options.service_role_key ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const bucket = options.bucket ?? process.env.SUPABASE_STORAGE_BUCKET_IMPORTS ?? process.env.SUPABASE_STORAGE_BUCKET_CORPUS_FILES ?? "corpus-files";
  if (!url || !key || !/^[A-Za-z0-9._-]+$/u.test(bucket)) return fail("unconfigured");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) return fail("url_invalid");
  const transport = options.fetch ?? fetch;
  const headers: Record<string, string> = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
  const objectUrl = (path: string) => `${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  async function request(endpoint: string, init: RequestInit = {}) {
    let response: Response;
    try { response = await transport(endpoint, { ...init, headers: { ...headers, ...init.headers },
      redirect: "error", signal: AbortSignal.timeout(options.timeout_ms ?? 120000) });
    } catch { return fail("transport_failed"); }
    if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); return fail("unavailable"); }
    return response;
  }
  let checked: Promise<void> | undefined;
  const privateBucket = () => checked ??= (async () => {
    const response = await request(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`);
    if (!response.ok) { await response.body?.cancel(); return fail("bucket_unavailable"); }
    const body = JSON.parse((await bytes(response, 65536)).toString("utf8")) as { public?: boolean; id?: string };
    if (body.public !== false || body.id !== bucket) return fail("bucket_not_private");
  })();
  async function putVerified(path: string, content: Buffer, mediaType: string) {
    const writeUrl = objectUrl(path).replace("/object/authenticated/", "/object/");
    const response = await request(writeUrl, { method: "POST", headers: { "Content-Type": mediaType, "x-upsert": "false" }, body: new Uint8Array(content) });
    const ok = response.ok || [400, 409].includes(response.status);
    await response.body?.cancel();
    if (!ok) return fail("upload_failed");
    // 400 may be a pre-existing object in Supabase; accepting it requires an
    // authenticated byte-for-byte read, never the error status alone.
    const read = await request(objectUrl(path));
    if (!read.ok) { await read.body?.cancel(); return fail("verification_failed"); }
    const actual = await bytes(read, content.length);
    if (actual.length !== content.length || hash(actual) !== hash(content)) return fail("verification_failed");
  }
  return {
    async put(args) {
      await privateBucket();
      const prefix = prefixFor(args.workspace_id, args.execution_id), name = basename(args.file);
      const stat = await lstat(args.file);
      if (!fileName.test(name) || name.includes("..") || !stat.isFile() || stat.size !== args.size_bytes
        || !digest.test(args.sha256) || await hashWorkspaceEngineFileV1(args.file) !== args.sha256) return fail("file_invalid");
      const immutable = `${prefix}${name}.${args.sha256.slice(7)}`;
      const file = await open(args.file, "r");
      const parts: Envelope["parts"] = [];
      try { let offset = 0;
        while (offset < stat.size) {
          const buffer = Buffer.allocUnsafe(Math.min(PART_BYTES, stat.size - offset));
          let received = 0;
          while (received < buffer.length) { const read = await file.read(buffer, received, buffer.length - received, offset + received);
            if (!read.bytesRead) return fail("file_changed"); received += read.bytesRead; }
          const part = { key: `${immutable}.part-${String(parts.length).padStart(6, "0")}`, sha256: hash(buffer), size_bytes: buffer.length };
          await putVerified(part.key, buffer, "application/octet-stream"); parts.push(part); offset += buffer.length;
        }
      } finally { await file.close(); }
      if (await hashWorkspaceEngineFileV1(args.file) !== args.sha256) return fail("file_changed");
      const envelope: Envelope = { contract_version: "workspace-engine-parts-v1", sha256: args.sha256, size_bytes: stat.size, parts };
      const storage_key = `${immutable}.parts.json`;
      await putVerified(storage_key, Buffer.from(JSON.stringify(envelope)), "application/json");
      return { storage_key, sha256: args.sha256, size_bytes: stat.size, media_type: args.media_type };
    },
    async get(args) {
      await privateBucket(); const prefix = prefixFor(args.workspace_id, args.execution_id), ref = args.stored;
      if (!ref.storage_key.startsWith(prefix) || ref.storage_key.slice(prefix.length).includes("/")
        || ref.storage_key.includes("..") || !ref.storage_key.endsWith(`.${ref.sha256.slice(7)}.parts.json`)
        || !digest.test(ref.sha256) || !Number.isSafeInteger(ref.size_bytes) || ref.size_bytes < 0) return fail("reference_invalid");
      const response = await request(objectUrl(ref.storage_key));
      if (!response.ok) { await response.body?.cancel(); return fail("read_failed"); }
      const envelope = JSON.parse((await bytes(response, 1024 * 1024)).toString("utf8")) as Envelope;
      if (envelope.contract_version !== "workspace-engine-parts-v1" || envelope.sha256 !== ref.sha256
        || envelope.size_bytes !== ref.size_bytes || !Array.isArray(envelope.parts)
        || envelope.parts.length !== Math.ceil(ref.size_bytes / PART_BYTES)) return fail("manifest_invalid");
      const file = await open(args.destination, "wx", 0o600); let size = 0;
      const fullHash = createHash("sha256");
      try { for (let index = 0; index < envelope.parts.length; index++) {
        const part = envelope.parts[index]!;
        const expectedKey = `${ref.storage_key.slice(0, -".parts.json".length)}.part-${String(index).padStart(6, "0")}`;
        if (!part || part.key !== expectedKey || !digest.test(part.sha256)
          || part.size_bytes !== Math.min(PART_BYTES, ref.size_bytes - size)) return fail("manifest_invalid");
        const read = await request(objectUrl(part.key));
        if (!read.ok) { await read.body?.cancel(); return fail("read_failed"); }
        const buffer = await bytes(read, part.size_bytes);
        if (buffer.length !== part.size_bytes || hash(buffer) !== part.sha256) return fail("part_invalid");
        let written = 0; while (written < buffer.length) { const result = await file.write(buffer, written, buffer.length - written);
          if (!result.bytesWritten) return fail("write_failed"); written += result.bytesWritten; }
        fullHash.update(buffer); size += buffer.length;
      }
      if (size !== ref.size_bytes || `sha256:${fullHash.digest("hex")}` !== ref.sha256) return fail("digest_invalid");
      await file.sync();
      } finally { await file.close(); }
    }
  };
}
