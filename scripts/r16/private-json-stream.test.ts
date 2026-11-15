import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1 } from "../../packages/query-engine/src/signal-workspace-embeddings-v1.js";
import { canonicalJsonDigestV1, streamJsonV1, writePrivateJsonFileV1 } from "./private-json-stream.js";

async function privateTestRoot(): Promise<string> {
  const parent = join(process.cwd(), ".data", "piloto-masivo", "r16");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, "private-json-test-"));
}

test("canonical streaming digest matches the v1 digest for dates, undefined, arrays and JS key ordering", () => {
  const value: Record<string, unknown> = { "10": "ten", "2": "two", undefined_value: undefined,
    date: new Date("2026-11-15T12:34:56.789Z"), array: [undefined, , Number.NaN, -0, { b: 2, a: 1 }],
    nested: { zebra: "z", alpha: "a", "12": "numeric" } };
  assert.equal(canonicalJsonDigestV1(value), signalWorkspaceEmbeddingDigestV1(value));
});

test("private JSON writer streams 2 MiB with JSON semantics, mode 0600, fsync publication and no overwrite", async () => {
  const root = await privateTestRoot();
  try {
    const output = join(root, "nested", "snapshot.json"), string = "x".repeat(2 * 1024 * 1024);
    const source = { object: { z: 1, a: "café" }, string, array: [1, undefined, "tail"], date: new Date("2026-11-15T12:34:56.789Z") };
    await writePrivateJsonFileV1(output, source, root);
    const text = await readFile(output, "utf8");
    assert.deepEqual(JSON.parse(text), JSON.parse(`${JSON.stringify(source, null, 2)}\n`));
    assert.equal(text, `${JSON.stringify(source, null, 2)}\n`);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "nested"))).mode & 0o777, 0o700);
    await assert.rejects(writePrivateJsonFileV1(output, { replacement: true }, root), /native_audit_output_exists/u);
    assert.deepEqual((await readdir(join(root, "nested"))).sort(), ["snapshot.json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("streaming JSON preserves split UTF-16 pairs and escapes unpaired surrogates", async () => {
  const value = { text: `${"a".repeat(16_383)}😀\ud800\u2028\nend` };
  let result = "";
  await streamJsonV1(value, chunk => { result += chunk; }, { pretty: true, trailing_newline: true });
  assert.equal(result, `${JSON.stringify(value, null, 2)}\n`);
  assert.deepEqual(JSON.parse(result), value);
});

test("all sink writes stay within 64 KiB even when every source character expands to six JSON bytes", async () => {
  const control = "\u0001".repeat(20_000), value = { [control]: control };
  let output = "", maximumBytes = 0;
  await streamJsonV1(value, chunk => {
    const bytes = Buffer.byteLength(chunk, "utf8");
    maximumBytes = Math.max(maximumBytes, bytes);
    output += chunk;
  }, { pretty: true });
  assert.ok(maximumBytes <= 64 * 1024);
  assert.equal(output, JSON.stringify(value, null, 2));
  assert.deepEqual(JSON.parse(output), value);
});

test("unsupported methods, accessors and boxed primitives fail without invocation or publication", async () => {
  const root = await privateTestRoot();
  try {
    let invoked = false;
    const withToJson = { value: "synthetic", toJSON() { invoked = true; return "changed"; } };
    const withGetter = Object.defineProperty({}, "value", { enumerable: true, get() { invoked = true; return "changed"; } });
    const boxed = new Number(7);
    const before = await readdir(root);
    for (const [index, value] of [withToJson, withGetter, boxed].entries()) {
      await assert.rejects(writePrivateJsonFileV1(join(root, `unsupported-${index}.json`), value, root), /native_audit_json_unsupported_type/u);
      assert.throws(() => canonicalJsonDigestV1(value), /native_audit_json_unsupported_type/u);
    }
    assert.equal(invoked, false);
    assert.deepEqual(await readdir(root), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("streaming writer rejects symlink paths and rolls back its owned temp file after a mid-write type change", async () => {
  const root = await privateTestRoot();
  try {
    const outside = join(root, "outside"); await mkdir(outside, { mode: 0o700 });
    const symlinkPath = join(root, "linked"); await symlink(outside, symlinkPath);
    await assert.rejects(writePrivateJsonFileV1(join(symlinkPath, "leak.json"), { safe: true }, root), /symlink_path_rejected/u);

    const target = join(root, "rollback", "failed.json");
    const faulty: Record<string, unknown> = { large: "x".repeat(2 * 1024 * 1024), later: "initially valid" };
    let mutated = false, getterInvoked = false;
    const write = writePrivateJsonFileV1(target, faulty, root);
    setTimeout(() => {
      Object.defineProperty(faulty, "later", { configurable: true, enumerable: true, get() { getterInvoked = true; return "unsafe"; } });
      mutated = true;
    }, 0);
    await assert.rejects(write, /native_audit_json_unsupported_type/u);
    assert.equal(mutated, true);
    assert.equal(getterInvoked, false);
    await assert.rejects(stat(target), { code: "ENOENT" });
    assert.deepEqual(await readdir(join(root, "rollback")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("virtual JSON stream exceeds Node's max string length with bounded sink chunks", async () => {
  const shared = "x".repeat(1024);
  const itemCost = shared.length + 4;
  const count = Math.ceil((bufferConstants.MAX_STRING_LENGTH + 1) / itemCost) + 2;
  const value = new Array(count).fill(shared);
  let codeUnits = 0, maxChunkBytes = 0, chunks = 0;
  await streamJsonV1(value, chunk => { codeUnits += chunk.length; maxChunkBytes = Math.max(maxChunkBytes, Buffer.byteLength(chunk)); chunks++; }, { pretty: true });
  assert.ok(codeUnits > bufferConstants.MAX_STRING_LENGTH);
  assert.ok(maxChunkBytes <= 64 * 1024, `writer emitted an unexpectedly large sink chunk: ${maxChunkBytes} bytes`);
  assert.ok(chunks < 20_000, `bounded sink coalescing regressed: ${chunks} chunks`);
});
