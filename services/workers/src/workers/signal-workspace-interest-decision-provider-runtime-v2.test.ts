import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSignalWorkspaceInterestDecisionRuntimeStoresV2,
  drainSignalWorkspaceInterestDecisionBatchesV2,
  signalWorkspaceInterestDecisionBatchJobV2,
  signalWorkspaceInterestDecisionRuntimeConfigurationV2 } from "./signal-workspace-interest-decision-provider-runtime-v2";

const batchId = randomUUID(), ownerId = randomUUID(), workspaceId = randomUUID(), callId = randomUUID();
const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED: "true",
  NOISIA_SIGNAL_INTEREST_DECISION_BATCH_ENABLED: "true",
  NOISIA_SIGNAL_INTEREST_DECISION_BATCH_PROVIDER_ENABLED: "true" };
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

test("V2 paid drainer is inert by default and before SQL0216", async () => {
  assert.deepEqual(signalWorkspaceInterestDecisionRuntimeConfigurationV2({}),
    { enabled: false, provider_enabled: false });
  const database = { connect: async () => ({ query: async () => ({ rows: [{ ready: false }] }), release() {} }) };
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionBatchesV2({ env: {},
    database: { connect: async () => assert.fail("disabled drainer opened DB") } as never }),
  { disabled: true, schema_ready: false, dispatched: 0 });
  assert.deepEqual(await drainSignalWorkspaceInterestDecisionBatchesV2({ env: enabled,
    database: database as never, queue: { getJob: async () => assert.fail("queue opened"),
      add: async () => assert.fail("queue opened") } }),
  { disabled: false, schema_ready: false, dispatched: 0 });
  await assert.rejects(signalWorkspaceInterestDecisionBatchJobV2({
    id: `interest-decision-batch-v2-${batchId}`, data: { batch_id: batchId },
  }, { env: enabled, database: database as never }), /schema_unavailable/u);
});

test("V2 raw receipt reaches private storage unchanged before SQL settlement", async () => {
  const raw = '{"custom_id":"id2_foo","result":{"type":"errored","error":{"type":"api_error"}}}';
  const rawSha = sha(raw), events: string[] = [];
  const database = { connect: async () => ({ query: async (statement: string) => {
    if (statement.includes("SELECT c.id::text call_id")) return { rows: [{ call_id: callId,
      owner_id: ownerId, workspace_id: workspaceId }] };
    if (statement.includes("persist_signal_interest_decision_item_v2")) {
      events.push("settle"); return { rows: [{ result: { call_id: callId, status: "settled", replayed: false } }] };
    }
    return { rows: [] };
  }, release() {} }) };
  const storage = { put: async (args: { file: string; sha256: string; size_bytes: number }) => {
    assert.equal(await readFile(args.file, "utf8"), raw);
    assert.equal(args.sha256, rawSha);
    assert.equal(args.size_bytes, Buffer.byteLength(raw));
    events.push("raw");
    return { storage_key: `workspace-engine/${workspaceId}/${ownerId}/interest-decision-${batchId}-${callId}.json.${rawSha.slice(7)}.parts.json`,
      sha256: rawSha, size_bytes: args.size_bytes, media_type: "application/json" };
  } };
  const stores = createSignalWorkspaceInterestDecisionRuntimeStoresV2({ database: database as never,
    storage: storage as never });
  assert.deepEqual(await stores.persistRawAndSettle({ batch_id: batchId, lease_token: randomUUID(),
    state: "ended", provider_batch_id: "msgbatch_test",
    manifest: { requests: [{ provider_request: { custom_id: "id2_foo" } }] } } as never,
  { custom_id: "id2_foo", raw_text: raw, raw_sha256: rawSha }),
  { raw_sha256: rawSha, settlement: "settled", replayed: false });
  assert.deepEqual(events, ["raw", "settle"]);
});
