import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createSignalWorkspaceInterestDecisionRuntimeStoresV1,
  drainSignalWorkspaceInterestDecisionBatchesV1,
  signalWorkspaceInterestDecisionBatchJobV1,
  signalWorkspaceInterestDecisionRuntimeConfigurationV1,
  signalWorkspaceInterestDecisionSchemaReadyV1,
} from "./signal-workspace-interest-decision-runtime-v1";
import { runSignalWorkspaceInterestDecisionBatchTickV1,
  SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V1,
  type SignalWorkspaceInterestDecisionBatchLeaseV1 } from "./signal-workspace-interest-decision-queue-v1";

const batchId = randomUUID(), ownerId = randomUUID(), workspaceId = randomUUID(), callId = randomUUID();
const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED: "true",
  NOISIA_SIGNAL_INTEREST_DECISION_BATCH_PROVIDER_ENABLED: "true" };
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("interest decision runtime is off by default and cannot read a key or DB", async () => {
  assert.deepEqual(signalWorkspaceInterestDecisionRuntimeConfigurationV1({}),
    { enabled: false, provider_enabled: false });
  assert.deepEqual(signalWorkspaceInterestDecisionRuntimeConfigurationV1({
    NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED: "true" }),
    { enabled: true, provider_enabled: false });
  const env = new Proxy({}, { get(_target, property) {
    if (property === "NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED") return undefined;
    assert.fail("disabled runtime read a secret");
  } });
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionBatchesV1({ env }),
    { disabled: true, schema_ready: false, dispatched: 0 });
  assert.deepEqual(await signalWorkspaceInterestDecisionBatchJobV1({ id: "bad", data: { batch_id: batchId } }, { env }),
    { disabled: true });
});

test("SQL0211/0214 schema gate prevents jobs and provider construction before migration", async () => {
  const sql: string[] = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    sql.push(statement); return { rows: [{ ready: false }] };
  }, release() {} }) };
  assert.equal(await signalWorkspaceInterestDecisionSchemaReadyV1(database as never), false);
  assert.match(sql[0] ?? "", /mark_submitting_signal_interest_decision_batch_v1/u);
  assert.match(sql[0] ?? "", /persist_signal_interest_decision_item_v1/u);
  assert.match(sql[0] ?? "", /rollover_prepared_signal_interest_decision_batch_v1/u);
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionBatchesV1({ env: enabled, database: database as never,
    queue: { getJob: async () => assert.fail("queue must stay untouched"), add: async () => assert.fail("queue must stay untouched") } }),
  { disabled: false, schema_ready: false, dispatched: 0 });
  await assert.rejects(signalWorkspaceInterestDecisionBatchJobV1({
    id: `interest-decision-batch-v1-${batchId}`, data: { batch_id: batchId },
  }, { env: enabled, database: database as never }), /workspace_interest_batch_runtime_schema_unavailable/u);
});

test("drainer wakes only due DB batches and retries the same BullMQ identity", async () => {
  const statements: string[] = [], added: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    statements.push(statement);
    return { rows: statement.includes("to_regclass") ? [{ ready: true }] : [{ id: batchId }] };
  }, release() {} }) };
  const queue = { getJob: async () => null, add: async (name: string, data: { batch_id: string }, options: Record<string, unknown>) => {
    added.push({ name, data, options });
  } };
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionBatchesV1({ env: enabled,
    database: database as never, queue }), { disabled: false, schema_ready: true, dispatched: 1 });
  assert.match(statements[1] ?? "", /state IN \('prepared','submitting','in_progress','canceling','ended'\)/u);
  assert.match(statements[1] ?? "", /lease_expires_at IS NULL/u);
  assert.equal(added[0]?.name, SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V1);
  assert.deepEqual(added[0]?.data, { batch_id: batchId });
  assert.equal(added[0]?.options.jobId, `interest-decision-batch-v1-${batchId}`);
  const retried: string[] = [];
  await drainSignalWorkspaceInterestDecisionBatchesV1({ env: enabled, database: database as never,
    queue: { getJob: async () => ({ getState: async () => "completed", retry: async state => { retried.push(state); } }),
      add: async () => assert.fail("must retry the same job") } });
  assert.deepEqual(retried, ["completed"]);
});

test("raw provider bytes use the exact existing private store key before DB settlement", async () => {
  const raw = '{"custom_id":"one","result":{"type":"succeeded","message":"á"}}';
  const rawSha = sha(raw), observed: string[] = [], sql: string[] = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    sql.push(statement);
    if (statement.includes("SELECT c.id::text call_id"))
      return { rows: [{ call_id: callId, owner_id: ownerId, workspace_id: workspaceId }] };
    if (statement.includes("persist_signal_interest_decision_item_v1"))
      return { rows: [{ result: { call_id: callId, status: "settled", replayed: false } }] };
    return { rows: [] };
  }, release() {} }) };
  const storage = { assertReady: async () => undefined,
    put: async (args: { workspace_id: string; execution_id: string; file: string; sha256: string;
      size_bytes: number; media_type: string }) => {
      assert.equal(args.workspace_id, workspaceId);
      assert.equal(args.execution_id, ownerId);
      assert.equal(args.sha256, rawSha);
      assert.equal(args.size_bytes, Buffer.byteLength(raw));
      assert.equal(args.media_type, "application/json");
      assert.equal(await readFile(args.file, "utf8"), raw);
      observed.push(args.file);
      return { storage_key: `workspace-engine/${workspaceId}/${ownerId}/interest-decision-${batchId}-${callId}.json.${rawSha.slice(7)}.parts.json`,
        sha256: rawSha, size_bytes: args.size_bytes, media_type: args.media_type };
    } };
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({ database: database as never, storage: storage as never });
  const lease = { batch_id: batchId, lease_token: randomUUID(), state: "ended" as const,
    provider_batch_id: "msgbatch_one", manifest: { requests: [{ provider_request: { custom_id: "one" } }] } };
  const result = await stores.persistRawAndSettle(lease as never,
    { custom_id: "one", raw_text: raw, raw_sha256: rawSha });
  assert.deepEqual(result, { raw_sha256: rawSha, settlement: "settled", replayed: false });
  assert.equal(observed.length, 1);
  assert.ok(sql.some(statement => statement.includes("persist_signal_interest_decision_item_v1")));
  await assert.rejects(readFile(observed[0]!, "utf8"), { code: "ENOENT" });
});

test("private storage readiness precedes the database paid-send reservation", async () => {
  const events: string[] = [];
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({
    database: { connect: async () => { events.push("database"); assert.fail("reservation must not start"); } } as never,
    storage: { assertReady: async () => { events.push("storage"); throw new Error("private bucket unavailable"); } } as never,
  });
  await assert.rejects(stores.reserveAndMarkSubmitting({ batch_id: batchId,
    lease_token: randomUUID() } as never), /private bucket unavailable/u);
  assert.deepEqual(events, ["storage"]);
});

test("a prior-day prepared batch never reaches paid send", async () => {
  const sql: string[] = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    sql.push(statement);
    if (statement.includes("admission_current"))
      return { rows: [{ admission_current: false, policy_current: true }] };
    return { rows: [] };
  }, release() {} }) };
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({ database: database as never,
    storage: { assertReady: async () => undefined } as never });
  await assert.rejects(stores.reserveAndMarkSubmitting({ batch_id: batchId,
    lease_token: randomUUID() } as never), /workspace_interest_batch_runtime_admission_expired/u);
  assert.equal(sql.some(statement => statement.includes("mark_submitting_signal_interest_decision_batch_v1")), false);
});

test("a revoked or expired policy stops a prepared batch before send", async () => {
  const sql: string[] = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    sql.push(statement);
    if (statement.includes("admission_current"))
      return { rows: [{ admission_current: true, policy_current: false }] };
    return { rows: [] };
  }, release() {} }) };
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({ database: database as never,
    storage: { assertReady: async () => undefined } as never });
  await assert.rejects(stores.reserveAndMarkSubmitting({ batch_id: batchId,
    lease_token: randomUUID() } as never), /workspace_interest_batch_runtime_policy_expired_or_changed/u);
  assert.equal(sql.some(statement => statement.includes("mark_submitting_signal_interest_decision_batch_v1")), false);
});

function rolloverHarness(options: { prior_day?: boolean; renewed?: boolean; replayed?: boolean;
  renewal_error?: Error; rollover_error?: Error; missing_preflight?: boolean; mismatch?: boolean } = {}) {
  const events: string[] = [];
  const actorId = randomUUID(), successorId = randomUUID(), manifestDigest = sha("sealed manifest");
  const lease = { batch_id: batchId, lease_token: randomUUID(), state: "prepared", provider_batch_id: null,
    manifest: { manifest_digest: manifestDigest } } as SignalWorkspaceInterestDecisionBatchLeaseV1;
  let claimed = false;
  const database = { connect: async () => {
    events.push("connect");
    return { query: async (statement: string, parameters?: unknown[]) => {
      if (statement.includes("admission.budget_date<")) {
        events.push("preflight");
        assert.deepEqual(parameters, [lease.batch_id, lease.lease_token]);
        return { rows: options.missing_preflight ? [] : [{ owner_id: ownerId, actor_user_id: actorId,
          prior_day: options.prior_day ?? true }] };
      }
      if (statement.includes("renew_signal_interest_decision_admission_v1")) {
        events.push("renew");
        assert.deepEqual(parameters, [ownerId, actorId]);
        if (options.renewal_error) throw options.renewal_error;
        return { rows: [{ result: { admission_id: randomUUID(), replayed: options.renewed ?? false } }] };
      }
      if (statement.includes("rollover_prepared_signal_interest_decision_batch_v1")) {
        events.push("rollover");
        assert.deepEqual(parameters, [lease.batch_id, lease.lease_token, actorId]);
        if (options.rollover_error) throw options.rollover_error;
        claimed = true;
        return { rows: [{ result: { batch_id: successorId, expired_batch_id: lease.batch_id,
          manifest_digest: options.mismatch ? sha("different manifest") : manifestDigest,
          replayed: options.replayed ?? false } }] };
      }
      assert.fail(`unexpected SQL: ${statement}`);
    }, release: () => { events.push("release connection"); } };
  } };
  const batch_stores = {
    claimDue: async () => { events.push("claim"); return claimed ? null : lease; },
    reserveAndMarkSubmitting: async () => { events.push("reserve"); },
    releaseLease: async () => { events.push("release lease"); },
  };
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({ database: database as never,
    batch_stores: batch_stores as never });
  return { stores, lease, events, successorId };
}

test("prior-day prepared Batch renews then rolls to a queued successor without provider IO", async () => {
  const h = rolloverHarness();
  const provider = { create: async () => assert.fail("old Batch must not POST"),
    get: async () => assert.fail("old Batch must not poll") };
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV1({ stores: h.stores,
    provider: provider as never, batch_id: batchId }), "idle");
  assert.deepEqual(h.events, ["claim", "connect", "preflight", "renew", "rollover", "release connection"]);
  assert.equal(await h.stores.claimDue(batchId), null);
  assert.equal(h.events.filter(event => event === "renew").length, 1);
  assert.equal(h.events.includes("reserve"), false);
  assert.equal(h.events.includes("release lease"), false);
});

test("rollover replay is terminal for the old Batch and cannot duplicate a provider POST", async () => {
  const h = rolloverHarness({ renewed: true, replayed: true });
  assert.equal(await h.stores.claimDue(batchId), null);
  assert.equal(await h.stores.claimDue(batchId), null);
  assert.deepEqual(h.events.filter(event => event === "rollover"), ["rollover"]);
  assert.equal(h.events.includes("reserve"), false);
  assert.equal(h.events.includes("release lease"), false);
});

test("current-day and already-submitted leases retain their existing path", async () => {
  const current = rolloverHarness({ prior_day: false });
  assert.equal(await current.stores.claimDue(batchId), current.lease);
  assert.deepEqual(current.events, ["claim", "connect", "preflight", "release connection"]);
  for (const state of ["submitting", "submission_unknown", "in_progress", "ended"] as const) {
    const events: string[] = [];
    const lease = { ...current.lease, state };
    const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV1({
      database: { connect: async () => { assert.fail("submitted/uncertain lease must bypass rollover"); } } as never,
      batch_stores: { claimDue: async () => { events.push("claim"); return lease; } } as never,
    });
    assert.equal(await stores.claimDue(batchId), lease);
    assert.deepEqual(events, ["claim"]);
  }
});

test("rollover preflight, policy renewal, SQL, and receipt failures stop before paid reservation", async () => {
  for (const options of [{ missing_preflight: true },
    { renewal_error: new Error("interest_decision_policy_required") },
    { rollover_error: new Error("connection lost after commit") }, { mismatch: true }]) {
    const h = rolloverHarness(options);
    await assert.rejects(h.stores.claimDue(batchId),
      /rollover_preflight_unavailable|interest_decision_policy_required|connection lost after commit|rollover_receipt_invalid/u);
    assert.equal(h.events.includes("reserve"), false);
    assert.equal(h.events.includes("release lease"), false);
    if (options.renewal_error) assert.equal(h.events.includes("rollover"), false);
  }
});
