import { createHash } from "node:crypto";
import type { SignalTopicEditorialDatabaseV1, SignalTopicEditorialLeaseV1 } from "@noisia/db";
import type { SignalTopicEditorialRunnerProviderRequestV1 } from "@noisia/query-engine";
import { decodeSignalTopicEditorialAnthropicReceiptV1, SignalTopicEditorialAnthropicErrorV1,
  type SignalTopicEditorialAnthropicCompletionV1, type SignalTopicEditorialAnthropicLedgerV1,
  type SignalTopicEditorialAnthropicRawReceiptV1 } from "../providers/signal-topic-editorial";

export type SignalTopicEditorialRecoveredCallV1 = {
  call_id: string; attempt_token: string; request_digest: string; request_body: string;
  status: "reserved" | "in_flight" | "response_persisted" | "settled" | "definitely_not_sent" | "outcome_unknown";
  reserved_micro_usd: string; settled_micro_usd: string | null;
  response: null | { body: string; sha256: string; storage_key: string; http_status: number; complete: boolean; provider_request_id: string | null };
};
type Scope = { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1 };
export type SignalTopicEditorialLedgerStoresV1 = {
  readRecovery(args: Scope & { request_digest: string }): Promise<SignalTopicEditorialRecoveredCallV1 | null>;
  reserve(args: Scope & { request_digest: string; provider_available: boolean }): Promise<{ call_id: string; attempt_token: string; status: string; reserved_micro_usd: string }>;
  markSent(args: Scope & { call_id: string; attempt_token: string; provider_available: boolean }): Promise<boolean>;
  persistReceipt(args: Scope & { call_id: string; attempt_token: string; receipt: SignalTopicEditorialAnthropicRawReceiptV1; storage_key: string }): Promise<void>;
  settle(args: { database: SignalTopicEditorialDatabaseV1; call_id: string; attempt_token: string }): Promise<{ status: string; settled_micro_usd?: string; replayed: boolean }>;
  failCall(args: { database: SignalTopicEditorialDatabaseV1; call_id: string; attempt_token: string; definitely_not_sent: boolean }): Promise<string>;
};
const failure = (code: string, outcome: "definitely_not_sent" | "outcome_unknown" = "outcome_unknown") =>
  new SignalTopicEditorialAnthropicErrorV1(code, outcome);
const sha = (body: Uint8Array | string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;

/** Bridges short DB operations to the existing HTTP adapter. No SQL or transaction
 * ownership lives here. Raw-receipt metadata must be durable before settlement. */
export function createSignalTopicEditorialLedgerV1(args: Scope & {
  stores: SignalTopicEditorialLedgerStoresV1; provider_enabled: boolean;
  assertLease: () => void;
  storeRawReceipt: (input: { call_id: string; receipt: SignalTopicEditorialAnthropicRawReceiptV1 }) => Promise<string>;
}) {
  const active = new Map<string, { request: SignalTopicEditorialRunnerProviderRequestV1; call_id: string; attempt_token: string }>();
  const scope = { database: args.database, lease: args.lease };
  const getActive = (key: string) => active.get(key) ?? (() => { throw failure("topic_editorial_attempt_missing"); })();
  async function settle(call: { call_id: string; attempt_token: string }, completion: SignalTopicEditorialAnthropicCompletionV1) {
    const result = await args.stores.settle({ database: args.database, call_id: call.call_id, attempt_token: call.attempt_token });
    const expectedCost=completion.settlement.cost_micro_usd??0;
    if (result.status !== "settled" || result.settled_micro_usd !== String(expectedCost))
      throw failure("topic_editorial_settlement_unresolved");
  }
  const ledger: SignalTopicEditorialAnthropicLedgerV1 = {
    async load(request) {
      args.assertLease();
      const call = await args.stores.readRecovery({ ...scope, request_digest: request.request_digest });
      if (!call) return null;
      if (call.request_digest !== request.request_digest || call.request_body !== request.request_body)
        throw failure("topic_editorial_recovery_request_mismatch");
      if (!call.response) {
        if (request.repair !== undefined && call.status === "definitely_not_sent")
          throw failure("topic_editorial_repair_attempt_exhausted", "definitely_not_sent");
        if (["reserved", "definitely_not_sent"].includes(call.status)) return null;
        throw failure("topic_editorial_recovery_required");
      }
      if (!["response_persisted", "settled", "outcome_unknown"].includes(call.status)) throw failure("topic_editorial_recovery_required");
      const receipt: SignalTopicEditorialAnthropicRawReceiptV1 = {
        request_digest: request.request_digest, idempotency_key: request.idempotency_key,
        bytes: new TextEncoder().encode(call.response.body), sha256: call.response.sha256,
        http_status: call.response.http_status, complete: call.response.complete, provider_request_id: call.response.provider_request_id,
      };
      const completion = decodeSignalTopicEditorialAnthropicReceiptV1(request, receipt);
      if (call.status !== "settled") await settle(call, completion);
      else if (call.settled_micro_usd !== String(completion.settlement.cost_micro_usd??0)) throw failure("topic_editorial_settlement_unresolved");
      return completion;
    },
    async authorize_send(request) {
      args.assertLease();
      if (!args.provider_enabled) return "definitely_not_sent";
      let call: Awaited<ReturnType<SignalTopicEditorialLedgerStoresV1["reserve"]>>;
      try { call = await args.stores.reserve({ ...scope, request_digest: request.request_digest, provider_available: true }); }
      catch (error) {
        if (error instanceof Error && /^(?:topic_editorial|processing|brand_context)_[a-z_]{1,100}$/u.test(error.message))
          throw failure(error.message, "definitely_not_sent");
        throw error;
      }
      if (call.status !== "reserved") return "outcome_unknown";
      active.set(request.request_digest, { call_id: call.call_id, attempt_token: call.attempt_token, request });
      args.assertLease();
      if (!await args.stores.markSent({ ...scope, call_id: call.call_id, attempt_token: call.attempt_token, provider_available: true }))
        return "outcome_unknown";
      return "authorized";
    },
    async persist_receipt(receipt) {
      const call = getActive(receipt.request_digest);
      if (receipt.idempotency_key !== call.request.idempotency_key || sha(receipt.bytes) !== receipt.sha256)
        throw failure("topic_editorial_response_binding_invalid");
      // No lease/permission check here: a paid response must survive revocation.
      const storage_key = await args.storeRawReceipt({ call_id: call.call_id, receipt });
      await args.stores.persistReceipt({ ...scope, call_id: call.call_id, attempt_token: call.attempt_token, receipt, storage_key });
    },
    async record_completion(completion) {
      const call = getActive(completion.settlement.request_digest);
      if (completion.settlement.idempotency_key !== call.request.idempotency_key
        || completion.settlement.request_body_sha256 !== sha(call.request.request_body)) throw failure("topic_editorial_response_binding_invalid");
      await settle(call, completion);
    },
  };
  return { ledger, failActive: async (error: unknown) => {
    const definitely_not_sent = error instanceof SignalTopicEditorialAnthropicErrorV1 && error.outcome === "definitely_not_sent";
    for (const call of active.values()) await args.stores.failCall({ database: args.database,
      call_id: call.call_id, attempt_token: call.attempt_token, definitely_not_sent });
  } };
}
