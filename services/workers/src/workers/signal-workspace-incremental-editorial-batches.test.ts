import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchSignalWorkspaceInterpretationV1, signalWorkspaceEmbeddingDigestV1 as digest,
  signalWorkspaceInterpretationUniverseDigestV1, signalWorkspaceInterpretationReferenceIdV1,
  type SignalWorkspaceInterpretationClusterV1 } from "@noisia/query-engine";
import { stageWorkspaceIncrementalEditorialBatchesV1 as stage, prepareWorkspaceIncrementalEditorialBatchReaderV1 as restore } from "./signal-workspace-incremental-editorial-batches";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import type { WorkspaceIncrementalEditorialEvidenceDescriptorV1 as Descriptor } from "./signal-workspace-incremental-editorial-evidence";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (body: string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const context = { workspace_id: id(1), execution_id: id(2), context_digest: digest("context"), data: { brand: "Local fixture" } };
async function fixture(count = 9, large = false) {
  const directory = await mkdtemp(join(tmpdir(), "noisia-editorial-batches-")), path = join(directory, "evidence.jsonl");
  const clusters: SignalWorkspaceInterpretationClusterV1[] = [], units: Descriptor["units"] = [];
  const text = large ? "🙂" + "a".repeat(1398) : "La conversación trata sobre la atención recibida.";
  const model_origin = { execution_id: id(3), model_artifact_sha256: sha("model") }, component_key = sha("component");
  for (let i = 0; i < count; i++) {
    const unit_key = `open:unit_${String(i).padStart(6, "0")}`, cluster_digest = sha(`current${i}`);
    units.push({ unit_key, local_label: i, component_key, model_origin, birth_membership_digest: sha(`birth${i}`), lane: "open",
      status: "evidence_ready", root_count: 10, chunk_count: 10, cluster_digest });
    const representatives = Array.from({ length: large ? 10 : 1 }, (_, r) => {
      const key = { root_id: id(100 + r), chunk_index: i, start: i * text.length, end: (i + 1) * text.length, chunk_sha256: sha(text) };
      return { ...key, ref_id: signalWorkspaceInterpretationReferenceIdV1(key), text, strength: 0.9, selection_reason: "high_affiliation" as const };
    });
    clusters.push({ cluster_id: unit_key, cluster_digest, lane: "open", root_count: 10, chunk_count: 10,
      terms: ["atención"], representatives });
  }
  const body = clusters.map((cluster, index) => JSON.stringify({ contract_version: "workspace-incremental-editorial-evidence-unit-v1",
    unit: units[index], cluster }) + "\n").join("");
  await writeFile(path, body, { mode: 0o600 });
  const unsigned: Omit<Descriptor, "evidence_digest"> = { contract_version: "workspace-incremental-editorial-evidence-stream-v1",
    numeric_execution_id: "abcdef01-0000-4000-8000-000000000004", numeric_checkpoint_digest: sha("checkpoint"), numeric_manifest_sha256: sha("manifest"),
    population_digest: sha("population"), representative_selection_policy: "distinct-roots-affiliation-boundary-v1",
    census: { roots: 10, chunks: count * 10, memberships: count * 10, pending_roots: 0, pending_occurrences: 0,
      expected_unit_count: count, expected_unit_digest: signalWorkspaceInterpretationUniverseDigestV1(units.map(u => u.unit_key)), population_digest: sha("population") },
    origins: [{ execution_id: id(3), manifest_sha256: sha("birth manifest"), candidate_sha256: sha("candidates") }], units, numeric_component_order: [component_key],
    target_unit_digest: signalWorkspaceInterpretationUniverseDigestV1(units.map(u => u.unit_key)),
    target_binding_digest: digest(units.map(({ component_key, local_label, unit_key, birth_membership_digest, model_origin }) =>
      ({ component_key, unit: { local_label, unit_key, birth_membership_digest }, model_origin }))),
    stream: { contract_version: "workspace-incremental-editorial-evidence-jsonl-v1", rows: count, bytes: Buffer.byteLength(body), sha256: sha(body) } };
  return { directory, path, clusters, body, descriptor: { ...unsigned, evidence_digest: digest(unsigned) },
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function seal(descriptor: Descriptor) {
  const { evidence_digest: _digest, ...unsigned } = descriptor; descriptor.evidence_digest = digest(unsigned);
}

test("staged batches preserve the exact existing algorithm and replay bytes; no provider or repair authority", async () => {
  const f = await fixture();
  try {
    const expected = [...batchSignalWorkspaceInterpretationV1(context, f.clusters)], output: string[] = [];
    let active = 0, maximum = 0;
    const plan = await stage({ ...f, context, write_batch: async row => {
      active++; maximum = Math.max(active, maximum); assert.equal(row.index, output.length);
      assert.deepEqual(row.batch, expected[row.index]); assert.equal(row.batch.configuration.model, "claude-sonnet-4-6");
      output.push(row.jsonl); await Promise.resolve(); active--;
    } });
    assert.equal(plan.batches, expected.length); assert.equal(plan.units, 9); assert.equal(maximum, 1);
    assert.equal(plan.stream.sha256, sha(output.join(""))); assert.equal(plan.stream.bytes, Buffer.byteLength(output.join("")));
    const bytes = Buffer.from(output.join(""));
    assert.deepEqual(plan.requests.flatMap(row => row.unit_keys), f.clusters.map(cluster => cluster.cluster_id));
    for (const row of plan.requests) {
      assert.equal(row.request_digest, expected[row.index]!.request_digest);
      assert.equal(row.batch_key, expected[row.index]!.batch_key);
      assert.equal(row.reserved_micro_usd, expected[row.index]!.reserved_micro_usd);
      assert.equal(row.sha256, sha(bytes.subarray(row.offset, row.offset + row.size_bytes).toString("utf8")));
      assert.equal(row.offset + row.size_bytes, plan.requests[row.index + 1]?.offset ?? bytes.length);
    }
    const replay: string[] = [];
    assert.deepEqual(await stage({ ...f, context, write_batch: async row => { replay.push(row.jsonl); } }), plan);
    assert.deepEqual(replay, output);
    const batchFile = join(f.directory, "batches.jsonl"); await writeFile(batchFile, output.join(""));
    const mutablePlan = structuredClone(plan), mutableContext = structuredClone(context);
    const restored = await restore({ path: batchFile, plan: mutablePlan, context: mutableContext });
    mutablePlan.requests.length = 0; mutableContext.data.brand = "changed"; restored.plan.requests.length = 0;
    assert.deepEqual([...restored.batches()], expected);
  } finally { await f.cleanup(); }
});

test("restoring a sealed plan rejects a changed final request before returning consumable batches", async t => {
  for (const kind of ["cost", "offset", "key", "unit", "body", "context"] as const) await t.test(kind, async () => {
    const f = await fixture(), output: string[] = []; let restored: unknown;
    try {
      const plan = await stage({ ...f, context, write_batch: async row => { output.push(row.jsonl); } });
      const last = plan.requests.at(-1)!;
      if (kind === "cost") last.reserved_micro_usd++;
      if (kind === "offset") last.offset++;
      if (kind === "key") last.batch_key = "different";
      if (kind === "unit") last.unit_keys[0] = "open:wrong";
      if (kind === "body") {
        const row = JSON.parse(output.at(-1)!); row.batch.request_body += "changed";
        output[output.length - 1] = JSON.stringify(row) + "\n";
        last.sha256 = sha(output.at(-1)!); last.size_bytes = Buffer.byteLength(output.at(-1)!);
        plan.stream.sha256 = sha(output.join("")); plan.stream.bytes = Buffer.byteLength(output.join(""));
      }
      const { plan_digest: _digest, ...unsigned } = plan; plan.plan_digest = digest(unsigned);
      const path = join(f.directory, "batches.jsonl"); await writeFile(path, output.join(""));
      await assert.rejects(async () => { restored = await restore({ path, plan,
        context: kind === "context" ? { ...context, data: { brand: "changed context" } } : context }); }, /workspace_incremental_editorial_batches_/u);
      assert.equal(restored, undefined);
    } finally { await f.cleanup(); }
  });
});

test("restored iteration checks exact byte ranges again after preflight", async () => {
  const f = await fixture(), output: string[] = [];
  try {
    const plan = await stage({ ...f, context, write_batch: async row => { output.push(row.jsonl); } });
    const path = join(f.directory, "batches.jsonl"); await writeFile(path, output.join(""));
    const restored = await restore({ path, plan, context });
    await writeFile(path, "changed after preflight");
    assert.throws(() => [...restored.batches()], /workspace_incremental_editorial_batches_plan_invalid/u);
  } finally { await f.cleanup(); }
});

test("last-row corruption is rejected before any output callback", async t => {
  for (const kind of ["binding", "order", "missing", "text", "utf8", "newline"] as const) await t.test(kind, async () => {
    const f = await fixture(); let writes = 0;
    try {
      const rows = f.body.trimEnd().split("\n"), last = JSON.parse(rows.at(-1)!);
      if (kind === "binding") last.unit.birth_membership_digest = sha("different");
      if (kind === "text") last.cluster.representatives[0].text += "changed";
      if (["binding", "text"].includes(kind)) rows[rows.length - 1] = JSON.stringify(last);
      if (kind === "order") rows.reverse();
      if (kind === "missing") rows.pop();
      let body = Buffer.from(rows.join("\n") + (kind === "newline" ? "" : "\n"));
      if (kind === "utf8") body = Buffer.concat([body.subarray(0, body.length - 2), Buffer.from([0xff, 10])]);
      await writeFile(f.path, body);
      f.descriptor.stream.bytes = body.length; f.descriptor.stream.sha256 = await hashWorkspaceEngineFileV1(f.path); seal(f.descriptor);
      await assert.rejects(stage({ ...f, context, write_batch: async () => { writes++; } }), /workspace_incremental_editorial_batches_/u);
      assert.equal(writes, 0);
    } finally { await f.cleanup(); }
  });
});

test("callback mutation cannot change request identity, unit membership or cost in the sealed plan", async () => {
  const f = await fixture();
  try {
    const expected = [...batchSignalWorkspaceInterpretationV1(context, f.clusters)], output: string[] = [];
    const plan = await stage({ ...f, context, write_batch: async row => {
      output.push(row.jsonl); row.batch.request_digest = sha("callback changed digest");
      row.batch.batch_key = "changed"; row.batch.reserved_micro_usd = 1;
      row.batch.clusters[0]!.cluster_id = "open:changed"; row.batch.clusters.length = 0;
    } });
    assert.equal(plan.units, 9); assert.equal(plan.stream.sha256, sha(output.join("")));
    for (const request of plan.requests) {
      const batch = expected[request.index]!;
      assert.equal(request.request_digest, batch.request_digest); assert.equal(request.batch_key, batch.batch_key);
      assert.equal(request.reserved_micro_usd, batch.reserved_micro_usd);
      assert.deepEqual(request.unit_keys, batch.clusters.map(cluster => cluster.cluster_id));
    }
  } finally { await f.cleanup(); }
});

test("source changes and failed last output leave no usable final plan", async t => {
  for (const kind of ["mutation", "last_write", "numeric_owner", "numeric_owner_upper", "descriptor", "target_binding"] as const) await t.test(kind, async () => {
    const f = await fixture(); let plan: unknown, writes = 0;
    try {
      if (kind === "descriptor") f.descriptor.target_unit_digest = sha("wrong");
      if (kind === "target_binding") { f.descriptor.target_binding_digest = sha("wrong binding"); seal(f.descriptor); }
      const inputContext = kind === "numeric_owner" ? { ...context, execution_id: f.descriptor.numeric_execution_id }
        : kind === "numeric_owner_upper" ? { ...context, execution_id: f.descriptor.numeric_execution_id.toUpperCase() } : context;
      const expected = [...batchSignalWorkspaceInterpretationV1(context, f.clusters)].length;
      await assert.rejects(async () => { plan = await stage({ ...f, context: inputContext, write_batch: async () => {
        if (++writes === expected) {
          if (kind === "last_write") throw new Error("private storage failure");
          if (kind === "mutation") await writeFile(f.path, "changed");
        }
      } }); }, /workspace_incremental_editorial_batches_/u);
      assert.equal(plan, undefined); assert.equal(writes, ["mutation", "last_write"].includes(kind) ? expected : 0);
    } finally { await f.cleanup(); }
  });
});

test("1,000 units over18MB produce all durable batch lines with bounded output callbacks", { timeout: 120000 }, async t => {
  const f = await fixture(1000, true), destination = join(f.directory, "batches.jsonl"), file = await open(destination, "wx", 0o600);
  let maximum = 0, count = 0;
  try {
    const plan = await stage({ ...f, context, write_batch: async row => {
      maximum = Math.max(maximum, row.batch.clusters.length); count += row.batch.clusters.length; await file.writeFile(row.jsonl);
    } });
    await file.sync(); assert.equal(count, 1000); assert.equal(plan.units, 1000); assert.ok(maximum <= 4);
    assert.ok(f.descriptor.stream.bytes > 18_000_000); assert.equal(plan.stream.sha256, await hashWorkspaceEngineFileV1(destination));
    const restored = await restore({ path: destination, plan, context }); let restoredCount = 0;
    for (const batch of restored.batches()) restoredCount += batch.clusters.length;
    assert.equal(restoredCount, 1000);
    t.diagnostic(JSON.stringify({ input_units:1000,input_bytes:f.descriptor.stream.bytes,batches:plan.batches,output_bytes:plan.stream.bytes,max_batch_units:maximum }));
  } finally { await file.close(); await f.cleanup(); }
});
