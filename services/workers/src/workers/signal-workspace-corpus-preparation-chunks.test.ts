import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { prepareWorkspaceCorpusTextChunksV1 } from "./signal-workspace-corpus-preparation-chunks";

function hash(text: string) { return `sha256:${createHash("sha256").update(text).digest("hex")}`; }

test("preparation covers the full sealed text beyond 80 chunks without changing whitespace", () => {
  const text = "  Evidence\twith \n whitespace 🌎.\r\n".repeat(5_000);
  const prepared = prepareWorkspaceCorpusTextChunksV1(text, hash(text));
  assert.ok(prepared.chunks.length > 80);
  let cursor = 0;
  for (const chunk of prepared.chunks) {
    assert.equal(chunk.start, cursor);
    assert.ok(chunk.end > chunk.start && chunk.end - chunk.start <= 1_400);
    assert.equal(hash(text.slice(chunk.start, chunk.end)), chunk.sha256);
    cursor = chunk.end;
  }
  assert.equal(cursor, text.length);
  assert.equal(prepared.chunks.map(({ start, end }) => text.slice(start, end)).join(""), text);
  assert.equal(prepared.text_sha256, hash(text));
  assert.equal(prepared.code_units, text.length);
  assert.ok(prepared.chunks.every((chunk) => !Object.hasOwn(chunk, "text")));
  assert.deepEqual(prepareWorkspaceCorpusTextChunksV1(text, hash(text)), prepared);
});

test("preparation does not split surrogate pairs at a chunk boundary", () => {
  const text = `${"x".repeat(1_399)}🌎${"y".repeat(1_399)}🚙`;
  const prepared = prepareWorkspaceCorpusTextChunksV1(text, hash(text));
  assert.equal(prepared.chunks[0]?.end, 1_399);
  for (const chunk of prepared.chunks) {
    const value = text.slice(chunk.start, chunk.end);
    assert.equal(Buffer.from(value).toString("utf8"), value);
  }
  assert.equal(prepared.chunks.map(({ start, end }) => text.slice(start, end)).join(""), text);
});

test("preparation rejects changed asset bytes instead of generating metadata for another text", () => {
  assert.throws(() => prepareWorkspaceCorpusTextChunksV1("changed", hash("original")),
    /corpus_preparation_asset_hash_mismatch/u);
  assert.throws(() => prepareWorkspaceCorpusTextChunksV1("changed", "hash-from-client"),
    /corpus_preparation_asset_hash_mismatch/u);
  assert.deepEqual(prepareWorkspaceCorpusTextChunksV1("", hash("")).chunks, []);
});
