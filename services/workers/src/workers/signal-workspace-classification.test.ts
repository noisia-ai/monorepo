import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1,
  signalWorkspaceClassificationReuseKeyV1,
  type SignalWorkspaceClassificationIdentityV1,
  type SignalWorkspaceClassificationOutcomeV1
} from "@noisia/query-engine";
import {
  signalWorkspaceClassificationJobV1 as run,
  safeWorkspaceClassificationErrorV1,
  type SignalWorkspaceClassificationChunkV1,
  type SignalWorkspaceClassificationEngineV1,
  type SignalWorkspaceClassificationLeaseV1,
  type SignalWorkspaceClassificationRootV1,
  type SignalWorkspaceClassificationStoresV1
} from "./signal-workspace-classification";

const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const coverageDigest = (chunks: SignalWorkspaceClassificationChunkV1[]) => sha(chunks.map(chunk =>
  JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n").join(""));
const rootIdentity = (root: SignalWorkspaceClassificationRootV1) => ({ root_id: root.root_id,
  fingerprint: root.fingerprint, correction_digest: root.correction_digest });
const identity: SignalWorkspaceClassificationIdentityV1 = {
  contract_version: SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1, workspace_id: id(50),
  engine_key: "fixture-only", engine_version: 1, engine_artifact_digest: sha("fixture artifact"),
  embedding_config_digest: sha("no provider fixture"), catalog_digest: sha("catalog"),
  compiler_digest: sha("compiler"), context_digest: sha("context"), decision_policy_digest: sha("policy")
};

function makeRoot(index: number, count = 1) {
  const chunks: SignalWorkspaceClassificationChunkV1[] = [];
  let offset = 0;
  for (let chunk = 0; chunk < count; chunk++) {
    const text = `root${index} 🌞 chunk${chunk} ${chunk === count - 1 ? "LAST EVIDENCE" : "body"}`.padEnd(1400, ".");
    chunks.push({ chunk_index: chunk, start: offset, end: offset + text.length, chunk_sha256: sha(text), text });
    offset += text.length;
  }
  const root: SignalWorkspaceClassificationRootV1 = { root_id: id(index),
    fingerprint: sha(`root content/provenance ${index}`), correction_digest: sha(`root correction ${index}`),
    asset_sha256: sha(chunks.map(chunk => chunk.text).join("")), expected_chunks: count,
    chunk_coverage_digest: coverageDigest(chunks), reuse_item_id: null };
  return { root, chunks };
}

function fixture() {
  let config = { ...identity }, generation = 1, cursor: string | null = null, active = false, finished = false;
  const inputs = [makeRoot(1), makeRoot(2, 130)];
  let prior = new Map<string, SignalWorkspaceClassificationOutcomeV1>();
  let committed = new Map<string, SignalWorkspaceClassificationOutcomeV1>();
  const engineCalls: string[] = [], chunkReads: string[] = [], copies: string[] = [], failures: string[] = [];
  let crashRoot: string | null = null, decisionCount = 2, skipChunks = false, malformedChunk = false, repartition = false;
  let explicitError = false, crashAfterCommit = false, expectedCoverageWrong = false;
  const lease = (): SignalWorkspaceClassificationLeaseV1 => ({ execution_id: id(100 + generation), workspace_id: config.workspace_id,
    execution_token: id(200 + generation), cursor_root_id: cursor, input_digest: sha(`new input snapshot ${generation}`), identity: { ...config } });
  const outcome = (root: SignalWorkspaceClassificationRootV1, processed: number): SignalWorkspaceClassificationOutcomeV1 => ({
    contract_version: SIGNAL_WORKSPACE_CLASSIFICATION_CONTRACT_V1, root: rootIdentity(root),
    reuse_key: signalWorkspaceClassificationReuseKeyV1(config, rootIdentity(root)),
    resolution_state: explicitError ? "error" : root.root_id === id(1) ? "approved" : "pending",
    has_unresolved_topics: explicitError || root.root_id !== id(1), reason_code: explicitError ? "fixture-error" : "fixture-decision",
    technical_error_code: explicitError ? "fixture-partial" : null, evidence_digest: sha("verified fixture evidence"),
    coverage: { expected_chunks: root.expected_chunks, processed_chunks: processed, chunk_coverage_digest: root.chunk_coverage_digest },
    decisions: root.root_id === id(1) ? Array.from({ length: decisionCount }, (_, index) => ({
      taxonomy_term_id: id(1000 + index), term_key: `fixture_${index}`, definition_revision: 1,
      definition_digest: sha(`definition${index}`), disposition: "approved", resolution_method: "human",
      model_version_id: null, labeling_function_version_id: null, approval_policy_id: null,
      decided_by_user_id: id(60), correction_operation_id: id(3000 + index), score: null,
      evidence_digest: sha(`evidence${index}`), lineage_digest: sha(`lineage${index}`)
    })) : []
  });
  const stores: SignalWorkspaceClassificationStoresV1<object> = {
    claim: async () => { if (finished || active) return null; active = true; return lease(); },
    readRoots: async ({ limit }) => {
      const available = inputs.filter(item => cursor === null || item.root.root_id > cursor);
      const items = available.slice(0, limit).map(({ root }) => {
        const old = prior.get(root.root_id);
        const canReuse = old && old.resolution_state !== "error"
          && old.reuse_key === signalWorkspaceClassificationReuseKeyV1(config, rootIdentity(root));
        return { ...root, chunk_coverage_digest: expectedCoverageWrong ? sha("wrong partition") : root.chunk_coverage_digest,
          reuse_item_id: canReuse ? root.root_id : null };
      });
      return { items, done: available.length === items.length };
    },
    readChunks: async args => {
      chunkReads.push(args.root_id);
      const input = inputs.find(item => item.root.root_id === args.root_id)!;
      const from = (args.after_chunk_index ?? -1) + 1;
      const items = input.chunks.slice(from, from + args.limit).map(chunk => ({ ...chunk }));
      if (malformedChunk && items[0]) items[0].text = "changed private text";
      if (repartition && items.length > 1 && items[0]!.chunk_index === 0) {
        // Identical full text and chunk count, different fragment boundaries.
        const moved = items[0]!.text.slice(-1);
        items[0]!.text = items[0]!.text.slice(0, -1); items[0]!.end--;
        items[0]!.chunk_sha256 = sha(items[0]!.text);
        items[1]!.text = moved + items[1]!.text; items[1]!.start--;
        items[1]!.chunk_sha256 = sha(items[1]!.text);
      }
      return { root_id: args.root_id, asset_sha256: input.root.asset_sha256,
        expected_chunks: input.root.expected_chunks, after_chunk_index: args.after_chunk_index,
        items, next_chunk_index: items.at(-1)?.chunk_index ?? args.after_chunk_index,
        done: from + items.length === input.chunks.length };
    },
    copyRoot: async args => {
      const old = prior.get(args.root_id)!;
      const root = inputs.find(item => item.root.root_id === args.root_id)!.root;
      assert.equal(old.reuse_key, signalWorkspaceClassificationReuseKeyV1(config, rootIdentity(root)));
      copies.push(args.root_id); committed.set(args.root_id, old); cursor = args.root_id; return lease();
    },
    commitRoot: async args => {
      committed.set(args.outcome.root.root_id, args.outcome); cursor = args.outcome.root.root_id;
      if (crashAfterCommit) { crashAfterCommit = false; throw new Error("ambiguous local response after durable root"); }
      return lease();
    },
    finish: async () => { active = false; finished = true; prior = new Map(committed); return { status: "completed", generation }; },
    fail: async args => { failures.push(args.error_code); active = false; }
  };
  const engine: SignalWorkspaceClassificationEngineV1 = { ...identity,
    classifyRoot: async args => {
      engineCalls.push(args.root.root_id);
      if (crashRoot === args.root.root_id) { crashRoot = null; throw new Error("private engine input failed"); }
      let processed = 0;
      if (!skipChunks) for await (const page of args.chunks) {
        processed += page.length;
        if (explicitError) break;
      }
      return outcome(args.root, skipChunks ? args.root.expected_chunks : processed);
    }
  };
  const job = () => ({ id: `local-classification-${generation}`, data: { execution_id: lease().execution_id }, updateProgress: async () => undefined });
  const execute = (extra: Partial<Parameters<typeof run<object>>[1]> = {}) => run(job(), { database: {}, stores, engine, ...extra });
  return { inputs, stores, engine, job, execute, engineCalls, chunkReads, copies, failures,
    committed: () => committed, lastComplete: () => prior, lease,
    next() { generation++; cursor = null; active = false; finished = false; committed = new Map();
      engineCalls.length = 0; chunkReads.length = 0; copies.length = 0; },
    newRoot() { inputs.push(makeRoot(3)); },
    changeRoot() { inputs[1]!.root.fingerprint = sha("changed source/rights fingerprint"); },
    changeCorrection() { inputs[0]!.root.correction_digest = sha("new human correction"); },
    changeContext() { config = { ...config, context_digest: sha("changed context") }; },
    failRoot(root: string) { crashRoot = root; }, manyDecisions() { decisionCount = 1000; },
    skipChunks() { skipChunks = true; }, corruptChunk() { malformedChunk = true; },
    repartition() { repartition = true; }, wrongCoverage() { expectedCoverageWrong = true; },
    explicitError() { explicitError = true; }, crashAfterCommit() { crashAfterCommit = true; }
  };
}

test("native classification has sparse multilabel outcomes and consumes all 130 chunks", async () => {
  const f = fixture(); f.manyDecisions();
  await f.execute();
  assert.equal(f.committed().get(id(1))?.decisions.length, 1000);
  assert.equal(f.committed().get(id(2))?.decisions.length, 0);
  assert.equal(f.committed().get(id(2))?.resolution_state, "pending");
  assert.equal(f.committed().get(id(2))?.coverage.processed_chunks, 130);
  assert.equal(f.chunkReads.filter(root => root === id(2)).length, 2);
  assert.deepEqual(await f.execute(), { execution_id: f.lease().execution_id, replayed: true });
});

test("new generation reuses unchanged metadata only and computes new, corrected and changed roots", async () => {
  const f = fixture(); await f.execute(); f.next(); f.newRoot();
  await f.execute();
  assert.deepEqual(f.copies, [id(1), id(2)]);
  assert.deepEqual(f.engineCalls, [id(3)]);
  assert.deepEqual(f.chunkReads, [id(3)]);
  f.next(); f.changeCorrection(); f.changeRoot(); await f.execute();
  assert.deepEqual(f.copies, [id(3)]);
  assert.deepEqual(f.engineCalls, [id(1), id(2)]);
  f.next(); f.changeContext(); await f.execute();
  assert.equal(f.copies.length, 0);
  assert.deepEqual(f.engineCalls, [id(1), id(2), id(3)]);
});

test("crash after durable root resumes cursor; failed generation preserves last complete", async () => {
  const f = fixture(); f.crashAfterCommit();
  await assert.rejects(f.execute(), /workspace_classification_worker_failed/u);
  assert.equal(f.committed().size, 1); assert.equal(f.lastComplete().size, 0);
  f.engineCalls.length = 0;
  await f.execute(); assert.deepEqual(f.engineCalls, [id(2)]);
  const previous = f.lastComplete(); f.next(); f.changeContext(); f.failRoot(id(2));
  await assert.rejects(f.execute(), /workspace_classification_worker_failed/u);
  assert.equal(f.lastComplete(), previous);
  assert.equal(f.committed().has(id(2)), false);
  await f.execute(); assert.notEqual(f.lastComplete(), previous);
});

test("engine cannot claim full coverage without consuming chunks or accept corrupt input", async () => {
  for (const mode of ["skip", "corrupt", "coverage"] as const) {
    const f = fixture();
    if (mode === "skip") f.skipChunks(); else if (mode === "corrupt") f.corruptChunk(); else f.wrongCoverage();
    await assert.rejects(f.execute(), /workspace_classification_chunk_(coverage_incomplete|integrity_failed)/u);
    assert.equal(f.committed().size, 0);
  }
});

test("same complete text with a different partition cannot impersonate evidence chunks", async () => {
  const f = fixture();
  // Allow one code unit to move between both chunks while retaining <=1400.
  const second = f.inputs[1]!.chunks[1]!;
  second.text = second.text.slice(0, -1); second.end--; second.chunk_sha256 = sha(second.text);
  for (const chunk of f.inputs[1]!.chunks.slice(2)) { chunk.start--; chunk.end--; }
  const source = f.inputs[1]!;
  source.root.asset_sha256 = sha(source.chunks.map(chunk => chunk.text).join(""));
  source.root.chunk_coverage_digest = coverageDigest(source.chunks);
  f.repartition();
  await assert.rejects(f.execute(), /workspace_classification_chunk_coverage_incomplete/u);
  assert.equal(f.committed().has(id(2)), false);
});

test("explicit root errors preserve verified decisions and are never reused", async () => {
  const f = fixture(); f.explicitError();
  await f.execute({ chunk_page_size: 1 });
  assert.equal(f.committed().get(id(1))?.resolution_state, "error");
  assert.equal(f.committed().get(id(1))?.decisions.length, 2);
  assert.equal(f.committed().get(id(2))?.coverage.processed_chunks, 1);
  f.next(); await f.execute({ chunk_page_size: 1 });
  assert.deepEqual(f.engineCalls, [id(1), id(2)]); assert.equal(f.copies.length, 0);
});

test("default dependencies are absent, profile mismatch is closed, and errors stay private", async () => {
  const f = fixture();
  await assert.rejects(run(f.job(), undefined as never), /workspace_classification_dependencies_required/u);
  await assert.rejects(f.execute({ engine: { ...f.engine, engine_version: 2 } }), /workspace_classification_engine_identity_mismatch/u);
  assert.equal(f.engineCalls.length, 0);
  assert.equal(safeWorkspaceClassificationErrorV1(new Error("private SQL/corpus details")), "workspace_classification_worker_failed");
  assert.equal(safeWorkspaceClassificationErrorV1({ code: "workspace_classification_authority_revoked" }), "workspace_classification_authority_revoked");
  assert.equal(safeWorkspaceClassificationErrorV1(new Error("workspace_incremental_projection_inputs_changed")), "workspace_incremental_projection_inputs_changed");
  assert.equal(safeWorkspaceClassificationErrorV1(new Error("workspace_incremental_projection_private text")), "workspace_classification_worker_failed");
  assert.equal(safeWorkspaceClassificationErrorV1({ code: "ECONNRESET" }), "workspace_classification_transport_unavailable");
  assert.equal(safeWorkspaceClassificationErrorV1({ code: "23514", message: "private constraint details" }), "workspace_classification_worker_failed");
  await assert.rejects(f.execute({ stores: { ...f.stores, claim: async () => { throw new Error("secret connection details"); } } }),
    { message: "workspace_classification_worker_failed" });
});

test("checkpoint mutation is rejected while advisory progress failure preserves durable completion", async () => {
  const f = fixture();
  await assert.rejects(f.execute({ stores: { ...f.stores, commitRoot: async args => ({
    ...await f.stores.commitRoot(args), workspace_id: id(999)
  }) } }), /workspace_classification_checkpoint_invalid/u);
  const g = fixture();
  await run({ ...g.job(), updateProgress: async () => { throw new Error("Redis progress is unavailable"); } },
    { database: {}, stores: g.stores, engine: g.engine });
  assert.equal(g.lastComplete().size, 2); assert.equal(g.failures.length, 0);
});

test("two jobs claim once and an oversized outcome fails instead of clipping memberships", async () => {
  const f = fixture();
  const results = await Promise.all([f.execute(), f.execute()]);
  assert.equal(results.filter(result => result && typeof result === "object" && "replayed" in result).length, 1);
  assert.deepEqual(f.engineCalls, [id(1), id(2)]);
  const g = fixture();
  await assert.rejects(g.execute({ engine: { ...g.engine, classifyRoot: async args => ({
    ...await g.engine.classifyRoot(args), reason_code: "x".repeat(8 * 1024 * 1024)
  }) } }), /workspace_classification_outcome_capacity_exceeded/u);
  assert.equal(g.committed().size, 0);
});
