import { createHash } from "node:crypto";
import {
  classifySignalTopicEditorialMessageResultV2,
  validateSignalTopicEditorialGroupRequestV2,
  type SignalTopicEditorialGroupRequestV2,
  type SignalTopicEditorialMessageResultV2,
} from "@noisia/query-engine";
import {
  AnthropicBatchTransportError,
  anthropicBatchErrorReceipt,
  type AnthropicBatchHttpReceipt,
  type AnthropicBatchItem,
  type AnthropicBatchState,
  type createAnthropicMessageBatchesClient,
} from "../providers/anthropic-message-batches";

export type SignalTopicEditorialBatchLeaseV2 = {
  batch_id: string;
  lease_token: string;
  state: "prepared" | "submitting" | "submission_unknown" | "in_progress" | "canceling" | "ended";
  provider_batch_id: string | null;
  items: Array<{ call_id: string; request: SignalTopicEditorialGroupRequestV2;
    raw_sha256?: string | null; validation?: SignalTopicEditorialBatchValidationV2 | null }>;
};
export type SignalTopicEditorialBatchValidationV2 = SignalTopicEditorialMessageResultV2
  | { status: "provider_error"; code: string }
  | { status: "canceled"; code: string }
  | { status: "expired"; code: string };

/** The database is the authority for leases, request identity, exposure, result
 * receipts and replay. These ports never create a second ledger in the worker. */
export type SignalTopicEditorialBatchStoresV2 = {
  claimDue(): Promise<SignalTopicEditorialBatchLeaseV2 | null>;
  markSubmitting(lease: SignalTopicEditorialBatchLeaseV2): Promise<void>;
  attachProviderBatch(lease: SignalTopicEditorialBatchLeaseV2, state: AnthropicBatchState): Promise<void>;
  markSubmissionUncertain(lease: SignalTopicEditorialBatchLeaseV2, code: string): Promise<void>;
  markSubmissionRejected(lease: SignalTopicEditorialBatchLeaseV2, code: string, receipt: AnthropicBatchHttpReceipt | null): Promise<void>;
  recordPoll(lease: SignalTopicEditorialBatchLeaseV2, state: AnthropicBatchState): Promise<void>;
  persistItem(lease: SignalTopicEditorialBatchLeaseV2, args: {
    custom_id: string; call_id: string; raw_text: string; raw_sha256: string;
  }): Promise<void>;
  recordValidation(lease: SignalTopicEditorialBatchLeaseV2, args: {
    custom_id: string; raw_sha256: string; validation: SignalTopicEditorialBatchValidationV2;
  }): Promise<void>;
  finishImport(lease: SignalTopicEditorialBatchLeaseV2, args: {
    provider_state: AnthropicBatchState; received_custom_ids: string[];
  }): Promise<void>;
  release(lease: SignalTopicEditorialBatchLeaseV2, args: { next_poll_at: string | null; error_code: string | null }): Promise<void>;
};

type Provider = ReturnType<typeof createAnthropicMessageBatchesClient>;
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const safeError = (error: unknown) => error instanceof AnthropicBatchTransportError
  ? error.code : error instanceof Error && /^topic_editorial_[a-z0-9_]+$/u.test(error.message)
    ? error.message : "topic_editorial_batch_store_or_runtime_error";

/** One short submit, one poll, or one results import. No sleeping job/lease while
 * Anthropic processes, and no automatic repeat of an uncertain POST. */
export async function runSignalTopicEditorialBatchTickV2(args: {
  stores: SignalTopicEditorialBatchStoresV2;
  provider: Provider;
  now?: () => Date;
  poll_delay_ms?: number;
  import_items_per_tick?: number;
}): Promise<"idle" | "submitted" | "waiting" | "imported" | "submission_unknown" | "rejected" | "retry_read"> {
  const { stores, provider } = args;
  const now = args.now ?? (() => new Date());
  const delay = args.poll_delay_ms ?? 60_000;
  if (!Number.isSafeInteger(delay) || delay < 1_000) throw new Error("topic_editorial_batch_poll_interval_invalid");
  const importLimit = args.import_items_per_tick ?? 100;
  if (!Number.isSafeInteger(importLimit) || importLimit < 1) throw new Error("topic_editorial_batch_import_limit_invalid");
  const lease = await stores.claimDue();
  if (!lease) return "idle";
  const later = () => new Date(now().getTime() + delay).toISOString();
  let nextPoll: string | null = later();
  let errorCode: string | null = null;
  try {
    const byCustomId = new Map(lease.items.map(item => [item.request.provider_request.custom_id, item]));
    if (lease.items.length === 0 || byCustomId.size !== lease.items.length) throw new Error("batch_manifest_invalid");
    for (const item of lease.items) validateSignalTopicEditorialGroupRequestV2(item.request);

    if (lease.state === "submitting" || lease.state === "submission_unknown") {
      // A process may have died after POST. Only a separately verified provider
      // receipt can reconcile it. A new tick must not submit these items again.
      nextPoll = null;
      await stores.markSubmissionUncertain(lease, "topic_editorial_batch_submission_unknown");
      return "submission_unknown";
    }
    if (lease.state === "prepared") {
      if (lease.provider_batch_id !== null) throw new Error("batch_manifest_invalid");
      // This transaction rechecks authorization and reserves exposure BEFORE IO.
      // If it fails, there has been no provider request and it must not be labeled
      // as an ambiguous submission.
      await stores.markSubmitting(lease);
      let state: AnthropicBatchState;
      try {
        state = await provider.create(lease.items.map(item => item.request.provider_request));
      } catch (error) {
        nextPoll = null;
        errorCode = safeError(error);
        if (error instanceof AnthropicBatchTransportError && error.submission === "not_submitted") {
          await stores.markSubmissionRejected(lease, errorCode, anthropicBatchErrorReceipt(error));
          return "rejected";
        }
        await stores.markSubmissionUncertain(lease, errorCode);
        return "submission_unknown";
      }
      // If the ACK fails, the persisted submitting state protects against another
      // POST. The caller can reconcile the known provider ID; never resend it.
      await stores.attachProviderBatch(lease, state);
      return "submitted";
    }

    if (!lease.provider_batch_id) throw new Error("batch_provider_identity_missing");
    const state = await provider.get(lease.provider_batch_id);
    if (state.id !== lease.provider_batch_id) throw new Error("batch_provider_identity_mismatch");
    await stores.recordPoll(lease, state);
    if (state.processing_status !== "ended") return "waiting";

    const seen = new Map<string, string>();
    const counts = { succeeded: 0, errored: 0, canceled: 0, expired: 0 };
    const importStarted = now().getTime();
    let imported = 0;
    for await (const { item, rawText } of provider.results(state)) {
      const bound = byCustomId.get(item.custom_id);
      if (!bound) throw new Error("batch_foreign_custom_id");
      const rawSha = hash(rawText);
      if (seen.has(item.custom_id)) {
        if (seen.get(item.custom_id) !== rawSha) throw new Error("batch_duplicate_conflicting_item");
        continue;
      }
      if (bound.validation && bound.raw_sha256) {
        if (bound.raw_sha256 !== rawSha) throw new Error("topic_editorial_batch_receipt_changed");
        counts[item.result.type]++;
        seen.set(item.custom_id, rawSha);
        continue;
      }
      // The full provider outcome/usage is durable even if semantic validation
      // fails. Persist performs exact billing and replay against the SAME call.
      await stores.persistItem(lease, {
        custom_id: item.custom_id, call_id: bound.call_id, raw_text: rawText, raw_sha256: rawSha,
      });
      const validation = validateItem(bound.request, item);
      await stores.recordValidation(lease, { custom_id: item.custom_id, raw_sha256: rawSha, validation });
      counts[item.result.type]++;
      seen.set(item.custom_id, rawSha);
      imported++;
      if (seen.size < byCustomId.size && (imported >= importLimit || now().getTime() - importStarted >= 45_000)) {
        // This is an operational chunk, never a sampling or quality limit. The
        // next tick resumes from durable item receipts and imports the remainder.
        nextPoll = new Date(now().getTime() + 1_000).toISOString();
        return "waiting";
      }
    }
    if (seen.size !== byCustomId.size || state.request_counts.processing !== 0
      || (Object.keys(counts) as Array<keyof typeof counts>).some(key => state.request_counts[key] !== counts[key])) {
      throw new Error("batch_results_coverage_incomplete");
    }
    await stores.finishImport(lease, { provider_state: state, received_custom_ids: [...seen.keys()] });
    nextPoll = null;
    return "imported";
  } catch (error) {
    errorCode = safeError(error);
    // Already-received items remain committed. A later tick only repeats a GET,
    // or quarantines a submitting owner. It never retries paid work blindly.
    return "retry_read";
  } finally {
    await stores.release(lease, { next_poll_at: nextPoll, error_code: errorCode });
  }
}

function validateItem(request: SignalTopicEditorialGroupRequestV2, item: AnthropicBatchItem): SignalTopicEditorialBatchValidationV2 {
  if (item.result.type === "succeeded") return classifySignalTopicEditorialMessageResultV2(request, item.result.message);
  if (item.result.type === "errored") return { status: "provider_error", code: "topic_editorial_v2_provider_errored" };
  return { status: item.result.type, code: `topic_editorial_v2_provider_${item.result.type}` };
}
