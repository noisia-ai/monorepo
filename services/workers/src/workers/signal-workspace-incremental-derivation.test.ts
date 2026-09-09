import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { available, fixture, id, sha, jsonl } from "./signal-workspace-incremental-projection.fixture";
import { safeWorkspaceIncrementalProjectionErrorV1 as safeError } from "./signal-workspace-incremental-derivation";

test("retry classification requires an explicit transport code, not generic text or a constraint error", () => {
  assert.equal(safeError(Object.assign(new Error("private DB detail"), { code: "ECONNRESET" })), "workspace_incremental_projection_transport_unavailable");
  assert.equal(safeError(Object.assign(new Error("private SQL detail"), { code: "23514" })), "workspace_incremental_projection_worker_failed");
  assert.equal(safeError(new Error("ECONNRESET")), "workspace_incremental_projection_worker_failed");
  assert.equal(safeError(new Error("workspace_engine_storage_verification_failed")), "workspace_engine_storage_verification_failed");
});

test("derives all bank units and current roots through scoped historical evidence, without numeric mutation", { skip: !available }, async t => {
  for (const wave of [2, 3] as const) await t.test(`wave ${wave}`, async () => {
    const f = await fixture(wave); try {
      const result = await f.invoke(); assert.equal(result.replayed, false); assert.equal(f.counts.generation, 1);
      assert.equal(f.counts.root_items, wave === 2 ? 390 : 401); assert.equal(f.counts.roots, 4);
      assert.equal(f.counts.get, 6 + 11); assert.equal(f.counts.put, 1); assert.equal(f.durableBindings.size, 11); assert.equal(f.durableUnits.size, 11);
      assert.equal(f.summary?.interpretation_coverage.expected_unit_count, 11); assert.equal(f.summary?.interpretation_coverage.complete, true);
      assert.deepEqual(f.summary?.discovery_coverage, { state: f.manifest.discovery_status, pending_roots: wave === 2 ? 0 : 13 });
      assert.ok(new Set(f.proposals.map(row => row.owner_execution_id)).size > 1, "history retains both model origins");
      assert.equal(f.events.filter(row => row.startsWith("roots:")).length, 4);
      const lastRootPage = f.events.filter(row => row.startsWith("roots:")).at(-1)!;
      assert.ok(f.events.lastIndexOf(lastRootPage) < f.events.indexOf("put:bindings"));
      assert.deepEqual(await readdir(f.scratch), []); f.assertNumericUnchanged();
    } finally { await f.cleanup(); }
  });
});

test("zero bindings preserve full coverage debt, and an empty current corpus retires all roots without inventing Topics", { skip: !available }, async t => {
  for (const wave of [3, 4] as const) await t.test(`wave ${wave}`, async () => {
    const f = await fixture(wave, false); try {
      await f.invoke(); assert.equal(f.counts.root_items, wave === 3 ? 401 : 0);
      assert.equal(f.counts.get, 6); assert.equal(f.counts.bindings, 0); assert.equal(f.durableBindings.size, 0); assert.equal(f.durableUnits.size, 11);
      assert.equal(f.summary?.interpretation_coverage.expected_unit_count, 11); assert.equal(f.summary?.interpretation_coverage.interpreted_unit_count, 0);
      assert.equal(f.summary?.interpretation_coverage.complete, false); assert.equal(f.artifact?.size_bytes, 0);
      assert.equal(f.manifest.counts.removed_roots, wave === 4 ? 401 : 1); f.assertNumericUnchanged();
    } finally { await f.cleanup(); }
  });
});

test("completed derivation replay has no storage/config/scratch/population IO", { skip: !available }, async () => {
  const f = await fixture(); try {
    const first = await f.invoke(), before = { ...f.counts };
    const poison: WorkspaceEngineStorageV1 = { get: async () => assert.fail("replay downloaded"), put: async () => assert.fail("replay uploaded") };
    const replay = await f.invoke({ storage: poison, scratch_root: "/path-that-must-never-be-created/noisia" });
    assert.deepEqual(replay, { ...first, replayed: true }); assert.equal(f.counts.completeDispatch, 1);
    assert.deepEqual({ ...f.counts, completeDispatch: 0 }, before); f.assertNumericUnchanged();
  } finally { await f.cleanup(); }
});

test("lost binding-page or completion ACK preserves exact file/digest and only one projection generation", { skip: !available }, async t => {
  for (const phase of ["bindings", "finish"] as const) await t.test(phase, async () => {
    const f = await fixture(); try {
      if (phase === "bindings") f.loseBindingAck(); else f.loseFinishAck();
      await assert.rejects(f.invoke(), /workspace_incremental_projection_transport_unavailable/);
      const first = structuredClone(f.artifact), before = { ...f.counts }; assert.ok(first); assert.equal(f.durableBindings.size, 11);
      assert.equal(f.outbox, phase === "finish" ? "completed" : "failed");
      const result = await f.invoke(); assert.equal(result.generation_id, id(6002)); assert.equal(f.counts.generation, 1);
      assert.deepEqual(f.artifact, first); assert.ok(f.uploads.every(row => row.sha256 === first.sha256 && row.storage_key === first.storage_key));
      if (phase === "finish") { assert.equal(f.counts.get, before.get); assert.equal(f.counts.put, before.put); assert.equal(f.counts.finish, before.finish); }
      else { assert.equal(f.counts.put, 2); assert.equal(f.counts.root_items, 780); }
      assert.equal(f.durableBindings.size, 11); assert.deepEqual(await readdir(f.scratch), []); f.assertNumericUnchanged();
    } finally { await f.cleanup(); }
  });
});

test("lost unit-census ACK replays the complete bank once, including a zero-binding derivation", { skip: !available }, async t => {
  for (const interpreted of [true, false]) await t.test(`interpreted ${interpreted}`, async () => {
    const f = await fixture(3, interpreted); try {
      f.loseUnitAck(); await assert.rejects(f.invoke(), /workspace_incremental_projection_transport_unavailable/);
      const units = structuredClone([...f.durableUnits]); assert.equal(units.length, 11);
      assert.equal(f.counts.bindings, 0); assert.equal(f.counts.finish, 0); assert.equal(f.counts.generation, 0);
      await f.invoke(); assert.deepEqual([...f.durableUnits], units); assert.equal(f.counts.generation, 1);
      assert.equal(f.counts.root_items, 802); assert.equal(f.durableBindings.size, interpreted ? 11 : 0);
      assert.equal(f.summary?.interpretation_coverage.interpreted_unit_count, interpreted ? 11 : 0);
      f.assertNumericUnchanged(); assert.deepEqual(await readdir(f.scratch), []);
    } finally { await f.cleanup(); }
  });
});

test("preflight rejects corruption, foreign historical evidence and mismatched current roots before any write", { skip: !available }, async t => {
  for (const kind of ["missing", "sha", "resealed_population", "foreign_owner", "foreign_workspace", "foreign_artifact", "changed_root", "changed_correction", "omitted_last_root", "editorial_cut"] as const)
    await t.test(kind, async () => {
      const f = await fixture(); try {
        if (kind === "missing") f.objects.delete(f.refs[3]!.storage_key);
        if (kind === "sha") f.objects.set(f.refs[3]!.storage_key, Buffer.from("corrupt numeric bytes"));
        if (kind === "foreign_artifact") f.refs[1]!.owner_execution_id = id(9999);
        if (kind === "resealed_population") {
          const pop = f.refs.find(ref => ref.artifact_key === "population.jsonl")!, raw = jsonl(f.objects.get(pop.storage_key)!);
          raw[raw.length - 1].root_fingerprint = sha("altered last root"); const body = Buffer.from(raw.map(row => JSON.stringify(row) + "\n").join(""));
          f.objects.set(pop.storage_key, body); pop.sha256 = sha(body); pop.size_bytes = body.length;
          const output = JSON.parse(f.objects.get(f.refs[0]!.storage_key)!.toString());
          Object.assign(output.artifacts.find((ref: { file: string }) => ref.file === "population.jsonl"), { sha256: sha(body), bytes: body.length });
          const manifestBody = Buffer.from(JSON.stringify(output) + "\n"); f.objects.set(f.refs[0]!.storage_key, manifestBody);
          f.refs[0]!.sha256 = sha(manifestBody); f.refs[0]!.size_bytes = manifestBody.length;
        }
        if (kind === "foreign_owner" || kind === "foreign_workspace") {
          const ref = f.proposals[0]!, packet = JSON.parse(f.objects.get(ref.storage_key)!.toString());
          if (kind === "foreign_owner") packet.execution_id = id(9999); else packet.context.workspace_id = id(9999);
          const body = Buffer.from(JSON.stringify(packet)); f.objects.set(ref.storage_key, body);
          ref.sha256 = ref.artifact_sha256 = sha(body); ref.size_bytes = body.length;
        }
        if (kind === "changed_root") f.roots.at(-1)!.root_fingerprint = sha("new content");
        if (kind === "changed_correction") f.roots.at(-1)!.correction_digest = sha("new correction");
        if (kind === "omitted_last_root") f.roots.pop();
        if (kind === "editorial_cut") f.d.editorial_cut_digest = sha("different paid history cut");
        await assert.rejects(f.invoke(), /^Error: workspace_/);
        assert.equal(f.counts.put, 0); assert.equal(f.counts.units, 0); assert.equal(f.counts.bindings, 0); assert.equal(f.counts.finish, 0); assert.equal(f.counts.generation, 0);
        assert.equal(f.failures.length, 1); assert.deepEqual(await readdir(f.scratch), []);
      } finally { await f.cleanup(); }
    });
});

test("stalled, empty nonterminal and inconsistent page cursors fail before binding persistence", { skip: !available }, async t => {
  for (const kind of ["root_stall", "root_empty", "root_cursor", "topic_stall", "proposal_cursor"] as const) await t.test(kind, async () => {
    const f = await fixture(); try {
      const originalRoots = f.stores.roots, originalTopics = f.stores.topics, originalProposals = f.stores.proposals;
      if (kind.startsWith("root")) f.stores.roots = async args => {
        if (kind === "root_empty") return { items: [], next_cursor: null, done: false };
        const page = await originalRoots(args);
        if (kind === "root_cursor") return { ...page, next_cursor: id(9999) };
        return args.after_root_id ? { items: [f.roots[0]!], next_cursor: f.roots[0]!.root_id, done: false } : page;
      };
      if (kind === "topic_stall") f.stores.topics = async args => {
        const page = await originalTopics(args); return { ...page, items: [f.topics[0]!], next_cursor: f.topics[0]!.definition.term_key, done: false };
      };
      if (kind === "proposal_cursor") f.stores.proposals = async args => ({ ...await originalProposals(args), next_cursor: id(9999) });
      await assert.rejects(f.invoke(), /workspace_incremental_projection_(?:population_changed|root_page_invalid|topic_page_invalid|proposal_page_invalid)/);
      assert.equal(f.counts.put, 0); assert.equal(f.counts.bindings, 0); assert.equal(f.counts.finish, 0);
    } finally { await f.cleanup(); }
  });
});

test("lost current authority during the root census cannot publish a binding or leak an arbitrary error", { skip: !available }, async () => {
  const f = await fixture(); try {
    const original = f.stores.roots;
    f.stores.roots = async args => { if (args.after_root_id) throw new Error("workspace_incremental_projection_source_unavailable"); return original(args); };
    await assert.rejects(f.invoke(), /^Error: workspace_incremental_projection_source_unavailable$/);
    assert.equal(f.counts.put, 0); assert.equal(f.counts.finish, 0); f.assertNumericUnchanged();
  } finally { await f.cleanup(); }
});

test("an extra model reference is rejected before any download or model access", { skip: !available }, async () => {
  const f = await fixture(); try {
    f.refs.push({ ...f.refs[0]!, artifact_id: id(9900), artifact_key: "model.joblib", size_bytes: 4 * 1024 ** 3 });
    await assert.rejects(f.invoke(), /workspace_incremental_projection_artifact_scope_invalid/);
    assert.equal(f.counts.get, 0); assert.equal(f.counts.put, 0); assert.equal(f.counts.units, 0); assert.equal(f.counts.finish, 0);
  } finally { await f.cleanup(); }
});
