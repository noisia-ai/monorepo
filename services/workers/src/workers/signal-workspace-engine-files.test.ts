import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { SIGNAL_WORKSPACE_ENGINE_CONFIG_V1, type SignalWorkspaceEngineChunkV1,
  type SignalWorkspaceEngineSnapshotV1 } from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1, spoolSignalWorkspaceEngineInputV1 } from "./signal-workspace-engine-files";
import { runWorkspaceEngineProcessV1, validateWorkspaceEngineOutputV1 } from "./signal-workspace-engine-process";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function* pages<T>(rows: T[]) { for (const row of rows) yield [row]; }
function fixture(): { snapshot: SignalWorkspaceEngineSnapshotV1; chunks: SignalWorkspaceEngineChunkV1[] } {
  const texts = ["Atención 🚗 primera parte", " y cierre con evidencia."];
  let start = 0;
  return { snapshot: { workspace_id: id(1), input_revision: 1, preparation_run_id: id(2), embedding_run_id: id(3),
    embedding_config_digest: sha("embedding"), context_digest: sha("context"), catalog_digest: sha("catalog"),
    chunk_policy_version: "corpus-text-chunks-v1", roots: 1, chunks: 2, guides: 0, dimensions: 1024,
    config: { ...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 } }, chunks: texts.map((text, chunk_index) => {
      const row = { root_id: id(4), root_fingerprint: sha("provenance"), asset_sha256: sha(texts.join("")),
        expected_chunks: 2, chunk_index, start, end: start + text.length, chunk_sha256: sha(text), text,
        vector: Array.from({ length: 1024 }, (_, n) => n === 0 ? 1 : 0) };
      start = row.end; return row;
    }) };
}
test("full spool reconciles UTF16 fragments and NumPy framing, excluding accidental extra fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "noisia-spool-"));
  try { const f = fixture(); Object.assign(f.chunks[0]!, { private_not_in_contract: "secret" });
    const manifest = await spoolSignalWorkspaceEngineInputV1({ storage_root: root, directory: join(root, "input"),
      ...f, chunks: pages(f.chunks), guides: pages([]) });
    const records = await readFile(join(root, "input", "chunks.jsonl"), "utf8");
    assert.equal(records.includes("secret"), false); assert.equal(records.trim().split("\n").length, 2);
    const matrix = await readFile(join(root, "input", "vectors.npy"));
    const headerEnd = 10 + matrix.readUInt16LE(8);
    assert.equal(headerEnd % 64, 0); assert.equal(matrix.length, headerEnd + 2 * 1024 * 4);
    assert.equal(matrix.readFloatLE(headerEnd), 1); assert.equal(matrix.readFloatLE(headerEnd + 1024 * 4), 1);
    assert.equal(manifest.records.sha256, await hashWorkspaceEngineFileV1(join(root, "input", "chunks.jsonl")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("spool rejects missing chunks, mutated text, zero/NaN vectors and symlink escape before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "noisia-spool-")), outside = await mkdtemp(join(tmpdir(), "noisia-outside-"));
  try {
    for (const [name, mutate] of Object.entries({ missing: (f: ReturnType<typeof fixture>) => f.chunks.pop(),
      text: (f: ReturnType<typeof fixture>) => { f.chunks[1]!.text = "changed"; },
      zero: (f: ReturnType<typeof fixture>) => { f.chunks[0]!.vector.fill(0); },
      nan: (f: ReturnType<typeof fixture>) => { f.chunks[0]!.vector[0] = NaN; } })) {
      const f = fixture(); mutate(f);
      await assert.rejects(spoolSignalWorkspaceEngineInputV1({ storage_root: root, directory: join(root, name),
        snapshot: f.snapshot, chunks: pages(f.chunks), guides: pages([]) }), /workspace_engine_/u);
    }
    await symlink(outside, join(root, "escape"));
    const f = fixture();
    await assert.rejects(spoolSignalWorkspaceEngineInputV1({ storage_root: root, directory: join(root, "escape", "input"),
      snapshot: f.snapshot, chunks: pages(f.chunks), guides: pages([]) }), /storage_path_invalid/u);
    await assert.rejects(readFile(join(outside, "input", "manifest.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test("Node export runs the actual Python contract and detects later output tampering", {
  skip: !process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "noisia-cross-runtime-"));
  try { const f = fixture();
    const input = await spoolSignalWorkspaceEngineInputV1({ storage_root: root, directory: join(root, "input"),
      snapshot: f.snapshot, chunks: pages(f.chunks), guides: pages([]) });
    let heartbeats = 0;
    await runWorkspaceEngineProcessV1({ python: process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON!,
      module_root: resolve("../../tools/signal-semantic-lab/src"), storage_root: root,
      input_directory: join(root, "input"), output_directory: join(root, "output"), timeout_ms: 120000,
      heartbeat: async () => { heartbeats++; } });
    const args = { directory: join(root, "output"), storage_root: root, input,
      input_manifest_sha256: await hashWorkspaceEngineFileV1(join(root, "input", "manifest.json")) };
    const result = await validateWorkspaceEngineOutputV1(args);
    assert.equal(result.status, "insufficient_population"); assert.equal(result.counts.occurrences, 2);
    assert.equal(result.counts.roots, 1); assert.ok(heartbeats >= 2);
    await writeFile(join(root, "output", "roots.jsonl"), "tampered");
    await assert.rejects(validateWorkspaceEngineOutputV1(args), /output_artifact_invalid/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
