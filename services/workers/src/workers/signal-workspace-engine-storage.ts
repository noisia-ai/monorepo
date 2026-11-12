import { createHash } from "node:crypto";
import { lstat, open, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
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
  /** Verify configured private storage before a new paid send. No artifact is written. */
  assertReady?(): Promise<void>;
  /** Recover deterministic immutable receipt bytes only after checking their full hash. */
  recoverIncomplete?(args: { workspace_id: string; execution_id: string; name: string; max_bytes: number }):
    Promise<(StoredFile & { raw_text: string }) | null>;
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
  url?: string; service_role_key?: string; bucket?: string; fetch?: typeof fetch; timeout_ms?: number; retry_429_min_delay_ms?: number;
} = {}): WorkspaceEngineStorageV1 {
  const url = (options.url ?? process.env.SUPABASE_URL ?? "").replace(/\/$/u, "");
  const key = options.service_role_key ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const bucket = options.bucket ?? process.env.SUPABASE_STORAGE_BUCKET_IMPORTS ?? process.env.SUPABASE_STORAGE_BUCKET_CORPUS_FILES ?? "corpus-files";
  if (!url || !key || !/^[A-Za-z0-9._-]+$/u.test(bucket)) return fail("unconfigured");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) return fail("url_invalid");
  const transport = options.fetch ?? fetch;
  const minimum429Delay = options.retry_429_min_delay_ms ?? 0;
  if (!Number.isSafeInteger(minimum429Delay) || minimum429Delay < 0 || minimum429Delay > 30_000) return fail("retry_delay_invalid");
  const headers: Record<string, string> = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
  const objectUrl = (path: string) => `${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  async function request(endpoint: string, init: RequestInit = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response: Response;
      try { response = await transport(endpoint, { ...init, headers: { ...headers, ...init.headers },
        redirect: "error", signal: AbortSignal.timeout(options.timeout_ms ?? 120000) });
      } catch {
        if (attempt === 3) return fail("transport_failed");
        await delay(250 * 2 ** attempt + Math.floor(Math.random() * 250)); continue;
      }
      if (response.status !== 429 && response.status < 500) return response;
      const retryAfter = response.headers.get("retry-after");
      await response.body?.cancel();
      if (attempt === 3) return fail("unavailable");
      const requestedDelay = retryAfter === null ? 0 : /^\d+(?:\.\d+)?$/u.test(retryAfter)
        ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
      // A longer server window stays closed until the next storage recovery.
      if (!Number.isFinite(requestedDelay) || requestedDelay > 30_000) return fail("unavailable");
      const minimumDelay = response.status === 429 && retryAfter === null ? minimum429Delay : 0;
      await delay(Math.max(requestedDelay, minimumDelay, 250 * 2 ** attempt) + Math.floor(Math.random() * 250));
    }
    return fail("unavailable");
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
  const storage: WorkspaceEngineStorageV1 = {
    async recoverIncomplete(args) {
      await privateBucket();
      const prefix = prefixFor(args.workspace_id, args.execution_id);
      if (!/^response-[0-9a-f-]{36}\.json$/u.test(args.name)
        || !Number.isSafeInteger(args.max_bytes) || args.max_bytes < 1 || args.max_bytes > 8 * 1024 * 1024) return fail("recovery_scope_invalid");
      const response = await request(`${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: prefix.slice(0, -1), search: `${args.name}.`, limit: 1000, offset: 0,
          sortBy: { column: "name", order: "asc" } }),
      });
      if (!response.ok) { await response.body?.cancel(); return fail("recovery_list_failed"); }
      const objects: unknown = JSON.parse((await bytes(response, 1024 * 1024)).toString("utf8"));
      if (!Array.isArray(objects) || objects.length >= 1000) return fail("recovery_list_invalid");
      const names = objects.map(object => object?.name).filter((name): name is string => typeof name === "string" && name.startsWith(`${args.name}.`));
      if (!names.length) return null;
      const suffixes = names.map(name => name.slice(args.name.length + 1));
      if (suffixes.some(suffix => !/^[0-9a-f]{64}\.(?:part-[0-9]{6}|parts\.json)$/u.test(suffix))) return fail("recovery_reference_invalid");
      const hashes = [...new Set(suffixes.map(suffix => suffix.slice(0, 64)))];
      if (hashes.length !== 1) return fail("recovery_ambiguous");
      const fullSha = `sha256:${hashes[0]}`, base = `${args.name}.${hashes[0]}`;
      const parts = names.filter(name => name.includes(".part-")).sort();
      if (!parts.length) return fail("recovery_incomplete");
      const chunks: Buffer[] = []; let size = 0;
      for (const [index, part] of parts.entries()) {
        if (part !== `${base}.part-${String(index).padStart(6, "0")}`) return fail("recovery_incomplete");
        const read = await request(objectUrl(`${prefix}${part}`));
        if (!read.ok) { await read.body?.cancel(); return fail("recovery_read_failed"); }
        const content = await bytes(read, Math.min(PART_BYTES, args.max_bytes - size));
        size += content.length;
        if (!content.length || index < parts.length - 1 && content.length !== PART_BYTES) return fail("recovery_incomplete");
        chunks.push(content);
      }
      const content = Buffer.concat(chunks, size);
      if (hash(content) !== fullSha) return fail("recovery_digest_invalid");
      const raw_text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      const directory = await mkdtemp(join(tmpdir(), "noisia-receipt-recovery-"));
      try {
        const file = join(directory, args.name);
        await writeFile(file, content, { mode: 0o600 });
        const stored = await storage.put({ workspace_id: args.workspace_id, execution_id: args.execution_id,
          file, sha256: fullSha, size_bytes: size, media_type: "application/json" });
        return { ...stored, raw_text };
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    assertReady: privateBucket,
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
      // The private imports bucket permits binary artifacts. The envelope stays
      // JSON bytes; its transport MIME does not change the original artifact type.
      await putVerified(storage_key, Buffer.from(JSON.stringify(envelope)), "application/octet-stream");
      return { storage_key, sha256: args.sha256, size_bytes: stat.size, media_type: args.media_type };
    },
    async get(args) {
      await privateBucket(); const prefix = prefixFor(args.workspace_id, args.execution_id), ref = args.stored;
      if (!ref.storage_key.startsWith(prefix) || ref.storage_key.slice(prefix.length).includes("/")
        || ref.storage_key.includes("..") || !ref.storage_key.endsWith(`.${ref.sha256.slice(7)}.parts.json`)
        || !digest.test(ref.sha256) || !Number.isSafeInteger(ref.size_bytes) || ref.size_bytes < 0) return fail("reference_invalid");
      const response = await request(objectUrl(ref.storage_key));
      if (response.status === 404) { await response.body?.cancel(); return fail("object_missing"); }
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
        if (read.status === 404) { await read.body?.cancel(); return fail("object_missing"); }
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
  return storage;
}
