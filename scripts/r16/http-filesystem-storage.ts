import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, readdir, stat, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { dirname, join, resolve, sep } from "node:path";

const MAX_OBJECT_BYTES = 32 * 1024 * 1024;

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_OBJECT_BYTES) throw new Error("object_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

function send(response: import("node:http").ServerResponse, status: number, message = ""): void {
  response.statusCode = status;
  response.end(message);
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("content-length", String(bytes.length));
  response.end(bytes);
}

function resolveObjectPath(root: string, bucket: string, segments: string[]): string {
  let decoded: string[];
  try { decoded = segments.map(segment => decodeURIComponent(segment)); }
  catch { throw new Error("invalid_storage_path"); }
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(bucket) || !decoded.length
    || decoded.some(segment => !/^[A-Za-z0-9._-]{1,160}$/u.test(segment) || segment === "." || segment === "..")) {
    throw new Error("invalid_storage_path");
  }
  const path = resolve(root, bucket, ...decoded);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("invalid_storage_path");
  return path;
}

async function listObjectFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const result: string[] = [];
  for (const entry of entries) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listObjectFiles(join(directory, entry.name), key));
    else if (entry.isFile() && !entry.name.startsWith(".")) result.push(key);
  }
  return result;
}

/** Supabase Storage API emulator backed by fsync'd immutable files, for private R16 synthetic benchmarks. */
export async function startR16HttpFilesystemStorageV1(rootDirectory: string, port = 0): Promise<{
  base_url: string;
  metrics(): { object_puts: number; object_gets: number; bytes_written: number; bytes_read: number };
  close(): Promise<void>;
}> {
  const root = resolve(rootDirectory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const realRoot = await realpath(root);
  const rootStat = await stat(realRoot);
  if (!rootStat.isDirectory()) throw new Error("r16_storage_root_invalid");
  const counters = { object_puts: 0, object_gets: 0, bytes_written: 0, bytes_read: 0 };

  const server: Server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz" && request.method === "GET") return send(response, 200, "ok");

      // Supabase Storage-compatible endpoint subset used by the production Storage adapter.
      const bucketMatch = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(url.pathname);
      if (bucketMatch && request.method === "GET") {
        const bucket = decodeURIComponent(bucketMatch[1]!);
        if (!/^[A-Za-z0-9._-]{1,100}$/u.test(bucket)) return send(response, 404);
        await mkdir(join(realRoot, bucket), { recursive: true, mode: 0o700 });
        return sendJson(response, 200, { id: bucket, public: false });
      }

      const objectMatch = /^\/storage\/v1\/object\/(?!(?:list)\/)(authenticated\/)?([^/]+)\/(.*)$/.exec(url.pathname);
      if (objectMatch) {
        const isRead = Boolean(objectMatch[1]) && request.method === "GET";
        const isWrite = !objectMatch[1] && request.method === "POST";
        const bucket = decodeURIComponent(objectMatch[2]!);
        const destination = resolveObjectPath(realRoot, bucket, objectMatch[3]!.split("/"));
        if (isRead) {
          const bytes = await readFile(destination);
          counters.object_gets++;
          counters.bytes_read += bytes.length;
          response.statusCode = 200;
          response.setHeader("content-length", String(bytes.length));
          response.setHeader("content-type", "application/octet-stream");
          return response.end(bytes);
        }
        if (isWrite) {
          const bytes = await readBody(request);
          counters.object_puts++;
          counters.bytes_written += bytes.length;
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          const temporary = join(dirname(destination), `.${randomUUID()}.tmp`);
          const handle = await open(temporary, "wx", 0o600);
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          try {
            await link(temporary, destination);
            await unlink(temporary);
            const directory = await open(dirname(destination), "r");
            try { await directory.sync(); } finally { await directory.close(); }
            return send(response, 200);
          } catch (error) {
            await unlink(temporary).catch(() => undefined);
            if ((error as NodeJS.ErrnoException).code === "EEXIST") return send(response, 400, "object_exists");
            throw error;
          }
        }
        return send(response, 405);
      }

      const listMatch = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(url.pathname);
      if (listMatch && request.method === "POST") {
        const bucket = decodeURIComponent(listMatch[1]!);
        const input = JSON.parse((await readBody(request)).toString("utf8")) as { prefix?: string; search?: string; limit?: number; offset?: number };
        if (!/^[A-Za-z0-9._-]{1,100}$/u.test(bucket)) return send(response, 400);
        const bucketRoot = resolve(realRoot, bucket);
        const prefix = (input.prefix ?? "").split("/").filter(Boolean).map(part => decodeURIComponent(part));
        if (prefix.some(part => !/^[A-Za-z0-9._-]{1,160}$/u.test(part) || part === "." || part === "..")) return send(response, 400);
        const directory = prefix.length ? resolve(bucketRoot, ...prefix) : bucketRoot;
        if (!directory.startsWith(`${bucketRoot}${sep}`)) return send(response, 400);
        const names = await listObjectFiles(directory);
        const offset = Math.max(0, input.offset ?? 0), limit = Math.min(1_000, Math.max(0, input.limit ?? 1_000));
        return sendJson(response, 200, names.filter(name => !input.search || name.includes(input.search))
          .slice(offset, offset + limit).map(name => ({ name })));
      }

      return send(response, 404);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return send(response, 404, "object_missing");
      const code = error instanceof Error && error.message === "object_too_large" ? "object_too_large" : "internal_storage_error";
      return send(response, code === "object_too_large" ? 413 : 500, code);
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("r16_storage_listen_failed");
  return {
    base_url: `http://127.0.0.1:${address.port}`,
    metrics: () => ({ ...counters }),
    close: () => new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise())),
  };
}
