import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { readBoundReferenceV1, sealStudyFreezeV1, verifyStudyFreezeV1 } from "./study-audit-custody.js";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "r16-study-freeze-"));
  const artifacts = resolve(root, "artifacts");
  const snapshot = resolve(artifacts, "snapshot.json"), source = resolve(artifacts, "source.json");
  const human = resolve(root, "human", "answers.json"), seal = resolve(artifacts, "freeze.json"), receipt = resolve(artifacts, "reads.jsonl");
  await mkdir(artifacts, { mode: 0o700 }); await mkdir(resolve(root, "human"), { mode: 0o700 });
  await writeFile(snapshot, "snapshot fixture", { mode: 0o600 });
  await writeFile(source, "source manifest fixture", { mode: 0o600 });
  await writeFile(human, "human answer fixture", { mode: 0o600 });
  return { root, snapshot, source, human, seal, receipt };
}

test("seal binds study outputs and human reference without reading the human file", async () => {
  const f = await fixture();
  try {
    let readCalls: string[] = [];
    const freeze = await sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      study_ref: { study_id: "study-fixture", execution_id: "execution-fixture", source_digest: sha("source"), output_digest: sha("output") },
      result_refs: [{ role: "snapshot", path: f.snapshot, sha256: sha("snapshot fixture") },
        { role: "source_manifest", path: f.source, sha256: sha("source manifest fixture") }],
      human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }],
      now: () => new Date("2026-11-19T00:00:00.000Z") });
    assert.equal(freeze.human_refs[0]?.expected_sha256, undefined);
    const result = await readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22", receipt_path: f.receipt,
      read_bytes: async path => { readCalls.push(path); return new Uint8Array(await readFile(path)); }, now: () => new Date("2026-11-19T00:01:00.000Z") });
    assert.deepEqual(readCalls, [f.snapshot, f.source, f.human]);
    assert.equal(result.sha256, sha("human answer fixture"));
    assert.equal((await readFile(f.receipt, "utf8")).trim().split("\n").length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("invalid study result digest blocks the human read", async () => {
  const f = await fixture();
  try {
    await sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      study_ref: { study_id: "study-fixture", execution_id: "execution-fixture", source_digest: sha("source"), output_digest: sha("output") },
      result_refs: [{ role: "snapshot", path: f.snapshot, sha256: sha("stale snapshot") },
        { role: "source_manifest", path: f.source, sha256: sha("source manifest fixture") }],
      human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] });
    const readCalls: string[] = [];
    await assert.rejects(readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22", receipt_path: f.receipt,
      read_bytes: async path => { readCalls.push(path); return new Uint8Array(await readFile(path)); } }), /study_freeze_result_digest_mismatch/u);
    assert.deepEqual(readCalls, [f.snapshot]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("tampered seal and unbound reference cannot be read", async () => {
  const f = await fixture();
  try {
    await sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      study_ref: { study_id: "study-fixture", execution_id: "execution-fixture", source_digest: sha("source"), output_digest: sha("output") },
      result_refs: [{ role: "snapshot", path: f.snapshot, sha256: sha("snapshot fixture") },
        { role: "source_manifest", path: f.source, sha256: sha("source manifest fixture") }],
      human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] });
    const sealText = await readFile(f.seal, "utf8");
    await writeFile(f.seal, sealText.replace("execution-fixture", "other-execution"), { mode: 0o600 });
    let reads = 0;
    await assert.rejects(verifyStudyFreezeV1({ seal_path: f.seal, private_root: f.root,
      read_bytes: async path => { reads++; return new Uint8Array(await readFile(path)); } }), /study_freeze_seal_digest_mismatch/u);
    assert.equal(reads, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
