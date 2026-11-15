import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, link, lstat, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const JSON_CHUNK_CODE_UNITS = 16 * 1024;
const SINK_CHUNK_CODE_UNITS = 64 * 1024;

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

function preparedJsonValue(value: unknown, key: string): unknown {
  if ((typeof value === "object" && value !== null) || typeof value === "bigint") {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") return toJSON.call(value, key);
  }
  return value;
}

function renderable(value: unknown): boolean {
  return value !== undefined && typeof value !== "function" && typeof value !== "symbol";
}

function* jsonTokens(value: unknown, pretty: boolean, stack: Set<object>, depth: number, key: string, prepared = false): Generator<string> {
  const item = prepared ? value : preparedJsonValue(value, key);
  if (item === null) { yield "null"; return; }
  if (typeof item === "string") { yield* stringTokens(item); return; }
  if (typeof item === "boolean") { yield item ? "true" : "false"; return; }
  if (typeof item === "number") { yield JSON.stringify(item) ?? "null"; return; }
  if (typeof item === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  if (!renderable(item)) return;
  if (typeof item !== "object") return;
  if (stack.has(item)) throw new TypeError("Converting circular structure to JSON");
  stack.add(item);
  try {
    const indent = (level: number) => pretty ? "  ".repeat(level) : "";
    if (Array.isArray(item)) {
      if (item.length === 0) { yield "[]"; return; }
      yield pretty ? "[\n" : "[";
      for (let index = 0; index < item.length; index++) {
        if (index) yield pretty ? ",\n" : ",";
        if (pretty) yield indent(depth + 1);
        const child = preparedJsonValue(item[index], String(index));
        if (!renderable(child)) yield "null";
        else yield* jsonTokens(child, pretty, stack, depth + 1, String(index), true);
      }
      yield pretty ? `\n${indent(depth)}]` : "]";
      return;
    }
    const entries: Array<[string, unknown]> = [];
    for (const property of Object.keys(item)) {
      const child = preparedJsonValue((item as Record<string, unknown>)[property], property);
      if (renderable(child)) entries.push([property, child]);
    }
    if (entries.length === 0) { yield "{}"; return; }
    yield pretty ? "{\n" : "{";
    for (let index = 0; index < entries.length; index++) {
      const [property, child] = entries[index]!;
      if (index) yield pretty ? ",\n" : ",";
      if (pretty) yield indent(depth + 1);
      yield* stringTokens(property);
      yield pretty ? ": " : ":";
      yield* jsonTokens(child, pretty, stack, depth + 1, property, true);
    }
    yield pretty ? `\n${indent(depth)}}` : "}";
  } finally {
    stack.delete(item);
  }
}

/** Emits JSON.stringify-compatible text in bounded chunks without creating one full serialized string. */
export async function streamJsonV1(value: unknown, sink: (chunk: string) => Promise<void> | void,
  options: { pretty?: boolean; trailing_newline?: boolean } = {}): Promise<void> {
  const pretty = options.pretty ?? true;
  let pending: string[] = [], pendingLength = 0, tokenCount = 0;
  const flush = async () => {
    if (!pendingLength) return;
    await sink(pending.join(""));
    pending = [];
    pendingLength = 0;
  };
  for (const token of jsonTokens(value, pretty, new Set(), 0, "")) {
    if (pendingLength && pendingLength + token.length > SINK_CHUNK_CODE_UNITS) await flush();
    pending.push(token);
    pendingLength += token.length;
    tokenCount++;
  }
  if (!tokenCount) throw new TypeError("Value is not JSON serializable");
  if (options.trailing_newline) { pending.push("\n"); pendingLength++; }
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
  if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
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

/** Matches signalWorkspaceEmbeddingDigestV1 while hashing canonical JSON incrementally. */
export function canonicalJsonDigestV1(value: unknown): string {
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
    await streamJsonV1(value, chunk => writeAll(file!, chunk), { pretty: true, trailing_newline: true });
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
