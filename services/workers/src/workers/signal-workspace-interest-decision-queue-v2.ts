import { createHash } from "node:crypto";
import {
  AnthropicBatchTransportError,
  anthropicBatchErrorReceipt,
  createAnthropicMessageBatchesClient,
  type AnthropicBatchHttpReceipt,
  type AnthropicBatchState,
} from "../providers/anthropic-message-batches";
import {
  parseSignalWorkspaceInterestDecisionBatchItemV2,
  signalWorkspaceInterestDecisionTransportRecoveryV2,
  validateSignalWorkspaceInterestDecisionPageManifestV2,
  type SignalWorkspaceInterestDecisionItemResultV2,
  type SignalWorkspaceInterestDecisionPageManifestV2,
} from "./signal-workspace-interest-decision-batch-v2";

export const SIGNAL_WORKSPACE_INTEREST_DECISION_BATCH_JOB_V2 = "signal-workspace-interest-decision-batch-v2";
type Provider = ReturnType<typeof createAnthropicMessageBatchesClient>;
type State = "prepared" | "submitting" | "submission_unknown" | "in_progress" | "canceling" | "ended";
export type SignalWorkspaceInterestDecisionBatchLeaseV2 = {
  batch_id: string;
  lease_token: string;
  state: State;
  provider_batch_id: string | null;
  manifest: SignalWorkspaceInterestDecisionPageManifestV2;
};

/** SQL0216 adapter contract. Every method fences by batch_id+lease_token;
 * the database, not this process, owns policy, receipts, money and replay.
 * reserveAndMarkSubmitting is ONE transaction: verify owner/admission/current
 * policy, reserve worst-case exposure for ALL requests of this concrete batch,
 * and persist submitting before it returns. A later batch must wait for real
 * settlement/capacity; averages never authorize another wave.
 * persistRawAndSettle is ONE transaction: preserve exact bytes/usage and settle
 * or mark ambiguous before any semantic outcome may be recorded. */
export type SignalWorkspaceInterestDecisionBatchStoresV2 = {
  claimDue(batch_id?: string): Promise<SignalWorkspaceInterestDecisionBatchLeaseV2 | null>;
  reserveAndMarkSubmitting(lease: SignalWorkspaceInterestDecisionBatchLeaseV2): Promise<void>;
  attachProviderBatch(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, state: AnthropicBatchState): Promise<void>;
  markSubmissionUnknown(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, code: string,
    acknowledged_state: AnthropicBatchState | null, receipt?: AnthropicBatchHttpReceipt | null): Promise<void>;
  markKnownRejection(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, code: string,
    receipt: AnthropicBatchHttpReceipt | null): Promise<void>;
  recordPoll(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, state: AnthropicBatchState): Promise<void>;
  persistRawAndSettle(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, result: {
    custom_id: string; raw_text: string; raw_sha256: string;
  }): Promise<{ raw_sha256: string; settlement: "settled" | "ambiguous"; replayed: boolean }>;
  recordOutcome(lease: SignalWorkspaceInterestDecisionBatchLeaseV2,
    result: SignalWorkspaceInterestDecisionItemResultV2): Promise<void>;
  finishImport(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, result: {
    provider_state: AnthropicBatchState; received_custom_ids: string[];
    status: "ready_for_review" | "needs_recovery";
  }): Promise<void>;
  releaseLease(lease: SignalWorkspaceInterestDecisionBatchLeaseV2, result: {
    next_poll_at: string | null; error_code: string | null;
  }): Promise<void>;
};

export type SignalWorkspaceInterestDecisionTickResultV2 = "idle" | "submitted" | "waiting" | "imported"
  | "needs_recovery" | "submission_unknown" | "known_rejection" | "retry_read";
const hash = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const fail = (code: string): never => { throw new Error(`workspace_interest_batch_v2_${code}`); };
const safeCode = (error: unknown) => error instanceof AnthropicBatchTransportError
  ? error.code : error instanceof Error && /^workspace_interest_batch_v2_[a-z_]+$/u.test(error.message)
    ? error.message : error instanceof Error && error.message === "interest_decision_batch_authority_invalid"
      ? "workspace_interest_batch_v2_authority_changed" : "workspace_interest_batch_v2_store_or_runtime_error";
function checkState(state: AnthropicBatchState, lease: SignalWorkspaceInterestDecisionBatchLeaseV2) {
  const expected = lease.manifest.requests.length;
  const counts = state.request_counts;
  if (Object.values(counts).reduce((sum, value) => sum + value, 0) !== expected) fail("provider_count_mismatch");
}
function later(now: () => Date, milliseconds: number) {
  return new Date(now().getTime() + milliseconds).toISOString();
}

/** Exactly one submit, poll or bounded results import. The caller may enqueue
 * the same batch ID repeatedly; only persisted SQL state authorizes a POST. */
export async function runSignalWorkspaceInterestDecisionBatchTickV2(args: {
  stores: SignalWorkspaceInterestDecisionBatchStoresV2;
  provider?: Provider;
  api_key?: string;
  fetch?: typeof globalThis.fetch;
  batch_id?: string;
  now?: () => Date;
  poll_delay_ms?: number;
  import_items_per_tick?: number;
}): Promise<SignalWorkspaceInterestDecisionTickResultV2> {
  const pollDelay = args.poll_delay_ms ?? 60_000;
  const importLimit = args.import_items_per_tick ?? 100;
  if (!Number.isSafeInteger(pollDelay) || pollDelay < 1_000 || !Number.isSafeInteger(importLimit) || importLimit < 1)
    fail("tick_configuration_invalid");
  const provider = args.provider ?? createAnthropicMessageBatchesClient({ apiKey: args.api_key ?? "", fetch: args.fetch });
  const now = args.now ?? (() => new Date());
  const lease = await args.stores.claimDue(args.batch_id);
  if (!lease) return "idle";
  let nextPoll: string | null = later(now, pollDelay);
  let errorCode: string | null = null;
  try {
    validateSignalWorkspaceInterestDecisionPageManifestV2(lease.manifest);
    if (!lease.batch_id || !lease.lease_token || !lease.manifest.requests.length) fail("lease_invalid");
    if (lease.state === "submitting" || lease.state === "submission_unknown") {
      // A crashed POST may have been accepted. Only an independently verified
      // provider receipt may reconcile this state; custom_id cannot dedupe POST.
      nextPoll = null;
      await args.stores.markSubmissionUnknown(lease, "workspace_interest_batch_v2_submission_unknown", null);
      return "submission_unknown";
    }
    if (lease.state === "prepared") {
      if (lease.provider_batch_id !== null) fail("provider_identity_invalid");
      // A rejected or failed reservation stops here; there has been no HTTP IO.
      await args.stores.reserveAndMarkSubmitting(lease);
      let state: AnthropicBatchState;
      try {
        state = await provider.create(lease.manifest.requests.map(request => request.provider_request));
      } catch (error) {
        nextPoll = null;
        errorCode = safeCode(error);
        if (signalWorkspaceInterestDecisionTransportRecoveryV2(error) === "known_rejection") {
          await args.stores.markKnownRejection(lease, errorCode,
            error instanceof AnthropicBatchTransportError ? anthropicBatchErrorReceipt(error) : null);
          return "known_rejection";
        }
        await args.stores.markSubmissionUnknown(lease, errorCode, null,
          error instanceof AnthropicBatchTransportError ? anthropicBatchErrorReceipt(error) : null);
        return "submission_unknown";
      }
      try { checkState(state, lease); }
      catch (error) {
        nextPoll = null;
        errorCode = safeCode(error);
        await args.stores.markSubmissionUnknown(lease, errorCode, state);
        return "submission_unknown";
      }
      try { await args.stores.attachProviderBatch(lease, state); }
      catch (error) {
        nextPoll = null;
        errorCode = safeCode(error);
        // The ACK is known to this process. Keep it for recovery; never POST again.
        await args.stores.markSubmissionUnknown(lease, errorCode, state);
        return "submission_unknown";
      }
      return "submitted";
    }
    if (!lease.provider_batch_id) return fail("provider_identity_missing");
    const state = await provider.get(lease.provider_batch_id);
    if (state.id !== lease.provider_batch_id) fail("provider_identity_mismatch");
    checkState(state, lease);
    await args.stores.recordPoll(lease, state);
    if (state.processing_status !== "ended") return "waiting";

    const expected = new Set(lease.manifest.requests.map(request => request.provider_request.custom_id));
    const seen = new Map<string, string>();
    const counts = { succeeded: 0, errored: 0, canceled: 0, expired: 0 };
    let imported = 0;
    let needsRecovery = false;
    for await (const { item, rawText } of provider.results(state)) {
      if (!expected.has(item.custom_id)) fail("foreign_custom_id");
      const raw_sha256 = hash(rawText);
      const prior = seen.get(item.custom_id);
      if (prior && prior !== raw_sha256) fail("duplicate_result_conflict");
      if (prior) continue;
      seen.set(item.custom_id, raw_sha256);
      counts[item.result.type]++;
      // DB must store exact raw bytes and billed usage before semantic parsing.
      const settlement = await args.stores.persistRawAndSettle(lease, {
        custom_id: item.custom_id, raw_text: rawText, raw_sha256 });
      if (settlement.raw_sha256 !== raw_sha256) fail("raw_receipt_mismatch");
      if (settlement.settlement === "settled") {
        const outcome = parseSignalWorkspaceInterestDecisionBatchItemV2({ manifest: lease.manifest, item, rawText });
        await args.stores.recordOutcome(lease, outcome);
        if (outcome.status !== "accepted") needsRecovery = true;
      } else needsRecovery = true;
      // Replayed GET results are cheap and must not consume the per-tick import
      // quota again, otherwise a long result stream would never advance.
      if (!settlement.replayed) imported++;
      if (seen.size < expected.size && imported >= importLimit) {
        nextPoll = later(now, 1_000);
        return "waiting";
      }
    }
    if (seen.size !== expected.size || state.request_counts.processing !== 0
      || (Object.keys(counts) as Array<keyof typeof counts>).some(key => counts[key] !== state.request_counts[key]))
      fail("result_coverage_incomplete");
    await args.stores.finishImport(lease, { provider_state: state,
      received_custom_ids: [...seen.keys()], status: needsRecovery ? "needs_recovery" : "ready_for_review" });
    nextPoll = null;
    return needsRecovery ? "needs_recovery" : "imported";
  } catch (error) {
    errorCode = safeCode(error);
    // A partial import is durable. The next tick repeats GET, never CREATE.
    return "retry_read";
  } finally {
    await args.stores.releaseLease(lease, { next_poll_at: nextPoll, error_code: errorCode });
  }
}
