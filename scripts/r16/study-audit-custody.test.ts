import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalJsonDigestV1 } from "./private-json-stream.js";
import { readBoundReferenceV1, sealStudyFreezeV1, verifyStudyFreezeV1 } from "./study-audit-custody.js";

const sha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function fixture() {
  // macOS exposes tmpdir via /var, a system symlink to /private/var; fixture paths use its canonical root.
  const canonicalTempRoot = realpathSync(tmpdir());
  const root = await mkdtemp(resolve(canonicalTempRoot, "r16-study-freeze-"));
  const artifacts = resolve(root, "artifacts");
  const snapshot = resolve(artifacts, "snapshot.json"), source = resolve(artifacts, "source.json");
  const human = resolve(root, "human", "answers.json"), seal = resolve(artifacts, "freeze.json"), receipt = resolve(artifacts, "reads.jsonl");
  await mkdir(artifacts, { mode: 0o700 }); await mkdir(resolve(root, "human"), { mode: 0o700 });
  await writeFile(snapshot, "snapshot fixture", { mode: 0o600 });
  const manifest = { contract_version: "r16-native-audit-source-manifest-v2", study_id: "study-fixture", study_execution_id: "execution-fixture",
    study_execution_status: "completed", study_source_digest: sha("source"),
    source_digests: { study_output: sha("output"), study_output_verified_digest: sha("output") } };
  const snapshotValue = { contract_version: "r16-blind-snapshot-v1", source: { export_contract: "r16-native-audit-export-v2",
    export_digest: canonicalJsonDigestV1(manifest).slice("sha256:".length) } };
  await writeFile(snapshot, JSON.stringify(snapshotValue), { mode: 0o600 });
  await writeFile(source, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(human, "human answer fixture", { mode: 0o600 });
  return { root, snapshot, source, human, seal, receipt, nativeReceipt: resolve(artifacts, "native-receipt.json"), artifacts,
    result_refs: [{ role: "snapshot" as const, path: snapshot, sha256: sha(await readFile(snapshot)) },
      { role: "source_manifest" as const, path: source, sha256: sha(await readFile(source)) }] };
}

test("seal binds study outputs and human reference without reading the human file", async () => {
  const f = await fixture();
  try {
    const readCalls: string[] = [];
    const freeze = await sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      result_refs: f.result_refs,
      human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }],
      now: () => new Date("2026-11-19T00:00:00.000Z") });
    assert.deepEqual(freeze.study_ref, { study_id: "study-fixture", execution_id: "execution-fixture",
      source_digest: sha("source"), output_digest: sha("output") }, "the Native export's raw 64-hex digest is accepted and normalized Study refs are derived");
    assert.equal(freeze.human_refs[0]?.expected_sha256, undefined);
    const result = await readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22", receipt_path: f.receipt,
      read_bytes: async path => { readCalls.push(path); if (path === f.human) assert.match(await readFile(f.receipt, "utf8"), /"status":"intent"/u);
        return new Uint8Array(await readFile(path)); }, now: () => new Date("2026-11-19T00:01:00.000Z") });
    assert.deepEqual(readCalls, [f.snapshot, f.source, f.human]);
    assert.equal(result.sha256, sha("human answer fixture"));
    assert.deepEqual((await readFile(f.receipt, "utf8")).trim().split("\n").map(line => JSON.parse(line).status), ["intent", "completed"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("invalid study result digest blocks the human read", async () => {
  const f = await fixture();
  try {
    await sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      result_refs: f.result_refs,
      human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] });
    await writeFile(f.snapshot, "stale snapshot", { mode: 0o600 });
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
      result_refs: f.result_refs,
      human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] });
    const sealText = await readFile(f.seal, "utf8");
    await writeFile(f.seal, sealText.replace("execution-fixture", "other-execution"), { mode: 0o600 });
    let reads = 0;
    await assert.rejects(verifyStudyFreezeV1({ seal_path: f.seal, private_root: f.root,
      read_bytes: async path => { reads++; return new Uint8Array(await readFile(path)); } }), /study_freeze_seal_digest_mismatch/u);
    assert.equal(reads, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("typed export binding rejects cross-execution refs and non-completed Study exports before human access", async () => {
  for (const tamper of ["cross-execution", "not-completed"] as const) {
    const f = await fixture();
    try {
      const sourceValue = JSON.parse(await readFile(f.source, "utf8"));
      if (tamper === "cross-execution") sourceValue.study_execution_id = "execution-B";
      else sourceValue.study_execution_status = "running";
      const sourceText = JSON.stringify(sourceValue);
      await writeFile(f.source, sourceText, { mode: 0o600 });
      const refs = [f.result_refs[0]!, { ...f.result_refs[1]!, sha256: sha(sourceText) }];
      await assert.rejects(() => sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal,
        allowed_human_root: resolve(f.root, "human"), result_refs: refs,
        human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] }), /export_binding_invalid/u);
      await assert.rejects(readFile(f.seal));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("preflight rejects path aliases, hard links, symlinks and unsafe modes before human access", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: f.artifacts,
      result_refs: f.result_refs, human_refs: [{ key: "human22", role: "human_audit_answers", path: f.snapshot }] }), /paths_must_be_disjoint/u);
    await writeFile(f.nativeReceipt, "synthetic native receipt", { mode: 0o600 });
    const aliases = [f.snapshot, f.source, f.nativeReceipt];
    for (let i = 0; i < aliases.length; i++) {
      const resultPath = aliases[i]!;
      const hardlink = resolve(f.root, "human", `hardlink-${i}.json`); await link(resultPath, hardlink);
      const refs = [...f.result_refs, ...(resultPath === f.nativeReceipt
        ? [{ role: "native_receipt" as const, path: f.nativeReceipt, sha256: sha(await readFile(f.nativeReceipt)) }] : [])];
      await assert.rejects(() => sealStudyFreezeV1({ private_root: f.root, seal_path: resolve(f.root, "artifacts", `freeze-${i}.json`),
        allowed_human_root: resolve(f.root, "human"), result_refs: refs,
        human_refs: [{ key: "human22", role: "human_audit_answers", path: hardlink }] }), /disjoint/u);
    }
    const aliasFreezePath = resolve(f.root, "artifacts", "same-as-snapshot.json"); await link(f.snapshot, aliasFreezePath);
    await assert.rejects(() => sealStudyFreezeV1({ private_root: f.root, seal_path: aliasFreezePath, allowed_human_root: resolve(f.root, "human"),
      result_refs: f.result_refs, human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] }), /disjoint/u);
    const symlinkHuman = resolve(f.root, "human", "symlink.json"); await symlink(f.human, symlinkHuman);
    await assert.rejects(() => sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      result_refs: f.result_refs, human_refs: [{ key: "human22", role: "human_audit_answers", path: symlinkHuman }] }), /symlink/u);
    await chmod(f.human, 0o644);
    await assert.rejects(() => sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      result_refs: f.result_refs, human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] }), /permissions_invalid/u);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("receipt append failure blocks human read and failed reads leave an unresolved intent", async () => {
  const f = await fixture();
  try {
    await sealStudyFreezeV1({ private_root: f.root, seal_path: f.seal, allowed_human_root: resolve(f.root, "human"),
      result_refs: f.result_refs, human_refs: [{ key: "human22", role: "human_audit_answers", path: f.human }] });
    let humanReads = 0;
    const readBytes = async (path: string) => { if (path === f.human) humanReads++; return new Uint8Array(await readFile(path)); };
    await assert.rejects(() => readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22",
      receipt_path: f.snapshot, read_bytes: readBytes }), /disjoint/u);
    const receiptSymlink = resolve(f.root, "artifacts", "receipt-symlink.jsonl"); await symlink(f.receipt, receiptSymlink);
    await assert.rejects(() => readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22",
      receipt_path: receiptSymlink, read_bytes: readBytes }), /symlink/u);
    const receiptHardlink = resolve(f.root, "artifacts", "receipt-hardlink.jsonl"); await link(f.snapshot, receiptHardlink);
    await assert.rejects(() => readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22",
      receipt_path: receiptHardlink, read_bytes: readBytes }), /disjoint/u);
    const unsafeReceipt = resolve(f.root, "artifacts", "unsafe-receipt.jsonl"); await writeFile(unsafeReceipt, "", { mode: 0o644 });
    await assert.rejects(() => readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22",
      receipt_path: unsafeReceipt, read_bytes: readBytes }), /permissions_invalid/u);
    assert.equal(humanReads, 0);
    await mkdir(f.receipt, { mode: 0o700 });
    let reads = 0;
    await assert.rejects(() => readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22", receipt_path: f.receipt,
      read_bytes: async path => { if (path === f.human) reads++; return new Uint8Array(await readFile(path)); } }));
    assert.equal(reads, 0);
    await rm(f.receipt, { recursive: true });
    await assert.rejects(() => readBoundReferenceV1({ private_root: f.root, seal_path: f.seal, reference_key: "human22", receipt_path: f.receipt,
      read_bytes: async path => { if (path === f.human) throw new Error("fixture_read_failed"); return new Uint8Array(await readFile(path)); } }), /fixture_read_failed/u);
    assert.deepEqual((await readFile(f.receipt, "utf8")).trim().split("\n").map(line => JSON.parse(line).status), ["intent"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
