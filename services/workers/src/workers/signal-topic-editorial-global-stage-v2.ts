import { createHash } from "node:crypto";
import {
  validateSignalTopicEditorialGlobalMergeResultV2,
  validateSignalTopicEditorialGlobalRankingResultV2,
  validateSignalTopicEditorialGlobalShardResultV2,
  type SignalTopicEditorialGlobalMergeReviewV2,
  type SignalTopicEditorialGlobalMergeResultV2,
  type SignalTopicEditorialGlobalRankingReviewV2,
  type SignalTopicEditorialGlobalRankingResultV2,
  type SignalTopicEditorialGlobalShardResultV2,
  type SignalTopicEditorialGlobalShardV2,
} from "@noisia/query-engine";
import {
  AnthropicBatchTransportError,
  anthropicBatchErrorReceipt,
  type AnthropicBatchHttpReceipt,
  type AnthropicBatchItem,
  type AnthropicBatchState,
  type createAnthropicMessageBatchesClient,
} from "../providers/anthropic-message-batches";

export const SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_MAX_REQUESTS_V2 = 100;
type Provider = ReturnType<typeof createAnthropicMessageBatchesClient>;
type ProviderRequest = { custom_id: string; params: { model: string; max_tokens: number; [key: string]: unknown } };

export type SignalTopicEditorialGlobalStageItemV2 =
  | { stage_id:string;stage_kind: "shard"; call_id: string; shard: SignalTopicEditorialGlobalShardV2; provider_request: ProviderRequest;
      raw_sha256?: string | null; validation?: SignalTopicEditorialGlobalStageValidationV2 | null }
  | { stage_id:string;stage_kind: "merge"; call_id: string; review: SignalTopicEditorialGlobalMergeReviewV2; provider_request: ProviderRequest;
      raw_sha256?: string | null; validation?: SignalTopicEditorialGlobalStageValidationV2 | null }
  | { stage_id:string;stage_kind: "rank"; call_id: string; review: SignalTopicEditorialGlobalRankingReviewV2; provider_request: ProviderRequest;
      raw_sha256?: string | null; validation?: SignalTopicEditorialGlobalStageValidationV2 | null };

export type SignalTopicEditorialGlobalStageValidationV2 =
  | { status: "accepted_shard"; result: SignalTopicEditorialGlobalShardResultV2 }
  | { status: "accepted_merge"; result: SignalTopicEditorialGlobalMergeResultV2 }
  | { status: "accepted_rank"; result: SignalTopicEditorialGlobalRankingResultV2 }
  | { status: "invalid_output" | "provider_error" | "canceled" | "expired"; code: string };

export type SignalTopicEditorialGlobalStageLeaseV2 = {
  provider_batch_id: string;
  lease_token: string;
  manifest_digest: string;
  stage_kind: "shard" | "merge" | "rank";
  state: "prepared" | "submitting" | "submission_unknown" | "in_progress" | "canceling" | "ended";
  provider_id: string | null;
  items: SignalTopicEditorialGlobalStageItemV2[];
};

/** Postgres remains authoritative for stage ownership, spend, idempotency and receipts. */
export type SignalTopicEditorialGlobalStageStoresV2 = {
  claimDue(): Promise<SignalTopicEditorialGlobalStageLeaseV2 | null>;
  markSubmitting(lease: SignalTopicEditorialGlobalStageLeaseV2): Promise<void>;
  attachProviderBatch(lease: SignalTopicEditorialGlobalStageLeaseV2, state: AnthropicBatchState): Promise<void>;
  markSubmissionUncertain(lease: SignalTopicEditorialGlobalStageLeaseV2, code: string): Promise<void>;
  markSubmissionRejected(lease: SignalTopicEditorialGlobalStageLeaseV2, code: string, receipt: AnthropicBatchHttpReceipt | null): Promise<void>;
  recordPoll(lease: SignalTopicEditorialGlobalStageLeaseV2, state: AnthropicBatchState): Promise<void>;
  persistRawReceipt(lease: SignalTopicEditorialGlobalStageLeaseV2, args: {
    custom_id: string; call_id: string; stage_identity: string; raw_text: string; raw_sha256: string;
  }): Promise<void>;
  recordValidation(lease: SignalTopicEditorialGlobalStageLeaseV2, args: {
    custom_id: string; raw_sha256: string; validation: SignalTopicEditorialGlobalStageValidationV2;
  }): Promise<void>;
  finishImport(lease: SignalTopicEditorialGlobalStageLeaseV2, args: {
    provider_state: AnthropicBatchState; received_custom_ids: string[];
  }): Promise<void>;
  release(lease: SignalTopicEditorialGlobalStageLeaseV2, args: { next_poll_at: string | null; error_code: string | null }): Promise<void>;
};

const stable = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? "[" + value.map(stable).join(",") + "]"
    : "{" + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => JSON.stringify(key) + ":" + stable(child)).join(",") + "}";
const sha = (text: string) => "sha256:" + createHash("sha256").update(text).digest("hex");
const safeError = (error: unknown) => error instanceof AnthropicBatchTransportError
  ? error.code : error instanceof Error && /^topic_editorial_[a-z0-9_]+$/u.test(error.message)
    ? error.message : "topic_editorial_global_stage_store_or_runtime_error";
const validId = (value: string) => /^[A-Za-z0-9_-]{1,64}$/u.test(value);
const validDigest = (value: string) => /^sha256:[0-9a-f]{64}$/u.test(value);

export function signalTopicEditorialGlobalStageRequestIdentityV2(item: SignalTopicEditorialGlobalStageItemV2) {
  if (item.stage_kind === "shard") {
    const review = item.shard;
    if (!review.request_digest || !review.request_body || review.contract_version !== "signal-topic-editorial-global-shard-v2")
      throw new Error("topic_editorial_global_stage_request_invalid");
    return sha(stable({ stage_id:item.stage_id,snapshot_digest:review.snapshot_digest,stage_kind:item.stage_kind,round:0,
      batch_index:review.batch_index,input_digest:review.input_digest,request_digest:review.request_digest }));
  } else if(item.stage_kind==="rank"){
    const review=item.review;
    if(review.contract_version!=="signal-topic-editorial-global-ranking-review-v2")
      throw new Error("topic_editorial_global_stage_request_invalid");
    return sha(stable({stage_id:item.stage_id,snapshot_digest:review.snapshot_digest,stage_kind:item.stage_kind,round:0,
      batch_index:0,input_digest:review.input_digest,request_digest:review.request_digest}));
  }
  const review = item.review;
  if (review.contract_version !== "signal-topic-editorial-global-merge-review-v2")
    throw new Error("topic_editorial_global_stage_request_invalid");
  return sha(stable({ stage_id:item.stage_id,snapshot_digest:review.snapshot_digest,stage_kind:item.stage_kind,round:review.round,
    input_digest: review.input_digest, batch_index: review.batch_index, request_digest: review.request_digest }));
}

export function signalTopicEditorialGlobalStageManifestDigestV2(args:{stage_kind:'shard'|'merge'|'rank';items:SignalTopicEditorialGlobalStageItemV2[]}) {
  const material=args.items.map(item=>({custom_id:item.provider_request.custom_id,call_id:item.call_id,
    stage_identity:signalTopicEditorialGlobalStageRequestIdentityV2(item),
    request_digest:item.stage_kind==='shard'?item.shard.request_digest:item.review.request_digest}))
    .sort((a,b)=>a.custom_id<b.custom_id?-1:a.custom_id>b.custom_id?1:0);
  return sha(stable({stage_kind:args.stage_kind,items:material}));
}

function validateManifest(lease: SignalTopicEditorialGlobalStageLeaseV2) {
  if (!lease.provider_batch_id || !validId(lease.lease_token) || !validDigest(lease.manifest_digest)
    || lease.items.length < 1 || lease.items.length > SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_MAX_REQUESTS_V2
    || lease.stage_kind==="rank"&&lease.items.length!==1
    || lease.items.some(item => item.stage_kind !== lease.stage_kind)) throw new Error("topic_editorial_global_stage_manifest_invalid");
  const customIds = new Set<string>(), callIds = new Set<string>(), identities = new Set<string>();
  for (const item of lease.items) {
    const request = item.provider_request;
    if (!validId(item.stage_id) || !validId(item.call_id) || !validId(request.custom_id)
      || customIds.has(request.custom_id) || callIds.has(item.call_id)
      || !request.params || typeof request.params.model !== "string" || !request.params.model.trim()
      || !Number.isSafeInteger(request.params.max_tokens) || request.params.max_tokens <= 0)
      throw new Error("topic_editorial_global_stage_manifest_invalid");
    customIds.add(request.custom_id); callIds.add(item.call_id);
    const identity = signalTopicEditorialGlobalStageRequestIdentityV2(item);
    if (identities.has(identity)) throw new Error("topic_editorial_global_stage_identity_duplicate");
    identities.add(identity);
    const body = item.stage_kind === "shard" ? item.shard.request_body! : item.review.request_body;
    let sealed: unknown;
    try { sealed = JSON.parse(body); } catch { throw new Error("topic_editorial_global_stage_request_invalid"); }
    if (sha(stable(sealed)) !== sha(stable(request.params))) throw new Error("topic_editorial_global_stage_request_drift");
    if (item.raw_sha256 !== undefined && item.raw_sha256 !== null && !validDigest(item.raw_sha256))
      throw new Error("topic_editorial_global_stage_receipt_invalid");
  }
  if (signalTopicEditorialGlobalStageManifestDigestV2({stage_kind:lease.stage_kind,items:lease.items}) !== lease.manifest_digest)
    throw new Error("topic_editorial_global_stage_manifest_digest_mismatch");
  return new Map(lease.items.map(item => [item.provider_request.custom_id, item]));
}

function extractMessageText(item: AnthropicBatchItem): { validation: SignalTopicEditorialGlobalStageValidationV2 | null; text: string | null } {
  if (item.result.type === "errored") return { validation: { status: "provider_error", code: "topic_editorial_global_stage_provider_errored" }, text: null };
  if (item.result.type === "canceled" || item.result.type === "expired")
    return { validation: { status: item.result.type, code: "topic_editorial_global_stage_provider_" + item.result.type }, text: null };
  const message = item.result.message;
  if (!message || typeof message !== "object" || Array.isArray(message))
    return { validation: { status: "invalid_output", code: "topic_editorial_global_stage_message_invalid" }, text: null };
  const record = message as Record<string, unknown>;
  if (record.stop_reason === "max_tokens") return { validation: { status: "invalid_output", code: "topic_editorial_global_stage_max_tokens" }, text: null };
  if (record.stop_reason === "refusal") return { validation: { status: "invalid_output", code: "topic_editorial_global_stage_refusal" }, text: null };
  if (!Array.isArray(record.content)) return { validation: { status: "invalid_output", code: "topic_editorial_global_stage_content_invalid" }, text: null };
  const texts = record.content.flatMap(block => block && typeof block === "object" && !Array.isArray(block)
    && (block as Record<string, unknown>).type === "text" && typeof (block as Record<string, unknown>).text === "string"
    ? [(block as Record<string, unknown>).text as string] : []);
  if (texts.length !== 1) return { validation: { status: "invalid_output", code: "topic_editorial_global_stage_text_invalid" }, text: null };
  return { validation: null, text: texts[0]! };
}

function validateOutput(item: SignalTopicEditorialGlobalStageItemV2, providerItem: AnthropicBatchItem): SignalTopicEditorialGlobalStageValidationV2 {
  const extracted = extractMessageText(providerItem);
  if (extracted.validation) return extracted.validation;
  let value: unknown;
  try { value = JSON.parse(extracted.text!); }
  catch { return { status: "invalid_output", code: "topic_editorial_global_stage_json_invalid" }; }
  try {
    if (item.stage_kind === "shard") return { status: "accepted_shard",
      result: validateSignalTopicEditorialGlobalShardResultV2({ shard: item.shard, value }) };
    if(item.stage_kind==="rank")return {status:"accepted_rank",
      result:validateSignalTopicEditorialGlobalRankingResultV2({review:item.review,value})};
    return { status: "accepted_merge", result: validateSignalTopicEditorialGlobalMergeResultV2({ review: item.review, value }) };
  } catch (error) {
    const code = error instanceof Error && /^topic_editorial_global_[a-z0-9_]+$/u.test(error.message)
      ? error.message : "topic_editorial_global_stage_output_invalid";
    return { status: "invalid_output", code };
  }
}

/** One tick submits a sealed batch, polls once or imports a bounded chunk.
 * An ambiguous POST is quarantined; the provider has no idempotency key. */
export async function runSignalTopicEditorialGlobalStageTickV2(args: {
  stores: SignalTopicEditorialGlobalStageStoresV2; provider: Provider; now?: () => Date;
  poll_delay_ms?: number; import_items_per_tick?: number;
}): Promise<"idle" | "submitted" | "waiting" | "imported" | "submission_unknown" | "rejected" | "retry_read"> {
  const { stores, provider } = args, now = args.now ?? (() => new Date());
  const delay = args.poll_delay_ms ?? 60_000, importLimit = args.import_items_per_tick ?? 100;
  if (!Number.isSafeInteger(delay) || delay < 1_000) throw new Error("topic_editorial_global_stage_poll_interval_invalid");
  if (!Number.isSafeInteger(importLimit) || importLimit < 1 || importLimit > SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_MAX_REQUESTS_V2)
    throw new Error("topic_editorial_global_stage_import_limit_invalid");
  const lease = await stores.claimDue(); if (!lease) return "idle";
  const later = () => new Date(now().getTime() + delay).toISOString();
  let nextPoll: string | null = later(), errorCode: string | null = null;
  try {
    const byCustomId = validateManifest(lease);
    if (lease.state === "submitting" || lease.state === "submission_unknown") {
      nextPoll = null; await stores.markSubmissionUncertain(lease, "topic_editorial_global_stage_submission_unknown");
      return "submission_unknown";
    }
    if (lease.state === "prepared") {
      if (lease.provider_id !== null) throw new Error("topic_editorial_global_stage_manifest_invalid");
      await stores.markSubmitting(lease);
      let state: AnthropicBatchState;
      try { state = await provider.create(lease.items.map(item => item.provider_request)); }
      catch (error) {
        nextPoll = null; errorCode = safeError(error);
        if (error instanceof AnthropicBatchTransportError && error.submission === "not_submitted") {
          await stores.markSubmissionRejected(lease, errorCode, anthropicBatchErrorReceipt(error)); return "rejected";
        }
        await stores.markSubmissionUncertain(lease, errorCode); return "submission_unknown";
      }
      await stores.attachProviderBatch(lease, state); return "submitted";
    }
    if (!lease.provider_id) throw new Error("topic_editorial_global_stage_provider_identity_missing");
    const state = await provider.get(lease.provider_id);
    if (state.id !== lease.provider_id) throw new Error("topic_editorial_global_stage_provider_identity_mismatch");
    await stores.recordPoll(lease, state);
    if (state.processing_status !== "ended") return "waiting";

    const seen = new Map<string, string>(), counts = { succeeded: 0, errored: 0, canceled: 0, expired: 0 };
    const importStarted = now().getTime(); let imported = 0;
    for await (const { item, rawText } of provider.results(state)) {
      const bound = byCustomId.get(item.custom_id); if (!bound) throw new Error("topic_editorial_global_stage_foreign_custom_id");
      const rawSha = sha(rawText), previous = seen.get(item.custom_id);
      if (previous) { if (previous !== rawSha) throw new Error("topic_editorial_global_stage_duplicate_conflict"); continue; }
      if (bound.validation && bound.raw_sha256) {
        if (bound.raw_sha256 !== rawSha) throw new Error("topic_editorial_global_stage_receipt_changed");
        if (item.result.type === "succeeded") counts.succeeded++; else counts[item.result.type]++;
        seen.set(item.custom_id, rawSha); continue;
      }
      const stageIdentity = signalTopicEditorialGlobalStageRequestIdentityV2(bound);
      await stores.persistRawReceipt(lease, { custom_id: item.custom_id, call_id: bound.call_id,
        stage_identity: stageIdentity, raw_text: rawText, raw_sha256: rawSha });
      const validation = validateOutput(bound, item);
      await stores.recordValidation(lease, { custom_id: item.custom_id, raw_sha256: rawSha, validation });
      if (item.result.type === "succeeded") counts.succeeded++; else counts[item.result.type]++;
      seen.set(item.custom_id, rawSha); imported++;
      if (seen.size < byCustomId.size && (imported >= importLimit || now().getTime() - importStarted >= 45_000)) {
        nextPoll = new Date(now().getTime() + 1_000).toISOString(); return "waiting";
      }
    }
    if (seen.size !== byCustomId.size || state.request_counts.processing !== 0
      || (Object.keys(counts) as Array<keyof typeof counts>).some(key => state.request_counts[key] !== counts[key]))
      throw new Error("topic_editorial_global_stage_results_coverage_incomplete");
    await stores.finishImport(lease, { provider_state: state, received_custom_ids: [...seen.keys()] });
    nextPoll = null; return "imported";
  } catch (error) { errorCode = safeError(error); return "retry_read"; }
  finally { await stores.release(lease, { next_poll_at: nextPoll, error_code: errorCode }); }
}
