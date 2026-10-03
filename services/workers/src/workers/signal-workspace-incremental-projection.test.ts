import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { signalWorkspaceIncrementalProjectionSourceSchemaV1, signalWorkspaceIncrementalMembershipSchemaV1,
  type SignalWorkspaceClassificationOutcomeV1 as Outcome } from "@noisia/query-engine";
import type { SignalWorkspaceClassificationLeaseV1 as Lease,
  SignalWorkspaceClassificationPageV1 as RootPage, SignalWorkspaceClassificationChunksPageV1 as ChunkPage } from "@noisia/db";
import { signalWorkspaceIncrementalProjectionJobV1 as run,
  type WorkspaceIncrementalProjectionOptionsV1 as Options } from "./signal-workspace-incremental-projection";
import { available, fixture as derivationFixture, id, sha, jsonl } from "./signal-workspace-incremental-projection.fixture";

type Stores = NonNullable<Options["stores"]>;
type Membership = ReturnType<typeof signalWorkspaceIncrementalMembershipSchemaV1.parse>;
async function fixture(wave: 2 | 3 | 4 = 2, interpreted = true) {
  const f = await derivationFixture(wave, interpreted), derived = await f.invoke();
  const source = signalWorkspaceIncrementalProjectionSourceSchemaV1.parse({
    contract_version: "workspace-topic-incremental-projection-v1", workspace_id: f.d.workspace_id, engine_execution_id: f.d.execution_id,
    numeric_checkpoint_digest: f.d.numeric_checkpoint.checkpoint_digest, population_digest: f.manifest.population_digest,
    output_artifact_id: f.refs[0]!.artifact_id, output_manifest_sha256: f.refs[0]!.sha256,
    memberships_artifact_id: f.refs[3]!.artifact_id, roots_artifact_id: f.refs[1]!.artifact_id,
    model_bank_artifact_id: f.d.numeric_checkpoint.model_bank_artifact_id, model_version_id: f.d.numeric_checkpoint.model_version_id,
    binding_artifact_id: derived.binding_artifact_id, policy_digest: f.d.identity.decision_policy_digest, ...f.summary });
  const binding = { ...f.artifact!, artifact_id: derived.binding_artifact_id, owner_execution_id: f.d.execution_id };
  const artifactRefs = [...f.refs, binding];
  const sourceRoots = jsonl(f.objects.get(f.refs[1]!.storage_key)!);
  const members: Membership[] = jsonl(f.objects.get(f.refs[3]!.storage_key)!);
  const roots: RootPage["items"] = f.roots.map(root => ({ root: { root_id: root.root_id, fingerprint: root.root_fingerprint,
    correction_digest: root.correction_digest, asset_sha256: root.asset_sha256, expected_chunks: root.expected_chunks,
    chunk_coverage_digest: root.chunk_coverage_digest, reuse_item_id: null }, corrections: [] }));
  const chunks: ChunkPage["items"] = jsonl(await readFile(join(f.inputDirectory, "chunks.jsonl")))
    .map(({ ordinal: _ordinal, root_fingerprint: _fingerprint, ...row }) => row);
  const counts = { claim: 0, roots: 0, chunks: 0, committed: 0, finish: 0 };
  const writes = new Map<string, Outcome>(), commits: string[][] = [], failures: string[] = [], readIds: string[] = [];
  let cursor: string | null = null, completed = false, ackLostAt = 0, finishAckLost = false, forbidden = false;
  const lease = (): Lease => ({ execution_id: derived.projection_execution_id, workspace_id: f.d.workspace_id,
    execution_token: id(7000), input_digest: sha("synthetic projection input"), identity: f.d.identity, cursor_root_id: cursor });
  const guard = (value: Lease) => { assert.equal(value.execution_id, derived.projection_execution_id);
    assert.equal(value.workspace_id, f.d.workspace_id); assert.equal(value.execution_token, id(7000));
    if (forbidden) throw new Error("workspace_classification_forbidden"); };
  const stores: Stores = {
    claim: async args => { counts.claim++; assert.equal(args.execution_id, derived.projection_execution_id);
      if (completed) return null; return { lease: lease(), source, artifacts: artifactRefs, derivation: f.d }; },
    heartbeat: async args => { guard(args.lease); },
    readPage: async args => { guard(args.lease); assert.equal(args.lease.cursor_root_id, cursor); counts.roots++;
      assert.equal(args.limit, 128); const all = roots.filter(item => !cursor || item.root.root_id > cursor), items = all.slice(0, args.limit);
      readIds.push(...items.map(item => item.root.root_id)); return { items: structuredClone(items), done: all.length <= args.limit }; },
    readChunksPage: async args => { guard(args.lease); assert.equal(args.lease.cursor_root_id, cursor); counts.chunks++;
      assert.equal(args.limit, 128); assert.ok(args.root_ids.length <= 128);
      const all = chunks.filter(row => args.root_ids.includes(row.root_id) && (!args.after || row.root_id > args.after.root_id
        || row.root_id === args.after.root_id && row.chunk_index > args.after.chunk_index));
      const items = all.slice(0, args.limit), last = items.at(-1);
      return { items: structuredClone(items), next_cursor: last ? { root_id: last.root_id, chunk_index: last.chunk_index } : args.after, done: all.length <= args.limit }; },
    commitPage: async args => { guard(args.lease); assert.equal(args.lease.cursor_root_id, cursor);
      const expected = roots.filter(item => !cursor || item.root.root_id > cursor).slice(0, args.outcomes.length).map(item => item.root.root_id);
      assert.deepEqual(args.outcomes.map(outcome => outcome.root.root_id), expected); assert.ok(args.outcomes.length <= 128);
      for (const outcome of args.outcomes) { assert.ok(!writes.has(outcome.root.root_id), "never rewrite a durable root"); writes.set(outcome.root.root_id, structuredClone(outcome)); }
      counts.committed += args.outcomes.length; commits.push(expected); cursor = expected.at(-1) ?? cursor;
      if (commits.length === ackLostAt) { ackLostAt = 0; throw Object.assign(new Error("Synthetic root commit ACK lost"), { code: "ECONNRESET" }); } return lease(); },
    finish: async args => { guard(args.lease); counts.finish++; assert.equal(args.lease.cursor_root_id, cursor);
      assert.equal(writes.size, roots.length); completed = true;
      if (finishAckLost) { finishAckLost = false; throw Object.assign(new Error("Synthetic final generation ACK lost"), { code: "ECONNRESET" }); }
      const values = [...writes.values()];
      return { generation_id: derived.generation_id, execution_id: derived.projection_execution_id, complete_usable: true,
        summary: { roots: writes.size, errors: 0, approved: values.filter(row => row.resolution_state === "approved").length,
          pending: values.filter(row => row.resolution_state === "pending").length, rejected: values.filter(row => row.resolution_state === "rejected").length,
          abstained: values.filter(row => row.resolution_state === "abstained").length,
          chunks: String(values.reduce((sum, row) => sum + row.coverage.processed_chunks, 0)), finalized_digest: sha("synthetic finalized generation") } }; },
    fail: async args => { failures.push(args.error_code ?? "missing_error"); }
  };
  const job = { id: "synthetic-projection-job", data: { execution_id: derived.projection_execution_id }, updateProgress: async () => undefined };
  const options: Options = { database: {} as Options["database"], stores, source_stores: f.stores, storage: f.storage, scratch_root: f.scratch };
  const invoke = (override: Options = {}) => run(job, { ...options, ...override });
  return { ...f, derived, source, artifactRefs, binding, sourceRoots, members, roots, chunks, writes, commits, failures, counts, readIds, stores, invoke,
    storageCounts: f.counts, get cursor() { return cursor; }, losePageAck: () => { ackLostAt = 1; }, loseFinishAck: () => { finishAckLost = true; },
    revoke: () => { forbidden = true; } };
}

test("real numeric waves project every current root and fragment with original model/editorial origins and no approval", { skip: !available }, async t => {
  for (const wave of [2, 3] as const) await t.test(`wave ${wave}`, async () => {
    const f = await fixture(wave); try {
      const beforePut = f.storageCounts.put; await f.invoke();
      assert.equal(f.counts.committed, wave === 2 ? 390 : 401); assert.equal(f.counts.roots, 4); assert.equal(f.commits.length, 4);
      assert.equal(f.storageCounts.put, beforePut, "projection never uploads or interprets");
      assert.deepEqual([...f.writes.keys()], f.sourceRoots.map(root => root.root_id));
      assert.equal([...f.writes.values()].reduce((sum, row) => sum + row.coverage.processed_chunks, 0), wave === 2 ? 523 : 534);
      assert.equal(f.writes.get(f.roots[0]!.root.root_id)?.coverage.processed_chunks, 134);
      for (const root of f.sourceRoots) {
        const outcome = f.writes.get(root.root_id)!; assert.equal(outcome.decisions.length, root.unit_keys.length);
        for (const decision of outcome.decisions) {
          assert.equal(decision.disposition, "pending"); assert.equal(decision.resolution_method, "model"); assert.equal(decision.approval_policy_id, null);
          assert.equal(decision.score, null); const metadata = decision.membership_metadata;
          assert.equal(metadata?.contract_version, "workspace-computed-incremental-membership-v1");
          if (metadata?.contract_version !== "workspace-computed-incremental-membership-v1") assert.fail();
          const matches = f.members.filter(row => row.root_id === root.root_id && metadata.unit_keys.includes(row.unit_key));
          assert.equal(metadata.matched_chunks, matches.length); assert.deepEqual(metadata.model_origin, matches[0]!.model_origin);
          assert.equal(metadata.proposal_owner_execution_id, matches[0]!.model_origin.execution_id);
          assert.deepEqual(metadata.evidence_fragment, { chunk_index: matches[0]!.chunk_index, start: matches[0]!.start,
            end: matches[0]!.end, chunk_sha256: matches[0]!.chunk_sha256 });
        }
        if (root.discovery_pending) assert.equal(outcome.has_unresolved_topics, true);
      }
      assert.ok([...f.writes.values()].some(row => row.decisions.length > 1));
      if (wave === 3) assert.ok(f.sourceRoots.some(root => root.discovery_pending && f.writes.get(root.root_id)!.decisions.length > 0));
      f.assertNumericUnchanged(); assert.deepEqual(await readdir(f.scratch), []);
    } finally { await f.cleanup(); }
  });
});

test("missing interpretations stay pending for all roots; an empty current population completes without invented assignments", { skip: !available }, async t => {
  for (const wave of [3, 4] as const) await t.test(`wave ${wave}`, async () => {
    const f = await fixture(wave, false); try {
      await f.invoke(); assert.equal(f.writes.size, wave === 3 ? 401 : 0);
      assert.ok([...f.writes.values()].every(outcome => outcome.decisions.length === 0));
      assert.equal(f.source.interpretation_coverage.complete, false); assert.equal(f.source.interpretation_coverage.expected_unit_count, 11);
      if (wave === 3) assert.ok([...f.writes.values()].some(outcome => outcome.has_unresolved_topics));
      assert.equal(f.counts.finish, 1); f.assertNumericUnchanged();
    } finally { await f.cleanup(); }
  });
});

test("page and final ACK loss resumes the exact prefix/generation with no numeric or binding mutation", { skip: !available }, async t => {
  for (const phase of ["page", "finish"] as const) await t.test(phase, async () => {
    const f = await fixture(); try {
      if (phase === "page") f.losePageAck(); else f.loseFinishAck();
      const oldBinding = structuredClone(f.binding), oldSource = structuredClone(f.source);
      await assert.rejects(f.invoke(), /workspace_incremental_projection_transport_unavailable/);
      assert.deepEqual(f.failures, ["workspace_classification_transport_unavailable"]);
      const prefix = structuredClone([...f.writes]), cursor = f.cursor, readsBefore = f.readIds.length, getsBefore = f.storageCounts.get;
      assert.equal(prefix.length, phase === "page" ? 128 : 390);
      await f.invoke(); assert.equal(f.writes.size, 390); assert.equal(f.counts.committed, 390);
      assert.deepEqual([...f.writes].slice(0, prefix.length), prefix); assert.deepEqual(f.binding, oldBinding); assert.deepEqual(f.source, oldSource);
      if (phase === "page") assert.ok(f.readIds.slice(readsBefore).every(root => root > cursor!));
      else { assert.equal(f.storageCounts.get, getsBefore); assert.equal(f.counts.finish, 1); }
      f.assertNumericUnchanged(); assert.deepEqual(await readdir(f.scratch), []);
    } finally { await f.cleanup(); }
  });
});

test("completed projection replay needs neither storage configuration nor scratch", { skip: !available }, async () => {
  const f = await fixture(); try {
    await f.invoke(); const before = { ...f.counts }, gets = f.storageCounts.get;
    const result = await f.invoke({ storage: { get: async () => assert.fail("replay get"), put: async () => assert.fail("replay put") },
      scratch_root: "/path-that-must-never-be-created/noisia" });
    assert.deepEqual(result, { execution_id: f.derived.projection_execution_id, replayed: true });
    assert.deepEqual({ ...f.counts, claim: before.claim }, before); assert.equal(f.storageCounts.get, gets);
  } finally { await f.cleanup(); }
});

test("corrupt binding/numeric bytes, foreign sources and changed first roots fail before a root commit", { skip: !available }, async t => {
  for (const kind of ["binding_sha", "binding_resealed", "numeric_sha", "source_digest", "foreign_binding", "root_fingerprint", "root_correction", "chunk_hash", "history"] as const)
    await t.test(kind, async () => {
      const f = await fixture(); try {
        if (kind === "binding_sha") f.objects.set(f.binding.storage_key, Buffer.from("changed bindings"));
        if (kind === "binding_resealed") {
          const body = Buffer.from(JSON.stringify({ altered: true }) + "\n"); f.objects.set(f.binding.storage_key, body);
          f.binding.sha256 = sha(body); f.binding.size_bytes = body.length;
        }
        if (kind === "numeric_sha") f.objects.set(f.refs[3]!.storage_key, Buffer.from("changed membership"));
        if (kind === "source_digest") f.source.numeric_checkpoint_digest = sha("unrelated checkpoint");
        if (kind === "foreign_binding") f.binding.owner_execution_id = id(9876);
        if (kind === "root_fingerprint") f.roots[0]!.root.fingerprint = sha("new root content");
        if (kind === "root_correction") f.roots[0]!.root.correction_digest = sha("new correction epoch");
        if (kind === "chunk_hash") f.chunks[0]!.chunk_sha256 = sha("another fragment");
        if (kind === "history") f.d.editorial_cut_digest = sha("different editorial cut");
        await assert.rejects(f.invoke(), /^Error: workspace_/); assert.equal(f.counts.committed, 0); assert.equal(f.counts.finish, 0);
        assert.ok(f.failures.length > 0); assert.deepEqual(await readdir(f.scratch), []);
      } finally { await f.cleanup(); }
    });
});

test("rights revoked before the first page, stalled roots and omitted final population fail closed", { skip: !available }, async t => {
  for (const kind of ["rights", "stall", "omitted_tail"] as const) await t.test(kind, async () => {
    const f = await fixture(); try {
      if (kind === "rights") f.revoke();
      if (kind === "stall") f.stores.readPage = async () => ({ items: [], done: false });
      if (kind === "omitted_tail") {
        const original = f.stores.readPage;
        f.stores.readPage = async args => { const page = await original(args); if (page.done) page.items.pop(); return page; };
      }
      await assert.rejects(f.invoke(), /workspace_(?:classification|incremental_projection)_/);
      assert.equal(f.counts.finish, 0);
      if (kind !== "omitted_tail") assert.equal(f.writes.size, 0);
      f.assertNumericUnchanged();
    } finally { await f.cleanup(); }
  });
});

test("only explicit storage transport errors are retryable; corruption and generic failures remain permanent", { skip: !available }, async t => {
  for (const [message, expected, retryable] of [
    ["workspace_engine_storage_transport_failed", "workspace_incremental_projection_transport_unavailable", true],
    ["workspace_engine_storage_unavailable", "workspace_incremental_projection_transport_unavailable", true],
    ["workspace_engine_storage_verification_failed", "workspace_engine_storage_verification_failed", false],
    ["private generic error mentioning lost ACK", "workspace_incremental_projection_worker_failed", false],
  ] as const) await t.test(message, async () => {
    const f = await fixture(); try {
      await assert.rejects(f.invoke({ storage: { get: async () => { throw new Error(message); }, put: async () => assert.fail("unexpected upload") } }),
        new RegExp(`^Error: ${expected}$`));
      assert.deepEqual(f.failures, [expected]); assert.equal(f.counts.committed, 0); assert.equal(f.counts.finish, 0);
      if (retryable) { await f.invoke(); assert.equal(f.writes.size, 390); }
      // Permanent errors deliberately receive no automatic second attempt.
      f.assertNumericUnchanged();
    } finally { await f.cleanup(); }
  });
});
