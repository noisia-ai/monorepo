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

test("streaming writer rejects symlink paths and rolls back its exclusive temp file on serialization failure", async () => {
  const root = await privateTestRoot();
  try {
    const outside = join(root, "outside"); await mkdir(outside, { mode: 0o700 });
    const symlinkPath = join(root, "linked"); await symlink(outside, symlinkPath);
    await assert.rejects(writePrivateJsonFileV1(join(symlinkPath, "leak.json"), { safe: true }, root), /symlink_path_rejected/u);

    const target = join(root, "rollback", "failed.json");
    const faulty = { first: "partial bytes", get second(): never { throw new Error("synthetic serialization failure"); } };
    await assert.rejects(writePrivateJsonFileV1(target, faulty, root), /synthetic serialization failure/u);
    await assert.rejects(stat(target), { code: "ENOENT" });
    assert.deepEqual(await readdir(join(root, "rollback")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("virtual JSON stream exceeds Node's max string length with bounded sink chunks", async () => {
  const shared = "x".repeat(1024);
  const itemCost = shared.length + 4;
  const count = Math.ceil((bufferConstants.MAX_STRING_LENGTH + 1) / itemCost) + 2;
  const value = new Array(count).fill(shared);
  let codeUnits = 0, maxChunk = 0, chunks = 0;
  await streamJsonV1(value, chunk => { codeUnits += chunk.length; maxChunk = Math.max(maxChunk, chunk.length); chunks++; }, { pretty: true });
  assert.ok(codeUnits > bufferConstants.MAX_STRING_LENGTH);
  assert.ok(maxChunk <= 64 * 1024 + 32 * 1024, `writer emitted an unexpectedly large sink chunk: ${maxChunk}`);
  assert.ok(chunks < 20_000, `bounded sink coalescing regressed: ${chunks} chunks`);
});
