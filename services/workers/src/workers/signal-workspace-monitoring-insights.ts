import type { Job } from "bullmq";
import { buildWorkspaceMonitoringInsightRequestV1, signalWorkspaceEmbeddingDigestV1,
  SIGNAL_WORKSPACE_MONITORING_INSIGHTS_JOB_V1, SIGNAL_WORKSPACE_MONITORING_INSIGHTS_CAP_V1 } from "@noisia/query-engine";
import { createAnthropicMonitoringInsightsProviderV1, MonitoringInsightsProviderErrorV1,
  type MonitoringInsightsProviderV1, type MonitoringInsightsRawReceiptV1 } from "../providers/anthropic-monitoring-insights";

export const SIGNAL_WORKSPACE_MONITORING_INSIGHTS_JOB_NAME = SIGNAL_WORKSPACE_MONITORING_INSIGHTS_JOB_V1;
export type SignalWorkspaceMonitoringInsightsJobV1 = { run_id: string };
type Db = typeof import("@noisia/db");
type Stores = {
  claim: Db["claimMonitoringInsightRunV1"];
  reserve: Db["reserveMonitoringInsightCallV1"];
  markSent: Db["markMonitoringInsightCallSentV1"];
  persistRaw: Db["persistMonitoringInsightRawV1"];
  settle: Db["settleMonitoringInsightCallV1"];
  complete: Db["completeMonitoringInsightRunV1"];
  fail: Db["failMonitoringInsightRunV1"];
};
type Options = {
  database?: Parameters<Stores["claim"]>[0]["database"];
  stores?: Stores; provider?: MonitoringInsightsProviderV1;
  env?: Record<string, string | undefined>;
};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const errorWithCode = (code: string) => Object.assign(new Error(code), { code });
async function defaultStores(): Promise<Stores> {
  const db = await import("@noisia/db");
  return { claim: db.claimMonitoringInsightRunV1, reserve: db.reserveMonitoringInsightCallV1,
    markSent: db.markMonitoringInsightCallSentV1, persistRaw: db.persistMonitoringInsightRawV1,
    settle: db.settleMonitoringInsightCallV1, complete: db.completeMonitoringInsightRunV1, fail: db.failMonitoringInsightRunV1 };
}

/** Job input carries identity only. PostgreSQL owns scope, policy, budget and
 * immutable request bytes. No read, retry or worker restart grants a new send. */
export async function signalWorkspaceMonitoringInsightsJobV1(
  job: Pick<Job<SignalWorkspaceMonitoringInsightsJobV1>, "id" | "data" | "updateProgress">,
  options: Options = {}
) {
  if (!job.id || !job.data || typeof job.data !== "object" || Array.isArray(job.data)
    || Object.keys(job.data).join(",") !== "run_id" || !uuid.test(job.data.run_id)) throw errorWithCode("monitoring_insights_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const store = options.stores ?? await defaultStores();
  const lease = await store.claim({ database, run_id: job.data.run_id });
  if (!lease) return { run_id: job.data.run_id, status: "replayed" as const };
  let call: Awaited<ReturnType<Stores["reserve"]>> | null = null;
  let markAttempted = false; let rawPersisted = false; let completeResponse = false;
  try {
    try {
      if (lease.run_id !== job.data.run_id || !uuid.test(lease.workspace_id) || !lease.execution_token
        || lease.packet.workspace_id !== lease.workspace_id) throw new Error("invalid lease");
      const expected = buildWorkspaceMonitoringInsightRequestV1(lease.packet, lease.request.configuration);
      if (signalWorkspaceEmbeddingDigestV1(expected) !== signalWorkspaceEmbeddingDigestV1(lease.request)
        || !Number.isSafeInteger(expected.reserved_micro_usd) || expected.reserved_micro_usd <= 0
        || expected.reserved_micro_usd > SIGNAL_WORKSPACE_MONITORING_INSIGHTS_CAP_V1) throw new Error("invalid request");
    } catch { throw errorWithCode("monitoring_insights_request_invalid"); }
    call = await store.reserve({ database, lease });
    if (!call || !call.id || !call.attempt_token) throw errorWithCode("monitoring_insights_call_invalid");
    if (["in_flight", "outcome_unknown", "definitely_not_sent"].includes(call.state)) {
      return { run_id: lease.run_id, status: "reconciliation_only" as const };
    }
    if (call.state === "reserved") {
      const env = options.env ?? process.env;
      const apiKey = env.NOISIA_MONITORING_INSIGHTS_ANTHROPIC_API_KEY?.trim();
      if (env.NOISIA_MONITORING_INSIGHTS_ENABLED !== "true" || !apiKey) {
        throw new MonitoringInsightsProviderErrorV1("monitoring_insights_provider_disabled", "definitely_not_sent");
      }
      const provider = options.provider ?? createAnthropicMonitoringInsightsProviderV1({ apiKey });
      markAttempted = true;
      const sent = await store.markSent({ database, lease, call_id: call.id, attempt_token: call.attempt_token });
      // A false CAS may belong to another sender. Never fail or release it.
      if (!sent) return { run_id: lease.run_id, status: "reconciliation_only" as const };
      const receipt = await provider.generate(lease.request);
      if (!validReceipt(receipt)) throw errorWithCode("monitoring_insights_provider_receipt_invalid");
      // Complete, rejected, malformed and incomplete HTTP receipts all reach
      // durable private custody before any JSON/usage/editorial parsing.
      await store.persistRaw({ database, call_id: call.id, attempt_token: call.attempt_token, receipt });
      rawPersisted = true;
      completeResponse = receipt.complete && receipt.http_status === 200;
    } else if (call.state === "response_persisted" || call.state === "settled") {
      if (!Buffer.isBuffer(call.response_body) || call.response_http_status === null || call.response_complete === null) {
        throw errorWithCode("monitoring_insights_response_receipt_missing");
      }
      rawPersisted = true;
      completeResponse = call.response_complete === true && call.response_http_status === 200;
    } else throw errorWithCode("monitoring_insights_call_invalid");
    if (!completeResponse) throw new MonitoringInsightsProviderErrorV1("monitoring_insights_provider_response_unknown", "outcome_unknown");
    const settlement = await store.settle({ database, call_id: call.id, attempt_token: call.attempt_token });
    if (!Number.isSafeInteger(settlement.cost_micro_usd) || settlement.cost_micro_usd < 0
      || settlement.cost_micro_usd > SIGNAL_WORKSPACE_MONITORING_INSIGHTS_CAP_V1) throw errorWithCode("monitoring_insights_settlement_invalid");
    const result = await store.complete({ database, lease, call_id: call.id });
    if (result.run_id !== lease.run_id || result.status !== "completed") throw errorWithCode("monitoring_insights_completion_invalid");
    await job.updateProgress(100).catch(() => undefined);
    return result;
  } catch (error) {
    const provenUnsent = error instanceof MonitoringInsightsProviderErrorV1 && error.outcome === "definitely_not_sent"
      || error && typeof error === "object" && "definitely_not_sent" in error && error.definitely_not_sent === true;
    const outcome = error instanceof MonitoringInsightsProviderErrorV1 ? error.outcome
      : provenUnsent ? "definitely_not_sent" : markAttempted && !rawPersisted ? "outcome_unknown" : "local_failure";
    const error_code = safeMonitoringInsightErrorV1(error);
    await store.fail({ database, lease, call_id: call?.id, attempt_token: call?.attempt_token, outcome, error_code }).catch(() => undefined);
    throw errorWithCode(error_code);
  }
}

function validReceipt(value: MonitoringInsightsRawReceiptV1) {
  return value && Buffer.isBuffer(value.bytes) && value.bytes.length <= 512 * 1024
    && Number.isInteger(value.http_status) && value.http_status >= 100 && value.http_status <= 599
    && typeof value.complete === "boolean" && (value.provider_request_id === null
      || typeof value.provider_request_id === "string" && value.provider_request_id.length <= 200);
}
export function safeMonitoringInsightErrorV1(error: unknown): string {
  const value = error && typeof error === "object" && "code" in error ? error.code : error instanceof Error ? error.message : null;
  return typeof value === "string" && /^monitoring_insights_[a-z0-9_]+$/u.test(value) ? value : "monitoring_insights_job_failed";
}
