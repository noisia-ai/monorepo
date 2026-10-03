import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SignalWorkspaceInterestDecisionRequestBodyV1 } from "@noisia/query-engine";
import { createAnthropicMessageBatchesClient, type AnthropicBatchItem, type AnthropicBatchState } from "../providers/anthropic-message-batches";
import { buildSignalWorkspaceInterestDecisionPageManifestV2 } from "./signal-workspace-interest-decision-batch-v2";
import { runSignalWorkspaceInterestDecisionBatchTickV2,
  type SignalWorkspaceInterestDecisionBatchLeaseV2,
  type SignalWorkspaceInterestDecisionBatchStoresV2 } from "./signal-workspace-interest-decision-queue-v2";

const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const text = "Alexa+ se activó sin permiso.";
const page: SignalWorkspaceInterestDecisionRequestBodyV1 = {
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: randomUUID(), term_key: "alexa_consent", definition_revision: 1,
    definition_digest: sha("definition"), definition: "Activación sin consentimiento de Alexa+",
    inclusion: ["Sin permiso"], exclusion: ["Activación solicitada"] },
  roots: [{ root_id: randomUUID(), fingerprint: sha("root"), correction_digest: sha("correction"),
    asset_sha256: sha(text), chunks: [{ chunk_index: 0, start: 0, end: text.length,
      chunk_sha256: sha(text), text }] }],
};
const manifest = buildSignalWorkspaceInterestDecisionPageManifestV2({ page,
  expected_root_ids: page.roots.map(root => root.root_id) });
const state = (ended: boolean, errored = false): AnthropicBatchState => ({
  id: "msgbatch_v2_test", processing_status: ended ? "ended" : "in_progress",
  request_counts: { processing: ended ? 0 : 1, succeeded: ended && !errored ? 1 : 0,
    errored: ended && errored ? 1 : 0, canceled: 0, expired: 0 },
  ended_at: ended ? new Date(0).toISOString() : null,
  results_url: ended ? "https://example.invalid/results" : null,
});
function harness() {
  const events: string[] = [];
  const lease: SignalWorkspaceInterestDecisionBatchLeaseV2 = { batch_id: randomUUID(),
    lease_token: randomUUID(), state: "prepared", provider_batch_id: null, manifest };
  const stores: SignalWorkspaceInterestDecisionBatchStoresV2 = {
    async claimDue() { return lease; },
    async reserveAndMarkSubmitting() { events.push("reserve"); lease.state = "submitting"; },
    async attachProviderBatch(_lease, receipt) { events.push("attach"); lease.state = receipt.processing_status;
      lease.provider_batch_id = receipt.id; },
    async markSubmissionUnknown() { events.push("unknown"); lease.state = "submission_unknown"; },
    async markKnownRejection() { events.push("reject"); lease.state = "submission_unknown"; },
    async recordPoll(_lease, receipt) { events.push("poll"); lease.state = receipt.processing_status; },
    async persistRawAndSettle(_lease, result) { events.push("raw"); assert.equal(result.raw_sha256, sha(result.raw_text));
      return { raw_sha256: result.raw_sha256, settlement: "settled", replayed: false }; },
    async recordOutcome(_lease, result) { assert.equal(events.at(-1), "raw"); events.push(`outcome_${result.status}`); },
    async finishImport(_lease, result) { events.push(`finish_${result.status}`); },
    async releaseLease() { events.push("release"); },
  };
  return { lease, stores, events };
}

test("V2 feature transport never repeats an uncertain POST", async () => {
  const h = harness(); let posts = 0;
  const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async () => {
    posts++; throw new Error("lost response after POST");
  } });
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV2({ stores: h.stores, provider }), "submission_unknown");
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV2({ stores: h.stores, provider }), "submission_unknown");
  assert.equal(posts, 1);
  assert.deepEqual(h.events.filter(event => event === "reserve"), ["reserve"]);
});

test("V2 provider item error stores raw before semantic status and remains recoverable", async () => {
  const h = harness();
  const item: AnthropicBatchItem = { custom_id: manifest.requests[0]!.provider_request.custom_id,
    result: { type: "errored", error: { type: "api_error" } } };
  const provider: ReturnType<typeof createAnthropicMessageBatchesClient> = {
    async create() { h.events.push("create"); return state(false); },
    async get() { return state(true, true); },
    async cancel() { throw new Error("unexpected cancel"); },
    async *results() { yield { item, rawText: JSON.stringify(item) }; },
  };
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV2({ stores: h.stores, provider }), "submitted");
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV2({ stores: h.stores, provider }), "needs_recovery");
  assert.deepEqual(h.events.filter(event => event === "raw" || event.startsWith("outcome_") || event.startsWith("finish_")),
    ["raw", "outcome_provider_error", "finish_needs_recovery"]);
});

test("V2 reservation failure makes no provider request", async () => {
  const h = harness(); let posts = 0;
  h.stores.reserveAndMarkSubmitting = async () => { throw new Error("authority revoked"); };
  const provider = createAnthropicMessageBatchesClient({ apiKey: "test-only", fetch: async () => {
    posts++; throw new Error("must not send");
  } });
  assert.equal(await runSignalWorkspaceInterestDecisionBatchTickV2({ stores: h.stores, provider }), "retry_read");
  assert.equal(posts, 0);
});
