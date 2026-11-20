import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, link, lstat, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { types as utilTypes } from "node:util";

const JSON_CHUNK_CODE_UNITS = 8 * 1024;
const SINK_CHUNK_BYTES = 64 * 1024;

function* stringTokens(value: string): Generator<string> {
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + JSON_CHUNK_CODE_UNITS);
    if (end < value.length) {
      const last = value.charCodeAt(end - 1), next = value.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end++;
    }
    const encoded = JSON.stringify(value.slice(start, end));
    if (encoded === undefined) throw new TypeError("JSON string encoding failed");
    yield encoded.slice(1, -1);
    start = end;
  }
  yield '"';
}

function renderable(value: unknown): boolean {
  return value !== undefined && typeof value !== "function" && typeof value !== "symbol";
}

const unsupportedType = () => new TypeError("native_audit_json_unsupported_type");

function* utf8SafeChunks(value: string, maximumBytes: number): Generator<string> {
  let start = 0, cursor = 0, bytes = 0;
  while (cursor < value.length) {
    const codePoint = value.codePointAt(cursor)!;
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    const nextBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes && bytes + nextBytes > maximumBytes) {
      yield value.slice(start, cursor);
      start = cursor;
      bytes = 0;
    }
    bytes += nextBytes;
    cursor += codeUnits;
  }
  if (start < value.length) yield value.slice(start);
}

function assertSupportedJsonValue(value: unknown, active = new Set<object>()): void {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number" || typeof value === "symbol") return;
  if (typeof value === "function" || typeof value === "bigint") throw unsupportedType();
  if (typeof value !== "object") throw unsupportedType();
  if (utilTypes.isProxy(value)) throw unsupportedType();
  if (utilTypes.isDate(value)) {
    if (Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) throw unsupportedType();
    Date.prototype.toISOString.call(value);
    return;
  }
  const isArray = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw unsupportedType();
  for (const prototypeWithJson of [Object.prototype, ...(isArray ? [Array.prototype] : [])]) {
    const inheritedToJson = Object.getOwnPropertyDescriptor(prototypeWithJson, "toJSON");
    if (inheritedToJson && ("get" in inheritedToJson || "set" in inheritedToJson || typeof inheritedToJson.value === "function")) throw unsupportedType();
  }
  if (active.has(value)) throw unsupportedType();
  active.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || "get" in descriptor || "set" in descriptor || typeof descriptor.value === "function") throw unsupportedType();
      if (isArray && key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))) throw unsupportedType();
    }
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw unsupportedType();
      assertSupportedJsonValue(descriptor.value, active);
    }
  } finally { active.delete(value); }
}

function* jsonTokens(value: unknown, pretty: boolean, stack: Set<object>, depth: number): Generator<string> {
  const item = value;
  if (item === null) { yield "null"; return; }
  if (typeof item === "string") { yield* stringTokens(item); return; }
  if (typeof item === "boolean") { yield item ? "true" : "false"; return; }
  if (typeof item === "number") { yield JSON.stringify(item) ?? "null"; return; }
  if (typeof item === "bigint" || typeof item === "function") throw unsupportedType();
  if (!renderable(item)) return;
  if (typeof item !== "object") return;
  if (utilTypes.isDate(item)) { yield* stringTokens(Date.prototype.toISOString.call(item)); return; }
  if (stack.has(item)) throw new TypeError("Converting circular structure to JSON");
  stack.add(item);
  try {
    const indentation = function* (level: number): Generator<string> {
      if (!pretty) return;
      let spaces = level * 2;
      while (spaces > 0) { const count = Math.min(spaces, JSON_CHUNK_CODE_UNITS); yield " ".repeat(count); spaces -= count; }
    };
    if (Array.isArray(item)) {
      if (item.length === 0) { yield "[]"; return; }
      yield pretty ? "[\n" : "[";
      for (let index = 0; index < item.length; index++) {
        if (index) yield pretty ? ",\n" : ",";
        yield* indentation(depth + 1);
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (descriptor && ("get" in descriptor || "set" in descriptor)) throw unsupportedType();
        const child = descriptor?.value;
        if (typeof child === "function") throw unsupportedType();
        if (!renderable(child)) yield "null";
        else yield* jsonTokens(child, pretty, stack, depth + 1);
      }
      if (pretty) { yield "\n"; yield* indentation(depth); }
      yield "]";
      return;
    }
    const entries: Array<[string, unknown]> = [];
    for (const property of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, property);
      if (!descriptor || "get" in descriptor || "set" in descriptor || typeof descriptor.value === "function") throw unsupportedType();
      const child = descriptor.value;
      if (renderable(child)) entries.push([property, child]);
    }
    if (entries.length === 0) { yield "{}"; return; }
    yield pretty ? "{\n" : "{";
    for (let index = 0; index < entries.length; index++) {
      const [property, child] = entries[index]!;
      if (index) yield pretty ? ",\n" : ",";
      yield* indentation(depth + 1);
      yield* stringTokens(property);
      yield pretty ? ": " : ":";
      yield* jsonTokens(child, pretty, stack, depth + 1);
    }
    if (pretty) { yield "\n"; yield* indentation(depth); }
    yield "}";
  } finally {
    stack.delete(item);
  }
}

/** Emits JSON.stringify-compatible text for approved JSON primitives/plain structures and Date values.
 * Each sink call is at most 64 KiB UTF-8; 8K UTF-16 source chunks cap worst-case escaped string tokens below that.
 * Functions, accessors, proxies, custom prototypes and toJSON methods are rejected without invocation. */
export async function streamJsonV1(value: unknown, sink: (chunk: string) => Promise<void> | void,
  options: { pretty?: boolean; trailing_newline?: boolean } = {}): Promise<void> {
  assertSupportedJsonValue(value);
  await emitJsonV1(value, sink, options);
}

async function emitJsonV1(value: unknown, sink: (chunk: string) => Promise<void> | void,
  options: { pretty?: boolean; trailing_newline?: boolean }): Promise<void> {
  const pretty = options.pretty ?? true;
  let pending: string[] = [], pendingBytes = 0, tokenCount = 0;
  const flush = async () => {
    if (!pendingBytes) return;
    await sink(pending.join(""));
    pending = [];
    pendingBytes = 0;
  };
  for (const token of jsonTokens(value, pretty, new Set(), 0)) {
    for (const chunk of utf8SafeChunks(token, SINK_CHUNK_BYTES)) {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (pendingBytes && pendingBytes + chunkBytes > SINK_CHUNK_BYTES) await flush();
      pending.push(chunk);
      pendingBytes += chunkBytes;
      tokenCount++;
    }
  }
  if (!tokenCount) throw new TypeError("Value is not JSON serializable");
  if (options.trailing_newline) {
    if (pendingBytes && pendingBytes + 1 > SINK_CHUNK_BYTES) await flush();
    pending.push("\n"); pendingBytes++;
  }
  await flush();
}

function arrayIndex(key: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return null;
  const value = Number(key);
  return Number.isSafeInteger(value) && value < 0xffff_ffff && String(value) === key ? value : null;
}

function* canonicalTokens(value: unknown, stack: Set<object>, inArray = false): Generator<string> {
  if (value === null) { yield "null"; return; }
  if (typeof value === "string") { yield* stringTokens(value); return; }
  if (typeof value === "boolean") { yield value ? "true" : "false"; return; }
  if (typeof value === "number") { yield JSON.stringify(value) ?? "null"; return; }
  if (typeof value === "bigint" || typeof value === "function") throw unsupportedType();
  if (!renderable(value)) { if (inArray) yield "null"; return; }
  if (typeof value !== "object") return;
  if (stack.has(value)) throw new TypeError("Converting circular structure to JSON");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      yield "[";
      for (let index = 0; index < value.length; index++) {
        if (index) yield ",";
        yield* canonicalTokens(value[index], stack, true);
      }
      yield "]";
      return;
    }
    // This mirrors Object.fromEntries(Object.entries(x).sort(localeCompare))
    // followed by JSON.stringify: integer-index keys enumerate numerically.
    const localeSorted = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    const integerKeys = localeSorted.filter(([key]) => arrayIndex(key) !== null)
      .sort(([a], [b]) => arrayIndex(a)! - arrayIndex(b)!);
    const otherKeys = localeSorted.filter(([key]) => arrayIndex(key) === null);
    const entries = [...integerKeys, ...otherKeys].filter(([, child]) => renderable(child));
    yield "{";
    for (let index = 0; index < entries.length; index++) {
      if (index) yield ",";
      const [key, child] = entries[index]!;
      yield* stringTokens(key);
      yield ":";
      yield* canonicalTokens(child, stack);
    }
    yield "}";
  } finally {
    stack.delete(value);
  }
}

/** Matches signalWorkspaceEmbeddingDigestV1 for JSON primitives/plain structures, without a normalized copy.
 * Raw Date objects preserve the existing digest behavior as `{}`; serialized manifests normalize Dates first. */
export function canonicalJsonDigestV1(value: unknown): string {
  assertSupportedJsonValue(value);
  const hash = createHash("sha256");
  let wrote = false;
  for (const chunk of canonicalTokens(value, new Set())) { hash.update(chunk, "utf8"); wrote = true; }
  if (!wrote) throw new TypeError("The JSON value has no serializable representation");
  return `sha256:${hash.digest("hex")}`;
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, text: string): Promise<void> {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, null);
    if (bytesWritten <= 0) throw new Error("native_audit_file_write_incomplete");
    offset += bytesWritten;
  }
}

export async function rejectSymlinkComponentsV1(path: string): Promise<void> {
  const components = resolve(path).split(sep).filter(Boolean); let at: string = sep;
  for (const component of components) {
    at = resolve(at, component);
    try { if ((await lstat(at)).isSymbolicLink()) throw new Error("native_audit_symlink_path_rejected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
}

/** Writes a private JSON file through an exclusive temp inode, fsync, and no-overwrite hard-link publication. */
export async function writePrivateJsonFileV1(path: string, value: unknown, privateRoot: string): Promise<void> {
  // Reject unsupported values before any file or directory is created.
  assertSupportedJsonValue(value);
  const absoluteRoot = resolve(privateRoot), absolutePath = resolve(path);
  if (absolutePath === absoluteRoot || !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error("native_audit_paths_must_be_private_r16_data");
  }
  await rejectSymlinkComponentsV1(dirname(absolutePath));
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  await chmod(dirname(absolutePath), 0o700);
  let privateDirectory = dirname(absolutePath);
  while (privateDirectory.startsWith(`${absoluteRoot}${sep}`)) {
    await chmod(privateDirectory, 0o700);
    privateDirectory = dirname(privateDirectory);
  }
  await mkdir(absoluteRoot, { recursive: true, mode: 0o700 });
  await chmod(absoluteRoot, 0o700);
  await rejectSymlinkComponentsV1(absolutePath);
  try { await lstat(absolutePath); throw new Error("native_audit_output_exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const tempPath = `${absolutePath}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
  let file: Awaited<ReturnType<typeof open>> | undefined, published = false, tempStat: { dev: number; ino: number } | undefined;
  try {
    file = await open(tempPath, "wx", 0o600);
    await emitJsonV1(value, chunk => writeAll(file!, chunk), { pretty: true, trailing_newline: true });
    await file.sync();
    tempStat = await file.stat();
    await file.close(); file = undefined;
    await link(tempPath, absolutePath);
    published = true;
    const directory = await open(dirname(absolutePath), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (published && tempStat) {
      try {
        const targetStat = await lstat(absolutePath);
        if (targetStat.dev === tempStat.dev && targetStat.ino === tempStat.ino) await unlink(absolutePath);
      } catch { /* best-effort rollback only for the inode this writer published */ }
    }
    throw error;
  } finally {
    if (file) await file.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
  }
}
